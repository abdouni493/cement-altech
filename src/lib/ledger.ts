import type {
  Sale, Purchase, PartyPayment, PartyOldDebt, PartyCreditRefund, CommandDelivery,
} from '@/types';
import type { Command } from '@/store/commandStore';
import { dayOf, paymentMethodLabel } from './utils';

/* ============================================================================
 *  RELEVE DE COMPTE D'UN TIERS  —  OPERATIONS ET ARGENT, DATES
 * ----------------------------------------------------------------------------
 *  Le compte rendu doit toujours tomber juste :
 *
 *      TOTAL            = ce qui a été livré / vendu / acheté sur la période
 *                         (+ anciennes dettes, + dette antérieure si demandée)
 *      TOTAL VERSEMENTS = l'argent REELLEMENT reçu (ou versé) sur la période
 *      RESTE            = TOTAL − TOTAL VERSEMENTS
 *
 *  Pour cela chaque mouvement est rangé à SA date, et l'argent n'est compté
 *  qu'UNE fois, au moment où il entre :
 *
 *   CLIENT — opérations (débit)
 *     · bon de livraison (sa facture de vente, T.T.C.)
 *     · vente de caisse
 *     · ancienne dette
 *   CLIENT — argent reçu (crédit)
 *     · versement direct (carte du client)
 *     · encaissement porté par une facture (caisse, remise d'un bon,
 *       règlement de dette) — SAUF l'imputation de l'acompte d'une commande
 *       sur un bon, qui n'est pas de l'argent neuf
 *     · acompte et règlements d'une commande, à leur date
 *     · excédent rendu au client (en négatif)
 *
 *   FOURNISSEUR — opérations : factures d'achat, anciennes dettes
 *   FOURNISSEUR — argent versé : règlements portés par les factures,
 *     versements directs, excédent récupéré (en négatif)
 *
 *  L'argent imputé depuis le COMPTE du tiers (versement ou acompte) n'est pas
 *  un nouveau mouvement : le versement a déjà été compté à sa date.
 * ========================================================================== */

export type DebitKind = 'delivery' | 'sale' | 'oldDebt' | 'purchase';
export type CreditKind = 'payment' | 'docPayment' | 'advance' | 'commandPayment' | 'refund';

export interface LedgerLine {
  designation: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  /** Montant hors taxes de la ligne. */
  amount: number;
}

export interface LedgerDebit {
  id: string;
  kind: DebitKind;
  /** YYYY-MM-DD */
  date: string;
  /** Montant dû, T.T.C. */
  amount: number;
  ht: number;
  tva: number;
  tvaRate?: number;
  tvaEnabled?: boolean;
  /** Libellé court : « BL-CMD-2026-001-01 », « FACTURE VNT-2026-010 »… */
  label: string;
  reference: string;
  description?: string;
  historical?: boolean;
  /** Adresse de livraison (bons de livraison). */
  location?: string;
  /** Achats : n° du bon du fournisseur et matricule du camion. */
  bonNumber?: string;
  driverPlate?: string;
  /** Ce qui reste dû aujourd'hui sur le document (information). */
  restNow: number;
  lines: LedgerLine[];
}

export interface LedgerCredit {
  id: string;
  kind: CreditKind;
  /** YYYY-MM-DD */
  date: string;
  /** Positif = argent reçu du client / versé au fournisseur ; négatif = rendu. */
  amount: number;
  label: string;
  method?: string;
  /** Document porteur de l'encaissement (encaissement sur facture). */
  debitId?: string;
  debitKind?: DebitKind;
}

export interface PartyLedger {
  debits: LedgerDebit[];
  credits: LedgerCredit[];
}

/** Jour LOCAL d'une date ou d'un horodatage (voir `dayOf`). */
const day = (v?: string) => dayOf(v);
const r2 = (n: number) => Math.round((n || 0) * 100) / 100;
const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);

function saleLines(s: Sale): LedgerLine[] {
  return s.products.map((l) => ({
    designation: (l.productName || 'Produit').trim(),
    quantity: l.quantity,
    unit: l.unit,
    unitPrice: l.sellingPrice,
    amount: r2(l.quantity * l.sellingPrice),
  }));
}

/* --------------------------------------------------------------- CLIENT */

export interface ClientLedgerInput {
  clientId: string;
  sales: Sale[];
  commands: Command[];
  deliveries: CommandDelivery[];
  payments: PartyPayment[];
  refunds: PartyCreditRefund[];
  oldDebts: PartyOldDebt[];
}

