import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OLD_SUPABASE_URL, OLD_SUPABASE_ANON_KEY } from './supabase';
import { BACKUP_TABLES, selectAll, backup } from './db';

/* ============================================================================
 *  MIGRATION : ANCIEN PROJET SUPABASE  ->  NOUVEAU PROJET
 * ----------------------------------------------------------------------------
 *  L'application est desormais connectee au NOUVEAU projet. Cet outil ouvre
 *  une seconde connexion, vers l'ANCIEN projet, avec le compte administrateur
 *  de l'ancienne base, puis :
 *    1. lit toutes les donnees de l'ancienne base :
 *       - d'abord par backup_export() (inclut les comptes de connexion et
 *         leurs mots de passe chiffres) ;
 *       - si l'ancienne base est trop lente, table par table (sans les
 *         comptes : les comptes employes seront a recreer) ;
 *    2. telecharge le fichier de sauvegarde (copie de securite) ;
 *    3. le restaure dans le nouveau projet par backup_restore().
 * ========================================================================== */

let oldClient: SupabaseClient | null = null;

function old(): SupabaseClient {
  if (!oldClient) {
    oldClient = createClient(OLD_SUPABASE_URL, OLD_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'altech-old-project-migration',
      },
    });
  }
  return oldClient;
}

/** Connexion a l'ANCIENNE base avec le compte administrateur (nom d'utilisateur ou e-mail). */
export async function loginOldProject(identifier: string, password: string): Promise<void> {
  const id = identifier.trim();
  let email = id.toLowerCase();
  if (!id.includes('@')) {
    const { data } = await old().rpc('resolve_login_email', { p_identifier: id });
    if (data) email = String(data).toLowerCase();
  }
  const { error } = await old().auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Connexion a l'ancienne base refusee : ${error.message}`);
}

export type MigrationStep = (message: string) => void;

/** Lit toute l'ancienne base. `withAccounts` indique si les comptes sont inclus. */
export async function exportOldProject(step: MigrationStep): Promise<Record<string, any>> {
  step("Lecture complete de l'ancienne base (avec les comptes)…");
  const { data, error } = await old().rpc('backup_export');
  let result: Record<string, any>;
  if (!error && data && (data as any).tables) {
    result = data as Record<string, any>;
  } else {
    if (error) console.warn('[migration] backup_export :', error.message);
    const tables: Record<string, any[]> = {};
    const counts: Record<string, number> = {};
    const failed: string[] = [];
    for (let i = 0; i < BACKUP_TABLES.length; i++) {
      const t = BACKUP_TABLES[i];
      step(`Ancienne base lente : lecture table par table ${i + 1}/${BACKUP_TABLES.length} (${t})`);
      try {
        const rows = await selectAll(t, old());
        if (rows === null) continue;
        tables[t] = rows;
        counts[t] = rows.length;
      } catch (e) {
        console.warn('[migration]', (e as Error).message);
        failed.push(t);
      }
    }
    result = {
      format: 'altech-production-backup', version: 2, source: 'client',
      created_at: new Date().toISOString(), tables, counts,
      ...(failed.length ? { failed_tables: failed } : {}),
    };
  }
  try {
    const local = JSON.parse(localStorage.getItem('altech-deliverers-v1') || 'null');
    if (local) result = { ...result, local: { deliverers: local } };
  } catch { /* ignore */ }
  return result;
}

/** Restaure le fichier dans le NOUVEAU projet (compte administrateur requis). */
export async function restoreIntoNewProject(data: Record<string, any>) {
  return backup.restore(data);
}

export async function logoutOldProject(): Promise<void> {
  try { await old().auth.signOut(); } catch { /* ignore */ }
}
