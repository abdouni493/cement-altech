import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Client } from '@/types';
import { uid } from '@/lib/utils';
import { db } from '@/lib/db';
import { push, swapId } from '@/lib/persist';

/** Fixed id for the shared walk-in ("passager") client created on demand. */
export const PASSAGER_CLIENT_ID = 'cli-passager';

interface ClientState {
  clients: Client[];
  addClient: (data: Omit<Client, 'id'>) => Client;
  updateClient: (id: string, data: Partial<Client>) => void;
  deleteClient: (id: string) => void;
  /** Returns the single shared walk-in client, creating it once if needed. */
  getOrCreatePassager: (name?: string) => Client;
}

export const useClientStore = create<ClientState>()(
  persist(
    (set, get) => ({
      clients: [],
      addClient: (data) => {
        const c: Client = { ...data, id: uid('cli') };
        set({ clients: [...get().clients, c] });
        push('clients.create', () => db.clients.create(data), (row) =>
          set({ clients: swapId(get().clients, c.id, row.id) })
        );
        return c;
      },
      updateClient: (id, data) => {
        set({ clients: get().clients.map((c) => (c.id === id ? { ...c, ...data } : c)) });
        push('clients.update', () => db.clients.update(id, data));
      },
      deleteClient: (id) => {
        set({ clients: get().clients.filter((c) => c.id !== id) });
        push('clients.delete', () => db.clients.remove(id));
      },
      getOrCreatePassager: (name = 'Client passager') => {
        // After a Supabase sync the walk-in client carries its database uuid,
        // so it is also matched by name — otherwise a duplicate would be created
        // and the POS would send an unknown id to the database.
        const existing = get().clients.find(
          (c) => c.id === PASSAGER_CLIENT_ID || c.name.toLowerCase().startsWith('client passager')
        );
        if (existing) return existing;
        const c: Client = { id: PASSAGER_CLIENT_ID, name, phone: '' };
        set({ clients: [...get().clients, c] });
        push('clients.passager', () => db.clients.passager(), (row) =>
          set({ clients: swapId(get().clients, c.id, row.id) })
        );
        return c;
      },
    }),
    { name: 'altech-clients' }
  )
);
