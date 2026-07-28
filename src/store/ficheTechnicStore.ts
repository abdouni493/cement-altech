import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Category, UsedProduct } from '@/types';
import { uid } from '@/lib/utils';

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

export const INITIAL_FICHES: FicheTechnic[] = [
  {
    id: 'ft-1',
    name: 'Formule Béton B25 Standard',
    categoryId: 'cat-2',
    categoryName: 'Béton & Mortier',
    description: 'Dosage 350kg/m³ pour dalles, voiles et poteaux',
    usedProducts: [
      { productId: 'prod-1', productName: 'Ciment Portland CPJ 42.5 (Sac 50kg)', quantityUsed: 7, unitCost: 650, lineCost: 4550 },
      { productId: 'prod-4', productName: 'Sable de Dune Lavé 0/2 (m³)', quantityUsed: 0.7, unitCost: 1800, lineCost: 1260 },
      { productId: 'prod-5', productName: 'Gravier Concassé 3/8 (Tonne)', quantityUsed: 0.68, unitCost: 1500, lineCost: 1020 },
    ],
    sellByUnit: true,
    sellUnit: 'm³',
    usableInProduction: false,
    outputQuantity: 1,
    unitPrice: 9800,
    totalCost: 6830,
    costPerUnit: 6830,
    totalValue: 9800,
    gainsPerUnit: 2970,
    totalGains: 2970,
    createdAt: '2026-07-05',
  },
];

interface FicheTechnicState {
  ficheTechnics: FicheTechnic[];
  categories: Category[];
  addFicheTechnic: (data: Omit<FicheTechnic, 'id' | 'createdAt'>) => FicheTechnic;
  updateFicheTechnic: (id: string, data: Partial<FicheTechnic>) => void;
  deleteFicheTechnic: (id: string) => void;
  addCategory: (name: string) => Category;
  deleteCategory: (id: string) => void;
}

export const useFicheTechnicStore = create<FicheTechnicState>()(
  persist(
    (set, get) => ({
      ficheTechnics: INITIAL_FICHES,
      categories: [{ id: 'cat-2', name: 'Béton & Mortier' }],

      addFicheTechnic: (data) => {
        const ft: FicheTechnic = {
          ...data,
          id: uid('ft'),
          createdAt: new Date().toISOString().slice(0, 10),
        };
        set({ ficheTechnics: [ft, ...get().ficheTechnics] });
        return ft;
      },

      updateFicheTechnic: (id, data) => {
        set({
          ficheTechnics: get().ficheTechnics.map((ft) =>
            ft.id === id ? { ...ft, ...data } : ft
          ),
        });
      },

      deleteFicheTechnic: (id) => {
        set({
          ficheTechnics: get().ficheTechnics.filter((ft) => ft.id !== id),
        });
      },

      addCategory: (name) => {
        const existing = get().categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing;
        const c: Category = { id: uid('ftcat'), name };
        set({ categories: [...get().categories, c] });
        return c;
      },

      deleteCategory: (id) => {
        set({ categories: get().categories.filter((c) => c.id !== id) });
      },
    }),
    {
      name: 'labochimie-fiche-technics',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<FicheTechnicState>;
        return {
          ...current,
          ...p,
          ficheTechnics: p.ficheTechnics && p.ficheTechnics.length ? p.ficheTechnics : INITIAL_FICHES,
        };
      },
    }
  )
);
