import { create } from 'zustand';
import type { Category, UsedProduct } from '@/types';
import { db } from '@/lib/db';
import { save } from '@/lib/persist';

export interface FicheTechnic {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  description?: string;
  usedProducts: UsedProduct[];
  sellByUnit: boolean;
  sellUnit?: string;
  usableInProduction?: boolean;
  productUnit?: string;
  outputQuantity: number;
  unitPrice: number;
  totalCost: number;
  costPerUnit: number;
  totalValue: number;
  gainsPerUnit: number;
  totalGains: number;
  createdAt: string;
}

const toPayload = (d: Partial<FicheTechnic>) => ({
  name: d.name,
  category_id: d.categoryId || null,
  category_name: d.categoryName || null,
  description: d.description ?? '',
  sell_by_unit: d.sellByUnit ?? false,
  sell_unit: d.sellUnit ?? null,
  usable_in_production: d.usableInProduction ?? false,
  product_unit: d.productUnit ?? null,
  output_quantity: d.outputQuantity ?? 1,
  unit_price: d.unitPrice ?? 0,
  total_cost: d.totalCost ?? 0,
  cost_per_unit: d.costPerUnit ?? 0,
  total_value: d.totalValue ?? 0,
  gains_per_unit: d.gainsPerUnit ?? 0,
  total_gains: d.totalGains ?? 0,
  used_products: (d.usedProducts ?? []).map((u) => ({
    product_id: u.productId || null,
    product_name: u.productName,
    quantity_used: u.quantityUsed,
    source_type: u.sourceType ?? 'stock',
    unit: u.unit ?? null,
    unit_cost: u.unitCost ?? 0,
    line_cost: u.lineCost ?? 0,
  })),
});

interface FicheTechnicState {
  ficheTechnics: FicheTechnic[];
  categories: Category[];
  load: () => Promise<void>;
  addFicheTechnic: (data: Omit<FicheTechnic, 'id' | 'createdAt'>) => Promise<FicheTechnic>;
  updateFicheTechnic: (id: string, data: Partial<FicheTechnic>) => Promise<void>;
  deleteFicheTechnic: (id: string) => Promise<void>;
  addCategory: (name: string) => Promise<Category>;
  deleteCategory: (id: string) => Promise<void>;
}

export const useFicheTechnicStore = create<FicheTechnicState>()((set, get) => ({
  ficheTechnics: [],
  categories: [],

  load: async () => {
    const [ficheTechnics, categories] = await Promise.all([
      db.ficheTechnics.list(), db.ficheCategories.list(),
    ]);
    set({ ficheTechnics, categories });
  },

  addFicheTechnic: async (data) => {
    await save('ficheTechnics.create', () => db.ficheTechnics.create(toPayload(data)));
    const ficheTechnics = await db.ficheTechnics.list();
    set({ ficheTechnics });
    return ficheTechnics[0];
  },

  updateFicheTechnic: async (id, data) => {
    await save('ficheTechnics.update', () => db.ficheTechnics.update(id, toPayload(data)));
    set({ ficheTechnics: await db.ficheTechnics.list() });
  },

  deleteFicheTechnic: async (id) => {
    await save('ficheTechnics.delete', () => db.ficheTechnics.remove(id));
    set({ ficheTechnics: get().ficheTechnics.filter((ft) => ft.id !== id) });
  },

  addCategory: async (name) => {
    const existing = get().categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const row = await save('ficheCategories.create', () => db.ficheCategories.create(name));
    set({ categories: [...get().categories, row] });
    return row;
  },

  deleteCategory: async (id) => {
    await save('ficheCategories.delete', () => db.ficheCategories.remove(id));
    set({ categories: get().categories.filter((c) => c.id !== id) });
  },
}));
