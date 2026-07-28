import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { useLanguage } from '@/hooks/useLanguage';
import type { Category } from '@/types';

interface CategorySelectProps {
  label?: string;
  categories: Category[];
  value: string; // selected categoryId
  onChange: (id: string) => void;
  onCreate: (name: string) => Category;
  onDelete: (id: string) => void;
}

/**
 * A category picker with inline "create new category" and "delete category"
 * actions — lets the user select an existing category OR create one without
 * leaving the current form. Shared by Caisse (deposits/withdrawals) and Expenses.
 */
export function CategorySelect({ label, categories, value, onChange, onCreate, onDelete }: CategorySelectProps) {
  const { t } = useLanguage();
  const [catModal, setCatModal] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null);

  const handleAdd = () => {
    const name = newCat.trim();
    if (!name) return;
    const c = onCreate(name);
    onChange(c.id);
    setNewCat('');
    setCatModal(false);
    toast.success(t('newCategory'));
  };

  return (
    <div className="flex items-end gap-2">
      <Select
        label={label ?? t('category')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('selectCategory')}
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
        className="flex-1"
      />
      <Button type="button" variant="secondary" size="icon" onClick={() => setCatModal(true)} title={t('newCategory')}>
        <Plus size={16} />
      </Button>
      <Button
        type="button"
        variant="danger"
        size="icon"
        disabled={!value}
        onClick={() => {
          const c = categories.find((x) => x.id === value);
          if (c) setConfirmDel({ id: c.id, name: c.name });
        }}
        title={t('delete')}
      >
        <Trash2 size={16} />
      </Button>

      {/* Create category mini-modal */}
      <Modal open={catModal} onClose={() => setCatModal(false)} title={t('newCategory')} size="sm">
        <div className="space-y-4">
          <Input
            label={t('categoryName')}
            value={newCat}
            autoFocus
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCatModal(false)}>{t('cancel')}</Button>
            <Button type="button" variant="gold" onClick={handleAdd}>{t('add')}</Button>
          </div>
        </div>
      </Modal>

      {/* Delete category confirm */}
      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => {
          if (confirmDel) {
            onDelete(confirmDel.id);
            if (value === confirmDel.id) onChange('');
            toast.success(t('delete'));
          }
        }}
        title={t('category')}
        message={confirmDel ? `${t('deleteCategoryConfirm')} « ${confirmDel.name} »` : ''}
      />
    </div>
  );
}
