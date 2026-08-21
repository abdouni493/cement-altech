import { create } from 'zustand';
import type { Product, Marque, Category, Unit } from '@/types';
import { db } from '@/lib/db';
import { save } from '@/lib/persist';

interface StockState {
  products: Product[];
  marques: Marque[];
  categories: Category[];
  units: Unit[];
  load: () => Promise<void>;
  addProduct: (p: Omit<Product, 'id' | 'createdAt'>) => Promise<Product>;
  updateProduct: (id: string, data: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  /** Local mirror of the SQL trigger that feeds the stock after a purchase. */
  applyPurchaseToStock: (
    productId: string,
    qty: number,
    minAlert: number,
    purchasePrice: number,
    expirationDate: string | null,
    unitInfo?: { unitEnabled?: boolean; unit?: string }
  ) => void;
  consumeStock: (productId: string, qty: number) => void;
  addMarque: (name: string) => Promise<Marque>;
  addCategory: (name: string) => Promise<Category>;
  deleteMarque: (id: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  addUnit: (name: string) => Promise<Unit>;
  deleteUnit: (id: string) => Promise<void>;
}

export const useStockStore = create<StockState>()((set, get) => ({
  products: [],
  marques: [],
  categories: [],
  units: [],

  load: async () => {
    const [products, marques, categories, units] = await Promise.all([
      db.products.list(), db.marques.list(), db.categories.list(), db.units.list(),
    ]);
    set({ products, marques, categories, units });
  },

  addProduct: async (p) => {
    const row = await save('products.create', () => db.products.create(p));
    set({ products: [row, ...get().products] });
    return row;
  },

  updateProduct: async (id, data) => {
    const row = await save('products.update', () => db.products.update(id, data));
    set({ products: get().products.map((p) => (p.id === id ? row : p)) });
  },

  deleteProduct: async (id) => {
    await save('products.delete', () => db.products.remove(id));
    set({ products: get().products.filter((p) => p.id !== id) });
  },

  applyPurchaseToStock: (productId, qty, minAlert, purchasePrice, expirationDate, unitInfo) =>
    set({
      products: get().products.map((p) =>
        p.id === productId
          ? {
              ...p,
              currentQuantity: p.currentQuantity + qty,
              principalQuantity: (p.principalQuantity || 0) + qty,
              minAlertQuantity: minAlert || p.minAlertQuantity,
              purchasePrice: purchasePrice || p.purchasePrice,
              expirationDate: expirationDate ?? p.expirationDate,
              expirationEnabled: expirationDate ? true : p.expirationEnabled,
              unitEnabled: unitInfo?.unitEnabled ?? p.unitEnabled,
              unit: unitInfo?.unitEnabled ? (unitInfo.unit || p.unit) : p.unit,
            }
          : p
      ),
    }),

  consumeStock: (productId, qty) =>
    set({
      products: get().products.map((p) =>
        p.id === productId ? { ...p, currentQuantity: Math.max(0, p.currentQuantity - qty) } : p
      ),
    }),

  addMarque: async (name) => {
    const existing = get().marques.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const row = await save('marques.create', () => db.marques.create(name));
    set({ marques: [...get().marques, row] });
    return row;
  },

  addCategory: async (name) => {
    const existing = get().categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const row = await save('categories.create', () => db.categories.create(name));
    set({ categories: [...get().categories, row] });
    return row;
  },

  deleteMarque: async (id) => {
    await save('marques.delete', () => db.marques.remove(id));
    set({ marques: get().marques.filter((m) => m.id !== id) });
  },

  deleteCategory: async (id) => {
    await save('categories.delete', () => db.categories.remove(id));
    set({ categories: get().categories.filter((c) => c.id !== id) });
  },

  addUnit: async (name) => {
    const existing = get().units.find((u) => u.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const row = await save('units.create', () => db.units.create(name));
    set({ units: [...get().units, row] });
    return row;
  },

  deleteUnit: async (id) => {
    await save('units.delete', () => db.units.remove(id));
    set({ units: get().units.filter((u) => u.id !== id) });
  },
}));
