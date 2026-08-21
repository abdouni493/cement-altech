import { create } from 'zustand';
import type { ComptoirItem, Destruction } from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';

interface ComptoirState {
  items: ComptoirItem[];
  destructions: Destruction[];
  load: () => Promise<void>;
  destroy: (comptoirId: string, qty: number, reason: string) => Promise<void>;
  recoverDestruction: (destructionId: string) => Promise<void>;
  deleteDestructions: (destructionIds: string[]) => Promise<void>;
  recoverDestructions: (destructionIds: string[]) => Promise<void>;
}

export const useComptoirStore = create<ComptoirState>()((set) => ({
  items: [],
  destructions: [],

  load: async () => {
    const [items, destructions] = await Promise.all([db.comptoir.list(), db.comptoir.destructions()]);
    set({ items, destructions });
  },

  destroy: async (comptoirId, qty, reason) => {
    await save('comptoir.destroy', () => rpc.destroyComptoirItem(comptoirId, qty, reason));
    const [items, destructions] = await Promise.all([db.comptoir.list(), db.comptoir.destructions()]);
    set({ items, destructions });
  },

  recoverDestruction: async (destructionId) => {
    await save('comptoir.recoverDestruction', () => rpc.recoverDestruction(destructionId));
    const [items, destructions] = await Promise.all([db.comptoir.list(), db.comptoir.destructions()]);
    set({ items, destructions });
  },

  deleteDestructions: async (ids) => {
    await save('comptoir.deleteDestructions', () => rpc.deleteDestructions(ids));
    set({ destructions: await db.comptoir.destructions() });
  },

  recoverDestructions: async (ids) => {
    await save('comptoir.recoverDestructions', () => rpc.recoverDestructions(ids));
    const [items, destructions] = await Promise.all([db.comptoir.list(), db.comptoir.destructions()]);
    set({ items, destructions });
  },
}));
