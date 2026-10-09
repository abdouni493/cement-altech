import type { Purchase, Sale, PartyOldDebt, PartyCreditRefund, CommandAdjustment } from '@/types';
import { formatCurrency, formatDate, paymentMethodLabel } from './utils';
import { commandTtc } from './commandBilling';
import { deliveryStatus, type Command } from '@/store/commandStore';
import { withinPeriod, type ClientHistory, type SupplierHistory, type HistoryDelivery, type HistoryPayment } from './partyHistory';
import type { DocColumn, DocTable } from './officialDoc';

/* ============================================================================
 *  PARTIES DE L'HISTORIQUE A JOINDRE AU COMPTE RENDU IMPRIME
 * ----------------------------------------------------------------------------
 *  Chaque onglet de l'historique d'un tiers (ventes, commandes, livraisons,
 *  versements, acompte, anciennes ventes...) devient un tableau facultatif,
 *  limite a la periode du compte rendu. L'operateur coche ceux qu'il veut
 *  voir sur le papier ; ce sont des tableaux d'INFORMATION : ils ne changent
 *  ni le total, ni le reste du compte rendu.
 * ========================================================================== */

export interface HistoryPrintPart {
  key: string;
  label: string;
  count: number;
  total?: string;
  table: DocTable;
  /** Variantes « payes » / « non payes » (livraisons, commandes). */
  paidVariants?: { paid: HistoryPrintPart; unpaid: HistoryPrintPart };
}

/** Les tableaux a joindre selon les cles cochees (« h:deliveries », « h:deliveries:paid », « ...:unpaid »). */
export function selectedHistoryTables(parts: HistoryPrintPart[], keys: string[] = []): DocTable[] {
  const out: DocTable[] = [];
  parts.forEach((h) => {
    if (keys.includes(h.key)) out.push(h.table);
    else if (h.paidVariants && keys.includes(`${h.key}:paid`)) out.push(h.paidVariants.paid.table);
    else if (h.paidVariants && keys.includes(`${h.key}:unpaid`)) out.push(h.paidVariants.unpaid.table);
  });
  return out;
}

const deliveryIsPaid = (h: HistoryDelivery) => {
  const d = h.delivery;
  const rest = d.restAmount ?? ((d.totalTtc ?? h.amountHt) - (d.paidAmount ?? 0));
  return rest <= 0.004;
};
const commandIsPaid = (c: Command) => commandTtc(c) - (c.paidAmount ?? 0) <= 0.004;

function withPaidVariants<T>(
  list: T[], isPaid: (x: T) => boolean, build: (l: T[], suffix: string) => HistoryPrintPart,
): HistoryPrintPart {
  return {
    ...build(list, ''),
    paidVariants: {
      paid: build(list.filter(isPaid), ' (payes)'),
      unpaid: build(list.filter((x) => !isPaid(x)), ' (non payes)'),
    },
  };
}

