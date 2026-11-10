import { create } from 'zustand';
import type {
  Deliverer, DelivererPayment, PaymentMethodDetails, PurchaseDelivererAssignment,
} from '@/types';
import { db, rpc } from '@/lib/db';
import { useCaisseStore } from './caisseStore';
import {
  loadDelivererData, saveDelivererData, newId, type DelivererData,
} from '@/lib/localDeliverers';

/**
 * LIVREURS — stockés dans le navigateur (aucun script SQL à exécuter).
 *
 * Les mouvements d'argent passent par la vraie caisse (`add_caisse_transaction`
 * / suppression d'une écriture) : le règlement d'un livreur ou le montant qui
 * lui est payé sur un achat SORTENT réellement de la caisse. Le reste (fiche du
 * livreur, affectation à un achat, journal des règlements) est conservé
 * localement.
 */

interface DelivererState {
  deliverers: Deliverer[];
  payments: DelivererPayment[];
  /** purchaseId -> livreur affecté à cette facture. */
  assignments: Record<string, PurchaseDelivererAssignment>;
  load: () => Promise<void>;
  addDeliverer: (data: Omit<Deliverer, 'id'>) => Promise<Deliverer>;
  updateDeliverer: (id: string, data: Partial<Deliverer>) => Promise<void>;
  deleteDeliverer: (id: string) => Promise<void>;
  /** « Payer la dette » — sort de la caisse et s'enregistre dans l'historique. */
  payDebt: (
    delivererId: string, amount: number, paidAt: string, notes?: string,
    method?: PaymentMethodDetails,
  ) => Promise<DelivererPayment | undefined>;
  updatePayment: (
    id: string, amount: number, paidAt: string, notes?: string,
    method?: PaymentMethodDetails,
  ) => Promise<void>;
  deletePayment: (id: string) => Promise<void>;
  /** Affecte / met à jour / retire le livreur d'une facture d'achat. */
  setPurchaseDeliverer: (
    purchaseId: string, reference: string,
    delivererId: string | null, cost: number, paid: number,
  ) => Promise<void>;
}

function persist(get: () => DelivererState): void {
  const { deliverers, payments, assignments } = get();
  saveDelivererData({ deliverers, payments, assignments } as DelivererData);
}

async function reloadCaisse(): Promise<void> {
  await useCaisseStore.getState().load().catch(() => undefined);
}

/** Crée une sortie de caisse (best effort) et renvoie son id, ou undefined. */
async function caisseWithdraw(amount: number, description: string, date: string): Promise<string | undefined> {
  if (!(amount > 0)) return undefined;
  try {
    const row = await rpc.addCaisseTransaction('withdrawal', amount, description, date, undefined, 'Livreurs');
    await reloadCaisse();
    return row?.id;
  } catch {
    return undefined;
  }
}

/** Supprime une écriture de caisse précédemment créée (best effort). */
async function caisseRemove(id?: string): Promise<void> {
  if (!id) return;
  try {
    await db.caisse.remove(id);
    await reloadCaisse();
  } catch {
    /* déjà supprimée ou droit manquant — on ignore */
  }
}

function methodLabel(m?: PaymentMethodDetails): string {
  if (!m || m.method === 'especes') return 'espèces';
  if (m.method === 'cheque') return `chèque${m.chequeNumber ? ` n° ${m.chequeNumber}` : ''}`;
  return `virement${m.virementNumber ? ` n° ${m.virementNumber}` : ''}`;
}

const init = loadDelivererData();

