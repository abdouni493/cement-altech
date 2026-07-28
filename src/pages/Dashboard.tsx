import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Wallet, Package, ShoppingCart, FlaskConical, AlertTriangle, CreditCard,
  TrendingUp, Users, Truck, Banknote, Clock, HardHat,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/hooks/useLanguage';
import { useStockStore } from '@/store/stockStore';
import { useSalesStore } from '@/store/salesStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useProductionStore } from '@/store/productionStore';
import { useExpenseStore } from '@/store/expenseStore';
import { useClientStore } from '@/store/clientStore';
import { useWorkerStore } from '@/store/workerStore';
import { useCommandStore } from '@/store/commandStore';
import { formatCurrency, formatDate, daysUntil, getMonthLabel } from '@/lib/utils';

const CHART_COLORS = ['#FF7FB0', '#B79CED', '#3FB591', '#FFB36B', '#E5446F', '#FFD66B'];

export default function Dashboard() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();

  const products = useStockStore((s) => s.products);
  const categories = useStockStore((s) => s.categories);
  const sales = useSalesStore((s) => s.sales);
  const purchases = usePurchaseStore((s) => s.purchases);
  const productions = useProductionStore((s) => s.productions);
  const expenses = useExpenseStore((s) => s.expenses);
  const clients = useClientStore((s) => s.clients);
  const workers = useWorkerStore((s) => s.workers);
  const commands = useCommandStore((s) => s.commands);

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();

    const todayRevenue = sales
      .filter((s) => new Date(s.date).toDateString() === today)
      .reduce((sum, s) => sum + s.paidAmount, 0);

    const totalStock = products.reduce((sum, p) => sum + p.currentQuantity, 0);

    const monthPurchases = purchases
      .filter((p) => new Date(p.date).getMonth() === thisMonth && new Date(p.date).getFullYear() === thisYear)
      .reduce((sum, p) => sum + p.totalAmount, 0);

    const todayProductions = productions.filter((p) => new Date(p.date).toDateString() === today).length;

    const lowStock = products.filter((p) => p.currentQuantity <= p.minAlertQuantity);

    const clientDebts = sales.reduce((sum, s) => sum + s.restAmount, 0);
    const supplierDebts = purchases.reduce((sum, p) => sum + p.restAmount, 0);

    const monthSales = sales
      .filter((s) => new Date(s.date).getMonth() === thisMonth)
      .reduce((sum, s) => sum + s.finalAmount, 0);
    const monthExpenses = expenses
      .filter((e) => new Date(e.date).getMonth() === thisMonth)
      .reduce((sum, e) => sum + e.amount, 0);
    const netProfit = monthSales - monthPurchases - monthExpenses;

    return { todayRevenue, totalStock, monthPurchases, todayProductions, lowStock, clientDebts, supplierDebts, monthExpenses, netProfit };
  }, [products, sales, purchases, productions, expenses]);

  // Upcoming commands due within the next 48 hours or overdue by 2 hours
  const upcomingCommands = useMemo(() => {
    return commands
      .filter((c) => c.status === 'pending')
      .map((c) => {
        const [y, m, d] = c.receiveDate.split('-').map(Number);
        const deliveryDate = new Date(y, m - 1, d, Number(c.receiveHour || 0), Number(c.receiveMinute || 0));
        const diffMs = deliveryDate.getTime() - Date.now();
        const diffHrs = diffMs / (1000 * 60 * 60);
        return { ...c, diffHrs, deliveryDate };
      })
      .filter((c) => c.diffHrs >= -2 && c.diffHrs <= 48)
      .sort((a, b) => a.diffHrs - b.diffHrs);
  }, [commands]);

  // Sales evolution (last ~14 days available)
  const salesEvolution = useMemo(() => {
    const map = new Map<string, number>();
    sales.forEach((s) => {
      map.set(s.date, (map.get(s.date) || 0) + s.finalAmount);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, amount]) => ({ date: formatDate(date, language).slice(0, 5), amount }));
  }, [sales, language]);

  // Monthly comparison
  const monthlyComparison = useMemo(() => {
    const months = new Map<string, { sales: number; purchases: number; expenses: number }>();
    const ensure = (k: string) => {
      if (!months.has(k)) months.set(k, { sales: 0, purchases: 0, expenses: 0 });
      return months.get(k)!;
    };
    sales.forEach((s) => (ensure(getMonthLabel(s.date)).sales += s.finalAmount));
    purchases.forEach((p) => (ensure(getMonthLabel(p.date)).purchases += p.totalAmount));
    expenses.forEach((e) => (ensure(getMonthLabel(e.date)).expenses += e.amount));
    return Array.from(months.entries()).map(([month, v]) => ({ month, ...v }));
  }, [sales, purchases, expenses]);

  // Category distribution from sales
  const categoryDist = useMemo(() => {
    const map = new Map<string, number>();
    sales.forEach((s) =>
      s.products.forEach((line) => {
        const prod = products.find((p) => p.id === line.productId);
        const cat = categories.find((c) => c.id === prod?.categoryId);
        const name = cat?.name || 'Autre';
        map.set(name, (map.get(name) || 0) + line.quantity);
      })
    );
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [sales, products, categories]);

  // Top products
  const topProducts = useMemo(() => {
    const map = new Map<string, number>();
    sales.forEach((s) =>
      s.products.forEach((line) => {
        map.set(line.productName || line.productId, (map.get(line.productName || line.productId) || 0) + line.quantity);
      })
    );
    const arr = Array.from(map.entries()).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 5);
    const max = arr[0]?.qty || 1;
    return arr.map((p) => ({ ...p, pct: (p.qty / max) * 100 }));
  }, [sales]);

  const recentSales = useMemo(() => [...sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5), [sales]);
  const expirations = useMemo(
    () => products.filter((p) => { const d = daysUntil(p.expirationDate); return d !== null && d >= 0 && d <= 7; }).slice(0, 5),
    [products]
  );

  const statItems = [
    { label: t('todayRevenue'), value: stats.todayRevenue, icon: <Wallet size={22} />, format: 'currency' as const, accent: 'gold' as const },
    { label: t('productsInStock'), value: stats.totalStock, icon: <Package size={22} />, format: 'number' as const, accent: 'pistachio' as const },
    { label: t('monthPurchases'), value: stats.monthPurchases, icon: <ShoppingCart size={22} />, format: 'currency' as const, accent: 'caramel' as const },
    { label: t('todayProductions'), value: stats.todayProductions, icon: <FlaskConical size={22} />, format: 'number' as const, accent: 'rose' as const },
    { label: t('stockAlerts'), value: stats.lowStock.length, icon: <AlertTriangle size={22} />, format: 'number' as const, accent: 'rose' as const },
    { label: t('pendingSales'), value: stats.clientDebts, icon: <CreditCard size={22} />, format: 'currency' as const, accent: 'lavender' as const },
  ];

  return (
    <div>
      <PageHeader title={t('dashboard')} subtitle={formatDate(new Date(), language)} icon={<TrendingUp size={24} />} />

      {/* Upcoming Command Alerts */}
      {upcomingCommands.length > 0 && (
        <div className="mb-6 space-y-2.5">
          {upcomingCommands.map((cmd) => {
            const isOverdue = cmd.diffHrs < 0;
            const dueText = isOverdue
              ? `En retard de ${Math.abs(Math.round(cmd.diffHrs))}h`
              : cmd.diffHrs < 1
              ? `Dans moins d'une heure (${cmd.receiveHour}h${cmd.receiveMinute})`
              : `Dans ${Math.round(cmd.diffHrs)}h (${formatDate(cmd.receiveDate, language)} à ${cmd.receiveHour}h${cmd.receiveMinute})`;

            return (
              <motion.div
                key={cmd.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex flex-wrap items-center justify-between p-4 rounded-2xl border shadow-sm gap-4 ${
                  isOverdue
                    ? 'bg-rose-deep/10 border-rose-deep/20 text-rose-deep'
                    : 'bg-gold/10 border-gold/25 text-gold-dark'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`h-9 w-9 rounded-xl flex items-center justify-center text-white bg-gradient-to-br shrink-0 ${
                    isOverdue ? 'from-[#FFB0CB] to-[#F2547D]' : 'from-[#FFD08A] to-[#F2944A]'
                  }`}>
                    <Clock size={16} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      Livraison de commande : {cmd.clientName} ({cmd.reference})
                    </p>
                    <p className="text-xs opacity-90">
                      {dueText} · {cmd.items.length} articles · Reste à payer: {formatCurrency(cmd.restAmount)}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={isOverdue ? 'rose' : 'gold'}
                  onClick={() => navigate('/commands')}
                >
                  Gérer
                </Button>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Row 1: Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {statItems.map((s, i) => (
          <StatCard key={s.label} {...s} index={i} />
        ))}
      </div>

      {/* Row 2: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card index={0} className="lg:col-span-2">
          <h3 className="font-display font-semibold text-text-primary mb-4">{t('salesEvolution')}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={salesEvolution}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FF7FB0" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#FF7FB0" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#FFC2DD80" />
              <XAxis dataKey="date" stroke="#B07E9A" fontSize={11} />
              <YAxis stroke="#B07E9A" fontSize={11} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ borderRadius: 12, border: '1px solid #FFC2DD' }} />
              <Line type="monotone" dataKey="amount" stroke="#FF7FB0" strokeWidth={3} dot={{ fill: '#F0568A', r: 4 }} fill="url(#salesGrad)" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card index={1}>
          <h3 className="font-display font-semibold text-text-primary mb-4">{t('salesVsPurchases')}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="#FFC2DD80" />
              <XAxis dataKey="month" stroke="#B07E9A" fontSize={11} />
              <YAxis stroke="#B07E9A" fontSize={11} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ borderRadius: 12, border: '1px solid #FFC2DD' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="sales" name={t('sales')} fill="#3FB591" radius={[4, 4, 0, 0]} />
              <Bar dataKey="purchases" name={t('purchase')} fill="#FF7FB0" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" name={t('expenses')} fill="#B79CED" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card index={2}>
          <h3 className="font-display font-semibold text-text-primary mb-4">{t('categoryDistribution')}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={categoryDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label={(e) => e.name}>
                {categoryDist.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #FFC2DD' }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Row 3: Summary cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Top products */}
        <Card index={0}>
          <h3 className="font-display font-semibold text-text-primary mb-4">{t('topProducts')}</h3>
          <div className="space-y-3">
            {topProducts.map((p, i) => (
              <div key={p.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-text-secondary truncate">{i + 1}. {p.name}</span>
                  <span className="tabular text-text-muted">{p.qty}</span>
                </div>
                <div className="h-2 rounded-full bg-vanilla overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${p.pct}%` }} transition={{ delay: i * 0.1, duration: 0.6 }}
                    className="h-full bg-gradient-button rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Recent sales */}
        <Card index={1}>
          <h3 className="font-display font-semibold text-text-primary mb-4">{t('recentSales')}</h3>
          <div className="space-y-2.5">
            {recentSales.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">{s.reference}</p>
                  <p className="text-xs text-text-muted">{clients.find((c) => c.id === s.clientId)?.name || t('walkIn')}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="tabular text-text-primary">{formatCurrency(s.finalAmount)}</p>
                  <Badge variant={s.status === 'paid' ? 'success' : 'danger'}>{s.status === 'paid' ? t('paid') : t('rest')}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Stock alerts */}
        <Card index={2} className="border-rose-deep/20">
          <h3 className="font-display font-semibold text-rose-deep mb-4 flex items-center gap-2">
            <AlertTriangle size={18} /> {t('stockAlerts')}
          </h3>
          <div className="space-y-2.5">
            {stats.lowStock.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm bg-rose/5 rounded-lg px-3 py-2">
                <span className="text-text-secondary truncate">{p.name}</span>
                <Badge variant="danger">{p.currentQuantity} / {p.minAlertQuantity}</Badge>
              </div>
            ))}
            {stats.lowStock.length === 0 && <p className="text-sm text-text-muted">Aucune alerte ✅</p>}
          </div>
        </Card>
      </div>

      {/* Row 4: Financial + expirations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card index={0}>
          <h3 className="font-display font-semibold text-text-primary mb-4">Finances du mois</h3>
          <div className="grid grid-cols-2 gap-3">
            <FinanceTile icon={<Truck size={18} />} label={t('supplierDebts')} value={stats.supplierDebts} color="text-caramel" />
            <FinanceTile icon={<Users size={18} />} label={t('clientDebts')} value={stats.clientDebts} color="text-rose-deep" />
            <FinanceTile icon={<Banknote size={18} />} label={t('totalExpenses')} value={stats.monthExpenses} color="text-lavender-deep" />
            <FinanceTile icon={<TrendingUp size={18} />} label={t('netProfit')} value={stats.netProfit} color={stats.netProfit >= 0 ? 'text-pistachio' : 'text-rose-deep'} />
          </div>
        </Card>

        <Card index={1}>
          <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Clock size={18} /> {t('nextExpirations')}
          </h3>
          <div className="space-y-2.5">
            {expirations.map((p) => {
              const d = daysUntil(p.expirationDate);
              return (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary truncate">{p.name}</span>
                  <Badge variant={d !== null && d <= 2 ? 'danger' : 'warning'}>
                    {d === 0 ? "Aujourd'hui" : `${d} j`}
                  </Badge>
                </div>
              );
            })}
            {expirations.length === 0 && <p className="text-sm text-text-muted">Aucune expiration proche</p>}
          </div>
        </Card>
      </div>

      {/* Row 5: Workers */}
      <Card index={0}>
        <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2">
          <HardHat size={18} /> {t('activeWorkers')}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <FinanceTile icon={<HardHat size={18} />} label={t('activeWorkers')} value={workers.length} color="text-gold-dark" isCount />
          <FinanceTile icon={<Banknote size={18} />} label="Paiements ce mois"
            value={workers.filter((w) => w.paymentEnabled && w.paymentType === 'monthly').reduce((s, w) => s + w.paymentAmount, 0)} color="text-pistachio" />
          <FinanceTile icon={<Clock size={18} />} label={t('absences')}
            value={workers.reduce((s, w) => s + w.absences.length, 0)} color="text-rose-deep" isCount />
          <FinanceTile icon={<Wallet size={18} />} label={t('acomptes')}
            value={workers.reduce((s, w) => s + w.acomptes.reduce((a, ac) => a + ac.amount, 0), 0)} color="text-caramel" />
        </div>
      </Card>
    </div>
  );
}

function FinanceTile({ icon, label, value, color, isCount }: { icon: React.ReactNode; label: string; value: number; color: string; isCount?: boolean }) {
  return (
    <div className="bg-vanilla/40 rounded-xl p-3.5 border border-gold/10">
      <div className={`flex items-center gap-2 mb-1.5 ${color}`}>{icon}</div>
      <p className="text-xs text-text-muted mb-0.5">{label}</p>
      <p className={`text-lg font-bold tabular ${color}`}>{isCount ? value : formatCurrency(value)}</p>
    </div>
  );
}
