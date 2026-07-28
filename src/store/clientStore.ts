import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Client } from '@/types';
import { uid } from '@/lib/utils';

/** Fixed id for the shared walk-in ("passager") client created on demand. */
export const PASSAGER_CLIENT_ID = 'cli-passager';

export const INITIAL_CLIENTS: Client[] = [
  { id: PASSAGER_CLIENT_ID, name: 'Client Passager', phone: '0550000000' },
  { id: 'cli-1', name: 'Entreprise Benali BTP', phone: '0555123456', address: 'Zone Industrielle Oued Smar, Alger', note: 'Client fidèle grossiste' },
  { id: 'cli-2', name: 'Sarl El Badr Construction', phone: '0661987654', address: 'Route Nationale 5, Oran', note: 'Livraison béton prêt à l\'emploi' },
  { id: 'cli-3', name: 'M. Karim Haddad', phone: '0770334455', address: 'Cité 1000 Logements, Constantine', note: 'Paiement par chèque' },
  { id: 'cli-4', name: 'Groupe Bâtiment Ouest', phone: '0560112233', address: 'Boulevard de la Soummam, Tlemcen', note: 'Chantier promotion immobilière' },
  { id: 'cli-5', name: 'Société Al-Nour Génie Civil', phone: '0662445566', address: 'Zone d\'Activité, Sétif', note: 'Commandes ciment CRS & granulats' },
];

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
      clients: INITIAL_CLIENTS,
      addClient: (data) => {
        const c: Client = { ...data, id: uid('cli') };
        set({ clients: [...get().clients, c] });
        return c;
      },
      updateClient: (id, data) =>
        set({ clients: get().clients.map((c) => (c.id === id ? { ...c, ...data } : c)) }),
      deleteClient: (id) => set({ clients: get().clients.filter((c) => c.id !== id) }),
      getOrCreatePassager: (name = 'Client passager') => {
        const existing = get().clients.find((c) => c.id === PASSAGER_CLIENT_ID);
        if (existing) return existing;
        const c: Client = { id: PASSAGER_CLIENT_ID, name, phone: '' };
        set({ clients: [...get().clients, c] });
        return c;
      },
    }),
    {
      name: 'labochimie-clients',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ClientState>;
        return {
          ...current,
          ...p,
          clients: p.clients && p.clients.length ? p.clients : INITIAL_CLIENTS,
        };
      },
    }
  )
);
