import { useState } from 'react';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/hooks/useLanguage';
import type { Supplier } from '@/types';

interface SupplierFormProps {
  initial?: Supplier | null;
  onSubmit: (data: Omit<Supplier, 'id'>) => void;
  onCancel: () => void;
}

export function SupplierForm({ initial, onSubmit, onCancel }: SupplierFormProps) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    name: initial?.name || '',
    phone: initial?.phone || '',
    address: initial?.address || '',
  });
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Nom requis');
      return;
    }
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label={`${t('name')} *`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={error} />
      <Input label={t('phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <Textarea label={t('address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t('cancel')}</Button>
        <Button type="submit" variant="gold">{t('save')}</Button>
      </div>
    </form>
  );
}
