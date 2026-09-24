import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  TrendingUp, FileText, Printer, Wallet, ShoppingCart, Banknote, Package,
  Receipt, Truck, Users, HardHat, Coins, History, ClipboardList,
  ScissorsSquare, Undo2, PiggyBank, FlaskConical, ListChecks, CheckSquare,
  Square, LayoutGrid, Building2, Factory, Layers, Scale, Calculator, AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { useLanguage } from '@/hooks/useLanguage';
import { useSalesStore } from '@/store/salesStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useExpenseStore } from '@/store/expenseStore';
import { useProductionStore } from '@/store/productionStore';
import { useComptoirStore } from '@/store/comptoirStore';
import { useStockStore } from '@/store/stockStore';
import { useClientStore } from '@/store/clientStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useClientDebtStore } from '@/store/clientDebtStore';
import { useWorkerStore } from '@/store/workerStore';
import { useCaisseStore } from '@/store/caisseStore';
import { useCommandStore, deliveryStatus } from '@/store/commandStore';
import { useCaisseReportStore } from '@/store/caisseReportStore';
import { useSettingsStore } from '@/store/settingsStore';
import { formatCurrency, formatDate, formatDateTime, todayISO, paymentMethodLabel } from '@/lib/utils';
import { commandTtc, netCommandTotals } from '@/lib/commandBilling';
import { buildClientHistory, buildSupplierHistory, withinPeriod } from '@/lib/partyHistory';
import { printListDocument, periodSuffix } from '@/lib/statementPrint';
import {
  DocTitlePicker, initialDocTitleChoice, resolvedDocTitle, resolvedPeriodPrefix, type DocTitleChoice,
} from '@/components/shared/DocTitlePicker';
import { PrintTitleDialog, type PrintTitleRequest } from '@/components/shared/PrintTitleDialog';
import { VersementChecklist } from '@/components/shared/VersementChecklist';
import { EntryEditor, type EntryRequest, type EntryTarget } from '@/components/shared/entries/EntryEditor';
import { EntryActions } from '@/components/shared/entries/EntryActions';
import type { HistoryPayment } from '@/lib/partyHistory';
import { panelVariants, EASE } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { groupByParty, type ReportPart, type ReportStat } from './reportParts';
import { DebtsOverview } from './DebtsOverview';
import { GainsBreakdown } from './GainsBreakdown';
import type { DocColumn, DocRow } from '@/lib/officialDoc';
import type { PartyOldDebt } from '@/types';

/* ============================================================================
 *  RAPPORT GENERAL
 * ----------------------------------------------------------------------------
 *  L'operateur choisit une DATE DE DEBUT et une DATE DE FIN, puis l'ecran
 *  presente l'activite de la periode PARTIE PAR PARTIE, regroupees en trois
 *  familles :
 *
 *    CLIENTS      ventes · commandes · livraisons · versements ·
 *                 anciennes ventes · anciennes commandes ·
 *                 anciennes livraisons · anciennes dettes ·
 *                 annulations et augmentations de commande
 *    FOURNISSEURS achats · versements · anciens achats · anciennes dettes
 *    ENTREPRISE   depenses · employes · caisse · productions
 *
 *  Chaque partie a son bouton « Imprimer cette partie », et le bouton du haut
 *  imprime le RAPPORT GENERAL apres une LISTE A COCHER. Tous les documents
 *  sortent sur le modele du bon de livraison (colonne DATE, colonne
 *  DESIGNATION, montants a droite, totaux accroches aux deux dernieres
 *  colonnes) — il n'y a plus de tableau de resume en tete du document.
 *
 *  Les listes qui portent un nom de client ou de fournisseur sont GROUPEES par
 *  tiers (Client1, Client1, Client2, Client2...) et non dispersees.
 * ========================================================================== */

const GROUPS: { key: ReportPart['group']; label: string; icon: JSX.Element }[] = [
  { key: 'clients', label: 'Clients', icon: <Users size={15} /> },
  { key: 'suppliers', label: 'Fournisseurs', icon: <Truck size={15} /> },
  { key: 'company', label: 'Entreprise', icon: <Building2 size={15} /> },
];

const DATE_COL: DocColumn = { label: 'Date', align: 'center', width: '12%' };
const DESIGNATION_COL: DocColumn = { label: 'Designation', align: 'left' };

