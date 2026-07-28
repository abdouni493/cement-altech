import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, CreateAccountData, Lang } from '@/types';
import { uid } from '@/lib/utils';
import { useWorkerStore } from './workerStore';
import { supabase, resolveLoginEmail, fetchProfile } from '@/lib/supabase';

export const DEFAULT_DEMO_ADMIN: User = {
  id: 'usr-demo-admin',
  name: 'Administrateur Démo',
  username: 'demo',
  email: 'demo@altechproduction.com',
  password: 'demo123',
  role: 'admin',
  permissions: 'all',
};

export const INITIAL_ADMIN_ACCOUNTS: User[] = [
  DEFAULT_DEMO_ADMIN,
  {
    id: 'usr-admin-master',
    name: 'Admin Altech Production',
    username: 'admin',
    email: 'admin@altechproduction.com',
    password: 'admin123',
    role: 'admin',
    permissions: 'all',
  },
];

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  /** true while the Supabase session is being restored on boot */
  isBootstrapping: boolean;
  /** false when the browser could not reach Supabase (offline fallback mode) */
  isOnline: boolean;
  language: Lang;
  registeredAccounts: User[];
  login: (credentials: { identifier: string; password: string }) => Promise<boolean>;
  loginAsDemo: () => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  setLanguage: (lang: Lang) => void;
  createAccount: (data: CreateAccountData) => Promise<{ ok: boolean; error?: string }>;
  updateMyAccount: (data: Partial<User>) => void;
}

/** Builds the application user from a `public.profiles` row. */
function userFromProfile(p: {
  id: string;
  full_name: string;
  username: string | null;
  email: string;
  role: 'admin' | 'worker';
  permissions: Record<string, Record<string, boolean>>;
  worker_id: string | null;
}): User {
  return {
    id: p.id,
    name: p.full_name || p.username || p.email,
    username: p.username || p.email.split('@')[0],
    email: p.email,
    role: p.role,
    permissions: p.role === 'admin' ? 'all' : (p.permissions ?? {}),
    workerId: p.worker_id ?? undefined,
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isBootstrapping: true,
      isOnline: true,
      language: 'fr',
      registeredAccounts: INITIAL_ADMIN_ACCOUNTS,

      /**
       * Login page — "Se connecter".
       * 1. the typed identifier (username OR e-mail) is resolved to an e-mail,
       * 2. Supabase Auth validates the password against `auth.users`,
       * 3. the profile (role + permission matrix) is loaded from `public.profiles`.
       * If Supabase is unreachable, the historical local accounts are used so the
       * application keeps working offline.
       */
      login: async ({ identifier, password }) => {
        try {
          const email = await resolveLoginEmail(identifier);
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });

          if (!error && data.user) {
            const profile = await fetchProfile(data.user.id);
            const user: User = profile
              ? userFromProfile(profile)
              : {
                  id: data.user.id,
                  name: (data.user.user_metadata?.full_name as string) || email,
                  username: (data.user.user_metadata?.username as string) || email.split('@')[0],
                  email,
                  role: (data.user.user_metadata?.role as 'admin' | 'worker') || 'admin',
                  permissions: 'all',
                };
            set({ user, isAuthenticated: true, isOnline: true });
            return true;
          }

          if (error && error.message.toLowerCase().includes('fetch')) {
            set({ isOnline: false });
          }
        } catch (e) {
          console.warn('[auth] Supabase indisponible, bascule en mode local:', e);
          set({ isOnline: false });
        }

        return loginLocally(get, set, identifier, password);
      },

      loginAsDemo: async () => {
        const ok = await get().login({ identifier: 'demo', password: 'demo123' });
        if (!ok) set({ user: DEFAULT_DEMO_ADMIN, isAuthenticated: true });
      },

      logout: async () => {
        try {
          await supabase.auth.signOut();
        } catch {
          /* offline: local sign-out is enough */
        }
        set({ user: null, isAuthenticated: false });
      },

      /** Restores an existing Supabase session when the app boots. */
      restoreSession: async () => {
        try {
          const { data } = await supabase.auth.getSession();
          if (data.session?.user) {
            const profile = await fetchProfile(data.session.user.id);
            if (profile) {
              set({ user: userFromProfile(profile), isAuthenticated: true, isOnline: true });
            }
          }
        } catch (e) {
          console.warn('[auth] session non restaurée:', e);
          set({ isOnline: false });
        } finally {
          set({ isBootstrapping: false });
        }
      },

      setLanguage: (lang) => {
        set({ language: lang });
        document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        document.documentElement.setAttribute('lang', lang);
      },

      /** Login page — "Créer un compte Administrateur" (real row in auth.users). */
      createAccount: async (data) => {
        try {
          const { error } = await supabase.rpc('create_admin_account', {
            p_name: data.name,
            p_username: data.username,
            p_email: data.email,
            p_password: data.password,
          });
          if (!error) return { ok: true };
          if (/existe|already|duplicate/i.test(error.message)) {
            return { ok: false, error: 'Cet utilisateur existe déjà' };
          }
          console.warn('[auth] création du compte via Supabase impossible:', error.message);
        } catch (e) {
          console.warn('[auth] Supabase indisponible pour la création du compte:', e);
        }

        // offline fallback — keeps the account locally
        const exists = get().registeredAccounts.some(
          (a) =>
            a.email.toLowerCase() === data.email.toLowerCase() ||
            a.username.toLowerCase() === data.username.toLowerCase()
        );
        if (exists) return { ok: false, error: 'Cet utilisateur existe déjà' };
        const newUser: User = {
          id: uid('usr'),
          name: data.name,
          username: data.username,
          email: data.email,
          password: data.password,
          role: 'admin',
          permissions: 'all',
        };
        set({ registeredAccounts: [...get().registeredAccounts, newUser] });
        return { ok: true };
      },

      updateMyAccount: (data) => {
        const current = get().user;
        if (!current) return;
        const updated = { ...current, ...data };
        set({
          user: updated,
          registeredAccounts: get().registeredAccounts.map((a) =>
            a.id === current.id ? { ...a, ...data } : a
          ),
        });
        supabase
          .from('profiles')
          .update({
            full_name: updated.name,
            username: updated.username,
          })
          .eq('id', current.id)
          .then(({ error }) => {
            if (error) console.warn('[auth] profil non synchronisé:', error.message);
          });
      },
    }),
    {
      name: 'labochimie-auth',
      partialize: (s) => ({
        user: s.user,
        isAuthenticated: s.isAuthenticated,
        language: s.language,
        registeredAccounts: s.registeredAccounts,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AuthState>;
        return {
          ...current,
          ...p,
          isBootstrapping: true,
          registeredAccounts:
            p.registeredAccounts && p.registeredAccounts.length
              ? p.registeredAccounts
              : INITIAL_ADMIN_ACCOUNTS,
        };
      },
    }
  )
);

