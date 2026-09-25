import type {
  Sale, Purchase, PartyPayment, PartyOldDebt, PartyCreditRefund, ClientDebt,
  CommandDelivery, CommandAdjustment,
} from '@/types';
import type { Command } from '@/store/commandStore';
import { dayOf } from './utils';

/* ============================================================================
 *  HISTORIQUE COMPLET D'UN TIERS  —  SOURCE UNIQUE DE VERITE
 * ----------------------------------------------------------------------------
 *  Ce module construit, pour UN client ou UN fournisseur, la liste EXHAUSTIVE
 *  de tout ce que l'application a enregistre a son nom :
 *
 *    CLIENT     ventes · commandes · livraisons · versements ·
 *               anciennes ventes · anciennes commandes · anciennes livraisons ·
 *               anciennes dettes · excedents rendus · annulations et
 *               augmentations de commande
 *
 *    FOURNISSEUR achats · versements · anciens achats · anciennes dettes ·
 *               excedents recuperes
 *
 *  POURQUOI CE MODULE EXISTE
 *  -------------------------
 *  Un versement pouvait vivre a TROIS endroits differents (reglement direct du
 *  client, versement sur une dette enregistree, encaissement porte par une
 *  vente ou un bon de livraison). La carte du client n'en montrait qu'UN seul :
 *  l'operateur supprimait « son » versement, le compte rendu continuait de
 *  compter les deux autres — et le versement supprime semblait revenir d'entre
 *  les morts.
 *
 *  Desormais la fenetre « Historique », le compte rendu affiche et le compte
 *  rendu IMPRIME partent tous les trois de `buildClientHistory()` /
 *  `buildSupplierHistory()` : ce qui est visible est ce qui est compte, et ce
 *  qui est supprime disparait partout.
 * ========================================================================== */

/** Origine d'un encaissement — determine ce que l'operateur peut en faire. */
export type PaymentSource =
  | 'direct'       // client_payments / supplier_payments  (modifiable, supprimable)
  | 'debt'         // client_debt_versements               (supprimable)
  | 'document'     // sale_payments / purchase_payments    (se gere sur la facture)
  | 'advance';     // acompte de commande                  (se gere sur la commande)

export interface HistoryPayment {
  id: string;
  source: PaymentSource;
  /** Date ET heure quand elles sont connues, sinon la date seule. */
  date: string;
  amount: number;
  /** D'ou vient l'argent : « Versement direct », « Vente VNT-2026-014 »... */
  origin: string;
  notes?: string;
  method?: PartyPayment['method'];
  chequeNumber?: string;
  virementNumber?: string;
  bankName?: string;
  /** Identifiant du document porteur (vente, commande, dette). */
  documentId?: string;
  documentRef?: string;
  /** Objet d'origine — necessaire pour la fenetre de modification. */
  payment?: PartyPayment;
  debtId?: string;
}

/** Une livraison enrichie de sa commande — le tableau a besoin des deux. */
export interface HistoryDelivery {
  delivery: CommandDelivery;
  command?: Command;
  /** Valeur des lignes remises, au prix unitaire de la commande. */
  amountHt: number;
  quantity: number;
}

export interface ClientHistory {
  sales: Sale[];
  historicalSales: Sale[];
  commands: Command[];
  historicalCommands: Command[];
  deliveries: HistoryDelivery[];
  historicalDeliveries: HistoryDelivery[];
  payments: HistoryPayment[];
  oldDebts: PartyOldDebt[];
  refunds: PartyCreditRefund[];
  adjustments: CommandAdjustment[];
  /** Dettes enregistrees (ecran « dettes clients ») rattachees au client. */
  debts: ClientDebt[];
}

export interface SupplierHistory {
  purchases: Purchase[];
  historicalPurchases: Purchase[];
  payments: HistoryPayment[];
  oldDebts: PartyOldDebt[];
  refunds: PartyCreditRefund[];
}

/* ------------------------------------------------------------------ helpers */

const byDateDesc = (a: string, b: string) => (b || '').localeCompare(a || '');

