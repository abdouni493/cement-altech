import { create } from 'zustand';
import type { CaisseTransaction, Category } from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';

interface CaisseState {
  transactions: CaisseTransaction[];
  categories: Category[];
  initialBalance: number;
  load: () => Promise<void>;
  setInitialBalance: (b: number) => Promise<void>;
  addTransaction: (t: Omit<CaisseTransaction, 'id' | 'createdAt'>) => Promise<void>;
  updateTransaction: (id: string, data: Partial<CaisseTransaction>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  addCategory: (name: string) => Promise<Category>;
  deleteCategory: (id: string) => Promise<void>;
}

export const useCaisseStore = create<CaisseState>()((set, get) => ({
  transactions: [],
  categories: [],
  initialBalance: 0,

  load: async () => {
    const [transactions, categories, initialBalance] = await Promise.all([
      db.caisse.list(), db.caisseCategories.list(), db.caisse.initialBalance(),
    ]);
    set({ transactions, categories, initialBalance });
  },

  setInitialBalance: async (b) => {
    await save('caisse.setInitialBalance', () => db.caisse.setInitialBalance(b));
    set({ initialBalance: b });
  },

  addTransaction: async (t) => {
    await save('caisse.addTransaction', () =>
      rpc.addCaisseTransaction(t.type, t.amount, t.description, t.date, t.categoryId, t.categoryName)
    );
    set({ transactions: await db.caisse.list() });
  },

  updateTransaction: async (id, data) => {
    const current = get().transactions.find((x) => x.id === id);
    await save('caisse.updateTransaction', () => db.caisse.update(id, { ...current, ...data }));
    set({ transactions: await db.caisse.list() });
  },

  deleteTransaction: async (id) => {
    await save('caisse.deleteTransaction', () => db.caisse.remove(id));
    set({ transactions: get().transactions.filter((x) => x.id !== id) });
  },

  addCategory: async (name) => {
    const existing = get().categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const row = await save('caisseCategories.create', () => db.caisseCategories.create(name));
    set({ categories: [...get().categories, row] });
    return row;
  },

  deleteCategory: async (id) => {
    await save('caisseCategories.delete', () => db.caisseCategories.remove(id));
    set({ categories: get().categories.filter((c) => c.id !== id) });
  },
}));