export interface CreditUsePrintRow {
  date: string;
  label: string;
  documentTotal: number;
  amount: number;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const day = (d: string) => formatDate(d.slice(0, 10));
const up = (s: string | undefined) => (s || '/').toUpperCase();
const byDate = <T,>(list: T[], of: (x: T) => string) => [...list].sort((a, b) => of(a).localeCompare(of(b)));

function part(
  key: string, label: string, columns: DocColumn[], rows: (string | number)[][],
  totalLabel?: string, total?: number,
): HistoryPrintPart {
  return {
    key, label, count: rows.length,
    total: total !== undefined ? formatCurrency(total) : undefined,
    table: {
      title: label,
      columns,
      rows: rows.map((cells) => ({ cells })),
      totals: totalLabel && total !== undefined ? [{ label: totalLabel, value: formatCurrency(total), strong: true }] : undefined,
      emptyLabel: 'Aucune ligne sur la periode',
    },
  };
}

const saleCols: DocColumn[] = [
  { label: 'Date', align: 'center', width: '13%' },
  { label: 'Designation', align: 'left' },
  { label: 'Paye', align: 'right', width: '17%' },
  { label: 'Reste', align: 'right', width: '17%' },
  { label: 'Total', align: 'right', width: '17%' },
];
const saleRows = (l: Sale[]) => byDate(l, (s) => s.date).map((s) => [
  day(s.date), `FACTURE ${s.reference} — ${s.products.map((p) => p.productName).join(', ').toUpperCase()}`,
  formatCurrency(s.paidAmount), formatCurrency(s.restAmount), formatCurrency(s.finalAmount),
]);

const commandCols: DocColumn[] = [
  { label: 'Date', align: 'center', width: '12%' },
  { label: 'Designation', align: 'left' },
  { label: 'Commande', align: 'center', width: '10%' },
  { label: 'Livre', align: 'center', width: '9%' },
  { label: 'Paye', align: 'right', width: '16%' },
  { label: 'Total TTC', align: 'right', width: '17%' },
];
const commandRows = (l: Command[]) => byDate(l, (c) => c.createdAt).map((c) => {
  const st = deliveryStatus(c);
  return [
    day(c.createdAt), `COMMANDE ${c.reference} — ${c.items.map((i) => i.productName).join(', ').toUpperCase()}`,
    st.ordered, st.delivered, formatCurrency(c.paidAmount), formatCurrency(commandTtc(c)),
  ];
});

const deliveryCols: DocColumn[] = [
  { label: 'Date', align: 'center', width: '12%' },
  { label: 'Designation', align: 'left' },
  { label: 'Adresse de livraison', align: 'left', width: '22%' },
  { label: 'Quantite', align: 'center', width: '10%' },
  { label: 'P.T H.T', align: 'right', width: '17%' },
];
const deliveryRows = (l: HistoryDelivery[]) => byDate(l, (h) => h.delivery.deliveredAt).map((h) => [
  day(h.delivery.deliveredAt),
  `BL ${h.delivery.reference} — ${h.delivery.items.map((i) => i.productName).join(', ').toUpperCase()}`,
  up(h.delivery.location || h.command?.clientAddress), h.quantity, formatCurrency(h.amountHt),
]);

const paymentCols: DocColumn[] = [
  { label: 'Date', align: 'center', width: '14%' },
  { label: 'Designation', align: 'left' },
  { label: 'Mode', align: 'left', width: '22%' },
  { label: 'Montant', align: 'right', width: '18%' },
];
const paymentRows = (l: HistoryPayment[]) => byDate(l, (p) => p.date).map((p) => [
  day(p.date), up(p.origin), up(paymentMethodLabel(p)), formatCurrency(p.amount),
]);

const oldDebtCols: DocColumn[] = [
  { label: 'Date', align: 'center', width: '14%' },
  { label: 'Designation', align: 'left' },
  { label: 'Montant', align: 'right', width: '17%' },
  { label: 'Regle', align: 'right', width: '17%' },
  { label: 'Reste', align: 'right', width: '17%' },
];
const oldDebtRows = (l: PartyOldDebt[]) => byDate(l, (d) => d.date).map((d) => [
  day(d.date), (d.description || 'ANCIENNE DETTE').toUpperCase(),
  formatCurrency(d.amount), formatCurrency(d.paidAmount), formatCurrency(d.restAmount),
]);

const refundCols: DocColumn[] = [
  { label: 'Date', align: 'center', width: '14%' },
  { label: 'Designation', align: 'left' },
  { label: 'Mode', align: 'left', width: '22%' },
  { label: 'Montant', align: 'right', width: '18%' },
];
const refundRows = (l: PartyCreditRefund[], what: string) => byDate(l, (r) => r.refundedAt).map((r) => [
  day(r.refundedAt), `${what}${r.notes ? ` — ${r.notes}` : ''}`.toUpperCase(),
  up(paymentMethodLabel(r)), formatCurrency(r.amount),
]);

const creditCols: DocColumn[] = [
  { label: 'Date', align: 'center', width: '14%' },
  { label: 'Document paye', align: 'left' },
  { label: 'Total du document', align: 'right', width: '20%' },
  { label: 'Paye par le compte', align: 'right', width: '20%' },
];
const creditRows = (l: CreditUsePrintRow[]) => byDate(l, (r) => r.date).map((r) => [
  day(r.date), r.label.toUpperCase(), formatCurrency(r.documentTotal), formatCurrency(r.amount),
]);

const adjustmentCols: DocColumn[] = [
  { label: 'Date', align: 'center', width: '12%' },
  { label: 'Designation', align: 'left' },
  { label: 'Operation', align: 'center', width: '16%' },
  { label: 'Quantite', align: 'center', width: '11%' },
  { label: 'Valeur H.T', align: 'right', width: '18%' },
];
const adjustmentRows = (l: CommandAdjustment[]) => byDate(l, (a) => a.date).map((a) => {
  const s = a.type === 'cancel' ? '-' : '+';
  return [
    day(a.date),
    `${a.commandReference ?? 'COMMANDE'} — ${a.lines.map((x) => x.productName).join(', ').toUpperCase()}`,
    a.type === 'cancel' ? 'ANNULATION' : 'AUGMENTATION',
    `${s}${a.totalQuantity}`, `${s}${formatCurrency(a.totalAmount)}`,
  ];
});

/** Les onglets de l'historique d'un client, limites a la periode. */
export function clientHistoryPrintParts(
  h: ClientHistory, creditUses: CreditUsePrintRow[], from: string, to: string,
): HistoryPrintPart[] {
  const inP = (d?: string) => withinPeriod(d, from, to);
  const sales = h.sales.filter((s) => inP(s.date));
  const commands = h.commands.filter((c) => inP(c.createdAt));
  const deliveries = h.deliveries.filter((x) => inP(x.delivery.deliveredAt));
  const payments = h.payments.filter((p) => p.source === 'direct' && inP(p.date));
  const credit = creditUses.filter((r) => inP(r.date));
  const oldSales = h.historicalSales.filter((s) => inP(s.date));
  const oldCommands = h.historicalCommands.filter((c) => inP(c.createdAt));
  const oldDeliveries = h.historicalDeliveries.filter((x) => inP(x.delivery.deliveredAt));
  const oldDebts = h.oldDebts.filter((d) => inP(d.date));
  const refunds = h.refunds.filter((r) => inP(r.refundedAt));
  const adjustments = h.adjustments.filter((a) => inP(a.date));
  return [
    part('h:sales', 'Ventes', saleCols, saleRows(sales), 'Total des ventes', sum(sales.map((s) => s.finalAmount))),
    withPaidVariants(commands, commandIsPaid, (l, sfx) =>
      part('h:commands', `Commandes${sfx}`, commandCols, commandRows(l), 'Total des commandes', sum(l.map(commandTtc)))),
    withPaidVariants(deliveries, deliveryIsPaid, (l, sfx) =>
      part('h:deliveries', `Livraisons${sfx}`, deliveryCols, deliveryRows(l), 'Total livre H.T', sum(l.map((x) => x.amountHt)))),
    part('h:payments', 'Versements', paymentCols, paymentRows(payments), 'Total verse', sum(payments.map((p) => p.amount))),
    part('h:credit', 'Acompte & imputations', creditCols, creditRows(credit), 'Total impute', sum(credit.map((r) => r.amount))),
    part('h:oldSales', 'Anciennes ventes', saleCols, saleRows(oldSales), 'Total', sum(oldSales.map((s) => s.finalAmount))),
    withPaidVariants(oldCommands, commandIsPaid, (l, sfx) =>
      part('h:oldCommands', `Anciennes commandes${sfx}`, commandCols, commandRows(l), 'Total', sum(l.map(commandTtc)))),
    withPaidVariants(oldDeliveries, deliveryIsPaid, (l, sfx) =>
      part('h:oldDeliveries', `Anciennes livraisons${sfx}`, deliveryCols, deliveryRows(l), 'Total H.T', sum(l.map((x) => x.amountHt)))),
    part('h:oldDebts', 'Anciennes dettes', oldDebtCols, oldDebtRows(oldDebts), 'Total reste du', sum(oldDebts.map((d) => d.restAmount))),
    part('h:refunds', 'Excedents rendus', refundCols, refundRows(refunds, 'Excedent rendu'), 'Total rendu', sum(refunds.map((r) => r.amount))),
    part('h:adjustments', 'Annulations / augmentations', adjustmentCols, adjustmentRows(adjustments)),
  ];
}

const purchaseCols: DocColumn[] = [
  { label: 'Date', align: 'center', width: '12%' },
  { label: 'N de bon', align: 'center', width: '12%' },
  { label: 'Designation', align: 'left' },
  { label: 'Regle', align: 'right', width: '16%' },
  { label: 'Reste', align: 'right', width: '16%' },
  { label: 'Total', align: 'right', width: '16%' },
];
const purchaseRows = (l: Purchase[]) => byDate(l, (p) => p.date).map((p) => [
  day(p.date), up(p.bonNumber),
  `FACTURE ${p.reference} — ${p.products.map((x) => x.productName).join(', ').toUpperCase()}`,
  formatCurrency(p.paidAmount), formatCurrency(p.restAmount), formatCurrency(p.totalAmount),
]);

/** Les onglets de l'historique d'un fournisseur, limites a la periode. */
export function supplierHistoryPrintParts(h: SupplierHistory, from: string, to: string): HistoryPrintPart[] {
  const inP = (d?: string) => withinPeriod(d, from, to);
  const purchases = h.purchases.filter((p) => inP(p.date));
  const payments = h.payments.filter((p) => p.source === 'direct' && inP(p.date));
  const credit: CreditUsePrintRow[] = h.purchases.concat(h.historicalPurchases)
    .filter((p) => (p.allocatedAmount ?? 0) > 0.004 && inP(p.date))
    .map((p) => ({ date: p.date, label: `Facture ${p.reference}`, documentTotal: p.totalAmount, amount: p.allocatedAmount ?? 0 }));
  const oldPurchases = h.historicalPurchases.filter((p) => inP(p.date));
  const oldDebts = h.oldDebts.filter((d) => inP(d.date));
  const refunds = h.refunds.filter((r) => inP(r.refundedAt));
  return [
    part('h:purchases', 'Achats', purchaseCols, purchaseRows(purchases), 'Total des achats', sum(purchases.map((p) => p.totalAmount))),
    part('h:payments', 'Versements', paymentCols, paymentRows(payments), 'Total regle', sum(payments.map((p) => p.amount))),
    part('h:credit', 'Trop-verse & imputations', creditCols, creditRows(credit), 'Total impute', sum(credit.map((r) => r.amount))),
    part('h:oldPurchases', 'Anciens achats', purchaseCols, purchaseRows(oldPurchases), 'Total', sum(oldPurchases.map((p) => p.totalAmount))),
    part('h:oldDebts', 'Anciennes dettes', oldDebtCols, oldDebtRows(oldDebts), 'Total reste du', sum(oldDebts.map((d) => d.restAmount))),
    part('h:refunds', 'Excedents recuperes', refundCols, refundRows(refunds, 'Excedent recupere'), 'Total recupere', sum(refunds.map((r) => r.amount))),
  ];
}
