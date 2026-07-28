import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product, Marque, Category, Unit } from '@/types';
import { uid } from '@/lib/utils';
import { getCurrentUsername } from './authStore';
import { db } from '@/lib/db';
import { push, swapId } from '@/lib/persist';

interface StockState {
  products: Product[];
  marques: Marque[];
  categories: Category[];
  units: Unit[];
  addProduct: (p: Omit<Product, 'id' | 'createdAt'>) => Product;
  updateProduct: (id: string, data: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  applyPurchaseToStock: (
    productId: string,
    qty: number,
    minAlert: number,
    purchasePrice: number,
    expirationDate: string | null,
    unitInfo?: { unitEnabled?: boolean; unit?: string }
  ) => void;
  consumeStock: (productId: string, qty: number) => void;
  addMarque: (name: string) => Marque;
  addCategory: (name: string) => Category;
  deleteMarque: (id: string) => void;
  deleteCategory: (id: string) => void;
  addUnit: (name: string) => Unit;
  deleteUnit: (id: string) => void;
}

export const useStockStore = create<StockState>()(
  persist(
    (set, get) => ({
      products: [],
      marques: [],
      categories: [],
      units: [],

      addProduct: (p) => {
        const product: Product = {
          ...p,
          id: uid('prod'),
          createdAt: new Date().toISOString().slice(0, 10),
          createdBy: p.createdBy || getCurrentUsername(),
        };
        set({ products: [product, ...get().products] });
        push('products.create', () => db.products.create(p), (row) =>
          set({ products: swapId(get().products, product.id, row.id) })
        );
        return product;
      },

      updateProduct: (id, data) => {
        set({ products: get().products.map((p) => (p.id === id ? { ...p, ...data } : p)) });
        const merged = get().products.find((p) => p.id === id);
        if (merged) push('products.update', () => db.products.update(id, merged));
      },

      deleteProduct: (id) => {
        set({ products: get().products.filter((p) => p.id !== id) });
        push('products.delete', () => db.products.remove(id));
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
            p.id === productId
              ? { ...p, currentQuantity: Math.max(0, p.currentQuantity - qty) }
              : p
          ),
        }),

      addMarque: (name) => {
        const m: Marque = { id: uid('mq'), name };
        set({ marques: [...get().marques, m] });
        push('marques.create', () => db.marques.create(name), (row) =>
          set({ marques: swapId(get().marques, m.id, row.id) })
        );
        return m;
      },

      addCategory: (name) => {
        const c: Category = { id: uid('cat'), name };
        set({ categories: [...get().categories, c] });
        push('categories.create', () => db.categories.create(name), (row) =>
          set({ categories: swapId(get().categories, c.id, row.id) })
        );
        return c;
      },

      deleteMarque: (id) => {
        set({ marques: get().marques.filter((m) => m.id !== id) });
        push('marques.delete', () => db.marques.remove(id));
      },

      deleteCategory: (id) => {
        set({ categories: get().categories.filter((c) => c.id !== id) });
        push('categories.delete', () => db.categories.remove(id));
      },

      addUnit: (name) => {
        const existing = get().units.find((u) => u.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing;
        const u: Unit = { id: uid('unit'), name };
        set({ units: [...get().units, u] });
        push('units.create', () => db.units.create(name), (row) =>
          set({ units: swapId(get().units, u.id, row.id) })
        );
        return u;
      },

      deleteUnit: (id) => {
        set({ units: get().units.filter((u) => u.id !== id) });
        push('units.delete', () => db.units.remove(id));
      },
    }),
    { name: 'altech-stock' }
  )
);
