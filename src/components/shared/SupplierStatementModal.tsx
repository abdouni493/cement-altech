import { useEffect, useMemo, useState } from 'react';
import { FileBarChart, Printer, Receipt, Coins, RotateCcw, Package, Boxes } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PeriodPicker, ReportKpis, ReportSection, firstDayOfMonth, inPeriod } from './PeriodReport';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, formatDateTime, todayISO, paymentMethodLabel } from '@/lib/utils';
import { printDetailedReport, type PrintRow, type PrintTableSection } from '@/lib/reportPrint';
import type { Supplier } from '@/types';

/** Quantité affichée sans décimales inutiles (12 et non 12.0000). */
const qty = (n: number) => Number(n.toFixed(3)).toLocaleString('fr-FR');

/**
 * Compte rendu d'un fournisseur sur une période : factures d'achat, détail
 * des marchandises reçues, RÉCAPITULATIF DES QUANTITÉS PAR PRODUIT et
 * versements effectués — affiché à l'écran puis imprimable sur le modèle
 * professionnel de l'entreprise.
 */
export function SupplierStatementModal({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const { language } = useLanguage();
  const purchases = usePurchaseStore((s) => s.purchases);
  const payments = useSupplierStore((s) => s.payments);
  const settings = useSettingsStore((s) => s.settings);

  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);

  // Un compte rendu appartient à UN fournisseur : à l'ouverture d'une autre
  // fiche on repart d'une période vierge, sinon l'écran affiche encore le
  // rapport généré pour le fournisseur précédent.
  useEffect(() => {
    if (!supplier) return;
    setFrom(firstDayOfMonth());
    setTo(todayISO());
    setPeriod(null);
  }, [supplier?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => {
    if (!supplier || !period) return null;
    const { from: f, to: t } = period;

    const purchasesList = purchases
      .filter((p) => p.supplierId === supplier.id && inPeriod(p.date, f, t))
      .sort((a, b) => a.date.localeCompare(b.date));

    const paymentsList = payments
      .filter((p) => p.partyId === supplier.id && inPeriod(p.paidAt, f, t))
      .sort((a, b) => a.paidAt.localeCompare(b.paidAt));

    const total = purchasesList.reduce((s, x) => s + x.totalAmount, 0);
    const paid = purchasesList.reduce((s, x) => s + x.paidAmount, 0);
    const rest = purchasesList.reduce((s, x) => s + x.restAmount, 0);
    const settled = paymentsList.reduce((s, x) => s + x.amount, 0);
    const lines = purchasesList.reduce((s, x) => s + x.products.length, 0);

    // ---- Récapitulatif : quantité reçue de CHAQUE produit sur la période ----
    const byProduct = new Map<
      string,
      { name: string; unit?: string; quantity: number; amount: number; invoices: Set<string> }
    >();
    purchasesList.forEach((p) =>
      p.products.forEach((l) => {
        const name = (l.productName || '—').trim();
        const key = `${name.toLowerCase()}|${l.unit ?? ''}`;
        const cur = byProduct.get(key) ?? {
          name, unit: l.unit, quantity: 0, amount: 0, invoices: new Set<string>(),
        };
        cur.quantity += l.quantity;
        cur.amount += l.quantity * l.purchasePrice;
        cur.invoices.add(p.reference);
        byProduct.set(key, cur);
      })
    );
    const products = [...byProduct.values()]
      .map((x) => ({
        ...x,
        invoiceCount: x.invoices.size,
        avgPrice: x.quantity > 0 ? x.amount / x.quantity : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const productsQty = products.reduce((s, x) => s + x.quantity, 0);
    const productsAmount = products.reduce((s, x) => s + x.amount, 0);

    return {
      purchasesList, paymentsList, products,
      total, paid, rest, settled, lines, productsQty, productsAmount,
    };
  }, [supplier, period, purchases, payments]);

  const periodLabel = period
    ? `Du ${formatDate(period.from, language)} au ${formatDate(period.to, language)}`
    : '';

  const doPrint = () => {
    if (!supplier || !data || !period) return;

    const purchasesSection: PrintTableSection = {
      title: 'Factures d’achat de la période',
      icon: '🧾',
      headerTotal: formatCurrency(data.total),
      cols: [
        { label: 'N° facture' }, { label: 'Date' }, { label: 'Bon n°' }, { label: 'Matricule' },
        { label: 'Total', align: 'right' }, { label: 'Payé', align: 'right' }, { label: 'Reste', align: 'right' },
      ],
      rows: [
        ...data.purchasesList.map<PrintRow>((p) => ({
          cells: [
            `${p.reference}${p.isHistorical ? ' (ancien achat)' : ''}`,
            formatDate(p.date, language), p.bonNumber || '—', p.driverPlate || '—',
            formatCurrency(p.totalAmount), formatCurrency(p.paidAmount), formatCurrency(p.restAmount),
          ],
          tone: p.restAmount > 0 ? 'neg' : 'pos',
        })),
        ...(data.purchasesList.length
          ? [{
              cells: ['TOTAL ACHATS', '', '', '', formatCurrency(data.total),
                formatCurrency(data.paid), formatCurrency(data.rest)],
              variant: 'total' as const,
            }]
          : []),
      ],
      emptyLabel: 'Aucune facture sur la période',
    };

    const detailSection: PrintTableSection = {
      title: 'Détail des marchandises reçues',
      icon: '📦',
      headerTotal: formatCurrency(data.total),
      cols: [
        { label: 'Facture / Produit' }, { label: 'Quantité', align: 'right' },
        { label: 'Prix d’achat', align: 'right' }, { label: 'Montant', align: 'right' },
      ],
      rows: data.purchasesList.flatMap<PrintRow>((p) => [
        {
          cells: [
            `${p.reference} — ${formatDate(p.date, language)}${p.bonNumber ? ` · Bon ${p.bonNumber}` : ''}`,
            formatCurrency(p.totalAmount),
          ],
          variant: 'category', span: true, tone: 'accent',
        },
        ...p.products.map<PrintRow>((l) => ({
          cells: [
            l.productName || '—',
            `${qty(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`,
            formatCurrency(l.purchasePrice),
            formatCurrency(l.quantity * l.purchasePrice),
          ],
          variant: 'detail',
        })),
      ]),
      emptyLabel: 'Aucune marchandise reçue sur la période',
    };

    // Le récapitulatif attendu : COMBIEN de chaque produit sur la période.
    const quantitiesSection: PrintTableSection = {
      title: 'Quantités reçues par produit',
      icon: '🏗️',
      note: 'Cumul de toutes les factures de la période, produit par produit.',
      headerTotal: formatCurrency(data.productsAmount),
      cols: [
        { label: 'Produit' }, { label: 'Quantité totale', align: 'right' },
        { label: 'Unité', align: 'center' }, { label: 'Factures', align: 'right' },
        { label: 'Prix moyen', align: 'right' }, { label: 'Montant', align: 'right' },
      ],
      rows: [
        ...data.products.map<PrintRow>((x) => ({
          cells: [
            x.name,
            qty(x.quantity),
            x.unit || '—',
            String(x.invoiceCount),
            formatCurrency(x.avgPrice),
            formatCurrency(x.amount),
          ],
          tone: 'accent',
        })),
        ...(data.products.length
          ? [{
              cells: [
                'TOTAL', qty(data.productsQty), '', String(data.purchasesList.length), '',
                formatCurrency(data.productsAmount),
              ],
              variant: 'total' as const,
            }]
          : []),
      ],
      emptyLabel: 'Aucun produit reçu sur la période',
    };

    const paymentsSection: PrintTableSection = {
      title: 'Versements effectués au fournisseur',
      icon: '💰',
      headerTotal: formatCurrency(data.settled),
      cols: [
        { label: 'Date et heure' }, { label: 'Reçu n°' }, { label: 'Mode de règlement' },
        { label: 'Note' }, { label: 'Montant', align: 'right' },
      ],
      rows: [
        ...data.paymentsList.map<PrintRow>((p) => ({
          cells: [
            formatDateTime(p.paidAt, language),
            `RGF-${p.id.slice(0, 8).toUpperCase()}`,
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
      emptyLabel: 'Aucun versement sur la période',
    };

    printDetailedReport(
      {
        docTitle: `Compte rendu ${supplier.name}`,
        headTitle: 'COMPTE RENDU FOURNISSEUR',
        subtitle: periodLabel,
        meta: [
          { label: 'Fournisseur', value: supplier.name },
          { label: 'Téléphone', value: supplier.phone || '—' },
          { label: 'Adresse', value: supplier.address || '—' },
          { label: 'Période', value: periodLabel },
        ],
        kpis: [
          { label: 'Total acheté', value: formatCurrency(data.total), tone: 'accent' },
          { label: 'Payé sur factures', value: formatCurrency(data.paid), tone: 'pos' },
          { label: 'Reste dû (période)', value: formatCurrency(data.rest), tone: 'neg' },
          { label: 'Versements effectués', value: formatCurrency(data.settled), tone: 'pos' },
        ],
        sections: [purchasesSection, detailSection, quantitiesSection, paymentsSection],
      },
      settings,
      language
    );
  };

  return (
    <Modal open={!!supplier} onClose={onClose} title={`Compte rendu — ${supplier?.name ?? ''}`} size="lg">
      {supplier && (
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
                  <p className="font-display text-base font-semibold text-text-primary">{supplier.name}</p>
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
                  { label: 'Total acheté', value: formatCurrency(data.total), color: 'text-gold-dark' },
                  { label: 'Payé sur factures', value: formatCurrency(data.paid), color: 'text-pistachio' },
                  { label: 'Reste dû', value: formatCurrency(data.rest), color: 'text-rose-deep' },
                  { label: 'Versements effectués', value: formatCurrency(data.settled), color: 'text-pistachio' },
                  { label: 'Factures', value: String(data.purchasesList.length) },
                  { label: 'Lignes reçues', value: String(data.lines) },
                  { label: 'Produits distincts', value: String(data.products.length) },
                  { label: 'Quantité totale reçue', value: qty(data.productsQty), color: 'text-gold-dark' },
                ]}
              />

              <ReportSection
                title="Factures d'achat" icon={<Receipt size={14} />}
                total={formatCurrency(data.total)}
                head={['N° facture', 'Date', 'Bon n°', 'Matricule', 'Total', 'Payé', 'Reste']}
                empty="Aucune facture sur cette période"
                rows={data.purchasesList.map((p) => [
                  <span key="r" className="font-semibold">
                    {p.reference}
                    {p.isHistorical && (
                      <span className="ml-1.5 text-[10px] font-medium text-gold-dark">(ancien achat)</span>
                    )}
                  </span>,
                  formatDate(p.date, language),
                  p.bonNumber || '—',
                  p.driverPlate || '—',
                  formatCurrency(p.totalAmount),
                  <span key="p" className="text-pistachio">{formatCurrency(p.paidAmount)}</span>,
                  <span key="x" className={p.restAmount > 0 ? 'text-rose-deep font-bold' : 'text-pistachio'}>
                    {formatCurrency(p.restAmount)}
                  </span>,
                ])}
              />

              <ReportSection
                title="Quantités reçues par produit" icon={<Boxes size={14} />}
                total={formatCurrency(data.productsAmount)}
                note="Cumul de toutes les factures de la période, produit par produit."
                head={['Produit', 'Quantité totale', 'Unité', 'Factures', 'Prix moyen', 'Montant']}
                empty="Aucun produit reçu sur cette période"
                rows={data.products.map((x) => [
                  <span key="n" className="font-semibold">{x.name}</span>,
                  <span key="q" className="font-bold text-gold-dark">{qty(x.quantity)}</span>,
                  x.unit || '—',
                  String(x.invoiceCount),
                  formatCurrency(x.avgPrice),
                  formatCurrency(x.amount),
                ])}
              />

              <ReportSection
                title="Marchandises reçues" icon={<Package size={14} />}
                head={['Facture · Produit', 'Quantité', "Prix d'achat", 'Montant']}
                empty="Aucune marchandise reçue sur cette période"
                rows={data.purchasesList.flatMap((p) =>
                  p.products.map((l) => [
                    <span key="n">
                      <span className="text-text-muted">{p.reference}</span> · {l.productName}
                    </span>,
                    `${qty(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`,
                    formatCurrency(l.purchasePrice),
                    formatCurrency(l.quantity * l.purchasePrice),
                  ])
                )}
              />

              <ReportSection
                title="Versements effectués" icon={<Coins size={14} />}
                total={formatCurrency(data.settled)}
                head={['Date et heure', 'Reçu n°', 'Mode de règlement', 'Note', 'Montant']}
                empty="Aucun versement sur cette période"
                rows={data.paymentsList.map((p) => [
                  formatDateTime(p.paidAt, language),
                  `RGF-${p.id.slice(0, 8).toUpperCase()}`,
                  paymentMethodLabel(p),
                  p.notes || '—',
                  <span key="a" className="font-bold text-pistachio">{formatCurrency(p.amount)}</span>,
                ])}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
