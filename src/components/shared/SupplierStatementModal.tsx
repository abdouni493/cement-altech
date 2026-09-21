import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FileBarChart, Printer, Coins, RotateCcw, Package, History, Undo2, PiggyBank,
  LayoutGrid,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PeriodPicker, firstDayOfMonth } from './PeriodReport';
import { StatementPrintDialog, type StatementPrintChoice } from './StatementPrintDialog';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, formatDateTime, todayISO, paymentMethodLabel } from '@/lib/utils';
import { computePartyBalance } from '@/lib/partyBalance';
import { buildSupplierHistory, withinPeriod, type HistoryPayment } from '@/lib/partyHistory';
import { printPartyStatement, type StatementSection } from '@/lib/statementPrint';
import { panelVariants, EASE } from '@/lib/animations';
import { cn } from '@/lib/utils';
import type { Supplier } from '@/types';

/* ============================================================================
 *  COMPTE RENDU D'UN FOURNISSEUR SUR UNE PERIODE
 * ----------------------------------------------------------------------------
 *  Meme presentation et meme mecanique d'impression que le compte rendu du
 *  client : barre de synthese, une PARTIE a la fois (achats, versements,
 *  anciens achats, anciennes dettes, excedents recuperes, produits), puis une
 *  LISTE A COCHER avant d'imprimer — quelles parties, quels produits, avec ou
 *  sans TVA — et un document rendu sur le modele du bon de livraison.
 * ========================================================================== */

type PartKey = 'purchases' | 'payments' | 'oldPurchases' | 'oldDebts' | 'refunds' | 'products';

const qty = (n: number) => Number(n.toFixed(3)).toLocaleString('fr-FR');

