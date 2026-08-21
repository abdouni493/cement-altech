import { useState } from 'react';
import { Plus, Trash2, Ruler } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useStockStore } from '@/store/stockStore';
import { useLanguage } from '@/hooks/useLanguage';
import { toast } from '@/components/ui/Toast';

interface UnitSelectProps {
  value: string;
  onChange: (unitName: string) => void;
  label?: string;
  className?: string;
  /** Compact variant used inside a table row / ingredient line. */
  compact?: boolean;
  /** Hide the delete button (a line-level picker should not delete the unit). */
  allowDelete?: boolean;
}

/**
 * Measurement-unit picker (sac / tonne / m³ / kg / litre …).
 * The user can pick an existing unit **or create a new one on the spot** — the
 * unit is written to the `units` table straight away so every other screen can
 * reuse it.
 */
export function UnitSelect({
  value, onChange, label, className, compact = false, allowDelete = true,
}: UnitSelectProps) {
  const { t } = useLanguage();
  const units = useStockStore((s) => s.units);
  const addUnit = useStockStore((s) => s.addUnit);
  const deleteUnit = useStockStore((s) => s.deleteUnit);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null);

  const selected = units.find((u) => u.name === value);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const u = await addUnit(name);
      onChange(u.name);
      setNewName('');
      setAdding(false);
      toast.success(`Unité « ${u.name} » disponible`);
    } catch {
      /* the error toast is raised by the store */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={className}>
      {label && (
        <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">
          {label}
        </label>
      )}
      <div className="flex items-end gap-1.5">
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={compact ? '—' : 'Choisir une unité…'}
          options={units.map((u) => ({ value: u.name, label: u.name }))}
          className={compact ? 'flex-1 h-9 text-xs' : 'flex-1'}
        />
        <Button
          type="button" variant="secondary" size="icon"
          className={compact ? 'h-9 w-9' : ''}
          onClick={() => setAdding(true)} title="Créer une unité"
        >
          <Plus size={15} />
        </Button>
        {allowDelete && (
          <Button
            type="button" variant="danger" size="icon"
            className={compact ? 'h-9 w-9' : ''}
            disabled={!selected}
            onClick={() => selected && setConfirmDel({ id: selected.id, name: selected.name })}
            title={t('delete')}
          >
            <Trash2 size={15} />
          </Button>
        )}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Nouvelle unité de mesure" size="sm">
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-gold/20 bg-gold/5 px-3.5 py-3">
            <Ruler size={18} className="text-gold shrink-0" />
            <p className="text-xs text-text-secondary">
              L'unité décrit comment le produit est acheté et vendu :
              <span className="font-semibold text-text-primary"> sac, tonne, m³, kg, litre, pièce…</span>
            </p>
          </div>
          <Input
            label="Nom de l'unité"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            placeholder="Ex : sac, tonne, m³, kg…"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAdd(); } }}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>{t('cancel')}</Button>
            <Button type="button" variant="gold" onClick={handleAdd} disabled={saving || !newName.trim()}>
              {saving ? 'Création…' : t('add')}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => {
          if (!confirmDel) return;
          void deleteUnit(confirmDel.id).then(() => {
            if (value === confirmDel.name) onChange('');
            toast.success('Unité supprimée');
          });
        }}
        title="Unité"
        message={`Supprimer l'unité « ${confirmDel?.name} » ?`}
      />
    </div>
  );
}