export const useDelivererStore = create<DelivererState>()((set, get) => ({
  deliverers: init.deliverers,
  payments: init.payments,
  assignments: init.assignments,

  load: async () => {
    const data = loadDelivererData();
    set({ deliverers: data.deliverers, payments: data.payments, assignments: data.assignments });
  },

  addDeliverer: async (data) => {
    const row: Deliverer = { id: newId(), name: data.name, phone: data.phone, address: data.address };
    set({ deliverers: [...get().deliverers, row] });
    persist(get);
    return row;
  },

  updateDeliverer: async (id, data) => {
    set({ deliverers: get().deliverers.map((d) => (d.id === id ? { ...d, ...data } : d)) });
    persist(get);
  },

  deleteDeliverer: async (id) => {
    // retire les sorties de caisse liées à ses règlements et à ses achats
    const { payments, assignments } = get();
    await Promise.all(payments.filter((p) => p.delivererId === id).map((p) => caisseRemove(p.caisseTxId)));
    await Promise.all(
      Object.values(assignments).filter((a) => a.delivererId === id).map((a) => caisseRemove(a.caisseTxId))
    );
    const nextAssign: Record<string, PurchaseDelivererAssignment> = {};
    Object.entries(get().assignments).forEach(([pid, a]) => { if (a.delivererId !== id) nextAssign[pid] = a; });
    set({
      deliverers: get().deliverers.filter((d) => d.id !== id),
      payments: get().payments.filter((p) => p.delivererId !== id),
      assignments: nextAssign,
    });
    persist(get);
  },

  payDebt: async (delivererId, amount, paidAt, notes = '', method) => {
    const deliverer = get().deliverers.find((d) => d.id === delivererId);
    const date = (paidAt || new Date().toISOString()).slice(0, 10);
    const caisseTxId = await caisseWithdraw(
      amount,
      `Règlement livreur: ${deliverer?.name ?? ''} (${methodLabel(method)})`,
      date,
    );
    const payment: DelivererPayment = {
      id: newId(),
      delivererId,
      delivererName: deliverer?.name,
      amount,
      date,
      paidAt: paidAt || new Date().toISOString(),
      notes,
      method: method?.method ?? 'especes',
      chequeNumber: method?.chequeNumber,
      virementNumber: method?.virementNumber,
      bankName: method?.bankName,
      createdAt: new Date().toISOString(),
      caisseTxId,
    };
    set({ payments: [payment, ...get().payments] });
    persist(get);
    return payment;
  },

  updatePayment: async (id, amount, paidAt, notes, method) => {
    const old = get().payments.find((p) => p.id === id);
    if (!old) return;
    const date = (paidAt || old.paidAt).slice(0, 10);
    const deliverer = get().deliverers.find((d) => d.id === old.delivererId);
    // on remplace l'écriture de caisse par la nouvelle valeur
    await caisseRemove(old.caisseTxId);
    const caisseTxId = await caisseWithdraw(
      amount,
      `Règlement livreur: ${deliverer?.name ?? ''} (${methodLabel(method)})`,
      date,
    );
    set({
      payments: get().payments.map((p) => (p.id === id ? {
        ...p,
        amount,
        paidAt: paidAt || p.paidAt,
        date,
        notes: notes ?? p.notes,
        method: method?.method ?? p.method,
        chequeNumber: method?.chequeNumber,
        virementNumber: method?.virementNumber,
        bankName: method?.bankName,
        caisseTxId,
      } : p)),
    });
    persist(get);
  },

  deletePayment: async (id) => {
    const old = get().payments.find((p) => p.id === id);
    await caisseRemove(old?.caisseTxId);
    set({ payments: get().payments.filter((p) => p.id !== id) });
    persist(get);
  },

  setPurchaseDeliverer: async (purchaseId, reference, delivererId, cost, paid) => {
    const prev = get().assignments[purchaseId];
    const wants = !!delivererId;

    // Rien à faire et rien à nettoyer.
    if (!wants && !prev) return;

    // L'écriture de caisse « payé au livreur » est toujours refaite à neuf.
    await caisseRemove(prev?.caisseTxId);

    const nextAssign = { ...get().assignments };
    if (!wants) {
      delete nextAssign[purchaseId];
      set({ assignments: nextAssign });
      persist(get);
      return;
    }

    const deliverer = get().deliverers.find((d) => d.id === delivererId);
    const caisseTxId = await caisseWithdraw(
      paid,
      `Payé au livreur: ${deliverer?.name ?? ''} — achat ${reference}`,
      new Date().toISOString().slice(0, 10),
    );
    nextAssign[purchaseId] = {
      delivererId: delivererId as string,
      delivererName: deliverer?.name ?? '',
      cost: Math.max(0, cost),
      paid: Math.max(0, paid),
      caisseTxId,
    };
    set({ assignments: nextAssign });
    persist(get);
  },
}));
