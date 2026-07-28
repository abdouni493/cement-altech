import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
import { useWorkerStore } from '@/store/workerStore';
import { useLanguage } from '@/hooks/useLanguage';
import { toast } from '@/components/ui/Toast';
import { todayISO } from '@/lib/utils';
import type { Worker } from '@/types';

interface CreateWorkerProps {
  initial?: Worker | null;
  onClose: () => void;
}

export function CreateWorker({ initial, onClose }: CreateWorkerProps) {
  const { t } = useLanguage();
  const { roles, addRole, addWorker, updateWorker } = useWorkerStore();

  const [form, setForm] = useState({
    fullName: initial?.fullName || '',
    birthday: initial?.birthday || '',
    idCardNumber: initial?.idCardNumber || '',
    phone: initial?.phone || '',
    roleId: initial?.roleId || '',
    startDate: initial?.startDate || todayISO(),
    paymentEnabled: initial?.paymentEnabled ?? true,
    paymentType: initial?.paymentType || 'monthly',
    paymentAmount: initial?.paymentAmount ?? 0,
    hasAccount: initial?.hasAccount ?? false,
    email: initial?.email || '',
    username: initial?.username || '',
    password: initial?.password || '',
  });
  const [roleModal, setRoleModal] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleAddRole = () => {
    if (!roleName.trim()) return;
    const r = addRole(roleName.trim());
    set('roleId', r.id);
    setRoleName(''); setRoleModal(false);
  };

  const handleSubmit = () => {
    const errs: Record<string, string> = {};
    if (!form.fullName.trim()) errs.fullName = 'Nom requis';
    if (!form.phone.trim()) errs.phone = 'Téléphone requis';
    if (!form.roleId) errs.roleId = 'Rôle requis';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    if (initial) {
      updateWorker(initial.id, { ...form, paymentType: form.paymentType as 'monthly' | 'daily', paymentAmount: Number(form.paymentAmount) });
      toast.success('Employé modifié');
    } else {
      addWorker({ ...form, paymentType: form.paymentType as 'monthly' | 'daily', paymentAmount: Number(form.paymentAmount) });
      toast.success('Employé créé');
    }
    onClose();
  };

  return (
    <div className="space-y-5">
      <section className="bg-vanilla/30 rounded-xl p-4 border border-gold/15 space-y-3">
        <h3 className="font-display font-semibold text-text-primary">1. Infos personnelles</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label={`${t('fullName')} *`} value={form.fullName} onChange={(e) => set('fullName', e.target.value)} error={errors.fullName} />
          <Input label={t('birthday')} type="date" value={form.birthday} onChange={(e) => set('birthday', e.target.value)} />
          <Input label={t('idCard')} value={form.idCardNumber} onChange={(e) => set('idCardNumber', e.target.value)} />
          <Input label={`${t('phone')} *`} value={form.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
          <div className="flex items-end gap-2">
            <Select label={`${t('role')} *`} value={form.roleId} onChange={(e) => set('roleId', e.target.value)} placeholder="—"
              options={roles.map((r) => ({ value: r.id, label: r.name }))} error={errors.roleId} className="flex-1" />
            <Button type="button" variant="secondary" size="icon" onClick={() => setRoleModal(true)}><Plus size={16} /></Button>
          </div>
          <Input label={`${t('startDate')} *`} type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </div>
      </section>

      <section className="bg-vanilla/30 rounded-xl p-4 border border-gold/15 space-y-3">
        <h3 className="font-display font-semibold text-text-primary">2. {t('payment')}</h3>
        <Switch checked={form.paymentEnabled} onChange={(v) => set('paymentEnabled', v)} label={t('salaryEnabled')} />
        {form.paymentEnabled && (
          <div className="flex flex-wrap items-end gap-3">
            <Select label="Type" value={form.paymentType} onChange={(e) => set('paymentType', e.target.value)}
              options={[{ value: 'monthly', label: t('monthly') }, { value: 'daily', label: t('daily') }]} className="max-w-[160px]" />
            <Input label={`${t('amount')} (DA)`} type="number" value={form.paymentAmount} onChange={(e) => set('paymentAmount', e.target.value)} className="max-w-[180px]" />
          </div>
        )}
      </section>

      <section className="bg-vanilla/30 rounded-xl p-4 border border-gold/15 space-y-3">
        <h3 className="font-display font-semibold text-text-primary">3. Compte de connexion</h3>
        <Switch checked={form.hasAccount} onChange={(v) => set('hasAccount', v)} label={t('accountActive')} />
        {form.hasAccount && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label={t('email')} value={form.email} onChange={(e) => set('email', e.target.value)} />
            <Input label={t('username')} value={form.username} onChange={(e) => set('username', e.target.value)} />
            <Input label={t('password')} type="text" value={form.password} onChange={(e) => set('password', e.target.value)} />
          </div>
        )}
        {form.hasAccount && <p className="text-xs text-text-muted">Le compte est créé sans permissions — configurez-les via le bouton « Permissions ».</p>}
      </section>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="gold" onClick={handleSubmit}>{t('save')}</Button>
      </div>

      <Modal open={roleModal} onClose={() => setRoleModal(false)} title={t('newRole')} size="sm">
        <div className="space-y-4">
          <Input label={t('name')} value={roleName} onChange={(e) => setRoleName(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRoleModal(false)}>{t('cancel')}</Button>
            <Button variant="gold" onClick={handleAddRole}>{t('add')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
