import { create } from 'zustand';
import type { Production, UsedProduct, Category } from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';
import { useStockStore } from './stockStore';
import { useComptoirStore } from './comptoirStore';

export interface AddProductionInput {
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
}

interface ProductionState {
  productions: Production[];
  categories: Category[];
  load: () => Promise<void>;
  addProduction: (data: AddProductionInput) => Promise<Production>;
  updateProduction: (id: string, data: Partial<Production>) => Promise<void>;
  deleteProduction: (id: string) => Promise<void>;
  transferToComptoir: (id: string, qty: number) => Promise<void>;
  addCategory: (name: string) => Promise<Category>;
  deleteCategory: (id: string) => Promise<void>;
}

export const useProductionStore = create<ProductionState>()((set, get) => ({
  productions: [],
  categories: [],

  load: async () => {
    const [productions, categories] = await Promise.all([
      db.productions.list(), db.productionCategories.list(),
    ]);
    set({ productions, categories });
  },

  addProduction: async (data) => {
    const {
      name, description, date, hour, categoryId, categoryName, usedProducts,
      outputQuantity, unitPrice, sellByUnit, sellUnit,
      hasLoss, expectedQuantity, lossQuantity, lossDescription, lossValue,
    } = data;

    // create_production() writes the batch, its ingredients and consumes the stock
    const row = await save('productions.create', () =>
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
      })
    );

    // ingredients left the stock → both screens reload from the database
    const [productions] = await Promise.all([db.productions.list(), useStockStore.getState().load()]);
    set({ productions });
    return productions.find((p) => p.id === row.id) as Production;
  },

  updateProduction: async (id, data) => {
    await save('productions.update', () =>
      db.productions.update(id, {
        name: data.name,
        description: data.description,
        date: data.date,
        hour: data.hour,
        output_quantity: data.outputQuantity,
        unit_price: data.unitPrice,
        total_value:
          (data.outputQuantity ?? 0) * (data.unitPrice ?? 0) || undefined,
        sell_by_unit: data.sellByUnit,
        sell_unit: data.sellUnit ?? null,
      })
    );
    set({ productions: await db.productions.list() });
  },

  deleteProduction: async (id) => {
    await save('productions.delete', () => db.productions.remove(id));
    set({ productions: get().productions.filter((p) => p.id !== id) });
  },

  transferToComptoir: async (id, qty) => {
    const prod = get().productions.find((p) => p.id === id);
    if (!prod) return;
    if ((prod.sentToComptoir ?? 0) + qty > prod.outputQuantity) {
      throw new Error('La quantité dépasse le reste en stock de production');
    }
    await save('productions.transferToComptoir', () => rpc.transferToComptoir(id, qty));
    const [productions] = await Promise.all([
      db.productions.list(), useComptoirStore.getState().load(),
    ]);
    set({ productions });
  },

  addCategory: async (name) => {
    const existing = get().categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const row = await save('productionCategories.create', () => db.productionCategories.create(name));
    set({ categories: [...get().categories, row] });
    return row;
  },

  deleteCategory: async (id) => {
    await save('productionCategories.delete', () => db.productionCategories.remove(id));
    set({ categories: get().categories.filter((c) => c.id !== id) });
  },
}));