/** Offline fallback: the historical local accounts (admins + workers). */
function loginLocally(
  get: () => AuthState,
  set: (partial: Partial<AuthState>) => void,
  identifier: string,
  password: string
): boolean {
  const id = identifier.trim().toLowerCase();

  const adminAccounts = get().registeredAccounts.length
    ? get().registeredAccounts
    : INITIAL_ADMIN_ACCOUNTS;
  const admin = adminAccounts.find(
    (a) =>
      (a.email.toLowerCase() === id || a.username.toLowerCase() === id) && a.password === password
  );
  if (admin) {
    set({ user: admin, isAuthenticated: true });
    return true;
  }

  const workers = useWorkerStore.getState().workers;
  const worker = workers.find(
    (w) =>
      w.hasAccount &&
      (w.email.toLowerCase() === id || w.username.toLowerCase() === id) &&
      w.password === password
  );
  if (worker) {
    set({
      user: {
        id: 'wrk-user-' + worker.id,
        name: worker.fullName,
        username: worker.username,
        email: worker.email,
        role: 'worker',
        permissions: worker.permissions,
        workerId: worker.id,
      },
      isAuthenticated: true,
    });
    return true;
  }
  return false;
}

// Keeps the store aligned with Supabase (token refresh, sign-out in another tab)
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    useAuthStore.setState({ user: null, isAuthenticated: false });
  }
});

// Username of the currently logged-in user — stamped on every create operation.
export function getCurrentUsername(): string {
  const u = useAuthStore.getState().user;
  return u?.username || u?.name || 'Démo Admin';
}
