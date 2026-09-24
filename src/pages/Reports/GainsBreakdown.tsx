import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Printer, Receipt, Factory, Banknote, HardHat, Wallet, Info,
  ShoppingCart, Flame, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSalesStore } from '@/store/salesStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useExpenseStore } from '@/store/expenseStore';
import { useProductionStore } from '@/store/productionStore';
import { useComptoirStore } from '@/store/comptoirStore';
import { useStockStore } from '@/store/stockStore';
import { useWorkerStore } from '@/store/workerStore';
import { useCaisseStore } from '@/store/caisseStore';
import { useCommandStore } from '@/store/commandStore';
import { useSettingsStore } from '@/store/settingsStore';
import { formatCurrency, formatDate } from '@/lib/utils';
import { computeGains, type GainsBreakdown as Breakdown } from '@/lib/finance';
import { printListDocument, periodSuffix } from '@/lib/statementPrint';
import { PrintTitleDialog, type PrintTitleRequest } from '@/components/shared/PrintTitleDialog';
import type { DocRow } from '@/lib/officialDoc';
import { cardVariants } from '@/lib/animations';
import { cn } from '@/lib/utils';

/* ============================================================================
 *  RAPPORT GENERAL — CALCUL DETAILLE DES GAINS ET DES DEPENSES
 * ----------------------------------------------------------------------------
 *  Sur la periode choisie :
 *
 *   CHIFFRE D'AFFAIRES H.T.   ventes de caisse + ventes par bon de livraison
 *                             (reductions deduites ; TVA mise a part)
 *   − COUT DES MARCHANDISES   matieres retirees du stock par les livraisons,
 *                             productions lancees par la caisse, cout de
 *                             revient des articles du comptoir, produits du
 *                             stock vendus tels quels
 *   = MARGE BRUTE
 *   − pertes de production, destructions, depenses (par categorie),
 *     salaires, acomptes et heures supplementaires des employes
 *   = RESULTAT NET
 *
 *  En information : achats de la periode, encaissements et ventes a credit,
 *  flux de caisse, anciennes ventes (hors calcul : leur cout n'est pas connu).
 * ========================================================================== */

