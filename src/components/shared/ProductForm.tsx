import { useState } from 'react';
import { Plus, RefreshCw, Printer, Trash2 } from 'lucide-react';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { BarcodeDisplay } from '@/components/ui/BarcodeDisplay';
import { UnitSelect } from '@/components/shared/UnitSelect';
import { useStockStore } from '@/store/stockStore';
import { useLanguage } from '@/hooks/useLanguage';
import { generateEAN13, printBarcode } from '@/lib/barcodeUtils';
import { toast } from '@/components/ui/Toast';
import type { Product } from '@/types';

interface ProductFormProps {
  initial?: Product | null;
  onSubmit: (data: Omit<Product, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}

export function ProductForm({ initial, onSubmit, onCancel }: ProductFormProps) {
  const { t } = useLanguage();
  const { marques, categories, addMarque, addCategory, deleteMarque, deleteCategory } = useStockStore();

  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    barcode: initial?.barcode || '',
    marqueId: initial?.marqueId || '',
    categoryId: initial?.categoryId || '',
    principalQuantity: initial?.principalQuantity ?? 0,
    currentQuantity: initial?.currentQuantity ?? 0,
    minAlertQuantity: initial?.minAlertQuantity ?? 0,
    purchasePrice: initial?.purchasePrice ?? 0,
    unitEnabled: initial?.unitEnabled ?? false,
    unit: initial?.unit || '',
    expirationEnabled: initial?.expirationEnabled ?? false,
    expirationDate: initial?.expirationDate || '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [miniModal, setMiniModal] = useState<'marque' | 'category' | null>(null);
  const [miniValue, setMiniValue] = useState('');
  const [confirmDel, setConfirmDel] = useState<{ type: 'marque' | 'category'; id: string; name: string } | null>(null);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleGenerate = () => {
    set('barcode', generateEAN13());
    toast.info('Code-barres généré');
  };

  const handleMiniSave = () => {
    if (!miniValue.trim()) return;
    if (miniModal === 'marque') {
      const m = addMarque(miniValue.trim());
      set('marqueId', m.id);
    } else if (miniModal === 'category') {
      const c = addCategory(miniValue.trim());
      set('categoryId', c.id);
    }
    setMiniValue('');
    setMiniModal(null);
  };

  const handleDeleteRef = () => {
    if (!confirmDel) return;
    if (confirmDel.type === 'marque') {
      deleteMarque(confirmDel.id);
      if (form.marqueId === confirmDel.id) set('marqueId', '');
      toast.success('Marque supprimée');
    } else {
      deleteCategory(confirmDel.id);
      if (form.categoryId === confirmDel.id) set('categoryId', '');
      toast.success('Catégorie supprimée');
    }
    setConfirmDel(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Nom requis';
    if (!form.marqueId) errs.marqueId = 'Marque requise';
    if (!form.categoryId) errs.categoryId = 'Catégorie requise';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    onSubmit({
      name: form.name,
      description: form.description,
      barcode: form.barcode || generateEAN13(),
      marqueId: form.marqueId,
      categoryId: form.categoryId,
      principalQuantity: Number(initial ? form.principalQuantity : form.currentQuantity),
      currentQuantity: Number(form.currentQuantity),
      minAlertQuantity: Number(form.minAlertQuantity),
      purchasePrice: Number(form.purchasePrice),
      unitEnabled: form.unitEnabled,
      unit: form.unitEnabled ? form.unit || undefined : undefined,
      expirationEnabled: form.expirationEnabled,
      expirationDate: form.expirationEnabled ? form.expirationDate || null : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label={`${t('productName')} *`} value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
      <Textarea label={t('description')} value={form.description} onChange={(e) => set('description', e.target.value)} />

      {/* Barcode */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1.5">{t('barcode')}</label>
        <div className="flex gap-2">
          <Input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="EAN-13" className="flex-1" />
          <Button type="button" variant="secondary" onClick={handleGenerate}>
            <RefreshCw size={16} /> {t('generate')}
          </Button>
          <Button type="button" variant="outline" disabled={!form.barcode} onClick={() => printBarcode(form.barcode, form.name || 'Produit')}>
            <Printer size={16} />
          </Button>
        </div>
        {form.barcode && (
          <div className="mt-3 flex justify-center bg-white rounded-xl p-2 border border-gold/15">
            <BarcodeDisplay value={form.barcode} />
          </div>
        )}
      </div>

      {/* Marque + Category */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="flex items-end gap-2">
            <Select label={`${t('marque')} *`} value={form.marqueId} onChange={(e) => set('marqueId', e.target.value)}
              placeholder="—" options={marques.map((m) => ({ value: m.id, label: m.name }))} error={errors.marqueId} className="flex-1" />
            <Button type="button" variant="secondary" size="icon" onClick={() => setMiniModal('marque')} title={t('newMarque')}>
              <Plus size={16} />
            </Button>
            <Button type="button" variant="danger" size="icon" disabled={!form.marqueId}
              onClick={() => { const m = marques.find((x) => x.id === form.marqueId); if (m) setConfirmDel({ type: 'marque', id: m.id, name: m.name }); }}
              title={t('delete')}>
              <Trash2 size={16} />
            </Button>
          </div>
        </div>
        <div>
          <div className="flex items-end gap-2">
            <Select label={`${t('category')} *`} value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}
              placeholder="—" options={categories.map((c) => ({ value: c.id, label: c.name }))} error={errors.categoryId} className="flex-1" />
            <Button type="button" variant="secondary" size="icon" onClick={() => setMiniModal('category')} title={t('newCategory')}>
              <Plus size={16} />
            </Button>
            <Button type="button" variant="danger" size="icon" disabled={!form.categoryId}
              onClick={() => { const c = categories.find((x) => x.id === form.categoryId); if (c) setConfirmDel({ type: 'category', id: c.id, name: c.name }); }}
              title={t('delete')}>
              <Trash2 size={16} />
            </Button>
          </div>
        </div>
      </div>

      {/* Detail (unit) purchasing — weight / volume / length */}
      <div className="bg-vanilla/40 rounded-xl p-3 border border-gold/15 space-y-3">
        <Switch checked={form.unitEnabled} onChange={(v) => set('unitEnabled', v)} label={t('detailPurchase')} />
        {form.unitEnabled && (
          <div className="flex flex-wrap items-end gap-3">
            <UnitSelect label={t('unit')} value={form.unit} onChange={(u) => set('unit', u)} className="min-w-[220px]" />
            <p className="text-xs text-text-muted pb-2.5">{t('purchasePrice')} = {t('pricePerUnit')}</p>
          </div>
        )}
      </div>

      {/* First-time creation: set the initial stock quantity */}
      {!initial && (
        <Input label={form.unitEnabled && form.unit ? `${t('currentQty')} (${form.unit})` : t('currentQty')} type="number" step={form.unitEnabled ? 'any' : '1'} value={form.currentQuantity} onChange={(e) => set('currentQuantity', e.target.value)} />
      )}

      {/* Expiration (only when editing an existing product) */}
      {initial && (
        <div className="flex flex-wrap items-center gap-4 bg-vanilla/40 rounded-xl p-3 border border-gold/15">
          <Switch checked={form.expirationEnabled} onChange={(v) => set('expirationEnabled', v)} label={t('expiration')} />
          {form.expirationEnabled && (
            <Input type="date" value={form.expirationDate} onChange={(e) => set('expirationDate', e.target.value)} className="max-w-[200px]" />
          )}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t('cancel')}</Button>
        <Button type="submit" variant="gold">{t('save')}</Button>
      </div>

      {/* Confirm delete marque / category */}
      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={handleDeleteRef}
        title={confirmDel?.type === 'marque' ? t('marque') : t('category')}
        message={`${t('delete')} « ${confirmDel?.name} » ?`}
      />

      {/* Mini modal for marque/category */}
      <Modal open={!!miniModal} onClose={() => setMiniModal(null)} title={miniModal === 'marque' ? t('newMarque') : t('newCategory')} size="sm">
        <div className="space-y-4">
          <Input label={t('name')} value={miniValue} onChange={(e) => setMiniValue(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setMiniModal(null)}>{t('cancel')}</Button>
            <Button type="button" variant="gold" onClick={handleMiniSave}>{t('add')}</Button>
          </div>
        </div>
      </Modal>
    </form>
  );
}
