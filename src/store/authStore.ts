import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, CreateAccountData, Lang } from '@/types';
import { uid } from '@/lib/utils';
import { useWorkerStore } from './workerStore';

export const DEFAULT_DEMO_ADMIN: User = {
  id: 'usr-demo-admin',
  name: 'Administrateur Démo',
  username: 'demo',
  email: 'demo@cementstore.com',
  password: 'demo',
  role: 'admin',
  permissions: 'all',
};

export const INITIAL_ADMIN_ACCOUNTS: User[] = [
  DEFAULT_DEMO_ADMIN,
  {
    id: 'usr-admin-master',
    name: 'Admin Cement Store',
    username: 'admin',
    email: 'admin@cementstore.com',
    password: 'admin',
    role: 'admin',
    permissions: 'all',
  },
];

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  language: Lang;
  registeredAccounts: User[];
  login: (credentials: { identifier: string; password: string }) => boolean;
  loginAsDemo: () => void;
  logout: () => void;
  setLanguage: (lang: Lang) => void;
  createAccount: (data: CreateAccountData) => { ok: boolean; error?: string };
  updateMyAccount: (data: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      language: 'fr',
      registeredAccounts: INITIAL_ADMIN_ACCOUNTS,

      login: ({ identifier, password }) => {
        const id = identifier.trim().toLowerCase();
        
        // Check registered admin accounts or demo fallback
        const adminAccounts = get().registeredAccounts.length ? get().registeredAccounts : INITIAL_ADMIN_ACCOUNTS;
        const admin = adminAccounts.find(
          (a) =>
            (a.email.toLowerCase() === id || a.username.toLowerCase() === id) &&
            a.password === password
        );
        if (admin) {
          set({ user: admin, isAuthenticated: true });
          return true;
        }

        // Demo account shortcut
        if ((id === 'demo' || id === 'admin') && (password === 'demo' || password === 'admin')) {
          set({ user: DEFAULT_DEMO_ADMIN, isAuthenticated: true });
          return true;
        }

        // Worker accounts
        const workers = useWorkerStore.getState().workers;
        const worker = workers.find(
          (w) =>
            w.hasAccount &&
            (w.email.toLowerCase() === id || w.username.toLowerCase() === id) &&
            w.password === password
        );
        if (worker) {
          const wUser: User = {
            id: 'wrk-user-' + worker.id,
            name: worker.fullName,
            username: worker.username,
            email: worker.email,
            role: 'worker',
            permissions: worker.permissions,
            workerId: worker.id,
          };
          set({ user: wUser, isAuthenticated: true });
          return true;
        }
        return false;
      },

      loginAsDemo: () => {
        set({ user: DEFAULT_DEMO_ADMIN, isAuthenticated: true });
      },

      logout: () => set({ user: null, isAuthenticated: false }),

      setLanguage: (lang) => {
        set({ language: lang });
        document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        document.documentElement.setAttribute('lang', lang);
      },

      createAccount: (data) => {
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
      },
    }),
    {
      name: 'labochimie-auth',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AuthState>;
        return {
          ...current,
          ...p,
          registeredAccounts: p.registeredAccounts && p.registeredAccounts.length ? p.registeredAccounts : INITIAL_ADMIN_ACCOUNTS,
        };
      },
    }
  )
);

// Username of the currently logged-in user — stamped on every create operation.
export function getCurrentUsername(): string {
  const u = useAuthStore.getState().user;
  return u?.username || u?.name || 'Démo Admin';
}
