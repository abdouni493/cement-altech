import { useMemo, useState } from 'react';
import {
  Bike, ShoppingBag, Coins, HandCoins, Package, Search, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useDelivererStore } from '@/store/delivererStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, formatDateTime, paymentMethodLabel, isWithinRange, todayISO } from '@/lib/utils';
import type { Deliverer } from '@/types';
import type { DelivererStats } from '@/pages/Deliverers';

interface Props {
  deliverer: Deliverer | null;
  stats: DelivererStats;
  onClose: () => void;
  onPay: (d: Deliverer) => void;
}

type Tab = 'purchases' | 'payments';

/**
 * Détails et historique complet d'un livreur : les achats sur lesquels il est
 * affecté (coût de transport, déjà payé, reste) et les règlements directs qui
 * lui ont été versés. Recherche libre + filtre de période.
 */
export function DelivererHistoryModal({ deliverer, stats, onClose, onPay }: Props) {
  const { language } = useLanguage();
  const purchases = usePurchaseStore((s) => s.purchases);
  const payments = useDelivererStore((s) => s.payments);
  const assignments = useDelivererStore((s) => s.assignments);

  const [tab, setTab] = useState<Tab>('purchases');
  const [search, setSearch] = useState('');
  const [usePeriod, setUsePeriod] = useState(false);
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());

  const inPeriod = (d: string) => (!usePeriod ? true : isWithinRange(d, startDate, endDate));

  const myPurchases = useMemo(() => {
    if (!deliverer) return [];
    const q = search.toLowerCase();
    return Object.entries(assignments)
      .filter(([, a]) => a.delivererId === deliverer.id)
      .map(([purchaseId, a]) => {
        const p = purchases.find((x) => x.id === purchaseId);
        return {
          id: purchaseId,
          reference: p?.reference ?? '—',
          date: p?.date ?? '',
          bonNumber: p?.bonNumber ?? '',
          cost: Number(a.cost) || 0,
          paid: Number(a.paid) || 0,
        };
      })
      .filter((r) => inPeriod(r.date))
      .filter((r) =>
        !q ||
        r.reference.toLowerCase().includes(q) ||
        (r.bonNumber || '').toLowerCase().includes(q))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverer, purchases, assignments, search, usePeriod, startDate, endDate]);

  const myPayments = useMemo(() => {
    if (!deliverer) return [];
    const q = search.toLowerCase();
    return payments
      .filter((p) => p.delivererId === deliverer.id)
      .filter((p) => inPeriod(p.date))
      .filter((p) => !q || (p.notes || '').toLowerCase().includes(q))
      .sort((a, b) => (a.paidAt < b.paidAt ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverer, payments, search, usePeriod, startDate, endDate]);

  if (!deliverer) return null;

  return (
    <Modal open={!!deliverer} onClose={onClose} title={`Livreur — ${deliverer.name}`} size="xl">
      <div className="space-y-4">
        {/* En-tête */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/15 bg-vanilla/40 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-button font-bold text-white">
              <Bike size={20} />
            </div>
            <div>
              <p className="font-display text-lg font-semibold text-text-primary">{deliverer.name}</p>
              <p className="text-xs text-text-muted">{deliverer.phone || '—'}{deliverer.address ? ` · ${deliverer.address}` : ''}</p>
            </div>
          </div>
          <Button variant="gold" onClick={() => onPay(deliverer)}>
            <HandCoins size={16} /> Payer la dette
          </Button>
        </div>

        {/* Statistiques */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total coûts" value={formatCurrency(stats.total)} icon={<Coins size={16} />} />
          <Stat label="Payé" value={formatCurrency(stats.paid)} tone="pos" icon={<CheckCircle2 size={16} />} />
          <Stat label="Reste dû" value={formatCurrency(stats.rest)} tone={stats.rest > 0.004 ? 'neg' : 'pos'} icon={<AlertTriangle size={16} />} />
          <Stat label="Achats" value={String(stats.count)} icon={<Package size={16} />} />
        </div>

        {/* Onglets */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gold/10 pb-2">
          <TabBtn active={tab === 'purchases'} onClick={() => setTab('purchases')} icon={<ShoppingBag size={14} />}>
            Achats ({myPurchases.length})
          </TabBtn>
          <TabBtn active={tab === 'payments'} onClick={() => setTab('payments')} icon={<HandCoins size={14} />}>
            Règlements ({myPayments.length})
          </TabBtn>
        </div>

        {/* Recherche + période */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className="pl-9" />
          </div>
          <Button size="sm" variant={usePeriod ? 'gold' : 'secondary'} onClick={() => setUsePeriod((v) => !v)}>
            Par période
          </Button>
          {usePeriod && (
            <div className="flex items-center gap-2">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="max-w-[160px]" />
              <span className="text-xs text-text-muted">à</span>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="max-w-[160px]" />
            </div>
          )}
        </div>

        {/* Contenu */}
        {tab === 'purchases' ? (
          myPurchases.length === 0 ? (
            <EmptyState message="Aucun achat affecté à ce livreur" icon={<ShoppingBag size={28} />} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-vanilla/60 text-left">
                  <tr>
                    <th className="px-3 py-2">Réf.</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Bon</th>
                    <th className="px-3 py-2 text-right">Coût livreur</th>
                    <th className="px-3 py-2 text-right">Payé</th>
                    <th className="px-3 py-2 text-right">Reste</th>
                  </tr>
                </thead>
                <tbody>
                  {myPurchases.map((p) => {
                    const rest = Math.max(0, p.cost - p.paid);
                    return (
                      <tr key={p.id} className="border-t border-gold/10">
                        <td className="px-3 py-2 font-semibold">{p.reference}</td>
                        <td className="px-3 py-2">{p.date ? formatDate(p.date, language) : '—'}</td>
                        <td className="px-3 py-2 text-text-muted">{p.bonNumber || '—'}</td>
                        <td className="px-3 py-2 text-right tabular">{formatCurrency(p.cost)}</td>
                        <td className="px-3 py-2 text-right tabular text-pistachio">{formatCurrency(p.paid)}</td>
                        <td className={`px-3 py-2 text-right tabular font-bold ${rest > 0.004 ? 'text-rose-deep' : 'text-pistachio'}`}>
                          {formatCurrency(rest)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : myPayments.length === 0 ? (
          <EmptyState message="Aucun règlement enregistré pour ce livreur" icon={<HandCoins size={28} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-vanilla/60 text-left">
                <tr>
                  <th className="px-3 py-2">Date & heure</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {myPayments.map((p) => (
                  <tr key={p.id} className="border-t border-gold/10">
                    <td className="px-3 py-2">{formatDateTime(p.paidAt, language)}</td>
                    <td className="px-3 py-2">
                      <Badge variant="info" className="text-[10px]">
                        {paymentMethodLabel(p)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-text-muted">{p.notes || '—'}</td>
                    <td className="px-3 py-2 text-right tabular font-bold text-pistachio">{formatCurrency(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone = 'neutral', icon }: { label: string; value: string; tone?: 'neutral' | 'pos' | 'neg'; icon?: React.ReactNode }) {
  const color = tone === 'pos' ? 'text-pistachio' : tone === 'neg' ? 'text-rose-deep' : 'text-text-primary';
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 p-3">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-muted">{icon} {label}</p>
      <p className={`mt-1 text-sm font-bold tabular ${color}`}>{value}</p>
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-gold/15 text-gold-dark' : 'text-text-muted hover:bg-gold/5'
      }`}
    >
      {icon} {children}
    </button>
  );
}
