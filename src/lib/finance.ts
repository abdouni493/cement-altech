import type {
  Sale, Purchase, Expense, Production, Destruction, Worker, CaisseTransaction,
  CommandDelivery, ComptoirItem, Product,
} from '@/types';

/* ============================================================================
 *  CALCULS FINANCIERS PARTAGES
 * ----------------------------------------------------------------------------
 *  1. SOLDE DE CAISSE
 *     Chaque encaissement (vente, bon de livraison, versement, acompte de
 *     commande...) et chaque décaissement (achat, dépense, salaire...) écrit
 *     DEJA sa ligne dans `caisse_transactions` (déclencheurs de la base). Le
 *     solde est donc simplement :
 *
 *         solde = solde initial + Σ entrées − Σ sorties
 *
 *     C'est exactement la fonction `caisse_balance()` de la base. Les écrans
 *     ajoutaient EN PLUS les ventes payées, les achats, les dépenses et les
 *     salaires : tout était compté deux fois (le « décalage » de la caisse).
 *
 *  2. GAINS ET DEPENSES D'UNE PERIODE
 *     Chiffre d'affaires hors taxes − coût des marchandises vendues = marge
 *     brute ; − pertes, destructions, dépenses et salaires = résultat net.
 * ========================================================================== */

const day = (v?: string) => (v || '').slice(0, 10);
const r2 = (n: number) => Math.round((n || 0) * 100) / 100;
const sum = (a: number[]) => r2(a.reduce((x, y) => x + y, 0));

/** Solde de caisse (au soir de `asOf` quand il est donné). */
export function caisseBalance(
  transactions: CaisseTransaction[], initialBalance = 0, asOf?: string
): number {
  return r2(
    (initialBalance || 0) +
      transactions
        .filter((t) => !asOf || day(t.date) <= asOf)
        .reduce((s, t) => s + (t.type === 'deposit' ? t.amount : -t.amount), 0)
  );
}

/** D'où vient une écriture de caisse — pour ventiler sans rien compter deux fois. */
export type CaisseSource =
  | 'sales' | 'clientPayments' | 'commands' | 'supplierRefunds' | 'otherIn'
  | 'purchases' | 'supplierPayments' | 'expenses' | 'salaries' | 'workerAdvances'
  | 'clientRefunds' | 'otherOut';

export function caisseSourceOf(t: CaisseTransaction): CaisseSource {
  const ref = t.refTable ?? '';
  if (t.type === 'deposit') {
    if (ref === 'sale_payments') return 'sales';
    if (ref === 'client_payments' || ref === 'client_debt_versements') return 'clientPayments';
    if (ref === 'commands' || ref === 'command_payments' || (!ref && t.categoryName === 'Commande')) return 'commands';
    if (ref === 'party_credit_refunds') return 'supplierRefunds';
    return 'otherIn';
  }
  if (ref === 'purchase_payments') return 'purchases';
  if (ref === 'supplier_payments') return 'supplierPayments';
  if (ref === 'expenses') return 'expenses';
  if (ref === 'worker_payments') return 'salaries';
  if (ref === 'worker_acomptes') return 'workerAdvances';
  if (ref === 'party_credit_refunds') return 'clientRefunds';
  return 'otherOut';
}

/** Ventilation des entrées / sorties de caisse d'une liste d'écritures. */
export function caisseBreakdown(transactions: CaisseTransaction[]): Record<CaisseSource, number> {
  const out = {
    sales: 0, clientPayments: 0, commands: 0, supplierRefunds: 0, otherIn: 0,
    purchases: 0, supplierPayments: 0, expenses: 0, salaries: 0, workerAdvances: 0,
    clientRefunds: 0, otherOut: 0,
  } as Record<CaisseSource, number>;
  transactions.forEach((t) => { out[caisseSourceOf(t)] += t.amount; });
  (Object.keys(out) as CaisseSource[]).forEach((k) => { out[k] = r2(out[k]); });
  return out;
}

/** Entrées et sorties de caisse sur une période. */
export function caisseFlows(transactions: CaisseTransaction[], from: string, to: string) {
  const inP = transactions.filter((t) => day(t.date) >= from && day(t.date) <= to);
  const deposits = sum(inP.filter((t) => t.type === 'deposit').map((t) => t.amount));
  const withdrawals = sum(inP.filter((t) => t.type === 'withdrawal').map((t) => t.amount));
  return { deposits, withdrawals, net: r2(deposits - withdrawals), count: inP.length };
}

/* ------------------------------------------------------------------ GAINS */