/** Quantite et valeur reellement remises par un bon de livraison. */
export function deliveryAmount(delivery: CommandDelivery, command?: Command) {
  let amountHt = 0;
  let quantity = 0;
  delivery.items.forEach((it) => {
    const line = command?.items.find(
      (x) => (it.commandItemId && x.id === it.commandItemId) || x.productName === it.productName
    );
    quantity += it.quantity;
    amountHt += it.quantity * (line?.unitPrice ?? 0);
  });
  return {
    amountHt: delivery.totalHt !== undefined && delivery.totalHt > 0 ? delivery.totalHt : amountHt,
    quantity,
  };
}

/* ------------------------------------------------------------------ client */

export interface ClientHistoryInput {
  clientId: string;
  sales: Sale[];
  commands: Command[];
  deliveries: CommandDelivery[];
  payments: PartyPayment[];
  oldDebts: PartyOldDebt[];
  refunds: PartyCreditRefund[];
  debts: ClientDebt[];
  adjustments?: CommandAdjustment[];
}

export function buildClientHistory(input: ClientHistoryInput): ClientHistory {
  const {
    clientId, sales, commands, deliveries, payments, oldDebts, refunds, debts,
    adjustments = [],
  } = input;

  const mySales = sales.filter((s) => s.clientId === clientId);
  const myCommands = commands.filter((c) => c.clientId === clientId);
  const commandById = new Map(myCommands.map((c) => [c.id, c]));
  const myDeliveries = deliveries.filter((d) => commandById.has(d.commandId));
  const myDebts = debts.filter((d) => d.clientId === clientId);

  const wrap = (d: CommandDelivery): HistoryDelivery => {
    const command = commandById.get(d.commandId);
    return { delivery: d, command, ...deliveryAmount(d, command) };
  };

  // ---- VERSEMENTS : les trois gisements reunis, jamais deux fois le meme ---
  const list: HistoryPayment[] = [];

  // 1. reglements directs saisis depuis la carte du client
  payments
    .filter((p) => p.partyId === clientId)
    .forEach((p) =>
      list.push({
        id: p.id,
        source: 'direct',
        date: p.paidAt || p.date,
        amount: p.amount,
        origin: 'Versement direct',
        notes: p.notes,
        method: p.method,
        chequeNumber: p.chequeNumber,
        virementNumber: p.virementNumber,
        bankName: p.bankName,
        payment: p,
      })
    );

  // 2. versements passes sur une DETTE ENREGISTREE (ecran des dettes clients)
  //    — c'est CE gisement que la carte du client ne montrait pas.
  myDebts.forEach((d) =>
    (d.versements ?? []).forEach((v) =>
      list.push({
        id: v.id,
        source: 'debt',
        date: v.createdAt || v.date,
        amount: v.amount,
        origin: `Dette « ${d.description || 'sans libelle'} »`,
        notes: v.notes,
        documentId: d.id,
        documentRef: d.description,
        debtId: d.id,
      })
    )
  );

  // 3. encaissements portes par une facture de vente ou un bon de livraison
  //
  //    ATTENTION — on saute les lignes `delivery_advance` : ce sont des parts
  //    de l'acompte de la commande RE-IMPUTEES sur un bon de livraison. Cet
  //    argent est deja entre en caisse a la creation de la commande et figure
  //    plus bas au titre de l'acompte : le compter ici le compterait DEUX FOIS.
  mySales.forEach((s) =>
    (s.payments ?? []).forEach((p, i) => {
      if (p.origin === 'delivery_advance') return;
      list.push({
        id: p.id ?? `${s.id}-p${i}`,
        source: 'document',
        date: p.date || s.date,
        amount: p.amount,
        origin: s.deliveryId
          ? `Livraison facturee ${s.reference}`
          : `Vente ${s.reference}`,
        notes: p.description,
        documentId: s.id,
        documentRef: s.reference,
      });
    })
  );

  // 4. acompte et reglements encaisses au titre de la commande elle-meme
  myCommands.forEach((c) => {
    if ((c.advancePaid ?? 0) > 0) {
      list.push({
        id: `${c.id}-advance`,
        source: 'advance',
        date: c.createdAt,
        amount: c.advancePaid,
        origin: `Acompte commande ${c.reference}`,
        documentId: c.id,
        documentRef: c.reference,
      });
    }
    if ((c.extraPaid ?? 0) > 0) {
      list.push({
        id: `${c.id}-extra`,
        source: 'advance',
        date: c.createdAt,
        amount: c.extraPaid ?? 0,
        origin: `Reglement commande ${c.reference}`,
        documentId: c.id,
        documentRef: c.reference,
      });
    }
  });

  list.sort((a, b) => byDateDesc(a.date, b.date));

  const cmdIds = new Set(myCommands.map((c) => c.id));

  return {
    sales: mySales.filter((s) => !s.isHistorical).sort((a, b) => byDateDesc(a.date, b.date)),
    historicalSales: mySales.filter((s) => s.isHistorical).sort((a, b) => byDateDesc(a.date, b.date)),
    commands: myCommands.filter((c) => !c.isHistorical).sort((a, b) => byDateDesc(a.createdAt, b.createdAt)),
    historicalCommands: myCommands.filter((c) => c.isHistorical).sort((a, b) => byDateDesc(a.createdAt, b.createdAt)),
    deliveries: myDeliveries
      .filter((d) => !d.isHistorical)
      .sort((a, b) => byDateDesc(a.deliveredAt, b.deliveredAt))
      .map(wrap),
    historicalDeliveries: myDeliveries
      .filter((d) => d.isHistorical)
      .sort((a, b) => byDateDesc(a.deliveredAt, b.deliveredAt))
      .map(wrap),
    payments: list,
    oldDebts: oldDebts.filter((d) => d.partyId === clientId).sort((a, b) => byDateDesc(a.date, b.date)),
    refunds: refunds.filter((r) => r.partyId === clientId).sort((a, b) => byDateDesc(a.refundedAt, b.refundedAt)),
    adjustments: adjustments
      .filter((a) => cmdIds.has(a.commandId))
      .sort((a, b) => byDateDesc(a.date, b.date)),
    debts: myDebts,
  };
}