export function buildClientLedger(input: ClientLedgerInput): PartyLedger {
  const { clientId } = input;
  const debits: LedgerDebit[] = [];
  const credits: LedgerCredit[] = [];

  const myCommands = input.commands.filter((c) => c.clientId === clientId);
  const commandById = new Map(myCommands.map((c) => [c.id, c]));
  const deliveryById = new Map(input.deliveries.map((d) => [d.id, d]));

  // ---- factures : bons de livraison et ventes de caisse -------------------
  input.sales
    .filter((s) => s.clientId === clientId)
    .forEach((s) => {
      const delivery = s.deliveryId ? deliveryById.get(s.deliveryId) : undefined;
      const isDelivery = !!s.deliveryId;
      const cmd = s.commandId ? commandById.get(s.commandId) : undefined;
      const ht = r2(Math.max(0, s.totalAmount - (s.reduction || 0)));
      debits.push({
        id: s.id,
        kind: isDelivery ? 'delivery' : 'sale',
        date: day(isDelivery ? delivery?.deliveredAt || s.date : s.date),
        amount: r2(s.finalAmount),
        ht,
        tva: r2(s.tvaAmount || 0),
        tvaRate: s.tvaRate,
        tvaEnabled: !!s.tvaEnabled,
        label: isDelivery ? (delivery?.reference ?? s.reference) : s.reference,
        reference: isDelivery ? (delivery?.reference ?? s.reference) : s.reference,
        historical: !!s.isHistorical,
        location: isDelivery ? (delivery?.location || cmd?.clientAddress || '') : '',
        restNow: r2(s.restAmount),
        lines: saleLines(s),
      });

      // l'argent encaissé SUR la facture (jamais l'imputation d'un acompte)
      (s.payments ?? []).forEach((p, i) => {
        if (p.origin === 'delivery_advance') return;
        if (!(p.amount > 0)) return;
        credits.push({
          id: p.id ?? `${s.id}-p${i}`,
          kind: 'docPayment',
          date: day(p.date || s.date),
          amount: r2(p.amount),
          label: p.origin === 'delivery_cash'
            ? `Versement a la livraison ${delivery?.reference ?? s.reference}`
            : isDelivery
              ? `Reglement ${delivery?.reference ?? s.reference}`
              : `Paiement facture ${s.reference}`,
          debitId: s.id,
          debitKind: isDelivery ? 'delivery' : 'sale',
        });
      });
    });

  // ---- bons de livraison sans facture (base pas encore a jour) -------------
  const invoiced = new Set(input.sales.map((s) => s.deliveryId).filter(Boolean) as string[]);
  input.deliveries
    .filter((d) => commandById.has(d.commandId) && !invoiced.has(d.id))
    .forEach((d) => {
      const cmd = commandById.get(d.commandId);
      const lines: LedgerLine[] = d.items.map((it) => {
        const line = cmd?.items.find(
          (x) => (it.commandItemId && x.id === it.commandItemId) || x.productName === it.productName
        );
        const unitPrice = line?.unitPrice ?? 0;
        return {
          designation: it.productName, quantity: it.quantity, unit: it.sellUnit,
          unitPrice, amount: r2(it.quantity * unitPrice),
        };
      });
      const ht = r2(d.totalHt || lines.reduce((s, l) => s + l.amount, 0));
      const ttc = r2(d.totalTtc || ht);
      debits.push({
        id: d.id, kind: 'delivery', date: day(d.deliveredAt), amount: ttc, ht, tva: r2(ttc - ht),
        tvaRate: d.tvaRate, tvaEnabled: !!d.tvaEnabled,
        label: d.reference, reference: d.reference, historical: !!d.isHistorical,
        location: d.location || cmd?.clientAddress || '', restNow: r2(d.restAmount ?? 0), lines,
      });
      if ((d.cashPaid ?? 0) > 0) {
        credits.push({
          id: `${d.id}-cash`, kind: 'docPayment', date: day(d.deliveredAt), amount: r2(d.cashPaid ?? 0),
          label: `Versement a la livraison ${d.reference}`, debitId: d.id, debitKind: 'delivery',
        });
      }
    });

  // ---- argent recu au titre des commandes, a sa date ------------------------
  myCommands.forEach((c) => {
    if ((c.advancePaid ?? 0) > 0) {
      credits.push({
        id: `${c.id}-advance`, kind: 'advance', date: day(c.createdAt),
        amount: r2(c.advancePaid), label: `Acompte commande ${c.reference}`,
      });
    }
    const dated = c.payments ?? [];
    dated.forEach((p) =>
      credits.push({
        id: p.id, kind: 'commandPayment', date: day(p.date),
        amount: r2(p.amount), label: `Reglement commande ${c.reference}`,
      })
    );
    // base pas encore a jour : les reglements n'ont pas de date propre
    const undated = (c.extraPaid ?? 0) - dated.reduce((s, p) => s + p.amount, 0);
    if (undated > 0.004) {
      credits.push({
        id: `${c.id}-extra`, kind: 'commandPayment', date: day(c.createdAt),
        amount: r2(undated), label: `Reglement commande ${c.reference}`,
      });
    }
  });

  // ---- versements directs saisis sur la carte du client ---------------------
  input.payments
    .filter((p) => p.partyId === clientId)
    .forEach((p) =>
      credits.push({
        id: p.id, kind: 'payment', date: day(p.paidAt || p.date), amount: r2(p.amount),
        label: 'Versement', method: paymentMethodLabel(p),
      })
    );

  // ---- excedents rendus au client (sortie d'argent) -------------------------
  input.refunds
    .filter((r) => r.partyId === clientId)
    .forEach((r) =>
      credits.push({
        id: r.id, kind: 'refund', date: day(r.refundedAt || r.date), amount: -r2(r.amount),
        label: 'Excedent rendu au client', method: paymentMethodLabel(r),
      })
    );

  // ---- anciennes dettes -----------------------------------------------------
  input.oldDebts
    .filter((d) => d.partyId === clientId)
    .forEach((d) =>
      debits.push({
        id: d.id, kind: 'oldDebt', date: day(d.date), amount: r2(d.amount), ht: r2(d.amount), tva: 0,
        label: 'Ancienne dette', reference: 'ANCIENNE DETTE', description: d.description,
        restNow: r2(d.restAmount), lines: [],
      })
    );

  return { debits: debits.sort(byDate), credits: credits.sort(byDate) };
}

