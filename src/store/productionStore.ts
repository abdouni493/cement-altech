import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Production, UsedProduct, Category } from '@/types';
import { uid } from '@/lib/utils';
import { useStockStore } from './stockStore';
import { useComptoirStore } from './comptoirStore';
import { getCurrentUsername } from './authStore';

export const INITIAL_PRODUCTIONS: Production[] = [
  {
    id: 'prod-batch-1',
    name: 'Gâchée Béton B25 - Lot #2026-07',
    description: 'Production 50m³ béton prêt à l\'emploi pour chantier El Badr',
    date: '2026-07-21',
    hour: '08:30',
    categoryId: 'cat-2',
    categoryName: 'Béton & Mortier',
    usedProducts: [
      { productId: 'prod-1', productName: 'Ciment Portland CPJ 42.5 (Sac 50kg)', quantityUsed: 350, unitCost: 650, lineCost: 227500 },
      { productId: 'prod-4', productName: 'Sable de Dune Lavé 0/2 (m³)', quantityUsed: 35, unitCost: 1800, lineCost: 63000 },
      { productId: 'prod-5', productName: 'Gravier Concassé 3/8 (Tonne)', quantityUsed: 34, unitCost: 1500, lineCost: 51000 },
    ],
    totalCost: 341500,
    outputQuantity: 50,
    unitPrice: 9800,
    totalValue: 490000,
    sellByUnit: true,
    sellUnit: 'm³',
    createdBy: 'admin',
    sentToComptoir: 30,
  },
];

interface ProductionState {
  productions: Production[];
  categories: Category[];
  addProduction: (data: {
    name: string;
    description: string;
    date: string;
    hour: string;
    categoryId?: string;
    categoryName?: string;
    usedProducts: UsedProduct[];
    outputQuantity: number;
    unitPrice: number;
    sellByUnit?: boolean;
    sellUnit?: string;
    hasLoss?: boolean;
    expectedQuantity?: number;
    lossQuantity?: number;
    lossDescription?: string;
    lossValue?: number;
  }) => Production;
  updateProduction: (id: string, data: Partial<Production>) => void;
  deleteProduction: (id: string) => void;
  transferToComptoir: (id: string, qty: number) => void;
  addCategory: (name: string) => Category;
  deleteCategory: (id: string) => void;
}

export const useProductionStore = create<ProductionState>()(
  persist(
    (set, get) => ({
      productions: INITIAL_PRODUCTIONS,
      categories: [{ id: 'cat-2', name: 'Béton & Mortier' }],

      addProduction: ({ name, description, date, hour, categoryId, categoryName, usedProducts, outputQuantity, unitPrice, sellByUnit, sellUnit, hasLoss, expectedQuantity, lossQuantity, lossDescription, lossValue }) => {
        const totalValue = outputQuantity * unitPrice;
        const totalCost = usedProducts.reduce((s, u) => s + (u.lineCost ?? 0), 0);
        const createdBy = getCurrentUsername();
        const production: Production = {
          id: uid('prod-batch'),
          name,
          description,
          date,
          hour,
          categoryId,
          categoryName,
          usedProducts,
          totalCost,
          outputQuantity,
          unitPrice,
          totalValue,
          sellByUnit,
          sellUnit,
          createdBy,
          sentToComptoir: 0,
          hasLoss,
          expectedQuantity,
          lossQuantity,
          lossDescription,
          lossValue,
        };
        const stock = useStockStore.getState();
        usedProducts
          .filter((u) => u.sourceType !== 'fiche')
          .forEach((u) => stock.consumeStock(u.productId, u.quantityUsed));
        
        set({ productions: [production, ...get().productions] });
        return production;
      },

      updateProduction: (id, data) =>
        set({
          productions: get().productions.map((p) => {
            if (p.id !== id) return p;
            const usedProducts = data.usedProducts ?? p.usedProducts;
            return {
              ...p,
              ...data,
              totalCost: usedProducts.reduce((s, u) => s + (u.lineCost ?? 0), 0),
              totalValue:
                (data.outputQuantity ?? p.outputQuantity) * (data.unitPrice ?? p.unitPrice),
            };
          }),
        }),

      deleteProduction: (id) =>
        set({ productions: get().productions.filter((p) => p.id !== id) }),

      transferToComptoir: (id, qty) => {
        const prod = get().productions.find((p) => p.id === id);
        if (!prod) return;
        const currentSent = prod.sentToComptoir ?? 0;
        const newSent = currentSent + qty;
        if (newSent > prod.outputQuantity) {
          throw new Error('Quantity exceeds production quantity');
        }
        set({
          productions: get().productions.map((p) =>
            p.id === id ? { ...p, sentToComptoir: newSent } : p
          ),
        });
        useComptoirStore.getState().addComptoirItem({
          productionId: prod.id,
          productName: prod.name,
          description: prod.description,
          quantity: qty,
          unitPrice: prod.unitPrice,
          date: new Date().toISOString().slice(0, 10),
          categoryId: prod.categoryId,
          categoryName: prod.categoryName,
          sellByUnit: prod.sellByUnit,
          unit: prod.sellByUnit ? prod.sellUnit : undefined,
          createdBy: getCurrentUsername(),
        });
      },

      addCategory: (name) => {
        const existing = get().categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing;
        const c: Category = { id: uid('pcat'), name };
        set({ categories: [...get().categories, c] });
        return c;
      },

      deleteCategory: (id) => set({ categories: get().categories.filter((c) => c.id !== id) }),
    }),
    {
      name: 'labochimie-productions',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ProductionState>;
        return {
          ...current,
          ...p,
          productions: p.productions && p.productions.length ? p.productions : INITIAL_PRODUCTIONS,
        };
      },
    }
  )
);
