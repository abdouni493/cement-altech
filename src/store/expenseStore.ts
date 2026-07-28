import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Expense, Category } from '@/types';
import { uid } from '@/lib/utils';
import { getCurrentUsername } from './authStore';
import { db } from '@/lib/db';
import { push, swapId } from '@/lib/persist';

export const INITIAL_EXPENSE_CATEGORIES: Category[] = [
  { id: 'expcat-1', name: 'Transport & Carburant' },
  { id: 'expcat-2', name: 'Électricité & Énergie' },
  { id: 'expcat-3', name: 'Maintenance Équipement' },
  { id: 'expcat-4', name: 'Achats Fournitures & Outillage' },
];

export const INITIAL_EXPENSES: Expense[] = [
  { id: 'exp-1', name: 'Carburant camions', categoryName: 'Transport & Carburant', description: 'Carburant pour camions toupies et malaxeurs', amount: 12000, date: '2026-07-23', createdBy: 'admin' },
  { id: 'exp-2', name: 'Électricité usine', categoryName: 'Électricité & Énergie', description: 'Facture électricité centrale à béton', amount: 35000, date: '2026-07-24', createdBy: 'admin' },
  { id: 'exp-3', name: 'Vidange & Entretien', categoryName: 'Maintenance Équipement', description: 'Vidange et graissage tapis roulant centralier', amount: 18000, date: '2026-07-26', createdBy: 'admin' },
];

interface ExpenseState {
  expenses: Expense[];
  categories: Category[];
  addExpense: (e: Omit<Expense, 'id' | 'date'> & { date?: string }) => Expense;
  updateExpense: (id: string, data: Partial<Expense>) => void;
  deleteExpense: (id: string) => void;
  addCategory: (name: string) => Category;
  deleteCategory: (id: string) => void;
}

export const useExpenseStore = create<ExpenseState>()(
  persist(
    (set, get) => ({
      expenses: INITIAL_EXPENSES,
      categories: INITIAL_EXPENSE_CATEGORIES,
      addExpense: (e) => {
        const expense: Expense = {
          ...e,
          id: uid('exp'),
          date: e.date || new Date().toISOString().slice(0, 10),
          createdBy: e.createdBy || getCurrentUsername(),
        };
        set({ expenses: [expense, ...get().expenses] });
        // the SQL trigger `trg_expense_caisse` books the matching caisse withdrawal
        push('expenses.create', () => db.expenses.create(expense), (row) =>
          set({ expenses: swapId(get().expenses, expense.id, row.id) })
        );
        return expense;
      },
      updateExpense: (id, data) => {
        set({ expenses: get().expenses.map((ex) => (ex.id === id ? { ...ex, ...data } : ex)) });
        const merged = get().expenses.find((ex) => ex.id === id);
        if (merged) push('expenses.update', () => db.expenses.update(id, merged));
      },
      deleteExpense: (id) => {
        set({ expenses: get().expenses.filter((ex) => ex.id !== id) });
        push('expenses.delete', () => db.expenses.remove(id));
      },
      addCategory: (name) => {
        const existing = get().categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing;
        const c: Category = { id: uid('expcat'), name };
        set({ categories: [...get().categories, c] });
        push('expenseCategories.create', () => db.expenseCategories.create(name), (row) =>
          set({ categories: swapId(get().categories, c.id, row.id) })
        );
        return c;
      },
      deleteCategory: (id) => {
        set({ categories: get().categories.filter((c) => c.id !== id) });
        push('expenseCategories.delete', () => db.expenseCategories.remove(id));
      },
    }),
    {
      name: 'labochimie-expenses',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ExpenseState>;
        return {
          ...current,
          ...p,
          expenses: p.expenses && p.expenses.length ? p.expenses : INITIAL_EXPENSES,
          categories: p.categories && p.categories.length ? p.categories : INITIAL_EXPENSE_CATEGORIES,
        };
      },
    }
  )
);