/* ---------------------------------------------------------- FOURNISSEUR */

export interface SupplierLedgerInput {
  supplierId: string;
  purchases: Purchase[];
  payments: PartyPayment[];
  refunds: PartyCreditRefund[];
  oldDebts: PartyOldDebt[];
}

export function buildSupplierLedger(input: SupplierLedgerInput): PartyLedger {
  const { supplierId } = input;
  const debits: LedgerDebit[] = [];
  const credits: LedgerCredit[] = [];

  input.purchases
    .filter((p) => p.supplierId === supplierId)
    .forEach((p) => {
      const lines: LedgerLine[] = p.products.map((l) => ({
        designation: (l.productName || 'Produit').trim(),
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.purchasePrice,
        amount: r2(l.quantity * l.purchasePrice),
      }));
      debits.push({
        id: p.id, kind: 'purchase', date: day(p.date), amount: r2(p.totalAmount), ht: r2(p.totalAmount),
        tva: 0, label: p.reference, reference: p.reference, historical: !!p.isHistorical,
        bonNumber: p.bonNumber || '', driverPlate: p.driverPlate || '',
        restNow: r2(p.restAmount), lines,
      });
      (p.payments ?? []).forEach((x, i) => {
        if (!(x.amount > 0)) return;
        credits.push({
          id: x.id ?? `${p.id}-p${i}`, kind: 'docPayment', date: day(x.date || p.date),
          amount: r2(x.amount),
          label: p.bonNumber ? `Reglement facture ${p.reference} (bon ${p.bonNumber})` : `Reglement facture ${p.reference}`,
          debitId: p.id, debitKind: 'purchase',
        });
      });
    });

  input.payments
    .filter((p) => p.partyId === supplierId)
    .forEach((p) =>
      credits.push({
        id: p.id, kind: 'payment', date: day(p.paidAt || p.date), amount: r2(p.amount),
        label: 'Versement', method: paymentMethodLabel(p),
      })
    );

  input.refunds
    .filter((r) => r.partyId === supplierId)
    .forEach((r) =>
      credits.push({
        id: r.id, kind: 'refund', date: day(r.refundedAt || r.date), amount: -r2(r.amount),
        label: 'Excedent recupere du fournisseur', method: paymentMethodLabel(r),
      })
    );

  input.oldDebts
    .filter((d) => d.partyId === supplierId)
    .forEach((d) =>
      debits.push({
        id: d.id, kind: 'oldDebt', date: day(d.date), amount: r2(d.amount), ht: r2(d.amount), tva: 0,
        label: 'Ancienne dette', reference: 'ANCIENNE DETTE', description: d.description,
        restNow: r2(d.restAmount), lines: [],
      })
    );

  return { debits: debits.sort(byDate), credits: credits.sort(byDate) };
}

/* ------------------------------------------------------------ LA PERIODE */

export interface LedgerFilter {
  /** Types d'opérations retenues (ex. seulement les bons de livraison). */
  debitKinds: DebitKind[];
  /**
   * L'argent retenu : versements directs et excédents rendus toujours ; les
   * encaissements portés par une facture seulement si son type est retenu ;
   * l'argent des commandes seulement si les bons de livraison le sont.
   */
  includeCommandMoney?: boolean;
}

