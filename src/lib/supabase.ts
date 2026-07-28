import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase connection — Altech Production (Ciment Blida).
 *
 * The credentials come from the `.env` file (VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY). The literals below are only a fallback so the
 * application also works when it is built without a `.env` (Vercel preview,
 * `lancer-cement-store.bat`, …). The anon key is a public key: it is safe in
 * the bundle, every table is protected by Row Level Security.
 */
const FALLBACK_URL = 'https://mkzgwfagkhtfytkvlzwb.supabase.co';
const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1remd3ZmFna2h0Znl0a3ZsendiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNTc1MDIsImV4cCI6MjEwMDgzMzUwMn0.i4LxrkyPpn18dfjoUzE_ra3vPROOkX7fOwW7yLfiZ1w';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'altech-production-auth',
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
