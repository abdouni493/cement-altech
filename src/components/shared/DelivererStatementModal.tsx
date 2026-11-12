import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FileBarChart, Printer, Coins, RotateCcw, Package, BookOpenText,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PeriodPicker, firstDayOfMonth } from './PeriodReport';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useDelivererStore } from '@/store/delivererStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, paymentMethodLabel, todayISO } from '@/lib/utils';
import { printListDocument, totalDocRow, type StatementSection } from '@/lib/statementPrint';
import { panelVariants, EASE } from '@/lib/animations';
import { cn } from '@/lib/utils';
import type { Deliverer } from '@/types';

/* ============================================================================
 *  COMPTE RENDU D'UN LIVREUR SUR UNE PERIODE
 * ----------------------------------------------------------------------------
 *  Même principe que le compte rendu du fournisseur, à partir des livraisons
 *  affectées au livreur (coût de transport par achat) et des règlements qui lui
 *  ont été versés :
 *   · livraisons de la période (coût, payé, reste), de la plus ancienne à la
 *     plus récente ;
 *   · règlements directs listés à part ;
 *   · dette antérieure, total livraisons, total payé et reste justes ;
 *   · impression sur le même papier officiel que les documents fournisseurs.
 * ========================================================================== */

type PartKey = 'releve' | 'deliveries' | 'payments';

const d10 = (s?: string) => (s || '').slice(0, 10);

interface DeliveryRow {
  id: string;
  reference: string;
  date: string;
  bonNumber: string;
  driverPlate: string;
  cost: number;
  paid: number;
}