export interface LedgerSlice {
  from: string;
  to: string;
  /** Opérations − argent AVANT la période (dette antérieure ; négatif = acompte). */
  priorBalance: number;
  priorDebitsTotal: number;
  priorCreditsTotal: number;
  /** Anciennes dettes datées avant la période (détail de l'alerte). */
  priorOldDebts: LedgerDebit[];
  debits: LedgerDebit[];
  credits: LedgerCredit[];
  totalDebits: number;
  totalCredits: number;
  /** totalDebits − totalCredits (sans la dette antérieure). */
  rest: number;
  /** priorBalance + rest : le solde du compte au dernier jour de la période. */
  closingBalance: number;
}

function keepCredit(c: LedgerCredit, filter: LedgerFilter): boolean {
  if (c.kind === 'payment' || c.kind === 'refund') return true;
  if (c.kind === 'advance' || c.kind === 'commandPayment') {
    return filter.includeCommandMoney ?? filter.debitKinds.includes('delivery');
  }
  return !!c.debitKind && filter.debitKinds.includes(c.debitKind);
}

/** Découpe le relevé sur [from, to] (bornes incluses). */
export function sliceLedger(ledger: PartyLedger, from: string, to: string, filter: LedgerFilter): LedgerSlice {
  const debits = ledger.debits.filter((d) => filter.debitKinds.includes(d.kind));
  const credits = ledger.credits.filter((c) => keepCredit(c, filter));

  const before = (d: string) => !!from && d < from;
  const inside = (d: string) => (!from || d >= from) && (!to || d <= to);

  const priorDebits = debits.filter((d) => before(d.date));
  const priorCredits = credits.filter((c) => before(c.date));
  const pDebits = debits.filter((d) => inside(d.date));
  const pCredits = credits.filter((c) => inside(c.date));

  const sum = (a: number[]) => r2(a.reduce((x, y) => x + y, 0));
  const priorDebitsTotal = sum(priorDebits.map((d) => d.amount));
  const priorCreditsTotal = sum(priorCredits.map((c) => c.amount));
  const totalDebits = sum(pDebits.map((d) => d.amount));
  const totalCredits = sum(pCredits.map((c) => c.amount));
  const priorBalance = r2(priorDebitsTotal - priorCreditsTotal);
  const rest = r2(totalDebits - totalCredits);

  return {
    from, to,
    priorBalance, priorDebitsTotal, priorCreditsTotal,
    priorOldDebts: priorDebits.filter((d) => d.kind === 'oldDebt'),
    debits: pDebits, credits: pCredits,
    totalDebits, totalCredits, rest,
    closingBalance: r2(priorBalance + rest),
  };
}

/** Une ligne du relevé chronologique (opération ou argent) avec le solde courant. */
/** L'enregistrement d'origine d'une ligne du releve — pour la voir / la modifier. */
export interface LedgerSource {
  side: 'debit' | 'credit';
  kind: DebitKind | CreditKind;
  id: string;
  /** Encaissement porte par une facture : la facture elle-meme. */
  debitId?: string;
  debitKind?: DebitKind;
}

export interface LedgerRow {
  source: LedgerSource;
  date: string;
  type: 'debit' | 'credit';
  label: string;
  detail?: string;
  debit: number;
  credit: number;
  balance: number;
}

/** Relevé chronologique : opérations et argent mêlés, solde courant. */
export function ledgerRows(slice: LedgerSlice, startBalance = 0): LedgerRow[] {
  const events: Omit<LedgerRow, 'balance'>[] = [
    ...slice.debits.map((d) => ({
      source: { side: 'debit' as const, kind: d.kind, id: d.id },
      date: d.date,
      type: 'debit' as const,
      label: d.kind === 'oldDebt'
        ? `Ancienne dette${d.description ? ` — ${d.description}` : ''}`
        : d.kind === 'delivery' ? `Bon de livraison ${d.reference}`
        : d.kind === 'purchase' ? `Facture ${d.reference}${d.bonNumber ? ` · bon ${d.bonNumber}` : ''}`
        : `Vente ${d.reference}`,
      detail: d.lines.map((l) => `${l.designation} ${l.quantity}${l.unit ? ` ${l.unit}` : ''}`).join(' · ') || undefined,
      debit: d.amount,
      credit: 0,
    })),
    ...slice.credits.map((c) => ({
      source: { side: 'credit' as const, kind: c.kind, id: c.id, debitId: c.debitId, debitKind: c.debitKind },
      date: c.date,
      type: 'credit' as const,
      label: c.label,
      detail: c.method,
      debit: 0,
      credit: c.amount,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'debit' ? -1 : 1));

  let running = startBalance;
  return events.map((e) => {
    running = r2(running + e.debit - e.credit);
    return { ...e, balance: running };
  });
}
