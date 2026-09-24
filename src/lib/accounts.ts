import type {
  Client, Supplier, Sale, Purchase, PartyOldDebt, CommandDelivery,
} from '@/types';
import type { Command } from '@/store/commandStore';
import { computePartyBalance, type PartyBalance } from './partyBalance';
import { clientCommandSummary } from './commandBilling';

/* ============================================================================
 *  COMPTE D'UN CLIENT / D'UN FOURNISSEUR — CALCUL UNIQUE
 * ----------------------------------------------------------------------------
 *  La carte du tiers, sa fenêtre « Historique », son compte rendu, la page
 *  Rapports et le tableau de bord lisaient chacun la dette à leur façon : les
 *  chiffres ne se recoupaient jamais tout à fait. Ils passent tous par ici.
 *
 *  CLIENT
 *    facturé  = ventes (caisse ET bons de livraison, anciennes comprises)
 *               + anciennes dettes
 *    réglé    = ce qui a été payé sur ces documents
 *    acompte  = avance libre (versé en trop) + argent de ses commandes pas
 *               encore imputé sur un bon de livraison
 *    solde    = reste dû − acompte
 *    Les commandes NON LIVRÉES ne sont pas une dette : elles sont rappelées à
 *    part (« commandes en cours »).
 *
 *  FOURNISSEUR
 *    facturé  = factures d'achat (anciennes comprises) + anciennes dettes
 *    acompte  = trop-versé (avance libre)
 * ========================================================================== */

export interface ClientAccount extends PartyBalance {
  salesCount: number;
  commandsCount: number;
  /** Valeur commandée et pas encore livrée (information). */
  pendingCommands: number;
  pendingCommandsCount: number;
}

export interface SupplierAccount extends PartyBalance {
  purchasesCount: number;
}

const EMPTY_BAL = computePartyBalance({ documentsBilled: 0, documentsPaid: 0, documentsRest: 0, oldDebts: [] });

export const EMPTY_CLIENT_ACCOUNT: ClientAccount = {
  ...EMPTY_BAL, salesCount: 0, commandsCount: 0, pendingCommands: 0, pendingCommandsCount: 0,
};
export const EMPTY_SUPPLIER_ACCOUNT: SupplierAccount = { ...EMPTY_BAL, purchasesCount: 0 };

export interface ClientAccountInput {
  clients: Client[];
  sales: Sale[];
  commands: Command[];
  deliveries: CommandDelivery[];
  oldDebts: PartyOldDebt[];
}

/** Comptes de TOUS les clients, calculés en une passe (indexés par client). */
export function buildClientAccounts(input: ClientAccountInput): Map<string, ClientAccount> {
  const { clients, sales, commands, deliveries, oldDebts } = input;
  interface Bucket { sales: Sale[]; commands: Command[]; olds: PartyOldDebt[] }
  const index = new Map<string, Bucket>();
  const bucket = (id: string) => {
    let b = index.get(id);
    if (!b) { b = { sales: [], commands: [], olds: [] }; index.set(id, b); }
    return b;
  };
  clients.forEach((c) => bucket(c.id));
  sales.forEach((s) => { if (s.clientId) bucket(s.clientId).sales.push(s); });
  commands.forEach((c) => { if (c.clientId) bucket(c.clientId).commands.push(c); });
  oldDebts.forEach((d) => { if (d.partyId) bucket(d.partyId).olds.push(d); });

  // les bons de livraison, par commande (acompte disponible de chaque commande)
  const deliveriesByCommand = new Map<string, CommandDelivery[]>();
  deliveries.forEach((d) => {
    const list = deliveriesByCommand.get(d.commandId) ?? [];
    list.push(d);
    deliveriesByCommand.set(d.commandId, list);
  });

  const creditOf = new Map(clients.map((c) => [c.id, c.creditAmount ?? 0]));
  const out = new Map<string, ClientAccount>();
  index.forEach((b, id) => {
    const myDeliveries = b.commands.flatMap((c) => deliveriesByCommand.get(c.id) ?? []);
    const cmd = clientCommandSummary(b.commands, b.sales, myDeliveries);
    const balance = computePartyBalance({
      documentsBilled: b.sales.reduce((s, x) => s + x.finalAmount, 0),
      documentsPaid: b.sales.reduce((s, x) => s + x.paidAmount, 0),
      documentsRest: b.sales.reduce((s, x) => s + x.restAmount, 0),
      oldDebts: b.olds,
      credit: creditOf.get(id) ?? 0,
      advance: cmd.advance,
    });
    out.set(id, {
      ...balance,
      salesCount: b.sales.length,
      commandsCount: b.commands.length,
      pendingCommands: cmd.pending,
      pendingCommandsCount: cmd.pendingCount,
    });
  });
  return out;
}

