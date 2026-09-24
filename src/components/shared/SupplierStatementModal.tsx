import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FileBarChart, Printer, Coins, RotateCcw, Package, PiggyBank, BookOpenText,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PeriodPicker, firstDayOfMonth } from './PeriodReport';
import {
  StatementPrintDialog, type StatementPrintChoice, type StatementPrintPart,
} from './StatementPrintDialog';
import { EntryEditor, targetFromLedger, type EntryRequest } from './entries/EntryEditor';
import { EntryActions } from './entries/EntryActions';
import { PriorDebtDialog } from './PriorDebtDialog';
import { Section } from './ClientStatementModal';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { supplierAccountOf } from '@/lib/accounts';
import {
  buildSupplierLedger, sliceLedger, ledgerRows, type DebitKind, type LedgerSlice,
} from '@/lib/ledger';
import {
  printPartyStatement, statementTotals, dayBefore,
  defaultStatementTitle, defaultStatementPeriodPrefix, periodSuffix,
} from '@/lib/statementPrint';
import { panelVariants, EASE } from '@/lib/animations';
import { cn } from '@/lib/utils';
import type { Supplier } from '@/types';

/* ============================================================================
 *  COMPTE RENDU D'UN FOURNISSEUR SUR UNE PERIODE
 * ----------------------------------------------------------------------------
 *  Meme mecanique que le compte rendu du client, a partir du RELEVE du
 *  fournisseur (factures d'achat, anciennes dettes, reglements) :
 *   · achats NOUVEAUX et ANCIENS dans un seul tableau, avec les colonnes
 *     « N de bon » (saisi sur l'achat) et « Matricule » ;
 *   · du plus ANCIEN au plus RECENT ;
 *   · TOTAL, TOTAL VERSEMENTS et RESTE justes — sans compter deux fois un
 *     versement deja impute sur une facture ;
 *   · versements listes en fin de document, marchandises facultatives,
 *     dette anterieure signalee avant l'impression.
 * ========================================================================== */

type PartKey = 'releve' | 'purchases' | 'versements' | 'oldDebts' | 'products';

