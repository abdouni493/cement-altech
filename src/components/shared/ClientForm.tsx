import { useState } from 'react';
import { MapPin, Phone, User } from 'lucide-react';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/hooks/useLanguage';
import type { Client } from '@/types';

interface ClientFormProps {
  initial?: Client | null;
  onSubmit: (data: Omit<Client, 'id'>) => void;
  onCancel: () => void;
  /** Rend l'adresse obligatoire (création d'une commande / d'un bon de livraison). */
  requireAddress?: boolean;
}

export function ClientForm({ initial, onSubmit, onCancel, requireAddress }: ClientFormProps) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    name: initial?.name || '',
    phone: initial?.phone || '',
    address: initial?.address || '',
    note: initial?.note || '',
  });
  const [error, setError] = useState('');
  const [addressError, setAddressError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let ok = true;
    if (!form.name.trim()) { setError('Nom requis'); ok = false; } else setError('');
    if (requireAddress && !form.address.trim()) {
      setAddressError('Adresse requise'); ok = false;
    } else setAddressError('');
    if (!ok) return;
    onSubmit({
      name: form.name.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      note: form.note.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label={`${t('name')} *`} value={form.name} icon={<User size={15} />}
        onChange={(e) => setForm({ ...form, name: e.target.value })} error={error} autoFocus
      />
      <Input
        label={t('phone')} value={form.phone} icon={<Phone size={15} />}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
      />
      <Input
        label={`Adresse${requireAddress ? ' *' : ''}`}
        value={form.address}
        icon={<MapPin size={15} />}
        placeholder="Ex : Cité 200 logements, Blida"
        onChange={(e) => setForm({ ...form, address: e.target.value })}
        error={addressError}
      />
      <Textarea
        label="Note (optionnel)" rows={2} value={form.note}
        onChange={(e) => setForm({ ...form, note: e.target.value })}
      />
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t('cancel')}</Button>
        <Button type="submit" variant="gold">{t('save')}</Button>
      </div>
    </form>
  );
}
