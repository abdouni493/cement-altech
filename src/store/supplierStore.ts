import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Supplier } from '@/types';
import { uid } from '@/lib/utils';
import { db } from '@/lib/db';
import { push, swapId } from '@/lib/persist';

interface SupplierState {
  suppliers: Supplier[];
  addSupplier: (data: Omit<Supplier, 'id'>) => Supplier;
  updateSupplier: (id: string, data: Partial<Supplier>) => void;
  deleteSupplier: (id: string) => void;
}

export const useSupplierStore = create<SupplierState>()(
  persist(
    (set, get) => ({
      suppliers: [],
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
    { name: 'altech-suppliers' }
  )
);
