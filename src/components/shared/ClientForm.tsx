import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/hooks/useLanguage';
import type { Client } from '@/types';

interface ClientFormProps {
  initial?: Client | null;
  onSubmit: (data: Omit<Client, 'id'>) => void;
  onCancel: () => void;
}

export function ClientForm({ initial, onSubmit, onCancel }: ClientFormProps) {
  const { t } = useLanguage();
  const [form, setForm] = useState({ name: initial?.name || '', phone: initial?.phone || '' });
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
      <Input label={`${t('name')} *`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={error} autoFocus />
      <Input label={t('phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t('cancel')}</Button>
        <Button type="submit" variant="gold">{t('save')}</Button>
      </div>
    </form>
  );
}