export function GainsBreakdown({ from, to }: { from: string; to: string }) {
  const sales = useSalesStore((s) => s.sales);
  const purchases = usePurchaseStore((s) => s.purchases);
  const expenses = useExpenseStore((s) => s.expenses);
  const productions = useProductionStore((s) => s.productions);
  const destructions = useComptoirStore((s) => s.destructions);
  const comptoirItems = useComptoirStore((s) => s.items);
  const products = useStockStore((s) => s.products);
  const workers = useWorkerStore((s) => s.workers);
  const transactions = useCaisseStore((s) => s.transactions);
  const deliveries = useCommandStore((s) => s.deliveries);
  const settings = useSettingsStore((s) => s.settings);
  const [titleRequest, setTitleRequest] = useState<PrintTitleRequest | null>(null);

  const valid = !!from && !!to && from <= to;
  const g = useMemo<Breakdown | null>(
    () => (valid
      ? computeGains({
          sales, purchases, expenses, productions, destructions, workers, transactions,
          deliveries, comptoirItems, products,
        }, from, to)
      : null),
    [valid, from, to, sales, purchases, expenses, productions, destructions, workers, transactions, deliveries, comptoirItems, products]
  );

  if (!g) {
    return (
      <p className="rounded-2xl border border-dashed border-gold/25 bg-vanilla/20 py-6 text-center text-sm italic text-text-muted">
        Choisissez une période valide pour calculer les gains et les dépenses.
      </p>
    );
  }

  const m = formatCurrency;
  const pct = (v: number) => `${v.toFixed(1)} %`;

  const print = () =>
    setTitleRequest({
      defaultTitle: 'CALCUL DES GAINS ET DES DEPENSES',
      defaultPeriodPrefix: 'PERIODE',
      periodSuffix: periodSuffix(from, to),
      scope: 'report',
      dialogTitle: 'Imprimer le calcul des gains',
      print: ({ title, periodPrefix }) => printNow(title, periodPrefix),
    });

  const printNow = (docTitle: string, prefix: string) => {
    const line = (label: string, value: number, strong = false): DocRow =>
      ({ cells: [label.toUpperCase(), m(value)], variant: strong ? 'subtotal' : 'normal' });
    const cols = [
      { label: 'Designation', align: 'left' as const },
      { label: 'Montant', align: 'right' as const, width: '28%' },
    ];
    printListDocument(
      {
        title: docTitle,
        docDate: to,
        metaLines: [`${prefix} ${periodSuffix(from, to)}`],
        tables: [
          {
            title: "Chiffre d'affaires",
            columns: cols,
            rows: [
              line(`Ventes de caisse H.T (${g.posCount})`, g.posHT),
              line(`Ventes par bon de livraison H.T (${g.deliveryCount})`, g.deliveryHT),
              line('Reductions accordees (deja deduites)', g.reductions),
              line('TVA collectee (a reverser)', g.tvaCollected),
            ],
            totals: [{ label: "Chiffre d'affaires H.T", value: m(g.revenueHT), strong: true }],
          },
          {
            title: 'Cout des marchandises vendues',
            columns: cols,
            rows: [
              line('Matieres retirees du stock par les livraisons', g.costDeliveries),
              line('Productions lancees par la caisse', g.costPosProductions),
              line('Articles du comptoir (cout de revient)', g.costPosComptoir),
              line('Produits du stock vendus tels quels', g.costPosStock),
            ],
            totals: [
              { label: 'Cout des marchandises', value: m(g.cogs) },
              { label: 'Marge brute', value: m(g.grossMargin), strong: true },
            ],
          },
          {
            title: 'Charges de la periode',
            columns: cols,
            rows: [
              line('Pertes de production', g.productionLosses),
              line('Destructions du comptoir', g.destructionsValue),
              ...g.expensesByCategory.map((e) => line(`Depenses — ${e.label}`, e.value)),
              line('Salaires payes', g.salaries),
              line('Acomptes des employes', g.workerAdvances),
              line('Heures supplementaires payees', g.overtimePaid),
            ],
            totals: [
              { label: 'Total des charges', value: m(g.chargesTotal) },
              { label: 'Resultat net', value: m(g.netResult), strong: true },
            ],
          },
          {
            title: 'Informations',
            columns: cols,
            rows: [
              line('Achats de la periode', g.purchasesTotal),
              line('Achats regles', g.purchasesPaid),
              line('Encaisse sur les ventes de la periode', g.salesCollected),
              line('Ventes a credit (reste du)', g.salesOnCredit),
              line('Entrees de caisse', g.cashIn),
              line('Sorties de caisse', g.cashOut),
              line('Anciennes ventes (hors calcul)', g.oldSalesTTC),
              line('Heures supplementaires non payees', g.unpaidOvertime),
            ],
          },
        ],
        signatures: ['Le responsable', 'Signature'],
        fileName: `Gains_depenses_${from.replace(/-/g, '')}_${to.replace(/-/g, '')}`,
      },
      settings
    );
  };

  const blocks: {
    key: string; title: string; icon: JSX.Element; tone: 'pos' | 'neg' | 'accent';
    lines: { label: string; value: number; hint?: string; sign?: '+' | '−' }[];
    total: { label: string; value: number };
  }[] = [
    {
      key: 'revenue', title: "Chiffre d'affaires", icon: <Receipt size={16} />, tone: 'accent',
      lines: [
        { label: 'Ventes de caisse H.T', value: g.posHT, hint: `${g.posCount} vente(s)` },
        { label: 'Ventes par bon de livraison H.T', value: g.deliveryHT, hint: `${g.deliveryCount} bon(s)` },
        { label: 'Réductions accordées', value: g.reductions, hint: 'déjà déduites' },
        { label: 'TVA collectée', value: g.tvaCollected, hint: 'à reverser — hors résultat' },
      ],
      total: { label: "Chiffre d'affaires H.T", value: g.revenueHT },
    },
    {
      key: 'cogs', title: 'Coût des marchandises vendues', icon: <Factory size={16} />, tone: 'neg',
      lines: [
        { label: 'Matières retirées par les livraisons', value: g.costDeliveries },
        { label: 'Productions lancées par la caisse', value: g.costPosProductions },
        { label: 'Articles du comptoir (coût de revient)', value: g.costPosComptoir },
        { label: 'Produits du stock vendus tels quels', value: g.costPosStock },
      ],
      total: { label: 'Coût des marchandises', value: g.cogs },
    },
    {
      key: 'charges', title: 'Charges de la période', icon: <Banknote size={16} />, tone: 'neg',
      lines: [
        { label: 'Pertes de production', value: g.productionLosses },
        { label: 'Destructions du comptoir', value: g.destructionsValue },
        ...g.expensesByCategory.map((e) => ({ label: `Dépenses — ${e.label}`, value: e.value, hint: e.detail })),
        { label: 'Salaires payés', value: g.salaries },
        { label: 'Acomptes des employés', value: g.workerAdvances },
        { label: 'Heures supplémentaires payées', value: g.overtimePaid },
      ],
      total: { label: 'Total des charges', value: g.chargesTotal },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Headline icon={<Receipt size={18} />} label="Chiffre d'affaires H.T" value={m(g.revenueHT)} tone="accent" />
        <Headline
          icon={<TrendingUp size={18} />} label={`Marge brute (${pct(g.grossMarginRate)})`}
          value={m(g.grossMargin)} tone={g.grossMargin >= 0 ? 'pos' : 'neg'}
        />
        <Headline icon={<TrendingDown size={18} />} label="Charges" value={m(g.chargesTotal)} tone="neg" />
        <Headline
          icon={g.netResult >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
          label={`Résultat net (${pct(g.netMarginRate)})`}
          value={m(g.netResult)} tone={g.netResult >= 0 ? 'pos' : 'neg'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {blocks.map((b, i) => (
          <motion.div
            key={b.key}
            custom={i}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            className="rounded-2xl border border-gold/15 bg-gradient-card p-4 shadow-card"
          >
            <p className="mb-3 flex items-center gap-2 text-sm font-bold text-gold-dark">{b.icon} {b.title}</p>
            <div className="space-y-1.5">
              {b.lines.map((l) => (
                <div key={l.label} className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-text-secondary">
                    {l.label}
                    {l.hint && <span className="block text-[10px] text-text-muted">{l.hint}</span>}
                  </span>
                  <span className="shrink-0 font-semibold tabular text-text-primary">{m(l.value)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-gold/20 pt-2 text-sm font-bold">
              <span className="text-text-primary">{b.total.label}</span>
              <span className={cn('tabular', b.tone === 'pos' ? 'text-pistachio' : b.tone === 'neg' ? 'text-rose-deep' : 'text-gold-dark')}>
                {m(b.total.value)}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
        <Info2 icon={<ShoppingCart size={13} />} label="Achats (stock)" value={m(g.purchasesTotal)} />
        <Info2 icon={<ShoppingCart size={13} />} label="Achats réglés" value={m(g.purchasesPaid)} />
        <Info2 icon={<Wallet size={13} />} label="Encaissé sur ventes" value={m(g.salesCollected)} />
        <Info2 icon={<Wallet size={13} />} label="Ventes à crédit" value={m(g.salesOnCredit)} />
        <Info2 icon={<Wallet size={13} />} label="Entrées de caisse" value={m(g.cashIn)} />
        <Info2 icon={<Wallet size={13} />} label="Sorties de caisse" value={m(g.cashOut)} />
        <Info2 icon={<Flame size={13} />} label="Anciennes ventes" value={m(g.oldSalesTTC)} />
        <Info2 icon={<HardHat size={13} />} label="H. sup. à payer" value={m(g.unpaidOvertime)} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-start gap-1.5 text-[11px] text-text-muted">
          <Info size={13} className="mt-0.5 shrink-0 text-gold" />
          Les achats alimentent le stock : ils ne sont pas une charge, seul le coût des marchandises réellement
          vendues l&rsquo;est. Les anciennes ventes (saisies a posteriori) sont hors calcul, leur coût n&rsquo;étant pas connu.
          {g.uncostedLines > 0 && (
            <span className="ml-1 inline-flex items-center gap-1 text-caramel">
              <Trash2 size={11} /> {g.uncostedLines} ligne(s) de vente sans coût connu.
            </span>
          )}
        </p>
        <Button size="sm" variant="gold" onClick={print}>
          <Printer size={14} /> Imprimer le calcul
        </Button>
      </div>

      <PrintTitleDialog request={titleRequest} onClose={() => setTitleRequest(null)} />
    </div>
  );
}

function Headline({ icon, label, value, tone }: { icon: JSX.Element; label: string; value: string; tone: 'pos' | 'neg' | 'accent' }) {
  return (
    <div className="rounded-2xl border border-gold/15 bg-gradient-card p-4 shadow-card">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
        <span className={tone === 'pos' ? 'text-pistachio' : tone === 'neg' ? 'text-rose-deep' : 'text-gold-dark'}>{icon}</span>
        {label}
      </p>
      <p className={cn('mt-1 font-display text-xl font-bold tabular', tone === 'pos' ? 'text-pistachio' : tone === 'neg' ? 'text-rose-deep' : 'text-gold-dark')}>
        {value}
      </p>
    </div>
  );
}

function Info2({ icon, label, value }: { icon: JSX.Element; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[10px] uppercase leading-tight tracking-wide text-text-muted">{icon} {label}</p>
      <p className="mt-0.5 text-xs font-bold tabular text-text-primary">{value}</p>
    </div>
  );
}