export default function ReportsPage() {
  const { t, language } = useLanguage();
  const sales = useSalesStore((s) => s.sales);
  const purchases = usePurchaseStore((s) => s.purchases);
  const expenses = useExpenseStore((s) => s.expenses);
  const productions = useProductionStore((s) => s.productions);
  const destructions = useComptoirStore((s) => s.destructions);
  const products = useStockStore((s) => s.products);
  const clients = useClientStore((s) => s.clients);
  const clientPayments = useClientStore((s) => s.payments);
  const clientOldDebts = useClientStore((s) => s.oldDebts);
  const clientRefunds = useClientStore((s) => s.refunds);
  const suppliers = useSupplierStore((s) => s.suppliers);
  const supplierPayments = useSupplierStore((s) => s.payments);
  const supplierOldDebts = useSupplierStore((s) => s.oldDebts);
  const supplierRefunds = useSupplierStore((s) => s.refunds);
  const debts = useClientDebtStore((s) => s.debts);
  const workers = useWorkerStore((s) => s.workers);
  const transactions = useCaisseStore((s) => s.transactions);
  const initialBalance = useCaisseStore((s) => s.initialBalance);
  const commands = useCommandStore((s) => s.commands);
  const deliveries = useCommandStore((s) => s.deliveries);
  const adjustments = useCommandStore((s) => s.adjustments);
  const caisseReports = useCaisseReportStore((s) => s.reports);
  const settings = useSettingsStore((s) => s.settings);

  const firstOfMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [group, setGroup] = useState<ReportPart['group']>('clients');
  const [active, setActive] = useState('sales');
  const [printOpen, setPrintOpen] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  /** Versements masques a l'impression (toujours comptes dans les totaux). */
  const [hiddenPay, setHiddenPay] = useState<string[]>([]);
  // la fenetre d'impression d'une partie lit toujours le choix courant
  const hiddenPayRef = useRef<string[]>([]);
  hiddenPayRef.current = hiddenPay;
  const setHiddenPayAndRef = (next: string[]) => { hiddenPayRef.current = next; setHiddenPay(next); };
  const [generalTitle, setGeneralTitle] = useState<DocTitleChoice>(() =>
    initialDocTitleChoice('RAPPORT GENERAL', 'PERIODE'));
  const [titleRequest, setTitleRequest] = useState<PrintTitleRequest | null>(null);
  /** Ligne du rapport ouverte en consultation / modification. */
  const [entry, setEntry] = useState<EntryRequest | null>(null);
  /** Anciennes dettes datees AVANT la periode : on demande avant d'imprimer. */
  const [oldDebtAsk, setOldDebtAsk] = useState<
    { clients: PartyOldDebt[]; suppliers: PartyOldDebt[]; run: (include: boolean) => void } | null
  >(null);

  const money = formatCurrency;

  /** Versement d'une liste -> enregistrement a voir / modifier. */
  const paymentTarget = (p: HistoryPayment, party: 'client' | 'supplier'): EntryTarget | null => {
    if (p.source === 'direct') return { kind: 'payment', id: p.payment?.id ?? p.id, party };
    if (p.source === 'document' && p.documentId) {
      if (party === 'supplier') return { kind: 'purchase', id: p.documentId };
      return sales.some((s) => s.id === p.documentId)
        ? { kind: 'sale', id: p.documentId }
        : { kind: 'delivery', id: p.documentId };
    }
    if (p.source === 'advance' && p.documentId) {
      return p.id.endsWith('-advance')
        ? { kind: 'advance', commandId: p.documentId }
        : { kind: 'command', id: p.documentId };
    }
    return null;
  };
  const commandTarget = (c: { id: string; advancePaid?: number }): EntryTarget =>
    (c.advancePaid ?? 0) > 0 ? { kind: 'advance', commandId: c.id } : { kind: 'command', id: c.id };
  const nameOfClient = (id: string | null) => (id ? clients.find((c) => c.id === id)?.name || 'Client inconnu' : 'Client passager');
  const addressOfClient = (id: string | null) => (id ? clients.find((c) => c.id === id)?.address || '—' : '—');
  const nameOfSupplier = (id: string) => suppliers.find((s) => s.id === id)?.name || 'Fournisseur inconnu';

  /* ======================================================================= */
  /*  CONSTRUCTION DES PARTIES                                               */
  /* ======================================================================= */
  const parts = useMemo<ReportPart[]>(() => {
    if (!period) return [];
    const { from: f, to: t2 } = period;
    const inP = (d?: string) => withinPeriod(d, f, t2);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const list: ReportPart[] = [];

    /* ------------------------------------------------------- CLIENTS ---- */

    // Historique unifie de CHAQUE client : c'est lui qui garantit que les
    // versements affiches ici sont EXACTEMENT ceux de la fiche du client.
    const clientHistories = clients.map((c) => ({
      client: c,
      h: buildClientHistory({
        clientId: c.id,
        sales, commands, deliveries, payments: clientPayments,
        oldDebts: clientOldDebts, refunds: clientRefunds, debts, adjustments,
      }),
    }));

    // ---- 1. VENTES (avec la colonne ADRESSE demandee) ----
    const rSales = groupByParty(
      sales.filter((s) => !s.isHistorical && inP(s.date)),
      (s) => nameOfClient(s.clientId),
      (s) => s.date
    );
    list.push({
      key: 'sales', group: 'clients', label: 'Ventes', icon: <Receipt size={15} />,
      note: "Factures de caisse ET factures nées d'un bon de livraison, groupées par client.",
      count: rSales.length,
      total: money(sum(rSales.map((s) => s.finalAmount))),
      stats: [
        { label: 'Factures', value: String(rSales.length) },
        { label: 'Total facturé', value: money(sum(rSales.map((s) => s.finalAmount))), tone: 'accent' },
        { label: 'Total encaissé', value: money(sum(rSales.map((s) => s.paidAmount))), tone: 'pos' },
        { label: 'Reste dû', value: money(sum(rSales.map((s) => s.restAmount))), tone: 'neg' },
        { label: 'TVA collectée', value: money(sum(rSales.map((s) => s.tvaAmount || 0))), tone: 'accent' },
      ],
      columns: [
        { label: 'Client' }, { label: 'Adresse' }, { label: 'N° facture' }, { label: 'Date' },
        { label: 'Origine', align: 'center' }, { label: 'Articles', align: 'right' },
        { label: 'Total', align: 'right' }, { label: 'Payé', align: 'right' }, { label: 'Reste', align: 'right' },
      ],
      actions: rSales.map((s): EntryTarget => ({ kind: 'sale', id: s.id })),
      rows: rSales.map((s) => [
        <span key="c" className="font-semibold">{nameOfClient(s.clientId)}</span>,
        addressOfClient(s.clientId),
        s.reference,
        formatDate(s.date, language),
        <Badge key="o" variant={s.deliveryId ? 'info' : 'neutral'} className="text-[10px]">
          {s.deliveryId ? 'Livraison' : 'Caisse'}
        </Badge>,
        s.products.length,
        money(s.finalAmount),
        <span key="p" className="text-pistachio">{money(s.paidAmount)}</span>,
        <span key="r" className={s.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>
          {money(s.restAmount)}
        </span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Adresse', align: 'left', width: '20%' },
        { label: 'Paye', align: 'right', width: '17%' },
        { label: 'Total', align: 'right', width: '17%' },
      ],
      printRows: rSales.map((s): DocRow => ({
        cells: [
          formatDate(s.date),
          `${nameOfClient(s.clientId).toUpperCase()} — ${s.reference}`,
          addressOfClient(s.clientId).toUpperCase(),
          money(s.paidAmount),
          money(s.finalAmount),
        ],
      })),
      printTotalLabel: 'Total des ventes',
      printTotalValue: money(sum(rSales.map((s) => s.finalAmount))),
    });

    // ---- 2. COMMANDES ----
    const rCommands = groupByParty(
      commands.filter((c) => !c.isHistorical && (inP(c.createdAt) || inP(c.receiveDate))),
      (c) => c.clientName,
      (c) => c.createdAt
    );
    const cmdNet = netCommandTotals(rCommands, sales);
    list.push({
      key: 'commands', group: 'clients', label: 'Commandes', icon: <ClipboardList size={15} />,
      note: "Les commandes déjà livrées sont facturées par leurs bons : seule la part non encore livrée s'ajoute au chiffre d'affaires.",
      count: rCommands.length,
      total: money(sum(rCommands.map(commandTtc))),
      stats: [
        { label: 'Commandes', value: String(rCommands.length) },
        { label: 'Total TTC', value: money(sum(rCommands.map(commandTtc))), tone: 'accent' },
        { label: 'Non encore facturé', value: money(cmdNet.billed), tone: 'accent' },
        { label: 'Versé', value: money(sum(rCommands.map((c) => c.paidAmount))), tone: 'pos' },
        { label: 'Reste dû', value: money(sum(rCommands.map((c) => c.restAmount))), tone: 'neg' },
      ],
      columns: [
        { label: 'Client' }, { label: 'N° commande' }, { label: 'Créée le' }, { label: 'Livraison' },
        { label: 'Commandé', align: 'right' }, { label: 'Livré', align: 'right' },
        { label: 'Annulé', align: 'right' }, { label: 'Total TTC', align: 'right' },
        { label: 'Reste', align: 'right' },
      ],
      actions: rCommands.map(commandTarget),
      rows: rCommands.map((c) => {
        const st = deliveryStatus(c);
        return [
          <span key="c" className="font-semibold">{c.clientName}</span>,
          c.reference,
          formatDate(c.createdAt.slice(0, 10), language),
          c.receiveDate ? formatDate(c.receiveDate, language) : '—',
          st.ordered, st.delivered,
          <span key="x" className={st.cancelled > 0 ? 'font-bold text-rose-deep' : ''}>{st.cancelled}</span>,
          money(commandTtc(c)),
          <span key="r" className={c.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>
            {money(c.restAmount)}
          </span>,
        ];
      }),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Commande', align: 'center', width: '11%' },
        { label: 'Livre', align: 'center', width: '11%' },
        { label: 'Total TTC', align: 'right', width: '18%' },
      ],
      printRows: rCommands.map((c): DocRow => {
        const st = deliveryStatus(c);
        return {
          cells: [
            formatDate(c.createdAt.slice(0, 10)),
            `${c.clientName.toUpperCase()} — ${c.reference}`,
            st.ordered, st.delivered, money(commandTtc(c)),
          ],
        };
      }),
      printTotalLabel: 'Total des commandes',
      printTotalValue: money(sum(rCommands.map(commandTtc))),
    });

    // ---- 3. LIVRAISONS ----
    const commandById = new Map(commands.map((c) => [c.id, c]));
    // Les livraisons NOUVELLES et ANCIENNES forment un seul tableau.
    const rDeliveries = deliveries
      .filter((d) => inP(d.deliveredAt))
      .map((d) => ({ d, cmd: commandById.get(d.commandId) }));
    const deliveryLines = rDeliveries.flatMap(({ d, cmd }) =>
      d.items.map((it) => {
        const line = cmd?.items.find(
          (x) => (it.commandItemId && x.id === it.commandItemId) || x.productName === it.productName
        );
        return {
          deliveryId: d.id,
          date: d.deliveredAt.slice(0, 10),
          client: cmd?.clientName ?? '—',
          reference: d.reference,
          historical: !!d.isHistorical,
          location: d.location || cmd?.clientAddress || '—',
          designation: it.productName,
          quantity: it.quantity,
          unit: it.sellUnit,
          unitPrice: line?.unitPrice ?? 0,
          amount: it.quantity * (line?.unitPrice ?? 0),
        };
      })
    );
    const sortedDeliveryLines = groupByParty(deliveryLines, (l) => l.client, (l) => l.date);
    list.push({
      key: 'deliveries', group: 'clients', label: 'Livraisons', icon: <Truck size={15} />,
      note: 'Chaque bon de livraison — nouveaux et anciens ensemble — éclaté ligne à ligne : date, lieu, produit, quantité et valeur.',
      count: rDeliveries.length,
      total: money(sum(deliveryLines.map((l) => l.amount))),
      stats: [
        { label: 'Bons de livraison', value: `${rDeliveries.length} (dont ${rDeliveries.filter(({ d }) => d.isHistorical).length} anciens)` },
        { label: 'Quantité remise', value: String(Math.round(sum(deliveryLines.map((l) => l.quantity)) * 1000) / 1000) },
        { label: 'Valeur H.T', value: money(sum(deliveryLines.map((l) => l.amount))), tone: 'accent' },
        { label: 'Encaissé', value: money(sum(rDeliveries.map(({ d }) => d.paidAmount ?? 0))), tone: 'pos' },
        { label: 'Reste dû', value: money(sum(rDeliveries.map(({ d }) => d.restAmount ?? 0))), tone: 'neg' },
      ],
      columns: [
        { label: 'Client' }, { label: 'N° BL' }, { label: 'Date' }, { label: 'Lieu' },
        { label: 'Désignation' }, { label: 'Quantité', align: 'right' },
        { label: 'P.U', align: 'right' }, { label: 'Montant', align: 'right' },
      ],
      actions: sortedDeliveryLines.map((l): EntryTarget => ({ kind: 'delivery', id: l.deliveryId })),
      rows: sortedDeliveryLines.map((l) => [
        <span key="c" className="font-semibold">{l.client}</span>,
        <span key="r">
          {l.reference}
          {l.historical && <Badge variant="warning" className="ml-1 text-[9px]">Ancienne</Badge>}
        </span>,
        formatDate(l.date, language),
        l.location,
        l.designation,
        `${l.quantity}${l.unit ? ` ${l.unit}` : ''}`,
        money(l.unitPrice),
        <span key="a" className="font-bold text-gold-dark">{money(l.amount)}</span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Adresse de livraison', align: 'left', width: '21%' },
        { label: 'Quantite', align: 'center', width: '11%' },
        { label: 'P.T H.T', align: 'right', width: '17%' },
      ],
      printRows: sortedDeliveryLines.map((l): DocRow => ({
        cells: [
          formatDate(l.date),
          `${l.client.toUpperCase()} — ${l.designation.toUpperCase()}${l.historical ? ' (ANCIENNE)' : ''}`,
          l.location.toUpperCase(),
          l.quantity,
          money(l.amount),
        ],
      })),
      printTotalLabel: 'Total livre H.T',
      printTotalValue: money(sum(deliveryLines.map((l) => l.amount))),
    });

    // ---- 4. VERSEMENTS CLIENTS ----
    const clientPaymentRows = groupByParty(
      clientHistories.flatMap(({ client, h }) =>
        h.payments.filter((p) => inP(p.date)).map((p) => ({ ...p, clientName: client.name }))
      ),
      (p) => p.clientName,
      (p) => p.date
    );
    list.push({
      key: 'clientPayments', group: 'clients', label: 'Versements clients', icon: <Coins size={15} />,
      note:
        "Tout l'argent reçu des clients : versement direct, versement sur une dette enregistrée, "
        + "encaissement porté par une vente ou un bon de livraison, acompte de commande. "
        + "C'est la même liste que celle de la fiche du client.",
      count: clientPaymentRows.length,
      total: money(sum(clientPaymentRows.map((p) => p.amount))),
      stats: [
        { label: 'Écritures', value: String(clientPaymentRows.length) },
        { label: 'Total encaissé', value: money(sum(clientPaymentRows.map((p) => p.amount))), tone: 'pos' },
        {
          label: 'Versements directs',
          value: money(sum(clientPaymentRows.filter((p) => p.source === 'direct').map((p) => p.amount))),
          tone: 'pos',
        },
        {
          label: 'Sur dettes enregistrées',
          value: money(sum(clientPaymentRows.filter((p) => p.source === 'debt').map((p) => p.amount))),
          tone: 'pos',
        },
        {
          label: 'Sur factures',
          value: money(sum(clientPaymentRows.filter((p) => p.source === 'document').map((p) => p.amount))),
          tone: 'pos',
        },
      ],
      columns: [
        { label: 'Client' }, { label: 'Date' }, { label: 'Origine' },
        { label: 'Type', align: 'center' }, { label: 'Mode' }, { label: 'Montant', align: 'right' },
      ],
      actions: clientPaymentRows.map((p) => paymentTarget(p, 'client')),
      versementItems: clientPaymentRows.map((p, i) => ({
        id: `c-${i}-${p.id}`, date: p.date, label: `${p.clientName} — ${p.origin}`, amount: p.amount,
      })),
      rows: clientPaymentRows.map((p) => [
        <span key="c" className="font-semibold">{p.clientName}</span>,
        formatDateTime(p.date, language),
        p.origin,
        <Badge key="t" variant={p.source === 'direct' ? 'success' : p.source === 'debt' ? 'warning' : 'info'} className="text-[10px]">
          {p.source === 'direct' ? 'Direct' : p.source === 'debt' ? 'Sur dette' : p.source === 'advance' ? 'Acompte' : 'Facture'}
        </Badge>,
        p.source === 'direct' ? paymentMethodLabel(p) : '—',
        <span key="a" className="font-bold text-pistachio">{money(p.amount)}</span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Mode', align: 'left', width: '20%' },
        { label: 'Montant', align: 'right', width: '20%' },
      ],
      printRows: clientPaymentRows.map((p): DocRow => ({
        cells: [
          formatDate(p.date.slice(0, 10)),
          `${p.clientName.toUpperCase()} — ${p.origin.toUpperCase()}`,
          p.source === 'direct' ? paymentMethodLabel(p).toUpperCase() : '/',
          money(p.amount),
        ],
      })),
      printTotalLabel: 'Total encaisse des clients',
      printTotalValue: money(sum(clientPaymentRows.map((p) => p.amount))),
    });

    // ---- 5. ANCIENNES VENTES ----
    const oldSales = groupByParty(
      sales.filter((s) => s.isHistorical && inP(s.date)),
      (s) => nameOfClient(s.clientId),
      (s) => s.date
    );
    list.push({
      key: 'oldSales', group: 'clients', label: 'Anciennes ventes', icon: <History size={15} />,
      note: 'Ventes antérieures au logiciel — ni le stock ni la caisse ne les ont vues passer.',
      count: oldSales.length,
      total: money(sum(oldSales.map((s) => s.finalAmount))),
      stats: [
        { label: 'Factures', value: String(oldSales.length) },
        { label: 'Total', value: money(sum(oldSales.map((s) => s.finalAmount))), tone: 'accent' },
        { label: 'Payé', value: money(sum(oldSales.map((s) => s.paidAmount))), tone: 'pos' },
        { label: 'Reste dû', value: money(sum(oldSales.map((s) => s.restAmount))), tone: 'neg' },
      ],
      columns: [
        { label: 'Client' }, { label: 'N° facture' }, { label: 'Date' },
        { label: 'Articles', align: 'right' }, { label: 'Total', align: 'right' },
        { label: 'Payé', align: 'right' }, { label: 'Reste', align: 'right' },
      ],
      actions: oldSales.map((s): EntryTarget => ({ kind: 'sale', id: s.id })),
      rows: oldSales.map((s) => [
        <span key="c" className="font-semibold">{nameOfClient(s.clientId)}</span>,
        s.reference, formatDate(s.date, language), s.products.length,
        money(s.finalAmount),
        <span key="p" className="text-pistachio">{money(s.paidAmount)}</span>,
        <span key="r" className="text-rose-deep">{money(s.restAmount)}</span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Paye', align: 'right', width: '18%' },
        { label: 'Total', align: 'right', width: '18%' },
      ],
      printRows: oldSales.map((s): DocRow => ({
        cells: [
          formatDate(s.date),
          `${nameOfClient(s.clientId).toUpperCase()} — ANCIENNE VENTE ${s.reference}`,
          money(s.paidAmount), money(s.finalAmount),
        ],
      })),
      printTotalLabel: 'Total des anciennes ventes',
      printTotalValue: money(sum(oldSales.map((s) => s.finalAmount))),
    });

    // ---- 6. ANCIENNES COMMANDES ----
    const oldCommands = groupByParty(
      commands.filter((c) => c.isHistorical && (inP(c.createdAt) || inP(c.receiveDate))),
      (c) => c.clientName,
      (c) => c.receiveDate || c.createdAt
    );
    list.push({
      key: 'oldCommands', group: 'clients', label: 'Anciennes commandes', icon: <History size={15} />,
      count: oldCommands.length,
      total: money(sum(oldCommands.map(commandTtc))),
      stats: [
        { label: 'Commandes', value: String(oldCommands.length) },
        { label: 'Total TTC', value: money(sum(oldCommands.map(commandTtc))), tone: 'accent' },
        { label: 'Versé', value: money(sum(oldCommands.map((c) => c.paidAmount))), tone: 'pos' },
        { label: 'Reste dû', value: money(sum(oldCommands.map((c) => c.restAmount))), tone: 'neg' },
      ],
      columns: [
        { label: 'Client' }, { label: 'N° commande' }, { label: 'Date' },
        { label: 'Commandé', align: 'right' }, { label: 'Livré', align: 'right' },
        { label: 'Total TTC', align: 'right' }, { label: 'Reste', align: 'right' },
      ],
      actions: oldCommands.map(commandTarget),
      rows: oldCommands.map((c) => {
        const st = deliveryStatus(c);
        return [
          <span key="c" className="font-semibold">{c.clientName}</span>,
          c.reference, formatDate(c.createdAt.slice(0, 10), language),
          st.ordered, st.delivered, money(commandTtc(c)),
          <span key="r" className="text-rose-deep">{money(c.restAmount)}</span>,
        ];
      }),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Commande', align: 'center', width: '12%' },
        { label: 'Total TTC', align: 'right', width: '20%' },
      ],
      printRows: oldCommands.map((c): DocRow => ({
        cells: [
          formatDate(c.receiveDate || c.createdAt.slice(0, 10)),
          `${c.clientName.toUpperCase()} — ANCIENNE COMMANDE ${c.reference}`,
          deliveryStatus(c).ordered, money(commandTtc(c)),
        ],
      })),
      printTotalLabel: 'Total des anciennes commandes',
      printTotalValue: money(sum(oldCommands.map(commandTtc))),
    });

    // ---- 8. ANCIENNES DETTES CLIENTS ----
    const cOldDebts = groupByParty(
      clientOldDebts.filter((d) => inP(d.date)),
      (d) => d.partyName ?? '—',
      (d) => d.date
    );
    list.push({
      key: 'clientOldDebts', group: 'clients', label: 'Anciennes dettes', icon: <PiggyBank size={15} />,
      note: "Ardoises antérieures au logiciel — aucune écriture de caisse à leur saisie.",
      count: cOldDebts.length,
      total: money(sum(cOldDebts.map((d) => d.amount))),
      stats: [
        { label: 'Ardoises', value: String(cOldDebts.length) },
        { label: 'Total', value: money(sum(cOldDebts.map((d) => d.amount))), tone: 'accent' },
        { label: 'Réglé', value: money(sum(cOldDebts.map((d) => d.paidAmount))), tone: 'pos' },
        { label: 'Reste dû', value: money(sum(cOldDebts.map((d) => d.restAmount))), tone: 'neg' },
      ],
      columns: [
        { label: 'Client' }, { label: 'Date' }, { label: 'Description' },
        { label: 'Montant', align: 'right' }, { label: 'Réglé', align: 'right' }, { label: 'Reste', align: 'right' },
      ],
      actions: cOldDebts.map((d): EntryTarget => ({ kind: 'oldDebt', id: d.id, party: 'client' })),
      rows: cOldDebts.map((d) => [
        <span key="c" className="font-semibold">{d.partyName ?? '—'}</span>,
        formatDate(d.date, language), d.description || '—',
        money(d.amount),
        <span key="p" className="text-pistachio">{money(d.paidAmount)}</span>,
        <span key="r" className={d.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>{money(d.restAmount)}</span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Regle', align: 'right', width: '18%' },
        { label: 'Reste', align: 'right', width: '18%' },
      ],
      printRows: cOldDebts.map((d): DocRow => ({
        cells: [
          formatDate(d.date),
          `${(d.partyName ?? '—').toUpperCase()} — ${(d.description || 'ANCIENNE DETTE').toUpperCase()}`,
          money(d.paidAmount), money(d.restAmount),
        ],
      })),
      printTotalLabel: 'Total reste du',
      printTotalValue: money(sum(cOldDebts.map((d) => d.restAmount))),
    });

    // ---- 9. ANNULATIONS / AUGMENTATIONS DE COMMANDE (nouveau) ----
    const rAdjust = groupByParty(
      adjustments.filter((a) => inP(a.date)),
      (a) => a.clientName ?? '—',
      (a) => a.date
    );
    const cancelled = rAdjust.filter((a) => a.type === 'cancel');
    const increased = rAdjust.filter((a) => a.type === 'increase');
    list.push({
      key: 'adjustments', group: 'clients', label: 'Annulations / augmentations', icon: <ScissorsSquare size={15} />,
      note:
        "Le client a renoncé au solde d'une commande, ou en a redemandé. L'écart n'apparaît plus "
        + 'comme une quantité à livrer ni comme une dette.',
      count: rAdjust.length,
      total: `${money(sum(increased.map((a) => a.totalAmount)))} / −${money(sum(cancelled.map((a) => a.totalAmount)))}`,
      stats: [
        { label: 'Opérations', value: String(rAdjust.length) },
        { label: 'Quantité annulée', value: String(sum(cancelled.map((a) => a.totalQuantity))), tone: 'neg' },
        { label: 'Valeur annulée', value: money(sum(cancelled.map((a) => a.totalAmount))), tone: 'neg' },
        { label: 'Quantité ajoutée', value: String(sum(increased.map((a) => a.totalQuantity))), tone: 'pos' },
        { label: 'Valeur ajoutée', value: money(sum(increased.map((a) => a.totalAmount))), tone: 'pos' },
      ],
      columns: [
        { label: 'Client' }, { label: 'Date' }, { label: 'Commande' },
        { label: 'Opération', align: 'center' }, { label: 'Produits' },
        { label: 'Quantité', align: 'right' }, { label: 'Valeur H.T', align: 'right' }, { label: 'Motif' },
      ],
      actions: rAdjust.map((a): EntryTarget => ({ kind: 'command', id: a.commandId })),
      rows: rAdjust.map((a) => [
        <span key="c" className="font-semibold">{a.clientName ?? '—'}</span>,
        formatDate(a.date, language),
        a.commandReference ?? '—',
        <Badge key="t" variant={a.type === 'cancel' ? 'danger' : 'success'} className="text-[10px]">
          {a.type === 'cancel' ? 'Annulation' : 'Augmentation'}
        </Badge>,
        a.lines.map((l) => `${l.productName} (${l.quantity})`).join(' · '),
        <span key="q" className={a.type === 'cancel' ? 'text-rose-deep' : 'text-pistachio'}>
          {a.type === 'cancel' ? '−' : '+'}{a.totalQuantity}
        </span>,
        <span key="v" className={a.type === 'cancel' ? 'font-bold text-rose-deep' : 'font-bold text-pistachio'}>
          {a.type === 'cancel' ? '−' : '+'}{money(a.totalAmount)}
        </span>,
        a.reason || '—',
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Operation', align: 'center', width: '15%' },
        { label: 'Quantite', align: 'center', width: '11%' },
        { label: 'Valeur H.T', align: 'right', width: '18%' },
      ],
      printRows: rAdjust.map((a): DocRow => ({
        cells: [
          formatDate(a.date),
          `${(a.clientName ?? '—').toUpperCase()} — ${a.commandReference ?? ''} ${a.lines.map((l) => l.productName).join(', ').toUpperCase()}`,
          a.type === 'cancel' ? 'ANNULATION' : 'AUGMENTATION',
          `${a.type === 'cancel' ? '-' : '+'}${a.totalQuantity}`,
          `${a.type === 'cancel' ? '-' : '+'}${money(a.totalAmount)}`,
        ],
      })),
      printTotalLabel: 'Solde des ajustements',
      printTotalValue: money(sum(increased.map((a) => a.totalAmount)) - sum(cancelled.map((a) => a.totalAmount))),
    });

    // ---- 10. EXCEDENTS RENDUS AUX CLIENTS ----
    const cRefunds = groupByParty(
      clientRefunds.filter((r) => inP(r.refundedAt)),
      (r) => r.partyName ?? '—',
      (r) => r.refundedAt
    );
    list.push({
      key: 'clientRefunds', group: 'clients', label: 'Excédents rendus', icon: <Undo2 size={15} />,
      note: "Argent restitué aux clients qui avaient versé plus que leur dette — sortie de caisse.",
      count: cRefunds.length,
      total: money(sum(cRefunds.map((r) => r.amount))),
      stats: [
        { label: 'Remboursements', value: String(cRefunds.length) },
        { label: 'Total rendu', value: money(sum(cRefunds.map((r) => r.amount))), tone: 'neg' },
      ],
      columns: [
        { label: 'Client' }, { label: 'Date' }, { label: 'Reçu n°' },
        { label: 'Mode' }, { label: 'Montant rendu', align: 'right' },
      ],
      actions: cRefunds.map((r): EntryTarget => ({ kind: 'refund', id: r.id, party: 'client' })),
      rows: cRefunds.map((r) => [
        <span key="c" className="font-semibold">{r.partyName ?? '—'}</span>,
        formatDateTime(r.refundedAt, language),
        `EXC-${r.id.slice(0, 8).toUpperCase()}`,
        paymentMethodLabel(r),
        <span key="a" className="font-bold text-caramel">− {money(r.amount)}</span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Mode', align: 'left', width: '20%' },
        { label: 'Montant', align: 'right', width: '20%' },
      ],
      printRows: cRefunds.map((r): DocRow => ({
        cells: [
          formatDate(r.refundedAt.slice(0, 10)),
          `${(r.partyName ?? '—').toUpperCase()} — REMBOURSEMENT EXC-${r.id.slice(0, 8).toUpperCase()}`,
          paymentMethodLabel(r).toUpperCase(), money(r.amount),
        ],
      })),
      printTotalLabel: 'Total rendu aux clients',
      printTotalValue: money(sum(cRefunds.map((r) => r.amount))),
    });

    /* --------------------------------------------------- FOURNISSEURS ---- */

    const supplierHistories = suppliers.map((s) => ({
      supplier: s,
      h: buildSupplierHistory({
        supplierId: s.id, purchases, payments: supplierPayments,
        oldDebts: supplierOldDebts, refunds: supplierRefunds,
      }),
    }));

    // ---- 11. ACHATS ----
    const rPurchases = groupByParty(
      purchases.filter((p) => !p.isHistorical && inP(p.date)),
      (p) => nameOfSupplier(p.supplierId),
      (p) => p.date
    );
    list.push({
      key: 'purchases', group: 'suppliers', label: 'Achats', icon: <ShoppingCart size={15} />,
      note: 'Factures d’achat groupées par fournisseur.',
      count: rPurchases.length,
      total: money(sum(rPurchases.map((p) => p.totalAmount))),
      stats: [
        { label: 'Factures', value: String(rPurchases.length) },
        { label: 'Total acheté', value: money(sum(rPurchases.map((p) => p.totalAmount))), tone: 'accent' },
        { label: 'Total réglé', value: money(sum(rPurchases.map((p) => p.paidAmount))), tone: 'pos' },
        { label: 'Reste dû', value: money(sum(rPurchases.map((p) => p.restAmount))), tone: 'neg' },
        { label: 'Articles', value: String(sum(rPurchases.map((p) => p.products.length))) },
      ],
      columns: [
        { label: 'Fournisseur' }, { label: 'N° facture' }, { label: 'Date' }, { label: 'N° BL' },
        { label: 'Articles', align: 'right' }, { label: 'Total', align: 'right' },
        { label: 'Réglé', align: 'right' }, { label: 'Reste', align: 'right' },
      ],
      actions: rPurchases.map((p): EntryTarget => ({ kind: 'purchase', id: p.id })),
      rows: rPurchases.map((p) => [
        <span key="s" className="font-semibold">{nameOfSupplier(p.supplierId)}</span>,
        p.reference, formatDate(p.date, language), p.bonNumber || '—', p.products.length,
        money(p.totalAmount),
        <span key="p" className="text-pistachio">{money(p.paidAmount)}</span>,
        <span key="r" className={p.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>{money(p.restAmount)}</span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Articles', align: 'center', width: '10%' },
        { label: 'Regle', align: 'right', width: '18%' },
        { label: 'Total', align: 'right', width: '18%' },
      ],
      printRows: rPurchases.map((p): DocRow => ({
        cells: [
          formatDate(p.date),
          `${nameOfSupplier(p.supplierId).toUpperCase()} — FACTURE ${p.reference}`,
          p.products.length, money(p.paidAmount), money(p.totalAmount),
        ],
      })),
      printTotalLabel: 'Total des achats',
      printTotalValue: money(sum(rPurchases.map((p) => p.totalAmount))),
    });

    // ---- 12. VERSEMENTS FOURNISSEURS ----
    const supplierPaymentRows = groupByParty(
      supplierHistories.flatMap(({ supplier, h }) =>
        h.payments.filter((p) => inP(p.date)).map((p) => ({ ...p, supplierName: supplier.name }))
      ),
      (p) => p.supplierName,
      (p) => p.date
    );
    list.push({
      key: 'supplierPayments', group: 'suppliers', label: 'Versements fournisseurs', icon: <Coins size={15} />,
      note: "Règlements saisis sur la carte du fournisseur ET règlements portés par une facture d'achat.",
      count: supplierPaymentRows.length,
      total: money(sum(supplierPaymentRows.map((p) => p.amount))),
      stats: [
        { label: 'Écritures', value: String(supplierPaymentRows.length) },
        { label: 'Total réglé', value: money(sum(supplierPaymentRows.map((p) => p.amount))), tone: 'neg' },
      ],
      columns: [
        { label: 'Fournisseur' }, { label: 'Date' }, { label: 'Origine' },
        { label: 'Type', align: 'center' }, { label: 'Mode' }, { label: 'Montant', align: 'right' },
      ],
      actions: supplierPaymentRows.map((p) => paymentTarget(p, 'supplier')),
      versementItems: supplierPaymentRows.map((p, i) => ({
        id: `s-${i}-${p.id}`, date: p.date, label: `${p.supplierName} — ${p.origin}`, amount: p.amount,
      })),
      rows: supplierPaymentRows.map((p) => [
        <span key="s" className="font-semibold">{p.supplierName}</span>,
        formatDateTime(p.date, language), p.origin,
        <Badge key="t" variant={p.source === 'direct' ? 'success' : 'info'} className="text-[10px]">
          {p.source === 'direct' ? 'Direct' : 'Facture'}
        </Badge>,
        p.source === 'direct' ? paymentMethodLabel(p) : '—',
        <span key="a" className="font-bold text-rose-deep">{money(p.amount)}</span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Mode', align: 'left', width: '20%' },
        { label: 'Montant', align: 'right', width: '20%' },
      ],
      printRows: supplierPaymentRows.map((p): DocRow => ({
        cells: [
          formatDate(p.date.slice(0, 10)),
          `${p.supplierName.toUpperCase()} — ${p.origin.toUpperCase()}`,
          p.source === 'direct' ? paymentMethodLabel(p).toUpperCase() : '/',
          money(p.amount),
        ],
      })),
      printTotalLabel: 'Total regle aux fournisseurs',
      printTotalValue: money(sum(supplierPaymentRows.map((p) => p.amount))),
    });

    // ---- 13. ANCIENS ACHATS ----
    const oldPurchases = groupByParty(
      purchases.filter((p) => p.isHistorical && inP(p.date)),
      (p) => nameOfSupplier(p.supplierId),
      (p) => p.date
    );
    list.push({
      key: 'oldPurchases', group: 'suppliers', label: 'Anciens achats', icon: <History size={15} />,
      note: "Factures antérieures au logiciel — ni le stock ni la caisse ne les ont vues passer.",
      count: oldPurchases.length,
      total: money(sum(oldPurchases.map((p) => p.totalAmount))),
      stats: [
        { label: 'Factures', value: String(oldPurchases.length) },
        { label: 'Total', value: money(sum(oldPurchases.map((p) => p.totalAmount))), tone: 'accent' },
        { label: 'Réglé', value: money(sum(oldPurchases.map((p) => p.paidAmount))), tone: 'pos' },
        { label: 'Reste dû', value: money(sum(oldPurchases.map((p) => p.restAmount))), tone: 'neg' },
      ],
      columns: [
        { label: 'Fournisseur' }, { label: 'N° facture' }, { label: 'Date' },
        { label: 'Articles', align: 'right' }, { label: 'Total', align: 'right' },
        { label: 'Réglé', align: 'right' }, { label: 'Reste', align: 'right' },
      ],
      actions: oldPurchases.map((p): EntryTarget => ({ kind: 'purchase', id: p.id })),
      rows: oldPurchases.map((p) => [
        <span key="s" className="font-semibold">{nameOfSupplier(p.supplierId)}</span>,
        p.reference, formatDate(p.date, language), p.products.length,
        money(p.totalAmount),
        <span key="p" className="text-pistachio">{money(p.paidAmount)}</span>,
        <span key="r" className="text-rose-deep">{money(p.restAmount)}</span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Regle', align: 'right', width: '18%' },
        { label: 'Total', align: 'right', width: '18%' },
      ],
      printRows: oldPurchases.map((p): DocRow => ({
        cells: [
          formatDate(p.date),
          `${nameOfSupplier(p.supplierId).toUpperCase()} — ANCIEN ACHAT ${p.reference}`,
          money(p.paidAmount), money(p.totalAmount),
        ],
      })),
      printTotalLabel: 'Total des anciens achats',
      printTotalValue: money(sum(oldPurchases.map((p) => p.totalAmount))),
    });

    // ---- 14. ANCIENNES DETTES FOURNISSEURS ----
    const sOldDebts = groupByParty(
      supplierOldDebts.filter((d) => inP(d.date)),
      (d) => d.partyName ?? '—',
      (d) => d.date
    );
    list.push({
      key: 'supplierOldDebts', group: 'suppliers', label: 'Anciennes dettes', icon: <PiggyBank size={15} />,
      note: "Sommes déjà dues aux fournisseurs avant le logiciel.",
      count: sOldDebts.length,
      total: money(sum(sOldDebts.map((d) => d.amount))),
      stats: [
        { label: 'Ardoises', value: String(sOldDebts.length) },
        { label: 'Total', value: money(sum(sOldDebts.map((d) => d.amount))), tone: 'accent' },
        { label: 'Réglé', value: money(sum(sOldDebts.map((d) => d.paidAmount))), tone: 'pos' },
        { label: 'Reste dû', value: money(sum(sOldDebts.map((d) => d.restAmount))), tone: 'neg' },
      ],
      columns: [
        { label: 'Fournisseur' }, { label: 'Date' }, { label: 'Description' },
        { label: 'Montant', align: 'right' }, { label: 'Réglé', align: 'right' }, { label: 'Reste', align: 'right' },
      ],
      actions: sOldDebts.map((d): EntryTarget => ({ kind: 'oldDebt', id: d.id, party: 'supplier' })),
      rows: sOldDebts.map((d) => [
        <span key="s" className="font-semibold">{d.partyName ?? '—'}</span>,
        formatDate(d.date, language), d.description || '—',
        money(d.amount),
        <span key="p" className="text-pistachio">{money(d.paidAmount)}</span>,
        <span key="r" className={d.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>{money(d.restAmount)}</span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Regle', align: 'right', width: '18%' },
        { label: 'Reste', align: 'right', width: '18%' },
      ],
      printRows: sOldDebts.map((d): DocRow => ({
        cells: [
          formatDate(d.date),
          `${(d.partyName ?? '—').toUpperCase()} — ${(d.description || 'ANCIENNE DETTE').toUpperCase()}`,
          money(d.paidAmount), money(d.restAmount),
        ],
      })),
      printTotalLabel: 'Total reste du',
      printTotalValue: money(sum(sOldDebts.map((d) => d.restAmount))),
    });

    // ---- 15. EXCEDENTS RECUPERES ----
    const sRefunds = groupByParty(
      supplierRefunds.filter((r) => inP(r.refundedAt)),
      (r) => r.partyName ?? '—',
      (r) => r.refundedAt
    );
    list.push({
      key: 'supplierRefunds', group: 'suppliers', label: 'Excédents récupérés', icon: <Undo2 size={15} />,
      count: sRefunds.length,
      total: money(sum(sRefunds.map((r) => r.amount))),
      stats: [
        { label: 'Récupérations', value: String(sRefunds.length) },
        { label: 'Total récupéré', value: money(sum(sRefunds.map((r) => r.amount))), tone: 'pos' },
      ],
      columns: [
        { label: 'Fournisseur' }, { label: 'Date' }, { label: 'Reçu n°' },
        { label: 'Mode' }, { label: 'Montant', align: 'right' },
      ],
      actions: sRefunds.map((r): EntryTarget => ({ kind: 'refund', id: r.id, party: 'supplier' })),
      rows: sRefunds.map((r) => [
        <span key="s" className="font-semibold">{r.partyName ?? '—'}</span>,
        formatDateTime(r.refundedAt, language),
        `EXC-${r.id.slice(0, 8).toUpperCase()}`,
        paymentMethodLabel(r),
        <span key="a" className="font-bold text-pistachio">+ {money(r.amount)}</span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Mode', align: 'left', width: '20%' },
        { label: 'Montant', align: 'right', width: '20%' },
      ],
      printRows: sRefunds.map((r): DocRow => ({
        cells: [
          formatDate(r.refundedAt.slice(0, 10)),
          `${(r.partyName ?? '—').toUpperCase()} — RECUPERATION EXC-${r.id.slice(0, 8).toUpperCase()}`,
          paymentMethodLabel(r).toUpperCase(), money(r.amount),
        ],
      })),
      printTotalLabel: 'Total recupere',
      printTotalValue: money(sum(sRefunds.map((r) => r.amount))),
    });

    /* ------------------------------------------------------ ENTREPRISE -- */

    // ---- 16. DEPENSES ----
    const rExpenses = [...expenses.filter((e) => inP(e.date))].sort((a, b) => {
      const byCat = (a.categoryName || 'Sans catégorie').localeCompare(b.categoryName || 'Sans catégorie', 'fr');
      return byCat !== 0 ? byCat : a.date.localeCompare(b.date);
    });
    list.push({
      key: 'expenses', group: 'company', label: 'Dépenses', icon: <Banknote size={15} />,
      note: 'Dépenses de la période, groupées par catégorie.',
      count: rExpenses.length,
      total: money(sum(rExpenses.map((e) => e.amount))),
      stats: [
        { label: 'Dépenses', value: String(rExpenses.length) },
        { label: 'Total', value: money(sum(rExpenses.map((e) => e.amount))), tone: 'neg' },
        { label: 'Catégories', value: String(new Set(rExpenses.map((e) => e.categoryName || '—')).size) },
      ],
      columns: [
        { label: 'Catégorie' }, { label: 'Nom' }, { label: 'Description' },
        { label: 'Date' }, { label: 'Montant', align: 'right' },
      ],
      rows: rExpenses.map((e) => [
        <span key="c" className="font-semibold">{e.categoryName || 'Sans catégorie'}</span>,
        e.name, e.description || '—', formatDate(e.date, language),
        <span key="a" className="font-bold text-rose-deep">{money(e.amount)}</span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Categorie', align: 'left', width: '22%' },
        { label: 'Montant', align: 'right', width: '20%' },
      ],
      printRows: rExpenses.map((e): DocRow => ({
        cells: [
          formatDate(e.date), e.name.toUpperCase(),
          (e.categoryName || 'SANS CATEGORIE').toUpperCase(), money(e.amount),
        ],
      })),
      printTotalLabel: 'Total des depenses',
      printTotalValue: money(sum(rExpenses.map((e) => e.amount))),
    });

    // ---- 17. EMPLOYES ----
    type WorkerRow = {
      worker: string; kind: string; date: string; description: string; amount: number;
    };
    const workerRows: WorkerRow[] = [];
    workers.forEach((w) => {
      (w.payments ?? []).filter((p) => inP(p.date)).forEach((p) =>
        workerRows.push({
          worker: w.fullName,
          kind: p.kind === 'overtime' ? 'Heures supplémentaires' : 'Salaire',
          date: p.date,
          description: p.description || p.period || '—',
          amount: p.amount,
        })
      );
      (w.acomptes ?? []).filter((a) => inP(a.date)).forEach((a) =>
        workerRows.push({ worker: w.fullName, kind: 'Acompte', date: a.date, description: a.description || '—', amount: a.amount })
      );
      (w.absences ?? []).filter((a) => inP(a.date)).forEach((a) =>
        workerRows.push({ worker: w.fullName, kind: 'Absence', date: a.date, description: a.description || '—', amount: a.cost })
      );
      (w.overtimes ?? []).filter((o) => inP(o.date)).forEach((o) =>
        workerRows.push({
          worker: w.fullName, kind: o.isPaid ? 'H. sup. payées' : 'H. sup. à payer',
          date: o.date,
          description: `${o.hours.toFixed(2)} h × ${money(o.hourlyRate)}${o.description ? ` — ${o.description}` : ''}`,
          amount: o.amount,
        })
      );
    });
    const sortedWorkerRows = groupByParty(workerRows, (r) => r.worker, (r) => r.date);
    list.push({
      key: 'workers', group: 'company', label: 'Employés', icon: <HardHat size={15} />,
      note: 'Salaires, acomptes, absences et heures supplémentaires de la période, groupés par employé.',
      count: sortedWorkerRows.length,
      total: money(sum(sortedWorkerRows.map((r) => r.amount))),
      stats: [
        { label: 'Écritures', value: String(sortedWorkerRows.length) },
        { label: 'Salaires payés', value: money(sum(sortedWorkerRows.filter((r) => r.kind === 'Salaire').map((r) => r.amount))), tone: 'neg' },
        { label: 'Acomptes', value: money(sum(sortedWorkerRows.filter((r) => r.kind === 'Acompte').map((r) => r.amount))), tone: 'neg' },
        { label: 'Heures sup.', value: money(sum(sortedWorkerRows.filter((r) => r.kind.startsWith('H. sup')).map((r) => r.amount))), tone: 'neg' },
        { label: 'Coût des absences', value: money(sum(sortedWorkerRows.filter((r) => r.kind === 'Absence').map((r) => r.amount))), tone: 'neg' },
      ],
      columns: [
        { label: 'Employé' }, { label: 'Type' }, { label: 'Date' },
        { label: 'Description' }, { label: 'Montant', align: 'right' },
      ],
      rows: sortedWorkerRows.map((r) => [
        <span key="w" className="font-semibold">{r.worker}</span>,
        <Badge key="k" variant={r.kind === 'Absence' ? 'danger' : r.kind === 'Acompte' ? 'warning' : 'info'} className="text-[10px]">
          {r.kind}
        </Badge>,
        formatDate(r.date, language), r.description,
        <span key="a" className="font-bold text-rose-deep">{money(r.amount)}</span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Type', align: 'left', width: '20%' },
        { label: 'Montant', align: 'right', width: '20%' },
      ],
      printRows: sortedWorkerRows.map((r): DocRow => ({
        cells: [formatDate(r.date), `${r.worker.toUpperCase()} — ${r.description.toUpperCase()}`, r.kind.toUpperCase(), money(r.amount)],
      })),
      printTotalLabel: 'Total employes',
      printTotalValue: money(sum(sortedWorkerRows.map((r) => r.amount))),
    });

    // ---- 18. CAISSE ----
    const rTx = [...transactions.filter((x) => inP(x.date))].sort((a, b) => a.date.localeCompare(b.date));
    const deposits = rTx.filter((x) => x.type === 'deposit');
    const withdrawals = rTx.filter((x) => x.type === 'withdrawal');
    const depositsTotal = sum(deposits.map((x) => x.amount));
    const withdrawalsTotal = sum(withdrawals.map((x) => x.amount));
    // Solde theorique de la caisse a la fin de la periode
    const theoretical = initialBalance
      + sum(transactions.filter((x) => x.date <= t2).map((x) => (x.type === 'deposit' ? x.amount : -x.amount)));
    list.push({
      key: 'caisse', group: 'company', label: 'Caisse', icon: <Wallet size={15} />,
      note: 'Toutes les entrées et sorties de caisse de la période, dans l’ordre chronologique.',
      count: rTx.length,
      total: money(depositsTotal - withdrawalsTotal),
      stats: [
        { label: 'Mouvements', value: String(rTx.length) },
        { label: 'Entrées', value: money(depositsTotal), tone: 'pos' },
        { label: 'Sorties', value: money(withdrawalsTotal), tone: 'neg' },
        { label: 'Solde de la période', value: money(depositsTotal - withdrawalsTotal), tone: depositsTotal >= withdrawalsTotal ? 'pos' : 'neg' },
        { label: 'Solde théorique au ' + formatDate(t2, language), value: money(theoretical), tone: 'accent' },
      ],
      columns: [
        { label: 'Date' }, { label: 'Type', align: 'center' }, { label: 'Catégorie' },
        { label: 'Description' }, { label: 'Montant', align: 'right' },
      ],
      rows: rTx.map((x) => [
        formatDate(x.date, language),
        <Badge key="t" variant={x.type === 'deposit' ? 'success' : 'danger'} className="text-[10px]">
          {x.type === 'deposit' ? 'Entrée' : 'Sortie'}
        </Badge>,
        x.categoryName || '—',
        x.description || '—',
        <span key="a" className={x.type === 'deposit' ? 'font-bold text-pistachio' : 'font-bold text-rose-deep'}>
          {x.type === 'deposit' ? '+ ' : '− '}{money(x.amount)}
        </span>,
      ]),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Type', align: 'center', width: '12%' },
        { label: 'Montant', align: 'right', width: '20%' },
      ],
      printRows: rTx.map((x): DocRow => ({
        cells: [
          formatDate(x.date),
          `${(x.categoryName || 'CAISSE').toUpperCase()} — ${(x.description || '').toUpperCase()}`,
          x.type === 'deposit' ? 'ENTREE' : 'SORTIE',
          `${x.type === 'deposit' ? '+' : '-'}${money(x.amount)}`,
        ],
      })),
      printTotalLabel: 'Solde de la periode',
      printTotalValue: money(depositsTotal - withdrawalsTotal),
    });

    // ---- 19. PRODUCTIONS ----
    const rProductions = [...productions.filter((p) => inP(p.date))].sort((a, b) => a.date.localeCompare(b.date));
    const prodCost = sum(rProductions.map((p) =>
      sum(p.usedProducts.map((u) => u.lineCost ?? u.quantityUsed * (u.unitCost ?? 0)))));
    const rDestructions = destructions.filter((d) => inP(d.date));
    list.push({
      key: 'productions', group: 'company', label: 'Productions', icon: <Factory size={15} />,
      note: 'Lots produits sur la période, avec leur coût matière et leur valeur potentielle.',
      count: rProductions.length,
      total: money(sum(rProductions.map((p) => p.totalValue))),
      stats: [
        { label: 'Lots', value: String(rProductions.length) },
        { label: 'Quantité produite', value: String(Math.round(sum(rProductions.map((p) => p.outputQuantity)) * 1000) / 1000) },
        { label: 'Coût matière', value: money(prodCost), tone: 'neg' },
        { label: 'Valeur potentielle', value: money(sum(rProductions.map((p) => p.totalValue))), tone: 'accent' },
        { label: 'Pertes', value: money(sum(rProductions.map((p) => p.lossValue ?? 0))), tone: 'neg' },
        { label: 'Destructions', value: money(sum(rDestructions.map((d) => d.value))), tone: 'neg' },
      ],
      columns: [
        { label: 'Production' }, { label: 'Date' }, { label: 'Catégorie' },
        { label: 'Quantité', align: 'right' }, { label: 'Coût matière', align: 'right' },
        { label: 'Valeur', align: 'right' }, { label: 'Perte', align: 'right' },
      ],
      rows: rProductions.map((p) => {
        const cost = sum(p.usedProducts.map((u) => u.lineCost ?? u.quantityUsed * (u.unitCost ?? 0)));
        return [
          <span key="n" className="font-semibold">{p.name}</span>,
          `${formatDate(p.date, language)} ${p.hour ?? ''}`,
          p.categoryName || '—',
          `${p.outputQuantity}${p.sellByUnit && p.sellUnit ? ` ${p.sellUnit}` : ''}`,
          <span key="c" className="text-rose-deep">{money(cost)}</span>,
          money(p.totalValue),
          <span key="l" className={(p.lossValue ?? 0) > 0 ? 'font-bold text-rose-deep' : 'text-text-muted'}>
            {money(p.lossValue ?? 0)}
          </span>,
        ];
      }),
      printColumns: [
        DATE_COL, DESIGNATION_COL,
        { label: 'Quantite', align: 'center', width: '11%' },
        { label: 'Cout matiere', align: 'right', width: '17%' },
        { label: 'Valeur', align: 'right', width: '17%' },
      ],
      printRows: rProductions.map((p): DocRow => {
        const cost = sum(p.usedProducts.map((u) => u.lineCost ?? u.quantityUsed * (u.unitCost ?? 0)));
        return {
          cells: [formatDate(p.date), p.name.toUpperCase(), p.outputQuantity, money(cost), money(p.totalValue)],
        };
      }),
      printTotalLabel: 'Valeur produite',
      printTotalValue: money(sum(rProductions.map((p) => p.totalValue))),
    });

    // ---- 20. ETAT DU STOCK ----
    const stockSorted = [...products].sort((a, b) =>
      b.currentQuantity * b.purchasePrice - a.currentQuantity * a.purchasePrice);
    const stockValue = sum(products.map((p) => p.currentQuantity * p.purchasePrice));
    list.push({
      key: 'stock', group: 'company', label: 'Stock', icon: <Package size={15} />,
      note: "État du stock au moment où le rapport est généré.",
      count: stockSorted.length,
      total: money(stockValue),
      stats: [
        { label: 'Références', value: String(products.length) },
        { label: 'Valeur du stock', value: money(stockValue), tone: 'accent' },
        { label: 'En alerte', value: String(products.filter((p) => p.currentQuantity <= p.minAlertQuantity).length), tone: 'neg' },
      ],
      columns: [
        { label: 'Produit' }, { label: 'Unité' }, { label: 'Stock', align: 'right' },
        { label: 'Alerte', align: 'right' }, { label: 'Prix d’achat', align: 'right' },
        { label: 'Valeur', align: 'right' },
      ],
      rows: stockSorted.map((p) => [
        <span key="n" className="font-semibold">{p.name}</span>,
        p.unit || '—',
        <span key="q" className={p.currentQuantity <= p.minAlertQuantity ? 'font-bold text-rose-deep' : ''}>
          {p.currentQuantity}
        </span>,
        p.minAlertQuantity,
        money(p.purchasePrice),
        money(p.currentQuantity * p.purchasePrice),
      ]),
      printColumns: [
        { label: 'Designation', align: 'left' },
        { label: 'Stock', align: 'center', width: '13%' },
        { label: 'Prix d’achat', align: 'right', width: '20%' },
        { label: 'Valeur', align: 'right', width: '20%' },
      ],
      printRows: stockSorted.map((p): DocRow => ({
        cells: [p.name.toUpperCase(), p.currentQuantity, money(p.purchasePrice), money(p.currentQuantity * p.purchasePrice)],
      })),
      printTotalLabel: 'Valeur totale du stock',
      printTotalValue: money(stockValue),
    });

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    period, sales, purchases, expenses, productions, destructions, products, clients,
    clientPayments, clientOldDebts, clientRefunds, suppliers, supplierPayments,
    supplierOldDebts, supplierRefunds, debts, workers, transactions, initialBalance,
    commands, deliveries, adjustments, caisseReports, language,
  ]);

  // À la génération, toutes les parties qui ont du contenu sont cochées.
  useEffect(() => {
    if (!parts.length) return;
    setChecked(parts.filter((p) => p.count > 0).map((p) => p.key));
    const first = parts.find((p) => p.group === group && p.count > 0) ?? parts.find((p) => p.group === group);
    if (first) setActive(first.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts.length, period]);

  const visibleParts = parts.filter((p) => p.group === group);
  const current = parts.find((p) => p.key === active) ?? visibleParts[0];

  /* ---------------------------------------------------------- impression */
  /** Ligne de periode, avec le texte choisi devant les dates. */
  const metaLinesFor = (prefix = 'PERIODE') => (period ? [`${prefix} ${periodSuffix(period.from, period.to)}`] : []);

  /** Anciennes dettes (avec un reste) datees AVANT la periode choisie. */
  const priorOldDebts = useMemo(() => {
    if (!period) return { clients: [] as PartyOldDebt[], suppliers: [] as PartyOldDebt[] };
    const before = (d: PartyOldDebt) => d.date.slice(0, 10) < period.from && d.restAmount > 0.004;
    const byDate = (a: PartyOldDebt, b: PartyOldDebt) => a.date.localeCompare(b.date);
    return {
      clients: clientOldDebts.filter(before).sort(byDate),
      suppliers: supplierOldDebts.filter(before).sort(byDate),
    };
  }, [period, clientOldDebts, supplierOldDebts]);

  /**
   * Partie « anciennes dettes » completee par les dettes ANTERIEURES a la
   * periode (acceptees par l'operateur) : chacune avec sa date, au-dessus du
   * total, qui les inclut.
   */
  const withPrior = (part: ReportPart, include: boolean): ReportPart => {
    if (!include) return part;
    const list = part.key === 'clientOldDebts' ? priorOldDebts.clients
      : part.key === 'supplierOldDebts' ? priorOldDebts.suppliers : [];
    if (!list.length) return part;
    const extra: DocRow[] = list.map((d) => ({
      cells: [
        formatDate(d.date),
        `${(d.partyName ?? '—').toUpperCase()} — ${(d.description || 'ANCIENNE DETTE').toUpperCase()} (ANTERIEURE A LA PERIODE)`,
        money(d.paidAmount), money(d.restAmount),
      ],
    }));
    const inPeriodRest = (part.key === 'clientOldDebts' ? clientOldDebts : supplierOldDebts)
      .filter((d) => withinPeriod(d.date, period?.from, period?.to))
      .reduce((s2, d) => s2 + d.restAmount, 0);
    return {
      ...part,
      printRows: [...extra, ...part.printRows],
      printTotalValue: money(inPeriodRest + list.reduce((s2, d) => s2 + d.restAmount, 0)),
    };
  };

  /** Demande (si besoin) d'ajouter les anciennes dettes anterieures, puis imprime. */
  const askPriorThen = (keys: string[], run: (include: boolean) => void) => {
    const wantsClients = keys.includes('clientOldDebts') && priorOldDebts.clients.length > 0;
    const wantsSuppliers = keys.includes('supplierOldDebts') && priorOldDebts.suppliers.length > 0;
    if (!wantsClients && !wantsSuppliers) { run(false); return; }
    setOldDebtAsk({
      clients: wantsClients ? priorOldDebts.clients : [],
      suppliers: wantsSuppliers ? priorOldDebts.suppliers : [],
      run,
    });
  };

  /** Lignes imprimees d'une partie, sans les versements decoches. */
  const visibleRows = (part: ReportPart, hidden = hiddenPay): DocRow[] =>
    part.versementItems
      ? part.printRows.filter((_, i) => !hidden.includes(part.versementItems![i]?.id ?? ''))
      : part.printRows;

  const printPart = (part: ReportPart) =>
    setTitleRequest({
      extra: part.versementItems?.length
        ? () => (
          <VersementChecklist items={part.versementItems!} hidden={hiddenPayRef.current} onChange={setHiddenPayAndRef} />
        )
        : undefined,
      defaultTitle: part.label.toUpperCase(),
      defaultPeriodPrefix: 'PERIODE',
      periodSuffix: period ? periodSuffix(period.from, period.to) : undefined,
      scope: 'report',
      dialogTitle: `Imprimer — ${part.label}`,
      print: (titles) => printPartNow(part, titles.title, titles.periodPrefix, titles.endText),
    });

  const printPartNow = (part: ReportPart, docTitle: string, prefix: string, endText = '') => {
    askPriorThen([part.key], (include) => {
      const p2 = withPrior(part, include);
      printListDocument(
        {
          title: docTitle,
          endText,
          docDate: period?.to || todayISO(),
          metaLines: metaLinesFor(prefix),
          tables: [
            {
              columns: p2.printColumns,
              rows: visibleRows(p2, hiddenPayRef.current),
              totals: p2.printTotalLabel
                ? [{ label: p2.printTotalLabel, value: p2.printTotalValue ?? '', strong: true }]
                : undefined,
              emptyLabel: 'Aucune ligne sur la période',
            },
          ],
          signatures: ['Le responsable', 'Signature'],
          fileName: `Rapport_${p2.label.replace(/\s+/g, '_')}`,
        },
        settings
      );
    });
  };

  /**
   * RAPPORT GENERAL IMPRIME.
   * Un tableau par partie cochée, chacun avec sa colonne DATE, sa colonne
   * DESIGNATION et son total — le tableau de résumé qui ouvrait l'ancien
   * document a été SUPPRIMÉ, comme demandé.
   */
  const printGeneral = () => {
    setPrintOpen(false);
    askPriorThen(checked, (include) => printGeneralNow(include));
  };

  const printGeneralNow = (includePrior: boolean) => {
    const picked = parts.filter((p) => checked.includes(p.key)).map((p) => withPrior(p, includePrior));
    printListDocument(
      {
        title: resolvedDocTitle(generalTitle, 'RAPPORT GENERAL'),
        endText: generalTitle.endText.trim(),
        docDate: period?.to || todayISO(),
        metaLines: metaLinesFor(resolvedPeriodPrefix(generalTitle, 'PERIODE')),
        tables: picked.map((p) => ({
          title: p.label.toUpperCase(),
          columns: p.printColumns,
          rows: visibleRows(p),
          totals: p.printTotalLabel
            ? [{ label: p.printTotalLabel, value: p.printTotalValue ?? '', strong: true }]
            : undefined,
          emptyLabel: 'Aucune ligne sur la période',
        })),
        signatures: ['Le responsable', 'Signature'],
        fileName: `Rapport_General_${(period?.from ?? '').replace(/-/g, '')}_${(period?.to ?? '').replace(/-/g, '')}`,
      },
      settings
    );
  };

  const toggle = (key: string) =>
    setChecked((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));

  /* --------------------------------------------------------------- rendu */
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('reports')}
        icon={<TrendingUp size={24} />}
        subtitle={
          period
            ? `Du ${formatDate(period.from, language)} au ${formatDate(period.to, language)}`
            : 'Choisissez une période puis générez le rapport'
        }
        actions={
          parts.length > 0 && (
            <Button variant="gold" onClick={() => setPrintOpen(true)}>
              <Printer size={18} /> Imprimer le rapport général
            </Button>
          )
        }
      />

      <Card index={0}>
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Date de début" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[200px]" />
          <Input label="Date de fin" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[200px]" />
          <Button variant="gold" disabled={!from || !to || from > to} onClick={() => setPeriod({ from, to })}>
            <FileText size={18} /> Générer le rapport
          </Button>
          {period && (
            <Button variant="secondary" onClick={() => setPeriod(null)}>
              Changer la période
            </Button>
          )}
        </div>
      </Card>

      {/* ---------------- SITUATION DES DETTES (toujours a jour) ---------------- */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-text-primary">
          <Scale size={19} className="text-gold" /> Situation des dettes — clients et fournisseurs
        </h3>
        <DebtsOverview />
      </section>

      {/* ---------------- CALCUL DETAILLE DES GAINS ET DEPENSES ---------------- */}
      <section className="space-y-3">
        <h3 className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold text-text-primary">
          <Calculator size={19} className="text-gold" /> Calcul des gains et des dépenses
          <span className="text-xs font-normal text-text-muted">
            du {formatDate((period?.from ?? from) || todayISO(), language)} au {formatDate((period?.to ?? to) || todayISO(), language)}
          </span>
        </h3>
        <GainsBreakdown from={period?.from ?? from} to={period?.to ?? to} />
      </section>

      {!period || !current ? (
        <Card index={1} className="py-12 text-center text-text-muted">
          <Layers size={34} className="mx-auto mb-3 text-gold opacity-60" />
          Sélectionnez une date de début et une date de fin, puis générez le rapport.
        </Card>
      ) : (
        <div className="space-y-4">
          {/* -------------------------------------------------- familles -- */}
          <div className="flex gap-1.5 overflow-x-auto rounded-2xl border border-gold/20 bg-vanilla/40 p-1.5">
            {GROUPS.map((g) => {
              const on = g.key === group;
              const count = parts.filter((p) => p.group === g.key).reduce((s, p) => s + p.count, 0);
              return (
                <button
                  key={g.key}
                  onClick={() => {
                    setGroup(g.key);
                    const first = parts.find((p) => p.group === g.key && p.count > 0)
                      ?? parts.find((p) => p.group === g.key);
                    if (first) setActive(first.key);
                  }}
                  className={cn(
                    'relative flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors',
                    on ? 'text-white' : 'text-text-secondary hover:bg-gold/10 hover:text-text-primary'
                  )}
                >
                  {on && (
                    <motion.span
                      layoutId="report-group"
                      transition={{ duration: 0.18, ease: EASE }}
                      className="absolute inset-0 rounded-xl bg-gradient-button shadow-gold"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    {g.icon}{g.label}
                    <span className={cn(
                      'rounded-full px-1.5 text-[10px] font-bold tabular',
                      on ? 'bg-white/25 text-white' : 'bg-gold/15 text-gold-dark'
                    )}>
                      {count}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* --------------------------------------------------- parties -- */}
          <div className="flex gap-1 overflow-x-auto rounded-2xl border border-gold/15 bg-vanilla/30 p-1.5">
            {visibleParts.map((p) => {
              const on = p.key === current.key;
              return (
                <button
                  key={p.key}
                  onClick={() => setActive(p.key)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-colors',
                    on ? 'bg-gradient-button text-white shadow-gold' : 'text-text-secondary hover:bg-gold/10 hover:text-text-primary'
                  )}
                >
                  {p.icon}{p.label}
                  <span className={cn(
                    'rounded-full px-1.5 text-[10px] font-bold tabular',
                    on ? 'bg-white/25 text-white' : 'bg-gold/15 text-gold-dark'
                  )}>
                    {p.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ----------------------------------------------- la partie ---- */}
          <AnimatePresence mode="wait">
            <motion.div key={current.key} variants={panelVariants} initial="hidden" animate="visible" exit="exit" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-l-4 border-gold bg-gold/8 px-3 py-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-gold-dark">
                  <LayoutGrid size={15} /> {current.label}
                  <span className="text-xs font-normal text-text-muted">({current.count} ligne(s))</span>
                </h3>
                <Button size="sm" variant="gold" onClick={() => printPart(current)}>
                  <Printer size={14} /> Imprimer cette partie
                </Button>
              </div>

              {current.note && <p className="px-1 text-[11px] italic text-text-muted">{current.note}</p>}

              {current.stats.length > 0 && (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                  {current.stats.map((k) => <Stat key={k.label} {...k} />)}
                </div>
              )}

              {current.rows.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-gold/25 bg-vanilla/20 py-10 text-center text-sm italic text-text-muted">
                  Aucune ligne sur cette période
                </p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-gold/15 bg-gradient-card shadow-card">
                  <table className="w-full text-sm">
                    <thead className="bg-vanilla/60 text-text-secondary">
                      <tr>
                        {current.columns.map((c) => (
                          <th
                            key={c.label}
                            className={cn(
                              'whitespace-nowrap px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide',
                              c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                            )}
                          >
                            {c.label}
                          </th>
                        ))}
                        {current.actions && (
                          <th className="whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide">
                            Actions
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {current.rows.map((r, i) => (
                        <tr key={i} className="border-t border-gold/10 hover:bg-gold/5">
                          {r.map((cell, j) => (
                            <td
                              key={j}
                              className={cn(
                                'px-3 py-2 text-xs',
                                current.columns[j]?.align === 'right' ? 'text-right tabular'
                                  : current.columns[j]?.align === 'center' ? 'text-center' : 'text-left'
                              )}
                            >
                              {cell}
                            </td>
                          ))}
                          {current.actions && (
                            <td className="px-3 py-2 text-right text-xs">
                              <EntryActions target={current.actions[i] ?? null} onOpen={setEntry} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {/* ------- anciennes dettes anterieures a la periode : ajouter ? ------- */}
      <Modal open={!!oldDebtAsk} onClose={() => setOldDebtAsk(null)} title="Dettes antérieures à la période" size="md">
        {oldDebtAsk && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-caramel/40 bg-caramel/10 px-4 py-3">
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-caramel" />
              <p className="text-sm text-text-secondary">
                Des <b className="text-text-primary">anciennes dettes datées avant le {formatDate(period?.from ?? '', language)}</b> ne
                sont pas comprises dans la période choisie. Voulez-vous les ajouter à cette impression ?
              </p>
            </div>
            {[
              { label: 'Clients', list: oldDebtAsk.clients },
              { label: 'Fournisseurs', list: oldDebtAsk.suppliers },
            ].filter((g) => g.list.length).map((g) => (
              <div key={g.label} className="rounded-xl border border-gold/20 bg-vanilla/40 p-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gold-dark">{g.label}</p>
                {g.list.map((d) => (
                  <div key={d.id} className="flex justify-between gap-2 border-b border-gold/10 py-1 text-xs last:border-0">
                    <span className="text-text-secondary">
                      <b className="text-text-primary">{formatDate(d.date, language)}</b> — {d.partyName ?? '—'}
                      {d.description ? ` · ${d.description}` : ''}
                    </span>
                    <span className="shrink-0 font-bold tabular text-rose-deep">reste {money(d.restAmount)}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="flex flex-col gap-2 border-t border-gold/15 pt-4 sm:flex-row">
              <Button
                variant="secondary" className="flex-1"
                onClick={() => { const a = oldDebtAsk; setOldDebtAsk(null); a.run(false); }}
              >
                <Printer size={15} /> Imprimer sans
              </Button>
              <Button
                variant="gold" className="flex-1 font-bold"
                onClick={() => { const a = oldDebtAsk; setOldDebtAsk(null); a.run(true); }}
              >
                <Printer size={15} /> Oui, les ajouter
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ------------------- liste à cocher du rapport général ------------- */}
      <Modal open={printOpen} onClose={() => setPrintOpen(false)} title="Imprimer le rapport général" size="lg">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-bold text-gold-dark">
              <ListChecks size={16} /> Parties incluses dans le rapport
            </p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => setChecked(parts.map((p) => p.key))}>
                Tout cocher
              </Button>
              <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => setChecked([])}>
                Tout décocher
              </Button>
            </div>
          </div>

          {GROUPS.map((g) => {
            const group2 = parts.filter((p) => p.group === g.key);
            if (!group2.length) return null;
            return (
              <div key={g.key} className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  {g.icon} {g.label}
                </p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {group2.map((p) => {
                    const on = checked.includes(p.key);
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => toggle(p.key)}
                        className={cn(
                          'flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                          on ? 'border-gold/50 bg-gold/10' : 'border-gold/15 bg-vanilla/30 hover:bg-gold/5'
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {on ? <CheckSquare size={16} className="shrink-0 text-gold-dark" />
                              : <Square size={16} className="shrink-0 text-text-muted" />}
                          <span className="truncate text-[13px] font-semibold text-text-primary">
                            {p.label}
                            <span className="ml-1 text-[11px] font-normal text-text-muted">({p.count})</span>
                          </span>
                        </span>
                        {p.total && <span className="shrink-0 text-[11px] font-bold tabular text-gold-dark">{p.total}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {parts
            .filter((p) => checked.includes(p.key) && p.versementItems?.length)
            .map((p) => (
              <VersementChecklist
                key={p.key}
                title={`${p.label} affichés sur le document`}
                items={p.versementItems!}
                hidden={hiddenPay}
                onChange={setHiddenPay}
              />
            ))}

          <DocTitlePicker
            value={generalTitle}
            onChange={setGeneralTitle}
            defaultTitle="RAPPORT GENERAL"
            defaultPeriodPrefix="PERIODE"
            periodSuffix={period ? periodSuffix(period.from, period.to) : undefined}
            scope="report"
          />

          <p className="rounded-xl border border-gold/20 bg-vanilla/40 px-3 py-2 text-[11px] text-text-muted">
            Le document sort sur le <b>modèle du bon de livraison</b> : un tableau par partie, avec sa
            colonne <b>DATE</b>, sa colonne <b>DÉSIGNATION</b> et ses totaux accrochés à droite.
            Aucun tableau de résumé n&rsquo;est imprimé en tête.
          </p>

          <div className="flex gap-2 border-t border-gold/15 pt-4">
            <Button variant="secondary" className="flex-1" onClick={() => setPrintOpen(false)}>Annuler</Button>
            <Button variant="gold" className="flex-1 font-bold" disabled={checked.length === 0} onClick={printGeneral}>
              <Printer size={16} /> Imprimer ({checked.length} partie(s))
            </Button>
          </div>
        </div>
      </Modal>

      <PrintTitleDialog request={titleRequest} onClose={() => setTitleRequest(null)} />
      <EntryEditor request={entry} onClose={() => setEntry(null)} />
    </div>
  );
}

function Stat({ label, value, tone }: ReportStat) {
  const color = tone === 'pos' ? 'text-pistachio' : tone === 'neg' ? 'text-rose-deep'
    : tone === 'accent' ? 'text-gold-dark' : 'text-text-primary';
  return (
    <div className="rounded-2xl border border-gold/15 bg-gradient-card px-3.5 py-3 shadow-card">
      <p className="text-[10px] font-bold uppercase leading-tight tracking-wide text-text-muted">{label}</p>
      <p className={`mt-1 text-base font-bold tabular ${color}`}>{value}</p>
    </div>
  );
}