/** Compte d'UN client. */
export function clientAccountOf(clientId: string, input: ClientAccountInput): ClientAccount {
  const client = input.clients.find((c) => c.id === clientId);
  const map = buildClientAccounts({
    clients: client ? [client] : [{ id: clientId, name: '', phone: '' }],
    sales: input.sales.filter((s) => s.clientId === clientId),
    commands: input.commands.filter((c) => c.clientId === clientId),
    deliveries: input.deliveries,
    oldDebts: input.oldDebts.filter((d) => d.partyId === clientId),
  });
  return map.get(clientId) ?? EMPTY_CLIENT_ACCOUNT;
}

export interface SupplierAccountInput {
  suppliers: Supplier[];
  purchases: Purchase[];
  oldDebts: PartyOldDebt[];
}

/** Comptes de TOUS les fournisseurs. */
export function buildSupplierAccounts(input: SupplierAccountInput): Map<string, SupplierAccount> {
  const { suppliers, purchases, oldDebts } = input;
  const index = new Map<string, { purchases: Purchase[]; olds: PartyOldDebt[] }>();
  const bucket = (id: string) => {
    let b = index.get(id);
    if (!b) { b = { purchases: [], olds: [] }; index.set(id, b); }
    return b;
  };
  suppliers.forEach((s) => bucket(s.id));
  purchases.forEach((p) => { if (p.supplierId) bucket(p.supplierId).purchases.push(p); });
  oldDebts.forEach((d) => { if (d.partyId) bucket(d.partyId).olds.push(d); });

  const creditOf = new Map(suppliers.map((s) => [s.id, s.creditAmount ?? 0]));
  const out = new Map<string, SupplierAccount>();
  index.forEach((b, id) => {
    const balance = computePartyBalance({
      documentsBilled: b.purchases.reduce((s, x) => s + x.totalAmount, 0),
      documentsPaid: b.purchases.reduce((s, x) => s + x.paidAmount, 0),
      documentsRest: b.purchases.reduce((s, x) => s + x.restAmount, 0),
      oldDebts: b.olds,
      credit: creditOf.get(id) ?? 0,
    });
    out.set(id, { ...balance, purchasesCount: b.purchases.length });
  });
  return out;
}

/** Compte d'UN fournisseur. */
export function supplierAccountOf(supplierId: string, input: SupplierAccountInput): SupplierAccount {
  const supplier = input.suppliers.find((s) => s.id === supplierId);
  const map = buildSupplierAccounts({
    suppliers: supplier ? [supplier] : [{ id: supplierId, name: '', phone: '', address: '' }],
    purchases: input.purchases.filter((p) => p.supplierId === supplierId),
    oldDebts: input.oldDebts.filter((d) => d.partyId === supplierId),
  });
  return map.get(supplierId) ?? EMPTY_SUPPLIER_ACCOUNT;
}

/** Totaux d'un ensemble de comptes : dettes, acomptes et nombre de débiteurs. */
export function sumAccounts(accounts: Iterable<PartyBalance>) {
  let debt = 0;
  let credit = 0;
  let debtors = 0;
  let creditors = 0;
  for (const a of accounts) {
    if (a.net > 0.005) { debt += a.net; debtors += 1; }
    else if (a.net < -0.005) { credit += -a.net; creditors += 1; }
  }
  return {
    debt: Math.round(debt * 100) / 100,
    credit: Math.round(credit * 100) / 100,
    debtors,
    creditors,
  };
}
