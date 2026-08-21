import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, Package, ShoppingCart, Factory, AlertTriangle, CreditCard, TrendingUp,
  TrendingDown, Users, Truck, Banknote, Clock, HardHat, Bell, BellRing, ArrowRight,
  CheckCircle2, Receipt, Coins, PackageCheck, Boxes, Timer, X, Activity, Layers,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, RadialBarChart, RadialBar,
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
import { useComptoirStore } from '@/store/comptoirStore';
import { useExpenseStore } from '@/store/expenseStore';
import { useClientStore } from '@/store/clientStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useWorkerStore } from '@/store/workerStore';
import { useCommandStore, deliveryStatus } from '@/store/commandStore';
import { useCaisseStore } from '@/store/caisseStore';
import { formatCurrency, formatDate, formatNumber, daysUntil, getMonthLabel } from '@/lib/utils';

const CHART_COLORS = ['#eab308', '#10b981', '#a855f7', '#f59e0b', '#e11d48', '#3b82f6'];

type AlertLevel = 'critical' | 'warning' | 'info';
interface AlertItem {
  id: string;
  level: AlertLevel;
  icon: React.ReactNode;
  title: string;
  detail: string;
  to: string;
  cta: string;
}

export default function Dashboard() {
  const { language } = useLanguage();
  const navigate = useNavigate();

  const products = useStockStore((s) => s.products);
  const sales = useSalesStore((s) => s.sales);
  const purchases = usePurchaseStore((s) => s.purchases);
  const productions = useProductionStore((s) => s.productions);
  const comptoirItems = useComptoirStore((s) => s.items);
  const expenses = useExpenseStore((s) => s.expenses);
  const clients = useClientStore((s) => s.clients);
  const suppliers = useSupplierStore((s) => s.suppliers);
  const workers = useWorkerStore((s) => s.workers);
  const commands = useCommandStore((s) => s.commands);
  const transactions = useCaisseStore((s) => s.transactions);

  const [dismissed, setDismissed] = useState<string[]>([]);

  /* ------------------------------------------------------------- figures */
  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const inThisMonth = (d: string) => {
      const x = new Date(d);
      return x.getMonth() === thisMonth && x.getFullYear() === thisYear;
    };

    const todayRevenue = sales
      .filter((s) => new Date(s.date).toDateString() === today)
      .reduce((sum, s) => sum + s.paidAmount, 0);
    const todaySalesCount = sales.filter((s) => new Date(s.date).toDateString() === today).length;

    const monthSales = sales.filter((s) => inThisMonth(s.date)).reduce((sum, s) => sum + s.finalAmount, 0);
    const monthPurchases = purchases.filter((p) => inThisMonth(p.date)).reduce((sum, p) => sum + p.totalAmount, 0);
    const monthExpenses = expenses.filter((e) => inThisMonth(e.date)).reduce((sum, e) => sum + e.amount, 0);

    const workerPaid = workers.reduce(
      (s, w) =>
        s +
        w.payments.filter((p) => inThisMonth(p.date)).reduce((a, p) => a + p.amount, 0) +
        w.acomptes.filter((p) => inThisMonth(p.date)).reduce((a, p) => a + p.amount, 0),
      0
    );
    const netProfit = monthSales - monthPurchases - monthExpenses - workerPaid;

    const stockValue = products.reduce((s, p) => s + p.currentQuantity * p.purchasePrice, 0);
    const comptoirValue = comptoirItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const lowStock = products.filter((p) => p.currentQuantity <= p.minAlertQuantity);
    const outOfStock = products.filter((p) => p.currentQuantity <= 0);

    const clientDebts =
      sales.reduce((s, x) => s + x.restAmount, 0) + commands.reduce((s, x) => s + x.restAmount, 0);
    const supplierDebts = purchases.reduce((s, p) => s + p.restAmount, 0);

    const deposits = transactions.filter((t) => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
    const withdrawals = transactions.filter((t) => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);
    const caisseBalance =
      deposits +
      sales.reduce((s, x) => s + x.paidAmount, 0) -
      withdrawals -
      purchases.reduce((s, x) => s + x.paidAmount, 0) -
      expenses.reduce((s, x) => s + x.amount, 0) -
      workers.reduce(
        (s, w) =>
          s + w.payments.reduce((a, p) => a + p.amount, 0) + w.acomptes.reduce((a, p) => a + p.amount, 0),
        0
      );

    const todayProductions = productions.filter((p) => new Date(p.date).toDateString() === today);
    const productionValue = productions.reduce((s, p) => s + p.totalValue, 0);
    const productionCost = productions.reduce((s, p) => s + (p.totalCost ?? 0), 0);

    const unpaidOvertime = workers.reduce(
      (s, w) => s + (w.overtimes ?? []).filter((o) => !o.isPaid).reduce((a, o) => a + o.amount, 0),
      0
    );
    const unpaidOvertimeCount = workers.reduce(
      (s, w) => s + (w.overtimes ?? []).filter((o) => !o.isPaid).length,
      0
    );

    const pendingDeliveries = commands.filter((c) => !deliveryStatus(c).isFull);

    return {
      todayRevenue, todaySalesCount, monthSales, monthPurchases, monthExpenses, workerPaid, netProfit,
      stockValue, comptoirValue, lowStock, outOfStock, clientDebts, supplierDebts, caisseBalance,
      todayProductions, productionValue, productionCost, unpaidOvertime, unpaidOvertimeCount,
      pendingDeliveries, treasury: caisseBalance + stockValue + comptoirValue,
    };
  }, [products, sales, purchases, productions, comptoirItems, expenses, workers, commands, transactions]);

  /* -------------------------------------------------------------- alerts */
  const alerts = useMemo<AlertItem[]>(() => {
    const list: AlertItem[] = [];

    stats.outOfStock.slice(0, 3).forEach((p) =>
      list.push({
        id: `out-${p.id}`,
        level: 'critical',
        icon: <Boxes size={16} />,
        title: `Rupture de stock : ${p.name}`,
        detail: `Il ne reste plus rien en stock${p.unit ? ` (${p.unit})` : ''}. Réapprovisionnez ce produit.`,
        to: '/purchase',
        cta: 'Acheter',
      })
    );

    stats.lowStock
      .filter((p) => p.currentQuantity > 0)
      .slice(0, 3)
      .forEach((p) =>
        list.push({
          id: `low-${p.id}`,
          level: 'warning',
          icon: <AlertTriangle size={16} />,
          title: `Stock faible : ${p.name}`,
          detail: `${p.currentQuantity}${p.unit ? ` ${p.unit}` : ''} restant(s) pour un seuil d'alerte de ${p.minAlertQuantity}.`,
          to: '/stock',
          cta: 'Voir le stock',
        })
      );

    // Deliveries due within 48h or already late
    commands
      .filter((c) => !deliveryStatus(c).isFull && c.receiveDate)
      .map((c) => {
        const [y, m, d] = c.receiveDate.split('-').map(Number);
        const due = new Date(y, (m || 1) - 1, d || 1, Number(c.receiveHour || 0), Number(c.receiveMinute || 0));
        return { cmd: c, diffHrs: (due.getTime() - Date.now()) / 3600000 };
      })
      .filter((x) => x.diffHrs <= 48)
      .sort((a, b) => a.diffHrs - b.diffHrs)
      .slice(0, 4)
      .forEach(({ cmd, diffHrs }) => {
        const late = diffHrs < 0;
        const st = deliveryStatus(cmd);
        list.push({
          id: `cmd-${cmd.id}`,
          level: late ? 'critical' : 'warning',
          icon: <Truck size={16} />,
          title: `${late ? 'Livraison en retard' : 'Livraison à préparer'} — ${cmd.clientName}`,
          detail: late
            ? `${cmd.reference} · en retard de ${Math.abs(Math.round(diffHrs))} h · ${st.remaining} article(s) non livré(s)`
            : `${cmd.reference} · dans ${Math.max(0, Math.round(diffHrs))} h · ${st.remaining} article(s) à livrer`,
          to: '/commands',
          cta: 'Livrer',
        });
      });

    if (stats.unpaidOvertimeCount > 0) {
      list.push({
        id: 'overtime',
        level: 'warning',
        icon: <Timer size={16} />,
        title: 'Heures supplémentaires non payées',
        detail: `${stats.unpaidOvertimeCount} entrée(s) en attente de règlement pour ${formatCurrency(stats.unpaidOvertime)}.`,
        to: '/workers',
        cta: 'Régler',
      });
    }

    if (stats.clientDebts > 0) {
      list.push({
        id: 'client-debt',
        level: 'info',
        icon: <Users size={16} />,
        title: 'Dettes clients à recouvrer',
        detail: `${formatCurrency(stats.clientDebts)} restent à encaisser auprès de vos clients.`,
        to: '/clients',
        cta: 'Encaisser',
      });
    }

    if (stats.supplierDebts > 0) {
      list.push({
        id: 'supplier-debt',
        level: 'info',
        icon: <Truck size={16} />,
        title: 'Dettes fournisseurs à régler',
        detail: `${formatCurrency(stats.supplierDebts)} sont dus à vos fournisseurs.`,
        to: '/suppliers',
        cta: 'Payer',
      });
    }

    if (stats.caisseBalance < 0) {
      list.push({
        id: 'caisse',
        level: 'critical',
        icon: <Wallet size={16} />,
        title: 'Solde de caisse négatif',
        detail: `La caisse affiche ${formatCurrency(stats.caisseBalance)} — vérifiez les mouvements enregistrés.`,
        to: '/caisse',
        cta: 'Ouvrir la caisse',
      });
    }

    // Products expiring within a week
    products
      .filter((p) => {
        const d = daysUntil(p.expirationDate ?? null);
        return d !== null && d >= 0 && d <= 7;
      })
      .slice(0, 3)
      .forEach((p) => {
        const d = daysUntil(p.expirationDate ?? null);
        list.push({
          id: `exp-${p.id}`,
          level: d !== null && d <= 2 ? 'critical' : 'warning',
          icon: <Clock size={16} />,
          title: `Péremption proche : ${p.name}`,
          detail: d === 0 ? "Ce produit périme aujourd'hui." : `Ce produit périme dans ${d} jour(s).`,
          to: '/stock',
          cta: 'Voir',
        });
      });

    return list.filter((a) => !dismissed.includes(a.id));
  }, [stats, products, commands, dismissed]);

  const criticalCount = alerts.filter((a) => a.level === 'critical').length;

  /* --------------------------------------------------------------- charts */
  const salesEvolution = useMemo(() => {
    const map = new Map<string, { sales: number; purchases: number }>();
    const ensure = (k: string) => {
      if (!map.has(k)) map.set(k, { sales: 0, purchases: 0 });
      return map.get(k)!;
    };
    sales.forEach((s) => (ensure(s.date).sales += s.finalAmount));
    purchases.forEach((p) => (ensure(p.date).purchases += p.totalAmount));
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-21)
      .map(([date, v]) => ({ date: formatDate(date, language).slice(0, 5), ...v }));
  }, [sales, purchases, language]);

  const monthlyComparison = useMemo(() => {
    const months = new Map<string, { sales: number; purchases: number; expenses: number }>();
    const ensure = (k: string) => {
      if (!months.has(k)) months.set(k, { sales: 0, purchases: 0, expenses: 0 });
      return months.get(k)!;
    };
    sales.forEach((s) => (ensure(getMonthLabel(s.date)).sales += s.finalAmount));
    purchases.forEach((p) => (ensure(getMonthLabel(p.date)).purchases += p.totalAmount));
    expenses.forEach((e) => (ensure(getMonthLabel(e.date)).expenses += e.amount));
    return Array.from(months.entries()).slice(-6).map(([month, v]) => ({ month, ...v }));
  }, [sales, purchases, expenses]);

  const productMix = useMemo(() => {
    const map = new Map<string, number>();
    sales.forEach((s) =>
      s.products.forEach((line) => {
        const name = line.productName || 'Autre';
        map.set(name, (map.get(name) || 0) + line.quantity * line.sellingPrice);
      })
    );
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [sales]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { qty: number; revenue: number; unit?: string }>();
    sales.forEach((s) =>
      s.products.forEach((line) => {
        const key = line.productName || line.productId;
        const e = map.get(key) || { qty: 0, revenue: 0, unit: line.unit };
        e.qty += line.quantity;
        e.revenue += line.quantity * line.sellingPrice;
        map.set(key, e);
      })
    );
    const arr = Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
    const max = arr[0]?.revenue || 1;
    return arr.map((p) => ({ ...p, pct: (p.revenue / max) * 100 }));
  }, [sales]);

  const recentSales = useMemo(
    () => [...sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    [sales]
  );

  const marginGauge = useMemo(() => {
    const margin = stats.monthSales > 0 ? (stats.netProfit / stats.monthSales) * 100 : 0;
    return [{ name: 'Marge', value: Math.max(0, Math.min(100, margin)), fill: margin >= 0 ? '#10b981' : '#e11d48' }];
  }, [stats]);

  const statItems = [
    { label: "Encaissé aujourd'hui", value: stats.todayRevenue, icon: <Wallet size={22} />, format: 'currency' as const, accent: 'gold' as const },
    { label: 'Ventes du mois', value: stats.monthSales, icon: <Receipt size={22} />, format: 'currency' as const, accent: 'pistachio' as const },
    { label: 'Achats du mois', value: stats.monthPurchases, icon: <ShoppingCart size={22} />, format: 'currency' as const, accent: 'caramel' as const },
    { label: 'Bénéfice net du mois', value: stats.netProfit, icon: <TrendingUp size={22} />, format: 'currency' as const, accent: stats.netProfit >= 0 ? ('pistachio' as const) : ('rose' as const) },
    { label: 'Valeur du stock', value: stats.stockValue, icon: <Package size={22} />, format: 'currency' as const, accent: 'lavender' as const },
    { label: 'Valeur du comptoir', value: stats.comptoirValue, icon: <PackageCheck size={22} />, format: 'currency' as const, accent: 'gold' as const },
    { label: 'Dettes clients', value: stats.clientDebts, icon: <CreditCard size={22} />, format: 'currency' as const, accent: 'rose' as const },
    { label: 'Dettes fournisseurs', value: stats.supplierDebts, icon: <Truck size={22} />, format: 'currency' as const, accent: 'caramel' as const },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord"
        subtitle={formatDate(new Date(), language)}
        icon={<Activity size={24} />}
        actions={
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 ${
              criticalCount > 0 ? 'border-rose-deep/35 bg-rose-deep/10' : 'border-gold/20 bg-gradient-card'
            }`}>
              {criticalCount > 0 ? (
                <motion.span
                  animate={{ rotate: [0, -12, 12, -8, 8, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 2 }}
                  className="text-rose-deep"
                >
                  <BellRing size={17} />
                </motion.span>
              ) : (
                <Bell size={17} className="text-gold" />
              )}
              <span className={`text-xs font-bold ${criticalCount > 0 ? 'text-rose-deep' : 'text-text-secondary'}`}>
                {alerts.length} alerte{alerts.length > 1 ? 's' : ''}
              </span>
            </div>
          </div>
        }
      />

      {/* =============== Treasury hero =============== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-2 relative overflow-hidden rounded-2xl bg-gradient-button text-white shadow-gold p-6"
        >
          <motion.div
            className="absolute -top-12 -right-10 h-48 w-48 rounded-full bg-white/15 blur-2xl"
            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 6, repeat: Infinity }}
          />
          <motion.div
            className="absolute -bottom-14 -left-8 h-44 w-44 rounded-full bg-white/10 blur-2xl"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 8, repeat: Infinity }}
          />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-9 w-9 rounded-xl bg-white/20 flex items-center justify-center"><Wallet size={18} /></div>
              <span className="text-sm font-medium text-white/90">Solde de caisse</span>
            </div>
            <p className="font-display text-4xl sm:text-5xl font-bold tabular tracking-tight mt-2">
              {formatCurrency(stats.caisseBalance)}
            </p>
            <div className="flex flex-wrap gap-2 mt-5">
              <HeroChip icon={<Package size={15} />} label="Stock" value={formatCurrency(stats.stockValue)} />
              <HeroChip icon={<PackageCheck size={15} />} label="Comptoir" value={formatCurrency(stats.comptoirValue)} />
              <HeroChip icon={<Layers size={15} />} label="Trésorerie totale" value={formatCurrency(stats.treasury)} />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="rounded-2xl bg-gradient-card border border-gold/15 shadow-card p-5 flex flex-col"
        >
          <h3 className="font-display font-semibold text-text-primary text-sm mb-2">Rentabilité du mois</h3>
          <div className="flex-1 min-h-[150px]">
            <ResponsiveContainer width="100%" height={150}>
              <RadialBarChart innerRadius="65%" outerRadius="100%" data={marginGauge} startAngle={210} endAngle={-30}>
                <RadialBar background dataKey="value" cornerRadius={10} />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-center -mt-8 mb-2">
            <p className={`text-2xl font-bold tabular ${stats.netProfit >= 0 ? 'text-pistachio' : 'text-rose-deep'}`}>
              {stats.monthSales > 0 ? `${((stats.netProfit / stats.monthSales) * 100).toFixed(1)}%` : '—'}
            </p>
            <p className="text-[11px] text-text-muted">marge nette</p>
          </div>
          <div className="space-y-1 text-xs border-t border-gold/10 pt-2.5">
            <MiniRow label="Ventes" value={formatCurrency(stats.monthSales)} color="text-pistachio" />
            <MiniRow label="Achats" value={`- ${formatCurrency(stats.monthPurchases)}`} color="text-caramel" />
            <MiniRow label="Dépenses" value={`- ${formatCurrency(stats.monthExpenses)}`} color="text-rose-deep" />
            <MiniRow label="Salaires" value={`- ${formatCurrency(stats.workerPaid)}`} color="text-lavender-deep" />
          </div>
        </motion.div>
      </div>

      {/* =============== Animated alerts =============== */}
      {alerts.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <motion.span
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 1.6, repeat: Infinity }}
              className={criticalCount > 0 ? 'text-rose-deep' : 'text-gold'}
            >
              <Bell size={16} />
            </motion.span>
            <h3 className="font-display font-semibold text-text-primary text-sm">
              Alertes &amp; actions à mener ({alerts.length})
            </h3>
          </div>

          <AnimatePresence mode="popLayout">
            {alerts.map((a, i) => {
              const style =
                a.level === 'critical'
                  ? 'border-rose-deep/35 bg-rose-deep/10 text-rose-deep'
                  : a.level === 'warning'
                  ? 'border-caramel/40 bg-caramel/10 text-caramel'
                  : 'border-gold/30 bg-gold/8 text-gold-dark';
              return (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, x: -24, scale: 0.97 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 40, scale: 0.95 }}
                  transition={{ delay: i * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3.5 shadow-sm ${style}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <motion.div
                      className="h-9 w-9 rounded-xl bg-white/25 flex items-center justify-center shrink-0"
                      animate={a.level === 'critical' ? { scale: [1, 1.12, 1] } : {}}
                      transition={{ duration: 1.6, repeat: Infinity }}
                    >
                      {a.icon}
                    </motion.div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{a.title}</p>
                      <p className="text-xs opacity-90">{a.detail}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" variant={a.level === 'critical' ? 'rose' : 'gold'} onClick={() => navigate(a.to)}>
                      {a.cta} <ArrowRight size={14} />
                    </Button>
                    <button
                      onClick={() => setDismissed((d) => [...d, a.id])}
                      className="p-1.5 rounded-lg hover:bg-white/25 transition-colors"
                      title="Masquer"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {alerts.length === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-3 rounded-2xl border border-pistachio/30 bg-pistachio/10 px-4 py-3.5 text-pistachio"
        >
          <CheckCircle2 size={20} />
          <p className="text-sm font-semibold">
            Aucune alerte : stock, livraisons, dettes et caisse sont à jour.
          </p>
        </motion.div>
      )}

      {/* =============== KPI grid =============== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statItems.map((s, i) => (
          <StatCard key={s.label} {...s} index={i} />
        ))}
      </div>

      {/* =============== Charts =============== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card index={0} className="lg:col-span-2">
          <h3 className="font-display font-semibold text-text-primary mb-4">Ventes &amp; achats — évolution</h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={salesEvolution}>
              <defs>
                <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gPurch" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#eab308" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#eab308" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-input)" opacity={0.4} />
              <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} />
              <YAxis stroke="var(--text-muted)" fontSize={11} />
              <Tooltip
                formatter={(v: number) => formatCurrency(v)}
                contentStyle={{ borderRadius: 12, border: '1px solid var(--border-input)', background: 'var(--surface-dropdown)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="sales" name="Ventes" stroke="#10b981" strokeWidth={2.5} fill="url(#gSales)" />
              <Area type="monotone" dataKey="purchases" name="Achats" stroke="#eab308" strokeWidth={2.5} fill="url(#gPurch)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card index={1}>
          <h3 className="font-display font-semibold text-text-primary mb-4">Répartition du chiffre d'affaires</h3>
          {productMix.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-16">Aucune vente enregistrée</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={productMix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={85} paddingAngle={3}>
                  {productMix.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => formatCurrency(v)}
                  contentStyle={{ borderRadius: 12, border: '1px solid var(--border-input)', background: 'var(--surface-dropdown)' }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card index={0} className="lg:col-span-2">
          <h3 className="font-display font-semibold text-text-primary mb-4">Comparatif mensuel</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-input)" opacity={0.4} />
              <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={11} />
              <YAxis stroke="var(--text-muted)" fontSize={11} />
              <Tooltip
                formatter={(v: number) => formatCurrency(v)}
                contentStyle={{ borderRadius: 12, border: '1px solid var(--border-input)', background: 'var(--surface-dropdown)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="sales" name="Ventes" fill="#10b981" radius={[6, 6, 0, 0]} />
              <Bar dataKey="purchases" name="Achats" fill="#eab308" radius={[6, 6, 0, 0]} />
              <Bar dataKey="expenses" name="Dépenses" fill="#a855f7" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card index={1}>
          <h3 className="font-display font-semibold text-text-primary mb-4">Meilleures ventes</h3>
          <div className="space-y-3">
            {topProducts.map((p, i) => (
              <div key={p.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-text-secondary truncate">{i + 1}. {p.name}</span>
                  <span className="tabular text-text-muted text-xs">
                    {formatNumber(p.qty)}{p.unit ? ` ${p.unit}` : ''}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-vanilla overflow-hidden border border-gold/10">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${p.pct}%` }}
                    transition={{ delay: i * 0.08, duration: 0.7 }}
                    className="h-full bg-gradient-button rounded-full"
                  />
                </div>
                <p className="text-[10px] text-text-muted mt-0.5 text-right tabular">{formatCurrency(p.revenue)}</p>
              </div>
            ))}
            {topProducts.length === 0 && <p className="text-sm text-text-muted text-center py-8">Aucune vente</p>}
          </div>
        </Card>
      </div>

      {/* =============== Detail rows =============== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent sales */}
        <Card index={0}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-text-primary">Ventes récentes</h3>
            <Button size="sm" variant="ghost" onClick={() => navigate('/sales')}>
              Tout voir <ArrowRight size={13} />
            </Button>
          </div>
          <div className="space-y-2.5">
            {recentSales.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">{s.reference}</p>
                  <p className="text-xs text-text-muted truncate">
                    {clients.find((c) => c.id === s.clientId)?.name || 'Client passager'} · {s.products.length} article(s)
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="tabular text-text-primary font-semibold">{formatCurrency(s.finalAmount)}</p>
                  <Badge variant={s.status === 'paid' ? 'success' : 'danger'}>
                    {s.status === 'paid' ? 'Payée' : formatCurrency(s.restAmount)}
                  </Badge>
                </div>
              </div>
            ))}
            {recentSales.length === 0 && <p className="text-sm text-text-muted text-center py-8">Aucune vente</p>}
          </div>
        </Card>

        {/* Stock alerts */}
        <Card index={1} className="border-rose-deep/20">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-rose-deep flex items-center gap-2">
              <AlertTriangle size={18} /> Alertes de stock
            </h3>
            <Button size="sm" variant="ghost" onClick={() => navigate('/stock')}>
              Stock <ArrowRight size={13} />
            </Button>
          </div>
          <div className="space-y-2">
            {stats.lowStock.slice(0, 6).map((p) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center justify-between text-sm bg-rose-deep/5 rounded-lg px-3 py-2"
              >
                <span className="text-text-secondary truncate">{p.name}</span>
                <Badge variant={p.currentQuantity <= 0 ? 'danger' : 'warning'}>
                  {p.currentQuantity}{p.unit ? ` ${p.unit}` : ''} / {p.minAlertQuantity}
                </Badge>
              </motion.div>
            ))}
            {stats.lowStock.length === 0 && (
              <p className="text-sm text-pistachio flex items-center gap-2 py-6 justify-center">
                <CheckCircle2 size={16} /> Aucun produit en alerte
              </p>
            )}
          </div>
        </Card>

        {/* Pending deliveries */}
        <Card index={2} className="border-caramel/25">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-caramel flex items-center gap-2">
              <Truck size={18} /> Livraisons en attente
            </h3>
            <Button size="sm" variant="ghost" onClick={() => navigate('/commands')}>
              Commandes <ArrowRight size={13} />
            </Button>
          </div>
          <div className="space-y-2">
            {stats.pendingDeliveries.slice(0, 6).map((c) => {
              const d = deliveryStatus(c);
              return (
                <div key={c.id} className="bg-caramel/5 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-text-secondary truncate">{c.clientName}</span>
                    <span className="text-[11px] tabular text-text-muted">{d.percent.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-vanilla overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${d.percent}%` }}
                      transition={{ duration: 0.7 }}
                      className="h-full bg-gradient-button rounded-full"
                    />
                  </div>
                  <p className="text-[10px] text-text-muted mt-1">
                    {c.reference} · reste {d.remaining} article(s) · {formatDate(c.receiveDate, language)}
                  </p>
                </div>
              );
            })}
            {stats.pendingDeliveries.length === 0 && (
              <p className="text-sm text-pistachio flex items-center gap-2 py-6 justify-center">
                <CheckCircle2 size={16} /> Toutes les commandes sont livrées
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* =============== Business tiles =============== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card index={0}>
          <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Factory size={18} className="text-gold" /> Production &amp; comptoir
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile icon={<Factory size={18} />} label="Productions" value={formatNumber(productions.length)} color="text-gold-dark" isCount />
            <Tile icon={<Clock size={18} />} label="Aujourd'hui" value={formatNumber(stats.todayProductions.length)} color="text-lavender-deep" isCount />
            <Tile icon={<Coins size={18} />} label="Coût matières" value={formatCurrency(stats.productionCost)} color="text-rose-deep" />
            <Tile icon={<TrendingUp size={18} />} label="Valeur produite" value={formatCurrency(stats.productionValue)} color="text-pistachio" />
          </div>
        </Card>

        <Card index={1}>
          <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2">
            <HardHat size={18} className="text-gold" /> Équipe &amp; partenaires
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile icon={<HardHat size={18} />} label="Employés" value={formatNumber(workers.length)} color="text-gold-dark" isCount />
            <Tile icon={<Timer size={18} />} label="H. sup. à payer" value={formatCurrency(stats.unpaidOvertime)} color="text-caramel" />
            <Tile icon={<Users size={18} />} label="Clients" value={formatNumber(clients.length)} color="text-pistachio" isCount />
            <Tile icon={<Truck size={18} />} label="Fournisseurs" value={formatNumber(suppliers.length)} color="text-lavender-deep" isCount />
          </div>
        </Card>
      </div>

      {/* =============== Financial summary =============== */}
      <Card index={0}>
        <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Banknote size={18} className="text-gold" /> Synthèse financière du mois
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Tile icon={<Receipt size={18} />} label="Ventes" value={formatCurrency(stats.monthSales)} color="text-pistachio" />
          <Tile icon={<ShoppingCart size={18} />} label="Achats" value={formatCurrency(stats.monthPurchases)} color="text-caramel" />
          <Tile icon={<Banknote size={18} />} label="Dépenses" value={formatCurrency(stats.monthExpenses)} color="text-rose-deep" />
          <Tile icon={<HardHat size={18} />} label="Salaires" value={formatCurrency(stats.workerPaid)} color="text-lavender-deep" />
          <Tile icon={<CreditCard size={18} />} label="Dettes clients" value={formatCurrency(stats.clientDebts)} color="text-rose-deep" />
          <Tile
            icon={stats.netProfit >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            label="Bénéfice net"
            value={formatCurrency(stats.netProfit)}
            color={stats.netProfit >= 0 ? 'text-pistachio' : 'text-rose-deep'}
          />
        </div>
      </Card>
    </div>
  );
}

function HeroChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 bg-white/15 backdrop-blur rounded-xl px-3 py-2">
      {icon}
      <div>
        <p className="text-[11px] text-white/80 leading-none">{label}</p>
        <p className="text-sm font-bold tabular">{value}</p>
      </div>
    </div>
  );
}

function MiniRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-text-muted">{label}</span>
      <span className={`tabular font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function Tile({ icon, label, value, color, isCount }: {
  icon: React.ReactNode; label: string; value: string; color: string; isCount?: boolean;
}) {
  return (
    <div className="bg-vanilla/40 rounded-xl p-3.5 border border-gold/10">
      <div className={`flex items-center gap-2 mb-1.5 ${color}`}>{icon}</div>
      <p className="text-xs text-text-muted mb-0.5 leading-tight">{label}</p>
      <p className={`${isCount ? 'text-xl' : 'text-base'} font-bold tabular ${color}`}>{value}</p>
    </div>
  );
}
