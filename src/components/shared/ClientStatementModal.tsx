import { useEffect, useMemo, useState } from 'react';
import {
  FileBarChart, Printer, ShoppingBag, Coins, ClipboardList, Wallet, RotateCcw, Package, Percent,
  History, Undo2, PiggyBank, Truck,
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
import {
  formatCurrency, formatDate, formatDateTime, todayISO, paymentMethodLabel,
  computeTva, DEFAULT_TVA_RATE,
} from '@/lib/utils';
import { computePartyBalance } from '@/lib/partyBalance';
import { netCommandTotals } from '@/lib/commandBilling';
import { printDetailedReport, type PrintRow, type PrintTableSection } from '@/lib/reportPrint';
import { printDeliveryPeriodReport, type DeliveryPeriodLine } from '@/lib/documents';
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
  const clientRows = useClientStore((s) => s.clients);
  const oldDebts = useClientStore((s) => s.oldDebts);
  const refunds = useClientStore((s) => s.refunds);
  const commands = useCommandStore((s) => s.commands);
  const deliveries = useCommandStore((s) => s.deliveries);
  const debts = useClientDebtStore((s) => s.debts);
  const settings = useSettingsStore((s) => s.settings);

  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);

  // ---- TVA DU COMPTE RENDU IMPRIMÉ --------------------------------------
  // L'impression passe d'abord par une question : applique-t-on la TVA sur le
  // total final ? « Non » imprime directement le compte rendu, « Oui » ouvre la
  // saisie du taux (19 % par défaut, modifiable) avant d'imprimer.
  const [tvaAsk, setTvaAsk] = useState(false);
  const [tvaOn, setTvaOn] = useState(false);
  const [tvaRate, setTvaRate] = useState(DEFAULT_TVA_RATE);

  // Un compte rendu appartient à UN client : à l'ouverture d'une autre fiche on
  // repart d'une période vierge, sinon l'écran affiche encore le rapport
  // généré pour le client précédent.
  useEffect(() => {
    setTvaAsk(false);
    setTvaOn(false);
    setTvaRate(DEFAULT_TVA_RATE);
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

    // ANCIENNES DETTES (ardoises d'avant le logiciel) tombant dans la periode
    const oldDebtsList = oldDebts
      .filter((d) => d.partyId === client.id && inPeriod(d.date, f, t))
      .sort((a, b) => a.date.localeCompare(b.date));

    // EXCEDENTS RENDUS au client sur la periode (sortie de caisse)
    const refundsList = refunds
      .filter((r) => r.partyId === client.id && inPeriod(r.refundedAt, f, t))
      .sort((a, b) => a.refundedAt.localeCompare(b.refundedAt));

    const versements = debts
      .filter((d) => d.clientId === client.id)
      .flatMap((d) =>
        (d.versements ?? [])
          .filter((v) => inPeriod(v.date || v.createdAt, f, t))
          .map((v) => ({ ...v, debtDescription: d.description }))
      )
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // LIVRAISONS de la période — chaque bon de livraison d'une commande du
    // client dont la date de remise tombe dans la période, éclaté ligne à ligne
    // (date · localisation · désignation · quantité · P.U · montant).
    const clientCommandIds = new Set(commands.filter((c) => c.clientId === client.id).map((c) => c.id));
    const commandById = new Map(commands.map((c) => [c.id, c]));
    const deliveriesList = deliveries
      .filter((d) => clientCommandIds.has(d.commandId) && inPeriod(d.deliveredAt, f, t))
      .sort((a, b) => a.deliveredAt.localeCompare(b.deliveredAt));
    const deliveryLines: DeliveryPeriodLine[] = deliveriesList.flatMap((d) => {
      const cmd = commandById.get(d.commandId);
      return d.items.map((it) => {
        const ci = cmd?.items.find(
          (x) => (it.commandItemId && x.id === it.commandItemId) || x.productName === it.productName
        );
        const unitPrice = ci?.unitPrice ?? 0;
        return {
          date: d.deliveredAt.slice(0, 10),
          location: d.location || cmd?.clientAddress || '—',
          designation: it.productName,
          quantity: it.quantity,
          unit: it.sellUnit,
          unitPrice,
          amount: it.quantity * unitPrice,
        };
      });
    });
    const deliveriesTotal = deliveryLines.reduce((s, l) => s + l.amount, 0);

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
    // Une commande deja livree est deja facturee par les ventes de ses bons :
    // seul le solde non encore livre s'ajoute au total du compte rendu.
    const netCmd = netCommandTotals(commandsList, sales);
    const commandsTotal = netCmd.billed;
    const commandsPaid = netCmd.paid;
    const commandsRest = netCmd.rest;
    const settled = paymentsList.reduce((s, x) => s + x.amount, 0);
    const versed = versements.reduce((s, x) => s + x.amount, 0);
    const articles = salesList.reduce((s, x) => s + x.products.length, 0);

    const oldDebtsTotal = oldDebtsList.reduce((s, x) => s + x.amount, 0);
    const oldDebtsPaid = oldDebtsList.reduce((s, x) => s + x.paidAmount, 0);
    const oldDebtsRest = oldDebtsList.reduce((s, x) => s + x.restAmount, 0);
    const refunded = refundsList.reduce((s, x) => s + x.amount, 0);

    // ---- SITUATION ACTUELLE DU COMPTE (toutes periodes confondues) --------
    // C'est elle qui dit si le client DOIT encore de l'argent ou si, au
    // contraire, il a verse PLUS que sa dette : dans ce cas l'entreprise lui
    // doit la difference et le compte rendu doit l'afficher en POSITIF.
    const allSales = sales.filter((x) => x.clientId === client.id);
    const allCommands = commands.filter((x) => x.clientId === client.id);
    const allOldDebts = oldDebts.filter((d) => d.partyId === client.id);
    const netAll = netCommandTotals(allCommands, allSales);
    const account = computePartyBalance({
      documentsBilled: allSales.reduce((s, x) => s + x.finalAmount, 0) + netAll.billed,
      documentsPaid: allSales.reduce((s, x) => s + x.paidAmount, 0) + netAll.paid,
      documentsRest: allSales.reduce((s, x) => s + x.restAmount, 0) + netAll.rest,
      oldDebts: allOldDebts,
      credit: clientRows.find((c) => c.id === client.id)?.creditAmount ?? 0,
    });

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
      deliveriesList, deliveryLines, deliveriesTotal,
      oldDebtsList, refundsList,
      salesTotal, salesPaid, salesRest,
      tvaSales, salesHT, salesReduction, tvaCollected, tvaRates,
      commandsTotal, commandsPaid, commandsRest,
      settled, versed, articles,
      oldDebtsTotal, oldDebtsPaid, oldDebtsRest, refunded,
      account,
      billed: salesTotal + commandsTotal + oldDebtsTotal,
      collected: salesPaid + commandsPaid + settled + versed,
      // ce qui est reellement reste dans la caisse une fois l'excedent rendu
      netCollected: salesPaid + commandsPaid + settled + versed - refunded,
      outstanding: salesRest + commandsRest + oldDebtsRest,
    };
  }, [client, period, sales, commands, deliveries, payments, debts, oldDebts, refunds, clientRows]);

  const periodLabel = period
    ? `Du ${formatDate(period.from, language)} au ${formatDate(period.to, language)}`
    : '';

  /** Mentions portées sur une facture : TVA appliquée et saisie rétroactive. */
  const saleTags = (sale: { tvaEnabled?: boolean; tvaRate?: number; isHistorical?: boolean }) =>
    [
      sale.tvaEnabled ? `TVA ${sale.tvaRate ?? 0}%` : '',
      sale.isHistorical ? 'ancienne vente' : '',
    ].filter(Boolean).join(' · ');

  /**
   * MARCHANDISES DE LA PÉRIODE — une ligne par produit ET par prix pratiqué.
   * C'est la base HORS TAXES du compte rendu : l'aperçu de la fenêtre « TVA »
   * et le document imprimé partent des mêmes lignes, donc du même TOTAL H.T.
   *
   * NE JAMAIS COMPTER DEUX FOIS LA MÊME MARCHANDISE : depuis « la livraison est
   * une vente », chaque bon de livraison crée une facture qui porte déjà les
   * produits livrés. Les commandes n'apportent donc que leur part ENCORE À
   * LIVRER — sans quoi une commande livrée apparaissait en double et le TOTAL
   * H.T, la T.V.A et le TOTAL T.T.C étaient multipliés (même règle que
   * `netCommandTotals()` côté montants).
   */
  type PrintLine = { name: string; unit?: string; quantity: number; unitPrice: number; amount: number };
  const printLines = useMemo<PrintLine[]>(() => {
    if (!data) return [];
    const grouped = new Map<string, PrintLine>();
    const push = (name: string, unit: string | undefined, quantity: number, unitPrice: number) => {
      if (!(quantity > 0)) return;
      const key = `${name.trim().toLowerCase()}|${unit ?? ''}|${unitPrice}`;
      const cur = grouped.get(key) ?? { name: name.trim(), unit, quantity: 0, unitPrice, amount: 0 };
      cur.quantity += quantity;
      cur.amount += quantity * unitPrice;
      grouped.set(key, cur);
    };
    data.salesList.forEach((s) =>
      s.products.forEach((pr) => push(pr.productName || '—', pr.unit, pr.quantity, pr.sellingPrice))
    );
    data.commandsList.forEach((c) =>
      c.items.forEach((it) =>
        push(
          it.productName || '—',
          it.sellByUnit ? it.sellUnit : undefined,
          Math.max(0, it.quantity - (it.deliveredQuantity ?? 0)),
          it.unitPrice
        )
      )
    );
    return [...grouped.values()].sort((a, b) => b.amount - a.amount);
  }, [data]);

  /** TOTAL H.T imprimé : montant des marchandises de la période, avant TVA. */
  const printHT = printLines.reduce((s, l) => s + l.amount, 0);
  /** Aperçu en direct du taux saisi dans la fenêtre « TVA ». */
  const tvaPreview = computeTva(printHT, 0, tvaOn, tvaRate);

  /** Ouvre la question « TVA ? » avec des valeurs neuves à chaque impression. */
  const askTva = () => {
    setTvaOn(false);
    setTvaRate(DEFAULT_TVA_RATE);
    setTvaAsk(true);
  };

  /**
   * COMPTE RENDU CLIENT — document volontairement DÉPOUILLÉ : la marchandise
   * de la période avec sa QUANTITÉ, son PRIX UNITAIRE et son MONTANT, puis
   * TOTAL H.T, T.V.A, TOTAL T.T.C, VERSEMENT et LE REST. Tout le reste
   * (factures ligne à ligne, KPI, TVA détaillée, anciennes dettes, excédents)
   * reste consultable à l'écran mais n'est plus imprimé.
   *
   * Le total est TOUJOURS présenté HORS TAXES d'abord ; la TVA choisie au
   * moment de l'impression vient ensuite et donne le TOTAL T.T.C final.
   */
  const doPrint = (applyTva: boolean, rate: number) => {
    if (!client || !data || !period) return;

    const lines = printLines;
    // 1. LE TOTAL HORS TAXES : la marchandise de la période, et rien d'autre.
    const ht = printHT;
    // 2. LE MONTANT DE LA TVA : ce total hors taxes × le taux choisi.
    // 3. LE TOTAL T.T.C : total hors taxes + montant de la TVA.
    //    TVA refusée → montant nul et T.T.C = H.T (le document reste hors taxes).
    const { tvaAmount: tva, totalTTC: ttc } = computeTva(ht, 0, applyTva, rate);
    const paid = data.collected;
    // Le reste comptable de la période, augmenté de la TVA qu'on vient de
    // facturer : c'est ce que le client doit encore, TVA comprise.
    const rest = data.outstanding + tva;

    // TVA refusée : le tableau se termine sur un TOTAL unique, hors taxes.
    const totalRows: PrintRow[] = applyTva
      ? [
          { cells: ['TOTAL H.T', '', '', formatCurrency(ht)], variant: 'subtotal' },
          { cells: [`T.V.A ${rate} %`, '', '', formatCurrency(tva)], variant: 'subtotal' },
          { cells: ['TOTAL T.T.C', '', '', formatCurrency(ttc)], variant: 'total' },
        ]
      : [{ cells: ['TOTAL', '', '', formatCurrency(ht)], variant: 'total' }];

    const section: PrintTableSection = {
      title: 'Marchandises de la période',
      cols: [
        { label: 'Désignation' },
        { label: 'Quantité', align: 'right' },
        { label: 'Prix unitaire', align: 'right' },
        { label: 'Total', align: 'right' },
      ],
      rows: [
        ...lines.map<PrintRow>((l) => ({
          cells: [
            l.name.toUpperCase(),
            `${l.quantity}${l.unit ? ` ${l.unit}` : ''}`,
            formatCurrency(l.unitPrice),
            formatCurrency(l.amount),
          ],
        })),
        ...totalRows,
        { cells: ['VERSEMENT', '', '', formatCurrency(paid)], variant: 'subtotal' },
        { cells: ['LE REST', '', '', formatCurrency(rest)], variant: 'total' },
      ],
      emptyLabel: 'Aucune marchandise sur la période',
    };

    printDetailedReport(
      {
        docTitle: `Compte rendu ${client.name}`,
        headTitle: 'COMPTE RENDU CLIENT',
        subtitle: periodLabel,
        meta: [
          { label: 'Client', value: client.name },
          { label: 'T.V.A', value: applyTva ? `${rate} % appliquée sur le total` : 'Non appliquée' },
        ],
        sections: [section],
      },
      settings,
      language
    );
  };

  /** Rapport de livraisons « Livraison du … au … » (modèle manuscrit, image 1). */
  const doPrintDeliveries = () => {
    if (!client || !data || !period) return;
    printDeliveryPeriodReport(
      {
        client: {
          name: client.name, phone: client.phone, address: client.address,
          rc: client.rc, nif: client.nif, nis: client.nis, article: client.article,
        },
        from: period.from,
        to: period.to,
        lines: data.deliveryLines,
        // La TVA n'apparaît que si au moins un bon de la période en porte une.
        applyTva: data.deliveriesList.some((d) => d.tvaEnabled),
        tvaRate: data.deliveriesList.find((d) => d.tvaEnabled)?.tvaRate ?? 19,
        versements: data.deliveriesList
          .filter((d) => (d.cashPaid ?? 0) > 0)
          .map((d) => ({ amount: d.cashPaid ?? 0, date: d.deliveredAt.slice(0, 10) })),
        paidAmount: data.deliveriesList.reduce((s, d) => s + (d.paidAmount ?? 0), 0),
        restAmount: data.deliveriesList.reduce((s, d) => s + (d.restAmount ?? 0), 0),
      },
      settings
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
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPeriod(null)}>
                    <RotateCcw size={14} /> Changer la période
                  </Button>
                  <Button size="sm" variant="secondary" onClick={doPrintDeliveries}>
                    <Truck size={14} /> Bon de livraisons (période)
                  </Button>
                  <Button size="sm" variant="gold" onClick={askTva}>
                    <Printer size={14} /> Imprimer le compte rendu
                  </Button>
                </div>
              </div>

              {/* Le client a verse PLUS que sa dette : l'entreprise lui doit la difference */}
              {data.account.hasCredit && (
                <div className="flex items-start gap-3 rounded-2xl border border-pistachio/40 bg-pistachio/10 px-4 py-3">
                  <PiggyBank size={20} className="shrink-0 mt-0.5 text-pistachio" />
                  <div>
                    <p className="text-sm font-bold text-pistachio">
                      Solde en faveur du client : + {formatCurrency(data.account.creditToReturn)}
                    </p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      {client.name} a versé plus que sa dette. L&rsquo;entreprise lui doit cet excédent :
                      utilisez « Rendre l&rsquo;excédent » sur sa carte pour le lui restituer.
                    </p>
                  </div>
                </div>
              )}

              <ReportKpis
                items={[
                  { label: 'Total facturé', value: formatCurrency(data.billed), color: 'text-gold-dark' },
                  { label: 'Total encaissé', value: formatCurrency(data.collected), color: 'text-pistachio' },
                  { label: 'Excédent rendu', value: formatCurrency(data.refunded), color: 'text-caramel' },
                  { label: 'Reste dû (période)', value: formatCurrency(data.outstanding), color: 'text-rose-deep' },
                  {
                    label: data.account.hasCredit ? 'Solde en sa faveur' : 'Solde dû (compte)',
                    value: data.account.hasCredit
                      ? `+ ${formatCurrency(data.account.creditToReturn)}`
                      : formatCurrency(Math.max(0, data.account.net)),
                    color: data.account.hasCredit ? 'text-pistachio' : 'text-rose-deep',
                  },
                  { label: 'Anciennes dettes', value: formatCurrency(data.oldDebtsTotal), color: 'text-gold-dark' },
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
                title="Livraisons de la période" icon={<Truck size={14} />}
                total={formatCurrency(data.deliveriesTotal)}
                note="Chaque bon de livraison éclaté par date, localisation et produit."
                head={['Date', 'Localisation', 'Désignation', 'Quantité', 'P.U', 'Montant']}
                empty="Aucune livraison sur cette période"
                rows={data.deliveryLines.map((l) => [
                  formatDate(l.date, language),
                  <span key="loc" className="font-semibold">{l.location || '—'}</span>,
                  l.designation,
                  `${l.quantity}${l.unit ? ` ${l.unit}` : ''}`,
                  formatCurrency(l.unitPrice),
                  <span key="a" className="font-bold text-gold-dark">{formatCurrency(l.amount)}</span>,
                ])}
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
                title="Anciennes dettes" icon={<History size={14} />}
                total={formatCurrency(data.oldDebtsTotal)}
                note="Ardoises antérieures au logiciel — aucune écriture de caisse à leur saisie."
                head={['Date', 'Description', 'Montant', 'Réglé', 'Reste']}
                empty="Aucune ancienne dette sur cette période"
                rows={data.oldDebtsList.map((d) => [
                  formatDate(d.date, language),
                  <span key="d" className="font-semibold">{d.description || '—'}</span>,
                  formatCurrency(d.amount),
                  <span key="p" className="text-pistachio">{formatCurrency(d.paidAmount)}</span>,
                  <span key="r" className={d.restAmount > 0 ? 'text-rose-deep font-bold' : 'text-pistachio'}>
                    {formatCurrency(d.restAmount)}
                  </span>,
                ])}
              />

              <ReportSection
                title="Excédents rendus au client" icon={<Undo2 size={14} />}
                total={formatCurrency(data.refunded)}
                note="Argent restitué au client parce qu'il avait versé plus que sa dette — sortie de caisse."
                head={['Date et heure', 'Reçu n°', 'Mode de règlement', 'Note', 'Montant rendu']}
                empty="Aucun excédent rendu sur cette période"
                rows={data.refundsList.map((r) => [
                  formatDateTime(r.refundedAt, language),
                  `EXC-${r.id.slice(0, 8).toUpperCase()}`,
                  paymentMethodLabel(r),
                  r.notes || '—',
                  <span key="a" className="font-bold text-caramel">− {formatCurrency(r.amount)}</span>,
                ])}
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

          {/* ================== TVA DU COMPTE RENDU IMPRIMÉ ==================
              Posée à chaque impression : « Non » imprime directement le compte
              rendu, « Oui » ouvre la saisie du taux (19 % par défaut) puis
              imprime le document avec la TVA ajoutée au total final. */}
          <Modal open={tvaAsk} onClose={() => setTvaAsk(false)} size="sm" title="TVA du compte rendu">
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center">
                <div className="h-14 w-14 rounded-full bg-gold/15 flex items-center justify-center mb-3">
                  <Percent size={28} className="text-gold-dark" />
                </div>
                <p className="text-sm font-bold text-text-primary">
                  Appliquer la TVA sur le total final ?
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Le compte rendu affiche d&rsquo;abord le total <b>hors taxes</b> ; la TVA choisie ici
                  s&rsquo;ajoute ensuite pour donner le <b>total T.T.C</b>.
                </p>
              </div>

              {/* Aperçu exact des totaux tels qu'ils seront imprimés */}
              <div className="grid grid-cols-3 gap-2">
                <TotalTile label="Total H.T" value={formatCurrency(printHT)} />
                <TotalTile
                  label={tvaOn ? `TVA ${tvaRate} %` : 'TVA (désactivée)'}
                  value={formatCurrency(tvaPreview.tvaAmount)}
                  muted={!tvaOn}
                />
                <TotalTile
                  label={tvaOn ? 'Total T.T.C' : 'Total imprimé'}
                  value={formatCurrency(tvaPreview.totalTTC)}
                />
              </div>

              {tvaOn && (
                <div className="border border-gold/25 rounded-2xl p-3.5 bg-vanilla/40 space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
                    Taux de TVA appliqué
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" step="any" min={0} max={100} autoFocus
                      value={tvaRate}
                      onChange={(e) => setTvaRate(Math.max(0, Number(e.target.value)))}
                      className="w-24 h-9 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-center text-sm tabular font-semibold text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold"
                    />
                    <span className="text-sm font-semibold text-text-secondary">%</span>
                    <span className="text-xs text-text-muted">
                      = {formatCurrency(tvaPreview.tvaAmount)}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-muted">
                    19 % par défaut — modifiez librement le taux avant d&rsquo;imprimer.
                  </p>
                </div>
              )}

              {!tvaOn ? (
                <div className="flex gap-2">
                  <Button
                    variant="secondary" className="flex-1 text-xs"
                    onClick={() => { setTvaAsk(false); doPrint(false, 0); }}
                  >
                    <Printer size={15} /> Non, sans TVA
                  </Button>
                  <Button variant="gold" className="flex-1 text-xs font-bold" onClick={() => setTvaOn(true)}>
                    <Percent size={15} /> Oui, appliquer la TVA
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1 text-xs" onClick={() => setTvaOn(false)}>
                    Finalement sans TVA
                  </Button>
                  <Button
                    variant="gold" className="flex-1 text-xs font-bold"
                    onClick={() => { setTvaAsk(false); doPrint(true, tvaRate); }}
                  >
                    <Printer size={15} /> Imprimer avec TVA
                  </Button>
                </div>
              )}
            </div>
          </Modal>
        </div>
      )}
    </Modal>
  );
}

/** Tuile de total dans la fenêtre « TVA » : H.T, TVA et T.T.C avant impression. */
function TotalTile({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-xl border border-gold/20 bg-vanilla/50 px-2.5 py-2 text-center">
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular ${muted ? 'text-text-muted' : 'text-gold-dark'}`}>
        {value}
      </p>
    </div>
  );
}
