import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ClientDebt, ClientDebtVersement } from '@/types';
import { uid } from '@/lib/utils';
import { useCaisseStore } from './caisseStore';
import { getCurrentUsername } from './authStore';

interface ClientDebtState {
  debts: ClientDebt[];
  addDebt: (data: {
    clientId: string;
    clientName: string;
    clientPhone?: string;
    totalDebt: number;
    date: string;
    description: string;
  }) => ClientDebt;
  updateDebt: (id: string, data: Partial<ClientDebt>) => void;
  deleteDebt: (id: string) => void;
  addVersement: (data: {
    debtId: string;
    amount: number;
    date: string;
    notes?: string;
  }) => ClientDebtVersement | null;
  deleteVersement: (debtId: string, versementId: string) => void;
}

export const useClientDebtStore = create<ClientDebtState>()(
  persist(
    (set, get) => ({
      debts: [],

      addDebt: ({ clientId, clientName, clientPhone, totalDebt, date, description }) => {
        const debt: ClientDebt = {
          id: uid('cdebt'),
          clientId,
          clientName,
          clientPhone,
          totalDebt,
          totalPaid: 0,
          restAmount: totalDebt,
          date,
          createdAt: new Date().toISOString(),
          description,
          versements: [],
          createdBy: getCurrentUsername(),
        };
        set({ debts: [debt, ...get().debts] });
        return debt;
      },

      updateDebt: (id, data) =>
        set({
          debts: get().debts.map((d) => {
            if (d.id !== id) return d;
            const updated = { ...d, ...data };
            if (data.totalDebt !== undefined || data.totalPaid !== undefined) {
              const totalDebt = data.totalDebt ?? d.totalDebt;
              const totalPaid = data.totalPaid ?? d.totalPaid;
              updated.restAmount = Math.max(0, totalDebt - totalPaid);
            }
            return updated;
          }),
        }),

      deleteDebt: (id) => set({ debts: get().debts.filter((d) => d.id !== id) }),

      addVersement: ({ debtId, amount, date, notes }) => {
        const debt = get().debts.find((d) => d.id === debtId);
        if (!debt) return null;

        const now = new Date();
        const dateFormatted = `${date} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        
        const versement: ClientDebtVersement = {
          id: uid('vers'),
          debtId,
          clientId: debt.clientId,
          clientName: debt.clientName,
          amount,
          date,
          createdAt: dateFormatted,
          createdBy: getCurrentUsername(),
          notes,
        };

        const newPaid = debt.totalPaid + amount;
        const newRest = Math.max(0, debt.totalDebt - newPaid);

        set({
          debts: get().debts.map((d) =>
            d.id === debtId
              ? {
                  ...d,
                  totalPaid: newPaid,
                  restAmount: newRest,
                  versements: [versement, ...d.versements],
                }
              : d
          ),
        });

        // Automatically register in Caisse treasury (money entering caisse)
        useCaisseStore.getState().addTransaction({
          type: 'deposit',
          amount,
          date,
          description: `Versement dette client: ${debt.clientName}${notes ? ` (${notes})` : ''}`,
          categoryName: 'Dettes Clients',
        });

        return versement;
      },

      deleteVersement: (debtId, versementId) => {
        const debt = get().debts.find((d) => d.id === debtId);
        if (!debt) return;

        const targetVersement = debt.versements.find((v) => v.id === versementId);
        if (!targetVersement) return;

        const newPaid = Math.max(0, debt.totalPaid - targetVersement.amount);
        const newRest = Math.max(0, debt.totalDebt - newPaid);

        set({
          debts: get().debts.map((d) =>
            d.id === debtId
              ? {
                  ...d,
                  totalPaid: newPaid,
                  restAmount: newRest,
                  versements: d.versements.filter((v) => v.id !== versementId),
                }
              : d
          ),
        });
      },
    }),
    { name: 'cement-client-debts' }
  )
);
