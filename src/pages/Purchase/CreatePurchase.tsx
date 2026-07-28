import { useMemo, useState } from 'react';
import { Search, Plus, X, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
import { ProductForm } from '@/components/shared/ProductForm';
import { SupplierForm } from '@/components/shared/SupplierForm';
import { UnitSelect } from '@/components/shared/UnitSelect';
import { useStockStore } from '@/store/stockStore';
import { useSupplierStore } from '@/store/supplierStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, todayISO } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { PurchaseLine, Product } from '@/types';

interface CreatePurchaseProps {
  onClose: () => void;
}

interface Line extends PurchaseLine {
  _key: string;
}

export function CreatePurchase({ onClose }: CreatePurchaseProps) {
  const { t } = useLanguage();
  const products = useStockStore((s) => s.products);
  const { suppliers, addSupplier } = useSupplierStore();
  const addPurchase = usePurchaseStore((s) => s.addPurchase);
  const addProduct = useStockStore((s) => s.addProduct);

  const [productSearch, setProductSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [date] = useState(todayISO());
  const [showProductForm, setShowProductForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);

  const total = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.purchasePrice, 0), [lines]);

  const productResults = useMemo(() => {
    if (!productSearch) return [];
    const s = productSearch.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(s) || p.barcode.includes(s)).slice(0, 6);
  }, [productSearch, products]);

  const supplierResults = useMemo(() => {
    if (!supplierSearch) return [];
    const s = supplierSearch.toLowerCase();
    return suppliers.filter((sup) => sup.name.toLowerCase().includes(s)).slice(0, 6);
  }, [supplierSearch, suppliers]);

  const addLine = (p: Product) => {
    if (lines.some((l) => l.productId === p.id)) {
      toast.warning('Produit déjà ajouté');
      return;
    }
    setLines([...lines, { _key: p.id + Date.now(), productId: p.id, productName: p.name, quantity: 1, minAlertQuantity: p.minAlertQuantity, purchasePrice: p.purchasePrice, unitEnabled: p.unitEnabled, unit: p.unit, expirationEnabled: p.expirationEnabled, expirationDate: p.expirationDate }]);
    setProductSearch('');
  };

  const updateLine = (key: string, data: Partial<Line>) =>
    setLines(lines.map((l) => (l._key === key ? { ...l, ...data } : l)));
  const removeLine = (key: string) => setLines(lines.filter((l) => l._key !== key));

  const handleProductCreated = (data: Omit<Product, 'id' | 'createdAt'>) => {
    const p = addProduct({ ...data, currentQuantity: data.currentQuantity });
    addLine(p);
    setShowProductForm(false);
    toast.success('Produit créé et ajouté');
  };

  const handleSupplierCreated = (data: { name: string; phone: string; address: string }) => {
    const s = addSupplier(data);
    setSupplierId(s.id);
    setSupplierSearch(s.name);
    setShowSupplierForm(false);
    toast.success('Fournisseur créé');
  };

  const handleCreate = () => {
    if (lines.length === 0) { toast.error('Ajoutez au moins un produit'); return; }
    if (!supplierId) { toast.error('Sélectionnez un fournisseur'); return; }
    addPurchase({
      supplierId, date,
      products: lines.map(({ _key, ...l }) => l),
      paidAmount: Number(paidAmount),
    });
    toast.success('Facture créée — stock mis à jour');
    onClose();
  };

  return (
    <div className="space-y-5">
      {/* Section 1: Products */}
      <section className="bg-vanilla/30 rounded-xl p-4 border border-gold/15">
        <h3 className="font-display font-semibold text-text-primary mb-3">1. {t('usedProducts')}</h3>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder={`${t('search')} produit`} className="pl-10" />
            {productResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white rounded-xl border border-gold/20 shadow-hover overflow-hidden">
                {productResults.map((p) => (
                  <button key={p.id} onClick={() => addLine(p)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gold/10 flex justify-between">
                    <span>{p.name}</span><span className="text-text-muted tabular">{formatCurrency(p.purchasePrice)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button variant="secondary" onClick={() => setShowProductForm(true)}><Plus size={16} /> {t('create')}</Button>
        </div>

        <div className="space-y-3">
          {lines.map((l) => (
            <div key={l._key} className="bg-white rounded-xl p-3 border border-gold/15">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-text-primary">{l.productName}{l.unitEnabled && l.unit ? <span className="text-xs text-gold-dark ml-1">· {l.unit}</span> : null}</span>
                <button onClick={() => removeLine(l._key)} className="text-rose-deep"><X size={16} /></button>
              </div>

              {/* Detail (unit) purchasing toggle */}
              <div className="flex flex-wrap items-end gap-3 mb-2 bg-vanilla/40 rounded-lg p-2.5">
                <Switch checked={!!l.unitEnabled} onChange={(v) => updateLine(l._key, { unitEnabled: v })} label={t('detailPurchase')} />
                {l.unitEnabled && (
                  <UnitSelect label={t('unit')} value={l.unit || ''} onChange={(u) => updateLine(l._key, { unit: u })} className="min-w-[200px]" />
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Input label={l.unitEnabled && l.unit ? `${t('quantity')} (${l.unit})` : t('quantity')} type="number" step={l.unitEnabled ? 'any' : '1'} value={l.quantity} onChange={(e) => updateLine(l._key, { quantity: Number(e.target.value) })} />
                <Input label={t('minAlertQty')} type="number" value={l.minAlertQuantity} onChange={(e) => updateLine(l._key, { minAlertQuantity: Number(e.target.value) })} />
                <Input label={l.unitEnabled && l.unit ? `${t('purchasePrice')} / ${l.unit}` : t('purchasePrice')} type="number" step="0.01" value={l.purchasePrice} onChange={(e) => updateLine(l._key, { purchasePrice: Number(e.target.value) })} />
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-3">
                  <Switch checked={!!l.expirationEnabled} onChange={(v) => updateLine(l._key, { expirationEnabled: v })} label={t('expiration')} />
                  {l.expirationEnabled && (
                    <Input type="date" value={l.expirationDate || ''} onChange={(e) => updateLine(l._key, { expirationDate: e.target.value })} className="max-w-[180px]" />
                  )}
                </div>
                <span className="text-sm tabular text-gold-dark font-semibold">{formatCurrency(l.quantity * l.purchasePrice)}</span>
              </div>
            </div>
          ))}
          {lines.length === 0 && <p className="text-sm text-text-muted text-center py-3">Aucun produit sélectionné</p>}
        </div>
      </section>

      {/* Section 2: Supplier */}
      <section className="bg-vanilla/30 rounded-xl p-4 border border-gold/15">
        <h3 className="font-display font-semibold text-text-primary mb-3">2. {t('supplier')}</h3>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input value={supplierSearch} onChange={(e) => { setSupplierSearch(e.target.value); setSupplierId(''); }} placeholder={`${t('search')} ${t('supplier')}`} className="pl-10" />
            {supplierResults.length > 0 && !supplierId && (
              <div className="absolute z-20 mt-1 w-full bg-white rounded-xl border border-gold/20 shadow-hover overflow-hidden">
                {supplierResults.map((s) => (
                  <button key={s.id} onClick={() => { setSupplierId(s.id); setSupplierSearch(s.name); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gold/10">{s.name}</button>
                ))}
              </div>
            )}
          </div>
          <Button variant="secondary" onClick={() => setShowSupplierForm(true)}><Plus size={16} /> {t('create')}</Button>
        </div>
        {supplierId && <p className="text-sm text-pistachio mt-2">✓ {suppliers.find((s) => s.id === supplierId)?.name}</p>}
      </section>

      {/* Section 3: Payment */}
      <section className="bg-vanilla/30 rounded-xl p-4 border border-gold/15">
        <h3 className="font-display font-semibold text-text-primary mb-3">3. {t('payment')}</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[140px]">
            <p className="text-sm text-text-muted">{t('total')}</p>
            <p className="text-2xl font-bold text-gold-dark tabular">{formatCurrency(total)}</p>
          </div>
          <Input label={`${t('paidAmount')} (DA)`} type="number" value={paidAmount} onChange={(e) => setPaidAmount(Number(e.target.value))} className="max-w-[180px]" />
          <div>
            <p className="text-sm text-text-muted">{t('restAmount')}</p>
            <p className="text-xl font-bold text-rose-deep tabular">{formatCurrency(Math.max(0, total - paidAmount))}</p>
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="gold" onClick={handleCreate}>{t('createInvoice')}</Button>
      </div>

      <Modal open={showProductForm} onClose={() => setShowProductForm(false)} title={t('newProduct')} size="lg">
        <ProductForm onSubmit={handleProductCreated} onCancel={() => setShowProductForm(false)} />
      </Modal>
      <Modal open={showSupplierForm} onClose={() => setShowSupplierForm(false)} title={t('newSupplier')} size="sm">
        <SupplierForm onSubmit={handleSupplierCreated} onCancel={() => setShowSupplierForm(false)} />
      </Modal>
    </div>
  );
}
