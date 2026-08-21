import { create } from 'zustand';
import type { Client, PartyPayment } from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';

interface ClientState {
  clients: Client[];
  /** Every debt settlement recorded from a client card. */
  payments: PartyPayment[];
  load: () => Promise<void>;
  addClient: (data: Omit<Client, 'id'>) => Promise<Client>;
  updateClient: (id: string, data: Partial<Client>) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  /** Returns the single shared walk-in client, creating it in the database once. */
  getOrCreatePassager: (name?: string) => Promise<Client>;
  payDebt: (clientId: string, amount: number, paidAt: string, notes?: string) => Promise<PartyPayment>;
  updatePayment: (id: string, amount: number, paidAt: string, notes?: string) => Promise<void>;
  deletePayment: (id: string) => Promise<void>;
}

export const useClientStore = create<ClientState>()((set, get) => ({
  clients: [],
  payments: [],

  load: async () => {
    const [clients, payments] = await Promise.all([db.clients.list(), db.clientPayments.list()]);
    set({ clients, payments });
  },

  addClient: async (data) => {
    const row = await save('clients.create', () => db.clients.create(data));
    set({ clients: [...get().clients, row] });
    return row;
  },

  updateClient: async (id, data) => {
    const row = await save('clients.update', () => db.clients.update(id, data));
    set({ clients: get().clients.map((c) => (c.id === id ? row : c)) });
  },

  deleteClient: async (id) => {
    await save('clients.delete', () => db.clients.remove(id));
    set({
      clients: get().clients.filter((c) => c.id !== id),
      payments: get().payments.filter((p) => p.partyId !== id),
    });
  },

  getOrCreatePassager: async () => {
    const existing = get().clients.find((c) => c.name.toLowerCase().startsWith('client passager'));
    if (existing) return existing;
    const row = await save('clients.passager', () => db.clients.passager());
    set({ clients: [...get().clients.filter((c) => c.id !== row.id), row] });
    return row;
  },

  payDebt: async (clientId, amount, paidAt, notes = '') => {
    const row = await save<{ id: string }>('clients.pay', () => rpc.payClient(clientId, amount, paidAt, notes));
    const payments = await db.clientPayments.list();
    set({ payments });
    // the row the database actually created (never the newest by date)
    return payments.find((p) => p.id === row?.id) as PartyPayment ?? payments.find((p) => p.partyId === clientId) as PartyPayment;
  },

  updatePayment: async (id, amount, paidAt, notes) => {
    await save('clients.payment.update', () => rpc.updateClientPayment(id, amount, paidAt, notes));
    set({ payments: await db.clientPayments.list() });
  },

  deletePayment: async (id) => {
    await save('clients.payment.delete', () => rpc.deleteClientPayment(id));
    set({ payments: get().payments.filter((p) => p.id !== id) });
  },
}));
