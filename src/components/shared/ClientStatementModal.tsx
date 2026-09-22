import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FileBarChart, Printer, ShoppingBag, Coins, ClipboardList, RotateCcw, Package,
  History, Undo2, PiggyBank, Truck, ScissorsSquare, LayoutGrid,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PeriodPicker, firstDayOfMonth } from './PeriodReport';
import { StatementPrintDialog, type StatementPrintChoice } from './StatementPrintDialog';
import { useSalesStore } from '@/store/salesStore';
import { useClientStore } from '@/store/clientStore';
import { useCommandStore, deliveryStatus } from '@/store/commandStore';
import { useClientDebtStore } from '@/store/clientDebtStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import {
  formatCurrency, formatDate, formatDateTime, todayISO, paymentMethodLabel,
} from '@/lib/utils';
import { computePartyBalance } from '@/lib/partyBalance';
import { netCommandTotals, commandTtc } from '@/lib/commandBilling';
import { buildClientHistory, withinPeriod, type HistoryPayment } from '@/lib/partyHistory';
import { printPartyStatement, type StatementSection } from '@/lib/statementPrint';
import { printDeliveryPeriodReport, type DeliveryPeriodLine } from '@/lib/documents';
import { panelVariants, EASE } from '@/lib/animations';
import { cn } from '@/lib/utils';
import type { Client } from '@/types';

/* ============================================================================
 *  COMPTE RENDU D'UN CLIENT SUR UNE PERIODE
 * ----------------------------------------------------------------------------
 *  NOUVELLE PRESENTATION. L'ecran ne deroule plus une longue colonne de
 *  tableaux : il affiche une barre de synthese, puis UNE PARTIE A LA FOIS,
 *  choisie dans une barre d'onglets — exactement les memes parties que la
 *  fenetre « Historique » :
 *
 *      Ventes · Commandes · Livraisons · Versements · Anciennes ventes ·
 *      Anciennes commandes · Anciennes livraisons · Anciennes dettes ·
 *      Excedents rendus · Annulations et augmentations · Produits
 *
 *  A L'IMPRESSION, l'operateur choisit dans une LISTE A COCHER les parties a
 *  faire figurer sur le document et les PRODUITS a detailler, puis dit s'il
 *  applique la TVA. Le document sort sur le modele du bon de livraison.
 *
 *  LES VERSEMENTS viennent de `buildClientHistory()` — la meme source que la
 *  fenetre « Historique ». Un versement supprime dans l'historique disparait
 *  donc du compte rendu : c'est la correction du bug « le versement supprime
 *  continue d'etre compte ».
 * ========================================================================== */

type PartKey =
  | 'sales' | 'commands' | 'deliveries' | 'payments' | 'oldSales' | 'oldCommands'
  | 'oldDeliveries' | 'oldDebts' | 'refunds' | 'adjustments' | 'products';

/** Noms des produits d'une facture, repris en designation (comme a l'impression). */
const productNames = (products: { productName?: string }[]) =>
  products.map((l) => (l.productName || '—').trim()).filter(Boolean).join(', ') || '—';
/** Quantite totale d'une facture (comme a l'impression). */
const productQty = (products: { quantity?: number }[]) =>
  Number(products.reduce((s, l) => s + (l.quantity || 0), 0).toFixed(3)).toLocaleString('fr-FR');

