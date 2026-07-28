import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CaisseTransaction, Category } from '@/types';
import { uid } from '@/lib/utils';
import { getCurrentUsername } from './authStore';
import { db, rpc } from '@/lib/db';
import { push, swapId } from '@/lib/persist';

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
      transactions: [],
      categories: [],
      initialBalance: 0,
      setInitialBalance: (b) => {
        set({ initialBalance: b });
        push('caisse.setInitialBalance', () => db.caisse.setInitialBalance(b));
      },
      addTransaction: (t) => {
        const tx: CaisseTransaction = {
          ...t,
          id: uid('ctx'),
          createdAt: new Date().toISOString(),
          createdBy: t.createdBy || getCurrentUsername(),
        };
        set({ transactions: [tx, ...get().transactions] });
        push(
          'caisse.addTransaction',
          () =>
            rpc.addCaisseTransaction(
              tx.type, tx.amount, tx.description, tx.date, tx.categoryId, tx.categoryName
            ),
          (row: { id: string }) =>
            set({ transactions: swapId(get().transactions, tx.id, row.id) })
        );
        return tx;
      },
      updateTransaction: (id, data) => {
        set({ transactions: get().transactions.map((tx) => (tx.id === id ? { ...tx, ...data } : tx)) });
        const merged = get().transactions.find((tx) => tx.id === id);
        if (merged) push('caisse.updateTransaction', () => db.caisse.update(id, merged));
      },
      deleteTransaction: (id) => {
        set({ transactions: get().transactions.filter((tx) => tx.id !== id) });
        push('caisse.deleteTransaction', () => db.caisse.remove(id));
      },
      addCategory: (name) => {
        const existing = get().categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing;
        const c: Category = { id: uid('caisscat'), name };
        set({ categories: [...get().categories, c] });
        push('caisseCategories.create', () => db.caisseCategories.create(name), (row) =>
          set({ categories: swapId(get().categories, c.id, row.id) })
        );
        return c;
      },
      deleteCategory: (id) => {
        set({ categories: get().categories.filter((c) => c.id !== id) });
        push('caisseCategories.delete', () => db.caisseCategories.remove(id));
      },
    }),
    {
      name: 'altech-caisse',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CaisseState>;
        return { ...current, ...p, initialBalance: p.initialBalance ?? 0 };
      },
    }
  )
);
