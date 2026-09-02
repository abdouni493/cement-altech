import { useEffect, useMemo, useState } from 'react';
import {
  FileBarChart, Printer, ShoppingBag, Coins, ClipboardList, Wallet, RotateCcw, Package, Percent,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PeriodPicker, ReportKpis, ReportSection, firstDayOfMonth, inPeriod } from './PeriodReport';
import { useSalesStore } from '@/store/salesStore';
import { useClientStore } from '@/store/clientStore';
import { useCommandStore, deliveryStatus } from '@/store/commandStore';
import { useClientDebtStore } from '@/store/clientDebtStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, formatDateTime, todayISO, paymentMethodLabel } from '@/lib/utils';
import { printDetailedReport, type PrintRow, type PrintTableSection } from '@/lib/reportPrint';
import type { Client } from '@/types';

/**
 * Compte rendu d'un client sur une période : ventes, commandes, règlements
 * de dette et versements de dettes manuelles — affiché à l'écran puis
 * imprimable sur le modèle professionnel de l'entreprise.
 */
export function ClientStatementModal({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { language } = useLanguage();
  const sales = useSalesStore((s) => s.sales);
  const payments = useClientStore((s) => s.payments);
  const commands = useCommandStore((s) => s.commands);
  const debts = useClientDebtStore((s) => s.debts);
  const settings = useSettingsStore((s) => s.settings);

  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);

  // Un compte rendu appartient à UN client : à l'ouverture d'une autre fiche on
  // repart d'une période vierge, sinon l'écran affiche encore le rapport
  // généré pour le client précédent.
  useEffect(() => {
    if (!client) return;
    setFrom(firstDayOfMonth());
    setTo(todayISO());
    setPeriod(null);
  }, [client?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => {
    if (!client || !period) return null;
    const { from: f, to: t } = period;

    const salesList = sales
      .filter((s) => s.clientId === client.id && inPeriod(s.date, f, t))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Une commande entre dans le compte rendu si sa date de livraison prévue OU
    // sa date de création tombe dans la période — et on la trie/affiche par
    // date de livraison.
    const commandsList = commands
      .filter(
        (c) =>
          c.clientId === client.id &&
          (inPeriod(c.receiveDate, f, t) || inPeriod(c.createdAt, f, t))
      )
      .sort((a, b) =>
        (a.receiveDate || a.createdAt.slice(0, 10)).localeCompare(b.receiveDate || b.createdAt.slice(0, 10))
      );

    const paymentsList = payments
      .filter((p) => p.partyId === client.id && inPeriod(p.paidAt, f, t))
      .sort((a, b) => a.paidAt.localeCompare(b.paidAt));

    const versements = debts
      .filter((d) => d.clientId === client.id)
      .flatMap((d) =>
        (d.versements ?? [])
          .filter((v) => inPeriod(v.date || v.createdAt, f, t))
          .map((v) => ({ ...v, debtDescription: d.description }))
      )
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const salesTotal = salesList.reduce((s, x) => s + x.finalAmount, 0);
    const salesPaid = salesList.reduce((s, x) => s + x.paidAmount, 0);
    const salesRest = salesList.reduce((s, x) => s + x.restAmount, 0);

    // ---- TVA de la période ------------------------------------------------
    // `finalAmount` est le NET A PAYER TTC : base hors taxes (total des lignes
    // moins la réduction) + TVA. Le compte rendu doit montrer les trois, à
    // l'écran comme sur le document imprimé.
    const tvaSales = salesList.filter((x) => x.tvaEnabled && (x.tvaAmount || 0) > 0);
    const salesHT = salesList.reduce((s, x) => s + Math.max(0, x.totalAmount - x.reduction), 0);
    const salesReduction = salesList.reduce((s, x) => s + (x.reduction || 0), 0);
    const tvaCollected = salesList.reduce((s, x) => s + (x.tvaAmount || 0), 0);
    const tvaRates = [...new Set(tvaSales.map((x) => x.tvaRate ?? 0))].sort((a, b) => a - b);
    const commandsTotal = commandsList.reduce((s, x) => s + x.totalAmount, 0);
    const commandsPaid = commandsList.reduce((s, x) => s + x.paidAmount, 0);
    const commandsRest = commandsList.reduce((s, x) => s + x.restAmount, 0);
    const settled = paymentsList.reduce((s, x) => s + x.amount, 0);
    const versed = versements.reduce((s, x) => s + x.amount, 0);
    const articles = salesList.reduce((s, x) => s + x.products.length, 0);

    // Quantités achetées par production, ventes ET commandes confondues — c'est
    // le récapitulatif que le client attend en bas du compte rendu.
    const purchasedByProduct = new Map<
      string,
      { name: string; unit?: string; soldQty: number; orderedQty: number; deliveredQty: number; amount: number }
    >();
    const bump = (name: string, unit: string | undefined) => {
      const key = `${name.trim().toLowerCase()}|${unit ?? ''}`;
      const cur = purchasedByProduct.get(key) ?? {
        name: name.trim(), unit, soldQty: 0, orderedQty: 0, deliveredQty: 0, amount: 0,
      };
      purchasedByProduct.set(key, cur);
      return cur;
    };
    salesList.forEach((sale) =>
      sale.products.forEach((pr) => {
        const line = bump(pr.productName || '—', pr.unit);
        line.soldQty += pr.quantity;
        line.amount += pr.quantity * pr.sellingPrice;
      })
    );
    commandsList.forEach((cmd) =>
      cmd.items.forEach((it) => {
        const line = bump(it.productName || '—', it.sellByUnit ? it.sellUnit : undefined);
        line.orderedQty += it.quantity;
        line.deliveredQty += it.deliveredQuantity ?? 0;
        line.amount += it.totalPrice;
      })
    );
    const purchased = [...purchasedByProduct.values()].sort((a, b) => b.amount - a.amount);

    return {
      salesList, commandsList, paymentsList, versements, purchased,
      salesTotal, salesPaid, salesRest,
      tvaSales, salesHT, salesReduction, tvaCollected, tvaRates,
      commandsTotal, commandsPaid, commandsRest,
      settled, versed, articles,
      billed: salesTotal + commandsTotal,
      collected: salesPaid + commandsPaid + settled + versed,
      outstanding: salesRest + commandsRest,
    };
  }, [client, period, sales, commands, payments, debts]);

  const periodLabel = period
    ? `Du ${formatDate(period.from, language)} au ${formatDate(period.to, language)}`
    : '';

  /** Mentions portées sur une facture : TVA appliquée et saisie rétroactive. */
  const saleTags = (sale: { tvaEnabled?: boolean; tvaRate?: number; isHistorical?: boolean }) =>
    [
      sale.tvaEnabled ? `TVA ${sale.tvaRate ?? 0}%` : '',
      sale.isHistorical ? 'ancienne vente' : '',
    ].filter(Boolean).join(' · ');

  const doPrint = () => {
    if (!client || !data || !period) return;

    const salesSection: PrintTableSection = {
      title: 'Ventes de la période',
      icon: '🧾',
      headerTotal: formatCurrency(data.salesTotal),
      cols: [
        { label: 'N° facture' }, { label: 'Date' }, { label: 'Articles', align: 'right' },
        { label: 'TVA', align: 'right' },
        { label: 'Total', align: 'right' }, { label: 'Payé', align: 'right' },
        { label: 'Reste', align: 'right' },
      ],
      rows: [
        ...data.salesList.map<PrintRow>((s) => ({
          cells: [
            `${s.reference}${s.isHistorical ? ' (ancienne vente)' : ''}`,
            formatDate(s.date, language), String(s.products.length),
            s.tvaEnabled ? `${formatCurrency(s.tvaAmount || 0)} (${s.tvaRate ?? 0}%)` : '—',
            formatCurrency(s.finalAmount), formatCurrency(s.paidAmount), formatCurrency(s.restAmount),
          ],
          tone: s.restAmount > 0 ? 'neg' : 'pos',
        })),
        ...(data.salesList.length
          ? [{
              cells: ['TOTAL VENTES', '', String(data.articles),
                formatCurrency(data.salesList.reduce((a, x) => a + (x.tvaAmount || 0), 0)),
                formatCurrency(data.salesTotal),
                formatCurrency(data.salesPaid), formatCurrency(data.salesRest)],
              variant: 'total' as const,
            }]
          : []),
      ],
      emptyLabel: 'Aucune vente sur la période',
    };

    // ---- TVA : base HT, taux, montant collecté, net TTC, facture par facture
    const tvaSection: PrintTableSection = {
      title: 'TVA de la période',
      icon: '🧮',
      note:
        'Base hors taxes = total des lignes moins la réduction. '
        + 'Net à payer TTC = base HT + TVA.',
      headerTotal: formatCurrency(data.tvaCollected),
      cols: [
        { label: 'N° facture' }, { label: 'Date' },
        { label: 'Base HT', align: 'right' }, { label: 'Taux', align: 'right' },
        { label: 'TVA', align: 'right' }, { label: 'Net TTC', align: 'right' },
      ],
      rows: [
        ...data.salesList.map<PrintRow>((x) => ({
          cells: [
            `${x.reference}${x.isHistorical ? ' (ancienne vente)' : ''}`,
            formatDate(x.date, language),
            formatCurrency(Math.max(0, x.totalAmount - x.reduction)),
            x.tvaEnabled ? `${x.tvaRate ?? 0} %` : 'Sans TVA',
            formatCurrency(x.tvaAmount || 0),
            formatCurrency(x.finalAmount),
          ],
          tone: x.tvaEnabled ? 'accent' : 'muted',
        })),
        ...(data.salesList.length
          ? [{
              cells: [
                'TOTAL', '',
                formatCurrency(data.salesHT),
                data.tvaRates.length ? data.tvaRates.map((r) => `${r} %`).join(' · ') : '—',
                formatCurrency(data.tvaCollected),
                formatCurrency(data.salesTotal),
              ],
              variant: 'total' as const,
            }]
          : []),
      ],
      emptyLabel: 'Aucune vente sur la période',
    };

    // Récapitulatif fiscal — les trois montants attendus sur un compte rendu
    const tvaSummarySection: PrintTableSection = {
      title: 'Récapitulatif TVA',
      icon: '📐',
      cols: [{ label: 'Libellé' }, { label: 'Montant', align: 'right' }],
      rows: [
        { cells: ['Total hors taxes (base imposable)', formatCurrency(data.salesHT)], tone: 'accent' },
        { cells: ['Réductions accordées', formatCurrency(data.salesReduction)], tone: 'muted' },
        {
          cells: [
            `TVA collectée${data.tvaRates.length ? ` (${data.tvaRates.map((r) => `${r} %`).join(' · ')})` : ''}`,
            formatCurrency(data.tvaCollected),
          ],
          tone: 'accent',
        },
        { cells: ['Ventes soumises à la TVA', `${data.tvaSales.length} / ${data.salesList.length}`], tone: 'muted' },
        { cells: ['TOTAL TTC FACTURÉ (ventes)', formatCurrency(data.salesTotal)], variant: 'total', tone: 'pos' },
      ],
    };

    const detailSection: PrintTableSection = {
      title: 'Détail des articles vendus',
      icon: '📦',
      cols: [
        { label: 'Facture / Produit' }, { label: 'Quantité', align: 'right' },
        { label: 'P.U. appliqué', align: 'right' }, { label: 'Montant', align: 'right' },
      ],
      rows: data.salesList.flatMap<PrintRow>((s) => [
        {
          cells: [`${s.reference} — ${formatDate(s.date, language)}`, formatCurrency(s.finalAmount)],
          variant: 'category', span: true, tone: 'accent',
        },
        ...s.products.map<PrintRow>((p) => ({
          cells: [
            p.productName || '—',
            `${p.quantity}${p.unit ? ` ${p.unit}` : ''}`,
            formatCurrency(p.sellingPrice),
            formatCurrency(p.quantity * p.sellingPrice),
          ],
          variant: 'detail',
        })),
      ]),
      emptyLabel: 'Aucun article vendu sur la période',
    };

    const commandsSection: PrintTableSection = {
      title: 'Commandes de la période',
      icon: '📋',
      headerTotal: formatCurrency(data.commandsTotal),
      cols: [
        { label: 'N° commande' }, { label: 'Date de livraison' },
        { label: 'Total', align: 'right' }, { label: 'Payé', align: 'right' }, { label: 'Reste', align: 'right' },
      ],
      rows: [
        ...data.commandsList.map<PrintRow>((c) => ({
          cells: [
            c.reference,
            c.receiveDate ? formatDate(c.receiveDate, language) : '—',
            formatCurrency(c.totalAmount), formatCurrency(c.paidAmount), formatCurrency(c.restAmount),
          ],
          tone: c.restAmount > 0 ? 'neg' : 'pos',
        })),
        ...(data.commandsList.length
          ? [{
              cells: ['TOTAL COMMANDES', '', formatCurrency(data.commandsTotal),
                formatCurrency(data.commandsPaid), formatCurrency(data.commandsRest)],
              variant: 'total' as const,
            }]
          : []),
      ],
      emptyLabel: 'Aucune commande sur la période',
    };

    // Détail ligne par ligne des produits commandés — avec les quantités
    const commandDetailSection: PrintTableSection = {
      title: 'Détail des produits commandés',
      icon: '🚚',
      cols: [
        { label: 'Commande / Produit' }, { label: 'Qté commandée', align: 'right' },
        { label: 'Qté livrée', align: 'right' }, { label: 'Reste à livrer', align: 'right' },
        { label: 'P.U.', align: 'right' }, { label: 'Montant', align: 'right' },
      ],
      rows: data.commandsList.flatMap<PrintRow>((c) => [
        {
          cells: [
            `${c.reference} — livraison ${c.receiveDate ? formatDate(c.receiveDate, language) : '—'}`,
            formatCurrency(c.totalAmount),
          ],
          variant: 'category', span: true, tone: 'accent',
        },
        ...c.items.map<PrintRow>((it) => {
          const u = it.sellByUnit && it.sellUnit ? ` ${it.sellUnit}` : '';
          const done = it.deliveredQuantity ?? 0;
          return {
            cells: [
              it.productName || '—',
              `${it.quantity}${u}`,
              `${done}${u}`,
              `${Math.max(0, it.quantity - done)}${u}`,
              formatCurrency(it.unitPrice),
              formatCurrency(it.totalPrice),
            ],
            variant: 'detail',
          };
        }),
      ]),
      emptyLabel: 'Aucun produit commandé sur la période',
    };

    // Récapitulatif : combien de chaque production le client a pris
    const purchasedSection: PrintTableSection = {
      title: 'Quantités achetées par production',
      icon: '🏗️',
      note: 'Cumul des ventes et des commandes de la période, production par production.',
      headerTotal: formatCurrency(data.purchased.reduce((s, x) => s + x.amount, 0)),
      cols: [
        { label: 'Production' }, { label: 'Qté vendue', align: 'right' },
        { label: 'Qté commandée', align: 'right' }, { label: 'Qté livrée', align: 'right' },
        { label: 'Qté totale', align: 'right' }, { label: 'Montant', align: 'right' },
      ],
      rows: [
        ...data.purchased.map<PrintRow>((x) => {
          const u = x.unit ? ` ${x.unit}` : '';
          return {
            cells: [
              x.name,
              `${x.soldQty}${u}`,
              `${x.orderedQty}${u}`,
              `${x.deliveredQty}${u}`,
              `${x.soldQty + x.orderedQty}${u}`,
              formatCurrency(x.amount),
            ],
            tone: 'accent',
          };
        }),
        ...(data.purchased.length
          ? [{
              cells: [
                'TOTAL',
                String(data.purchased.reduce((s, x) => s + x.soldQty, 0)),
                String(data.purchased.reduce((s, x) => s + x.orderedQty, 0)),
                String(data.purchased.reduce((s, x) => s + x.deliveredQty, 0)),
                String(data.purchased.reduce((s, x) => s + x.soldQty + x.orderedQty, 0)),
                formatCurrency(data.purchased.reduce((s, x) => s + x.amount, 0)),
              ],
              variant: 'total' as const,
            }]
          : []),
      ],
      emptyLabel: 'Aucune production achetée sur la période',
    };

    const paymentsSection: PrintTableSection = {
      title: 'Versements encaissés du client',
      icon: '💰',
      headerTotal: formatCurrency(data.settled),
      cols: [
        { label: 'Date et heure' }, { label: 'Référence' }, { label: 'Mode de règlement' },
        { label: 'Note' }, { label: 'Montant', align: 'right' },
      ],
      rows: [
        ...data.paymentsList.map<PrintRow>((p) => ({
          cells: [
            formatDateTime(p.paidAt, language),
            `VER-${p.id.slice(0, 8).toUpperCase()}`,
            paymentMethodLabel(p),
            p.notes || '—',
            formatCurrency(p.amount),
          ],
          tone: 'pos',
        })),
        ...(data.paymentsList.length
          ? [{ cells: ['TOTAL VERSEMENTS', '', '', '', formatCurrency(data.settled)], variant: 'total' as const }]
          : []),
      ],
      emptyLabel: 'Aucun règlement sur la période',
    };

    const versementsSection: PrintTableSection = {
      title: 'Versements sur dettes enregistrées',
      icon: '🧮',
      headerTotal: formatCurrency(data.versed),
      cols: [
        { label: 'Date' }, { label: 'Dette' }, { label: 'Note' }, { label: 'Montant', align: 'right' },
      ],
      rows: [
        ...data.versements.map<PrintRow>((v) => ({
          cells: [
            formatDate(v.date || v.createdAt, language),
            v.debtDescription || '—',
            v.notes || '—',
            formatCurrency(v.amount),
          ],
          tone: 'pos',
        })),
        ...(data.versements.length
          ? [{ cells: ['TOTAL VERSEMENTS', '', '', formatCurrency(data.versed)], variant: 'total' as const }]
          : []),
      ],
      emptyLabel: 'Aucun versement sur la période',
    };

    printDetailedReport(
      {
        docTitle: `Compte rendu ${client.name}`,
        headTitle: 'COMPTE RENDU CLIENT',
        subtitle: periodLabel,
        meta: [
          { label: 'Client', value: client.name },
          { label: 'Téléphone', value: client.phone || '—' },
          { label: 'Adresse', value: client.address || '—' },
          { label: 'Période', value: periodLabel },
        ],
        kpis: [
          { label: 'Total facturé', value: formatCurrency(data.billed), tone: 'accent' },
          { label: 'Total encaissé', value: formatCurrency(data.collected), tone: 'pos' },
          { label: 'Reste dû (période)', value: formatCurrency(data.outstanding), tone: 'neg' },
          { label: 'Ventes HT (base imposable)', value: formatCurrency(data.salesHT), tone: 'muted' },
          { label: 'TVA collectée', value: formatCurrency(data.tvaCollected), tone: 'accent' },
          { label: 'Ventes TTC', value: formatCurrency(data.salesTotal), tone: 'pos' },
          { label: 'Opérations', value: String(
              data.salesList.length + data.commandsList.length + data.paymentsList.length + data.versements.length
            ) },
        ],
        sections: [
          salesSection, tvaSection, tvaSummarySection, detailSection,
          commandsSection, commandDetailSection,
          purchasedSection, paymentsSection, versementsSection,
        ],
      },
      settings,
      language
    );
  };

  return (
    <Modal
      open={!!client}
      onClose={onClose}
      title={`Compte rendu — ${client?.name ?? ''}`}
      size="lg"
    >
      {client && (
        <div className="space-y-5">
          <PeriodPicker
            from={from}
            to={to}
            onChange={(f, t) => { setFrom(f); setTo(t); setPeriod(null); }}
            onGenerate={() => setPeriod({ from, to })}
          />

          {!data ? (
            <div className="rounded-2xl border border-dashed border-gold/25 bg-vanilla/20 py-10 text-center">
              <FileBarChart size={34} className="mx-auto text-gold opacity-60 mb-3" />
              <p className="text-sm text-text-muted">
                Choisissez une date de début et une date de fin, puis générez le compte rendu.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-display text-base font-semibold text-text-primary">{client.name}</p>
                  <p className="text-xs text-text-muted">{periodLabel}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPeriod(null)}>
                    <RotateCcw size={14} /> Changer la période
                  </Button>
                  <Button size="sm" variant="gold" onClick={doPrint}>
                    <Printer size={14} /> Imprimer le compte rendu
                  </Button>
                </div>
              </div>

              <ReportKpis
                items={[
                  { label: 'Total facturé', value: formatCurrency(data.billed), color: 'text-gold-dark' },
                  { label: 'Total encaissé', value: formatCurrency(data.collected), color: 'text-pistachio' },
                  { label: 'Reste dû', value: formatCurrency(data.outstanding), color: 'text-rose-deep' },
                  { label: 'Ventes HT', value: formatCurrency(data.salesHT) },
                  { label: 'TVA collectée', value: formatCurrency(data.tvaCollected), color: 'text-gold-dark' },
                  { label: 'Ventes TTC', value: formatCurrency(data.salesTotal), color: 'text-pistachio' },
                  { label: 'Ventes', value: String(data.salesList.length) },
                  { label: 'Commandes', value: String(data.commandsList.length) },
                  { label: 'Règlements', value: formatCurrency(data.settled), color: 'text-pistachio' },
                  { label: 'Versements dettes', value: formatCurrency(data.versed), color: 'text-pistachio' },
                  { label: 'Articles vendus', value: String(data.articles) },
                ]}
              />

              <ReportSection
                title="Ventes" icon={<ShoppingBag size={14} />}
                total={formatCurrency(data.salesTotal)}
                head={['N° facture', 'Date', 'Articles', 'TVA', 'Total', 'Payé', 'Reste']}
                empty="Aucune vente sur cette période"
                rows={data.salesList.map((s) => [
                  <span key="r" className="font-semibold">
                    {s.reference}
                    {saleTags(s) && (
                      <span className="ml-1.5 text-[10px] font-medium text-gold-dark">({saleTags(s)})</span>
                    )}
                  </span>,
                  formatDate(s.date, language),
                  s.products.length,
                  s.tvaEnabled ? formatCurrency(s.tvaAmount || 0) : '—',
                  formatCurrency(s.finalAmount),
                  <span key="p" className="text-pistachio">{formatCurrency(s.paidAmount)}</span>,
                  <span key="x" className={s.restAmount > 0 ? 'text-rose-deep font-bold' : 'text-pistachio'}>
                    {formatCurrency(s.restAmount)}
                  </span>,
                ])}
              />

              <ReportSection
                title="TVA de la période" icon={<Percent size={14} />}
                total={formatCurrency(data.tvaCollected)}
                note="Base hors taxes = total des lignes moins la réduction. Net TTC = base HT + TVA."
                head={['N° facture', 'Date', 'Base HT', 'Taux', 'TVA', 'Net TTC']}
                empty="Aucune vente sur cette période"
                rows={[
                  ...data.salesList.map((x) => [
                    <span key="r" className="font-semibold">{x.reference}</span>,
                    formatDate(x.date, language),
                    formatCurrency(Math.max(0, x.totalAmount - x.reduction)),
                    x.tvaEnabled ? `${x.tvaRate ?? 0} %` : <span key="n" className="text-text-muted">Sans TVA</span>,
                    <span key="t" className={x.tvaEnabled ? 'font-bold text-gold-dark' : 'text-text-muted'}>
                      {formatCurrency(x.tvaAmount || 0)}
                    </span>,
                    <span key="f" className="font-semibold">{formatCurrency(x.finalAmount)}</span>,
                  ]),
                  ...(data.salesList.length
                    ? [[
                        <span key="l" className="font-bold uppercase text-text-secondary">Total</span>,
                        '',
                        <span key="h" className="font-bold">{formatCurrency(data.salesHT)}</span>,
                        data.tvaRates.length ? data.tvaRates.map((r) => `${r} %`).join(' · ') : '—',
                        <span key="tv" className="font-bold text-gold-dark">{formatCurrency(data.tvaCollected)}</span>,
                        <span key="tt" className="font-bold text-pistachio">{formatCurrency(data.salesTotal)}</span>,
                      ]]
                    : []),
                ]}
              />

              <ReportSection
                title="Commandes" icon={<ClipboardList size={14} />}
                total={formatCurrency(data.commandsTotal)}
                head={['N° commande', 'Date de livraison', 'Livraison', 'Total', 'Payé', 'Reste']}
                empty="Aucune commande sur cette période"
                rows={data.commandsList.map((c) => {
                  const d = deliveryStatus(c);
                  return [
                    <span key="r" className="font-semibold">{c.reference}</span>,
                    c.receiveDate ? formatDate(c.receiveDate, language) : '—',
                    <Badge key="d" variant={d.isFull ? 'success' : d.isPartial ? 'warning' : 'danger'}>
                      {d.isFull ? 'Livrée' : d.isPartial ? `${d.percent.toFixed(0)}%` : 'Non livrée'}
                    </Badge>,
                    formatCurrency(c.totalAmount),
                    <span key="p" className="text-pistachio">{formatCurrency(c.paidAmount)}</span>,
                    <span key="x" className={c.restAmount > 0 ? 'text-rose-deep font-bold' : 'text-pistachio'}>
                      {formatCurrency(c.restAmount)}
                    </span>,
                  ];
                })}
              />

              <ReportSection
                title="Quantités achetées par production" icon={<Package size={14} />}
                total={formatCurrency(data.purchased.reduce((s, x) => s + x.amount, 0))}
                head={['Production', 'Qté vendue', 'Qté commandée', 'Qté livrée', 'Qté totale', 'Montant']}
                empty="Aucune production achetée sur cette période"
                rows={data.purchased.map((x) => {
                  const u = x.unit ? ` ${x.unit}` : '';
                  return [
                    <span key="n" className="font-semibold">{x.name}</span>,
                    `${x.soldQty}${u}`,
                    `${x.orderedQty}${u}`,
                    `${x.deliveredQty}${u}`,
                    <span key="t" className="font-bold text-gold-dark">{x.soldQty + x.orderedQty}{u}</span>,
                    formatCurrency(x.amount),
                  ];
                })}
              />

              <ReportSection
                title="Versements du client" icon={<Coins size={14} />}
                total={formatCurrency(data.settled)}
                head={['Date et heure', 'Reçu n°', 'Mode de règlement', 'Note', 'Montant']}
                empty="Aucun versement sur cette période"
                rows={data.paymentsList.map((p) => [
                  formatDateTime(p.paidAt, language),
                  `VER-${p.id.slice(0, 8).toUpperCase()}`,
                  paymentMethodLabel(p),
                  p.notes || '—',
                  <span key="a" className="font-bold text-pistachio">{formatCurrency(p.amount)}</span>,
                ])}
              />

              <ReportSection
                title="Versements sur dettes enregistrées" icon={<Wallet size={14} />}
                total={formatCurrency(data.versed)}
                head={['Date', 'Dette', 'Note', 'Montant']}
                empty="Aucun versement sur cette période"
                rows={data.versements.map((v) => [
                  formatDate(v.date || v.createdAt, language),
                  v.debtDescription || '—',
                  v.notes || '—',
                  <span key="a" className="font-bold text-pistachio">{formatCurrency(v.amount)}</span>,
                ])}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
