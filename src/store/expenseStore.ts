import { create } from 'zustand';
import type { Expense, Category, PurchaseOrder } from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';

interface ExpenseState {
  expenses: Expense[];
  categories: Category[];
  /** Bons de commande créés depuis l'écran Dépenses. */
  orders: PurchaseOrder[];
  load: () => Promise<void>;
  addExpense: (e: Omit<Expense, 'id' | 'date'> & { date?: string }) => Promise<Expense>;
  updateExpense: (id: string, data: Partial<Expense>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  addCategory: (name: string) => Promise<Category>;
  deleteCategory: (id: string) => Promise<void>;
  // ---- bons de commande ----
  addOrder: (data: Omit<PurchaseOrder, 'id' | 'reference'>) => Promise<PurchaseOrder>;
  updateOrder: (id: string, data: Partial<PurchaseOrder>) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
}

const orderPayload = (d: Partial<PurchaseOrder>) => ({
  date: d.date,
  supplier_name: d.supplierName ?? '',
  notes: d.notes ?? '',
  items: (d.items ?? []).map((i) => ({
    product_name: i.productName,
    description: i.description ?? '',
    quantity: i.quantity,
    unit: i.unit ?? null,
  })),
});

export const useExpenseStore = create<ExpenseState>()((set, get) => ({
  expenses: [],
  categories: [],
  orders: [],

  load: async () => {
    const [expenses, categories, orders] = await Promise.all([
      db.expenses.list(), db.expenseCategories.list(), db.purchaseOrders.list(),
    ]);
    set({ expenses, categories, orders });
  },

  addExpense: async (e) => {
    const row = await save('expenses.create', () =>
      db.expenses.create({ ...e, date: e.date || new Date().toISOString().slice(0, 10) })
    );
    set({ expenses: [row, ...get().expenses] });
    return row;
  },

  updateExpense: async (id, data) => {
    const current = get().expenses.find((x) => x.id === id);
    const row = await save('expenses.update', () => db.expenses.update(id, { ...current, ...data }));
    set({ expenses: get().expenses.map((x) => (x.id === id ? row : x)) });
  },

  deleteExpense: async (id) => {
    await save('expenses.delete', () => db.expenses.remove(id));
    set({ expenses: get().expenses.filter((x) => x.id !== id) });
  },

  addCategory: async (name) => {
    const existing = get().categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const row = await save('expenseCategories.create', () => db.expenseCategories.create(name));
    set({ categories: [...get().categories, row] });
    return row;
  },

  deleteCategory: async (id) => {
    await save('expenseCategories.delete', () => db.expenseCategories.remove(id));
    set({ categories: get().categories.filter((c) => c.id !== id) });
  },

  addOrder: async (data) => {
    const row = await save('purchaseOrders.create', () => rpc.createPurchaseOrder(orderPayload(data)));
    const orders = await db.purchaseOrders.list();
    set({ orders });
    return orders.find((o) => o.id === row.id) as PurchaseOrder;
  },

  updateOrder: async (id, data) => {
    await save('purchaseOrders.update', () => rpc.updatePurchaseOrder(id, orderPayload(data)));
    set({ orders: await db.purchaseOrders.list() });
  },

  deleteOrder: async (id) => {
    await save('purchaseOrders.delete', () => db.purchaseOrders.remove(id));
    set({ orders: get().orders.filter((o) => o.id !== id) });
  },
}));
