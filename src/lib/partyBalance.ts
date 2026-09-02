import type { PartyOldDebt } from '@/types';

/* ============================================================================
 *  SITUATION NETTE D'UN TIERS  (client ou fournisseur)
 * ----------------------------------------------------------------------------
 *  Un tiers n'a pas seulement une dette : il peut aussi avoir une AVANCE,
 *  c'est-à-dire avoir versé PLUS que ce qu'il devait. Le montant en trop est
 *  conservé côté base (`clients.credit_amount` / `suppliers.credit_amount`) et
 *  vient EN DÉDUCTION de sa dette.
 *
 *      solde net = (reste dû sur les documents + anciennes dettes) − avance
 *
 *  · solde net > 0 → le tiers DOIT encore de l'argent
 *  · solde net < 0 → l'ENTREPRISE lui doit de l'argent : sa carte affiche le
 *    montant en positif (« + 5 000,00 DA ») et le bouton « Rendre l'excédent »
 *    apparaît.
 * ========================================================================== */

export interface PartyBalance {
  /** Tout ce qui lui a été facturé, anciennes dettes comprises. */
  billed: number;
  /** Ce qui a déjà été encaissé sur ces documents. */
  paid: number;
  /** Reste dû, anciennes dettes comprises (jamais négatif). */
  rest: number;
  /** Avance versée en trop et pas encore rendue. */
  credit: number;
  /** `rest − credit` : négatif quand le tiers a un crédit sur l'entreprise. */
  net: number;
  /** Le tiers doit encore de l'argent. */
  hasDebt: boolean;
  /** L'entreprise lui doit de l'argent. */
  hasCredit: boolean;
  /** Montant à lui rendre, toujours positif (0 s'il n'a pas d'excédent). */
  creditToReturn: number;
  /** Part payée, pour la barre de progression des cartes (0 → 100). */
  paidPercent: number;
}

/** Les cumuls bruts d'un tiers, avant prise en compte de son avance. */
export interface PartyTotals {
  /** Total facturé par les documents (ventes + commandes, ou factures d'achat). */
  documentsBilled: number;
  /** Total déjà réglé sur ces documents. */
  documentsPaid: number;
  /** Reste dû sur ces documents. */
  documentsRest: number;
  /** Anciennes dettes du tiers. */
  oldDebts: PartyOldDebt[];
  /** Avance enregistrée sur sa fiche. */
  credit?: number;
}

export function computePartyBalance({
  documentsBilled, documentsPaid, documentsRest, oldDebts, credit = 0,
}: PartyTotals): PartyBalance {
  const oldBilled = oldDebts.reduce((s, d) => s + d.amount, 0);
  const oldPaid = oldDebts.reduce((s, d) => s + d.paidAmount, 0);
  const oldRest = oldDebts.reduce((s, d) => s + d.restAmount, 0);

  const billed = documentsBilled + oldBilled;
  const paid = documentsPaid + oldPaid;
  const rest = documentsRest + oldRest;
  const safeCredit = Math.max(0, credit);
  const net = rest - safeCredit;

  return {
    billed,
    paid,
    rest,
    credit: safeCredit,
    net,
    hasDebt: net > 0.005,
    hasCredit: net < -0.005,
    creditToReturn: net < 0 ? -net : 0,
    paidPercent: billed > 0 ? Math.min(100, ((paid + safeCredit) / billed) * 100) : 100,
  };
}

/** Cumuls d'une liste d'anciennes dettes — utilisé par les comptes rendus. */
export function sumOldDebts(list: PartyOldDebt[]) {
  return {
    amount: list.reduce((s, d) => s + d.amount, 0),
    paid: list.reduce((s, d) => s + d.paidAmount, 0),
    rest: list.reduce((s, d) => s + d.restAmount, 0),
  };
}