export function ClientStatementModal({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { language } = useLanguage();
  const sales = useSalesStore((s) => s.sales);
  const payments = useClientStore((s) => s.payments);
  const clientRows = useClientStore((s) => s.clients);
  const oldDebts = useClientStore((s) => s.oldDebts);
  const refunds = useClientStore((s) => s.refunds);
  const commands = useCommandStore((s) => s.commands);
  const deliveries = useCommandStore((s) => s.deliveries);
  const adjustments = useCommandStore((s) => s.adjustments);
  const debts = useClientDebtStore((s) => s.debts);
  const settings = useSettingsStore((s) => s.settings);

  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [part, setPart] = useState<PartKey>('sales');
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    if (!client) return;
    setFrom(firstDayOfMonth());
    setTo(todayISO());
    setPeriod(null);
    setPart('sales');
    setPrintOpen(false);
  }, [client?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------------------- donnees -- */
  const data = useMemo(() => {
    if (!client || !period) return null;
    const { from: f, to: t } = period;
    const h = buildClientHistory({
      clientId: client.id,
      sales, commands, deliveries, payments, oldDebts, refunds, debts, adjustments,
    });

    const inP = (d?: string) => withinPeriod(d, f, t);

    const salesList = h.sales.filter((s) => inP(s.date)).sort((a, b) => a.date.localeCompare(b.date));
    const oldSalesList = h.historicalSales.filter((s) => inP(s.date));
    const commandsList = h.commands
      .filter((c) => inP(c.receiveDate) || inP(c.createdAt))
      .sort((a, b) => (a.receiveDate || a.createdAt).localeCompare(b.receiveDate || b.createdAt));
    const oldCommandsList = h.historicalCommands.filter((c) => inP(c.receiveDate) || inP(c.createdAt));
    const deliveriesList = h.deliveries.filter((d) => inP(d.delivery.deliveredAt));
    const oldDeliveriesList = h.historicalDeliveries.filter((d) => inP(d.delivery.deliveredAt));
    // Le compte rendu ne retient QUE les reglements directs saisis sur la
    // carte du client — les encaissements portes par une vente, un bon de
    // livraison, une dette ou un acompte n'y figurent plus.
    const paymentsList = h.payments
      .filter((p) => inP(p.date) && p.source === 'direct')
      .sort((a, b) => a.date.localeCompare(b.date));
    const oldDebtsList = h.oldDebts.filter((d) => inP(d.date));
    const refundsList = h.refunds.filter((r) => inP(r.refundedAt));
    const adjustmentsList = h.adjustments.filter((a) => inP(a.date));

    /* ---- MARCHANDISES DE LA PERIODE -------------------------------------
     * Une ligne par produit ET par prix pratique. On ne compte JAMAIS deux
     * fois la meme marchandise : chaque bon de livraison a deja cree une
     * facture de vente qui porte les produits remis, les commandes n'apportent
     * donc que leur part ENCORE A LIVRER. */
    const grouped = new Map<string, {
      key: string; name: string; unit?: string; quantity: number; unitPrice: number;
      amount: number; soldQty: number; orderedQty: number; deliveredQty: number;
    }>();
    const push = (
      name: string, unit: string | undefined, quantity: number, unitPrice: number,
      kind: 'sold' | 'ordered' | 'delivered'
    ) => {
      if (!(quantity > 0)) return;
      const key = `${name.trim().toLowerCase()}|${unit ?? ''}|${unitPrice}`;
      const cur = grouped.get(key) ?? {
        key, name: name.trim(), unit, quantity: 0, unitPrice, amount: 0,
        soldQty: 0, orderedQty: 0, deliveredQty: 0,
      };
      cur.quantity += quantity;
      cur.amount += quantity * unitPrice;
      if (kind === 'sold') cur.soldQty += quantity;
      if (kind === 'ordered') cur.orderedQty += quantity;
      if (kind === 'delivered') cur.deliveredQty += quantity;
      grouped.set(key, cur);
    };
    [...salesList, ...oldSalesList].forEach((s) =>
      s.products.forEach((pr) => push(pr.productName || '—', pr.unit, pr.quantity, pr.sellingPrice, 'sold'))
    );
    [...commandsList, ...oldCommandsList].forEach((c) =>
      c.items.forEach((it) => {
        const remaining = Math.max(
          0, it.quantity - (it.deliveredQuantity ?? 0) - (it.cancelledQuantity ?? 0)
        );
        push(it.productName || '—', it.sellByUnit ? it.sellUnit : undefined, remaining, it.unitPrice, 'ordered');
      })
    );
    deliveriesList.forEach((d) =>
      d.delivery.items.forEach((it) => {
        const line = d.command?.items.find(
          (x) => (it.commandItemId && x.id === it.commandItemId) || x.productName === it.productName
        );
        const cur = grouped.get(
          `${(it.productName || '—').trim().toLowerCase()}|${it.sellUnit ?? ''}|${line?.unitPrice ?? 0}`
        );
        if (cur) cur.deliveredQty += it.quantity;
      })
    );
    const products = [...grouped.values()].sort((a, b) => b.amount - a.amount);

    /* ---- Livraisons eclatees ligne a ligne (bon de livraison periode) ---- */
    const deliveryLines: DeliveryPeriodLine[] = [...deliveriesList, ...oldDeliveriesList].flatMap((h2) =>
      h2.delivery.items.map((it) => {
        const line = h2.command?.items.find(
          (x) => (it.commandItemId && x.id === it.commandItemId) || x.productName === it.productName
        );
        const unitPrice = line?.unitPrice ?? 0;
        return {
          date: h2.delivery.deliveredAt.slice(0, 10),
          location: h2.delivery.location || h2.command?.clientAddress || '—',
          designation: it.productName,
          quantity: it.quantity,
          unit: it.sellUnit,
          unitPrice,
          amount: it.quantity * unitPrice,
        };
      })
    );

    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    const salesTotal = sum(salesList.map((s) => s.finalAmount));
    const salesPaid = sum(salesList.map((s) => s.paidAmount));
    const salesRest = sum(salesList.map((s) => s.restAmount));
    const oldSalesTotal = sum(oldSalesList.map((s) => s.finalAmount));
    const netCmd = netCommandTotals(commandsList, sales);
    const collected = sum(paymentsList.map((p) => p.amount));
    const refunded = sum(refundsList.map((r) => r.amount));
    const oldDebtsTotal = sum(oldDebtsList.map((d) => d.amount));
    const oldDebtsRest = sum(oldDebtsList.map((d) => d.restAmount));

    /* ---- SITUATION ACTUELLE DU COMPTE (toutes periodes confondues) ------ */
    const allSales = sales.filter((x) => x.clientId === client.id);
    const allCommands = commands.filter((x) => x.clientId === client.id);
    const netAll = netCommandTotals(allCommands, allSales);
    const account = computePartyBalance({
      documentsBilled: sum(allSales.map((x) => x.finalAmount)) + netAll.billed,
      documentsPaid: sum(allSales.map((x) => x.paidAmount)) + netAll.paid,
      documentsRest: sum(allSales.map((x) => x.restAmount)) + netAll.rest,
      oldDebts: oldDebts.filter((d) => d.partyId === client.id),
      credit: clientRows.find((c) => c.id === client.id)?.creditAmount ?? 0,
    });

    return {
      salesList, oldSalesList, commandsList, oldCommandsList,
      deliveriesList, oldDeliveriesList, paymentsList, oldDebtsList, refundsList,
      adjustmentsList, products, deliveryLines,
      salesTotal, salesPaid, salesRest, oldSalesTotal,
      commandsTotal: netCmd.billed, commandsPaid: netCmd.paid, commandsRest: netCmd.rest,
      deliveriesTotal: sum(deliveriesList.map((d) => d.amountHt)),
      collected, refunded, oldDebtsTotal, oldDebtsRest,
      account,
      billed: salesTotal + netCmd.billed + oldDebtsTotal,
      netCollected: collected - refunded,
      outstanding: salesRest + netCmd.rest + oldDebtsRest,
      tvaCollected: sum(salesList.map((s) => s.tvaAmount || 0)),
      salesHT: sum(salesList.map((s) => Math.max(0, s.totalAmount - s.reduction))),
    };
  }, [client, period, sales, commands, deliveries, payments, debts, oldDebts, refunds, clientRows, adjustments]);

  const periodLabel = period
    ? `Du ${formatDate(period.from, language)} au ${formatDate(period.to, language)}`
    : '';

  /* ------------------------------------------------------- l'impression -- */
  const doPrint = (choice: StatementPrintChoice) => {
    if (!client || !data || !period) return;
    setPrintOpen(false);

    const money = formatCurrency;
    const picked = new Set(choice.parts);
    const sections: StatementSection[] = [];

    if (picked.has('sales') && data.salesList.length) {
      sections.push({
        title: 'VENTES DE LA PERIODE',
        columns: [
          { label: 'Date', align: 'center', width: '13%' },
          { label: 'Designation', align: 'left' },
          { label: 'Quantite', align: 'center', width: '10%' },
          { label: 'Paye', align: 'right', width: '18%' },
          { label: 'Total', align: 'right', width: '18%' },
        ],
        rows: data.salesList.map((s) => ({
          cells: [
            formatDate(s.date), productNames(s.products).toUpperCase(), productQty(s.products),
            money(s.paidAmount), money(s.finalAmount),
          ],
        })),
        totals: [{ label: 'Total des ventes', value: money(data.salesTotal), strong: true }],
      });
    }

    if (picked.has('commands') && data.commandsList.length) {
      sections.push({
        title: 'COMMANDES DE LA PERIODE',
        columns: [
          { label: 'Date', align: 'center', width: '13%' },
          { label: 'Designation', align: 'left' },
          { label: 'Quantite', align: 'center', width: '12%' },
          { label: 'Livre', align: 'center', width: '12%' },
          { label: 'Total TTC', align: 'right', width: '18%' },
        ],
        rows: data.commandsList.map((c) => {
          const st = deliveryStatus(c);
          return {
            cells: [
              formatDate(c.receiveDate || c.createdAt.slice(0, 10)),
              `COMMANDE ${c.reference}`, st.ordered, st.delivered, money(commandTtc(c)),
            ],
          };
        }),
        totals: [{ label: 'Total des commandes', value: money(data.commandsTotal), strong: true }],
      });
    }

    if (picked.has('deliveries') && data.deliveryLines.length) {
      sections.push({
        title: 'LIVRAISONS DE LA PERIODE',
        columns: [
          { label: 'Date', align: 'center', width: '12%' },
          { label: 'Designation', align: 'left' },
          { label: 'Adresse de livraison', align: 'left', width: '22%' },
          { label: 'Quantite', align: 'center', width: '11%' },
          { label: 'P.T H.T', align: 'right', width: '18%' },
        ],
        rows: data.deliveryLines.map((l) => ({
          cells: [
            formatDate(l.date), l.designation.toUpperCase(),
            (l.location || '/').toUpperCase(), l.quantity, money(l.amount),
          ],
        })),
        totals: [{
          label: 'Total livre H.T',
          value: money(data.deliveryLines.reduce((s, l) => s + l.amount, 0)),
          strong: true,
        }],
      });
    }

    if (picked.has('payments') && data.paymentsList.length) {
      sections.push({
        title: 'VERSEMENTS DE LA PERIODE',
        columns: [
          { label: 'Date', align: 'center', width: '16%' },
          { label: 'Designation', align: 'left' },
          { label: 'Mode', align: 'left', width: '22%' },
          { label: 'Montant', align: 'right', width: '20%' },
        ],
        rows: data.paymentsList.map((p) => ({
          cells: [
            formatDate(p.date.slice(0, 10)), p.origin.toUpperCase(),
            p.source === 'direct' ? paymentMethodLabel(p).toUpperCase() : '/',
            money(p.amount),
          ],
        })),
        totals: [{ label: 'Total verse', value: money(data.collected), strong: true }],
      });
    }

    const oldSalesAndCommands: { title: string; rows: (string | number)[][]; total: number }[] = [];
    if (picked.has('oldSales') && data.oldSalesList.length) {
      oldSalesAndCommands.push({
        title: 'ANCIENNES VENTES',
        rows: data.oldSalesList.map((s) => [
          formatDate(s.date), productNames(s.products).toUpperCase(), productQty(s.products),
          formatCurrency(s.paidAmount), formatCurrency(s.finalAmount),
        ]),
        total: data.oldSalesTotal,
      });
    }
    if (picked.has('oldCommands') && data.oldCommandsList.length) {
      oldSalesAndCommands.push({
        title: 'ANCIENNES COMMANDES',
        rows: data.oldCommandsList.map((c) => [
          formatDate(c.receiveDate || c.createdAt.slice(0, 10)),
          `ANCIENNE COMMANDE ${c.reference}`, deliveryStatus(c).ordered,
          formatCurrency(c.paidAmount), formatCurrency(commandTtc(c)),
        ]),
        total: data.oldCommandsList.reduce((s, c) => s + commandTtc(c), 0),
      });
    }
    oldSalesAndCommands.forEach((s) =>
      sections.push({
        title: s.title,
        columns: [
          { label: 'Date', align: 'center', width: '13%' },
          { label: 'Designation', align: 'left' },
          { label: 'Quantite', align: 'center', width: '10%' },
          { label: 'Paye', align: 'right', width: '18%' },
          { label: 'Total', align: 'right', width: '18%' },
        ],
        rows: s.rows.map((cells) => ({ cells })),
        totals: [{ label: 'Total', value: money(s.total), strong: true }],
      })
    );

    if (picked.has('oldDeliveries') && data.oldDeliveriesList.length) {
      sections.push({
        title: 'ANCIENNES LIVRAISONS',
        columns: [
          { label: 'Date', align: 'center', width: '13%' },
          { label: 'Designation', align: 'left' },
          { label: 'Quantite', align: 'center', width: '12%' },
          { label: 'P.T H.T', align: 'right', width: '20%' },
        ],
        rows: data.oldDeliveriesList.map((h2) => ({
          cells: [
            formatDate(h2.delivery.deliveredAt.slice(0, 10)),
            `BON ${h2.delivery.reference}`, h2.quantity, money(h2.amountHt),
          ],
        })),
        totals: [{
          label: 'Total',
          value: money(data.oldDeliveriesList.reduce((s, h2) => s + h2.amountHt, 0)),
          strong: true,
        }],
      });
    }

    if (picked.has('oldDebts') && data.oldDebtsList.length) {
      sections.push({
        title: 'ANCIENNES DETTES',
        columns: [
          { label: 'Date', align: 'center', width: '16%' },
          { label: 'Designation', align: 'left' },
          { label: 'Regle', align: 'right', width: '20%' },
          { label: 'Reste', align: 'right', width: '20%' },
        ],
        rows: data.oldDebtsList.map((d) => ({
          cells: [
            formatDate(d.date), (d.description || 'ANCIENNE DETTE').toUpperCase(),
            money(d.paidAmount), money(d.restAmount),
          ],
        })),
        totals: [{ label: 'Total reste du', value: money(data.oldDebtsRest), strong: true }],
      });
    }

    if (picked.has('refunds') && data.refundsList.length) {
      sections.push({
        title: 'EXCEDENTS RENDUS AU CLIENT',
        columns: [
          { label: 'Date', align: 'center', width: '16%' },
          { label: 'Designation', align: 'left' },
          { label: 'Mode', align: 'left', width: '22%' },
          { label: 'Montant', align: 'right', width: '20%' },
        ],
        rows: data.refundsList.map((r) => ({
          cells: [
            formatDate(r.refundedAt.slice(0, 10)),
            `REMBOURSEMENT EXC-${r.id.slice(0, 8).toUpperCase()}`,
            paymentMethodLabel(r).toUpperCase(), money(r.amount),
          ],
        })),
        totals: [{ label: 'Total rendu', value: money(data.refunded), strong: true }],
      });
    }

    if (picked.has('adjustments') && data.adjustmentsList.length) {
      sections.push({
        title: 'ANNULATIONS ET AUGMENTATIONS DE COMMANDE',
        columns: [
          { label: 'Date', align: 'center', width: '13%' },
          { label: 'Designation', align: 'left' },
          { label: 'Operation', align: 'center', width: '16%' },
          { label: 'Quantite', align: 'center', width: '12%' },
          { label: 'Valeur H.T', align: 'right', width: '18%' },
        ],
        rows: data.adjustmentsList.map((a) => ({
          cells: [
            formatDate(a.date),
            `${a.commandReference ?? 'COMMANDE'} — ${a.lines.map((l) => l.productName).join(', ').toUpperCase()}`,
            a.type === 'cancel' ? 'ANNULATION' : 'AUGMENTATION',
            `${a.type === 'cancel' ? '-' : '+'}${a.totalQuantity}`,
            `${a.type === 'cancel' ? '-' : '+'}${money(a.totalAmount)}`,
          ],
        })),
      });
    }

    // Les produits coches forment le tableau principal (les marchandises).
    const productLines = choice.includeProducts
      ? data.products
          .filter((p) => choice.products.includes(p.key))
          .map((p) => ({
            designation: p.name,
            quantity: p.quantity,
            unit: p.unit,
            unitPrice: p.unitPrice,
            amount: p.amount,
          }))
      : [];

    const ht = productLines.reduce((s, l) => s + l.amount, 0);
    const tva = choice.applyTva ? Math.round(ht * choice.tvaRate) / 100 : 0;

    printPartyStatement(
      {
        kind: 'client',
        party: {
          name: client.name, phone: client.phone, address: client.address,
          rc: client.rc, nif: client.nif, nis: client.nis, article: client.article,
        },
        from: period.from,
        to: period.to,
        productTitle: productLines.length ? 'MARCHANDISES DE LA PERIODE' : undefined,
        productLines,
        sections,
        applyTva: choice.applyTva,
        tvaRate: choice.tvaRate,
        tvaAmount: tva,
        paidAmount: data.collected,
        restAmount: data.outstanding + tva,
        // Chaque versement de la periode, a sa date — repris en bas a gauche.
        versements: data.paymentsList.map((p) => ({
          amount: p.amount,
          date: p.date.slice(0, 10),
        })),
      },
      settings
    );
  };

  /** Rapport de livraisons « Livraison du … au … ». */
  const doPrintDeliveries = () => {
    if (!client || !data || !period) return;
    printDeliveryPeriodReport(
      {
        client: {
          name: client.name, phone: client.phone, address: client.address,
          rc: client.rc, nif: client.nif, nis: client.nis, article: client.article,
        },
        from: period.from,
        to: period.to,
        lines: data.deliveryLines,
        applyTva: data.deliveriesList.some((d) => d.delivery.tvaEnabled),
        tvaRate: data.deliveriesList.find((d) => d.delivery.tvaEnabled)?.delivery.tvaRate ?? 19,
        versements: data.deliveriesList
          .filter((d) => (d.delivery.cashPaid ?? 0) > 0)
          .map((d) => ({ amount: d.delivery.cashPaid ?? 0, date: d.delivery.deliveredAt.slice(0, 10) })),
        paidAmount: data.deliveriesList.reduce((s, d) => s + (d.delivery.paidAmount ?? 0), 0),
        restAmount: data.deliveriesList.reduce((s, d) => s + (d.delivery.restAmount ?? 0), 0),
      },
      settings
    );
  };

  /* ------------------------------------------------------------ rendu ---- */
  const parts: { key: PartKey; label: string; icon: JSX.Element; count: number; total?: string }[] = data
    ? [
        { key: 'sales', label: 'Ventes', icon: <ShoppingBag size={14} />, count: data.salesList.length, total: formatCurrency(data.salesTotal) },
        { key: 'commands', label: 'Commandes', icon: <ClipboardList size={14} />, count: data.commandsList.length, total: formatCurrency(data.commandsTotal) },
        { key: 'deliveries', label: 'Livraisons', icon: <Truck size={14} />, count: data.deliveriesList.length, total: formatCurrency(data.deliveriesTotal) },
        { key: 'payments', label: 'Versements', icon: <Coins size={14} />, count: data.paymentsList.length, total: formatCurrency(data.collected) },
        { key: 'oldSales', label: 'Anciennes ventes', icon: <History size={14} />, count: data.oldSalesList.length, total: formatCurrency(data.oldSalesTotal) },
        { key: 'oldCommands', label: 'Anciennes commandes', icon: <History size={14} />, count: data.oldCommandsList.length },
        { key: 'oldDeliveries', label: 'Anciennes livraisons', icon: <History size={14} />, count: data.oldDeliveriesList.length },
        { key: 'oldDebts', label: 'Anciennes dettes', icon: <PiggyBank size={14} />, count: data.oldDebtsList.length, total: formatCurrency(data.oldDebtsTotal) },
        { key: 'refunds', label: 'Excédents rendus', icon: <Undo2 size={14} />, count: data.refundsList.length, total: formatCurrency(data.refunded) },
        { key: 'adjustments', label: 'Annulations / augm.', icon: <ScissorsSquare size={14} />, count: data.adjustmentsList.length },
        { key: 'products', label: 'Produits', icon: <Package size={14} />, count: data.products.length },
      ]
    : [];

  return (
    <Modal open={!!client} onClose={onClose} title={`Compte rendu — ${client?.name ?? ''}`} size="xl">
      {client && (
        <div className="space-y-5">
          <PeriodPicker
            from={from}
            to={to}
            onChange={(f, t) => { setFrom(f); setTo(t); setPeriod(null); }}
            onGenerate={() => setPeriod({ from, to })}
          />

          {!data ? (
            <div className="rounded-2xl border border-dashed border-gold/25 bg-vanilla/20 py-10 text-center">
              <FileBarChart size={34} className="mx-auto mb-3 text-gold opacity-60" />
              <p className="text-sm text-text-muted">
                Choisissez une date de début et une date de fin, puis générez le compte rendu.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* ---------------------------------------------- en-tete ---- */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-display text-base font-semibold text-text-primary">{client.name}</p>
                  <p className="text-xs text-text-muted">{periodLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPeriod(null)}>
                    <RotateCcw size={14} /> Changer la période
                  </Button>
                  <Button size="sm" variant="secondary" onClick={doPrintDeliveries}>
                    <Truck size={14} /> Bon de livraisons (période)
                  </Button>
                  <Button size="sm" variant="gold" onClick={() => setPrintOpen(true)}>
                    <Printer size={14} /> Imprimer le compte rendu
                  </Button>
                </div>
              </div>

              {data.account.hasCredit && (
                <div className="flex items-start gap-3 rounded-2xl border border-pistachio/40 bg-pistachio/10 px-4 py-3">
                  <PiggyBank size={20} className="mt-0.5 shrink-0 text-pistachio" />
                  <div>
                    <p className="text-sm font-bold text-pistachio">
                      Solde en faveur du client : + {formatCurrency(data.account.creditToReturn)}
                    </p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {client.name} a versé plus que sa dette. Utilisez « Rendre l&rsquo;excédent » sur sa carte.
                    </p>
                  </div>
                </div>
              )}

              {/* ------------------------------------------- synthèse ------ */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                <Kpi label="Total facturé" value={formatCurrency(data.billed)} tone="accent" />
                <Kpi label="Total encaissé" value={formatCurrency(data.collected)} tone="pos" />
                <Kpi label="Excédent rendu" value={formatCurrency(data.refunded)} tone="neg" />
                <Kpi label="Reste dû (période)" value={formatCurrency(data.outstanding)} tone="neg" />
                <Kpi label="Ventes HT" value={formatCurrency(data.salesHT)} />
                <Kpi label="TVA collectée" value={formatCurrency(data.tvaCollected)} tone="accent" />
              </div>

              {/* --------------------------------------- barre des parties -- */}
              <div className="flex gap-1 overflow-x-auto rounded-2xl border border-gold/15 bg-vanilla/30 p-1.5">
                {parts.map((p) => {
                  const on = p.key === part;
                  return (
                    <button
                      key={p.key}
                      onClick={() => setPart(p.key)}
                      className={cn(
                        'relative flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-colors',
                        on ? 'text-white' : 'text-text-secondary hover:bg-gold/10 hover:text-text-primary'
                      )}
                    >
                      {on && (
                        <motion.span
                          layoutId="statement-part"
                          transition={{ duration: 0.18, ease: EASE }}
                          className="absolute inset-0 rounded-xl bg-gradient-button shadow-gold"
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-1.5">
                        {p.icon}{p.label}
                        <span className={cn(
                          'rounded-full px-1.5 text-[10px] font-bold tabular',
                          on ? 'bg-white/25 text-white' : 'bg-gold/15 text-gold-dark'
                        )}>
                          {p.count}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* ------------------------------------------- la partie ----- */}
              <AnimatePresence mode="wait">
                <motion.div key={part} variants={panelVariants} initial="hidden" animate="visible" exit="exit">
                  {part === 'sales' && (
                    <Section
                      title="Ventes de la période"
                      head={['N° facture', 'Date', 'Désignation', 'Quantité', 'TVA', 'Total', 'Payé', 'Reste']}
                      rows={data.salesList.map((s) => [
                        s.reference,
                        formatDate(s.date, language),
                        productNames(s.products),
                        productQty(s.products),
                        s.tvaEnabled ? formatCurrency(s.tvaAmount || 0) : '—',
                        formatCurrency(s.finalAmount),
                        <span key="p" className="text-pistachio">{formatCurrency(s.paidAmount)}</span>,
                        <span key="r" className={s.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>
                          {formatCurrency(s.restAmount)}
                        </span>,
                      ])}
                      total={formatCurrency(data.salesTotal)}
                      empty="Aucune vente sur cette période"
                    />
                  )}

                  {part === 'commands' && (
                    <Section
                      title="Commandes de la période"
                      head={['N° commande', 'Livraison prévue', 'État', 'Commandé', 'Livré', 'Annulé', 'Total TTC', 'Reste']}
                      rows={data.commandsList.map((c) => {
                        const st = deliveryStatus(c);
                        return [
                          c.reference,
                          c.receiveDate ? formatDate(c.receiveDate, language) : '—',
                          <Badge key="d" variant={st.isFull ? 'success' : st.isPartial ? 'warning' : 'danger'} className="text-[10px]">
                            {st.isFull ? 'Livrée' : st.isPartial ? `${st.percent.toFixed(0)} %` : 'Non livrée'}
                          </Badge>,
                          st.ordered, st.delivered, st.cancelled,
                          formatCurrency(commandTtc(c)),
                          <span key="r" className={c.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>
                            {formatCurrency(c.restAmount)}
                          </span>,
                        ];
                      })}
                      total={formatCurrency(data.commandsTotal)}
                      empty="Aucune commande sur cette période"
                    />
                  )}

                  {part === 'deliveries' && (
                    <Section
                      title="Livraisons de la période"
                      note="Chaque bon de livraison éclaté par date, localisation et produit."
                      head={['Date', 'Localisation', 'Désignation', 'Quantité', 'P.U', 'Montant']}
                      rows={data.deliveryLines.map((l) => [
                        formatDate(l.date, language), l.location || '—', l.designation,
                        `${l.quantity}${l.unit ? ` ${l.unit}` : ''}`,
                        formatCurrency(l.unitPrice),
                        <span key="a" className="font-bold text-gold-dark">{formatCurrency(l.amount)}</span>,
                      ])}
                      total={formatCurrency(data.deliveryLines.reduce((s, l) => s + l.amount, 0))}
                      empty="Aucune livraison sur cette période"
                    />
                  )}

                  {part === 'payments' && (
                    <Section
                      title="Versements de la période"
                      note="Uniquement les versements directs saisis sur la carte du client. C'est exactement cette liste qui est imprimée en bas du compte rendu."
                      head={['Date et heure', 'Origine', 'Mode de règlement', 'Note', 'Montant']}
                      rows={data.paymentsList.map((p: HistoryPayment) => [
                        formatDateTime(p.date, language),
                        p.origin,
                        paymentMethodLabel(p),
                        p.notes || '—',
                        <span key="a" className="font-bold text-pistachio">{formatCurrency(p.amount)}</span>,
                      ])}
                      total={formatCurrency(data.collected)}
                      empty="Aucun versement sur cette période"
                    />
                  )}

                  {part === 'oldSales' && (
                    <Section
                      title="Anciennes ventes"
                      note="Ventes antérieures au logiciel — ni le stock ni la caisse ne les ont vues passer."
                      head={['N° facture', 'Date', 'Articles', 'Total', 'Payé', 'Reste']}
                      rows={data.oldSalesList.map((s) => [
                        s.reference, formatDate(s.date, language), s.products.length,
                        formatCurrency(s.finalAmount),
                        <span key="p" className="text-pistachio">{formatCurrency(s.paidAmount)}</span>,
                        <span key="r" className="text-rose-deep">{formatCurrency(s.restAmount)}</span>,
                      ])}
                      total={formatCurrency(data.oldSalesTotal)}
                      empty="Aucune ancienne vente sur cette période"
                    />
                  )}

                  {part === 'oldCommands' && (
                    <Section
                      title="Anciennes commandes"
                      head={['N° commande', 'Date', 'Commandé', 'Livré', 'Total TTC', 'Reste']}
                      rows={data.oldCommandsList.map((c) => {
                        const st = deliveryStatus(c);
                        return [
                          c.reference, formatDate(c.createdAt.slice(0, 10), language),
                          st.ordered, st.delivered, formatCurrency(commandTtc(c)),
                          <span key="r" className="text-rose-deep">{formatCurrency(c.restAmount)}</span>,
                        ];
                      })}
                      total={formatCurrency(data.oldCommandsList.reduce((s, c) => s + commandTtc(c), 0))}
                      empty="Aucune ancienne commande sur cette période"
                    />
                  )}

                  {part === 'oldDeliveries' && (
                    <Section
                      title="Anciennes livraisons"
                      head={['N° BL', 'Date', 'Commande', 'Quantité', 'Total H.T']}
                      rows={data.oldDeliveriesList.map((h2) => [
                        h2.delivery.reference,
                        formatDate(h2.delivery.deliveredAt.slice(0, 10), language),
                        h2.command?.reference ?? '—',
                        h2.quantity,
                        formatCurrency(h2.amountHt),
                      ])}
                      total={formatCurrency(data.oldDeliveriesList.reduce((s, h2) => s + h2.amountHt, 0))}
                      empty="Aucune ancienne livraison sur cette période"
                    />
                  )}

                  {part === 'oldDebts' && (
                    <Section
                      title="Anciennes dettes"
                      note="Ardoises antérieures au logiciel — aucune écriture de caisse à leur saisie."
                      head={['Date', 'Description', 'Montant', 'Réglé', 'Reste']}
                      rows={data.oldDebtsList.map((d) => [
                        formatDate(d.date, language), d.description || '—',
                        formatCurrency(d.amount),
                        <span key="p" className="text-pistachio">{formatCurrency(d.paidAmount)}</span>,
                        <span key="r" className={d.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>
                          {formatCurrency(d.restAmount)}
                        </span>,
                      ])}
                      total={formatCurrency(data.oldDebtsTotal)}
                      empty="Aucune ancienne dette sur cette période"
                    />
                  )}

                  {part === 'refunds' && (
                    <Section
                      title="Excédents rendus au client"
                      head={['Date et heure', 'Reçu n°', 'Mode de règlement', 'Note', 'Montant rendu']}
                      rows={data.refundsList.map((r) => [
                        formatDateTime(r.refundedAt, language),
                        `EXC-${r.id.slice(0, 8).toUpperCase()}`,
                        paymentMethodLabel(r), r.notes || '—',
                        <span key="a" className="font-bold text-caramel">− {formatCurrency(r.amount)}</span>,
                      ])}
                      total={formatCurrency(data.refunded)}
                      empty="Aucun excédent rendu sur cette période"
                    />
                  )}

                  {part === 'adjustments' && (
                    <Section
                      title="Annulations et augmentations de commande"
                      note="Le client a renoncé au solde d'une commande, ou en a redemandé."
                      head={['Date', 'Commande', 'Opération', 'Produits', 'Quantité', 'Valeur H.T', 'Motif']}
                      rows={data.adjustmentsList.map((a) => [
                        formatDate(a.date, language),
                        a.commandReference ?? '—',
                        <Badge key="t" variant={a.type === 'cancel' ? 'danger' : 'success'} className="text-[10px]">
                          {a.type === 'cancel' ? 'Annulation' : 'Augmentation'}
                        </Badge>,
                        a.lines.map((l) => l.productName).join(' · '),
                        `${a.type === 'cancel' ? '−' : '+'}${a.totalQuantity}`,
                        <span key="v" className={a.type === 'cancel' ? 'font-bold text-rose-deep' : 'font-bold text-pistachio'}>
                          {a.type === 'cancel' ? '−' : '+'}{formatCurrency(a.totalAmount)}
                        </span>,
                        a.reason || '—',
                      ])}
                      empty="Aucune annulation ni augmentation sur cette période"
                    />
                  )}

                  {part === 'products' && (
                    <Section
                      title="Produits de la période"
                      note="Une ligne par produit ET par prix pratiqué — c'est la base du tableau imprimé."
                      head={['Produit', 'Qté vendue', 'Qté commandée', 'Qté livrée', 'Quantité', 'Prix U', 'Montant H.T']}
                      rows={data.products.map((p) => {
                        const u = p.unit ? ` ${p.unit}` : '';
                        return [
                          p.name, `${p.soldQty}${u}`, `${p.orderedQty}${u}`, `${p.deliveredQty}${u}`,
                          `${p.quantity}${u}`, formatCurrency(p.unitPrice),
                          <span key="a" className="font-bold text-gold-dark">{formatCurrency(p.amount)}</span>,
                        ];
                      })}
                      total={formatCurrency(data.products.reduce((s, p) => s + p.amount, 0))}
                      empty="Aucun produit sur cette période"
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          )}

          {/* --------------------------- liste à cocher avant impression --- */}
          {data && (
            <StatementPrintDialog
              open={printOpen}
              onClose={() => setPrintOpen(false)}
              onPrint={doPrint}
              title={`Imprimer le compte rendu — ${client.name}`}
              parts={parts
                .filter((p) => p.key !== 'products')
                .map((p) => ({
                  key: p.key,
                  label: p.label,
                  count: p.count,
                  total: p.total,
                  defaultChecked: p.count > 0,
                }))}
              products={data.products.map((p) => ({
                key: p.key,
                label: p.name,
                detail: `${p.quantity}${p.unit ? ` ${p.unit}` : ''} × ${formatCurrency(p.unitPrice)}`,
                amount: p.amount,
              }))}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' | 'accent' }) {
  const color = tone === 'pos' ? 'text-pistachio' : tone === 'neg' ? 'text-rose-deep'
    : tone === 'accent' ? 'text-gold-dark' : 'text-text-primary';
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2.5">
      <p className="text-[10px] uppercase leading-tight tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular ${color}`}>{value}</p>
    </div>
  );
}

function Section({
  title, note, head, rows, total, empty,
}: {
  title: string;
  note?: string;
  head: string[];
  rows: React.ReactNode[][];
  total?: string;
  empty: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-xl border-l-4 border-gold bg-gold/8 px-3 py-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-gold-dark">
          <LayoutGrid size={14} />{title}
        </h4>
        {total && <span className="text-sm font-bold tabular text-gold-dark">{total}</span>}
      </div>
      {note && <p className="px-1 text-[11px] italic text-text-muted">{note}</p>}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gold/25 bg-vanilla/20 py-6 text-center text-xs italic text-text-muted">
          {empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gold/15">
          <table className="w-full text-sm">
            <thead className="bg-vanilla/60 text-text-secondary">
              <tr>
                {head.map((h, i) => (
                  <th key={h} className={`whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase ${i === 0 ? 'text-left' : 'text-right'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gold/10 hover:bg-gold/5">
                  {r.map((cell, j) => (
                    <td key={j} className={`px-3 py-2 text-xs ${j === 0 ? 'text-left' : 'text-right tabular'}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
