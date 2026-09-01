import { create } from 'zustand';
import type { Supplier, PartyPayment, PaymentMethodDetails } from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';
import { usePurchaseStore } from './purchaseStore';
import { useCaisseStore } from './caisseStore';

interface SupplierState {
  suppliers: Supplier[];
  /** Every debt settlement recorded from a supplier card. */
  payments: PartyPayment[];
  load: () => Promise<void>;
  addSupplier: (data: Omit<Supplier, 'id'>) => Promise<Supplier>;
  updateSupplier: (id: string, data: Partial<Supplier>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  /** « Versement » — enregistre le règlement et l'impute sur les factures. */
  payDebt: (
    supplierId: string, amount: number, paidAt: string, notes?: string,
    method?: PaymentMethodDetails,
  ) => Promise<PartyPayment>;
  updatePayment: (
    id: string, amount: number, paidAt: string, notes?: string,
    method?: PaymentMethodDetails,
  ) => Promise<void>;
  deletePayment: (id: string) => Promise<void>;
}

/**
 * Recharge les factures d'achat et la caisse après un versement fournisseur.
 *
 * `pay_supplier()` impute le montant sur les factures non soldées : sans ce
 * rechargement la carte du fournisseur continuerait d'afficher l'ancienne
 * dette jusqu'au prochain rafraîchissement de la page.
 */
async function refreshSupplierDebt(): Promise<void> {
  await Promise.all([
    usePurchaseStore.getState().load(),
    useCaisseStore.getState().load(),
  ]).catch(() => undefined);
}

export const useSupplierStore = create<SupplierState>()((set, get) => ({
  suppliers: [],
  payments: [],

  load: async () => {
    const [suppliers, payments] = await Promise.all([
      db.suppliers.list(), db.supplierPayments.list(),
    ]);
    set({ suppliers, payments });
  },

  addSupplier: async (data) => {
    const row = await save('suppliers.create', () => db.suppliers.create(data));
    set({ suppliers: [...get().suppliers, row] });
    return row;
  },

  updateSupplier: async (id, data) => {
    const row = await save('suppliers.update', () => db.suppliers.update(id, data));
    set({ suppliers: get().suppliers.map((s) => (s.id === id ? row : s)) });
  },

  deleteSupplier: async (id) => {
    await save('suppliers.delete', () => db.suppliers.remove(id));
    set({
      suppliers: get().suppliers.filter((s) => s.id !== id),
      payments: get().payments.filter((p) => p.partyId !== id),
    });
    await refreshSupplierDebt();
  },

  payDebt: async (supplierId, amount, paidAt, notes = '', method) => {
    const row = await save<{ id: string }>('suppliers.pay', () =>
      rpc.paySupplier(supplierId, amount, paidAt, notes, method ?? { method: 'especes' })
    );
    const payments = await db.supplierPayments.list();
    set({ payments });
    // les factures d'achat viennent d'être soldées côté base : on les relit
    await refreshSupplierDebt();
    // the row the database actually created (never the newest by date)
    return payments.find((p) => p.id === row?.id) as PartyPayment ?? payments.find((p) => p.partyId === supplierId) as PartyPayment;
  },

  updatePayment: async (id, amount, paidAt, notes, method) => {
    await save('suppliers.payment.update', () => rpc.updateSupplierPayment(id, amount, paidAt, notes, method));
    set({ payments: await db.supplierPayments.list() });
    await refreshSupplierDebt();
  },

  deletePayment: async (id) => {
    await save('suppliers.payment.delete', () => rpc.deleteSupplierPayment(id));
    set({ payments: get().payments.filter((p) => p.id !== id) });
    await refreshSupplierDebt();
  },
}));
