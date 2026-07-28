import { useMemo, useState } from 'react';
import { Package, Plus, Eye, Pencil, Trash2, Printer } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProductForm } from '@/components/shared/ProductForm';
import { ProductCard } from './ProductCard';
import { useStockStore } from '@/store/stockStore';
import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { toast } from '@/components/ui/Toast';
import { formatCurrency, formatDate } from '@/lib/utils';
import { printBarcode } from '@/lib/barcodeUtils';
import { BarcodeDisplay } from '@/components/ui/BarcodeDisplay';
import { Badge } from '@/components/ui/Badge';
import type { Product } from '@/types';

export default function Stock() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const { products, marques, categories, addProduct, updateProduct, deleteProduct } = useStockStore();
  const { ficheTechnics } = useFicheTechnicStore();

  const [search, setSearch] = useState('');
  const [marqueFilter, setMarqueFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        const s = search.toLowerCase();
        const matchSearch = p.name.toLowerCase().includes(s) || p.barcode.includes(s);
        const matchMarque = !marqueFilter || p.marqueId === marqueFilter;
        const matchCat = !categoryFilter || p.categoryId === categoryFilter;
        return matchSearch && matchMarque && matchCat;
      }),
    [products, search, marqueFilter, categoryFilter]
  );

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (p: Product) => { setEditing(p); setFormOpen(true); };

  const handleDeleteProduct = () => {
    if (!deleteId) return;
    const usedIn = ficheTechnics.filter((ft) =>
      ft.usedProducts.some((u) => u.sourceType !== 'fiche' && u.productId === deleteId)
    );
    if (usedIn.length > 0) {
      toast.error(`Impossible de supprimer : utilisé dans la fiche technique « ${usedIn[0].name} »${usedIn.length > 1 ? ` et ${usedIn.length - 1} autre(s)` : ''}`);
      setDeleteId(null);
      return;
    }
    deleteProduct(deleteId);
    toast.success('Produit supprimé');
    setDeleteId(null);
  };

  const handleSubmit = (data: Omit<Product, 'id' | 'createdAt'>) => {
    if (editing) {
      updateProduct(editing.id, data);
      toast.success('Produit modifié');
    } else {
      addProduct(data);
      toast.success('Produit créé');
    }
    setFormOpen(false);
    setEditing(null);
  };

  const marqueName = (id: string) => marques.find((m) => m.id === id)?.name || '—';
  const catName = (id: string) => categories.find((c) => c.id === id)?.name || '—';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('stock')} icon={<Package size={24} />}
        subtitle={`${products.length} produits enregistrés`}
        actions={can('stock', 'create') && (
          <Button variant="gold" onClick={openCreate}><Plus size={18} /> {t('newProduct')}</Button>
        )}
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <SearchBar value={search} onChange={setSearch} placeholder={`${t('search')} (nom / code-barres)...`} />
        </div>
        <Select value={marqueFilter} onChange={(e) => setMarqueFilter(e.target.value)} placeholder={t('marque')}
          options={marques.map((m) => ({ value: m.id, label: m.name }))} className="max-w-[180px]" />
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} placeholder={t('category')}
          options={categories.map((c) => ({ value: c.id, label: c.name }))} className="max-w-[180px]" />
        <ViewToggle view={view} onChange={setView} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message={t('noData')} />
      ) : view === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} marque={marqueName(p.marqueId)} category={catName(p.categoryId)}
              onView={() => setViewing(p)} onEdit={() => openEdit(p)} onDelete={() => setDeleteId(p.id)} canEdit={can('stock', 'edit')} canDelete={can('stock', 'delete')} />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gold/15 bg-gradient-card shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-vanilla/70 text-text-secondary border-b border-gold/15">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">{t('productName')}</th>
                <th className="text-left px-4 py-3 font-semibold">{t('category')}</th>
                <th className="text-right px-4 py-3 font-semibold">{t('currentQty')}</th>
                <th className="text-right px-4 py-3 font-semibold">{t('purchasePrice')}</th>
                <th className="text-center px-4 py-3 font-semibold">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t border-gold/10 hover:bg-gold/5 transition-colors">
                  <td className="px-4 py-3 font-medium text-text-primary">
                    <div className="flex flex-col">
                      <span>{p.name}</span>
                      <span className="text-xs text-text-muted">{marqueName(p.marqueId)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3"><Badge variant="info">{catName(p.categoryId)}</Badge></td>
                  <td className="px-4 py-3 text-right tabular">
                    <span className={p.currentQuantity <= p.minAlertQuantity ? 'text-rose-deep font-bold animate-pulse' : 'text-pistachio font-semibold'}>
                      {p.currentQuantity}{p.unitEnabled && p.unit ? ` ${p.unit}` : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular font-bold text-gold">
                    {formatCurrency(p.purchasePrice)}{p.unitEnabled && p.unit ? `/${p.unit}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setViewing(p)} title={t('view')}><Eye size={16} /></Button>
                      {can('stock', 'edit') && <Button size="icon" variant="ghost" onClick={() => openEdit(p)} title={t('edit')}><Pencil size={16} /></Button>}
                      {can('stock', 'delete') && <Button size="icon" variant="ghost" onClick={() => setDeleteId(p.id)} title={t('delete')}><Trash2 size={16} className="text-rose-deep" /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit modal */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('edit') : t('newProduct')} size="lg">
        <ProductForm initial={editing} onSubmit={handleSubmit} onCancel={() => setFormOpen(false)} />
      </Modal>

      {/* View modal */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name} size="md">
        {viewing && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">{viewing.description}</p>
            <div className="grid grid-cols-2 gap-3">
              <DetailRow label={t('marque')} value={marqueName(viewing.marqueId)} />
              <DetailRow label={t('category')} value={catName(viewing.categoryId)} />
              {viewing.unitEnabled && viewing.unit && <DetailRow label={t('unit')} value={viewing.unit} />}
              <DetailRow label={t('principalQty')} value={`${viewing.principalQuantity}${viewing.unitEnabled && viewing.unit ? ' ' + viewing.unit : ''}`} />
              <DetailRow label={t('currentQty')} value={`${viewing.currentQuantity}${viewing.unitEnabled && viewing.unit ? ' ' + viewing.unit : ''}`} />
              <DetailRow label={t('minAlertQty')} value={`${viewing.minAlertQuantity}${viewing.unitEnabled && viewing.unit ? ' ' + viewing.unit : ''}`} />
              <DetailRow label={viewing.unitEnabled && viewing.unit ? `${t('purchasePrice')} / ${viewing.unit}` : t('purchasePrice')} value={formatCurrency(viewing.purchasePrice)} />
              {viewing.expirationEnabled && <DetailRow label={t('expirationDate')} value={formatDate(viewing.expirationDate || '', language)} />}
              <DetailRow label="Créé le" value={formatDate(viewing.createdAt, language)} />
              {viewing.createdBy && <DetailRow label={t('createdBy')} value={viewing.createdBy} />}
            </div>
            <div className="bg-vanilla/60 rounded-xl p-4 border border-gold/20 flex flex-col items-center gap-3">
              <BarcodeDisplay value={viewing.barcode} height={60} />
              <Button variant="gold" size="sm" onClick={() => printBarcode(viewing.barcode, viewing.name)}>
                <Printer size={16} /> {t('print')} code-barres
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDeleteProduct} />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-vanilla/40 rounded-xl px-3.5 py-2 border border-gold/10">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-sm font-semibold text-text-primary tabular">{value}</p>
    </div>
  );
}
