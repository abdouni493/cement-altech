import { create } from 'zustand';
import type {
  Supplier, PartyPayment, PaymentMethodDetails, PartyOldDebt, PartyCreditRefund,
} from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';
import { usePurchaseStore } from './purchaseStore';
import { useCaisseStore } from './caisseStore';

interface SupplierState {
  suppliers: Supplier[];
  /** Every debt settlement recorded from a supplier card. */
  payments: PartyPayment[];
  /** Ardoises d'avant le logiciel saisies depuis une carte fournisseur. */
  oldDebts: PartyOldDebt[];
  /** Trop-verses recuperes aupres des fournisseurs (entree de caisse). */
  refunds: PartyCreditRefund[];
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
  /** Ancienne dette : ce qu'on devait deja au fournisseur, sans ecriture de caisse. */
  addOldDebt: (
    supplierId: string, amount: number, date: string, description: string,
  ) => Promise<PartyOldDebt>;
  updateOldDebt: (id: string, amount: number, date: string, description: string) => Promise<void>;
  deleteOldDebt: (id: string) => Promise<void>;
  /** Recuperer l'excedent paye en trop au fournisseur. */
  refundCredit: (
    supplierId: string, amount: number, refundedAt: string, notes?: string,
    method?: PaymentMethodDetails,
  ) => Promise<PartyCreditRefund | undefined>;
  deleteRefund: (id: string) => Promise<void>;
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

/**
 * Recharge les fiches fournisseurs ET leur grand livre (anciennes dettes,
 * remboursements) : `suppliers.credit_amount` change des qu'un versement
 * depasse la dette ou qu'un trop-verse est recupere.
 */
async function reloadLedger(): Promise<Pick<SupplierState, 'suppliers' | 'oldDebts' | 'refunds'>> {
  const [suppliers, oldDebts, refunds] = await Promise.all([
    db.suppliers.list(), db.partyOldDebts.list('supplier'), db.partyRefunds.list('supplier'),
  ]);
  return { suppliers, oldDebts, refunds };
}

export const useSupplierStore = create<SupplierState>()((set, get) => ({
  suppliers: [],
  payments: [],
  oldDebts: [],
  refunds: [],

  load: async () => {
    const [suppliers, payments, oldDebts, refunds] = await Promise.all([
      db.suppliers.list(), db.supplierPayments.list(),
      db.partyOldDebts.list('supplier'), db.partyRefunds.list('supplier'),
    ]);
    set({ suppliers, payments, oldDebts, refunds });
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
      oldDebts: get().oldDebts.filter((d) => d.partyId !== id),
      refunds: get().refunds.filter((r) => r.partyId !== id),
    });
    await refreshSupplierDebt();
  },

  payDebt: async (supplierId, amount, paidAt, notes = '', method) => {
    const row = await save<{ id: string }>('suppliers.pay', () =>
      rpc.paySupplier(supplierId, amount, paidAt, notes, method ?? { method: 'especes' })
    );
    const payments = await db.supplierPayments.list();
    // le versement solde d'abord les anciennes dettes ; s'il depasse la dette,
    // le reliquat reste en trop-verse sur la fiche du fournisseur
    set({ payments, ...(await reloadLedger()) });
    // les factures d'achat viennent d'être soldées côté base : on les relit
    await refreshSupplierDebt();
    // the row the database actually created (never the newest by date)
    return payments.find((p) => p.id === row?.id) as PartyPayment ?? payments.find((p) => p.partyId === supplierId) as PartyPayment;
  },

  updatePayment: async (id, amount, paidAt, notes, method) => {
    await save('suppliers.payment.update', () => rpc.updateSupplierPayment(id, amount, paidAt, notes, method));
    set({ payments: await db.supplierPayments.list(), ...(await reloadLedger()) });
    await refreshSupplierDebt();
  },

  deletePayment: async (id) => {
    await save('suppliers.payment.delete', () => rpc.deleteSupplierPayment(id));
    set({ payments: get().payments.filter((p) => p.id !== id), ...(await reloadLedger()) });
    await refreshSupplierDebt();
  },

  addOldDebt: async (supplierId, amount, date, description) => {
    const row = await save<{ id: string }>('suppliers.oldDebt.create', () =>
      rpc.addPartyOldDebt('supplier', supplierId, amount, date, description)
    );
    const ledger = await reloadLedger();
    set(ledger);
    await refreshSupplierDebt();
    return ledger.oldDebts.find((d) => d.id === row?.id) as PartyOldDebt;
  },

  updateOldDebt: async (id, amount, date, description) => {
    await save('suppliers.oldDebt.update', () => rpc.updatePartyOldDebt(id, amount, date, description));
    set(await reloadLedger());
    await refreshSupplierDebt();
  },

  deleteOldDebt: async (id) => {
    await save('suppliers.oldDebt.delete', () => rpc.deletePartyOldDebt(id));
    set(await reloadLedger());
    await refreshSupplierDebt();
  },

  refundCredit: async (supplierId, amount, refundedAt, notes = '', method) => {
    const row = await save<{ id: string }>('suppliers.refund', () =>
      rpc.refundPartyCredit('supplier', supplierId, amount, refundedAt, notes, method ?? { method: 'especes' })
    );
    const ledger = await reloadLedger();
    set(ledger);
    // le trop-verse rendu par le fournisseur ENTRE en caisse
    await refreshSupplierDebt();
    return ledger.refunds.find((r) => r.id === row?.id);
  },

  deleteRefund: async (id) => {
    await save('suppliers.refund.delete', () => rpc.deletePartyRefund(id));
    set(await reloadLedger());
    await refreshSupplierDebt();
  },
}));
