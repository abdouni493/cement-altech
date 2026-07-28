import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Beaker, Trash2, Flame, BarChart3, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Checkbox } from '@/components/ui/Switch';
import { useComptoirStore } from '@/store/comptoirStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { ComptoirItem } from '@/types';

export default function ComptoirPage() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const {
    items,
    destructions,
    destroy,
    recoverDestruction,
    deleteDestructions,
    recoverDestructions,
  } = useComptoirStore();

  const [tab, setTab] = useState('available');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [destroying, setDestroying] = useState<ComptoirItem | null>(null);
  const [destroyQty, setDestroyQty] = useState<number>(1);
  const [reason, setReason] = useState('');
  const [recoverId, setRecoverId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkRecoverConfirm, setBulkRecoverConfirm] = useState(false);

  // Distinct production categories present on the comptoir.
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.categoryName) set.add(i.categoryName); });
    return [...set].map((name) => ({ value: name, label: name }));
  }, [items]);

  const filtered = useMemo(
    () => items.filter((i) =>
      i.quantity > 0 &&
      i.productName.toLowerCase().includes(search.toLowerCase()) &&
      (!categoryFilter || i.categoryName === categoryFilter)
    ),
    [items, search, categoryFilter]
  );

  const totalDestroyed = useMemo(() => destructions.reduce((s, d) => s + d.value, 0), [destructions]);

  const showBulkActions = can('comptoir', 'delete') || can('comptoir', 'edit');
  const allSelected = destructions.length > 0 && selectedIds.length === destructions.length;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(destructions.map((d) => d.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => [...prev, id]);
    } else {
      setSelectedIds((prev) => prev.filter((item) => item !== id));
    }
  };

  const handleDestroy = () => {
    if (!destroying) return;
    if (destroyQty <= 0 || destroyQty > destroying.quantity) { toast.error('Quantité invalide'); return; }
    destroy(destroying.id, destroyQty, reason || 'Non spécifié');
    toast.success('Destruction enregistrée');
    setDestroying(null); setDestroyQty(1); setReason('');
  };

  const handleBulkDelete = () => {
    deleteDestructions(selectedIds);
    toast.success('Destructions supprimées');
    setSelectedIds([]);
  };

  const handleBulkRecover = () => {
    recoverDestructions(selectedIds);
    toast.success('Produits récupérés et remis au comptoir');
    setSelectedIds([]);
  };

  return (
    <div>
      <PageHeader title={t('comptoir')} icon={<Beaker size={24} />} subtitle={`${filtered.length} produits disponibles`}
        actions={<Button variant="secondary" onClick={() => navigate('/caisse/statistics')}><BarChart3 size={18} /> {t('comptoirStats')}</Button>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <Tabs tabs={[{ id: 'available', label: t('available') }, { id: 'destructions', label: t('destructionHistory') }]} active={tab} onChange={setTab} />
        {tab === 'available' && (
          <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[200px] justify-end">
            <div className="flex-1 min-w-[180px] max-w-sm"><SearchBar value={search} onChange={setSearch} placeholder={t('search')} /></div>
            {categoryOptions.length > 0 && (
              <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} placeholder={t('allCategories')} options={categoryOptions} className="max-w-[200px]" />
            )}
          </div>
        )}
      </div>

      {tab === 'available' ? (
        filtered.length === 0 ? <EmptyState message={t('noData')} /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((item, i) => (
              <Card key={item.id} index={i} hoverable className="flex flex-col">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-display font-semibold text-text-primary">{item.productName}</h3>
                  {item.categoryName && <Badge variant="info">{item.categoryName}</Badge>}
                </div>
                <p className="text-xs text-text-muted mb-3">Production: {formatDate(item.date, language)}</p>
                <div className="bg-vanilla/40 rounded-xl p-3 space-y-1 text-sm mb-3">
                  <div className="flex justify-between"><span className="text-text-muted">{t('available')}</span><span className="tabular font-bold text-pistachio">{item.quantity} {item.sellByUnit && item.unit ? item.unit : 'unités'}</span></div>
                  <div className="flex justify-between"><span className="text-text-muted">{item.sellByUnit && item.unit ? `${t('unitPrice')} / ${item.unit}` : t('unitPrice')}</span><span className="tabular">{formatCurrency(item.unitPrice)}</span></div>
                  <div className="flex justify-between"><span className="text-text-muted">{t('totalValue')}</span><span className="tabular font-semibold text-gold-dark">{formatCurrency(item.quantity * item.unitPrice)}</span></div>
                </div>
                {can('comptoir', 'delete') && (
                  <Button size="sm" variant="danger" className="mt-auto" onClick={() => { setDestroying(item); setDestroyQty(1); }}>
                    <Flame size={14} /> {t('destruction')}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )
      ) : (
        <div>
          <Card index={0} className="mb-4 flex items-center justify-between">
            <span className="text-text-secondary font-medium">Total valeur détruite</span>
            <span className="text-xl font-bold text-rose-deep tabular">{formatCurrency(totalDestroyed)}</span>
          </Card>

          {selectedIds.length > 0 && showBulkActions && (
            <div className="mb-4 p-4 bg-vanilla/60 border border-gold/20 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-card animate-fadeIn">
              <span className="text-sm text-text-secondary font-medium">
                {language === 'ar'
                  ? `تم تحديد ${selectedIds.length}`
                  : `${selectedIds.length} ${selectedIds.length === 1 ? 'élément sélectionné' : 'éléments sélectionnés'}`}
              </span>
              <div className="flex gap-2">
                {can('comptoir', 'edit') && (
                  <Button size="sm" variant="secondary" onClick={() => setBulkRecoverConfirm(true)}>
                    <RotateCcw size={14} /> {t('recover')}
                  </Button>
                )}
                {can('comptoir', 'delete') && (
                  <Button size="sm" variant="danger" onClick={() => setBulkDeleteConfirm(true)}>
                    <Trash2 size={14} /> {t('delete')}
                  </Button>
                )}
              </div>
            </div>
          )}

          {destructions.length === 0 ? <EmptyState message={t('noData')} /> : (
            <div className="overflow-x-auto rounded-2xl border border-gold/15 bg-gradient-card shadow-card">
              <table className="w-full text-sm">
                <thead className="bg-vanilla/60 text-text-secondary"><tr>
                  {showBulkActions && (
                    <th className="w-12 px-4 py-3 text-center">
                      <Checkbox checked={allSelected} onChange={handleSelectAll} />
                    </th>
                  )}
                  <th className="text-left px-4 py-3">{t('date')}</th><th className="text-left px-4 py-3">{t('name')}</th>
                  <th className="text-right px-4 py-3">{t('quantity')}</th><th className="text-right px-4 py-3">Valeur</th><th className="text-left px-4 py-3">{t('reason')}</th>
                  <th className="text-center px-4 py-3">{t('actions')}</th>
                </tr></thead>
                <tbody>{destructions.map((d) => (
                  <tr key={d.id} className="border-t border-gold/10">
                    {showBulkActions && (
                      <td className="px-4 py-3 text-center">
                        <Checkbox checked={selectedIds.includes(d.id)} onChange={(checked) => handleSelectRow(d.id, checked)} />
                      </td>
                    )}
                    <td className="px-4 py-3">{formatDate(d.date, language)}</td><td className="px-4 py-3 font-medium">{d.productName}</td>
                    <td className="px-4 py-3 text-right tabular">{d.quantity}{d.unit ? ` ${d.unit}` : ''}</td><td className="px-4 py-3 text-right tabular text-rose-deep">{formatCurrency(d.value)}</td><td className="px-4 py-3 text-text-muted">{d.reason}{d.createdBy ? <span className="block text-xs">{t('createdBy')}: {d.createdBy}</span> : null}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {can('comptoir', 'edit') && (
                          <Button size="sm" variant="secondary" onClick={() => setRecoverId(d.id)} title={t('recover')}>
                            <RotateCcw size={14} /> {t('recover')}
                          </Button>
                        )}
                        {can('comptoir', 'delete') && (
                          <Button size="sm" variant="danger" onClick={() => setDeleteId(d.id)} title={t('delete')}>
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal open={!!destroying} onClose={() => setDestroying(null)} title={t('destruction')} size="sm">
        {destroying && (
          <div className="space-y-4">
            <div className="bg-vanilla/50 rounded-xl p-3 text-sm">
              <p className="font-semibold text-text-primary">{destroying.productName}</p>
              <p className="text-text-muted">{t('available')}: {destroying.quantity} {destroying.sellByUnit && destroying.unit ? destroying.unit : 'unités'}</p>
            </div>
            <Input label={`${t('qtyToDestroy')} (max ${destroying.quantity}${destroying.sellByUnit && destroying.unit ? ' ' + destroying.unit : ''})`} type="number" step={destroying.sellByUnit ? 'any' : '1'} value={destroyQty} onChange={(e) => setDestroyQty(Number(e.target.value))} />
            <Input label={t('reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: Invendus, abîmé..." />
            <div className="flex justify-between bg-rose/5 rounded-xl p-3 text-sm">
              <span className="text-text-muted">Valeur détruite</span>
              <span className="tabular font-bold text-rose-deep">{formatCurrency(destroyQty * destroying.unitPrice)}</span>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDestroying(null)}>{t('cancel')}</Button>
              <Button variant="danger" onClick={handleDestroy}><Trash2 size={16} /> {t('confirm')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!recoverId}
        onClose={() => setRecoverId(null)}
        onConfirm={() => { if (recoverId) { recoverDestruction(recoverId); toast.success('Produit récupéré et remis au comptoir'); } }}
        title={t('recover')}
        message={t('recoverConfirm')}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) { deleteDestructions([deleteId]); setSelectedIds((prev) => prev.filter((item) => item !== deleteId)); toast.success('Destruction supprimée'); } }}
        title={t('delete')}
        message={t('deleteConfirm')}
      />

      <ConfirmDialog
        open={bulkDeleteConfirm}
        onClose={() => setBulkDeleteConfirm(false)}
        onConfirm={handleBulkDelete}
        title={t('delete')}
        message={t('deleteSelectedConfirm')}
      />

      <ConfirmDialog
        open={bulkRecoverConfirm}
        onClose={() => setBulkRecoverConfirm(false)}
        onConfirm={handleBulkRecover}
        title={t('recover')}
        message={t('recoverSelectedConfirm')}
      />
    </div>
  );
}
