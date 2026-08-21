import { useMemo, useState } from 'react';
import { ShoppingCart, Plus, Eye, Wallet, Printer, Trash2, Calendar, Folder, DollarSign, TrendingDown, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { CreatePurchase } from './CreatePurchase';
import { PayDebtModal } from '@/components/shared/PayDebtModal';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useStockStore } from '@/store/stockStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, matchesDateFilter, isWithinRange, type DateFilter } from '@/lib/utils';
import { printInvoice } from '@/lib/print';
import { toast } from '@/components/ui/Toast';
import type { Purchase } from '@/types';

export default function PurchasePage() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const { purchases, payDebt, deletePurchase } = usePurchaseStore();
  const suppliers = useSupplierStore((s) => s.suppliers);
  const settings = useSettingsStore((s) => s.settings);
  const stockProducts = useStockStore((s) => s.products);
  const units = useStockStore((s) => s.units);

  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter | 'period'>('all');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [unitFilter, setUnitFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState<Purchase | null>(null);
  const [paying, setPaying] = useState<Purchase | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name || '—';

  const filtered = useMemo(() => {
    return purchases.filter((p) => {
      const matchSearch = supplierName(p.supplierId).toLowerCase().includes(search.toLowerCase()) || p.reference.toLowerCase().includes(search.toLowerCase());
      
      const matchDate = dateFilter === 'period'
        ? isWithinRange(p.date, startDate, endDate)
        : matchesDateFilter(p.date, dateFilter as DateFilter);

      const matchUnit = !unitFilter || p.products.some((line) => {
        const prod = stockProducts.find((sp) => sp.id === line.productId);
        return (line.unit || prod?.unit) === unitFilter;
      });

      return matchSearch && matchDate && matchUnit;
    });
  }, [purchases, search, dateFilter, startDate, endDate, unitFilter, stockProducts, suppliers]);

  // Statistics calculation for the filtered purchases
  const stats = useMemo(() => {
    let totalPurchases = 0;
    let totalPaid = 0;
    let totalDebt = 0;
    filtered.forEach((p) => {
      totalPurchases += p.totalAmount;
      totalPaid += p.paidAmount;
      totalDebt += p.restAmount;
    });
    return { totalPurchases, totalPaid, totalDebt };
  }, [filtered]);

  /** Units involved in an invoice — displayed as badges on the card. */
  const getPurchaseUnits = (purchase: Purchase) => {
    const list = purchase.products
      .map((line) => line.unit || stockProducts.find((sp) => sp.id === line.productId)?.unit || null)
      .filter(Boolean) as string[];
    return Array.from(new Set(list));
  };

  const handlePrint = (p: Purchase) => {
    const sup = suppliers.find((s) => s.id === p.supplierId);
    printInvoice({
      type: 'purchase', reference: p.reference, date: p.date,
      partyName: sup?.name || '—', partyPhone: sup?.phone, partyAddress: sup?.address,
      lines: p.products.map((l) => ({ designation: l.productName || '', quantity: l.quantity, unitPrice: l.purchasePrice })),
      total: p.totalAmount, paid: p.paidAmount, rest: p.restAmount,
    }, settings);
  };

  return (
    <div>
      <PageHeader title={t('purchase')} icon={<ShoppingCart size={24} />} subtitle={`${purchases.length} factures`}
        actions={can('purchase', 'create') && <Button variant="gold" onClick={() => setCreateOpen(true)}><Plus size={18} /> {t('newPurchase')}</Button>}
      />

      {/* Stats Cards Section */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 animate-fadeIn">
        <div className="bg-gradient-to-br from-gold/10 to-gold/5 border border-gold/20 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Total des Achats</p>
            <p className="text-xl font-bold text-gold-dark mt-1 tabular">{formatCurrency(stats.totalPurchases)}</p>
          </div>
          <div className="bg-gold/15 p-3 rounded-xl text-gold-dark">
            <DollarSign size={20} />
          </div>
        </div>

        <div className="bg-gradient-to-br from-pistachio/10 to-pistachio/5 border border-pistachio/20 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Total Payé</p>
            <p className="text-xl font-bold text-pistachio mt-1 tabular">{formatCurrency(stats.totalPaid)}</p>
          </div>
          <div className="bg-pistachio/15 p-3 rounded-xl text-pistachio">
            <CheckCircle2 size={20} />
          </div>
        </div>

        <div className="bg-gradient-to-br from-rose-deep/10 to-rose-deep/5 border border-rose-deep/20 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Total Dette / Restant</p>
            <p className="text-xl font-bold text-rose-deep mt-1 tabular">{formatCurrency(stats.totalDebt)}</p>
          </div>
          <div className="bg-rose-deep/15 p-3 rounded-xl text-rose-deep">
            <TrendingDown size={20} />
          </div>
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6 bg-vanilla/20 p-4 rounded-2xl border border-gold/10">
        <div className="flex-1 min-w-[200px]">
          <SearchBar value={search} onChange={setSearch} placeholder={`${t('search')} ${t('supplier')} ou Réf.`} />
        </div>
        
        {/* Unit filtering */}
        <div className="w-[180px] flex items-center gap-2">
          <Folder size={16} className="text-gold-dark shrink-0" />
          <Select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            placeholder="Toutes unités"
            options={units.map((u) => ({ value: u.name, label: u.name }))}
            className="w-full"
          />
        </div>

        {/* Date filtering */}
        <div className="w-[180px] flex items-center gap-2">
          <Calendar size={16} className="text-gold-dark shrink-0" />
          <Select 
            value={dateFilter} 
            onChange={(e) => setDateFilter(e.target.value as any)}
            options={[
              { value: 'all', label: t('all') }, 
              { value: 'today', label: 'Ce jour' }, 
              { value: 'week', label: 'La semaine dernière' }, 
              { value: 'month', label: 'Le mois dernier' },
              { value: 'period', label: 'Par période' }
            ]}
            className="w-full" 
          />
        </div>

        {/* Period inputs */}
        {dateFilter === 'period' && (
          <div className="flex items-center gap-2 animate-fadeIn bg-vanilla/40 px-3 py-1.5 rounded-xl border border-gold/10">
            <input 
              type="date" 
              value={startDate} 
              onChange={(e) => setStartDate(e.target.value)} 
              className="text-xs bg-transparent border-0 focus:outline-none font-medium tabular text-text-primary"
            />
            <span className="text-xs text-text-muted">à</span>
            <input 
              type="date" 
              value={endDate} 
              onChange={(e) => setEndDate(e.target.value)} 
              className="text-xs bg-transparent border-0 focus:outline-none font-medium tabular text-text-primary"
            />
          </div>
        )}
      </div>

      {filtered.length === 0 ? <EmptyState message={t('noData')} /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 animate-fadeIn">
          {filtered.map((p, i) => {
            const cats = getPurchaseUnits(p);
            return (
              <Card key={p.id} index={i} hoverable className="flex flex-col border border-gold/10 hover:border-gold/30 transition-all duration-300">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-display font-semibold text-text-primary">{p.reference}</h3>
                  <span className="text-xs text-text-muted">{formatDate(p.date, language)}</span>
                </div>
                <p className="text-sm font-semibold text-text-secondary mb-1">{supplierName(p.supplierId)}</p>
                <p className="text-xs text-text-muted mb-2">{p.products.length} article(s)</p>
                
                {/* Categories Badge Display */}
                {cats.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {cats.map((catName) => (
                      <Badge key={catName} variant="info" className="bg-gold/10 text-gold-dark border-0 text-[10px] py-0.5 px-2">
                        {catName}
                      </Badge>
                    ))}
                  </div>
                )}

                {p.createdBy && <p className="text-xs text-text-muted mb-3">{t('createdBy')}: {p.createdBy}</p>}
                
                <div className="bg-vanilla/40 rounded-xl p-3 space-y-1.5 text-xs mb-3">
                  <div className="flex justify-between"><span className="text-text-muted">{t('total')}</span><span className="tabular font-semibold text-text-primary">{formatCurrency(p.totalAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-text-muted">{t('paid')}</span><span className="tabular text-pistachio font-medium">{formatCurrency(p.paidAmount)}</span></div>
                  <div className="flex justify-between border-t border-gold/5 pt-1.5 mt-1.5"><span className="text-text-muted font-medium">{t('rest')}</span>
                    <span className={`tabular font-bold ${p.restAmount > 0 ? 'text-rose-deep animate-pulse' : 'text-pistachio'}`}>{formatCurrency(p.restAmount)}</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-gold/5">
                  {p.restAmount > 0 ? (
                    <Badge variant="danger" className="bg-rose-deep/10 text-rose-deep border-0 text-[10px]">Dette</Badge>
                  ) : (
                    <Badge variant="success" className="bg-pistachio/10 text-pistachio border-0 text-[10px]">Soldée</Badge>
                  )}
                  
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="secondary" className="px-2" onClick={() => setViewing(p)} title={t('view')}><Eye size={13} /></Button>
                    {can('purchase', 'pay') && p.restAmount > 0 && (
                      <Button size="sm" variant="gold" className="text-xs" onClick={() => setPaying(p)}>
                        <Wallet size={13} /> {t('pay')}
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" className="px-2" onClick={() => handlePrint(p)} title={t('print')}><Printer size={13} /></Button>
                    {can('purchase', 'delete') && (
                      <Button size="sm" variant="ghost" className="px-2 hover:bg-rose-deep/5" onClick={() => setDeleteId(p.id)} title={t('delete')}>
                        <Trash2 size={13} className="text-rose-deep" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('newPurchase')} size="lg">
        <CreatePurchase onClose={() => setCreateOpen(false)} onCreated={(pur) => setViewing(pur)} />
      </Modal>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.reference} size="md">
        {viewing && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">{supplierName(viewing.supplierId)} — {formatDate(viewing.date, language)}</p>
            {viewing.createdBy && <p className="text-xs text-text-muted">{t('createdBy')}: {viewing.createdBy}</p>}
            <table className="w-full text-sm">
              <thead className="bg-vanilla/60"><tr><th className="text-left px-3 py-2">{t('name')}</th><th className="text-right px-3 py-2">{t('quantity')}</th><th className="text-right px-3 py-2">P.U.</th><th className="text-right px-3 py-2">Total</th></tr></thead>
              <tbody>{viewing.products.map((l, i) => (
                <tr key={i} className="border-t border-gold/10"><td className="px-3 py-2">{l.productName}{l.unitEnabled && l.unit ? <span className="text-xs text-gold-dark"> · {l.unit}</span> : null}</td><td className="px-3 py-2 text-right tabular">{l.quantity}{l.unitEnabled && l.unit ? ` ${l.unit}` : ''}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(l.purchasePrice)}{l.unitEnabled && l.unit ? `/${l.unit}` : ''}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(l.quantity * l.purchasePrice)}</td></tr>
              ))}</tbody>
            </table>
            {viewing.payments.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-text-secondary mb-2">Paiements</h4>
                {viewing.payments.map((pay, i) => (
                  <div key={i} className="flex justify-between text-sm py-1 border-b border-gold/10">
                    <span className="text-text-muted">{formatDate(pay.date, language)} — {pay.description}</span>
                    <span className="tabular">{formatCurrency(pay.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <Button variant="outline" onClick={() => handlePrint(viewing)}><Printer size={16} /> {t('print')}</Button>
          </div>
        )}
      </Modal>

      {paying && (
        <PayDebtModal open={!!paying} onClose={() => setPaying(null)} reference={paying.reference} partyName={supplierName(paying.supplierId)}
          total={paying.totalAmount} paid={paying.paidAmount} onPay={(amount, _desc, paidAt) => { void payDebt(paying.id, amount, (paidAt || new Date().toISOString()).slice(0, 10)); }} />
      )}

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => { if (deleteId) { void deletePurchase(deleteId).then(() => toast.success('Facture supprimée')); } }} />
    </div>
  );
}
