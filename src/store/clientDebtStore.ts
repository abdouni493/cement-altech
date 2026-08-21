import { create } from 'zustand';
import type { ClientDebt } from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';
import { useCaisseStore } from './caisseStore';

interface ClientDebtState {
  debts: ClientDebt[];
  load: () => Promise<void>;
  addDebt: (data: {
    clientId: string;
    clientName: string;
    clientPhone?: string;
    totalDebt: number;
    date: string;
    description: string;
  }) => Promise<ClientDebt>;
  deleteDebt: (id: string) => Promise<void>;
  addVersement: (data: {
    debtId: string;
    amount: number;
    date: string;
    notes?: string;
  }) => Promise<void>;
  deleteVersement: (debtId: string, versementId: string) => Promise<void>;
}

export const useClientDebtStore = create<ClientDebtState>()((set, get) => ({
  debts: [],

  load: async () => set({ debts: await db.clientDebts.list() }),

  addDebt: async ({ clientId, totalDebt, date, description }) => {
    const row = await save('clientDebts.create', () =>
      rpc.addClientDebt(clientId, totalDebt, date, description)
    );
    const debts = await db.clientDebts.list();
    set({ debts });
    return debts.find((d) => d.id === row.id) as ClientDebt;
  },

  deleteDebt: async (id) => {
    await save('clientDebts.delete', () => db.clientDebts.remove(id));
    set({ debts: get().debts.filter((d) => d.id !== id) });
  },

  addVersement: async ({ debtId, amount, date, notes }) => {
    // add_client_debt_versement() books the caisse deposit itself
    await save('clientDebts.versement', () => rpc.addClientDebtVersement(debtId, amount, date, notes));
    const [debts] = await Promise.all([db.clientDebts.list(), useCaisseStore.getState().load()]);
    set({ debts });
  },

  deleteVersement: async (_debtId, versementId) => {
    await save('clientDebts.deleteVersement', () => rpc.deleteClientDebtVersement(versementId));
    const [debts] = await Promise.all([db.clientDebts.list(), useCaisseStore.getState().load()]);
    set({ debts });
  },
}));