const creditKindLabel: Record<string, string> = {
  payment: 'Versement direct',
  docPayment: 'Reglement facture',
  refund: 'Excedent recupere',
};

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
  const [part, setPart] = useState<PartKey>('releve');
  /** Ligne du releve ouverte en consultation / modification. */
  const [entry, setEntry] = useState<EntryRequest | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [priorAsk, setPriorAsk] = useState<{ choice: StatementPrintChoice; slice: LedgerSlice } | null>(null);

  useEffect(() => {
    if (!supplier) return;
    setFrom(firstDayOfMonth());
    setTo(todayISO());
    setPeriod(null);
    setPart('releve');
    setPrintOpen(false);
    setPriorAsk(null);
  }, [supplier?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => {
    if (!supplier || !period) return null;
    const { from: f, to: t } = period;
    const ledger = buildSupplierLedger({ supplierId: supplier.id, purchases, payments, refunds, oldDebts });
    const all = sliceLedger(ledger, f, t, { debitKinds: ['purchase', 'oldDebt'] });
    const purchasesList = all.debits.filter((d) => d.kind === 'purchase');
    const oldDebtsList = all.debits.filter((d) => d.kind === 'oldDebt');

    const grouped = new Map<string, { key: string; name: string; unit?: string; quantity: number; unitPrice: number; amount: number; invoices: Set<string> }>();
    purchasesList.forEach((d) =>
      d.lines.forEach((l) => {
        const key = `${l.designation.toLowerCase()}|${l.unit ?? ''}|${l.unitPrice}`;
        const cur = grouped.get(key) ?? {
          key, name: l.designation, unit: l.unit, quantity: 0, unitPrice: l.unitPrice, amount: 0, invoices: new Set<string>(),
        };
        cur.quantity += l.quantity;
        cur.amount += l.amount;
        cur.invoices.add(d.reference);
        grouped.set(key, cur);
      })
    );
    const products = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

    return {
      ledger, all, purchasesList, oldDebtsList, products,
      rows: ledgerRows(all, all.priorBalance),
      account: supplierAccountOf(supplier.id, { suppliers: supplierRows, purchases, oldDebts }),
      purchasesTotal: sum(purchasesList.map((d) => d.amount)),
      oldDebtsTotal: sum(oldDebtsList.map((d) => d.amount)),
    };
  }, [supplier, period, purchases, payments, oldDebts, refunds, supplierRows]);

  const periodLabel = period
    ? `Du ${formatDate(period.from, language)} au ${formatDate(period.to, language)}`
    : '';

  /* ------------------------------------------------------- l'impression -- */
  const sliceFor = (c: StatementPrintChoice): LedgerSlice | null => {
    if (!data || !period) return null;
    const kinds: DebitKind[] = [];
    if (c.purchases) kinds.push('purchase');
    if (c.oldDebts) kinds.push('oldDebt');
    return sliceLedger(data.ledger, period.from, period.to, { debitKinds: kinds });
  };

  const runPrint = (c: StatementPrintChoice, slice: LedgerSlice, includePrior: boolean) => {
    if (!supplier) return;
    printPartyStatement(
      {
        kind: 'supplier',
        mode: 'statement',
        party: { name: supplier.name, phone: supplier.phone, address: supplier.address },
        slice,
        includeOldDebts: c.oldDebts,
        includePrior,
        includeVersements: c.versements,
        includeProducts: c.products,
        tvaMode: c.tvaMode,
        tvaRate: c.tvaRate,
        docTitle: c.docTitle,
        periodPrefix: c.periodPrefix,
      },
      settings
    );
  };

  const onPrintChoice = (c: StatementPrintChoice) => {
    setPrintOpen(false);
    const slice = sliceFor(c);
    if (!slice) return;
    if (c.oldDebts && Math.abs(slice.priorBalance) > 0.004) {
      setPriorAsk({ choice: c, slice });
      return;
    }
    runPrint(c, slice, false);
  };

  const preview = (c: StatementPrintChoice) => {
    const slice = sliceFor(c);
    if (!slice) return { ht: 0, tva: 0, total: 0, versements: 0, rest: 0 };
    const t = statementTotals({
      slice, includeOldDebts: c.oldDebts, includePrior: false,
      includeVersements: c.versements, tvaMode: c.tvaMode, tvaRate: c.tvaRate,
    });
    return { ht: t.ht, tva: t.tva, total: t.total, versements: t.versements, rest: t.rest };
  };

  const printParts: StatementPrintPart[] = data
    ? [
        {
          key: 'purchases', group: 'table', label: "Factures d'achat",
          hint: 'Nouveaux et anciens achats, avec N° de bon et matricule',
          count: data.purchasesList.length, total: formatCurrency(data.purchasesTotal),
        },
        {
          key: 'oldDebts', group: 'foot', label: 'Anciennes dettes / dette antérieure',
          hint: Math.abs(data.all.priorBalance) > 0.004
            ? `Au-dessus du total, avec leur date. Dette antérieure au ${formatDate(dayBefore(data.all.from))} : ${formatCurrency(data.all.priorBalance)} (proposée avant l'impression).`
            : 'Au-dessus du total, avec leur date.',
          count: data.oldDebtsList.length + (Math.abs(data.all.priorBalance) > 0.004 ? 1 : 0),
          total: data.oldDebtsList.length ? formatCurrency(data.oldDebtsTotal) : undefined,
          defaultChecked: data.oldDebtsList.length > 0 || Math.abs(data.all.priorBalance) > 0.004,
        },
        {
          key: 'versements', group: 'foot', label: 'Versements',
          hint: 'Total versements, reste, et liste datée en fin de document',
          count: data.all.credits.length, total: formatCurrency(data.all.totalCredits), defaultChecked: true,
        },
        {
          key: 'products', group: 'extra', label: 'Tableau des marchandises',
          hint: 'Récapitulatif par produit et par prix d’achat',
          count: data.products.length, defaultChecked: false,
        },
      ]
    : [];

  const parts: { key: PartKey; label: string; icon: JSX.Element; count: number }[] = data
    ? [
        { key: 'releve', label: 'Relevé', icon: <BookOpenText size={14} />, count: data.rows.length },
        { key: 'purchases', label: 'Achats', icon: <Package size={14} />, count: data.purchasesList.length },
        { key: 'versements', label: 'Versements', icon: <Coins size={14} />, count: data.all.credits.length },
        { key: 'oldDebts', label: 'Anciennes dettes', icon: <PiggyBank size={14} />, count: data.oldDebtsList.length },
        { key: 'products', label: 'Produits', icon: <Package size={14} />, count: data.products.length },
      ]
    : [];

  const money = formatCurrency;

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

              {data.account.credit > 0.004 && (
                <div className="flex items-start gap-3 rounded-2xl border border-pistachio/40 bg-pistachio/10 px-4 py-3">
                  <PiggyBank size={20} className="mt-0.5 shrink-0 text-pistachio" />
                  <div>
                    <p className="text-sm font-bold text-pistachio">
                      Trop-versé disponible : {money(data.account.credit)}
                    </p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      L&rsquo;entreprise a versé plus que les factures : ce trop-versé paiera les prochains achats
                      (il est proposé à leur création) ou peut être récupéré depuis la carte du fournisseur.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                <Kpi
                  label={`Dette antérieure au ${formatDate(dayBefore(data.all.from), language)}`}
                  value={money(data.all.priorBalance)}
                  tone={data.all.priorBalance > 0 ? 'neg' : 'pos'}
                />
                <Kpi label="Achats (période)" value={money(data.all.totalDebits)} tone="accent" />
                <Kpi label="Versements (période)" value={money(data.all.totalCredits)} tone="pos" />
                <Kpi label="Reste (période)" value={money(data.all.rest)} tone={data.all.rest > 0 ? 'neg' : 'pos'} />
                <Kpi
                  label={`Solde au ${formatDate(data.all.to, language)}`}
                  value={money(data.all.closingBalance)}
                  tone={data.all.closingBalance > 0 ? 'neg' : 'pos'}
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
                  {part === 'releve' && (
                    <Section
                      title="Relevé du compte (de la plus ancienne à la plus récente opération)"
                      note="Chaque facture d'achat et ancienne dette augmente ce que l'entreprise doit ; chaque versement le diminue."
                      head={['Date', 'Opération', 'Détail', 'Débit', 'Crédit', 'Solde', 'Actions']}
                      lead={[
                        formatDate(data.all.from, language), 'Solde antérieur', '—', '', '',
                        <span key="s" className="font-bold">{money(data.all.priorBalance)}</span>, '',
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
                        <EntryActions key="act" target={targetFromLedger(r.source, 'supplier')} onOpen={setEntry} />,
                      ])}
                      foot={[
                        'Totaux de la période', '', '',
                        money(data.all.totalDebits), money(data.all.totalCredits), money(data.all.closingBalance), '',
                      ]}
                      empty="Aucune opération sur cette période"
                    />
                  )}

                  {part === 'purchases' && (
                    <Section
                      title="Achats de la période (nouveaux et anciens)"
                      head={['Date', 'N° facture', 'N° bon', 'Matricule', 'Désignation', 'Quantité', 'Total', 'Reste aujourd’hui', 'Actions']}
                      rows={data.purchasesList.map((d) => [
                        formatDate(d.date, language),
                        <span key="r" className="font-semibold">
                          {d.reference}
                          {d.historical && <Badge variant="warning" className="ml-1 text-[9px]">Ancien</Badge>}
                        </span>,
                        d.bonNumber || '—',
                        d.driverPlate || '—',
                        d.lines.map((l) => l.designation).join(', ') || '—',
                        Math.round(d.lines.reduce((s, l) => s + l.quantity, 0) * 1000) / 1000,
                        money(d.amount),
                        <span key="x" className={d.restNow > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>{money(d.restNow)}</span>,
                        <EntryActions key="act" target={{ kind: 'purchase', id: d.id }} onOpen={setEntry} />,
                      ])}
                      total={money(data.purchasesTotal)}
                      empty="Aucune facture sur cette période"
                    />
                  )}

                  {part === 'versements' && (
                    <Section
                      title="Argent versé sur la période"
                      note="Règlements saisis sur la carte du fournisseur et règlements portés par les factures — c'est exactement le « total versements » du compte rendu."
                      head={['Date', 'Type', 'Libellé', 'Mode', 'Montant', 'Actions']}
                      rows={data.all.credits.map((c) => [
                        formatDate(c.date, language),
                        <Badge key="t" variant={c.kind === 'payment' ? 'success' : c.kind === 'refund' ? 'danger' : 'info'} className="text-[10px]">
                          {creditKindLabel[c.kind] ?? c.kind}
                        </Badge>,
                        c.label,
                        c.method || '—',
                        <span key="a" className={c.amount < 0 ? 'font-bold text-rose-deep' : 'font-bold text-pistachio'}>
                          {c.amount < 0 ? `− ${money(-c.amount)}` : money(c.amount)}
                        </span>,
                        <EntryActions
                          key="act"
                          target={targetFromLedger({ side: 'credit', kind: c.kind, id: c.id, debitId: c.debitId, debitKind: c.debitKind }, 'supplier')}
                          onOpen={setEntry}
                        />,
                      ])}
                      total={money(data.all.totalCredits)}
                      empty="Aucun versement sur cette période"
                    />
                  )}

                  {part === 'oldDebts' && (
                    <Section
                      title="Anciennes dettes de la période"
                      note="Imprimées au-dessus du total du compte rendu, chacune avec sa date."
                      head={['Date', 'Description', 'Montant', 'Reste aujourd’hui', 'Actions']}
                      rows={data.oldDebtsList.map((d) => [
                        formatDate(d.date, language), d.description || '—',
                        money(d.amount),
                        <span key="r" className={d.restNow > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>{money(d.restNow)}</span>,
                        <EntryActions key="act" target={{ kind: 'oldDebt', id: d.id, party: 'supplier' }} onOpen={setEntry} />,
                      ])}
                      total={money(data.oldDebtsTotal)}
                      empty="Aucune ancienne dette sur cette période"
                    />
                  )}

                  {part === 'products' && (
                    <Section
                      title="Marchandises reçues sur la période"
                      note="Une ligne par produit ET par prix d'achat — c'est le tableau « marchandises » facultatif du document imprimé."
                      head={['Produit', 'Factures', 'Quantité', 'Prix unitaire', 'Montant']}
                      rows={data.products.map((p) => [
                        p.name, p.invoices.size,
                        `${Math.round(p.quantity * 1000) / 1000}${p.unit ? ` ${p.unit}` : ''}`,
                        money(p.unitPrice),
                        <span key="a" className="font-bold text-gold-dark">{money(p.amount)}</span>,
                      ])}
                      total={money(data.products.reduce((s, p) => s + p.amount, 0))}
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
              onPrint={onPrintChoice}
              kind="supplier"
              parts={printParts}
              preview={preview}
              title={`Imprimer le compte rendu — ${supplier.name}`}
              printLabel="Imprimer le compte rendu"
              defaultDocTitle={defaultStatementTitle('supplier', 'statement')}
              defaultPeriodPrefix={defaultStatementPeriodPrefix('statement')}
              periodSuffix={period ? periodSuffix(period.from, period.to) : undefined}
            />
          )}

          <EntryEditor request={entry} onClose={() => setEntry(null)} />

          <PriorDebtDialog
            open={!!priorAsk}
            onClose={() => setPriorAsk(null)}
            onDecide={(include) => {
              const ask = priorAsk;
              setPriorAsk(null);
              if (ask) runPrint(ask.choice, ask.slice, include);
            }}
            partyName={supplier.name}
            slice={priorAsk?.slice ?? null}
            kind="supplier"
          />
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
