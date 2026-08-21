import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, Plus, Minus, ArrowDownLeft, ArrowUpRight, TrendingUp, TrendingDown,
  ShoppingCart, Banknote, Receipt, HardHat, FlaskConical, Beaker, Package,
  Pencil, Trash2, Calendar, PiggyBank, Coins, ArrowRightLeft, FileText,
  ChevronDown, ChevronUp, Tag, Clock
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/shared/StatCard';
import { CategorySelect } from '@/components/shared/CategorySelect';
import { toast } from '@/components/ui/Toast';
import { useCaisseStore } from '@/store/caisseStore';
import { useSalesStore } from '@/store/salesStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useExpenseStore } from '@/store/expenseStore';
import { useProductionStore } from '@/store/productionStore';
import { useComptoirStore } from '@/store/comptoirStore';
import { useStockStore } from '@/store/stockStore';
import { useWorkerStore } from '@/store/workerStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { useCountUp } from '@/hooks/useCountUp';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { cardVariants } from '@/lib/animations';
import type { CaisseTransaction, CaisseTransactionType } from '@/types';

type Period = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

function periodBounds(period: Period, from: string, to: string): { start: number; end: number } {
  if (period === 'all') return { start: -Infinity, end: Infinity };
  if (period === 'custom') {
    const s = from ? new Date(from).getTime() : -Infinity;
    const e = to ? new Date(to + 'T23:59:59').getTime() : Infinity;
    return { start: s, end: e };
  }
  const end = endOfToday().getTime();
  if (period === 'today') return { start: startOfToday().getTime(), end };
  const start = new Date();
  if (period === 'week') start.setDate(start.getDate() - 7);
  else if (period === 'month') start.setDate(start.getDate() - 30);
  else if (period === 'year') start.setFullYear(start.getFullYear() - 1);
  start.setHours(0, 0, 0, 0);
  return { start: start.getTime(), end };
}

