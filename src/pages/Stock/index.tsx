import { useMemo, useState } from 'react';
import { Package, Plus, Eye, Pencil, Trash2, AlertTriangle, Boxes, Coins, Ruler } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/shared/StatCard';
import { ProductForm } from '@/components/shared/ProductForm';
import { ProductCard } from './ProductCard';
import { useStockStore } from '@/store/stockStore';
import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { toast } from '@/components/ui/Toast';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Product } from '@/types';

type StockFilter = 'all' | 'low' | 'out' | 'ok';

export default function Stock() {
  const { language } = useLanguage();
  const { can } = usePermissions();
  const products = useStockStore((s) => s.products);
  const units = useStockStore((s) => s.units);
  const addProduct = useStockStore((s) => s.addProduct);
  const updateProduct = useStockStore((s) => s.updateProduct);
  const deleteProduct = useStockStore((s) => s.deleteProduct);
  const { ficheTechnics } = useFicheTechnicStore();

  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        const s = search.toLowerCase();
        const matchSearch =
          p.name.toLowerCase().includes(s) || (p.description || '').toLowerCase().includes(s);
        const matchUnit = !unitFilter || p.unit === unitFilter;
        const low = p.currentQuantity <= p.minAlertQuantity;
        const out = p.currentQuantity <= 0;
        const matchStock =
          stockFilter === 'all' ||
          (stockFilter === 'low' && low && !out) ||
          (stockFilter === 'out' && out) ||
          (stockFilter === 'ok' && !low);
        return matchSearch && matchUnit && matchStock;
      }),
    [products, search, unitFilter, stockFilter]
  );

  const stats = useMemo(() => {
    const value = products.reduce((s, p) => s + p.currentQuantity * p.purchasePrice, 0);
    const low = products.filter((p) => p.currentQuantity <= p.minAlertQuantity && p.currentQuantity > 0).length;
    const out = products.filter((p) => p.currentQuantity <= 0).length;
    return { value, low, out, count: products.length };
  }, [products]);

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (p: Product) => { setEditing(p); setFormOpen(true); };

  const handleDeleteProduct = async () => {
    if (!deleteId) return;
    const usedIn = ficheTechnics.filter((ft) =>
      ft.usedProducts.some((u) => u.sourceType !== 'fiche' && u.productId === deleteId)
    );
    if (usedIn.length > 0) {
      toast.error(
        `Impossible de supprimer : utilisé dans la fiche technique « ${usedIn[0].name} »` +
          (usedIn.length > 1 ? ` et ${usedIn.length - 1} autre(s)` : '')
      );
      setDeleteId(null);
      return;
    }
    try {
      await deleteProduct(deleteId);
      toast.success('Produit supprimé');
    } finally {
      setDeleteId(null);
    }
  };

  const handleSubmit = async (data: Omit<Product, 'id' | 'createdAt'>) => {
    if (editing) {
      await updateProduct(editing.id, data);
      toast.success('Produit modifié');
    } else {
      await addProduct(data);
      toast.success('Produit créé');
    }
    setFormOpen(false);
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestion de stock"
        icon={<Package size={24} />}
        subtitle={`${products.length} produit(s) · ${formatCurrency(stats.value)} de valeur en stock`}
        actions={
          can('stock', 'create') && (
            <Button variant="gold" onClick={openCreate}>
              <Plus size={18} /> Nouveau produit
            </Button>
          )
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Produits référencés" value={stats.count} icon={<Boxes size={22} />} index={0} accent="gold" />
        <StatCard label="Valeur du stock" value={stats.value} format="currency" icon={<Coins size={22} />} index={1} accent="pistachio" />
        <StatCard label="Stock faible" value={stats.low} icon={<AlertTriangle size={22} />} index={2} accent="caramel" />
        <StatCard label="Ruptures" value={stats.out} icon={<AlertTriangle size={22} />} index={3} accent="rose" />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un produit (nom / description)…" />
        </div>
        <Select
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
          placeholder="Toutes les unités"
          options={units.map((u) => ({ value: u.name, label: u.name }))}
          className="max-w-[180px]"
        />
        <Select
          value={stockFilter}
          onChange={(e) => setStockFilter(e.target.value as StockFilter)}
          options={[
            { value: 'all', label: 'Tout le stock' },
            { value: 'ok', label: 'Stock sain' },
            { value: 'low', label: 'Stock faible' },
            { value: 'out', label: 'En rupture' },
          ]}
          className="max-w-[180px]"
        />
        <ViewToggle view={view} onChange={setView} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="Aucun produit ne correspond à ces filtres" />
      ) : view === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p, i) => (
            <ProductCard
              key={p.id}
              product={p}
              index={i}
              onView={() => setViewing(p)}
              onEdit={() => openEdit(p)}
              onDelete={() => setDeleteId(p.id)}
              canEdit={can('stock', 'edit')}
              canDelete={can('stock', 'delete')}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gold/15 bg-gradient-card shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-vanilla/70 text-text-secondary border-b border-gold/15">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Produit</th>
                <th className="text-left px-4 py-3 font-semibold">Unité</th>
                <th className="text-right px-4 py-3 font-semibold">Stock</th>
                <th className="text-right px-4 py-3 font-semibold">Alerte</th>
                <th className="text-right px-4 py-3 font-semibold">Prix d'achat</th>
                <th className="text-right px-4 py-3 font-semibold">Valeur</th>
                <th className="text-center px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const low = p.currentQuantity <= p.minAlertQuantity;
                return (
                  <tr key={p.id} className="border-t border-gold/10 hover:bg-gold/5 transition-colors">
                    <td className="px-4 py-3 font-medium text-text-primary">
                      <div className="flex flex-col">
                        <span>{p.name}</span>
                        {p.description && <span className="text-xs text-text-muted line-clamp-1">{p.description}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {p.unit ? <Badge variant="warning">{p.unit}</Badge> : <span className="text-text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      <span className={low ? 'text-rose-deep font-bold' : 'text-pistachio font-semibold'}>
                        {p.currentQuantity}{p.unit ? ` ${p.unit}` : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular text-text-muted">{p.minAlertQuantity}</td>
                    <td className="px-4 py-3 text-right tabular font-bold text-gold">
                      {formatCurrency(p.purchasePrice)}{p.unit ? `/${p.unit}` : ''}
                    </td>
                    <td className="px-4 py-3 text-right tabular text-text-secondary">
                      {formatCurrency(p.currentQuantity * p.purchasePrice)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setViewing(p)} title="Détails"><Eye size={16} /></Button>
                        {can('stock', 'edit') && (
                          <Button size="icon" variant="ghost" onClick={() => openEdit(p)} title="Modifier"><Pencil size={16} /></Button>
                        )}
                        {can('stock', 'delete') && (
                          <Button size="icon" variant="ghost" onClick={() => setDeleteId(p.id)} title="Supprimer">
                            <Trash2 size={16} className="text-rose-deep" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Modifier — ${editing.name}` : 'Nouveau produit'}
        size="lg"
      >
        <ProductForm initial={editing} onSubmit={handleSubmit} onCancel={() => setFormOpen(false)} />
      </Modal>

      {/* View modal */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name} size="md">
        {viewing && (
          <div className="space-y-4">
            {viewing.description && (
              <p className="text-sm text-text-secondary bg-vanilla/40 rounded-xl p-3 border border-gold/10">
                {viewing.description}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <DetailRow label="Unité" value={viewing.unit || '—'} icon={<Ruler size={13} />} />
              <DetailRow label="Stock actuel" value={`${viewing.currentQuantity} ${viewing.unit || ''}`} />
              <DetailRow label="Total entré" value={`${viewing.principalQuantity} ${viewing.unit || ''}`} />
              <DetailRow label="Seuil d'alerte" value={`${viewing.minAlertQuantity} ${viewing.unit || ''}`} />
              <DetailRow
                label={viewing.unit ? `Prix d'achat / ${viewing.unit}` : "Prix d'achat"}
                value={formatCurrency(viewing.purchasePrice)}
              />
              <DetailRow
                label="Valeur du stock"
                value={formatCurrency(viewing.currentQuantity * viewing.purchasePrice)}
              />
              {viewing.expirationEnabled && (
                <DetailRow label="Péremption" value={formatDate(viewing.expirationDate || '', language)} />
              )}
              <DetailRow label="Créé le" value={formatDate(viewing.createdAt, language)} />
              {viewing.createdBy && <DetailRow label="Créé par" value={viewing.createdBy} />}
            </div>
            {can('stock', 'edit') && (
              <Button variant="gold" className="w-full" onClick={() => { openEdit(viewing); setViewing(null); }}>
                <Pencil size={16} /> Modifier toutes les informations
              </Button>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDeleteProduct}
        title="Supprimer le produit"
        message="Cette action est définitive. Le produit sera retiré de la base de données."
      />
    </div>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-vanilla/40 rounded-xl px-3.5 py-2 border border-gold/10">
      <p className="text-xs text-text-muted flex items-center gap-1">{icon}{label}</p>
      <p className="text-sm font-semibold text-text-primary tabular">{value}</p>
    </div>
  );
}