export interface GainsInput {
  sales: Sale[];
  purchases: Purchase[];
  expenses: Expense[];
  productions: Production[];
  destructions: Destruction[];
  workers: Worker[];
  transactions: CaisseTransaction[];
  deliveries: CommandDelivery[];
  comptoirItems: ComptoirItem[];
  products: Product[];
}

export interface GainsLine {
  label: string;
  value: number;
  detail?: string;
}

export interface GainsBreakdown {
  from: string;
  to: string;
  // ---- chiffre d'affaires ----
  posHT: number; posTVA: number; posTTC: number; posCount: number;
  deliveryHT: number; deliveryTVA: number; deliveryTTC: number; deliveryCount: number;
  reductions: number;
  revenueHT: number;
  tvaCollected: number;
  revenueTTC: number;
  oldSalesTTC: number; oldSalesCount: number;
  // ---- coût des marchandises vendues ----
  costDeliveries: number;
  costPosProductions: number;
  costPosComptoir: number;
  costPosStock: number;
  cogs: number;
  uncostedLines: number;
  grossMargin: number;
  grossMarginRate: number;
  // ---- charges ----
  productionLosses: number;
  destructionsValue: number;
  expensesTotal: number;
  expensesByCategory: GainsLine[];
  salaries: number;
  workerAdvances: number;
  overtimePaid: number;
  workersTotal: number;
  unpaidOvertime: number;
  chargesTotal: number;
  netResult: number;
  netMarginRate: number;
  // ---- informations ----
  purchasesTotal: number;
  purchasesPaid: number;
  oldPurchasesTotal: number;
  salesCollected: number;
  salesOnCredit: number;
  cashIn: number;
  cashOut: number;
  cashNet: number;
  manualProductionsCost: number;
  manualProductionsValue: number;
}

