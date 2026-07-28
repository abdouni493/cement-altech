import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Expense, Category } from '@/types';
import { uid } from '@/lib/utils';
import { getCurrentUsername } from './authStore';
import { db } from '@/lib/db';
import { push, swapId } from '@/lib/persist';

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
      expenses: [],
      categories: [],
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
    { name: 'altech-expenses' }
  )
);
