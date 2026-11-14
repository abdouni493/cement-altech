import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase connection — Altech Production (Ciment Blida).
 *
 * NOUVEAU PROJET (asxdoijraguloypigiia). L'ancien projet (bxxdunoxajzybpsihown)
 * etait sature (« statement timeout ») : l'application a ete transferee.
 * Les identifiants sont ecrits ici et NE sont PLUS lus depuis les variables
 * d'environnement : une ancienne variable VITE_SUPABASE_URL restee sur Vercel
 * renverrait sinon le site vers l'ancien projet. La cle anon est publique ;
 * chaque table est protegee par la securite au niveau des lignes (RLS).
 */
export const SUPABASE_URL = 'https://asxdoijraguloypigiia.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzeGRvaWpyYWd1bG95cGlnaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NzMxNTIsImV4cCI6MjExMDI0OTE1Mn0.d-ZVD9KyuxwmbCiSDIkSb66R2t1Ls0L-e6Toe7IkJyU';

/** Ancien projet — lu UNIQUEMENT par l'outil de migration (Parametres). */
export const OLD_SUPABASE_URL = 'https://bxxdunoxajzybpsihown.supabase.co';
export const OLD_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4eGR1bm94YWp6eWJwc2lob3duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTAzOTMsImV4cCI6MjEwODA2NjM5M30.c-CjF4LDrH2XjkRVfi0ezCBqHYTawpFE3MadcAYrDgA';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // nouvelle cle : une session de l'ancien projet n'est pas renvoyee au nouveau
    storageKey: 'altech-production-auth-asxdoij',
  },
});

/** Row of `public.profiles` — the application identity of a logged-in user. */
export interface ProfileRow {
  id: string;
  full_name: string;
  username: string | null;
  email: string;
  role: 'admin' | 'worker';
  permissions: Record<string, Record<string, boolean>>;
  worker_id: string | null;
  language: string;
  is_active: boolean;
}

/**
 * Turns the identifier typed on the login page into an e-mail address.
 * Workers and admins can therefore sign in with their username *or* e-mail.
 * Falls back to the raw input when the RPC is unreachable.
 */
export async function resolveLoginEmail(identifier: string): Promise<string> {
  const id = identifier.trim();
  if (id.includes('@')) return id.toLowerCase();

  const { data, error } = await supabase.rpc('resolve_login_email', { p_identifier: id });
  if (error || !data) return id.toLowerCase();
  return String(data).toLowerCase();
}

/** Loads the profile (role + permission matrix) of a given auth user. */
export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, email, role, permissions, worker_id, language, is_active')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[supabase] profile load failed:', error.message);
    return null;
  }
  return (data as ProfileRow) ?? null;
}

/** True when the browser could actually reach the Supabase REST endpoint. */
export async function isSupabaseReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    return res.ok;
  } catch {
    return false;
  }
}
