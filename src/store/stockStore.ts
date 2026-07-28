import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product, Marque, Category, Unit } from '@/types';
import { uid } from '@/lib/utils';
import { getCurrentUsername } from './authStore';
import { db } from '@/lib/db';
import { push, swapId } from '@/lib/persist';

const DEFAULT_UNITS: Unit[] = [
  { id: 'unit-m3', name: 'm³' },
  { id: 'unit-tonne', name: 'Tonne' },
  { id: 'unit-sac', name: 'Sac (50kg)' },
  { id: 'unit-kg', name: 'kg' },
  { id: 'unit-l', name: 'litre' },
  { id: 'unit-m', name: 'm' },
];

export const INITIAL_MARQUES: Marque[] = [
  { id: 'mq-1', name: 'GICA' },
  { id: 'mq-2', name: 'Lafarge Holcim' },
  { id: 'mq-3', name: 'Al-Badr' },
  { id: 'mq-4', name: 'Sika Algérie' },
  { id: 'mq-5', name: 'Sider El Hadjar' },
];

export const INITIAL_CATEGORIES: Category[] = [
  { id: 'cat-1', name: 'Ciments & Liants' },
  { id: 'cat-2', name: 'Béton & Mortier' },
  { id: 'cat-3', name: 'Agrégats & Graviers' },
  { id: 'cat-4', name: 'Fer à Béton & Armatures' },
  { id: 'cat-5', name: 'Adjuvants & Chimie BTP' },
];

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod-1',
    name: 'Ciment Portland CPJ 42.5 (Sac 50kg)',
    description: 'Ciment Portland CPJ 42.5 haute résistance',
    barcode: '6130001001',
    marqueId: 'mq-1',
    categoryId: 'cat-1',
    purchasePrice: 650,
    currentQuantity: 450,
    principalQuantity: 450,
    minAlertQuantity: 50,
    unit: 'Sac (50kg)',
    createdAt: '2026-07-01',
    createdBy: 'admin',
    expirationEnabled: false,
    expirationDate: null,
  },
  {
    id: 'prod-2',
    name: 'Ciment CRS Résistant aux Sulfates (Tonne)',
    description: 'Ciment CRS pour travaux maritimes et fondations spéciales',
    barcode: '6130001002',
    marqueId: 'mq-2',
    categoryId: 'cat-1',
    purchasePrice: 14000,
    currentQuantity: 80,
    principalQuantity: 80,
    minAlertQuantity: 15,
    unit: 'Tonne',
    createdAt: '2026-07-01',
    createdBy: 'admin',
    expirationEnabled: false,
    expirationDate: null,
  },
  {
    id: 'prod-3',
    name: 'Béton Prêt à l\'Emploi B25 (m³)',
    description: 'Béton B25 pour dalles et voiles',
    barcode: '6130001003',
    marqueId: 'mq-3',
    categoryId: 'cat-2',
    purchasePrice: 7500,
    currentQuantity: 200,
    principalQuantity: 200,
    minAlertQuantity: 30,
    unit: 'm³',
    createdAt: '2026-07-05',
    createdBy: 'admin',
    expirationEnabled: false,
    expirationDate: null,
  },
  {
    id: 'prod-4',
    name: 'Sable de Dune Lavé 0/2 (m³)',
    description: 'Sable lavé pour mortier et béton',
    barcode: '6130001004',
    marqueId: 'mq-3',
    categoryId: 'cat-3',
    purchasePrice: 1800,
    currentQuantity: 350,
    principalQuantity: 350,
    minAlertQuantity: 40,
    unit: 'm³',
    createdAt: '2026-07-10',
    createdBy: 'admin',
    expirationEnabled: false,
    expirationDate: null,
  },
  {
    id: 'prod-5',
    name: 'Gravier Concassé 3/8 (Tonne)',
    description: 'Gravier concassé 3/8 pour béton armé',
    barcode: '6130001005',
    marqueId: 'mq-3',
    categoryId: 'cat-3',
    purchasePrice: 1500,
    currentQuantity: 180,
    principalQuantity: 180,
    minAlertQuantity: 25,
    unit: 'Tonne',
    createdAt: '2026-07-10',
    createdBy: 'admin',
    expirationEnabled: false,
    expirationDate: null,
  },
  {
    id: 'prod-6',
    name: 'Rond à Béton FeE500 12mm (Tonne)',
    description: 'Fer à béton haute adhérence FeE500 12mm',
    barcode: '6130001006',
    marqueId: 'mq-5',
    categoryId: 'cat-4',
    purchasePrice: 110000,
    currentQuantity: 25,
    principalQuantity: 25,
    minAlertQuantity: 5,
    unit: 'Tonne',
    createdAt: '2026-07-12',
    createdBy: 'admin',
    expirationEnabled: false,
    expirationDate: null,
  },
  {
    id: 'prod-7',
    name: 'Adjuvant Plastifiant Béton Sika 20L',
    description: 'Plastifiant haut réducteur d\'eau',
    barcode: '6130001007',
    marqueId: 'mq-4',
    categoryId: 'cat-5',
    purchasePrice: 4200,
    currentQuantity: 40,
    principalQuantity: 40,
    minAlertQuantity: 10,
    unit: 'litre',
    createdAt: '2026-07-15',
    createdBy: 'admin',
    expirationEnabled: false,
    expirationDate: null,
  },
];

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
      products: INITIAL_PRODUCTS,
      marques: INITIAL_MARQUES,
      categories: INITIAL_CATEGORIES,
      units: DEFAULT_UNITS,

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
    {
      name: 'labochimie-stock',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StockState>;
        return {
          ...current,
          ...p,
          products: p.products && p.products.length ? p.products : INITIAL_PRODUCTS,
          marques: p.marques && p.marques.length ? p.marques : INITIAL_MARQUES,
          categories: p.categories && p.categories.length ? p.categories : INITIAL_CATEGORIES,
          units: p.units && p.units.length ? p.units : DEFAULT_UNITS,
        };
      },
    }
  )
);
