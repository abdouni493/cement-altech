import { useMemo, useState } from 'react';
import { Search, Plus, X, Truck, Package, Wallet, Ruler, Check } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { ProductForm } from '@/components/shared/ProductForm';
import { SupplierForm } from '@/components/shared/SupplierForm';
import { useStockStore } from '@/store/stockStore';
import { useSupplierStore } from '@/store/supplierStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { formatCurrency, todayISO } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { PurchaseLine, Product, Purchase } from '@/types';

interface CreatePurchaseProps {
  onClose: () => void;
  onCreated?: (purchase: Purchase) => void;
}

interface Line extends PurchaseLine {
  _key: string;
  /** live stock before the purchase — shown so the user sees the impact */
  stockBefore: number;
}

export function CreatePurchase({ onClose, onCreated }: CreatePurchaseProps) {
  const products = useStockStore((s) => s.products);
  const addProduct = useStockStore((s) => s.addProduct);
  const { suppliers, addSupplier } = useSupplierStore();
  const addPurchase = usePurchaseStore((s) => s.addPurchase);

  const [productSearch, setProductSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [date, setDate] = useState(todayISO());
  const [showProductForm, setShowProductForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const total = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.purchasePrice) || 0), 0),
    [lines]
  );

  const productResults = useMemo(() => {
    if (!productSearch) return [];
    const s = productSearch.toLowerCase();
    return products
      .filter((p) => p.name.toLowerCase().includes(s) || (p.description || '').toLowerCase().includes(s))
      .slice(0, 8);
  }, [productSearch, products]);

  const supplierResults = useMemo(() => {
    if (!supplierSearch) return [];
    const s = supplierSearch.toLowerCase();
    return suppliers.filter((sup) => sup.name.toLowerCase().includes(s)).slice(0, 6);
  }, [supplierSearch, suppliers]);

  const addLine = (p: Product) => {
    if (lines.some((l) => l.productId === p.id)) {
      toast.warning('Produit déjà ajouté à la facture');
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        _key: p.id + Date.now(),
        productId: p.id,
        productName: p.name,
        quantity: 1,
        minAlertQuantity: p.minAlertQuantity,
        // the price the product is normally bought at — editable per invoice
        purchasePrice: p.purchasePrice,
        unitEnabled: true,
        unit: p.unit || '',
        expirationEnabled: p.expirationEnabled,
        expirationDate: p.expirationDate,
        stockBefore: p.currentQuantity,
      },
    ]);
    setProductSearch('');
  };

  const updateLine = (key: string, data: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l._key === key ? { ...l, ...data } : l)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l._key !== key));

  const handleProductCreated = async (data: Omit<Product, 'id' | 'createdAt'>) => {
    const p = await addProduct(data);
    addLine(p);
    setShowProductForm(false);
    toast.success('Produit créé et ajouté à la facture');
  };

  const handleSupplierCreated = async (data: { name: string; phone: string; address: string }) => {
    const s = await addSupplier(data);
    setSupplierId(s.id);
    setSupplierSearch(s.name);
    setShowSupplierForm(false);
    toast.success('Fournisseur créé');
  };

  const handleCreate = async () => {
    if (lines.length === 0) { toast.error('Ajoutez au moins un produit'); return; }
    if (!supplierId) { toast.error('Sélectionnez un fournisseur'); return; }
    if (lines.some((l) => !(Number(l.quantity) > 0))) {
      toast.error('Chaque produit doit avoir une quantité supérieure à 0');
      return;
    }
    setSaving(true);
    try {
      const purchase = await addPurchase({
        supplierId,
        date,
        products: lines.map(({ _key, stockBefore, ...l }) => ({
          ...l,
          quantity: Number(l.quantity),
          purchasePrice: Number(l.purchasePrice),
        })),
        paidAmount: Number(paidAmount),
      });
      toast.success('Facture enregistrée — quantités du stock mises à jour');
      onCreated?.(purchase);
      onClose();
    } catch {
      /* the store already showed the error */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 1 — Produits */}
      <section className="bg-vanilla/30 rounded-2xl p-4 border border-gold/15">
        <h3 className="font-display font-semibold text-text-primary mb-3 flex items-center gap-2 text-sm">
          <Package size={16} className="text-gold" /> 1. Produits achetés
        </h3>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Rechercher un produit du stock…"
              className="pl-10"
            />
            {productResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-xl border border-gold/20 bg-[--surface-dropdown] shadow-hover overflow-hidden max-h-64 overflow-y-auto">
                {productResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addLine(p)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gold/10 flex items-center justify-between gap-3 border-b border-gold/5 last:border-0"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-text-primary truncate">{p.name}</span>
                      {p.unit && <Badge variant="warning" className="shrink-0 text-[10px]">{p.unit}</Badge>}
                    </span>
                    <span className="text-text-muted tabular shrink-0 text-xs">
                      {formatCurrency(p.purchasePrice)}{p.unit ? `/${p.unit}` : ''} · stock {p.currentQuantity}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button variant="secondary" onClick={() => setShowProductForm(true)}>
            <Plus size={16} /> Nouveau produit
          </Button>
        </div>

        <div className="space-y-3">
          {lines.map((l) => {
            const qty = Number(l.quantity) || 0;
            const price = Number(l.purchasePrice) || 0;
            const unit = l.unit || '';
            return (
              <div key={l._key} className="rounded-xl border border-gold/15 bg-gradient-card p-3.5">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary truncate">{l.productName}</p>
                    <p className="text-[11px] text-text-muted flex items-center gap-1.5 mt-0.5">
                      <Ruler size={11} className="text-gold" />
                      Unité du produit :
                      <span className="font-bold text-gold-dark">{unit || 'non définie'}</span>
                      <span className="text-text-muted/70">· stock actuel {l.stockBefore}{unit ? ` ${unit}` : ''}</span>
                    </p>
                  </div>
                  <button onClick={() => removeLine(l._key)} className="text-rose-deep shrink-0 p-1 rounded-lg hover:bg-rose-deep/10">
                    <X size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <Input
                    label={unit ? `Quantité (${unit})` : 'Quantité'}
                    type="number" step="any" min={0}
                    value={l.quantity}
                    onChange={(e) => updateLine(l._key, { quantity: Number(e.target.value) })}
                  />
                  <Input
                    label={unit ? `Prix pour 1 ${unit} (DA)` : 'Prix unitaire (DA)'}
                    type="number" step="any" min={0}
                    value={l.purchasePrice}
                    onChange={(e) => updateLine(l._key, { purchasePrice: Number(e.target.value) })}
                  />
                  <Input
                    label={unit ? `Seuil d'alerte (${unit})` : "Seuil d'alerte"}
                    type="number" step="any" min={0}
                    value={l.minAlertQuantity}
                    onChange={(e) => updateLine(l._key, { minAlertQuantity: Number(e.target.value) })}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-gold/10">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={!!l.expirationEnabled}
                      onChange={(v) => updateLine(l._key, { expirationEnabled: v })}
                      label="Péremption"
                    />
                    {l.expirationEnabled && (
                      <Input
                        type="date"
                        value={l.expirationDate || ''}
                        onChange={(e) => updateLine(l._key, { expirationDate: e.target.value })}
                        className="max-w-[170px] h-9"
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="text-[10px] text-text-muted leading-none">Nouveau stock</p>
                      <p className="text-xs font-bold tabular text-pistachio">
                        {l.stockBefore} + {qty} = {l.stockBefore + qty}{unit ? ` ${unit}` : ''}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-muted leading-none">Total ligne</p>
                      <p className="text-sm font-bold tabular text-gold-dark">{formatCurrency(qty * price)}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {lines.length === 0 && (
            <p className="text-sm text-text-muted text-center py-6 rounded-xl border border-dashed border-gold/20">
              Aucun produit sélectionné — recherchez un produit ci-dessus.
            </p>
          )}
        </div>
      </section>

      {/* 2 — Fournisseur */}
      <section className="bg-vanilla/30 rounded-2xl p-4 border border-gold/15">
        <h3 className="font-display font-semibold text-text-primary mb-3 flex items-center gap-2 text-sm">
          <Truck size={16} className="text-gold" /> 2. Fournisseur &amp; date
        </h3>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input
              value={supplierSearch}
              onChange={(e) => { setSupplierSearch(e.target.value); setSupplierId(''); }}
              placeholder="Rechercher un fournisseur…"
              className="pl-10"
            />
            {supplierResults.length > 0 && !supplierId && (
              <div className="absolute z-20 mt-1 w-full rounded-xl border border-gold/20 bg-[--surface-dropdown] shadow-hover overflow-hidden">
                {supplierResults.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setSupplierId(s.id); setSupplierSearch(s.name); }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gold/10"
                  >
                    {s.name} {s.phone && <span className="text-text-muted text-xs">· {s.phone}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-[180px]" />
          <Button variant="secondary" onClick={() => setShowSupplierForm(true)}>
            <Plus size={16} /> Fournisseur
          </Button>
        </div>
        {supplierId && (
          <p className="text-sm text-pistachio mt-2 flex items-center gap-1.5">
            <Check size={15} /> {suppliers.find((s) => s.id === supplierId)?.name}
          </p>
        )}
      </section>

      {/* 3 — Paiement */}
      <section className="bg-vanilla/30 rounded-2xl p-4 border border-gold/15">
        <h3 className="font-display font-semibold text-text-primary mb-3 flex items-center gap-2 text-sm">
          <Wallet size={16} className="text-gold" /> 3. Paiement
        </h3>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[150px]">
            <p className="text-xs text-text-muted">Total de la facture</p>
            <p className="text-2xl font-bold text-gold-dark tabular">{formatCurrency(total)}</p>
          </div>
          <Input
            label="Montant payé (DA)"
            type="number" step="any" min={0}
            value={paidAmount}
            onChange={(e) => setPaidAmount(Number(e.target.value))}
            className="max-w-[180px]"
          />
          <Button variant="secondary" size="sm" onClick={() => setPaidAmount(total)}>Tout payer</Button>
          <div>
            <p className="text-xs text-text-muted">Reste (dette fournisseur)</p>
            <p className="text-xl font-bold text-rose-deep tabular">
              {formatCurrency(Math.max(0, total - paidAmount))}
            </p>
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
        <Button variant="gold" onClick={handleCreate} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Créer la facture & mettre à jour le stock'}
        </Button>
      </div>

      <Modal open={showProductForm} onClose={() => setShowProductForm(false)} title="Nouveau produit" size="lg">
        <ProductForm onSubmit={handleProductCreated} onCancel={() => setShowProductForm(false)} />
      </Modal>
      <Modal open={showSupplierForm} onClose={() => setShowSupplierForm(false)} title="Nouveau fournisseur" size="sm">
        <SupplierForm onSubmit={handleSupplierCreated} onCancel={() => setShowSupplierForm(false)} />
      </Modal>
    </div>
  );
}
