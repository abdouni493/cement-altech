import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ComptoirItem, Destruction } from '@/types';
import { uid } from '@/lib/utils';
import { getCurrentUsername } from './authStore';
import { rpc } from '@/lib/db';
import { push } from '@/lib/persist';

export const INITIAL_COMPTOIR_ITEMS: ComptoirItem[] = [
  {
    id: 'comp-1',
    productionId: 'prod-batch-1',
    productName: 'Béton Prêt à l\'Emploi B25 (m³)',
    description: 'Béton B25 haute résistance prêt à la livraison',
    quantity: 30,
    unitPrice: 9800,
    date: '2026-07-21',
    categoryId: 'cat-2',
    categoryName: 'Béton & Mortier',
    sellByUnit: true,
    unit: 'm³',
    createdBy: 'admin',
  },
];

interface ComptoirState {
  items: ComptoirItem[];
  destructions: Destruction[];
  addComptoirItem: (data: Omit<ComptoirItem, 'id'>) => void;
  reduceByName: (productName: string, qty: number) => void;
  reduceById: (id: string, qty: number) => void;
  destroy: (comptoirId: string, qty: number, reason: string) => void;
  recoverDestruction: (destructionId: string) => void;
  deleteDestructions: (destructionIds: string[]) => void;
  recoverDestructions: (destructionIds: string[]) => void;
}

export const useComptoirStore = create<ComptoirState>()(
  persist(
    (set, get) => ({
      items: INITIAL_COMPTOIR_ITEMS,
      destructions: [],

      addComptoirItem: (data) => {
        const items = get().items;
        const existing = data.productionId ? items.find((it) => it.productionId === data.productionId) : null;
        if (existing) {
          set({
            items: items.map((it) =>
              it.productionId === data.productionId ? { ...it, quantity: it.quantity + data.quantity } : it
            ),
          });
        } else {
          set({ items: [{ ...data, id: uid('comp') }, ...items] });
        }
      },

      reduceByName: (productName, qty) =>
        set({
          items: get().items.map((it) =>
            it.productName === productName
              ? { ...it, quantity: Math.max(0, it.quantity - qty) }
              : it
          ),
        }),

      reduceById: (id, qty) =>
        set({
          items: get().items.map((it) =>
            it.id === id ? { ...it, quantity: Math.max(0, it.quantity - qty) } : it
          ),
        }),

      destroy: (comptoirId, qty, reason) => {
        const item = get().items.find((i) => i.id === comptoirId);
        if (!item) return;
        const destruction: Destruction = {
          id: uid('dest'),
          comptoirId,
          productName: item.productName,
          quantity: qty,
          value: qty * item.unitPrice,
          reason,
          date: new Date().toISOString().slice(0, 10),
          unit: item.sellByUnit ? item.unit : undefined,
          createdBy: getCurrentUsername(),
        };
        set({
          items: get().items.map((it) =>
            it.id === comptoirId ? { ...it, quantity: Math.max(0, it.quantity - qty) } : it
          ),
          destructions: [destruction, ...get().destructions],
        });

        push(
          'comptoir.destroy',
          () => rpc.destroyComptoirItem(comptoirId, qty, reason),
          (row: { id: string }) =>
            set({
              destructions: get().destructions.map((d) =>
                d.id === destruction.id ? { ...d, id: row.id } : d
              ),
            })
        );
      },

      recoverDestruction: (destructionId) => {
        const dest = get().destructions.find((d) => d.id === destructionId);
        if (!dest) return;
        push('comptoir.recoverDestruction', () => rpc.recoverDestruction(destructionId));
        const itemExists = get().items.some((it) => it.id === dest.comptoirId);
        set({
          items: itemExists
            ? get().items.map((it) =>
                it.id === dest.comptoirId ? { ...it, quantity: it.quantity + dest.quantity } : it
              )
            : [
                {
                  id: dest.comptoirId,
                  productionId: '',
                  productName: dest.productName,
                  quantity: dest.quantity,
                  unitPrice: dest.quantity > 0 ? dest.value / dest.quantity : 0,
                  date: dest.date,
                },
                ...get().items,
              ],
          destructions: get().destructions.filter((d) => d.id !== destructionId),
        });
      },

      deleteDestructions: (destructionIds) => {
        push('comptoir.deleteDestructions', () => rpc.deleteDestructions(destructionIds));
        set({
          destructions: get().destructions.filter((d) => !destructionIds.includes(d.id)),
        });
      },

      recoverDestructions: (destructionIds) => {
        push('comptoir.recoverDestructions', () => rpc.recoverDestructions(destructionIds));
        let currentItems = [...get().items];
        destructionIds.forEach((id) => {
          const dest = get().destructions.find((d) => d.id === id);
          if (!dest) return;
          const itemIdx = currentItems.findIndex((it) => it.id === dest.comptoirId);
          if (itemIdx > -1) {
            currentItems[itemIdx] = {
              ...currentItems[itemIdx],
              quantity: currentItems[itemIdx].quantity + dest.quantity,
            };
          } else {
            currentItems.unshift({
              id: dest.comptoirId,
              productionId: '',
              productName: dest.productName,
              quantity: dest.quantity,
              unitPrice: dest.quantity > 0 ? dest.value / dest.quantity : 0,
              date: dest.date,
            });
          }
        });
        set({
          items: currentItems,
          destructions: get().destructions.filter((d) => !destructionIds.includes(d.id)),
        });
      },
    }),
    {
      name: 'labochimie-comptoir',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ComptoirState>;
        return {
          ...current,
          ...p,
          items: p.items && p.items.length ? p.items : INITIAL_COMPTOIR_ITEMS,
        };
      },
    }
  )
);
