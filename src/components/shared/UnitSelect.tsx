import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
}

// A measurement-unit picker (g / kg / litre / m / …) that lets the user
// create new units and delete existing ones inline. Units are stored by name.
export function UnitSelect({ value, onChange, label, className }: UnitSelectProps) {
  const { t } = useLanguage();
  const { units, addUnit, deleteUnit } = useStockStore();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null);

  const selected = units.find((u) => u.name === value);

  const handleAdd = () => {
    if (!newName.trim()) return;
    const u = addUnit(newName.trim());
    onChange(u.name);
    setNewName('');
    setAdding(false);
  };

  return (
    <div className={className}>
      {label && <label className="block text-sm font-medium text-text-secondary mb-1.5">{label}</label>}
      <div className="flex items-end gap-2">
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          options={units.map((u) => ({ value: u.name, label: u.name }))}
          className="flex-1"
        />
        <Button type="button" variant="secondary" size="icon" onClick={() => setAdding(true)} title={t('newUnit')}>
          <Plus size={16} />
        </Button>
        <Button
          type="button"
          variant="danger"
          size="icon"
          disabled={!selected}
          onClick={() => selected && setConfirmDel({ id: selected.id, name: selected.name })}
          title={t('delete')}
        >
          <Trash2 size={16} />
        </Button>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title={t('newUnit')} size="sm">
        <div className="space-y-4">
          <Input
            label={t('name')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            placeholder="Ex: g, kg, litre, m, pièce…"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>{t('cancel')}</Button>
            <Button type="button" variant="gold" onClick={handleAdd}>{t('add')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => {
          if (confirmDel) {
            deleteUnit(confirmDel.id);
            if (value === confirmDel.name) onChange('');
            toast.success('Unité supprimée');
          }
        }}
        title={t('unit')}
        message={`${t('delete')} « ${confirmDel?.name} » ?`}
      />
    </div>
  );
}