export function SupplierStatementModal({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const { language } = useLanguage();
  const purchases = usePurchaseStore((s) => s.purchases);
  const payments = useSupplierStore((s) => s.payments);
  const supplierRows = useSupplierStore((s) => s.suppliers);
  const oldDebts = useSupplierStore((s) => s.oldDebts);
  const refunds = useSupplierStore((s) => s.refunds);
  const settings = useSettingsStore((s) => s.settings);

  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [part, setPart] = useState<PartKey>('purchases');
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    if (!supplier) return;
    setFrom(firstDayOfMonth());
    setTo(todayISO());
    setPeriod(null);
    setPart('purchases');
    setPrintOpen(false);
  }, [supplier?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => {
    if (!supplier || !period) return null;
    const { from: f, to: t } = period;
    const h = buildSupplierHistory({ supplierId: supplier.id, purchases, payments, oldDebts, refunds });
    const inP = (d?: string) => withinPeriod(d, f, t);

    const purchasesList = h.purchases.filter((p) => inP(p.date)).sort((a, b) => a.date.localeCompare(b.date));
    const oldPurchasesList = h.historicalPurchases.filter((p) => inP(p.date));
    const paymentsList = h.payments.filter((p) => inP(p.date)).sort((a, b) => a.date.localeCompare(b.date));
    const oldDebtsList = h.oldDebts.filter((d) => inP(d.date));
    const refundsList = h.refunds.filter((r) => inP(r.refundedAt));

    // Une ligne par produit ET par prix d'achat pratique sur la periode.
    const grouped = new Map<string, {
      key: string; name: string; unit?: string; quantity: number; unitPrice: number;
      amount: number; invoices: Set<string>;
    }>();
    [...purchasesList, ...oldPurchasesList].forEach((p) =>
      p.products.forEach((l) => {
        if (!(l.quantity > 0)) return;
        const name = (l.productName || '—').trim();
        const key = `${name.toLowerCase()}|${l.unit ?? ''}|${l.purchasePrice}`;
        const cur = grouped.get(key) ?? {
          key, name, unit: l.unit, quantity: 0, unitPrice: l.purchasePrice, amount: 0,
          invoices: new Set<string>(),
        };
        cur.quantity += l.quantity;
        cur.amount += l.quantity * l.purchasePrice;
        cur.invoices.add(p.reference);
        grouped.set(key, cur);
      })
    );
    const products = [...grouped.values()].sort((a, b) => b.amount - a.amount);

    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    const total = sum(purchasesList.map((x) => x.totalAmount));
    const paid = sum(purchasesList.map((x) => x.paidAmount));
    const rest = sum(purchasesList.map((x) => x.restAmount));
    const settled = sum(paymentsList.map((x) => x.amount));
    const oldDebtsTotal = sum(oldDebtsList.map((x) => x.amount));
    const oldDebtsRest = sum(oldDebtsList.map((x) => x.restAmount));
    const refunded = sum(refundsList.map((x) => x.amount));

    const allPurchases = purchases.filter((x) => x.supplierId === supplier.id);
    const account = computePartyBalance({
      documentsBilled: sum(allPurchases.map((x) => x.totalAmount)),
      documentsPaid: sum(allPurchases.map((x) => x.paidAmount)),
      documentsRest: sum(allPurchases.map((x) => x.restAmount)),
      oldDebts: oldDebts.filter((d) => d.partyId === supplier.id),
      credit: supplierRows.find((x) => x.id === supplier.id)?.creditAmount ?? 0,
    });

    return {
      purchasesList, oldPurchasesList, paymentsList, oldDebtsList, refundsList, products,
      total, paid, rest, settled, refunded, oldDebtsTotal, oldDebtsRest, account,
      oldPurchasesTotal: sum(oldPurchasesList.map((x) => x.totalAmount)),
      productsQty: sum(products.map((x) => x.quantity)),
      productsAmount: sum(products.map((x) => x.amount)),
      billed: total + oldDebtsTotal,
      outstanding: rest + oldDebtsRest,
      lines: sum(purchasesList.map((x) => x.products.length)),
    };
  }, [supplier, period, purchases, payments, oldDebts, refunds, supplierRows]);

  const periodLabel = period
    ? `Du ${formatDate(period.from, language)} au ${formatDate(period.to, language)}`
    : '';

  const doPrint = (choice: StatementPrintChoice) => {
    if (!supplier || !data || !period) return;
    setPrintOpen(false);

    const money = formatCurrency;
    const picked = new Set(choice.parts);
    const sections: StatementSection[] = [];

    if (picked.has('purchases') && data.purchasesList.length) {
      sections.push({
        title: 'ACHATS DE LA PERIODE',
        columns: [
          { label: 'Date', align: 'center', width: '13%' },
          { label: 'Designation', align: 'left' },
          { label: 'Articles', align: 'center', width: '10%' },
          { label: 'Regle', align: 'right', width: '18%' },
          { label: 'Total', align: 'right', width: '18%' },
        ],
        rows: data.purchasesList.map((p) => ({
          cells: [
            formatDate(p.date), `FACTURE ${p.reference}`, p.products.length,
            money(p.paidAmount), money(p.totalAmount),
          ],
        })),
        totals: [{ label: 'Total des achats', value: money(data.total), strong: true }],
      });
    }

    if (picked.has('payments') && data.paymentsList.length) {
      sections.push({
        title: 'VERSEMENTS DE LA PERIODE',
        columns: [
          { label: 'Date', align: 'center', width: '16%' },
          { label: 'Designation', align: 'left' },
          { label: 'Mode', align: 'left', width: '22%' },
          { label: 'Montant', align: 'right', width: '20%' },
        ],
        rows: data.paymentsList.map((p) => ({
          cells: [
            formatDate(p.date.slice(0, 10)), p.origin.toUpperCase(),
            p.source === 'direct' ? paymentMethodLabel(p).toUpperCase() : '/',
            money(p.amount),
          ],
        })),
        totals: [{
          label: 'Total regle',
          value: money(data.paymentsList.reduce((s, p) => s + p.amount, 0)),
          strong: true,
        }],
      });
    }

    if (picked.has('oldPurchases') && data.oldPurchasesList.length) {
      sections.push({
        title: 'ANCIENS ACHATS',
        columns: [
          { label: 'Date', align: 'center', width: '13%' },
          { label: 'Designation', align: 'left' },
          { label: 'Articles', align: 'center', width: '10%' },
          { label: 'Regle', align: 'right', width: '18%' },
          { label: 'Total', align: 'right', width: '18%' },
        ],
        rows: data.oldPurchasesList.map((p) => ({
          cells: [
            formatDate(p.date), `ANCIEN ACHAT ${p.reference}`, p.products.length,
            money(p.paidAmount), money(p.totalAmount),
          ],
        })),
        totals: [{ label: 'Total', value: money(data.oldPurchasesTotal), strong: true }],
      });
    }

    if (picked.has('oldDebts') && data.oldDebtsList.length) {
      sections.push({
        title: 'ANCIENNES DETTES',
        columns: [
          { label: 'Date', align: 'center', width: '16%' },
          { label: 'Designation', align: 'left' },
          { label: 'Regle', align: 'right', width: '20%' },
          { label: 'Reste', align: 'right', width: '20%' },
        ],
        rows: data.oldDebtsList.map((d) => ({
          cells: [
            formatDate(d.date), (d.description || 'ANCIENNE DETTE').toUpperCase(),
            money(d.paidAmount), money(d.restAmount),
          ],
        })),
        totals: [{ label: 'Total reste du', value: money(data.oldDebtsRest), strong: true }],
      });
    }

    if (picked.has('refunds') && data.refundsList.length) {
      sections.push({
        title: 'EXCEDENTS RECUPERES',
        columns: [
          { label: 'Date', align: 'center', width: '16%' },
          { label: 'Designation', align: 'left' },
          { label: 'Mode', align: 'left', width: '22%' },
          { label: 'Montant', align: 'right', width: '20%' },
        ],
        rows: data.refundsList.map((r) => ({
          cells: [
            formatDate(r.refundedAt.slice(0, 10)),
            `RECUPERATION EXC-${r.id.slice(0, 8).toUpperCase()}`,
            paymentMethodLabel(r).toUpperCase(), money(r.amount),
          ],
        })),
        totals: [{ label: 'Total recupere', value: money(data.refunded), strong: true }],
      });
    }

    const productLines = choice.includeProducts
      ? data.products
          .filter((p) => choice.products.includes(p.key))
          .map((p) => ({
            designation: p.name, quantity: p.quantity, unit: p.unit,
            unitPrice: p.unitPrice, amount: p.amount,
          }))
      : [];

    const ht = productLines.reduce((s, l) => s + l.amount, 0);
    const tva = choice.applyTva ? Math.round(ht * choice.tvaRate) / 100 : 0;

    printPartyStatement(
      {
        kind: 'supplier',
        party: { name: supplier.name, phone: supplier.phone, address: supplier.address },
        from: period.from,
        to: period.to,
        productTitle: productLines.length ? 'MARCHANDISES RECUES SUR LA PERIODE' : undefined,
        productLines,
        sections,
        applyTva: choice.applyTva,
        tvaRate: choice.tvaRate,
        tvaAmount: tva,
        paidAmount: data.paymentsList.reduce((s, p) => s + p.amount, 0),
        restAmount: data.outstanding + tva,
        versements: data.paymentsList.map((p) => ({ amount: p.amount, date: p.date.slice(0, 10) })),
      },
      settings
    );
  };

  const parts: { key: PartKey; label: string; icon: JSX.Element; count: number; total?: string }[] = data
    ? [
        { key: 'purchases', label: 'Achats', icon: <Package size={14} />, count: data.purchasesList.length, total: formatCurrency(data.total) },
        { key: 'payments', label: 'Versements', icon: <Coins size={14} />, count: data.paymentsList.length, total: formatCurrency(data.paymentsList.reduce((s, p) => s + p.amount, 0)) },
        { key: 'oldPurchases', label: 'Anciens achats', icon: <History size={14} />, count: data.oldPurchasesList.length, total: formatCurrency(data.oldPurchasesTotal) },
        { key: 'oldDebts', label: 'Anciennes dettes', icon: <PiggyBank size={14} />, count: data.oldDebtsList.length, total: formatCurrency(data.oldDebtsTotal) },
        { key: 'refunds', label: 'Excédents récupérés', icon: <Undo2 size={14} />, count: data.refundsList.length, total: formatCurrency(data.refunded) },
        { key: 'products', label: 'Produits', icon: <Package size={14} />, count: data.products.length, total: formatCurrency(data.productsAmount) },
      ]
    : [];

  return (
    <Modal open={!!supplier} onClose={onClose} title={`Compte rendu — ${supplier?.name ?? ''}`} size="xl">
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
              <FileBarChart size={34} className="mx-auto mb-3 text-gold opacity-60" />
              <p className="text-sm text-text-muted">
                Choisissez une date de début et une date de fin, puis générez le compte rendu.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-display text-base font-semibold text-text-primary">{supplier.name}</p>
                  <p className="text-xs text-text-muted">{periodLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPeriod(null)}>
                    <RotateCcw size={14} /> Changer la période
                  </Button>
                  <Button size="sm" variant="gold" onClick={() => setPrintOpen(true)}>
                    <Printer size={14} /> Imprimer le compte rendu
                  </Button>
                </div>
              </div>

              {data.account.hasCredit && (
                <div className="flex items-start gap-3 rounded-2xl border border-pistachio/40 bg-pistachio/10 px-4 py-3">
                  <PiggyBank size={20} className="mt-0.5 shrink-0 text-pistachio" />
                  <div>
                    <p className="text-sm font-bold text-pistachio">
                      Trop-versé à récupérer : + {formatCurrency(data.account.creditToReturn)}
                    </p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      L&rsquo;entreprise a payé plus que ses factures. Utilisez « Récupérer l&rsquo;excédent » sur sa carte.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                <Kpi label="Total acheté" value={formatCurrency(data.billed)} tone="accent" />
                <Kpi label="Total réglé" value={formatCurrency(data.paid + data.settled)} tone="pos" />
                <Kpi label="Reste dû (période)" value={formatCurrency(data.outstanding)} tone="neg" />
                <Kpi label="Excédent récupéré" value={formatCurrency(data.refunded)} tone="pos" />
                <Kpi label="Articles reçus" value={String(data.lines)} />
                <Kpi label="Quantité reçue" value={qty(data.productsQty)} tone="accent" />
              </div>

              <div className="flex gap-1 overflow-x-auto rounded-2xl border border-gold/15 bg-vanilla/30 p-1.5">
                {parts.map((p) => {
                  const on = p.key === part;
                  return (
                    <button
                      key={p.key}
                      onClick={() => setPart(p.key)}
                      className={cn(
                        'relative flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-colors',
                        on ? 'text-white' : 'text-text-secondary hover:bg-gold/10 hover:text-text-primary'
                      )}
                    >
                      {on && (
                        <motion.span
                          layoutId="supplier-statement-part"
                          transition={{ duration: 0.18, ease: EASE }}
                          className="absolute inset-0 rounded-xl bg-gradient-button shadow-gold"
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-1.5">
                        {p.icon}{p.label}
                        <span className={cn(
                          'rounded-full px-1.5 text-[10px] font-bold tabular',
                          on ? 'bg-white/25 text-white' : 'bg-gold/15 text-gold-dark'
                        )}>
                          {p.count}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <AnimatePresence mode="wait">
                <motion.div key={part} variants={panelVariants} initial="hidden" animate="visible" exit="exit">
                  {part === 'purchases' && (
                    <Section
                      title="Achats de la période"
                      head={['N° facture', 'Date', 'N° BL', 'Articles', 'Total', 'Réglé', 'Reste']}
                      rows={data.purchasesList.map((p) => [
                        p.reference, formatDate(p.date, language), p.bonNumber || '—', p.products.length,
                        formatCurrency(p.totalAmount),
                        <span key="p" className="text-pistachio">{formatCurrency(p.paidAmount)}</span>,
                        <span key="r" className={p.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>
                          {formatCurrency(p.restAmount)}
                        </span>,
                      ])}
                      total={formatCurrency(data.total)}
                      empty="Aucune facture sur cette période"
                    />
                  )}

                  {part === 'payments' && (
                    <Section
                      title="Versements de la période"
                      note="Règlements saisis sur la carte du fournisseur ET règlements portés par une facture d'achat."
                      head={['Date et heure', 'Origine', 'Type', 'Mode de règlement', 'Note', 'Montant']}
                      rows={data.paymentsList.map((p: HistoryPayment) => [
                        formatDateTime(p.date, language),
                        p.origin,
                        <Badge key="t" variant={p.source === 'direct' ? 'success' : 'info'} className="text-[10px]">
                          {p.source === 'direct' ? 'Direct' : 'Facture'}
                        </Badge>,
                        p.source === 'direct' ? paymentMethodLabel(p) : '—',
                        p.notes || '—',
                        <span key="a" className="font-bold text-pistachio">{formatCurrency(p.amount)}</span>,
                      ])}
                      total={formatCurrency(data.paymentsList.reduce((s, p) => s + p.amount, 0))}
                      empty="Aucun règlement sur cette période"
                    />
                  )}

                  {part === 'oldPurchases' && (
                    <Section
                      title="Anciens achats"
                      note="Factures antérieures au logiciel — ni le stock ni la caisse ne les ont vues passer."
                      head={['N° facture', 'Date', 'Articles', 'Total', 'Réglé', 'Reste']}
                      rows={data.oldPurchasesList.map((p) => [
                        p.reference, formatDate(p.date, language), p.products.length,
                        formatCurrency(p.totalAmount),
                        <span key="p" className="text-pistachio">{formatCurrency(p.paidAmount)}</span>,
                        <span key="r" className="text-rose-deep">{formatCurrency(p.restAmount)}</span>,
                      ])}
                      total={formatCurrency(data.oldPurchasesTotal)}
                      empty="Aucun ancien achat sur cette période"
                    />
                  )}

                  {part === 'oldDebts' && (
                    <Section
                      title="Anciennes dettes"
                      head={['Date', 'Description', 'Montant', 'Réglé', 'Reste']}
                      rows={data.oldDebtsList.map((d) => [
                        formatDate(d.date, language), d.description || '—',
                        formatCurrency(d.amount),
                        <span key="p" className="text-pistachio">{formatCurrency(d.paidAmount)}</span>,
                        <span key="r" className={d.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>
                          {formatCurrency(d.restAmount)}
                        </span>,
                      ])}
                      total={formatCurrency(data.oldDebtsTotal)}
                      empty="Aucune ancienne dette sur cette période"
                    />
                  )}

                  {part === 'refunds' && (
                    <Section
                      title="Excédents récupérés"
                      head={['Date et heure', 'Reçu n°', 'Mode', 'Note', 'Montant']}
                      rows={data.refundsList.map((r) => [
                        formatDateTime(r.refundedAt, language),
                        `EXC-${r.id.slice(0, 8).toUpperCase()}`,
                        paymentMethodLabel(r), r.notes || '—',
                        <span key="a" className="font-bold text-pistachio">+ {formatCurrency(r.amount)}</span>,
                      ])}
                      total={formatCurrency(data.refunded)}
                      empty="Aucun trop-versé récupéré sur cette période"
                    />
                  )}

                  {part === 'products' && (
                    <Section
                      title="Marchandises reçues"
                      note="Une ligne par produit ET par prix d'achat — c'est la base du tableau imprimé."
                      head={['Produit', 'Factures', 'Quantité', 'Prix unitaire', 'Montant']}
                      rows={data.products.map((p) => [
                        p.name, p.invoices.size,
                        `${qty(p.quantity)}${p.unit ? ` ${p.unit}` : ''}`,
                        formatCurrency(p.unitPrice),
                        <span key="a" className="font-bold text-gold-dark">{formatCurrency(p.amount)}</span>,
                      ])}
                      total={formatCurrency(data.productsAmount)}
                      empty="Aucune marchandise reçue sur cette période"
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          )}

          {data && (
            <StatementPrintDialog
              open={printOpen}
              onClose={() => setPrintOpen(false)}
              onPrint={doPrint}
              title={`Imprimer le compte rendu — ${supplier.name}`}
              parts={parts
                .filter((p) => p.key !== 'products')
                .map((p) => ({
                  key: p.key, label: p.label, count: p.count, total: p.total,
                  defaultChecked: p.count > 0,
                }))}
              products={data.products.map((p) => ({
                key: p.key,
                label: p.name,
                detail: `${qty(p.quantity)}${p.unit ? ` ${p.unit}` : ''} × ${formatCurrency(p.unitPrice)}`,
                amount: p.amount,
              }))}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' | 'accent' }) {
  const color = tone === 'pos' ? 'text-pistachio' : tone === 'neg' ? 'text-rose-deep'
    : tone === 'accent' ? 'text-gold-dark' : 'text-text-primary';
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2.5">
      <p className="text-[10px] uppercase leading-tight tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular ${color}`}>{value}</p>
    </div>
  );
}

function Section({
  title, note, head, rows, total, empty,
}: {
  title: string;
  note?: string;
  head: string[];
  rows: React.ReactNode[][];
  total?: string;
  empty: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-xl border-l-4 border-gold bg-gold/8 px-3 py-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-gold-dark">
          <LayoutGrid size={14} />{title}
        </h4>
        {total && <span className="text-sm font-bold tabular text-gold-dark">{total}</span>}
      </div>
      {note && <p className="px-1 text-[11px] italic text-text-muted">{note}</p>}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gold/25 bg-vanilla/20 py-6 text-center text-xs italic text-text-muted">
          {empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gold/15">
          <table className="w-full text-sm">
            <thead className="bg-vanilla/60 text-text-secondary">
              <tr>
                {head.map((h, i) => (
                  <th key={h} className={`whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase ${i === 0 ? 'text-left' : 'text-right'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gold/10 hover:bg-gold/5">
                  {r.map((cell, j) => (
                    <td key={j} className={`px-3 py-2 text-xs ${j === 0 ? 'text-left' : 'text-right tabular'}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
