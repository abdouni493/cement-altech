import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, ArrowLeft, TrendingUp, TrendingDown, Flame, FlaskConical, Trophy, Package, Coins,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/shared/StatCard';
import { useProductionStore } from '@/store/productionStore';
import { useSalesStore } from '@/store/salesStore';
import { useComptoirStore } from '@/store/comptoirStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, todayISO } from '@/lib/utils';
import { cardVariants } from '@/lib/animations';

type Period = 'today' | 'week' | 'month' | 'custom';

function bounds(period: Period, from: string, to: string): { start: number; end: number } {
  const end = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })();
  if (period === 'custom') {
    return {
      start: from ? new Date(from).getTime() : -Infinity,
      end: to ? new Date(to + 'T23:59:59').getTime() : Infinity,
    };
  }
  const start = new Date();
  if (period === 'today') start.setHours(0, 0, 0, 0);
  else if (period === 'week') { start.setDate(start.getDate() - 7); start.setHours(0, 0, 0, 0); }
  else if (period === 'month') { start.setDate(start.getDate() - 30); start.setHours(0, 0, 0, 0); }
  return { start: start.getTime(), end };
}

export default function ComptoirStatsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const productions = useProductionStore((s) => s.productions);
  const sales = useSalesStore((s) => s.sales);
  const destructions = useComptoirStore((s) => s.destructions);

  const [period, setPeriod] = useState<Period>('today');
  const [from, setFrom] = useState('2026-06-01');
  const [to, setTo] = useState(todayISO());

  const b = useMemo(() => bounds(period, from, to), [period, from, to]);
  const inRange = (d: string) => { const ts = new Date(d).getTime(); return ts >= b.start && ts <= b.end; };

  const data = useMemo(() => {
    const pProd = productions.filter((p) => inRange(p.date));
    const pSales = sales.filter((s) => inRange(s.date));
    const pDestr = destructions.filter((d) => inRange(d.date));

    // Production products (aggregate by name)
    const prodMap = new Map<string, { name: string; quantity: number; value: number }>();
    pProd.forEach((p) => {
      const e = prodMap.get(p.name) || { name: p.name, quantity: 0, value: 0 };
      e.quantity += p.outputQuantity; e.value += p.totalValue;
      prodMap.set(p.name, e);
    });
    const producedProducts = [...prodMap.values()].sort((a, b) => b.quantity - a.quantity);

    // Sales aggregate by product
    const salesMap = new Map<string, { name: string; units: number; revenue: number; unit?: string; sellByUnit?: boolean }>();
    pSales.forEach((s) => s.products.forEach((l) => {
      const key = l.productName || '—';
      const e = salesMap.get(key) || { name: key, units: 0, revenue: 0, unit: l.unit, sellByUnit: l.sellByUnit };
      e.units += l.quantity; e.revenue += l.quantity * l.sellingPrice;
      if (l.sellByUnit) { e.sellByUnit = true; e.unit = l.unit; }
      salesMap.set(key, e);
    }));
    const sold = [...salesMap.values()].sort((a, b) => b.units - a.units);
    const best = sold.slice(0, 5);
    const worst = sold.slice().sort((a, b) => a.units - b.units).slice(0, 5);

    // Destructions aggregate
    const destrMap = new Map<string, { name: string; units: number; value: number }>();
    pDestr.forEach((d) => {
      const e = destrMap.get(d.productName) || { name: d.productName, units: 0, value: 0 };
      e.units += d.quantity; e.value += d.value;
      destrMap.set(d.productName, e);
    });
    const destroyed = [...destrMap.values()].sort((a, b) => b.value - a.value);

    return {
      producedProducts,
      best, worst, destroyed,
      totalProduced: pProd.reduce((s, p) => s + p.outputQuantity, 0),
      totalSoldUnits: sold.reduce((s, x) => s + x.units, 0),
      totalRevenue: sold.reduce((s, x) => s + x.revenue, 0),
      totalWasted: destroyed.reduce((s, x) => s + x.value, 0),
    };
  }, [productions, sales, destructions, b]);

  const periodOptions: { value: Period; label: string }[] = [
    { value: 'today', label: t('today') },
    { value: 'week', label: t('week') },
    { value: 'month', label: t('month') },
    { value: 'custom', label: t('period') },
  ];

  const maxSold = Math.max(...data.best.map((x) => x.units), 1);

  return (
    <div>
      <PageHeader
        title={t('comptoirStats')}
        icon={<BarChart3 size={24} />}
        actions={<Button variant="secondary" onClick={() => navigate('/comptoir')}><ArrowLeft size={18} /> {t('comptoir')}</Button>}
      />

      {/* Filter */}
      <Card index={0} className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5 p-1 rounded-2xl bg-vanilla/60 border border-gold/15">
            {periodOptions.map((opt) => {
              const active = period === opt.value;
              return (
                <button key={opt.value} onClick={() => setPeriod(opt.value)} className="relative px-3.5 py-1.5 rounded-xl text-sm font-medium transition-colors">
                  {active && <motion.span layoutId="stats-period-pill" className="absolute inset-0 rounded-xl bg-gradient-button shadow-gold" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                  <span className={`relative z-10 ${active ? 'text-white' : 'text-text-secondary'}`}>{opt.label}</span>
                </button>
              );
            })}
          </div>
          <AnimatePresence>
            {period === 'custom' && (
              <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} className="flex items-end gap-2 overflow-hidden">
                <Input label={t('from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[160px]" />
                <Input label={t('to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[160px]" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard index={0} label={t('quantityProduced')} value={data.totalProduced} icon={<FlaskConical size={18} />} format="number" accent="gold" />
        <StatCard index={1} label={t('unitsSold')} value={data.totalSoldUnits} icon={<TrendingUp size={18} />} format="number" accent="pistachio" />
        <StatCard index={2} label={t('revenue')} value={data.totalRevenue} icon={<Coins size={18} />} format="currency" accent="caramel" />
        <StatCard index={3} label={t('moneyWasted')} value={data.totalWasted} icon={<Flame size={18} />} format="currency" accent="rose" />
      </div>

      {/* Best / worst sellers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card index={0}>
          <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2"><Trophy size={18} className="text-gold-dark" /> {t('bestSellers')}</h3>
          {data.best.length === 0 ? <EmptyState message={t('noData')} /> : (
            <div className="space-y-3">
              {data.best.map((p, i) => (
                <div key={p.name}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-text-primary flex items-center gap-2"><span className="text-gold-dark font-bold">#{i + 1}</span> {p.name}</span>
                    <span className="tabular text-text-secondary">{p.units}{p.sellByUnit && p.unit ? ` ${p.unit}` : ''} · {formatCurrency(p.revenue)}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-vanilla/70 overflow-hidden">
                    <motion.div className="h-full rounded-full bg-gradient-to-r from-[#A6E9CE] to-[#3FB591]" initial={{ width: 0 }} animate={{ width: `${(p.units / maxSold) * 100}%` }} transition={{ duration: 0.8 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card index={1}>
          <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2"><TrendingDown size={18} className="text-rose-deep" /> {t('worstSellers')}</h3>
          {data.worst.length === 0 ? <EmptyState message={t('noData')} /> : (
            <div className="space-y-2">
              {data.worst.map((p) => (
                <div key={p.name} className="flex items-center justify-between p-2.5 rounded-xl bg-vanilla/40 border border-gold/10">
                  <span className="text-sm font-medium text-text-primary">{p.name}</span>
                  <span className="text-sm tabular text-rose-deep font-semibold">{p.units}{p.sellByUnit && p.unit ? ` ${p.unit}` : ''} {t('unitsSold')}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Produced products */}
      <Card index={0} className="mb-6">
        <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2"><Package size={18} className="text-gold-dark" /> {t('productionProducts')}</h3>
        {data.producedProducts.length === 0 ? <EmptyState message={t('noData')} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-vanilla/60 text-text-secondary"><tr>
                <th className="text-left px-3 py-2">{t('name')}</th>
                <th className="text-right px-3 py-2">{t('quantityProduced')}</th>
                <th className="text-right px-3 py-2">{t('totalValue')}</th>
              </tr></thead>
              <tbody>{data.producedProducts.map((p) => (
                <tr key={p.name} className="border-t border-gold/10">
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2 text-right tabular">{p.quantity}</td>
                  <td className="px-3 py-2 text-right tabular text-gold-dark">{formatCurrency(p.value)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Destroyed products */}
      <Card index={1}>
        <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2"><Flame size={18} className="text-rose-deep" /> {t('destroyedProducts')}</h3>
        {data.destroyed.length === 0 ? <EmptyState message={t('noData')} /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.destroyed.map((d, i) => (
              <motion.div key={d.name} custom={i} variants={cardVariants} initial="hidden" animate="visible"
                className="rounded-xl bg-rose/5 border border-rose-deep/15 p-4">
                <div className="flex items-center gap-2 mb-2"><Flame size={16} className="text-rose-deep" /><span className="font-medium text-text-primary text-sm">{d.name}</span></div>
                <div className="flex justify-between text-sm"><span className="text-text-muted">{d.units} {t('unitsDestroyed')}</span><span className="tabular font-bold text-rose-deep">{formatCurrency(d.value)}</span></div>
              </motion.div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
