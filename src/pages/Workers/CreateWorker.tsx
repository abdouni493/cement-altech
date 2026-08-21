import { useState } from 'react';
import { Plus, ShieldCheck, User, Wallet, KeyRound, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
import { useWorkerStore } from '@/store/workerStore';
import { toast } from '@/components/ui/Toast';
import { todayISO } from '@/lib/utils';
import type { Worker } from '@/types';

interface CreateWorkerProps {
  initial?: Worker | null;
  onClose: () => void;
}

/** Suggests a username from the full name — «Ahmed Ben Ali» → «ahmed.benali». */
function suggestUsername(fullName: string): string {
  const parts = fullName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const normalize = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  if (parts.length === 1) return normalize(parts[0]);
  return `${normalize(parts[0])}.${normalize(parts.slice(1).join(''))}`;
}

function randomPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function CreateWorker({ initial, onClose }: CreateWorkerProps) {
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
    password: '',
  });
  const [roleModal, setRoleModal] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(true);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleAddRole = async () => {
    if (!roleName.trim()) return;
    const r = await addRole(roleName.trim());
    set('roleId', r.id);
    setRoleName('');
    setRoleModal(false);
  };

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};
    if (!form.fullName.trim()) errs.fullName = 'Nom requis';
    if (!form.phone.trim()) errs.phone = 'Téléphone requis';
    if (!form.roleId) errs.roleId = 'Rôle requis';

    if (form.hasAccount) {
      const email = form.email.trim();
      if (!email) errs.email = 'Email requis pour le compte de connexion';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Adresse email invalide';
      if (!form.username.trim()) errs.username = "Nom d'utilisateur requis";
      // A password is mandatory on creation; on edit it is only needed to reset it.
      const needsPassword = !initial || !initial.hasAccount;
      if (needsPassword && form.password.length < 6) {
        errs.password = 'Mot de passe : 6 caractères minimum';
      } else if (form.password && form.password.length < 6) {
        errs.password = 'Mot de passe : 6 caractères minimum';
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error('Corrigez les champs en rouge');
      return;
    }

    setSaving(true);
    try {
      const payload: Partial<Worker> & { password?: string } = {
        fullName: form.fullName.trim(),
        birthday: form.birthday,
        idCardNumber: form.idCardNumber,
        phone: form.phone.trim(),
        roleId: form.roleId,
        startDate: form.startDate,
        paymentEnabled: form.paymentEnabled,
        paymentType: form.paymentType as 'monthly' | 'daily',
        paymentAmount: Number(form.paymentAmount) || 0,
        hasAccount: form.hasAccount,
        email: form.hasAccount ? form.email.trim().toLowerCase() : '',
        username: form.hasAccount ? form.username.trim().toLowerCase() : '',
        password: form.hasAccount && form.password ? form.password : undefined,
      };

      if (initial) {
        await updateWorker(initial.id, payload);
        toast.success(
          form.hasAccount && form.password
            ? 'Employé modifié — compte de connexion mis à jour'
            : 'Employé modifié'
        );
      } else {
        await addWorker(payload);
        toast.success(
          form.hasAccount
            ? `Employé créé — ${form.fullName} peut se connecter avec « ${form.username.trim().toLowerCase()} »`
            : 'Employé créé'
        );
      }
      onClose();
    } catch {
      /* the store already showed the error toast */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 1 — Personal information */}
      <section className="bg-vanilla/30 rounded-2xl p-4 border border-gold/15 space-y-3">
        <h3 className="font-display font-semibold text-text-primary text-sm flex items-center gap-2">
          <User size={16} className="text-gold" /> 1. Informations personnelles
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Nom complet *"
            value={form.fullName}
            onChange={(e) => {
              set('fullName', e.target.value);
              // keep the suggested username in sync while it was not edited manually
              if (!initial && (!form.username || form.username === suggestUsername(form.fullName))) {
                set('username', suggestUsername(e.target.value));
              }
            }}
            error={errors.fullName}
          />
          <Input label="Date de naissance" type="date" value={form.birthday} onChange={(e) => set('birthday', e.target.value)} />
          <Input label="N° carte d'identité" value={form.idCardNumber} onChange={(e) => set('idCardNumber', e.target.value)} />
          <Input label="Téléphone *" value={form.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
          <div className="flex items-end gap-2">
            <Select
              label="Poste / Rôle *"
              value={form.roleId}
              onChange={(e) => set('roleId', e.target.value)}
              placeholder="—"
              options={roles.map((r) => ({ value: r.id, label: r.name }))}
              error={errors.roleId}
              className="flex-1"
            />
            <Button type="button" variant="secondary" size="icon" onClick={() => setRoleModal(true)} title="Nouveau rôle">
              <Plus size={16} />
            </Button>
          </div>
          <Input label="Date d'embauche *" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </div>
      </section>

      {/* 2 — Salary */}
      <section className="bg-vanilla/30 rounded-2xl p-4 border border-gold/15 space-y-3">
        <h3 className="font-display font-semibold text-text-primary text-sm flex items-center gap-2">
          <Wallet size={16} className="text-gold" /> 2. Salaire
        </h3>
        <Switch checked={form.paymentEnabled} onChange={(v) => set('paymentEnabled', v)} label="Cet employé est rémunéré" />
        {form.paymentEnabled && (
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Type"
              value={form.paymentType}
              onChange={(e) => set('paymentType', e.target.value)}
              options={[{ value: 'monthly', label: 'Mensuel' }, { value: 'daily', label: 'Journalier' }]}
              className="max-w-[170px]"
            />
            <Input
              label="Montant (DA)" type="number" step="any"
              value={form.paymentAmount}
              onChange={(e) => set('paymentAmount', e.target.value)}
              className="max-w-[190px]"
            />
          </div>
        )}
      </section>

      {/* 3 — Login account */}
      <section className="bg-gold/5 rounded-2xl p-4 border border-gold/25 space-y-3">
        <h3 className="font-display font-semibold text-text-primary text-sm flex items-center gap-2">
          <KeyRound size={16} className="text-gold" /> 3. Compte de connexion
        </h3>
        <Switch
          checked={form.hasAccount}
          onChange={(v) => {
            set('hasAccount', v);
            if (v && !form.username) set('username', suggestUsername(form.fullName));
            if (v && !form.password && !initial?.hasAccount) set('password', randomPassword());
          }}
          label="Créer un accès à l'application pour cet employé"
        />

        {form.hasAccount && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Email *"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                error={errors.email}
                placeholder="employe@exemple.com"
              />
              <Input
                label="Nom d'utilisateur *"
                value={form.username}
                onChange={(e) => set('username', e.target.value.toLowerCase())}
                error={errors.username}
                placeholder="ahmed.benali"
              />
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">
                  {initial?.hasAccount ? 'Nouveau mot de passe' : 'Mot de passe *'}
                </label>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                      placeholder={initial?.hasAccount ? 'Laisser vide pour conserver' : '6 caractères minimum'}
                      className={`w-full h-10 rounded-xl border-2 px-3.5 pr-9 text-sm font-medium bg-[--surface-input] text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold ${
                        errors.password ? 'border-rose-deep' : 'border-[--border-input]'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-gold"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <Button
                    type="button" variant="secondary" size="icon"
                    onClick={() => { set('password', randomPassword()); setShowPassword(true); }}
                    title="Générer un mot de passe"
                  >
                    <RefreshCw size={15} />
                  </Button>
                </div>
                {errors.password && <p className="text-xs text-rose-deep mt-1 font-medium">{errors.password}</p>}
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-gold/20 bg-gradient-card px-3.5 py-3">
              <ShieldCheck size={17} className="text-gold shrink-0 mt-0.5" />
              <p className="text-xs text-text-secondary leading-relaxed">
                Le compte est enregistré dans la table d'authentification Supabase :
                l'employé se connecte avec son <strong>email ou son nom d'utilisateur</strong> et
                le mot de passe ci-dessus. Il n'aura accès à <strong>aucune interface</strong> tant que
                l'administrateur ne lui a pas donné de permissions via le bouton
                « Permissions » de sa fiche.
              </p>
            </div>
          </>
        )}
      </section>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
        <Button variant="gold" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Enregistrement…' : initial ? 'Mettre à jour' : "Créer l'employé"}
        </Button>
      </div>

      <Modal open={roleModal} onClose={() => setRoleModal(false)} title="Nouveau rôle" size="sm">
        <div className="space-y-4">
          <Input
            label="Nom du rôle" value={roleName} onChange={(e) => setRoleName(e.target.value)} autoFocus
            placeholder="Ex : Chauffeur, Magasinier, Ouvrier…"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddRole(); } }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRoleModal(false)}>Annuler</Button>
            <Button variant="gold" onClick={handleAddRole}>Ajouter</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
