import { create } from 'zustand';
import type {
  Client, PartyPayment, PaymentMethodDetails, PartyOldDebt, PartyCreditRefund,
} from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';
import { useSalesStore } from './salesStore';
import { useCommandStore } from './commandStore';
import { useCaisseStore } from './caisseStore';

interface ClientState {
  clients: Client[];
  /** Every debt settlement recorded from a client card. */
  payments: PartyPayment[];
  /** Ardoises d'avant le logiciel saisies depuis une carte client. */
  oldDebts: PartyOldDebt[];
  /** Excedents rendus aux clients (sortie de caisse). */
  refunds: PartyCreditRefund[];
  load: () => Promise<void>;
  addClient: (data: Omit<Client, 'id'>) => Promise<Client>;
  updateClient: (id: string, data: Partial<Client>) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  /** Returns the single shared walk-in client, creating it in the database once. */
  getOrCreatePassager: (name?: string) => Promise<Client>;
  payDebt: (
    clientId: string, amount: number, paidAt: string, notes?: string,
    method?: PaymentMethodDetails,
  ) => Promise<PartyPayment>;
  updatePayment: (
    id: string, amount: number, paidAt: string, notes?: string,
    method?: PaymentMethodDetails,
  ) => Promise<void>;
  deletePayment: (id: string) => Promise<void>;
  /** Ancienne dette : ardoise reprise du passe, sans ecriture de caisse. */
  addOldDebt: (
    clientId: string, amount: number, date: string, description: string,
  ) => Promise<PartyOldDebt>;
  updateOldDebt: (id: string, amount: number, date: string, description: string) => Promise<void>;
  deleteOldDebt: (id: string) => Promise<void>;
  /** Rendre l'excedent : l'entreprise restitue l'avance du client. */
  refundCredit: (
    clientId: string, amount: number, refundedAt: string, notes?: string,
    method?: PaymentMethodDetails,
  ) => Promise<PartyCreditRefund | undefined>;
  deleteRefund: (id: string) => Promise<void>;
}

/**
 * Recharge tout ce qu'un versement client vient de modifier côté base.
 *
 * `pay_client()` impute le montant sur les ventes puis les commandes non
 * soldées et enregistre l'entrée de caisse : sans ce rechargement l'écran
 * continuerait d'afficher l'ANCIENNE dette (c'est le bug « le versement est
 * enregistré mais la dette ne baisse pas »).
 */
async function refreshClientDebt(): Promise<void> {
  await Promise.all([
    useSalesStore.getState().load(),
    useCommandStore.getState().load(),
    useCaisseStore.getState().load(),
  ]).catch(() => undefined);
}

/**
 * Recharge les fiches clients ET leur grand livre (anciennes dettes,
 * remboursements).
 *
 * Un versement, une ancienne dette ou un remboursement d'excedent modifient
 * `clients.credit_amount` cote base : sans relire les fiches, la carte
 * continuerait d'afficher l'ANCIENNE avance.
 */
async function reloadLedger(): Promise<Pick<ClientState, 'clients' | 'oldDebts' | 'refunds'>> {
  const [clients, oldDebts, refunds] = await Promise.all([
    db.clients.list(), db.partyOldDebts.list('client'), db.partyRefunds.list('client'),
  ]);
  return { clients, oldDebts, refunds };
}

export const useClientStore = create<ClientState>()((set, get) => ({
  clients: [],
  payments: [],
  oldDebts: [],
  refunds: [],

  load: async () => {
    const [clients, payments, oldDebts, refunds] = await Promise.all([
      db.clients.list(), db.clientPayments.list(),
      db.partyOldDebts.list('client'), db.partyRefunds.list('client'),
    ]);
    set({ clients, payments, oldDebts, refunds });
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
      oldDebts: get().oldDebts.filter((d) => d.partyId !== id),
      refunds: get().refunds.filter((r) => r.partyId !== id),
    });
    await refreshClientDebt();
  },

  getOrCreatePassager: async () => {
    const existing = get().clients.find((c) => c.name.toLowerCase().startsWith('client passager'));
    if (existing) return existing;
    const row = await save('clients.passager', () => db.clients.passager());
    set({ clients: [...get().clients.filter((c) => c.id !== row.id), row] });
    return row;
  },

  payDebt: async (clientId, amount, paidAt, notes = '', method) => {
    const row = await save<{ id: string }>('clients.pay', () =>
      rpc.payClient(clientId, amount, paidAt, notes, method ?? { method: 'especes' })
    );
    const payments = await db.clientPayments.list();
    // le versement solde d'abord les anciennes dettes et, s'il depasse la
    // dette, laisse une AVANCE au client : les fiches sont donc relues
    set({ payments, ...(await reloadLedger()) });
    // les ventes / commandes viennent d'être soldées côté base : on les relit
    await refreshClientDebt();
    // the row the database actually created (never the newest by date)
    return payments.find((p) => p.id === row?.id) as PartyPayment ?? payments.find((p) => p.partyId === clientId) as PartyPayment;
  },

  updatePayment: async (id, amount, paidAt, notes, method) => {
    await save('clients.payment.update', () => rpc.updateClientPayment(id, amount, paidAt, notes, method));
    set({ payments: await db.clientPayments.list(), ...(await reloadLedger()) });
    await refreshClientDebt();
  },

  deletePayment: async (id) => {
    await save('clients.payment.delete', () => rpc.deleteClientPayment(id));
    set({ payments: get().payments.filter((p) => p.id !== id), ...(await reloadLedger()) });
    await refreshClientDebt();
  },

  addOldDebt: async (clientId, amount, date, description) => {
    const row = await save<{ id: string }>('clients.oldDebt.create', () =>
      rpc.addPartyOldDebt('client', clientId, amount, date, description)
    );
    const ledger = await reloadLedger();
    set(ledger);
    // une ardoise du passe n'ecrit rien en caisse, mais elle peut etre soldee
    // aussitot par une avance deja versee : les ventes sont donc relues
    await refreshClientDebt();
    return ledger.oldDebts.find((d) => d.id === row?.id) as PartyOldDebt;
  },

  updateOldDebt: async (id, amount, date, description) => {
    await save('clients.oldDebt.update', () => rpc.updatePartyOldDebt(id, amount, date, description));
    set(await reloadLedger());
    await refreshClientDebt();
  },

  deleteOldDebt: async (id) => {
    await save('clients.oldDebt.delete', () => rpc.deletePartyOldDebt(id));
    set(await reloadLedger());
    await refreshClientDebt();
  },

  refundCredit: async (clientId, amount, refundedAt, notes = '', method) => {
    const row = await save<{ id: string }>('clients.refund', () =>
      rpc.refundPartyCredit('client', clientId, amount, refundedAt, notes, method ?? { method: 'especes' })
    );
    const ledger = await reloadLedger();
    set(ledger);
    // l'argent rendu au client SORT de la caisse
    await refreshClientDebt();
    return ledger.refunds.find((r) => r.id === row?.id);
  },

  deleteRefund: async (id) => {
    await save('clients.refund.delete', () => rpc.deletePartyRefund(id));
    set(await reloadLedger());
    await refreshClientDebt();
  },
}));
