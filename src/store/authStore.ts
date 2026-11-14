import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, CreateAccountData, Lang } from '@/types';
import { uid } from '@/lib/utils';
import { supabase, resolveLoginEmail, fetchProfile } from '@/lib/supabase';

export interface UpdateMyAccountData {
  name: string;
  username: string;
  email: string;
  oldPassword?: string;
  newPassword?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  /** true while the Supabase session is being restored on boot */
  isBootstrapping: boolean;
  /** false when the browser could not reach Supabase (offline fallback mode) */
  isOnline: boolean;
  language: Lang;
  /** admin accounts created from this browser while Supabase was unreachable */
  registeredAccounts: User[];
  login: (credentials: { identifier: string; password: string }) => Promise<boolean>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  setLanguage: (lang: Lang) => void;
  /** Re-reads the permission matrix of the logged-in user from the database. */
  refreshProfile: () => Promise<void>;
  /** true as soon as the store has an administrator (hides the login-page button) */
  adminExists: () => Promise<boolean>;
  createAccount: (data: CreateAccountData) => Promise<{ ok: boolean; error?: string }>;
  /** Settings › "Mon compte": saves name, username, e-mail and password in Supabase. */
  updateMyAccount: (data: UpdateMyAccountData) => Promise<{ ok: boolean; error?: string }>;
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
      registeredAccounts: [],

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

      refreshProfile: async () => {
        const current = get().user;
        if (!current) return;
        try {
          const profile = await fetchProfile(current.id);
          if (profile) set({ user: userFromProfile(profile) });
        } catch {
          /* offline — keep the permissions loaded at login */
        }
      },

      setLanguage: (lang) => {
        set({ language: lang });
        document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        document.documentElement.setAttribute('lang', lang);
      },

      /**
       * Login page — is the "Créer un compte Administrateur" button still needed?
       * The database answers through `admin_account_exists()`; when it cannot be
       * reached only the accounts registered from this browser are known.
       */
      adminExists: async () => {
        try {
          const { data, error } = await supabase.rpc('admin_account_exists');
          if (!error) return Boolean(data);
          console.warn('[auth] admin_account_exists indisponible:', error.message);
        } catch (e) {
          console.warn('[auth] Supabase injoignable pour admin_account_exists:', e);
        }
        return get().registeredAccounts.some((a) => a.role === 'admin');
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
          // the database refused: the rule is final, no local fallback
          if (/administrateur existe/i.test(error.message)) {
            return { ok: false, error: 'Un compte administrateur existe déjà' };
          }
          if (/existe|already|duplicate/i.test(error.message)) {
            return { ok: false, error: 'Cet utilisateur existe déjà' };
          }
          return { ok: false, error: error.message };
        } catch (e) {
          console.warn('[auth] Supabase indisponible pour la création du compte:', e);
        }

        // Supabase unreachable — the account is kept locally so a fresh offline
        // installation is not locked out; it is re-created online afterwards.
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

      updateMyAccount: async (data) => {
        const current = get().user;
        if (!current) return { ok: false, error: 'Aucun utilisateur connecté' };

        const name = data.name.trim();
        const username = data.username.trim().toLowerCase();
        const email = data.email.trim().toLowerCase();
        const changes = { name, username, email };

        // Local offline admin account (no Supabase row): update it in place.
        const localAccount = get().registeredAccounts.find((a) => a.id === current.id);
        if (localAccount) {
          if (data.newPassword && localAccount.password && data.oldPassword !== localAccount.password) {
            return { ok: false, error: 'Ancien mot de passe incorrect' };
          }
          const patch = { ...changes, ...(data.newPassword ? { password: data.newPassword } : {}) };
          set({
            user: { ...current, ...changes },
            registeredAccounts: get().registeredAccounts.map((a) =>
              a.id === current.id ? { ...a, ...patch } : a
            ),
          });
          return { ok: true };
        }

        try {
          const { error } = await supabase.rpc('update_my_account', {
            p_name: name,
            p_username: username,
            p_email: email,
            p_old_password: data.oldPassword || null,
            p_new_password: data.newPassword || null,
          });

          if (error) {
            // Function not yet installed in the database: fall back to the Auth API.
            if (error.code === 'PGRST202' || /update_my_account/i.test(error.message)) {
              const fallback = await updateAccountWithAuthApi(current, changes, data);
              if (!fallback.ok) return fallback;
            } else {
              return { ok: false, error: error.message };
            }
          }

          // Re-read the saved profile so the screen shows what is really stored.
          const profile = await fetchProfile(current.id);
          set({ user: profile ? userFromProfile(profile) : { ...current, ...changes }, isOnline: true });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message || 'Supabase injoignable' };
        }
      },
    }),
    {
      name: 'altech-auth',
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
          registeredAccounts: p.registeredAccounts ?? [],
        };
      },
    }
  )
);

/**
 * Fallback when `update_my_account()` is not installed in the database yet.
 * Only the name and username can be saved safely this way: changing the e-mail
 * through the Auth API leaves it "pending confirmation" in auth.users while the
 * profile already holds the new address, which breaks the login. The e-mail and
 * password are therefore only changed by the SQL function.
 */
async function updateAccountWithAuthApi(
  current: User,
  changes: { name: string; username: string; email: string },
  data: UpdateMyAccountData
): Promise<{ ok: boolean; error?: string }> {
  if (changes.email !== current.email.toLowerCase() || data.newPassword) {
    return {
      ok: false,
      error:
        "La modification de l'e-mail ou du mot de passe nécessite la mise à jour de la base : " +
        'exécutez le fichier altech_production_update_mon_compte.sql dans Supabase › SQL Editor, puis réessayez.',
    };
  }
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: changes.name, username: changes.username })
    .eq('id', current.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Offline fallback: accounts registered from this browser (admins + workers). */
function loginLocally(
  get: () => AuthState,
  set: (partial: Partial<AuthState>) => void,
  identifier: string,
  password: string
): boolean {
  const id = identifier.trim().toLowerCase();

  const admin = get().registeredAccounts.find(
    (a) =>
      (a.email.toLowerCase() === id || a.username.toLowerCase() === id) && a.password === password
  );
  if (admin) {
    set({ user: admin, isAuthenticated: true });
    return true;
  }

  // Employees always sign in through Supabase Auth (their account lives in
  // `auth.users`): there is no local password copy to fall back on.
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
  return u?.username || u?.name || 'system';
}
