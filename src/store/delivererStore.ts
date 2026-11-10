import { create } from 'zustand';
import type { Deliverer, DelivererPayment, PaymentMethodDetails } from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';
import { usePurchaseStore } from './purchaseStore';
import { useCaisseStore } from './caisseStore';

interface DelivererState {
  deliverers: Deliverer[];
  /** Règlements directs enregistrés depuis une carte livreur. */
  payments: DelivererPayment[];
  load: () => Promise<void>;
  addDeliverer: (data: Omit<Deliverer, 'id'>) => Promise<Deliverer>;
  updateDeliverer: (id: string, data: Partial<Deliverer>) => Promise<void>;
  deleteDeliverer: (id: string) => Promise<void>;
  /** « Payer la dette » — enregistre le règlement (sortie de caisse). */
  payDebt: (
    delivererId: string, amount: number, paidAt: string, notes?: string,
    method?: PaymentMethodDetails,
  ) => Promise<DelivererPayment | undefined>;
  updatePayment: (
    id: string, amount: number, paidAt: string, notes?: string,
    method?: PaymentMethodDetails,
  ) => Promise<void>;
  deletePayment: (id: string) => Promise<void>;
}

/** Recharge la caisse après un règlement livreur (il en sort). */
async function refreshMoney(): Promise<void> {
  await useCaisseStore.getState().load().catch(() => undefined);
}

export const useDelivererStore = create<DelivererState>()((set, get) => ({
  deliverers: [],
  payments: [],

  load: async () => {
    const [deliverers, payments] = await Promise.all([
      db.deliverers.list(), db.delivererPayments.list(),
    ]);
    set({ deliverers, payments });
  },

  addDeliverer: async (data) => {
    const row = await save('deliverers.create', () => db.deliverers.create(data));
    set({ deliverers: [...get().deliverers, row] });
    return row;
  },

  updateDeliverer: async (id, data) => {
    const row = await save('deliverers.update', () => db.deliverers.update(id, data));
    set({ deliverers: get().deliverers.map((d) => (d.id === id ? row : d)) });
  },

  deleteDeliverer: async (id) => {
    await save('deliverers.delete', () => db.deliverers.remove(id));
    set({
      deliverers: get().deliverers.filter((d) => d.id !== id),
      payments: get().payments.filter((p) => p.delivererId !== id),
    });
    // les achats affectés à ce livreur voient leur deliverer_id remis à NULL.
    await Promise.all([usePurchaseStore.getState().load(), refreshMoney()]).catch(() => undefined);
  },

  payDebt: async (delivererId, amount, paidAt, notes = '', method) => {
    const row = await save<{ id: string }>('deliverers.pay', () =>
      rpc.payDeliverer(delivererId, amount, paidAt, notes, method ?? { method: 'especes' })
    );
    const payments = await db.delivererPayments.list();
    set({ payments });
    await refreshMoney();
    return payments.find((p) => p.id === row?.id)
      ?? payments.find((p) => p.delivererId === delivererId);
  },

  updatePayment: async (id, amount, paidAt, notes, method) => {
    await save('deliverers.payment.update', () => rpc.updateDelivererPayment(id, amount, paidAt, notes, method));
    set({ payments: await db.delivererPayments.list() });
    await refreshMoney();
  },

  deletePayment: async (id) => {
    await save('deliverers.payment.delete', () => rpc.deleteDelivererPayment(id));
    set({ payments: get().payments.filter((p) => p.id !== id) });
    await refreshMoney();
  },
}));
