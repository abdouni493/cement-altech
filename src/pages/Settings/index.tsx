import { useRef, useState } from 'react';
import { Settings as SettingsIcon, UserCog, Database, Upload, Download, Save, AlertTriangle, Trash2, FlaskConical } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useSettingsStore } from '@/store/settingsStore';
import { useAuthStore } from '@/store/authStore';
import { useLanguage } from '@/hooks/useLanguage';
import { downloadJSON } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';

const STORE_KEYS = [
  'altech-auth', 'altech-settings', 'altech-stock', 'altech-suppliers',
  'altech-clients', 'altech-client-debts', 'altech-purchases', 'altech-comptoir',
  'altech-productions', 'altech-fiche-technics', 'altech-sales', 'altech-commands',
  'altech-workers', 'altech-expenses', 'altech-caisse', 'altech-caisse-reports',
];

// Keys that hold business data — wiped on reset, but the admin account/settings are kept.
const DATA_KEYS = STORE_KEYS.filter((k) => k !== 'altech-auth' && k !== 'altech-settings');

export default function SettingsPage() {
  const { t } = useLanguage();
  const { settings, updateSettings } = useSettingsStore();
  const { user, updateMyAccount } = useAuthStore();

  const [tab, setTab] = useState('store');
  const [form, setForm] = useState(settings);
  const [account, setAccount] = useState({ name: user?.name || '', username: user?.username || '', email: user?.email || '', oldPwd: '', newPwd: '', confirmPwd: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set('logo', reader.result as string);
    reader.readAsDataURL(file);
  };

  const saveStore = async () => { await updateSettings(form); toast.success('Informations enregistrées'); };

  const saveAccount = () => {
    if (account.newPwd && account.newPwd !== account.confirmPwd) { toast.error('Les mots de passe ne correspondent pas'); return; }
    updateMyAccount({ name: account.name, username: account.username, email: account.email, ...(account.newPwd ? { password: account.newPwd } : {}) });
    toast.success('Compte mis à jour');
    setAccount({ ...account, oldPwd: '', newPwd: '', confirmPwd: '' });
  };

  const handleBackup = () => {
    const data: Record<string, unknown> = {};
    STORE_KEYS.forEach((k) => { const v = localStorage.getItem(k); if (v) data[k] = JSON.parse(v); });
    downloadJSON(data, `altech-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast.success('Sauvegarde téléchargée');
  };

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
        toast.success('Données restaurées — rechargement...');
        setTimeout(() => window.location.reload(), 1200);
      } catch {
        toast.error('Fichier invalide');
      }
    };
    reader.readAsText(file);
  };

  const handleReset = () => {
    if (!window.confirm('Effacer toutes les données (stock, ventes, achats, clients, etc.) ? Votre compte et les informations du magasin seront conservés. Cette action est irréversible.')) return;
    DATA_KEYS.forEach((k) => localStorage.removeItem(k));
    toast.success('Données effacées — rechargement...');
    setTimeout(() => window.location.reload(), 1000);
  };

  return (
    <div>
      <PageHeader title={t('settings')} icon={<SettingsIcon size={24} />} />
      <Tabs className="mb-6" active={tab} onChange={setTab}
        tabs={[{ id: 'store', label: t('storeInfo') }, { id: 'account', label: t('myAccount') }, { id: 'database', label: t('database') }]} />

      {tab === 'store' && (
        <Card index={0}>
          <div className="flex items-center gap-2 mb-4 text-gold-dark"><FlaskConical size={20} /><h3 className="font-display font-semibold text-text-primary">{t('storeInfo')}</h3></div>
          <div className="flex items-center gap-4 mb-4">
            <div className="h-20 w-20 rounded-2xl bg-vanilla border border-gold/20 flex items-center justify-center overflow-hidden">
              {form.logo ? <img src={form.logo} alt="logo" className="h-full w-full object-cover" /> : <FlaskConical size={32} className="text-gold/40" />}
            </div>
            <label className="cursor-pointer">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-vanilla border border-gold/30 text-sm text-text-secondary hover:bg-gold/10"><Upload size={16} /> Logo</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleLogo} />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label={t('name')} value={form.name} onChange={(e) => set('name', e.target.value)} />
            <Input label={t('email')} value={form.email} onChange={(e) => set('email', e.target.value)} />
            <Input label={t('phone')} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            <Input label={t('socialMedia')} value={form.socialMedia || ''} onChange={(e) => set('socialMedia', e.target.value)} placeholder="@altech_production" />
            <Input label="NIF" value={form.nif} onChange={(e) => set('nif', e.target.value)} />
            <Input label="NIS" value={form.nis} onChange={(e) => set('nis', e.target.value)} />
            <Input label="Article" value={form.article} onChange={(e) => set('article', e.target.value)} />
            <Input label="RC" value={form.rc} onChange={(e) => set('rc', e.target.value)} />
          </div>
          <Textarea label={t('description')} value={form.description} onChange={(e) => set('description', e.target.value)} className="mt-4" />
          <Textarea label={t('address')} value={form.address} onChange={(e) => set('address', e.target.value)} className="mt-4" />
          <div className="flex justify-end mt-4"><Button variant="gold" onClick={saveStore}><Save size={16} /> {t('save')}</Button></div>
        </Card>
      )}

      {tab === 'account' && (
        <Card index={0}>
          <div className="flex items-center gap-2 mb-4 text-gold-dark"><UserCog size={20} /><h3 className="font-display font-semibold text-text-primary">{t('myAccount')}</h3></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label={t('fullName')} value={account.name} onChange={(e) => setAccount({ ...account, name: e.target.value })} />
            <Input label={t('username')} value={account.username} onChange={(e) => setAccount({ ...account, username: e.target.value })} />
            <Input label={t('email')} value={account.email} onChange={(e) => setAccount({ ...account, email: e.target.value })} />
          </div>
          <div className="mt-6 pt-4 border-t border-gold/15">
            <h4 className="text-sm font-semibold text-text-secondary mb-3">{t('changePassword')}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input label="Ancien" type="password" value={account.oldPwd} onChange={(e) => setAccount({ ...account, oldPwd: e.target.value })} />
              <Input label="Nouveau" type="password" value={account.newPwd} onChange={(e) => setAccount({ ...account, newPwd: e.target.value })} />
              <Input label="Confirmer" type="password" value={account.confirmPwd} onChange={(e) => setAccount({ ...account, confirmPwd: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end mt-4"><Button variant="gold" onClick={saveAccount}><Save size={16} /> {t('save')}</Button></div>
        </Card>
      )}

      {tab === 'database' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card index={0}>
            <div className="flex items-center gap-2 mb-3 text-pistachio"><Download size={20} /><h3 className="font-display font-semibold text-text-primary">{t('backup')}</h3></div>
            <p className="text-sm text-text-muted mb-4">Exporter toutes les données en JSON</p>
            <Button variant="gold" onClick={handleBackup}><Download size={16} /> {t('downloadBackup')}</Button>
          </Card>
          <Card index={1} className="border-rose-deep/20">
            <div className="flex items-center gap-2 mb-3 text-rose-deep"><Database size={20} /><h3 className="font-display font-semibold text-text-primary">{t('restore')}</h3></div>
            <p className="text-sm text-text-muted mb-2">Importer un fichier JSON de sauvegarde</p>
            <p className="text-xs text-rose-deep flex items-center gap-1 mb-4"><AlertTriangle size={14} /> Remplace toutes les données actuelles</p>
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={handleRestore} />
            <Button variant="danger" onClick={() => fileRef.current?.click()}><Upload size={16} /> {t('selectFile')}</Button>
          </Card>
          <Card index={2} className="border-rose-deep/20">
            <div className="flex items-center gap-2 mb-3 text-rose-deep"><Trash2 size={20} /><h3 className="font-display font-semibold text-text-primary">Réinitialiser</h3></div>
            <p className="text-sm text-text-muted mb-2">Effacer toutes les données métier (stock, ventes, achats…)</p>
            <p className="text-xs text-rose-deep flex items-center gap-1 mb-4"><AlertTriangle size={14} /> Conserve votre compte et le magasin</p>
            <Button variant="danger" onClick={handleReset}><Trash2 size={16} /> Tout effacer</Button>
          </Card>
        </div>
      )}
    </div>
  );
}