export function DelivererStatementModal({ deliverer, onClose }: { deliverer: Deliverer | null; onClose: () => void }) {
  const { language } = useLanguage();
  const purchases = usePurchaseStore((s) => s.purchases);
  const assignments = useDelivererStore((s) => s.assignments);
  const payments = useDelivererStore((s) => s.payments);
  const settings = useSettingsStore((s) => s.settings);

  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [part, setPart] = useState<PartKey>('releve');

  useEffect(() => {
    if (!deliverer) return;
    setFrom(firstDayOfMonth());
    setTo(todayISO());
    setPeriod(null);
    setPart('releve');
  }, [deliverer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Toutes les livraisons affectées à ce livreur (toutes dates). */
  const allDeliveries = useMemo<DeliveryRow[]>(() => {
    if (!deliverer) return [];
    return Object.entries(assignments)
      .filter(([, a]) => a.delivererId === deliverer.id)
      .map(([purchaseId, a]) => {
        const p = purchases.find((x) => x.id === purchaseId);
        return {
          id: purchaseId,
          reference: p?.reference ?? '—',
          date: d10(p?.date),
          bonNumber: p?.bonNumber ?? '',
          driverPlate: p?.driverPlate ?? '',
          cost: Number(a.cost) || 0,
          paid: Number(a.paid) || 0,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [deliverer, assignments, purchases]);

  const allPayments = useMemo(() => {
    if (!deliverer) return [];
    return payments
      .filter((p) => p.delivererId === deliverer.id)
      .map((p) => ({ ...p, day: d10(p.date || p.paidAt) }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [deliverer, payments]);

  const data = useMemo(() => {
    if (!deliverer || !period) return null;
    const { from: f, to: t } = period;
    const inRange = (dd: string) => dd >= f && dd <= t;
    const before = (dd: string) => dd < f;

    const deliveries = allDeliveries.filter((d) => inRange(d.date));
    const pays = allPayments.filter((p) => inRange(p.day));

    // Dette antérieure = coûts avant la période − déjà payé avant la période.
    const priorCost = allDeliveries.filter((d) => before(d.date)).reduce((s, d) => s + d.cost, 0);
    const priorPaidAtPurchase = allDeliveries.filter((d) => before(d.date)).reduce((s, d) => s + d.paid, 0);
    const priorDirect = allPayments.filter((p) => before(p.day)).reduce((s, p) => s + p.amount, 0);
    const priorBalance = priorCost - priorPaidAtPurchase - priorDirect;

    const periodCost = deliveries.reduce((s, d) => s + d.cost, 0);
    const paidAtPurchase = deliveries.reduce((s, d) => s + d.paid, 0);
    const directPaid = pays.reduce((s, p) => s + p.amount, 0);
    const periodPaid = paidAtPurchase + directPaid;
    const closingBalance = priorBalance + periodCost - periodPaid;

    // Relevé : une ligne « débit » par livraison, une ligne « crédit » par
    // montant payé (à l'achat ou règlement direct), triées par date.
    type Row = { date: string; label: string; detail: string; debit: number; credit: number };
    const events: Row[] = [];
    deliveries.forEach((d) => {
      events.push({ date: d.date, label: `Livraison ${d.reference}`, detail: d.bonNumber ? `Bon ${d.bonNumber}` : '—', debit: d.cost, credit: 0 });
      if (d.paid > 0) events.push({ date: d.date, label: `Payé à l'achat ${d.reference}`, detail: '—', debit: 0, credit: d.paid });
    });
    pays.forEach((p) => {
      events.push({ date: p.day, label: 'Règlement direct', detail: paymentMethodLabel(p), debit: 0, credit: p.amount });
    });
    events.sort((a, b) => a.date.localeCompare(b.date));
    let bal = priorBalance;
    const rows = events.map((e) => { bal += e.debit - e.credit; return { ...e, balance: bal }; });

    return {
      deliveries, pays, rows,
      priorBalance, periodCost, periodPaid, directPaid, paidAtPurchase, closingBalance,
    };
  }, [deliverer, period, allDeliveries, allPayments]);

  const periodLabel = period
    ? `Du ${formatDate(period.from, language)} au ${formatDate(period.to, language)}`
    : '';

  const money = formatCurrency;

  /* ------------------------------------------------------- l'impression -- */
  const handlePrint = () => {
    if (!deliverer || !data || !period) return;
    const tables: StatementSection[] = [];

    // 1 — Livraisons de la période
    tables.push({
      title: 'Livraisons de la période',
      columns: [
        { label: 'Date', align: 'center', width: '12%' },
        { label: 'N° achat', align: 'center', width: '14%' },
        { label: 'N° bon', align: 'center', width: '12%' },
        { label: 'Matricule', align: 'center', width: '13%' },
        { label: 'Coût', align: 'right', width: '15%' },
        { label: 'Payé', align: 'right', width: '15%' },
        { label: 'Reste', align: 'right', width: '15%' },
      ],
      rows: data.deliveries.map((d) => ({
        cells: [
          formatDate(d.date, language),
          d.reference,
          d.bonNumber || '/',
          (d.driverPlate || '/').toUpperCase(),
          money(d.cost),
          money(d.paid),
          money(Math.max(0, d.cost - d.paid)),
        ],
      })),
      emptyLabel: 'Aucune livraison sur la période',
      totals: [
        { label: 'Total coûts', value: money(data.periodCost) },
        { label: 'Payé à la livraison', value: money(data.paidAtPurchase) },
      ],
    });

    // 2 — Règlements directs
    tables.push({
      title: 'Règlements versés au livreur',
      columns: [
        { label: 'Date', align: 'center', width: '16%' },
        { label: 'Mode', align: 'center', width: '22%' },
        { label: 'Note', align: 'left' },
        { label: 'Montant', align: 'right', width: '18%' },
      ],
      rows: data.pays.map((p) => ({
        cells: [formatDate(p.day, language), paymentMethodLabel(p), p.notes || '—', money(p.amount)],
      })),
      emptyLabel: 'Aucun règlement direct sur la période',
      totals: [{ label: 'Total règlements directs', value: money(data.directPaid) }],
    });

    // 3 — Récapitulatif
    tables.push({
      columns: [
        { label: 'Récapitulatif', align: 'left' },
        { label: '', align: 'right', width: '30%' },
      ],
      rows: [
        totalDocRow(`Dette antérieure au ${formatDate(period.from, language)}`, money(data.priorBalance)),
        totalDocRow('Total livraisons (période)', money(data.periodCost)),
        totalDocRow('Total payé (période)', money(data.periodPaid)),
        totalDocRow('Reste de la période', money(Math.max(0, data.periodCost - data.periodPaid))),
      ],
      totals: [{ label: 'Solde dû au livreur', value: money(Math.max(0, data.closingBalance)), strong: true }],
    });

    printListDocument(
      {
        title: 'Compte rendu livreur',
        docDate: todayISO(),
        partyLabel: 'LIVREUR',
        partyName: deliverer.name,
        partyLines: [deliverer.phone, deliverer.address].filter(Boolean) as string[],
        metaLines: [periodLabel],
        tables,
        signatures: ['Le livreur', 'Signature'],
        fileName: `Compte_Rendu_Livreur_${deliverer.name.replace(/\s+/g, '_')}`,
      },
      settings
    );
  };

  const parts: { key: PartKey; label: string; icon: JSX.Element; count: number }[] = data
    ? [
        { key: 'releve', label: 'Relevé', icon: <BookOpenText size={14} />, count: data.rows.length },
        { key: 'deliveries', label: 'Livraisons', icon: <Package size={14} />, count: data.deliveries.length },
        { key: 'payments', label: 'Règlements', icon: <Coins size={14} />, count: data.pays.length },
      ]
    : [];

  return (
    <Modal open={!!deliverer} onClose={onClose} title={`Compte rendu — ${deliverer?.name ?? ''}`} size="xl">
      {deliverer && (
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
                  <p className="font-display text-base font-semibold text-text-primary">{deliverer.name}</p>
                  <p className="text-xs text-text-muted">{periodLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPeriod(null)}>
                    <RotateCcw size={14} /> Changer la période
                  </Button>
                  <Button size="sm" variant="gold" onClick={handlePrint}>
                    <Printer size={14} /> Imprimer le compte rendu
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                <Kpi
                  label={`Dette antérieure au ${formatDate(period!.from, language)}`}
                  value={money(data.priorBalance)}
                  tone={data.priorBalance > 0 ? 'neg' : 'pos'}
                />
                <Kpi label="Livraisons (période)" value={money(data.periodCost)} tone="accent" />
                <Kpi label="Payé (période)" value={money(data.periodPaid)} tone="pos" />
                <Kpi
                  label="Reste (période)"
                  value={money(Math.max(0, data.periodCost - data.periodPaid))}
                  tone={data.periodCost - data.periodPaid > 0 ? 'neg' : 'pos'}
                />
                <Kpi
                  label={`Solde au ${formatDate(period!.to, language)}`}
                  value={money(Math.max(0, data.closingBalance))}
                  tone={data.closingBalance > 0 ? 'neg' : 'pos'}
                />
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
                          layoutId="deliverer-statement-part"
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
                  {part === 'releve' && (
                    <Section
                      title="Relevé du compte (de la plus ancienne à la plus récente opération)"
                      note="Chaque livraison augmente ce qui est dû au livreur ; chaque montant payé le diminue."
                      head={['Date', 'Opération', 'Détail', 'Débit', 'Crédit', 'Solde']}
                      lead={[
                        formatDate(period!.from, language), 'Solde antérieur', '—', '', '',
                        <span key="s" className="font-bold">{money(data.priorBalance)}</span>,
                      ]}
                      rows={data.rows.map((r) => [
                        formatDate(r.date, language),
                        <span key="l" className="font-semibold">{r.label}</span>,
                        <span key="d" className="text-text-muted">{r.detail || '—'}</span>,
                        r.debit ? <span key="db" className="text-rose-deep">{money(r.debit)}</span> : '',
                        r.credit ? <span key="cr" className="text-pistachio">{money(r.credit)}</span> : '',
                        <span key="b" className={r.balance > 0 ? 'font-bold text-rose-deep' : 'font-bold text-pistachio'}>
                          {money(r.balance)}
                        </span>,
                      ])}
                      foot={[
                        'Totaux de la période', '', '',
                        money(data.periodCost), money(data.periodPaid), money(Math.max(0, data.closingBalance)),
                      ]}
                      empty="Aucune opération sur cette période"
                    />
                  )}

                  {part === 'deliveries' && (
                    <Section
                      title="Livraisons de la période"
                      head={['Date', 'N° achat', 'N° bon', 'Matricule', 'Coût', 'Payé', 'Reste']}
                      rows={data.deliveries.map((d) => [
                        formatDate(d.date, language),
                        <span key="r" className="font-semibold">{d.reference}</span>,
                        d.bonNumber || '—',
                        d.driverPlate || '—',
                        money(d.cost),
                        <span key="p" className="text-pistachio">{money(d.paid)}</span>,
                        <span key="x" className={d.cost - d.paid > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>
                          {money(Math.max(0, d.cost - d.paid))}
                        </span>,
                      ])}
                      total={money(data.periodCost)}
                      empty="Aucune livraison sur cette période"
                    />
                  )}

                  {part === 'payments' && (
                    <Section
                      title="Règlements versés au livreur sur la période"
                      note="Règlements directs saisis depuis la carte du livreur (ils sortent de la caisse)."
                      head={['Date', 'Mode', 'Note', 'Montant']}
                      rows={data.pays.map((p) => [
                        formatDate(p.day, language),
                        <Badge key="m" variant="info" className="text-[10px]">{paymentMethodLabel(p)}</Badge>,
                        p.notes || '—',
                        <span key="a" className="font-bold text-pistachio">{money(p.amount)}</span>,
                      ])}
                      total={money(data.directPaid)}
                      empty="Aucun règlement sur cette période"
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
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

/** Petit tableau de section — même présentation que le compte rendu fournisseur. */
function Section({
  title, note, head, lead, rows, foot, total, empty,
}: {
  title: string;
  note?: string;
  head: string[];
  lead?: React.ReactNode[];
  rows: React.ReactNode[][];
  foot?: React.ReactNode[];
  total?: string;
  empty: string;
}) {
  return (
    <div className="rounded-2xl border border-gold/15 bg-white/40 p-4">
      <h4 className="font-display text-sm font-semibold text-text-primary">{title}</h4>
      {note && <p className="mb-2 mt-0.5 text-[11px] text-text-muted">{note}</p>}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-vanilla/60 text-left">
            <tr>{head.map((h, i) => (
              <th key={i} className={cn('px-3 py-2 text-[11px] uppercase tracking-wide text-text-muted', i >= 3 && 'text-right')}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {lead && (
              <tr className="border-t border-gold/10 bg-gold/5">
                {lead.map((c, i) => <td key={i} className={cn('px-3 py-2', i >= 3 && 'text-right tabular')}>{c}</td>)}
              </tr>
            )}
            {rows.length === 0 ? (
              <tr><td colSpan={head.length} className="px-3 py-6 text-center text-text-muted">{empty}</td></tr>
            ) : rows.map((r, ri) => (
              <tr key={ri} className="border-t border-gold/10">
                {r.map((c, ci) => <td key={ci} className={cn('px-3 py-2', ci >= 3 && 'text-right tabular')}>{c}</td>)}
              </tr>
            ))}
          </tbody>
          {(foot || total) && (
            <tfoot>
              <tr className="border-t-2 border-gold/20 bg-vanilla/40 font-bold">
                {foot
                  ? foot.map((c, i) => <td key={i} className={cn('px-3 py-2', i >= 3 && 'text-right tabular')}>{c}</td>)
                  : (<>
                      <td className="px-3 py-2" colSpan={head.length - 1}>Total</td>
                      <td className="px-3 py-2 text-right tabular text-gold-dark">{total}</td>
                    </>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
