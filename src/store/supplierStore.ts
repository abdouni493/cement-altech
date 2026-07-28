import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Supplier } from '@/types';
import { uid } from '@/lib/utils';
import { db } from '@/lib/db';
import { push, swapId } from '@/lib/persist';

export const INITIAL_SUPPLIERS: Supplier[] = [
  { id: 'sup-1', name: 'GICA Ciments Algérie', phone: '021234567', address: 'Chlef - Fournisseur principal ciment vrac & sacs' },
  { id: 'sup-2', name: 'Lafarge Holcim Algérie', phone: '021987654', address: 'M\'Sila - Ciment Portland CPJ 42.5 & Adjuvants' },
  { id: 'sup-3', name: 'Sacomet Fer & Acier BTP', phone: '031554433', address: 'Annaba - Fer à béton FeE500 de 8mm à 20mm' },
  { id: 'sup-4', name: 'Société Générale des Granulats', phone: '029887766', address: 'Blida - Sable de dune lavé et graviers concassés' },
];

interface SupplierState {
  suppliers: Supplier[];
  addSupplier: (data: Omit<Supplier, 'id'>) => Supplier;
  updateSupplier: (id: string, data: Partial<Supplier>) => void;
  deleteSupplier: (id: string) => void;
}

export const useSupplierStore = create<SupplierState>()(
  persist(
    (set, get) => ({
      suppliers: INITIAL_SUPPLIERS,
      addSupplier: (data) => {
        const s: Supplier = { ...data, id: uid('sup') };
        set({ suppliers: [...get().suppliers, s] });
        push('suppliers.create', () => db.suppliers.create(data), (row) =>
          set({ suppliers: swapId(get().suppliers, s.id, row.id) })
        );
        return s;
      },
      updateSupplier: (id, data) => {
        set({ suppliers: get().suppliers.map((s) => (s.id === id ? { ...s, ...data } : s)) });
        push('suppliers.update', () => db.suppliers.update(id, data));
      },
      deleteSupplier: (id) => {
        set({ suppliers: get().suppliers.filter((s) => s.id !== id) });
        push('suppliers.delete', () => db.suppliers.remove(id));
      },
    }),
    {
      name: 'labochimie-suppliers',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SupplierState>;
        return {
          ...current,
          ...p,
          suppliers: p.suppliers && p.suppliers.length ? p.suppliers : INITIAL_SUPPLIERS,
        };
      },
    }
  )
);