export default function CaissePage() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const navigate = useNavigate();

  const {
    transactions, addTransaction, updateTransaction, deleteTransaction,
    categories: caisseCategories, addCategory: addCaisseCategory, deleteCategory: deleteCaisseCategory,
  } = useCaisseStore();
  const sales = useSalesStore((s) => s.sales);
  const purchases = usePurchaseStore((s) => s.purchases);
  const expenses = useExpenseStore((s) => s.expenses);
  const productions = useProductionStore((s) => s.productions);
  const comptoirItems = useComptoirStore((s) => s.items);
  const products = useStockStore((s) => s.products);
  const categories = useStockStore((s) => s.categories);
  const workers = useWorkerStore((s) => s.workers);

  const [period, setPeriod] = useState<Period>('today');
  const [from, setFrom] = useState('2026-06-01');
  const [to, setTo] = useState(todayISO());
  // Category filter applied to the transaction history ('' = all)
  const [catFilter, setCatFilter] = useState<string>('');

  // Interactive accordion states
  const [expandedProdId, setExpandedProdId] = useState<string | null>(null);
  const [expandedCatName, setExpandedCatName] = useState<string | null>(null);

  // Transaction modal
  const [txOpen, setTxOpen] = useState(false);
  const [txType, setTxType] = useState<CaisseTransactionType>('deposit');
  const [editing, setEditing] = useState<CaisseTransaction | null>(null);
  const [form, setForm] = useState({ amount: 0, date: todayISO(), description: '', categoryId: '' });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const bounds = useMemo(() => periodBounds(period, from, to), [period, from, to]);
  const inPeriod = (dateStr: string) => {
    const ts = new Date(dateStr).getTime();
    return ts >= bounds.start && ts <= bounds.end;
  };

  const c = useMemo(() => {
    // ---- All-time figures → the actual current cash balance ----
    const depositsAll = transactions.filter((x) => x.type === 'deposit').reduce((s, x) => s + x.amount, 0);
    const withdrawalsAll = transactions.filter((x) => x.type === 'withdrawal').reduce((s, x) => s + x.amount, 0);
    const salesCashAll = sales.reduce((s, x) => s + x.paidAmount, 0);
    const purchasesPaidAll = purchases.reduce((s, x) => s + x.paidAmount, 0);
    const expensesAll = expenses.reduce((s, x) => s + x.amount, 0);
    const workerPaidAll = workers.reduce(
      (s, w) =>
        s +
        w.payments.reduce((a, p) => a + p.amount, 0) +
        w.acomptes.reduce((a, p) => a + p.amount, 0),
      0
    );
    const inAll = depositsAll + salesCashAll;
    const outAll = withdrawalsAll + purchasesPaidAll + expensesAll + workerPaidAll;
    const balance = inAll - outAll;

    // ---- Current snapshots (now) ----
    const comptoirQty = comptoirItems.reduce((s, i) => s + i.quantity, 0);
    const comptoirValue = comptoirItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const stockValue = products.reduce((s, p) => s + p.currentQuantity * p.purchasePrice, 0);
    const treasury = balance + comptoirValue + stockValue;

    // ---- Period figures (respect the active filter) ----
    const pSales = sales.filter((s) => inPeriod(s.date));
    const pPurch = purchases.filter((p) => inPeriod(p.date));
    const pExp = expenses.filter((e) => inPeriod(e.date));
    const pProd = productions.filter((p) => inPeriod(p.date));
    const pTx = transactions.filter((x) => inPeriod(x.date));

    const salesTotal = pSales.reduce((s, x) => s + x.finalAmount, 0);
    const salesPaid = pSales.reduce((s, x) => s + x.paidAmount, 0);
    const purchasesTotal = pPurch.reduce((s, x) => s + x.totalAmount, 0);
    const purchasesPaid = pPurch.reduce((s, x) => s + x.paidAmount, 0);
    const expensesTotal = pExp.reduce((s, x) => s + x.amount, 0);
    const productionValue = pProd.reduce((s, x) => s + x.totalValue, 0);
    const workerPayments = workers.reduce(
      (s, w) =>
        s +
        w.payments.filter((p) => inPeriod(p.date)).reduce((a, p) => a + p.amount, 0) +
        w.acomptes.filter((p) => inPeriod(p.date)).reduce((a, p) => a + p.amount, 0),
      0
    );
    // Salaires / heures supplémentaires / acomptes détaillés sur la période
    const salaryPaid = workers.reduce(
      (s, w) => s + w.payments.filter((p) => inPeriod(p.date) && p.kind !== 'overtime').reduce((a, p) => a + p.amount, 0),
      0
    );
    const overtimePaid = workers.reduce(
      (s, w) => s + w.payments.filter((p) => inPeriod(p.date) && p.kind === 'overtime').reduce((a, p) => a + p.amount, 0),
      0
    );
    const acomptesPaid = workers.reduce(
      (s, w) => s + w.acomptes.filter((p) => inPeriod(p.date)).reduce((a, p) => a + p.amount, 0),
      0
    );
    // Dette sociale : heures supplémentaires enregistrées mais pas encore réglées
    const overtimeUnpaid = workers.reduce(
      (s, w) => s + (w.overtimes ?? []).filter((o) => !o.isPaid).reduce((a, o) => a + o.amount, 0),
      0
    );
    const overtimeHoursUnpaid = workers.reduce(
      (s, w) => s + (w.overtimes ?? []).filter((o) => !o.isPaid).reduce((a, o) => a + o.hours, 0),
      0
    );
    const depositsP = pTx.filter((x) => x.type === 'deposit').reduce((s, x) => s + x.amount, 0);
    const withdrawalsP = pTx.filter((x) => x.type === 'withdrawal').reduce((s, x) => s + x.amount, 0);

    // ---- Deposits / withdrawals grouped by category (period) ----
    const groupByCat = (list: CaisseTransaction[]) => {
      const map = new Map<string, { id: string; name: string; total: number; count: number }>();
      list.forEach((x) => {
        const id = x.categoryId || '__none__';
        const name = x.categoryName || t('noCategory');
        const e = map.get(id) || { id, name, total: 0, count: 0 };
        e.total += x.amount;
        e.count += 1;
        map.set(id, e);
      });
      return [...map.values()].sort((a, b) => b.total - a.total);
    };
    const depositCats = groupByCat(pTx.filter((x) => x.type === 'deposit'));
    const withdrawalCats = groupByCat(pTx.filter((x) => x.type === 'withdrawal'));

    const periodIn = salesPaid + depositsP;
    const periodOut = purchasesPaid + expensesTotal + workerPayments + withdrawalsP;
    const periodNet = periodIn - periodOut;

    // ---- Per-product sales over the period (qty sold + revenue) ----
    const salesMap = new Map<string, { name: string; units: number; revenue: number; unit?: string; sellByUnit?: boolean }>();
    pSales.forEach((s) => s.products.forEach((l) => {
      const key = l.productName || '—';
      const e = salesMap.get(key) || { name: key, units: 0, revenue: 0, unit: l.unit, sellByUnit: l.sellByUnit };
      e.units += l.quantity;
      e.revenue += l.quantity * l.sellingPrice;
      if (l.sellByUnit) { e.sellByUnit = true; e.unit = l.unit; }
      salesMap.set(key, e);
    }));
    const productSales = [...salesMap.values()].sort((a, b) => b.revenue - a.revenue);

    // ---- What is still sitting on the comptoir right now (per product) ----
    const restItems = comptoirItems
      .filter((i) => i.quantity > 0)
      .map((i) => ({ name: i.productName, quantity: i.quantity, value: i.quantity * i.unitPrice, unit: i.sellByUnit ? i.unit : undefined }))
      .sort((a, b) => b.value - a.value);

    // ---- Group purchases by category ----
    const purchasesCatMap = new Map<string, { categoryName: string; totalAmount: number; products: { [name: string]: { name: string; quantity: number; unit?: string; totalCost: number } } }>();
    pPurch.forEach(pur => {
      pur.products.forEach(line => {
        const prod = products.find(p => p.id === line.productId);
        const catName = prod ? (categories.find(c => c.id === prod.categoryId)?.name || 'Sans Catégorie') : 'Sans Catégorie';
        
        if (!purchasesCatMap.has(catName)) {
          purchasesCatMap.set(catName, { categoryName: catName, totalAmount: 0, products: {} });
        }
        const catGroup = purchasesCatMap.get(catName)!;
        const lineTotal = line.quantity * line.purchasePrice;
        catGroup.totalAmount += lineTotal;

        const pName = line.productName || '—';
        if (!catGroup.products[pName]) {
          catGroup.products[pName] = { name: pName, quantity: 0, unit: line.unit, totalCost: 0 };
        }
        const pGroup = catGroup.products[pName];
        pGroup.quantity += line.quantity;
        pGroup.totalCost += lineTotal;
      });
    });
    const purchasesByCategory = [...purchasesCatMap.values()].map(cat => ({
      ...cat,
      productsList: Object.values(cat.products).sort((a, b) => b.totalCost - a.totalCost)
    })).sort((a, b) => b.totalAmount - a.totalAmount);

    return {
      balance, depositsAll, withdrawalsAll, salesCashAll, inAll, outAll,
      comptoirQty, comptoirValue, stockValue, treasury,
      salesTotal, salesPaid, purchasesTotal, purchasesPaid, expensesTotal,
      productionValue, workerPayments, salaryPaid, overtimePaid, acomptesPaid,
      overtimeUnpaid, overtimeHoursUnpaid, depositsP, withdrawalsP,
      periodIn, periodOut, periodNet, productSales, restItems,
      purchasesByCategory, periodProductions: pProd,
      depositCats, withdrawalCats,
    };
  }, [transactions, sales, purchases, expenses, productions, comptoirItems, products, categories, workers, bounds, t]);

  const visibleTx = useMemo(
    () =>
      transactions
        .filter((x) => inPeriod(x.date))
        .filter((x) => !catFilter || (x.categoryId || '__none__') === catFilter)
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt))),
    [transactions, bounds, catFilter]
  );

  const animatedBalance = useCountUp(c.balance, 1400);

  const openDeposit = () => { setTxType('deposit'); setEditing(null); setForm({ amount: 0, date: todayISO(), description: '', categoryId: '' }); setTxOpen(true); };
  const openWithdraw = () => { setTxType('withdrawal'); setEditing(null); setForm({ amount: 0, date: todayISO(), description: '', categoryId: '' }); setTxOpen(true); };
  const openEdit = (tx: CaisseTransaction) => { setTxType(tx.type); setEditing(tx); setForm({ amount: tx.amount, date: tx.date, description: tx.description, categoryId: tx.categoryId || '' }); setTxOpen(true); };

  const handleSubmit = () => {
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { toast.error('Montant invalide'); return; }
    const categoryName = form.categoryId ? caisseCategories.find((cx) => cx.id === form.categoryId)?.name : undefined;
    const payload = { type: txType, amount, date: form.date, description: form.description, categoryId: form.categoryId || undefined, categoryName };
    if (editing) {
      updateTransaction(editing.id, payload);
      toast.success('Transaction modifiée');
    } else {
      addTransaction(payload);
      toast.success(txType === 'deposit' ? 'Dépôt enregistré' : 'Retrait enregistré');
    }
    setTxOpen(false);
  };

  const periodOptions: { value: Period; label: string }[] = [
    { value: 'today', label: t('today') },
    { value: 'week', label: t('week') },
    { value: 'month', label: t('month') },
    { value: 'year', label: t('year') },
    { value: 'all', label: t('all') },
    { value: 'custom', label: t('period') },
  ];

  return (
    <div>
      <PageHeader
        title={t('caisse')}
        icon={<Wallet size={24} />}
        subtitle={`${t('currentBalance')}: ${formatCurrency(c.balance)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/caisse/reports')}><FileText size={18} /> {t('caisseReports')}</Button>
            {can('caisse', 'create') && (
              <Button variant="mint" onClick={openDeposit}><Plus size={18} /> {t('newDeposit')}</Button>
            )}
            {can('caisse', 'create') && (
              <Button variant="rose" onClick={openWithdraw}><Minus size={18} /> {t('newWithdrawal')}</Button>
            )}
          </div>
        }
      />

      {/* ===== Hero: current balance + total treasury ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Balance hero */}
        <motion.div
          custom={0} variants={cardVariants} initial="hidden" animate="visible"
          className="lg:col-span-2 relative overflow-hidden rounded-2xl bg-gradient-button text-white shadow-gold p-6"
        >
          <div className="absolute -top-10 -right-8 h-44 w-44 rounded-full bg-white/15 blur-2xl" />
          <div className="absolute -bottom-12 -left-6 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-white/90 mb-1">
              <div className="h-9 w-9 rounded-xl bg-white/20 flex items-center justify-center"><Wallet size={18} /></div>
              <span className="text-sm font-medium">{t('caisseBalance')}</span>
            </div>
            <p className="font-display text-4xl sm:text-5xl font-bold tabular tracking-tight mt-2">
              {formatCurrency(animatedBalance)}
            </p>
            <div className="flex flex-wrap gap-2 mt-5">
              <div className="flex items-center gap-2 bg-white/15 backdrop-blur rounded-xl px-3 py-2">
                <ArrowDownLeft size={16} className="text-white" />
                <div>
                  <p className="text-[11px] text-white/80 leading-none">{t('moneyIn')}</p>
                  <p className="text-sm font-bold tabular">{formatCurrency(c.inAll)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-white/15 backdrop-blur rounded-xl px-3 py-2">
                <ArrowUpRight size={16} className="text-white" />
                <div>
                  <p className="text-[11px] text-white/80 leading-none">{t('moneyOut')}</p>
                  <p className="text-sm font-bold tabular">{formatCurrency(c.outAll)}</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Treasury hero */}
        <motion.div
          custom={1} variants={cardVariants} initial="hidden" animate="visible"
          className="relative overflow-hidden rounded-2xl bg-gradient-lavender text-white shadow-card p-6"
        >
          <div className="absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-white/90 mb-1">
              <div className="h-9 w-9 rounded-xl bg-white/20 flex items-center justify-center"><PiggyBank size={18} /></div>
              <span className="text-sm font-medium">{t('totalTreasury')}</span>
            </div>
            <p className="font-display text-3xl font-bold tabular mt-2">{formatCurrency(c.treasury)}</p>
            <div className="mt-4 space-y-1.5 text-sm">
              <TreasuryLine icon={<Wallet size={13} />} label={t('caisseBalance')} value={c.balance} />
              <TreasuryLine icon={<Beaker size={13} />} label={t('comptoirValue')} value={c.comptoirValue} />
              <TreasuryLine icon={<Package size={13} />} label={t('stockValue')} value={c.stockValue} />
            </div>
          </div>
        </motion.div>
      </div>

      {/* ===== Period filter ===== */}
      <Card index={2} className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5 p-1 rounded-2xl bg-vanilla/60 border border-gold/15">
            {periodOptions.map((opt) => {
              const active = period === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setPeriod(opt.value)}
                  className="relative px-3.5 py-1.5 rounded-xl text-sm font-medium transition-colors"
                >
                  {active && (
                    <motion.span
                      layoutId="caisse-period-pill"
                      className="absolute inset-0 rounded-xl bg-gradient-button shadow-gold"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className={`relative z-10 ${active ? 'text-white' : 'text-text-secondary'}`}>{opt.label}</span>
                </button>
              );
            })}
          </div>

          <AnimatePresence>
            {period === 'custom' && (
              <motion.div
                initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }}
                className="flex items-end gap-2 overflow-hidden"
              >
                <Input label={t('from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[160px]" />
                <Input label={t('to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[160px]" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>

      {/* ===== Period movements (in / out / net) ===== */}
      <h3 className="font-display font-semibold text-text-primary mb-3 flex items-center gap-2">
        <ArrowRightLeft size={18} className="text-gold-dark" /> {t('periodMovements')}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <FlowCard index={0} icon={<TrendingUp size={20} />} label={t('moneyIn')} value={c.periodIn} accent="mint" />
        <FlowCard index={1} icon={<TrendingDown size={20} />} label={t('moneyOut')} value={c.periodOut} accent="rose" />
        <FlowCard index={2} icon={<Coins size={20} />} label={t('netFlow')} value={c.periodNet} accent={c.periodNet >= 0 ? 'gold' : 'rose'} signed />
      </div>

      {/* ===== Deposits / withdrawals by category ===== */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-semibold text-text-primary flex items-center gap-2">
          <Tag size={18} className="text-gold-dark" /> {t('categoryBreakdown')}
        </h3>
        {catFilter && (
          <button onClick={() => setCatFilter('')} className="text-xs font-medium text-rose-deep hover:underline">
            {t('all')} ✕
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <CategoryTotalsCard index={0} title={t('depositsByCategory')} icon={<ArrowDownLeft size={18} />} tone="mint" cats={c.depositCats} total={c.depositsP} activeId={catFilter} onPick={(id) => setCatFilter(catFilter === id ? '' : id)} emptyLabel={t('noData')} />
        <CategoryTotalsCard index={1} title={t('withdrawalsByCategory')} icon={<ArrowUpRight size={18} />} tone="rose" cats={c.withdrawalCats} total={c.withdrawalsP} activeId={catFilter} onPick={(id) => setCatFilter(catFilter === id ? '' : id)} emptyLabel={t('noData')} />
      </div>

      {/* ===== Social liability: unpaid overtime ===== */}
      {c.overtimeUnpaid > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-caramel/40 bg-caramel/10 px-4 py-3.5"
        >
          <div className="flex items-center gap-3 text-caramel">
            <motion.div
              animate={{ scale: [1, 1.12, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="h-9 w-9 rounded-xl bg-caramel/20 flex items-center justify-center"
            >
              <Clock size={17} />
            </motion.div>
            <div>
              <p className="text-sm font-bold">Heures supplémentaires non payées</p>
              <p className="text-xs opacity-90">
                {c.overtimeHoursUnpaid.toFixed(2)} h enregistrées et non réglées — sortie de caisse à prévoir.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold tabular text-caramel">{formatCurrency(c.overtimeUnpaid)}</span>
            <Button size="sm" variant="secondary" onClick={() => navigate('/workers')}>
              Voir les employés
            </Button>
          </div>
        </motion.div>
      )}

      {/* ===== Detailed store calculations ===== */}
      <h3 className="font-display font-semibold text-text-primary mb-3 flex items-center gap-2">
        <Receipt size={18} className="text-gold-dark" /> {t('details')}
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard index={0} label={t('totalSales')} value={c.salesTotal} icon={<Receipt size={18} />} format="currency" accent="pistachio" />
        <StatCard index={1} label={t('totalPurchasesAmount')} value={c.purchasesTotal} icon={<ShoppingCart size={18} />} format="currency" accent="caramel" />
        <StatCard index={2} label={t('totalExpenses')} value={c.expensesTotal} icon={<Banknote size={18} />} format="currency" accent="rose" />
        <StatCard index={3} label="Salaires versés" value={c.salaryPaid} icon={<HardHat size={18} />} format="currency" accent="lavender" />
        <StatCard index={4} label="Heures sup. payées" value={c.overtimePaid} icon={<Clock size={18} />} format="currency" accent="caramel" />
        <StatCard index={5} label="Acomptes versés" value={c.acomptesPaid} icon={<Coins size={18} />} format="currency" accent="lavender" />
        <StatCard index={6} label={t('productionValue')} value={c.productionValue} icon={<FlaskConical size={18} />} format="currency" accent="gold" />
        <StatCard index={7} label={t('comptoirProducts')} value={c.comptoirQty} icon={<Beaker size={18} />} format="number" accent="caramel" />
        <StatCard index={8} label={t('comptoirValue')} value={c.comptoirValue} icon={<Coins size={18} />} format="currency" accent="pistachio" />
        <StatCard index={9} label={t('stockValue')} value={c.stockValue} icon={<Package size={18} />} format="currency" accent="gold" />
        <StatCard index={10} label="Heures sup. à payer" value={c.overtimeUnpaid} icon={<Clock size={18} />} format="currency" accent="rose" />
      </div>

      {/* ===== Per-product sales (period) + comptoir rest (now) ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card index={0}>
          <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2"><Receipt size={18} className="text-gold-dark" /> {t('productSales')}</h3>
          {c.productSales.length === 0 ? (
            <EmptyState message={t('noData')} icon={<Receipt size={28} />} />
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead className="bg-vanilla/60 text-text-secondary"><tr>
                  <th className="text-left px-3 py-2">{t('name')}</th>
                  <th className="text-right px-3 py-2">{t('soldQty')}</th>
                  <th className="text-right px-3 py-2">{t('revenue')}</th>
                </tr></thead>
                <tbody>
                  {c.productSales.map((p) => (
                    <tr key={p.name} className="border-t border-gold/10">
                      <td className="px-3 py-2 font-medium text-text-primary">{p.name}</td>
                      <td className="px-3 py-2 text-right tabular">{p.units}{p.sellByUnit && p.unit ? ` ${p.unit}` : ''}</td>
                      <td className="px-3 py-2 text-right tabular text-pistachio font-semibold">{formatCurrency(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gold/15 bg-vanilla/40 font-bold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular">{c.productSales.reduce((s, p) => s + p.units, 0)}</td>
                    <td className="px-3 py-2 text-right tabular text-pistachio">{formatCurrency(c.productSales.reduce((s, p) => s + p.revenue, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <Card index={1}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-text-primary flex items-center gap-2"><Beaker size={18} className="text-gold-dark" /> {t('restAtComptoir')}</h3>
            <span className="text-sm font-bold tabular text-gold-dark">{formatCurrency(c.comptoirValue)}</span>
          </div>
          {c.restItems.length === 0 ? (
            <EmptyState message={t('noData')} icon={<Beaker size={28} />} />
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead className="bg-vanilla/60 text-text-secondary"><tr>
                  <th className="text-left px-3 py-2">{t('name')}</th>
                  <th className="text-right px-3 py-2">{t('available')}</th>
                  <th className="text-right px-3 py-2">{t('restValue')}</th>
                </tr></thead>
                <tbody>
                  {c.restItems.map((p, i) => (
                    <tr key={p.name + i} className="border-t border-gold/10">
                      <td className="px-3 py-2 font-medium text-text-primary">{p.name}</td>
                      <td className="px-3 py-2 text-right tabular">{p.quantity}{p.unit ? ` ${p.unit}` : ''}</td>
                      <td className="px-3 py-2 text-right tabular text-gold-dark font-semibold">{formatCurrency(p.value)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gold/15 bg-vanilla/40 font-bold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular">{c.comptoirQty}</td>
                    <td className="px-3 py-2 text-right tabular text-gold-dark">{formatCurrency(c.comptoirValue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* ===== Ingredients per Production + Purchases by Category ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Ingredients per Production Accordion */}
        <Card index={2}>
          <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2">
            <FlaskConical size={18} className="text-gold-dark" /> Ingrédients par Production (Période)
          </h3>
          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {c.periodProductions.map((p) => {
              const isOpen = expandedProdId === p.id;
              const prodCost = p.usedProducts.reduce((sum, u) => sum + (u.lineCost ?? (u.quantityUsed * (u.unitCost ?? 0))), 0);
              return (
                <div key={p.id} className="border border-gold/10 rounded-xl overflow-hidden bg-vanilla/10">
                  <button
                    onClick={() => setExpandedProdId(isOpen ? null : p.id)}
                    className="w-full flex items-center justify-between p-3 text-left hover:bg-gold/5 transition-colors"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="font-semibold text-sm text-text-primary truncate">{p.name}</p>
                      <p className="text-xs text-text-muted">{formatDate(p.date, language)} · {p.outputQuantity} unités</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-bold text-rose-deep">{formatCurrency(prodCost)}</span>
                      {isOpen ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
                    </div>
                  </button>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden border-t border-gold/10 bg-vanilla/50"
                      >
                        <div className="p-3">
                          <table className="w-full text-xs">
                            <thead className="bg-vanilla/60 text-text-secondary">
                              <tr>
                                <th className="text-left px-2 py-1.5 font-medium">{t('ingredient')}</th>
                                <th className="text-right px-2 py-1.5 font-medium">Quantité</th>
                                <th className="text-right px-2 py-1.5 font-medium">P.U Achat</th>
                                <th className="text-right px-2 py-1.5 font-medium">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.usedProducts.map((u, ui) => (
                                <tr key={ui} className="border-t border-gold/5">
                                  <td className="px-2 py-1.5 font-medium text-text-primary">{u.productName}</td>
                                  <td className="px-2 py-1.5 text-right tabular">{u.quantityUsed}{u.unit ? ` ${u.unit}` : ''}</td>
                                  <td className="px-2 py-1.5 text-right tabular">{formatCurrency(u.unitCost ?? 0)}</td>
                                  <td className="px-2 py-1.5 text-right tabular text-rose-deep font-semibold">{formatCurrency(u.lineCost ?? (u.quantityUsed * (u.unitCost ?? 0)))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
            {c.periodProductions.length === 0 && <EmptyState message={t('noData')} />}
          </div>
        </Card>

        {/* Purchases by Category Accordion */}
        <Card index={3}>
          <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2">
            <ShoppingCart size={18} className="text-gold-dark" /> Achats par Catégorie (Période)
          </h3>
          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {c.purchasesByCategory.map((cat) => {
              const isOpen = expandedCatName === cat.categoryName;
              return (
                <div key={cat.categoryName} className="border border-gold/10 rounded-xl overflow-hidden bg-vanilla/10">
                  <button
                    onClick={() => setExpandedCatName(isOpen ? null : cat.categoryName)}
                    className="w-full flex items-center justify-between p-3 text-left hover:bg-gold/5 transition-colors"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="font-semibold text-sm text-text-primary truncate">{cat.categoryName}</p>
                      <p className="text-xs text-text-muted">{cat.productsList.length} articles achetés</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-bold text-gold-dark">{formatCurrency(cat.totalAmount)}</span>
                      {isOpen ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
                    </div>
                  </button>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden border-t border-gold/10 bg-vanilla/50"
                      >
                        <div className="p-3">
                          <table className="w-full text-xs">
                            <thead className="bg-vanilla/60 text-text-secondary">
                              <tr>
                                <th className="text-left px-2 py-1.5 font-medium">Produit</th>
                                <th className="text-right px-2 py-1.5 font-medium">Quantité</th>
                                <th className="text-right px-2 py-1.5 font-medium">P.U Moyen</th>
                                <th className="text-right px-2 py-1.5 font-medium">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cat.productsList.map((p, pi) => {
                                const avgPrice = p.quantity > 0 ? p.totalCost / p.quantity : 0;
                                return (
                                  <tr key={pi} className="border-t border-gold/5">
                                    <td className="px-2 py-1.5 font-medium text-text-primary">{p.name}</td>
                                    <td className="px-2 py-1.5 text-right tabular">{p.quantity}{p.unit ? ` ${p.unit}` : ''}</td>
                                    <td className="px-2 py-1.5 text-right tabular">{formatCurrency(avgPrice)}</td>
                                    <td className="px-2 py-1.5 text-right tabular text-gold-dark font-semibold">{formatCurrency(p.totalCost)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
            {c.purchasesByCategory.length === 0 && <EmptyState message={t('noData')} />}
          </div>
        </Card>
      </div>

      {/* ===== Breakdown + transaction history ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Breakdown bars */}
        <Card index={0} className="lg:col-span-2">
          <h3 className="font-display font-semibold text-text-primary mb-4">{t('breakdown')}</h3>
          <div className="space-y-4">
            <BreakdownGroup
              title={t('moneyIn')} total={c.periodIn} positive
              items={[
                { label: t('sales'), value: c.salesPaid, color: 'from-[#A6E9CE] to-[#3FB591]' },
                { label: t('deposit'), value: c.depositsP, color: 'from-[#FFC2DD] to-[#FF7FB0]' },
              ]}
            />
            <BreakdownGroup
              title={t('moneyOut')} total={c.periodOut}
              items={[
                { label: t('purchase'), value: c.purchasesPaid, color: 'from-[#FFD08A] to-[#F2944A]' },
                { label: t('expenses'), value: c.expensesTotal, color: 'from-[#FFB0CB] to-[#F2547D]' },
                { label: 'Salaires', value: c.salaryPaid, color: 'from-[#CDB0F5] to-[#9B7ED8]' },
                { label: 'Heures sup.', value: c.overtimePaid, color: 'from-[#FFD08A] to-[#F2944A]' },
                { label: 'Acomptes', value: c.acomptesPaid, color: 'from-[#A6E9CE] to-[#3FB591]' },
                { label: t('withdrawal'), value: c.withdrawalsP, color: 'from-[#FF9CC0] to-[#E5547F]' },
              ]}
            />
          </div>
        </Card>

        {/* Transaction history */}
        <Card index={1} className="lg:col-span-3">
          <div className="flex items-center justify-between mb-4 gap-2">
            <h3 className="font-display font-semibold text-text-primary flex items-center gap-2">
              <ArrowRightLeft size={18} className="text-gold-dark" /> {t('transactionHistory')}
            </h3>
            <div className="flex items-center gap-2">
              {catFilter && (
                <button onClick={() => setCatFilter('')} className="flex items-center gap-1 text-xs font-medium text-gold-dark bg-gold/10 rounded-full px-2.5 py-1 hover:bg-gold/20">
                  <Tag size={11} /> {c.depositCats.concat(c.withdrawalCats).find((x) => x.id === catFilter)?.name || t('noCategory')} ✕
                </button>
              )}
              <span className="text-xs text-text-muted">{visibleTx.length}</span>
            </div>
          </div>

          {visibleTx.length === 0 ? (
            <EmptyState message={t('noTransactions')} icon={<Wallet size={30} />} />
          ) : (
            <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {visibleTx.map((tx) => {
                  const isDeposit = tx.type === 'deposit';
                  return (
                    <motion.div
                      key={tx.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="group flex items-center gap-3 p-3 rounded-xl bg-vanilla/40 border border-gold/10 hover:border-gold/30 transition-colors"
                    >
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-white shrink-0 bg-gradient-to-br ${isDeposit ? 'from-[#A6E9CE] to-[#3FB591]' : 'from-[#FFB0CB] to-[#F2547D]'}`}>
                        {isDeposit ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-primary truncate flex items-center gap-1.5">
                          {tx.description || (isDeposit ? t('deposit') : t('withdrawal'))}
                          {tx.categoryName && <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gold-dark bg-gold/10 rounded-full px-1.5 py-0.5"><Tag size={9} /> {tx.categoryName}</span>}
                        </p>
                        <p className="text-xs text-text-muted flex items-center gap-1">
                          <Calendar size={11} /> {formatDate(tx.date, language)}
                          {tx.createdBy && <span className="flex items-center gap-1">· {tx.createdBy}</span>}
                        </p>
                      </div>
                      <p className={`text-sm font-bold tabular shrink-0 ${isDeposit ? 'text-pistachio' : 'text-rose-deep'}`}>
                        {isDeposit ? '+' : '−'} {formatCurrency(tx.amount)}
                      </p>
                      <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {can('caisse', 'edit') && (
                          <button onClick={() => openEdit(tx)} className="p-1.5 rounded-lg hover:bg-gold/15 text-text-secondary"><Pencil size={14} /></button>
                        )}
                        {can('caisse', 'delete') && (
                          <button onClick={() => setDeleteId(tx.id)} className="p-1.5 rounded-lg hover:bg-rose-deep/15 text-rose-deep"><Trash2 size={14} /></button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </Card>
      </div>

      {/* ===== Deposit / withdrawal modal ===== */}
      <Modal
        open={txOpen}
        onClose={() => setTxOpen(false)}
        title={editing ? t('edit') : txType === 'deposit' ? t('newDeposit') : t('newWithdrawal')}
        size="sm"
      >
        <div className="space-y-4">
          {/* Type toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-vanilla/60 border border-gold/15">
            <button
              onClick={() => setTxType('deposit')}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${txType === 'deposit' ? 'bg-gradient-mint text-white shadow-card' : 'text-text-secondary'}`}
            >
              <ArrowDownLeft size={16} /> {t('deposit')}
            </button>
            <button
              onClick={() => setTxType('withdrawal')}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${txType === 'withdrawal' ? 'bg-gradient-rose text-white shadow-card' : 'text-text-secondary'}`}
            >
              <ArrowUpRight size={16} /> {t('withdrawal')}
            </button>
          </div>

          <Input
            label={`${t('amount')} (DA) *`}
            type="number"
            min={0}
            value={form.amount || ''}
            onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
            icon={<Coins size={16} />}
          />
          <Input
            label={`${t('date')} *`}
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
          <CategorySelect
            label={t('category')}
            categories={caisseCategories}
            value={form.categoryId}
            onChange={(id) => setForm({ ...form, categoryId: id })}
            onCreate={addCaisseCategory}
            onDelete={deleteCaisseCategory}
          />
          <Textarea
            label={t('description')}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={txType === 'deposit' ? 'Ex: Apport en capital' : 'Ex: Retrait propriétaire'}
          />
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="secondary" onClick={() => setTxOpen(false)}>{t('cancel')}</Button>
            <Button variant={txType === 'deposit' ? 'mint' : 'rose'} onClick={handleSubmit}>{t('save')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) { deleteTransaction(deleteId); toast.success('Transaction supprimée'); } }}
      />
    </div>
  );
}

function CategoryTotalsCard({ index, title, icon, tone, cats, total, activeId, onPick, emptyLabel }: {
  index: number; title: string; icon: React.ReactNode; tone: 'mint' | 'rose';
  cats: { id: string; name: string; total: number; count: number }[];
  total: number; activeId: string; onPick: (id: string) => void; emptyLabel: string;
}) {
  const grad = tone === 'mint' ? 'from-[#A6E9CE] to-[#3FB591]' : 'from-[#FFB0CB] to-[#F2547D]';
  const text = tone === 'mint' ? 'text-pistachio' : 'text-rose-deep';
  const max = Math.max(1, ...cats.map((x) => x.total));
  return (
    <Card index={index}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-text-primary flex items-center gap-2">
          <span className={`h-8 w-8 rounded-lg bg-gradient-to-br flex items-center justify-center text-white ${grad}`}>{icon}</span> {title}
        </h3>
        <span className={`text-sm font-bold tabular ${text}`}>{formatCurrency(total)}</span>
      </div>
      {cats.length === 0 ? (
        <EmptyState message={emptyLabel} icon={<Tag size={26} />} />
      ) : (
        <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
          {cats.map((cat) => {
            const active = activeId === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => onPick(cat.id)}
                className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${active ? 'border-gold/40 bg-gold/10' : 'border-gold/10 bg-vanilla/40 hover:border-gold/25'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text-primary truncate flex items-center gap-1.5"><Tag size={12} className="text-gold-dark" /> {cat.name}</span>
                  <span className={`text-sm font-bold tabular shrink-0 ${text}`}>{formatCurrency(cat.total)}</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="h-1.5 flex-1 rounded-full bg-vanilla/50 overflow-hidden">
                    <div className={`h-full rounded-full bg-gradient-to-r ${grad}`} style={{ width: `${(cat.total / max) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-text-muted shrink-0">{cat.count} op.</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function TreasuryLine({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-white/85">{icon} {label}</span>
      <span className="font-semibold tabular">{formatCurrency(value)}</span>
    </div>
  );
}

function FlowCard({ index, icon, label, value, accent, signed }: {
  index: number; icon: React.ReactNode; label: string; value: number;
  accent: 'mint' | 'rose' | 'gold'; signed?: boolean;
}) {
  const animated = useCountUp(value, 1100);
  const accents: Record<string, string> = {
    mint: 'from-[#A6E9CE] to-[#3FB591]',
    rose: 'from-[#FFB0CB] to-[#F2547D]',
    gold: 'from-[#FF9CC0] to-[#F0568A]',
  };
  const text: Record<string, string> = { mint: 'text-pistachio', rose: 'text-rose-deep', gold: 'text-gold-dark' };
  const sign = signed && value > 0 ? '+ ' : signed && value < 0 ? '− ' : '';
  return (
    <motion.div
      custom={index} variants={cardVariants} initial="hidden" animate="visible" whileHover="hover"
      className="relative overflow-hidden rounded-2xl bg-gradient-card border border-gold/15 shadow-card p-5"
    >
      <div className={`absolute -top-6 -right-6 h-20 w-20 rounded-full bg-gradient-to-br opacity-10 ${accents[accent]}`} />
      <div className={`h-11 w-11 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shadow-sm mb-3 ${accents[accent]}`}>
        {icon}
      </div>
      <p className="text-sm text-text-muted mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular ${text[accent]}`}>
        {sign}{formatCurrency(Math.abs(animated))}
      </p>
    </motion.div>
  );
}

function BreakdownGroup({ title, total, items, positive }: {
  title: string; total: number; positive?: boolean;
  items: { label: string; value: number; color: string }[];
}) {
  const max = Math.max(total, ...items.map((i) => i.value), 1);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-sm font-semibold ${positive ? 'text-pistachio' : 'text-rose-deep'}`}>{title}</span>
        <span className="text-sm font-bold tabular text-text-primary">{formatCurrency(total)}</span>
      </div>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.label}>
            <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
              <span>{it.label}</span>
              <span className="tabular">{formatCurrency(it.value)}</span>
            </div>
            <div className="h-2.5 rounded-full bg-vanilla/70 overflow-hidden">
              <motion.div
                className={`h-full rounded-full bg-gradient-to-r ${it.color}`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (it.value / max) * 100)}%` }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
