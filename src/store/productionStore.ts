import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Production, UsedProduct, Category } from '@/types';
import { uid } from '@/lib/utils';
import { useStockStore } from './stockStore';
import { useComptoirStore } from './comptoirStore';
import { getCurrentUsername } from './authStore';
import { db, rpc } from '@/lib/db';
import { push, swapId } from '@/lib/persist';

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
      productions: [],
      categories: [],

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

        // create_production() writes the batch, its ingredients and consumes the stock
        push(
          'productions.create',
          () =>
            rpc.createProduction({
              name, description, date, hour,
              category_id: categoryId ?? null,
              category_name: categoryName ?? null,
              output_quantity: outputQuantity,
              unit_price: unitPrice,
              sell_by_unit: sellByUnit ?? false,
              sell_unit: sellUnit ?? null,
              has_loss: hasLoss ?? false,
              expected_quantity: expectedQuantity ?? null,
              loss_quantity: lossQuantity ?? 0,
              loss_description: lossDescription ?? null,
              loss_value: lossValue ?? 0,
              used_products: usedProducts.map((u) => ({
                product_id: u.productId,
                product_name: u.productName,
                quantity_used: u.quantityUsed,
                source_type: u.sourceType ?? 'stock',
                unit: u.unit ?? null,
                unit_cost: u.unitCost ?? 0,
                line_cost: u.lineCost ?? 0,
              })),
            }),
          (row: { id: string }) =>
            set({
              productions: get().productions.map((p) =>
                p.id === production.id ? { ...p, id: row.id } : p
              ),
            })
        );
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

      deleteProduction: (id) => {
        set({ productions: get().productions.filter((p) => p.id !== id) });
        push('productions.delete', () => db.productions.remove(id));
      },

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
        push('productions.transferToComptoir', () => rpc.transferToComptoir(prod.id, qty));

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
        push('productionCategories.create', () => db.productionCategories.create(name), (row) =>
          set({ categories: swapId(get().categories, c.id, row.id) })
        );
        return c;
      },

      deleteCategory: (id) => {
        set({ categories: get().categories.filter((c) => c.id !== id) });
        push('productionCategories.delete', () => db.productionCategories.remove(id));
      },
    }),
    { name: 'altech-productions' }
  )
);
