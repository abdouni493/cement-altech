import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CaisseTransaction, Category } from '@/types';
import { uid } from '@/lib/utils';
import { getCurrentUsername } from './authStore';

export const INITIAL_CAISSE_CATEGORIES: Category[] = [
  { id: 'caisscat-1', name: 'Vente' },
  { id: 'caisscat-2', name: 'Commande' },
  { id: 'caisscat-3', name: 'Dépense' },
  { id: 'caisscat-4', name: 'Achat' },
];

export const INITIAL_CAISSE_TRANSACTIONS: CaisseTransaction[] = [
  { id: 'ctx-1', type: 'deposit', categoryName: 'Vente', amount: 50000, description: 'Règlement Vente VNT-2026-001 (Benali BTP)', date: '2026-07-20', createdAt: '2026-07-20T10:15:00.000Z', createdBy: 'admin' },
  { id: 'ctx-2', type: 'deposit', categoryName: 'Vente', amount: 145000, description: 'Règlement Vente VNT-2026-002 (El Badr)', date: '2026-07-22', createdAt: '2026-07-22T11:30:00.000Z', createdBy: 'admin' },
  { id: 'ctx-3', type: 'withdrawal', categoryName: 'Dépense', amount: 12000, description: 'Frais de transport & carburant malaxeur', date: '2026-07-23', createdAt: '2026-07-23T14:00:00.000Z', createdBy: 'admin' },
  { id: 'ctx-4', type: 'deposit', categoryName: 'Commande', amount: 100000, description: 'Acompte commande CMD-2026-001', date: '2026-07-24', createdAt: '2026-07-24T10:05:00.000Z', createdBy: 'admin' },
];

interface CaisseState {
  transactions: CaisseTransaction[];
  categories: Category[];
  initialBalance: number;
  setInitialBalance: (b: number) => void;
  addTransaction: (t: Omit<CaisseTransaction, 'id' | 'createdAt'>) => CaisseTransaction;
  updateTransaction: (id: string, data: Partial<CaisseTransaction>) => void;
  deleteTransaction: (id: string) => void;
  addCategory: (name: string) => Category;
  deleteCategory: (id: string) => void;
}

export const useCaisseStore = create<CaisseState>()(
  persist(
    (set, get) => ({
      transactions: INITIAL_CAISSE_TRANSACTIONS,
      categories: INITIAL_CAISSE_CATEGORIES,
      initialBalance: 250000,
      setInitialBalance: (b) => set({ initialBalance: b }),
      addTransaction: (t) => {
        const tx: CaisseTransaction = {
          ...t,
          id: uid('ctx'),
          createdAt: new Date().toISOString(),
          createdBy: t.createdBy || getCurrentUsername(),
        };
        set({ transactions: [tx, ...get().transactions] });
        return tx;
      },
      updateTransaction: (id, data) =>
        set({ transactions: get().transactions.map((tx) => (tx.id === id ? { ...tx, ...data } : tx)) }),
      deleteTransaction: (id) =>
        set({ transactions: get().transactions.filter((tx) => tx.id !== id) }),
      addCategory: (name) => {
        const existing = get().categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing;
        const c: Category = { id: uid('caisscat'), name };
        set({ categories: [...get().categories, c] });
        return c;
      },
      deleteCategory: (id) => set({ categories: get().categories.filter((c) => c.id !== id) }),
    }),
    {
      name: 'labochimie-caisse',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CaisseState>;
        return {
          ...current,
          ...p,
          transactions: p.transactions && p.transactions.length ? p.transactions : INITIAL_CAISSE_TRANSACTIONS,
          categories: p.categories && p.categories.length ? p.categories : INITIAL_CAISSE_CATEGORIES,
          initialBalance: p.initialBalance !== undefined ? p.initialBalance : 250000,
        };
      },
    }
  )
);
