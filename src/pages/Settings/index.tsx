import { useRef, useState } from 'react';
import { Settings as SettingsIcon, UserCog, Database, Upload, Download, Save, AlertTriangle, FlaskConical, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useSettingsStore } from '@/store/settingsStore';
import { useAuthStore } from '@/store/authStore';
import { useLanguage } from '@/hooks/useLanguage';
import { downloadJSON, todayISO } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { RecycleBin } from './RecycleBin';
import { backup } from '@/lib/db';

type VerifyResult = Awaited<ReturnType<typeof backup.verify>>;

/** Lit un fichier de sauvegarde choisi par l'utilisateur. */
function readBackupFile(file: File): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (data?.format !== 'altech-production-backup' || !data.tables) throw new Error();
        resolve(data);
      } catch {
        reject(new Error("Fichier invalide : ce n'est pas une sauvegarde Altech Production"));
      }
    };
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.readAsText(file);
  });
}


export default function SettingsPage() {
  const { t } = useLanguage();
  const { settings, updateSettings } = useSettingsStore();
  const { user, updateMyAccount } = useAuthStore();

  const [tab, setTab] = useState('store');
  const [form, setForm] = useState(settings);
  const [account, setAccount] = useState({ name: user?.name || '', username: user?.username || '', email: user?.email || '', oldPwd: '', newPwd: '', confirmPwd: '' });
  const fileRef = useRef<HTMLInputElement>(null);
  const verifyRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'' | 'backup' | 'verify' | 'restore'>('');
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

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

  const handleBackup = async () => {
    setBusy('backup');
    try {
      const data = await backup.export();
      downloadJSON(data, `altech-backup-${todayISO()}.json`);
      const tables = Object.keys(data.tables ?? {}).length;
      const rows = Object.values<number>(data.counts ?? {}).reduce((s, n) => s + n, 0);
      if (data.auth) toast.success(`Sauvegarde téléchargée — ${tables} tables, ${rows} lignes, ${data.auth.users?.length ?? 0} comptes`);
      else toast.success(`Sauvegarde téléchargée — ${tables} tables, ${rows} lignes (sans les mots de passe des comptes)`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const handleVerify = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('verify');
    setVerifyResult(null);
    try {
      const result = await backup.verify(await readBackupFile(file));
      setVerifyResult(result);
      if (result.ok) toast.success('Sauvegarde vérifiée : identique aux données actuelles');
      else toast.error('Des différences ont été trouvées — voir le détail');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await readBackupFile(file);
      const withAccounts = !!data.auth;
      const msg = `Restaurer la sauvegarde du ${new Date(String(data.created_at)).toLocaleString('fr-FR')} ?\n\n`
        + (withAccounts
          ? 'TOUTES les données actuelles et tous les comptes seront remplacés. '
            + 'Vous devrez ensuite vous reconnecter avec les identifiants contenus dans la sauvegarde.'
          : 'TOUTES les données actuelles seront remplacées. Les comptes de connexion de ce projet sont conservés ; '
            + 'les comptes des employés seront à recréer (bouton « Créer le compte »).');
      if (!window.confirm(msg)) return;
      setBusy('restore');
      const result = await backup.restore(data);
      const rows = Object.values(result.tables).reduce((s, n) => s + n, 0);
      toast.success(`Données restaurées — ${rows} lignes. Rechargement...`);
      setTimeout(async () => {
        if (withAccounts) await useAuthStore.getState().logout().catch(() => undefined);
        window.location.reload();
      }, 1500);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <PageHeader title={t('settings')} icon={<SettingsIcon size={24} />} />
      <Tabs className="mb-6" active={tab} onChange={setTab}
        tabs={[{ id: 'store', label: t('storeInfo') }, { id: 'account', label: t('myAccount') }, { id: 'database', label: t('database') }, { id: 'recycle', label: 'Corbeille' }]} />

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
            <Input
              label="Lieu d'activité"
              value={form.activityPlace || ''}
              onChange={(e) => set('activityPlace', e.target.value)}
              placeholder="Ex : BAHLI BLIDA"
            />
            <Input
              label="Ville (mention « … LE jj/mm/aaaa »)"
              value={form.city || ''}
              onChange={(e) => set('city', e.target.value)}
              placeholder="Ex : BLIDA"
            />
          </div>
          <p className="mt-3 rounded-xl border border-gold/25 bg-gold/8 px-3.5 py-2 text-xs font-medium text-gold-dark">
            Ces informations composent l'en-tête de TOUS les documents imprimés : raison sociale,
            activité (champ « Description »), lieu d'activité, siège social (champ « Adresse ») et
            téléphone, puis la mention « VILLE LE date » en haut à droite.
          </p>
          <Textarea
            label={`${t('description')} — activité imprimée sous la raison sociale`}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className="mt-4"
          />
          <Textarea
            label={`${t('address')} — siège social imprimé sur les documents`}
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            className="mt-4"
          />
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
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card index={0}>
              <div className="flex items-center gap-2 mb-3 text-pistachio"><Download size={20} /><h3 className="font-display font-semibold text-text-primary">{t('backup')}</h3></div>
              <p className="text-sm text-text-muted mb-4">Exporter toutes les données (toutes les interfaces, historiques, stock, opérations) et tous les comptes en JSON</p>
              <Button variant="gold" onClick={handleBackup} disabled={!!busy}><Download size={16} /> {busy === 'backup' ? 'Export en cours...' : t('downloadBackup')}</Button>
            </Card>
            <Card index={1}>
              <div className="flex items-center gap-2 mb-3 text-gold-dark"><ShieldCheck size={20} /><h3 className="font-display font-semibold text-text-primary">Vérifier une sauvegarde</h3></div>
              <p className="text-sm text-text-muted mb-4">Comparer un fichier de sauvegarde avec les données actuelles, table par table, ligne par ligne</p>
              <input ref={verifyRef} type="file" accept="application/json" className="hidden" onChange={handleVerify} />
              <Button variant="gold" onClick={() => verifyRef.current?.click()} disabled={!!busy}><ShieldCheck size={16} /> {busy === 'verify' ? 'Vérification...' : t('selectFile')}</Button>
            </Card>
            <Card index={2} className="border-rose-deep/20">
              <div className="flex items-center gap-2 mb-3 text-rose-deep"><Database size={20} /><h3 className="font-display font-semibold text-text-primary">{t('restore')}</h3></div>
              <p className="text-sm text-text-muted mb-2">Importer un fichier JSON de sauvegarde</p>
              <p className="text-xs text-rose-deep flex items-center gap-1 mb-4"><AlertTriangle size={14} /> Remplace toutes les données et tous les comptes actuels</p>
              <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={handleRestore} />
              <Button variant="danger" onClick={() => fileRef.current?.click()} disabled={!!busy}><Upload size={16} /> {busy === 'restore' ? 'Restauration...' : t('selectFile')}</Button>
            </Card>
          </div>

          {verifyResult && (
            <Card index={3}>
              <h3 className={`font-display font-semibold mb-1 ${verifyResult.ok ? 'text-pistachio' : 'text-rose-deep'}`}>
                {verifyResult.ok ? 'Sauvegarde complète : identique aux données actuelles' : 'Différences trouvées'}
              </h3>
              <p className="text-xs text-text-muted mb-3">Sauvegarde du {new Date(verifyResult.created_at).toLocaleString('fr-FR')}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-text-muted"><th className="py-1 pr-4">Table</th><th className="py-1 pr-4">Fichier</th><th className="py-1 pr-4">Base</th><th className="py-1">État</th></tr></thead>
                  <tbody>
                    {verifyResult.tables.map((r) => (
                      <tr key={r.table} className="border-t border-gold/10">
                        <td className="py-1 pr-4 font-mono text-xs">{r.table}</td>
                        <td className="py-1 pr-4">{r.file_rows ?? '—'}</td>
                        <td className="py-1 pr-4">{r.db_rows ?? '—'}</td>
                        <td className={`py-1 ${r.status === 'identique' ? 'text-pistachio' : 'text-rose-deep font-semibold'}`}>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'recycle' && <RecycleBin />}
    </div>
  );
}