/** Calcul détaillé des gains et des dépenses sur [from, to]. */
export function computeGains(input: GainsInput, from: string, to: string): GainsBreakdown {
  const inP = (d?: string) => { const x = day(d); return x >= from && x <= to; };

  const periodSales = input.sales.filter((s) => inP(s.date));
  const liveSales = periodSales.filter((s) => !s.isHistorical);
  const pos = liveSales.filter((s) => !s.deliveryId);
  const delivered = liveSales.filter((s) => !!s.deliveryId);
  const oldSales = periodSales.filter((s) => s.isHistorical);

  const ht = (s: Sale) => Math.max(0, s.totalAmount - (s.reduction || 0));
  const posHT = sum(pos.map(ht));
  const posTVA = sum(pos.map((s) => s.tvaAmount || 0));
  const posTTC = sum(pos.map((s) => s.finalAmount));
  const deliveryHT = sum(delivered.map(ht));
  const deliveryTVA = sum(delivered.map((s) => s.tvaAmount || 0));
  const deliveryTTC = sum(delivered.map((s) => s.finalAmount));
  const reductions = sum(liveSales.map((s) => s.reduction || 0));
  const revenueHT = r2(posHT + deliveryHT);
  const tvaCollected = r2(posTVA + deliveryTVA);

  // ---- coût des marchandises vendues ------------------------------------
  // 1. bons de livraison : les matières réellement retirées du stock
  const deliveryById = new Map(input.deliveries.map((d) => [d.id, d]));
  const costDeliveries = sum(
    delivered.map((s) => {
      const d = s.deliveryId ? deliveryById.get(s.deliveryId) : undefined;
      return (d?.consumptions ?? []).reduce((a, c) => a + (c.lineCost || 0), 0);
    })
  );

  // 2. caisse : productions lancées par la vente d'une fiche technique
  const posIds = new Set(pos.map((s) => s.id));
  const posProductions = input.productions.filter((p) => p.origin === 'pos' && p.saleId && posIds.has(p.saleId));
  const costPosProductions = sum(
    posProductions.map((p) => p.totalCost ?? p.usedProducts.reduce((a, u) => a + (u.lineCost ?? 0), 0))
  );
  const producedSales = new Set(posProductions.map((p) => p.saleId as string));

  // 3. caisse : articles du comptoir (coût de revient de leur production) et
  //    produits du stock vendus tels quels (prix d'achat)
  const comptoirById = new Map(input.comptoirItems.map((c) => [c.id, c]));
  const productionById = new Map(input.productions.map((p) => [p.id, p]));
  const productById = new Map(input.products.map((p) => [p.id, p]));
  let costPosComptoir = 0;
  let costPosStock = 0;
  let uncostedLines = 0;
  pos.forEach((s) => {
    s.products.forEach((l) => {
      if (l.ficheTechnicId || l.productionId) {
        // ligne de fiche technique : son coût est celui de SA production
        if (!producedSales.has(s.id)) uncostedLines += 1;
        return;
      }
      const cpt = comptoirById.get(l.productId);
      if (cpt) {
        const prod = productionById.get(cpt.productionId);
        const unit = prod && prod.outputQuantity > 0 ? (prod.totalCost ?? 0) / prod.outputQuantity : 0;
        if (unit > 0) costPosComptoir += l.quantity * unit;
        else uncostedLines += 1;
        return;
      }
      const stock = productById.get(l.productId);
      if (stock) costPosStock += l.quantity * (stock.purchasePrice || 0);
      else uncostedLines += 1;
    });
  });
  costPosComptoir = r2(costPosComptoir);
  costPosStock = r2(costPosStock);
  const cogs = r2(costDeliveries + costPosProductions + costPosComptoir + costPosStock);
  const grossMargin = r2(revenueHT - cogs);

  // ---- charges -----------------------------------------------------------
  const periodProductions = input.productions.filter((p) => inP(p.date));
  const productionLosses = sum(periodProductions.map((p) => p.lossValue ?? 0));
  const destructionsValue = sum(input.destructions.filter((d) => inP(d.date)).map((d) => d.value));

  const periodExpenses = input.expenses.filter((e) => inP(e.date));
  const expensesTotal = sum(periodExpenses.map((e) => e.amount));
  const byCat = new Map<string, { value: number; count: number }>();
  periodExpenses.forEach((e) => {
    const k = e.categoryName || 'Sans catégorie';
    const cur = byCat.get(k) ?? { value: 0, count: 0 };
    cur.value += e.amount;
    cur.count += 1;
    byCat.set(k, cur);
  });
  const expensesByCategory = [...byCat.entries()]
    .map(([label, v]) => ({ label, value: r2(v.value), detail: `${v.count} dépense(s)` }))
    .sort((a, b) => b.value - a.value);

  let salaries = 0;
  let overtimePaid = 0;
  let workerAdvances = 0;
  let unpaidOvertime = 0;
  input.workers.forEach((w) => {
    (w.payments ?? []).filter((p) => inP(p.date)).forEach((p) => {
      if (p.kind === 'overtime') overtimePaid += p.amount;
      else salaries += p.amount;
    });
    (w.acomptes ?? []).filter((a) => inP(a.date)).forEach((a) => { workerAdvances += a.amount; });
    (w.overtimes ?? []).filter((o) => inP(o.date) && !o.isPaid).forEach((o) => { unpaidOvertime += o.amount; });
  });
  salaries = r2(salaries);
  overtimePaid = r2(overtimePaid);
  workerAdvances = r2(workerAdvances);
  const workersTotal = r2(salaries + overtimePaid + workerAdvances);

  const chargesTotal = r2(productionLosses + destructionsValue + expensesTotal + workersTotal);
  const netResult = r2(grossMargin - chargesTotal);

  // ---- informations -----------------------------------------------------
  const periodPurchases = input.purchases.filter((p) => inP(p.date));
  const livePurchases = periodPurchases.filter((p) => !p.isHistorical);
  const flows = caisseFlows(input.transactions, from, to);
  const manual = periodProductions.filter((p) => p.origin !== 'pos');

  return {
    from, to,
    posHT, posTVA, posTTC, posCount: pos.length,
    deliveryHT, deliveryTVA, deliveryTTC, deliveryCount: delivered.length,
    reductions, revenueHT, tvaCollected, revenueTTC: r2(posTTC + deliveryTTC),
    oldSalesTTC: sum(oldSales.map((s) => s.finalAmount)), oldSalesCount: oldSales.length,
    costDeliveries, costPosProductions, costPosComptoir, costPosStock, cogs, uncostedLines,
    grossMargin, grossMarginRate: revenueHT > 0 ? (grossMargin / revenueHT) * 100 : 0,
    productionLosses, destructionsValue, expensesTotal, expensesByCategory,
    salaries, workerAdvances, overtimePaid, workersTotal, unpaidOvertime: r2(unpaidOvertime),
    chargesTotal, netResult, netMarginRate: revenueHT > 0 ? (netResult / revenueHT) * 100 : 0,
    purchasesTotal: sum(livePurchases.map((p) => p.totalAmount)),
    purchasesPaid: sum(livePurchases.map((p) => p.paidAmount)),
    oldPurchasesTotal: sum(periodPurchases.filter((p) => p.isHistorical).map((p) => p.totalAmount)),
    salesCollected: sum(liveSales.map((s) => s.paidAmount)),
    salesOnCredit: sum(liveSales.map((s) => s.restAmount)),
    cashIn: flows.deposits, cashOut: flows.withdrawals, cashNet: flows.net,
    manualProductionsCost: sum(manual.map((p) => p.totalCost ?? 0)),
    manualProductionsValue: sum(manual.map((p) => p.totalValue)),
  };
}
