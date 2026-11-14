import { useState } from 'react';
import { ArrowRightLeft, CheckCircle2, AlertTriangle, LogIn, Download } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { downloadJSON, todayISO } from '@/lib/utils';
import {
  loginOldProject, exportOldProject, restoreIntoNewProject, logoutOldProject,
} from '@/lib/migration';

/**
 * TRANSFERT DE L'ANCIENNE BASE VERS LA NOUVELLE.
 * L'administrateur saisit ses identifiants de l'ANCIENNE application ; tout est
 * lu, une copie est telechargee, puis restauree dans la nouvelle base.
 */
export function MigrationPanel() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ rows: number; users: number; failed: string[] } | null>(null);
  const [lastFile, setLastFile] = useState<Record<string, any> | null>(null);

  const run = async () => {
    if (!identifier.trim() || !password) {
      toast.error("Saisissez l'identifiant et le mot de passe administrateur de l'ancienne application");
      return;
    }
    const ok = window.confirm(
      'Transférer TOUTES les données de l\'ancienne base vers la nouvelle ?\n\n' +
      'Les données actuelles de la nouvelle base seront remplacées. ' +
      'Si les comptes de connexion sont transférés, vous devrez vous reconnecter ' +
      'avec vos identifiants de l\'ancienne application.'
    );
    if (!ok) return;
    setRunning(true);
    setDone(null);
    try {
      setStatus("Connexion à l'ancienne base…");
      await loginOldProject(identifier, password);

      const data = await exportOldProject(setStatus);
      setLastFile(data);
      // copie de securite AVANT toute ecriture dans la nouvelle base
      downloadJSON(data, `altech-migration-${todayISO()}.json`);

      const failed: string[] = Array.isArray(data.failed_tables) ? data.failed_tables : [];
      if (failed.length) {
        const go = window.confirm(
          `${failed.length} table(s) n'ont pas pu être lues dans l'ancienne base (trop lente) :\n` +
          `${failed.join(', ')}\n\nContinuer quand même la restauration ? ` +
          '(Annuler pour réessayer plus tard — le fichier téléchargé reste disponible.)'
        );
        if (!go) { setStatus('Restauration annulée — relancez le transfert plus tard.'); return; }
      }

      setStatus('Restauration dans la nouvelle base…');
      const res = await restoreIntoNewProject(data);
      if (data.local?.deliverers) {
        try { localStorage.setItem('altech-deliverers-v1', JSON.stringify(data.local.deliverers)); } catch { /* ignore */ }
      }
      const rows = Object.values(res.tables ?? {}).reduce((s: number, n) => s + Number(n), 0);
      setDone({ rows, users: res.users ?? 0, failed });
      setStatus('');
      await logoutOldProject();
      toast.success(`Transfert terminé — ${rows} lignes, ${res.users ?? 0} compte(s)`);
    } catch (e) {
      setStatus('');
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card index={0} className="border-gold/40">
      <div className="mb-2 flex items-center gap-2 text-gold-dark">
        <ArrowRightLeft size={20} />
        <h3 className="font-display font-semibold text-text-primary">Transférer les données de l'ancienne base</h3>
      </div>
      <p className="mb-1 text-sm text-text-muted">
        L'application utilise maintenant le nouveau projet Supabase. Saisissez l'identifiant et le mot de
        passe <b>administrateur de l'ancienne application</b> : toutes les données (et les comptes de
        connexion quand l'ancienne base le permet) sont copiées ici. Un fichier de sauvegarde est
        téléchargé avant la restauration.
      </p>
      <p className="mb-4 flex items-center gap-1 text-xs text-rose-deep">
        <AlertTriangle size={14} /> Remplace toutes les données de la nouvelle base. À faire une seule fois.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          label="Identifiant (ancienne application)"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          disabled={running}
        />
        <Input
          label="Mot de passe"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={running}
        />
        <div className="flex items-end">
          <Button variant="gold" className="w-full" onClick={run} disabled={running}>
            <LogIn size={16} /> {running ? 'Transfert en cours…' : 'Lancer le transfert'}
          </Button>
        </div>
      </div>

      {status && <p className="mt-3 text-sm font-medium text-gold-dark">{status}</p>}

      {done && (
        <div className="mt-4 rounded-xl border border-pistachio/40 bg-pistachio/10 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-bold text-pistachio">
            <CheckCircle2 size={16} /> Transfert terminé : {done.rows} lignes restaurées
          </p>
          {done.users > 0 ? (
            <p className="mt-1 text-text-secondary">
              {done.users} compte(s) de connexion transféré(s). Déconnectez-vous puis reconnectez-vous
              avec vos identifiants de l'ancienne application.
            </p>
          ) : (
            <p className="mt-1 text-text-secondary">
              L'ancienne base était trop lente pour lire les comptes : votre compte actuel est conservé ;
              recréez les comptes des employés depuis l'écran Employés (bouton « Créer le compte »).
            </p>
          )}
          {done.failed.length > 0 && (
            <p className="mt-1 text-rose-deep">Tables non transférées : {done.failed.join(', ')}</p>
          )}
          <p className="mt-1 text-text-muted">Rechargez la page (Ctrl+F5) pour afficher les données.</p>
        </div>
      )}

      {lastFile && !running && (
        <Button
          size="sm" variant="secondary" className="mt-3"
          onClick={() => downloadJSON(lastFile, `altech-migration-${todayISO()}.json`)}
        >
          <Download size={14} /> Retélécharger le fichier
        </Button>
      )}
    </Card>
  );
}