/* -------------------------------------------------------------- fournisseur */

export interface SupplierHistoryInput {
  supplierId: string;
  purchases: Purchase[];
  payments: PartyPayment[];
  oldDebts: PartyOldDebt[];
  refunds: PartyCreditRefund[];
}

export function buildSupplierHistory(input: SupplierHistoryInput): SupplierHistory {
  const { supplierId, purchases, payments, oldDebts, refunds } = input;
  const mine = purchases.filter((p) => p.supplierId === supplierId);

  const list: HistoryPayment[] = [];
  payments
    .filter((p) => p.partyId === supplierId)
    .forEach((p) =>
      list.push({
        id: p.id,
        source: 'direct',
        date: p.paidAt || p.date,
        amount: p.amount,
        origin: 'Reglement direct',
        notes: p.notes,
        method: p.method,
        chequeNumber: p.chequeNumber,
        virementNumber: p.virementNumber,
        bankName: p.bankName,
        payment: p,
      })
    );
  mine.forEach((p) =>
    (p.payments ?? []).forEach((x, i) =>
      list.push({
        id: x.id ?? `${p.id}-p${i}`,
        source: 'document',
        date: x.date || p.date,
        amount: x.amount,
        origin: `Facture ${p.reference}`,
        notes: x.description,
        documentId: p.id,
        documentRef: p.reference,
      })
    )
  );
  list.sort((a, b) => byDateDesc(a.date, b.date));

  return {
    purchases: mine.filter((p) => !p.isHistorical).sort((a, b) => byDateDesc(a.date, b.date)),
    historicalPurchases: mine.filter((p) => p.isHistorical).sort((a, b) => byDateDesc(a.date, b.date)),
    payments: list,
    oldDebts: oldDebts.filter((d) => d.partyId === supplierId).sort((a, b) => byDateDesc(a.date, b.date)),
    refunds: refunds.filter((r) => r.partyId === supplierId).sort((a, b) => byDateDesc(a.refundedAt, b.refundedAt)),
  };
}

/* ------------------------------------------------------------- filtre date */

/** `date` tombe-t-elle dans [from, to] (bornes incluses, vides = illimitees) ? */
export function withinPeriod(date: string | undefined, from?: string, to?: string): boolean {
  if (!date) return !from && !to;
  const d = dayOf(date);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}
