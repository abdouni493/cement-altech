import type { PartyOldDebt } from '@/types';

/* ============================================================================
 *  SITUATION NETTE D'UN TIERS  (client ou fournisseur)
 * ----------------------------------------------------------------------------
 *  Un tiers n'a pas seulement une dette : il peut aussi avoir un ACOMPTE,
 *  c'est-à-dire avoir versé PLUS que ce qu'il devait. Le montant en trop est
 *  conservé côté base (`clients.credit_amount` / `suppliers.credit_amount`) et
 *  vient EN DÉDUCTION de sa dette ; il sert à payer ses prochaines commandes,
 *  ventes, livraisons (ou achats pour un fournisseur).
 *
 *      dette     = reste des factures (ventes / bons de livraison / achats)
 *                  + anciennes dettes
 *      acompte   = avance libre + argent versé sur des commandes et pas encore
 *                  imputé sur leurs bons de livraison
 *      solde net = dette − acompte
 *
 *  · solde net > 0 → le tiers DOIT encore de l'argent
 *  · solde net < 0 → l'ENTREPRISE lui doit de l'argent : sa carte affiche le
 *    montant en positif (« + 5 000,00 DA »).
 *
 *  Une COMMANDE n'est pas une dette : tant qu'elle n'est pas livrée, rien n'a
 *  été vendu. Seul ce qui est livré (la facture du bon de livraison) est dû.
 * ========================================================================== */

export interface PartyBalance {
  /** Tout ce qui lui a été facturé, anciennes dettes comprises. */
  billed: number;
  /** Ce qui a déjà été réglé sur ces documents. */
  paid: number;
  /** Reste dû, anciennes dettes comprises (jamais négatif). */
  rest: number;
  /** Acompte libre (avance versée en trop, pas encore utilisée ni rendue). */
  credit: number;
  /** Argent versé sur des commandes et pas encore imputé sur un bon. */
  advance: number;
  /** Dette sans document (acompte négatif : un versement utilisé a été supprimé). */
  extraDebt: number;
  /** `rest − credit − advance` : négatif quand le tiers a un crédit sur l'entreprise. */
  net: number;
  /** Le tiers doit encore de l'argent. */
  hasDebt: boolean;
  /** L'entreprise lui doit de l'argent. */
  hasCredit: boolean;
  /** Montant en sa faveur, toujours positif (0 s'il n'en a pas). */
  creditToReturn: number;
  /** Part payée, pour la barre de progression des cartes (0 → 100). */
  paidPercent: number;
}

/** Les cumuls bruts d'un tiers, avant prise en compte de son acompte. */
export interface PartyTotals {
  /** Total facturé par les documents (ventes, ou factures d'achat). */
  documentsBilled: number;
  /** Total déjà réglé sur ces documents. */
  documentsPaid: number;
  /** Reste dû sur ces documents. */
  documentsRest: number;
  /** Anciennes dettes du tiers. */
  oldDebts: PartyOldDebt[];
  /** Acompte enregistré sur sa fiche (peut être négatif). */
  credit?: number;
  /** Argent de ses commandes pas encore imputé sur un bon de livraison. */
  advance?: number;
}

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

export function computePartyBalance({
  documentsBilled, documentsPaid, documentsRest, oldDebts, credit = 0, advance = 0,
}: PartyTotals): PartyBalance {
  const oldBilled = oldDebts.reduce((s, d) => s + d.amount, 0);
  const oldPaid = oldDebts.reduce((s, d) => s + d.paidAmount, 0);
  const oldRest = oldDebts.reduce((s, d) => s + d.restAmount, 0);

  // Un acompte NÉGATIF est une dette sans document : un versement déjà utilisé
  // (sur une commande, ou rendu) a été supprimé ensuite.
  const extraDebt = r2(Math.max(0, -(credit || 0)));
  const safeCredit = r2(Math.max(0, credit || 0));
  const safeAdvance = r2(Math.max(0, advance || 0));

  const billed = r2(documentsBilled + oldBilled + extraDebt);
  const paid = r2(documentsPaid + oldPaid);
  const rest = r2(documentsRest + oldRest + extraDebt);
  const net = r2(rest - safeCredit - safeAdvance);

  return {
    billed,
    paid,
    rest,
    credit: safeCredit,
    advance: safeAdvance,
    extraDebt,
    net,
    hasDebt: net > 0.005,
    hasCredit: net < -0.005,
    creditToReturn: net < 0 ? -net : 0,
    paidPercent: billed > 0 ? Math.min(100, ((paid + safeCredit + safeAdvance) / billed) * 100) : 100,
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
