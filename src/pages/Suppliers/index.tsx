import { useMemo, useState } from 'react';
import { Truck, Plus, Eye, Pencil, Trash2, Phone, MapPin } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { SupplierForm } from '@/components/shared/SupplierForm';
import { PayDebtModal } from '@/components/shared/PayDebtModal';
import { useSupplierStore } from '@/store/supplierStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { Supplier, Purchase } from '@/types';

export default function SuppliersPage() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const { suppliers, addSupplier, updateSupplier, deleteSupplier } = useSupplierStore();
  const { purchases, payDebt } = usePurchaseStore();

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<Supplier | null>(null);
  const [paying, setPaying] = useState<Purchase | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const stats = (id: string) => {
    const ps = purchases.filter((p) => p.supplierId === id);
    return { count: ps.length, total: ps.reduce((s, x) => s + x.totalAmount, 0), paid: ps.reduce((s, x) => s + x.paidAmount, 0), rest: ps.reduce((s, x) => s + x.restAmount, 0), list: ps };
  };

  const filtered = useMemo(() => suppliers.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()) || s.phone.includes(search)), [suppliers, search]);

  const handleSubmit = (data: Omit<Supplier, 'id'>) => {
    if (editing) { updateSupplier(editing.id, data); toast.success('Fournisseur modifié'); }
    else { addSupplier(data); toast.success('Fournisseur créé'); }
    setFormOpen(false); setEditing(null);
  };

  return (
    <div>
      <PageHeader title={t('suppliers')} icon={<Truck size={24} />} subtitle={`${suppliers.length} fournisseurs`}
        actions={can('suppliers', 'create') && <Button variant="gold" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus size={18} /> {t('newSupplier')}</Button>} />

      <div className="mb-6 max-w-md"><SearchBar value={search} onChange={setSearch} placeholder={t('search')} /></div>

      {filtered.length === 0 ? <EmptyState message={t('noData')} /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((s, i) => {
            const st = stats(s.id);
            return (
              <Card key={s.id} index={i} hoverable className="flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-11 w-11 rounded-xl bg-gradient-button flex items-center justify-center text-white"><Truck size={20} /></div>
                  <div className="min-w-0"><h3 className="font-display font-semibold text-text-primary truncate">{s.name}</h3>
                    <p className="text-xs text-text-muted flex items-center gap-1"><Phone size={11} /> {s.phone}</p></div>
                </div>
                <p className="text-xs text-text-muted flex items-start gap-1 mb-3"><MapPin size={12} className="mt-0.5 shrink-0" /> {s.address}</p>
                {st.rest > 0 && <Badge variant="danger" className="mb-3 self-start">Dette {formatCurrency(st.rest)}</Badge>}
                <div className="flex gap-1.5 mt-auto">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => setHistory(s)}><Eye size={14} /> Achats</Button>
                  {can('suppliers', 'edit') && <Button size="sm" variant="ghost" onClick={() => { setEditing(s); setFormOpen(true); }}><Pencil size={14} /></Button>}
                  {can('suppliers', 'delete') && <Button size="sm" variant="ghost" onClick={() => setDeleteId(s.id)}><Trash2 size={14} className="text-rose-deep" /></Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('edit') : t('newSupplier')} size="sm">
        <SupplierForm initial={editing} onSubmit={handleSubmit} onCancel={() => setFormOpen(false)} />
      </Modal>

      <Modal open={!!history} onClose={() => setHistory(null)} title={history?.name} size="lg">
        {history && (() => {
          const st = stats(history.id);
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Tile label={t('totalPurchases')} value={formatCurrency(st.total)} />
                <Tile label={t('totalPaid')} value={formatCurrency(st.paid)} color="text-pistachio" />
                <Tile label={t('totalRest')} value={formatCurrency(st.rest)} color="text-rose-deep" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-vanilla/60"><tr><th className="text-left px-3 py-2">N°</th><th className="text-left px-3 py-2">{t('date')}</th><th className="text-right px-3 py-2">Articles</th><th className="text-right px-3 py-2">{t('total')}</th><th className="text-right px-3 py-2">{t('rest')}</th><th className="px-3 py-2"></th></tr></thead>
                  <tbody>{st.list.map((p) => (
                    <tr key={p.id} className="border-t border-gold/10">
                      <td className="px-3 py-2">{p.reference}</td><td className="px-3 py-2">{formatDate(p.date, language)}</td>
                      <td className="px-3 py-2 text-right tabular">{p.products.length}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(p.totalAmount)}</td>
                      <td className="px-3 py-2 text-right tabular text-rose-deep">{formatCurrency(p.restAmount)}</td>
                      <td className="px-3 py-2 text-center">{p.restAmount > 0 ? <Button size="sm" variant="gold" onClick={() => setPaying(p)}>{t('pay')}</Button> : <Badge variant="success">OK</Badge>}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {st.list.length === 0 && <p className="text-center text-text-muted py-6">{t('noData')}</p>}
              </div>
            </div>
          );
        })()}
      </Modal>

      {paying && <PayDebtModal open={!!paying} onClose={() => setPaying(null)} reference={paying.reference} partyName={history?.name || ''} total={paying.totalAmount} paid={paying.paidAmount} onPay={(a, d) => payDebt(paying.id, a, d)} />}

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => { if (deleteId) { deleteSupplier(deleteId); toast.success('Fournisseur supprimé'); } }} />
    </div>
  );
}

function Tile({ label, value, color = 'text-text-primary' }: { label: string; value: string; color?: string }) {
  return <div className="bg-vanilla/40 rounded-xl p-3 text-center"><p className="text-xs text-text-muted mb-0.5">{label}</p><p className={`text-base font-bold tabular ${color}`}>{value}</p></div>;
}
