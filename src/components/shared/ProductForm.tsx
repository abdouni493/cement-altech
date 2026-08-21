import { useState } from 'react';
import { Package, Ruler, Boxes, Coins, CalendarClock } from 'lucide-react';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { UnitSelect } from '@/components/shared/UnitSelect';
import { formatCurrency } from '@/lib/utils';
import type { Product } from '@/types';

interface ProductFormProps {
  initial?: Product | null;
  onSubmit: (data: Omit<Product, 'id' | 'createdAt'>) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Création / modification d'un produit de stock.
 *
 * Le formulaire ne demande plus ni code-barres, ni catégorie, ni marque : le
 * produit est décrit par son nom, sa description et surtout son UNITÉ
 * (sac, tonne, m³ …) que l'utilisateur choisit ou crée directement ici.
 * En modification, TOUTES les informations sont éditables manuellement —
 * y compris les quantités.
 */
export function ProductForm({ initial, onSubmit, onCancel }: ProductFormProps) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    unit: initial?.unit || '',
    principalQuantity: initial?.principalQuantity ?? 0,
    currentQuantity: initial?.currentQuantity ?? 0,
    minAlertQuantity: initial?.minAlertQuantity ?? 0,
    purchasePrice: initial?.purchasePrice ?? 0,
    expirationEnabled: initial?.expirationEnabled ?? false,
    expirationDate: initial?.expirationDate || '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const u = form.unit ? ` (${form.unit})` : '';
  const stockValue = Number(form.currentQuantity || 0) * Number(form.purchasePrice || 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Nom requis';
    if (!form.unit.trim()) errs.unit = "Choisissez ou créez l'unité du produit";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        description: form.description,
        // legacy columns kept empty — they are no longer part of the form
        barcode: initial?.barcode || '',
        marqueId: initial?.marqueId || '',
        categoryId: initial?.categoryId || '',
        principalQuantity: Number(
          initial ? form.principalQuantity : form.currentQuantity
        ) || 0,
        currentQuantity: Number(form.currentQuantity) || 0,
        minAlertQuantity: Number(form.minAlertQuantity) || 0,
        purchasePrice: Number(form.purchasePrice) || 0,
        unitEnabled: true,
        unit: form.unit.trim(),
        expirationEnabled: form.expirationEnabled,
        expirationDate: form.expirationEnabled ? form.expirationDate || null : null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* 1 — Identité du produit */}
      <section className="rounded-2xl border border-gold/15 bg-vanilla/30 p-4 space-y-3">
        <h3 className="flex items-center gap-2 font-display font-semibold text-text-primary text-sm">
          <Package size={16} className="text-gold" /> 1. Identité du produit
        </h3>
        <Input
          label="Nom du produit *"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
          placeholder="Ex : Ciment CRS 42.5, Sable 0/4, Gravier 8/15…"
          autoFocus
        />
        <Textarea
          label="Description"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Précisions utiles : qualité, provenance, conditionnement…"
        />
      </section>

      {/* 2 — Unité */}
      <section className="rounded-2xl border border-gold/25 bg-gold/5 p-4 space-y-3">
        <h3 className="flex items-center gap-2 font-display font-semibold text-text-primary text-sm">
          <Ruler size={16} className="text-gold" /> 2. Unité du produit *
        </h3>
        <p className="text-xs text-text-muted">
          Toutes les quantités et le prix d'achat de ce produit seront exprimés dans cette unité.
          Choisissez-en une existante ou créez-la avec le bouton <span className="font-semibold">+</span>.
        </p>
        <UnitSelect value={form.unit} onChange={(v) => set('unit', v)} className="max-w-sm" />
        {errors.unit && <p className="text-xs text-rose-deep font-medium">{errors.unit}</p>}
      </section>

      {/* 3 — Quantités & prix (tout est modifiable) */}
      <section className="rounded-2xl border border-gold/15 bg-vanilla/30 p-4 space-y-3">
        <h3 className="flex items-center gap-2 font-display font-semibold text-text-primary text-sm">
          <Boxes size={16} className="text-gold" /> 3. Quantités &amp; prix
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label={`Quantité actuelle en stock${u}`}
            type="number" step="any"
            value={form.currentQuantity}
            onChange={(e) => set('currentQuantity', e.target.value)}
          />
          <Input
            label={`Seuil d'alerte${u}`}
            type="number" step="any"
            value={form.minAlertQuantity}
            onChange={(e) => set('minAlertQuantity', e.target.value)}
          />
          {initial && (
            <Input
              label={`Quantité totale entrée${u}`}
              type="number" step="any"
              value={form.principalQuantity}
              onChange={(e) => set('principalQuantity', e.target.value)}
            />
          )}
          <Input
            label={form.unit ? `Prix d'achat / ${form.unit} (DA)` : "Prix d'achat (DA)"}
            type="number" step="any"
            value={form.purchasePrice}
            onChange={(e) => set('purchasePrice', e.target.value)}
            icon={<Coins size={15} />}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold/15 bg-gradient-card px-4 py-2.5">
          <span className="text-xs text-text-muted">Valeur du stock pour ce produit</span>
          <span className="text-base font-bold tabular text-gold-dark">{formatCurrency(stockValue)}</span>
        </div>
      </section>

      {/* 4 — Péremption (optionnelle) */}
      <section className="rounded-2xl border border-gold/15 bg-vanilla/30 p-4 space-y-3">
        <h3 className="flex items-center gap-2 font-display font-semibold text-text-primary text-sm">
          <CalendarClock size={16} className="text-gold" /> 4. Date de péremption (optionnel)
        </h3>
        <div className="flex flex-wrap items-center gap-4">
          <Switch
            checked={form.expirationEnabled}
            onChange={(v) => set('expirationEnabled', v)}
            label="Ce produit périme"
          />
          {form.expirationEnabled && (
            <Input
              type="date"
              value={form.expirationDate}
              onChange={(e) => set('expirationDate', e.target.value)}
              className="max-w-[200px]"
            />
          )}
        </div>
      </section>

      <div className="flex justify-end gap-3 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>Annuler</Button>
        <Button type="submit" variant="gold" disabled={saving}>
          {saving ? 'Enregistrement…' : initial ? 'Mettre à jour' : 'Créer le produit'}
        </Button>
      </div>
    </form>
  );
}
