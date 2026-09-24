import { useEffect, useMemo, useState } from 'react';
import {
  HandCoins, History, Undo2, Eye, Pencil, Printer, Trash2, Wallet, Coins,
  ShoppingBag, ClipboardList, Truck, ScissorsSquare, TrendingUp, Package, PiggyBank,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import type { DataColumn } from '@/components/ui/DataTable';
import type { ActionItem } from '@/components/ui/ActionMenu';
import {
  PartyHistoryModal, type HistorySection, type HistoryStat,
} from './PartyHistoryModal';
import { EditSaleModal } from './EditSaleModal';
import { EditPaymentModal } from './EditPaymentModal';
import { PrintTitleDialog, type PrintTitleRequest } from './PrintTitleDialog';
import { EntryEditor, type EntryRequest } from './entries/EntryEditor';
import { useClientStore } from '@/store/clientStore';
import { useSalesStore } from '@/store/salesStore';
import { useCommandStore, deliveryStatus } from '@/store/commandStore';
import { useClientDebtStore } from '@/store/clientDebtStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useLanguage } from '@/hooks/useLanguage';
import { buildClientHistory, type HistoryPayment, type HistoryDelivery } from '@/lib/partyHistory';
import { clientAccountOf } from '@/lib/accounts';
import { commandTtc } from '@/lib/commandBilling';
import { formatCurrency, formatDate, formatDateTime, paymentMethodLabel, todayISO } from '@/lib/utils';
import { printSaleInvoice } from '@/lib/invoicePrint';
import { printDeliveryNote, printCommandOrder, printPaymentReceipt } from '@/lib/documents';
import { printListDocument } from '@/lib/statementPrint';
import type {
  Client, PartyOldDebt, PartyPayment, Sale, PartyCreditRefund, CommandAdjustment,
} from '@/types';
import type { Command } from '@/store/commandStore';

/* ============================================================================
 *  HISTORIQUE COMPLET D'UN CLIENT
 * ----------------------------------------------------------------------------
 *  Remplace l'ancien bouton « Versements (n) » de la carte client.
 *  Huit parties, chacune avec ses statistiques, son filtre de periode, sa
 *  recherche par date et ses actions ligne a ligne :
 *
 *     Ventes · Commandes · Livraisons · Versements ·
 *     Anciennes ventes · Anciennes commandes · Anciennes livraisons ·
 *     Anciennes dettes · Excedents rendus · Annulations / augmentations
 *
 *  POINT CRITIQUE — LES VERSEMENTS.
 *  L'onglet « Versements » montre les TROIS gisements d'argent du client :
 *  reglements directs, versements sur dettes enregistrees et encaissements
 *  portes par une vente ou un bon de livraison. C'est exactement la liste que
 *  le compte rendu additionne : un versement supprime ici disparait donc AUSSI
 *  du compte rendu imprime — le bug « le versement supprime revient » n'a plus
 *  de terrain.
 * ========================================================================== */

interface Props {
  client: Client | null;
  onClose: () => void;
  onNewVersement?: (client: Client) => void;
  onNewOldDebt?: (client: Client) => void;
  onEditOldDebt?: (client: Client, debt: PartyOldDebt) => void;
  onRefund?: (client: Client) => void;
  onStatement?: (client: Client) => void;
}

/** Ligne de l'onglet « Acompte & imputations ». */
interface CreditUseRow {
  /** Vente / bon (sales.allocated_amount) ou commande (commands.credit_applied). */
  kind: 'sale' | 'command';
  id: string;
  date: string;
  reference: string;
  label: string;
  documentTotal: number;
  amount: number;
}

export function ClientHistoryScreen({
  client: requested, onClose, onNewVersement, onNewOldDebt, onEditOldDebt, onRefund, onStatement,
}: Props) {
  // Le dernier client affiche reste en memoire pendant l'animation de
  // fermeture : l'ecran s'efface en douceur au lieu de disparaitre d'un coup.
  const [shown, setShown] = useState<Client | null>(requested);
  useEffect(() => { if (requested) setShown(requested); }, [requested]);
  const client = requested ?? shown;
  const isOpen = !!requested;

  const { can } = usePermissions();
  const { language } = useLanguage();
  const settings = useSettingsStore((s) => s.settings);

  const clients = useClientStore((s) => s.clients);
  const payments = useClientStore((s) => s.payments);
  const oldDebts = useClientStore((s) => s.oldDebts);
  const refunds = useClientStore((s) => s.refunds);
  const updatePayment = useClientStore((s) => s.updatePayment);
  const deletePayment = useClientStore((s) => s.deletePayment);
  const deleteOldDebt = useClientStore((s) => s.deleteOldDebt);
  const deleteRefund = useClientStore((s) => s.deleteRefund);
  const cancelCreditImputation = useClientStore((s) => s.cancelCreditImputation);

  const sales = useSalesStore((s) => s.sales);
  const updateSale = useSalesStore((s) => s.updateSale);
  const deleteSale = useSalesStore((s) => s.deleteSale);

  const commands = useCommandStore((s) => s.commands);
  const deliveries = useCommandStore((s) => s.deliveries);
  const adjustments = useCommandStore((s) => s.adjustments);
  const deleteCommand = useCommandStore((s) => s.deleteCommand);
  const deleteDelivery = useCommandStore((s) => s.deleteDelivery);
  const deleteAdjustment = useCommandStore((s) => s.deleteAdjustment);

  const debts = useClientDebtStore((s) => s.debts);
  const deleteDebtVersement = useClientDebtStore((s) => s.deleteVersement);

  // --- fenetres secondaires ------------------------------------------------
  const [viewSale, setViewSale] = useState<Sale | null>(null);
  const [editSale, setEditSale] = useState<Sale | null>(null);
  const [viewCommand, setViewCommand] = useState<Command | null>(null);
  const [viewDelivery, setViewDelivery] = useState<HistoryDelivery | null>(null);
  const [editPayment, setEditPayment] = useState<PartyPayment | null>(null);
  const [titleRequest, setTitleRequest] = useState<PrintTitleRequest | null>(null);
  /** Modification complete d'une ligne (vente, bon, excedent, acompte). */
  const [entry, setEntry] = useState<EntryRequest | null>(null);
  const [confirm, setConfirm] = useState<
    { title: string; message?: string; run: () => Promise<void> } | null
  >(null);

  // L'historique se ferme : les fenetres ouvertes par-dessus se ferment aussi.
  useEffect(() => {
    if (requested) return;
    setViewSale(null); setEditSale(null); setViewCommand(null);
    setViewDelivery(null); setEditPayment(null); setConfirm(null);
  }, [requested]);

  const history = useMemo(() => {
    if (!client) return null;
    return buildClientHistory({
      clientId: client.id,
      sales, commands, deliveries, payments, oldDebts, refunds, debts, adjustments,
    });
  }, [client, sales, commands, deliveries, payments, oldDebts, refunds, debts, adjustments]);

  /** Situation du compte — le MEME calcul que la carte du client. */
  const balance = useMemo(() => {
    if (!client) return null;
    return clientAccountOf(client.id, { clients, sales, commands, deliveries, oldDebts });
  }, [client, sales, commands, deliveries, oldDebts, clients]);

  /** Ce que l'argent du compte du client (versements, acompte) a paye. */
  const creditUses = useMemo<CreditUseRow[]>(() => {
    if (!client) return [];
    const rows: CreditUseRow[] = [];
    sales
      .filter((s) => s.clientId === client.id && (s.allocatedAmount ?? 0) > 0.004)
      .forEach((s) => {
        const d = s.deliveryId ? deliveries.find((x) => x.id === s.deliveryId) : undefined;
        rows.push({
          kind: 'sale',
          id: s.id,
          date: s.date,
          reference: d?.reference ?? s.reference,
          label: d ? `Bon de livraison ${d.reference}` : `Vente ${s.reference}`,
          documentTotal: s.finalAmount,
          amount: s.allocatedAmount ?? 0,
        });
      });
    commands
      .filter((c) => c.clientId === client.id && (c.creditApplied ?? 0) > 0.004)
      .forEach((c) =>
        rows.push({
          kind: 'command',
          id: c.id,
          date: c.createdAt.slice(0, 10),
          reference: c.reference,
          label: `Acompte de la commande ${c.reference}`,
          documentTotal: commandTtc(c),
          amount: c.creditApplied ?? 0,
        })
      );
    return rows;
  }, [client, sales, commands, deliveries]);

  if (!client || !history || !balance) return null;

  const ask = (title: string, message: string, run: () => Promise<void>) =>
    setConfirm({ title, message, run });

  /* ------------------------------------------------------- impressions ---- */
  const printInvoice = (s: Sale) =>
    printSaleInvoice(
      {
        reference: s.reference,
        date: s.date,
        client: {
          name: client.name, phone: client.phone, address: client.address,
          rc: client.rc, nif: client.nif, nis: client.nis, article: client.article,
        },
        lines: s.products.map((l) => ({
          designation: l.productName || '', quantity: l.quantity, unit: l.unit,
          unitPrice: l.sellingPrice, basePrice: l.basePrice,
        })),
        total: s.totalAmount, reduction: s.reduction, final: s.finalAmount,
        tvaEnabled: s.tvaEnabled, tvaRate: s.tvaRate, tvaAmount: s.tvaAmount,
        historical: s.isHistorical,
        paid: s.paidAmount, rest: s.restAmount, createdBy: s.createdBy,
      },
      settings
    );

  const printCommand = (c: Command) =>
    printCommandOrder(
      {
        reference: c.reference,
        bonNumber: c.bonNumber,
        createdAt: c.createdAt,
        receiveDate: c.receiveDate,
        receiveHour: c.receiveHour,
        receiveMinute: c.receiveMinute,
        clientName: c.clientName,
        clientPhone: c.clientPhone,
        clientAddress: c.clientAddress,
        clientRc: client.rc, clientNif: client.nif, clientNis: client.nis, clientArticle: client.article,
        historical: c.isHistorical,
        tvaEnabled: c.tvaEnabled, tvaRate: c.tvaRate, tvaAmount: c.tvaAmount,
        totalTtc: commandTtc(c),
        driverName: c.driverName, driverPlate: c.driverPlate,
        notes: c.notes,
        lines: c.items.map((l) => ({
          productName: l.productName,
          quantity: l.quantity,
          deliveredQuantity: l.deliveredQuantity ?? 0,
          unit: l.sellByUnit ? l.sellUnit : undefined,
          unitPrice: l.unitPrice,
          totalPrice: l.totalPrice,
        })),
        totalAmount: c.totalAmount, paidAmount: c.paidAmount, restAmount: c.restAmount,
      },
      settings
    );

  const printDelivery = (h: HistoryDelivery) =>
    setTitleRequest({
      defaultTitle: h.delivery.isHistorical ? 'ANCIENNE LIVRAISON' : 'BON DE LIVRAISON',
      scope: 'delivery',
      dialogTitle: `Imprimer le bon ${h.delivery.reference}`,
      print: ({ title, endText }) => runPrintDelivery(h, title, endText),
    });

  const runPrintDelivery = (h: HistoryDelivery, docTitle: string, endText = '') => {
    const { delivery: d, command: c } = h;
    printDeliveryNote(
      {
        docTitle,
        endText,
        reference: d.reference,
        commandReference: c?.reference ?? '',
        bonNumber: c?.bonNumber,
        clientName: client.name,
        clientPhone: client.phone,
        clientAddress: c?.clientAddress ?? client.address,
        clientRc: client.rc, clientNif: client.nif, clientNis: client.nis, clientArticle: client.article,
        location: d.location || c?.clientAddress,
        historical: d.isHistorical,
        tvaEnabled: d.tvaEnabled, tvaRate: d.tvaRate, tvaAmount: d.tvaAmount,
        deliveryTotalHt: d.totalHt, deliveryTotalTtc: d.totalTtc,
        deliveryPaid: d.paidAmount, deliveryRest: d.restAmount,
        advanceApplied: d.advanceApplied, cashPaid: d.cashPaid,
        saleReference: d.saleReference,
        deliveredAt: d.deliveredAt,
        notes: d.notes,
        driverName: d.driverName || c?.driverName,
        driverPlate: d.driverPlate || c?.driverPlate,
        lines: (c?.items ?? []).map((it) => {
          const line = d.items.find(
            (l) => (l.commandItemId && l.commandItemId === it.id) || l.productName === it.productName
          );
          return {
            productName: it.productName,
            ordered: it.quantity,
            deliveredNow: line?.quantity ?? 0,
            deliveredTotal: it.deliveredQuantity ?? 0,
            unit: it.sellByUnit ? it.sellUnit : undefined,
            unitPrice: it.unitPrice,
          };
        }),
        totalAmount: c ? commandTtc(c) : h.amountHt,
        paidAmount: c?.paidAmount ?? 0,
        restAmount: c?.restAmount ?? 0,
      },
      settings
    );
  };

  const printReceipt = (p: HistoryPayment) =>
    printPaymentReceipt(
      {
        kind: 'client',
        receiptNumber: `VER-${p.id.slice(0, 8).toUpperCase()}`,
        partyName: client.name,
        partyPhone: client.phone,
        amount: p.amount,
        paidAt: p.date,
        notes: p.notes || p.origin,
        method: p.method,
        chequeNumber: p.chequeNumber,
        virementNumber: p.virementNumber,
        bankName: p.bankName,
        totalDebt: balance.billed,
        totalPaid: balance.paid + balance.credit + balance.advance,
        restAmount: Math.max(0, balance.net),
      },
      settings
    );

  /** Identite du client reprise dans le bloc « DOIT » des listes imprimees. */
  const partyLines = [
    client.address ? `ADRESSE : ${client.address}` : '',
    client.phone ? `TEL : ${client.phone}` : '',
    client.rc ? `R.C N : ${client.rc}` : '',
    client.nif ? `NIF : ${client.nif}` : '',
  ].filter(Boolean);

  /** Impression d'une liste sur le papier du bon de livraison. */
  const printList = (
    title: string,
    columns: { label: string; align?: 'left' | 'center' | 'right'; width?: string }[],
    rows: (string | number)[][],
    totalLabel?: string,
    totalValue?: string
  ) =>
    setTitleRequest({
      defaultTitle: title.toUpperCase(),
      scope: 'list',
      dialogTitle: `Imprimer — ${title}`,
      print: ({ title: chosen, endText }) => runPrintList(chosen, columns, rows, totalLabel, totalValue, endText),
    });

  const runPrintList = (
    title: string,
    columns: { label: string; align?: 'left' | 'center' | 'right'; width?: string }[],
    rows: (string | number)[][],
    totalLabel?: string,
    totalValue?: string,
    endText = ''
  ) =>
    printListDocument(
      {
        title,
        endText,
        docDate: todayISO(),
        partyLabel: 'DOIT',
        partyName: client.name,
        partyLines,
        metaLines: [`EDITE LE ${formatDate(todayISO())}`],
        tables: [
          {
            columns,
            rows: rows.map((cells) => ({ cells })),
            totals: totalLabel ? [{ label: totalLabel, value: totalValue ?? '', strong: true }] : undefined,
            emptyLabel: 'Aucune ligne',
          },
        ],
        signatures: ['Le client', 'Signature'],
        fileName: `${title.replace(/\s+/g, '_')}_${client.name.replace(/\s+/g, '_')}`,
      },
      settings
    );

  /* ------------------------------------------------------- les colonnes --- */
  const money = (v: number) => formatCurrency(v);

  const saleColumns: DataColumn<Sale>[] = [
    { key: 'ref', label: 'N facture', render: (s) => <span className="font-semibold">{s.reference}</span> },
    { key: 'date', label: 'Date', render: (s) => formatDate(s.date, language) },
    { key: 'origin', label: 'Origine', hideOnMobile: true,
      render: (s) => (
        <Badge variant={s.deliveryId ? 'info' : 'neutral'} className="text-[10px]">
          {s.deliveryId ? 'Livraison' : 'Caisse'}
        </Badge>
      ) },
    { key: 'art', label: 'Articles', align: 'right', render: (s) => s.products.length },
    { key: 'tva', label: 'TVA', align: 'right', hideOnMobile: true,
      render: (s) => (s.tvaEnabled ? money(s.tvaAmount || 0) : '—') },
    { key: 'total', label: 'Total', align: 'right', render: (s) => money(s.finalAmount) },
    { key: 'paid', label: 'Paye', align: 'right', render: (s) => <span className="text-pistachio">{money(s.paidAmount)}</span> },
    { key: 'rest', label: 'Reste', align: 'right',
      render: (s) => (
        <span className={s.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>{money(s.restAmount)}</span>
      ) },
  ];

  const saleActions = (s: Sale): ActionItem[] => [
    { label: 'Voir le detail', icon: <Eye size={15} />, onClick: () => setViewSale(s) },
    {
      label: 'Modifier', icon: <Pencil size={15} />, hidden: !can('clients', 'edit'),
      onClick: () => setEntry({ target: { kind: 'sale', id: s.id }, mode: 'edit' }),
    },
    { label: 'Imprimer', icon: <Printer size={15} />, onClick: () => printInvoice(s) },
    {
      label: 'Supprimer', icon: <Trash2 size={15} />, danger: true, hidden: !can('clients', 'delete'),
      onClick: () =>
        ask(
          'Supprimer la facture de vente',
          s.deliveryId
            ? "Cette facture provient d'un bon de livraison : le bon part avec elle, les matieres reviennent en stock et la commande repasse en « non livree »."
            : "La vente, ses lignes et son encaissement de caisse seront supprimes partout : fiche du client, caisse, compte rendu et rapports.",
          async () => { await deleteSale(s.id); toast.success('Facture supprimee'); }
        ),
    },
  ];

  const commandColumns: DataColumn<Command>[] = [
    { key: 'ref', label: 'N commande', render: (c) => <span className="font-semibold">{c.reference}</span> },
    { key: 'created', label: 'Creee le', render: (c) => formatDate(c.createdAt.slice(0, 10), language) },
    { key: 'recv', label: 'Livraison prevue', hideOnMobile: true,
      render: (c) => `${formatDate(c.receiveDate, language)} ${c.receiveHour}h${c.receiveMinute}` },
    { key: 'state', label: 'Etat', align: 'center',
      render: (c) => {
        const d = deliveryStatus(c);
        return (
          <Badge variant={d.isFull ? 'success' : d.isPartial ? 'warning' : 'danger'} className="text-[10px]">
            {d.isFull ? 'Livree' : d.isPartial ? `${d.percent.toFixed(0)} %` : 'Non livree'}
          </Badge>
        );
      } },
    { key: 'qty', label: 'Commande / livre', align: 'right', hideOnMobile: true,
      render: (c) => {
        const d = deliveryStatus(c);
        return `${d.ordered} / ${d.delivered}${d.cancelled > 0 ? ` (−${d.cancelled})` : ''}`;
      } },
    { key: 'total', label: 'Total TTC', align: 'right', render: (c) => money(commandTtc(c)) },
    { key: 'paid', label: 'Paye', align: 'right', render: (c) => <span className="text-pistachio">{money(c.paidAmount)}</span> },
    { key: 'rest', label: 'Reste', align: 'right',
      render: (c) => (
        <span className={c.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>{money(c.restAmount)}</span>
      ) },
  ];

  const commandActions = (c: Command): ActionItem[] => [
    { label: 'Voir le detail', icon: <Eye size={15} />, onClick: () => setViewCommand(c) },
    { label: 'Imprimer le bon', icon: <Printer size={15} />, onClick: () => printCommand(c) },
    {
      label: "Modifier l'acompte", icon: <Pencil size={15} />,
      hidden: !can('clients', 'edit') || !(c.advancePaid > 0),
      onClick: () => setEntry({ target: { kind: 'advance', commandId: c.id }, mode: 'edit' }),
    },
    {
      label: 'Supprimer', icon: <Trash2 size={15} />, danger: true, hidden: !can('clients', 'delete'),
      onClick: () =>
        ask(
          'Supprimer la commande',
          'La commande, ses bons de livraison, leurs factures de vente et leurs ecritures de caisse seront supprimes. Les matieres livrees reviennent en stock.',
          async () => { await deleteCommand(c.id); toast.success('Commande supprimee'); }
        ),
    },
  ];

  const deliveryColumns: DataColumn<HistoryDelivery>[] = [
    { key: 'ref', label: 'N BL', render: (h) => <span className="font-semibold">{h.delivery.reference}</span> },
    { key: 'date', label: 'Date', render: (h) => formatDateTime(h.delivery.deliveredAt, language) },
    { key: 'cmd', label: 'Commande', hideOnMobile: true, render: (h) => h.command?.reference ?? '—' },
    { key: 'loc', label: 'Lieu de livraison', hideOnMobile: true,
      render: (h) => h.delivery.location || h.command?.clientAddress || '—' },
    { key: 'qty', label: 'Quantite', align: 'right', render: (h) => h.quantity },
    { key: 'ht', label: 'Total H.T', align: 'right', render: (h) => money(h.amountHt) },
    { key: 'ttc', label: 'Total TTC', align: 'right', render: (h) => money(h.delivery.totalTtc ?? h.amountHt) },
    { key: 'rest', label: 'Reste', align: 'right',
      render: (h) => (
        <span className={(h.delivery.restAmount ?? 0) > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>
          {money(h.delivery.restAmount ?? 0)}
        </span>
      ) },
  ];

  const deliveryActions = (h: HistoryDelivery): ActionItem[] => [
    { label: 'Voir le detail', icon: <Eye size={15} />, onClick: () => setViewDelivery(h) },
    { label: 'Imprimer le bon', icon: <Printer size={15} />, onClick: () => printDelivery(h) },
    {
      label: 'Modifier', icon: <Pencil size={15} />, hidden: !can('clients', 'edit'),
      onClick: () => setEntry({ target: { kind: 'delivery', id: h.delivery.id }, mode: 'edit' }),
    },
    {
      label: 'Supprimer', icon: <Trash2 size={15} />, danger: true, hidden: !can('clients', 'delete'),
      onClick: () =>
        ask(
          'Supprimer le bon de livraison',
          'Le bon, sa facture de vente et son encaissement de caisse partent ensemble ; les matieres reviennent en stock et la commande redevient « a livrer ».',
          async () => { await deleteDelivery(h.delivery.id); toast.success('Livraison supprimee'); }
        ),
    },
  ];

  const paymentColumns: DataColumn<HistoryPayment>[] = [
    { key: 'date', label: 'Date et heure', render: (p) => formatDateTime(p.date, language) },
    { key: 'origin', label: 'Origine', render: (p) => <span className="font-semibold">{p.origin}</span> },
    { key: 'kind', label: 'Type', align: 'center', hideOnMobile: true,
      render: (p) => (
        <Badge
          variant={p.source === 'direct' ? 'success' : p.source === 'debt' ? 'warning' : 'info'}
          className="text-[10px]"
        >
          {p.source === 'direct' ? 'Versement direct'
            : p.source === 'debt' ? 'Sur dette enregistree'
            : p.source === 'advance' ? 'Acompte commande'
            : 'Encaissement facture'}
        </Badge>
      ) },
    { key: 'method', label: 'Mode de reglement', hideOnMobile: true,
      render: (p) => (p.source === 'direct' ? paymentMethodLabel(p) : '—') },
    { key: 'note', label: 'Note', hideOnMobile: true, render: (p) => p.notes || '—' },
    { key: 'amount', label: 'Montant', align: 'right',
      render: (p) => <span className="font-bold text-pistachio">{money(p.amount)}</span> },
  ];

  const paymentActions = (p: HistoryPayment): ActionItem[] => [
    { label: 'Imprimer le recu', icon: <Printer size={15} />, onClick: () => printReceipt(p) },
    {
      label: 'Modifier', icon: <Pencil size={15} />,
      hidden: p.source !== 'direct' || !can('clients', 'edit') || !p.payment,
      onClick: () => p.payment && setEditPayment(p.payment),
    },
    {
      label: 'Voir la facture', icon: <Eye size={15} />,
      hidden: p.source !== 'document',
      onClick: () => {
        const s = sales.find((x) => x.id === p.documentId);
        if (s) setViewSale(s);
      },
    },
    {
      label: 'Voir la commande', icon: <Eye size={15} />,
      hidden: p.source !== 'advance',
      onClick: () => {
        const c = commands.find((x) => x.id === p.documentId);
        if (c) setViewCommand(c);
      },
    },
    {
      label: 'Supprimer definitivement', icon: <Trash2 size={15} />, danger: true,
      hidden: !can('clients', 'delete') || p.source === 'document' || p.source === 'advance',
      onClick: () =>
        ask(
          'Supprimer le versement',
          p.source === 'debt'
            ? "Ce versement sera retire de la dette enregistree ET de la caisse. Il disparaitra aussi du compte rendu imprime."
            : "Le montant redeviendra du, l'entree de caisse sera annulee et le versement disparaitra du compte rendu.",
          async () => {
            if (p.source === 'debt' && p.debtId) await deleteDebtVersement(p.debtId, p.id);
            else await deletePayment(p.id);
            toast.success('Versement supprime');
          }
        ),
    },
    {
      label: 'Se gere sur la facture', icon: <Wallet size={15} />, disabled: true,
      hidden: p.source !== 'document',
      onClick: () => undefined,
    },
  ];

  /** Onglet « Acompte & imputations » : voir le document, annuler l'imputation. */
  const creditUseActions = (r: CreditUseRow): ActionItem[] => {
    const sale = r.kind === 'sale' ? sales.find((x) => x.id === r.id) : undefined;
    const delivery = sale?.deliveryId ? history.deliveries.concat(history.historicalDeliveries)
      .find((h) => h.delivery.id === sale.deliveryId) : undefined;
    const command = r.kind === 'command' ? commands.find((x) => x.id === r.id) : undefined;
    return [
      {
        label: 'Voir le detail', icon: <Eye size={15} />,
        onClick: () => {
          if (delivery) setViewDelivery(delivery);
          else if (sale) setViewSale(sale);
          else if (command) setViewCommand(command);
        },
      },
      {
        label: 'Voir la facture', icon: <Eye size={15} />, hidden: !delivery || !sale,
        onClick: () => sale && setViewSale(sale),
      },
      {
        label: 'Supprimer', icon: <Trash2 size={15} />, danger: true,
        hidden: !can('clients', 'delete') && !can('clients', 'edit'),
        onClick: () =>
          ask(
            "Supprimer l'imputation",
            `${formatCurrency(r.amount)} ne paieront plus « ${r.label} » : le montant revient dans l'ACOMPTE `
              + "du client et le document retrouve son reste du. Aucune ecriture de caisse (l'argent y est "
              + 'entre avec le versement) ; la dette nette du client ne change pas.',
            async () => {
              const back = await cancelCreditImputation(r.kind, r.id);
              toast.success(`Imputation supprimee — ${formatCurrency(back)} rendus a l'acompte du client`);
            }
          ),
      },
    ];
  };

  const oldDebtColumns: DataColumn<PartyOldDebt>[] = [
    { key: 'date', label: 'Date', render: (d) => formatDate(d.date, language) },
    { key: 'desc', label: 'Description', render: (d) => <span className="font-semibold">{d.description || '—'}</span> },
    { key: 'amount', label: 'Montant', align: 'right', render: (d) => money(d.amount) },
    { key: 'paid', label: 'Regle', align: 'right', render: (d) => <span className="text-pistachio">{money(d.paidAmount)}</span> },
    { key: 'rest', label: 'Reste', align: 'right',
      render: (d) => (
        <span className={d.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>{money(d.restAmount)}</span>
      ) },
  ];

  const oldDebtActions = (d: PartyOldDebt): ActionItem[] => [
    { label: 'Modifier', icon: <Pencil size={15} />, hidden: !can('clients', 'edit'),
      onClick: () => onEditOldDebt?.(client, d) },
    {
      label: 'Supprimer', icon: <Trash2 size={15} />, danger: true, hidden: !can('clients', 'delete'),
      onClick: () =>
        ask(
          "Supprimer l'ancienne dette",
          "La dette disparait du compte du client ; ce qui avait deja ete regle est reporte sur ses autres dettes.",
          async () => { await deleteOldDebt(d.id); toast.success('Ancienne dette supprimee'); }
        ),
    },
  ];

  const refundColumns: DataColumn<PartyCreditRefund>[] = [
    { key: 'date', label: 'Date et heure', render: (r) => formatDateTime(r.refundedAt, language) },
    { key: 'ref', label: 'Recu n', render: (r) => `EXC-${r.id.slice(0, 8).toUpperCase()}` },
    { key: 'method', label: 'Mode', hideOnMobile: true, render: (r) => paymentMethodLabel(r) },
    { key: 'note', label: 'Note', hideOnMobile: true, render: (r) => r.notes || '—' },
    { key: 'amount', label: 'Montant rendu', align: 'right',
      render: (r) => <span className="font-bold text-caramel">− {money(r.amount)}</span> },
  ];

  const refundActions = (r: PartyCreditRefund): ActionItem[] => [
    {
      label: 'Modifier', icon: <Pencil size={15} />, hidden: !can('clients', 'edit'),
      onClick: () => setEntry({ target: { kind: 'refund', id: r.id, party: 'client' }, mode: 'edit' }),
    },
    {
      label: 'Annuler le remboursement', icon: <Trash2 size={15} />, danger: true,
      hidden: !can('clients', 'delete'),
      onClick: () =>
        ask(
          'Annuler le remboursement',
          "L'excedent revient au compte du client et la sortie de caisse est supprimee.",
          async () => { await deleteRefund(r.id); toast.success('Remboursement annule'); }
        ),
    },
  ];

  const adjustmentColumns: DataColumn<CommandAdjustment>[] = [
    { key: 'date', label: 'Date', render: (a) => formatDate(a.date, language) },
    { key: 'type', label: 'Operation', align: 'center',
      render: (a) => (
        <Badge variant={a.type === 'cancel' ? 'danger' : 'success'} className="text-[10px]">
          {a.type === 'cancel' ? 'Annulation du reste' : 'Augmentation'}
        </Badge>
      ) },
    { key: 'cmd', label: 'Commande', render: (a) => <span className="font-semibold">{a.commandReference ?? '—'}</span> },
    { key: 'lines', label: 'Produits', hideOnMobile: true,
      render: (a) => a.lines.map((l) => `${l.productName} (${l.quantity})`).join(' · ') || '—' },
    { key: 'qty', label: 'Quantite', align: 'right',
      render: (a) => (
        <span className={a.type === 'cancel' ? 'text-rose-deep' : 'text-pistachio'}>
          {a.type === 'cancel' ? '−' : '+'}{a.totalQuantity}
        </span>
      ) },
    { key: 'amount', label: 'Valeur H.T', align: 'right',
      render: (a) => (
        <span className={a.type === 'cancel' ? 'font-bold text-rose-deep' : 'font-bold text-pistachio'}>
          {a.type === 'cancel' ? '−' : '+'}{money(a.totalAmount)}
        </span>
      ) },
    { key: 'reason', label: 'Motif', hideOnMobile: true, render: (a) => a.reason || '—' },
  ];

  const adjustmentActions = (a: CommandAdjustment): ActionItem[] => [
    {
      label: 'Voir la commande', icon: <Eye size={15} />,
      onClick: () => {
        const c = commands.find((x) => x.id === a.commandId);
        if (c) setViewCommand(c);
      },
    },
    {
      label: 'Annuler cette operation', icon: <Trash2 size={15} />, danger: true,
      hidden: !can('clients', 'delete'),
      onClick: () =>
        ask(
          a.type === 'cancel' ? "Retablir le reste annule" : "Annuler l'augmentation",
          'La commande revient aux quantites qu’elle avait avant cette operation, et la dette du client est recalculee.',
          async () => { await deleteAdjustment(a.id); toast.success('Operation annulee'); }
        ),
    },
  ];

  /* ---------------------------------------------------------- les parts --- */
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  const salesStats = (list: Sale[]): HistoryStat[] => [
    { label: 'Documents', value: String(list.length), icon: <ShoppingBag size={12} /> },
    { label: 'Total facture', value: money(sum(list.map((s) => s.finalAmount))), tone: 'accent' },
    { label: 'Total encaisse', value: money(sum(list.map((s) => s.paidAmount))), tone: 'pos' },
    { label: 'Reste du', value: money(sum(list.map((s) => s.restAmount))), tone: 'neg' },
    { label: 'Articles', value: String(sum(list.map((s) => s.products.length))) },
  ];

  const commandStats = (list: Command[]): HistoryStat[] => {
    const d = list.map(deliveryStatus);
    return [
      { label: 'Commandes', value: String(list.length), icon: <ClipboardList size={12} /> },
      { label: 'Total TTC', value: money(sum(list.map(commandTtc))), tone: 'accent' },
      { label: 'Quantite commandee', value: String(sum(d.map((x) => x.ordered))) },
      { label: 'Quantite livree', value: String(sum(d.map((x) => x.delivered))), tone: 'pos' },
      { label: 'Reste du', value: money(sum(list.map((c) => c.restAmount))), tone: 'neg' },
    ];
  };

  const deliveryStats = (list: HistoryDelivery[]): HistoryStat[] => [
    { label: 'Bons de livraison', value: String(list.length), icon: <Truck size={12} /> },
    { label: 'Quantite remise', value: String(sum(list.map((h) => h.quantity))) },
    { label: 'Valeur H.T', value: money(sum(list.map((h) => h.amountHt))), tone: 'accent' },
    { label: 'Encaisse', value: money(sum(list.map((h) => h.delivery.paidAmount ?? 0))), tone: 'pos' },
    { label: 'Reste du', value: money(sum(list.map((h) => h.delivery.restAmount ?? 0))), tone: 'neg' },
  ];

  // L'onglet « Versements » ne montre QUE les versements directs saisis sur la
  // carte du client — encaissements sur vente/livraison, versements sur dette
  // et acomptes de commande en sont exclus, comme dans le compte rendu.
  const directPayments = history.payments.filter((p) => p.source === 'direct');
  const directTotal = sum(directPayments.map((p) => p.amount));

  const sections: HistorySection<never>[] = [
    {
      key: 'sales', label: 'Ventes', icon: <ShoppingBag size={14} />,
      rows: history.sales as never[],
      columns: saleColumns as DataColumn<never>[],
      actions: saleActions as unknown as (row: never, i: number) => ActionItem[],
      stats: salesStats(history.sales),
      dateOf: (s: never) => (s as unknown as Sale).date,
      searchOf: (s: never) => {
        const x = s as unknown as Sale;
        return `${x.reference} ${x.bonNumber ?? ''} ${x.products.map((p) => p.productName).join(' ')}`;
      },
      empty: 'Aucune vente pour ce client',
      note: "Factures de caisse ET factures nees d'un bon de livraison — la livraison est une vente.",
      onPrintAll: (rows: never[]) => {
        const list = rows as unknown as Sale[];
        printList(
          'Liste des ventes',
          [
            { label: 'Date', align: 'center', width: '13%' },
            { label: 'Designation', align: 'left' },
            { label: 'Articles', align: 'center', width: '10%' },
            { label: 'Paye', align: 'right', width: '18%' },
            { label: 'Total', align: 'right', width: '18%' },
          ],
          list.map((s) => [
            formatDate(s.date), `FACTURE ${s.reference}`, s.products.length,
            formatCurrency(s.paidAmount), formatCurrency(s.finalAmount),
          ]),
          'Total des ventes',
          formatCurrency(sum(list.map((s) => s.finalAmount)))
        );
      },
    },
    {
      key: 'commands', label: 'Commandes', icon: <ClipboardList size={14} />,
      rows: history.commands as never[],
      columns: commandColumns as DataColumn<never>[],
      actions: commandActions as unknown as (row: never, i: number) => ActionItem[],
      stats: commandStats(history.commands),
      dateOf: (c: never) => (c as unknown as Command).createdAt,
      searchOf: (c: never) => {
        const x = c as unknown as Command;
        return `${x.reference} ${x.bonNumber ?? ''} ${x.items.map((i) => i.productName).join(' ')}`;
      },
      empty: 'Aucune commande pour ce client',
      onPrintAll: (rows: never[]) => {
        const list = rows as unknown as Command[];
        printList(
          'Liste des commandes',
          [
            { label: 'Date', align: 'center', width: '13%' },
            { label: 'Designation', align: 'left' },
            { label: 'Quantite', align: 'center', width: '12%' },
            { label: 'Paye', align: 'right', width: '18%' },
            { label: 'Total TTC', align: 'right', width: '18%' },
          ],
          list.map((c) => [
            formatDate(c.createdAt.slice(0, 10)), `COMMANDE ${c.reference}`,
            deliveryStatus(c).ordered, formatCurrency(c.paidAmount), formatCurrency(commandTtc(c)),
          ]),
          'Total des commandes',
          formatCurrency(sum(list.map(commandTtc)))
        );
      },
    },
    {
      key: 'deliveries', label: 'Livraisons', icon: <Truck size={14} />,
      rows: history.deliveries as never[],
      columns: deliveryColumns as DataColumn<never>[],
      actions: deliveryActions as unknown as (row: never, i: number) => ActionItem[],
      stats: deliveryStats(history.deliveries),
      dateOf: (h: never) => (h as unknown as HistoryDelivery).delivery.deliveredAt,
      searchOf: (h: never) => {
        const x = h as unknown as HistoryDelivery;
        return `${x.delivery.reference} ${x.command?.reference ?? ''} ${x.delivery.location ?? ''} ${x.delivery.items.map((i) => i.productName).join(' ')}`;
      },
      empty: 'Aucun bon de livraison pour ce client',
      onPrintAll: (rows: never[]) => {
        const list = rows as unknown as HistoryDelivery[];
        printList(
          'Bon de livraison',
          [
            { label: 'Date', align: 'center', width: '12%' },
            { label: 'Designation', align: 'left' },
            { label: 'Adresse de livraison', align: 'left', width: '22%' },
            { label: 'Quantite', align: 'center', width: '11%' },
            { label: 'P.T H.T', align: 'right', width: '18%' },
          ],
          list.flatMap((h) =>
            h.delivery.items.map((it) => {
              const line = h.command?.items.find(
                (x) => (it.commandItemId && x.id === it.commandItemId) || x.productName === it.productName
              );
              return [
                formatDate(h.delivery.deliveredAt.slice(0, 10)),
                it.productName.toUpperCase(),
                (h.delivery.location || h.command?.clientAddress || '/').toUpperCase(),
                it.quantity,
                formatCurrency(it.quantity * (line?.unitPrice ?? 0)),
              ];
            })
          ),
          'Total livre H.T',
          formatCurrency(sum(list.map((h) => h.amountHt)))
        );
      },
    },
    {
      key: 'payments', label: 'Versements', icon: <Coins size={14} />,
      rows: directPayments as never[],
      columns: paymentColumns as DataColumn<never>[],
      actions: paymentActions as unknown as (row: never, i: number) => ActionItem[],
      stats: [
        { label: 'Versements directs', value: String(directPayments.length), icon: <Coins size={12} /> },
        { label: 'Total verse', value: money(directTotal), tone: 'accent' },
      ],
      dateOf: (p: never) => (p as unknown as HistoryPayment).date,
      searchOf: (p: never) => {
        const x = p as unknown as HistoryPayment;
        return `${x.origin} ${x.notes ?? ''} ${x.documentRef ?? ''} ${x.amount}`;
      },
      empty: 'Aucun versement direct enregistre pour ce client',
      note:
        "Uniquement les versements directs saisis sur la carte du client — c'est EXACTEMENT ce que le compte rendu "
        + 'additionne ; supprimer une ligne ici la retire aussi du compte rendu.',
      onPrintAll: (rows: never[]) => {
        const list = rows as unknown as HistoryPayment[];
        printList(
          'Liste des versements',
          [
            { label: 'Date', align: 'center', width: '16%' },
            { label: 'Designation', align: 'left' },
            { label: 'Mode', align: 'left', width: '20%' },
            { label: 'Montant', align: 'right', width: '20%' },
          ],
          list.map((p) => [
            formatDate(p.date.slice(0, 10)), p.origin.toUpperCase(),
            p.source === 'direct' ? paymentMethodLabel(p).toUpperCase() : '/',
            formatCurrency(p.amount),
          ]),
          'Total verse',
          formatCurrency(sum(list.map((p) => p.amount)))
        );
      },
    },
    {
      key: 'credit', label: 'Acompte & imputations', icon: <PiggyBank size={14} />,
      rows: creditUses as never[],
      columns: [
        { key: 'date', label: 'Date', render: (r: CreditUseRow) => formatDate(r.date, language) },
        { key: 'label', label: 'Document paye', render: (r: CreditUseRow) => <span className="font-semibold">{r.label}</span> },
        { key: 'total', label: 'Total du document', align: 'right', render: (r: CreditUseRow) => money(r.documentTotal) },
        {
          key: 'amount', label: 'Paye par le compte du client', align: 'right',
          render: (r: CreditUseRow) => <span className="font-bold text-pistachio">{money(r.amount)}</span>,
        },
      ] as DataColumn<never>[],
      actions: creditUseActions as unknown as (row: never, i: number) => ActionItem[],
      stats: [
        { label: 'Acompte disponible', value: money(balance.credit), tone: 'pos', icon: <PiggyBank size={12} /> },
        { label: 'Acompte sur commandes', value: money(balance.advance), tone: 'pos' },
        { label: 'Imputations', value: String(creditUses.length) },
        { label: 'Total impute', value: money(sum(creditUses.map((r) => r.amount))), tone: 'accent' },
      ],
      dateOf: (r: never) => (r as unknown as CreditUseRow).date,
      searchOf: (r: never) => {
        const x = r as unknown as CreditUseRow;
        return `${x.reference} ${x.label}`;
      },
      empty: "Aucun document paye par le compte du client (versement en trop ou acompte)",
      note:
        "Quand le client verse PLUS que sa dette, l'excedent devient son ACOMPTE : il s'affiche sur sa carte et "
        + "paie ses prochaines ventes, livraisons ou commandes. Cet onglet montre ce que cet argent a deja paye.",
    },
    {
      key: 'oldSales', label: 'Anciennes ventes', icon: <History size={14} />,
      rows: history.historicalSales as never[],
      columns: saleColumns as DataColumn<never>[],
      actions: saleActions as unknown as (row: never, i: number) => ActionItem[],
      stats: salesStats(history.historicalSales),
      dateOf: (s: never) => (s as unknown as Sale).date,
      searchOf: (s: never) => (s as unknown as Sale).reference,
      empty: 'Aucune ancienne vente saisie pour ce client',
      note: 'Ventes anterieures au logiciel : ni le stock ni la caisse ne les ont vues passer.',
    },
    {
      key: 'oldCommands', label: 'Anciennes commandes', icon: <History size={14} />,
      rows: history.historicalCommands as never[],
      columns: commandColumns as DataColumn<never>[],
      actions: commandActions as unknown as (row: never, i: number) => ActionItem[],
      stats: commandStats(history.historicalCommands),
      dateOf: (c: never) => (c as unknown as Command).createdAt,
      searchOf: (c: never) => (c as unknown as Command).reference,
      empty: 'Aucune ancienne commande saisie pour ce client',
    },
    {
      key: 'oldDeliveries', label: 'Anciennes livraisons', icon: <History size={14} />,
      rows: history.historicalDeliveries as never[],
      columns: deliveryColumns as DataColumn<never>[],
      actions: deliveryActions as unknown as (row: never, i: number) => ActionItem[],
      stats: deliveryStats(history.historicalDeliveries),
      dateOf: (h: never) => (h as unknown as HistoryDelivery).delivery.deliveredAt,
      searchOf: (h: never) => (h as unknown as HistoryDelivery).delivery.reference,
      empty: 'Aucune ancienne livraison pour ce client',
    },
    {
      key: 'oldDebts', label: 'Anciennes dettes', icon: <Wallet size={14} />,
      rows: history.oldDebts as never[],
      columns: oldDebtColumns as DataColumn<never>[],
      actions: oldDebtActions as unknown as (row: never, i: number) => ActionItem[],
      stats: [
        { label: 'Ardoises', value: String(history.oldDebts.length), icon: <History size={12} /> },
        { label: 'Total', value: money(sum(history.oldDebts.map((d) => d.amount))), tone: 'accent' },
        { label: 'Regle', value: money(sum(history.oldDebts.map((d) => d.paidAmount))), tone: 'pos' },
        { label: 'Reste du', value: money(sum(history.oldDebts.map((d) => d.restAmount))), tone: 'neg' },
      ],
      dateOf: (d: never) => (d as unknown as PartyOldDebt).date,
      searchOf: (d: never) => (d as unknown as PartyOldDebt).description ?? '',
      empty: 'Aucune ancienne dette pour ce client',
      note: "Ardoises anterieures au logiciel — aucune ecriture de caisse a leur saisie.",
      onPrintAll: (rows: never[]) => {
        const list = rows as unknown as PartyOldDebt[];
        printList(
          'Anciennes dettes',
          [
            { label: 'Date', align: 'center', width: '16%' },
            { label: 'Designation', align: 'left' },
            { label: 'Regle', align: 'right', width: '20%' },
            { label: 'Reste', align: 'right', width: '20%' },
          ],
          list.map((d) => [
            formatDate(d.date), (d.description || 'ANCIENNE DETTE').toUpperCase(),
            formatCurrency(d.paidAmount), formatCurrency(d.restAmount),
          ]),
          'Total reste du',
          formatCurrency(sum(list.map((d) => d.restAmount)))
        );
      },
    },
    {
      key: 'refunds', label: 'Excedents rendus', icon: <Undo2 size={14} />,
      rows: history.refunds as never[],
      columns: refundColumns as DataColumn<never>[],
      actions: refundActions as unknown as (row: never, i: number) => ActionItem[],
      stats: [
        { label: 'Remboursements', value: String(history.refunds.length), icon: <Undo2 size={12} /> },
        { label: 'Total rendu', value: money(sum(history.refunds.map((r) => r.amount))), tone: 'neg' },
      ],
      dateOf: (r: never) => (r as unknown as PartyCreditRefund).refundedAt,
      searchOf: (r: never) => (r as unknown as PartyCreditRefund).notes ?? '',
      empty: 'Aucun excedent rendu a ce client',
    },
    {
      key: 'adjustments', label: 'Annulations / augmentations', icon: <ScissorsSquare size={14} />,
      rows: history.adjustments as never[],
      columns: adjustmentColumns as DataColumn<never>[],
      actions: adjustmentActions as unknown as (row: never, i: number) => ActionItem[],
      stats: [
        { label: 'Operations', value: String(history.adjustments.length), icon: <ScissorsSquare size={12} /> },
        {
          label: 'Quantite annulee',
          value: String(sum(history.adjustments.filter((a) => a.type === 'cancel').map((a) => a.totalQuantity))),
          tone: 'neg',
        },
        {
          label: 'Valeur annulee',
          value: money(sum(history.adjustments.filter((a) => a.type === 'cancel').map((a) => a.totalAmount))),
          tone: 'neg',
        },
        {
          label: 'Quantite ajoutee',
          value: String(sum(history.adjustments.filter((a) => a.type === 'increase').map((a) => a.totalQuantity))),
          tone: 'pos',
        },
        {
          label: 'Valeur ajoutee',
          value: money(sum(history.adjustments.filter((a) => a.type === 'increase').map((a) => a.totalAmount))),
          tone: 'pos',
        },
      ],
      dateOf: (a: never) => (a as unknown as CommandAdjustment).date,
      searchOf: (a: never) => {
        const x = a as unknown as CommandAdjustment;
        return `${x.commandReference ?? ''} ${x.reason ?? ''} ${x.lines.map((l) => l.productName).join(' ')}`;
      },
      empty: 'Aucune annulation ni augmentation sur les commandes de ce client',
      note:
        "Le client a renonce au solde d'une commande, ou en a redemande : l'ecart est archive ici et repris "
        + 'dans le rapport general.',
    },
  ];

  const headline: HistoryStat[] = [
    { label: 'Total facture', value: money(balance.billed), tone: 'accent' },
    { label: 'Total encaisse', value: money(balance.paid), tone: 'pos' },
    { label: 'Reste du', value: money(balance.rest), tone: 'neg' },
    { label: 'Acompte (avance + commandes)', value: money(balance.credit + balance.advance), tone: 'pos' },
    {
      label: balance.hasCredit ? 'Solde en sa faveur' : 'Solde net',
      value: balance.hasCredit ? `+ ${money(balance.creditToReturn)}` : money(Math.max(0, balance.net)),
      tone: balance.hasCredit ? 'pos' : 'neg',
    },
    { label: 'Commandes non livrees', value: money(balance.pendingCommands), tone: 'accent' },
  ];

  return (
    <>
      <PartyHistoryModal
        open={isOpen}
        onClose={onClose}
        title={`Historique — ${client.name}`}
        subtitle={`${client.phone || 'sans telephone'}${client.address ? ` · ${client.address}` : ''}`}
        headline={headline}
        sections={sections}
        headerActions={
          <>
            {can('clients', 'pay') && onNewVersement && (
              <Button size="sm" variant="gold" onClick={() => onNewVersement(client)}>
                <HandCoins size={15} /> Versement
              </Button>
            )}
            {can('clients', 'create') && onNewOldDebt && (
              <Button size="sm" variant="secondary" onClick={() => onNewOldDebt(client)}>
                <History size={15} /> Ancienne dette
              </Button>
            )}
            {balance.credit > 0 && can('clients', 'pay') && onRefund && (
              <Button size="sm" variant="mint" onClick={() => onRefund(client)}>
                <Undo2 size={15} /> Rendre {money(balance.credit)}
              </Button>
            )}
            {onStatement && (
              <Button size="sm" variant="secondary" onClick={() => onStatement(client)}>
                <TrendingUp size={15} /> Compte rendu
              </Button>
            )}
          </>
        }
      />

      {/* ------------------------------------------------ detail d'une vente */}
      <Modal open={!!viewSale} onClose={() => setViewSale(null)} title={`Vente ${viewSale?.reference ?? ''}`} size="lg">
        {viewSale && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Date" value={formatDateTime(viewSale.date, language)} />
              <Tile label="Origine" value={viewSale.deliveryId ? 'Bon de livraison' : 'Caisse'} />
              <Tile label="N de bon" value={viewSale.bonNumber || '—'} />
              <Tile label="Saisie par" value={viewSale.createdBy || '—'} />
            </div>
            <div className="overflow-x-auto rounded-xl border border-gold/15">
              <table className="w-full text-sm">
                <thead className="bg-vanilla/60 text-text-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left">Produit</th>
                    <th className="px-3 py-2 text-right">Qte</th>
                    <th className="px-3 py-2 text-right">Prix catalogue</th>
                    <th className="px-3 py-2 text-right">Prix applique</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {viewSale.products.map((l, i) => (
                    <tr key={i} className="border-t border-gold/10">
                      <td className="px-3 py-2 font-medium">{l.productName}</td>
                      <td className="px-3 py-2 text-right tabular">{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                      <td className="px-3 py-2 text-right tabular text-text-muted">
                        {l.basePrice !== undefined ? money(l.basePrice) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular font-bold text-gold-dark">{money(l.sellingPrice)}</td>
                      <td className="px-3 py-2 text-right tabular">{money(l.quantity * l.sellingPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Total brut" value={money(viewSale.totalAmount)} />
              <Tile label="Reduction" value={money(viewSale.reduction)} />
              {viewSale.tvaEnabled && <Tile label={`TVA ${viewSale.tvaRate} %`} value={money(viewSale.tvaAmount || 0)} />}
              <Tile label="Net a payer" value={money(viewSale.finalAmount)} />
              <Tile label="Paye" value={money(viewSale.paidAmount)} color="text-pistachio" />
              <Tile label="Reste" value={money(viewSale.restAmount)} color="text-rose-deep" />
            </div>
            {viewSale.payments.length > 0 && (
              <div className="rounded-xl border border-gold/15 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">Encaissements</p>
                {viewSale.payments.map((p, i) => (
                  <div key={i} className="flex justify-between border-b border-gold/10 py-1 text-xs last:border-0">
                    <span>{formatDate(p.date, language)} — {p.description || 'Reglement'}</span>
                    <span className="font-bold tabular text-pistachio">{money(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <Button variant="gold" className="w-full" onClick={() => printInvoice(viewSale)}>
              <Printer size={16} /> Imprimer la facture
            </Button>
          </div>
        )}
      </Modal>

      {/* -------------------------------------------- detail d'une commande */}
      <Modal open={!!viewCommand} onClose={() => setViewCommand(null)} title={`Commande ${viewCommand?.reference ?? ''}`} size="lg">
        {viewCommand && (() => {
          const d = deliveryStatus(viewCommand);
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile label="Creee le" value={formatDateTime(viewCommand.createdAt, language)} />
                <Tile label="Livraison prevue" value={`${formatDate(viewCommand.receiveDate, language)} ${viewCommand.receiveHour}h${viewCommand.receiveMinute}`} />
                <Tile label="Adresse" value={viewCommand.clientAddress || '—'} />
                <Tile label="Chauffeur" value={viewCommand.driverName || '—'} />
              </div>
              <div className="overflow-x-auto rounded-xl border border-gold/15">
                <table className="w-full text-sm">
                  <thead className="bg-vanilla/60 text-text-secondary">
                    <tr>
                      <th className="px-3 py-2 text-left">Produit</th>
                      <th className="px-3 py-2 text-right">Commande</th>
                      <th className="px-3 py-2 text-right">Livre</th>
                      <th className="px-3 py-2 text-right">Annule</th>
                      <th className="px-3 py-2 text-right">Prix U</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewCommand.items.map((it, i) => (
                      <tr key={i} className="border-t border-gold/10">
                        <td className="px-3 py-2 font-medium">{it.productName}</td>
                        <td className="px-3 py-2 text-right tabular">{it.quantity}</td>
                        <td className="px-3 py-2 text-right tabular text-pistachio">{it.deliveredQuantity ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular text-rose-deep">{it.cancelledQuantity ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular">{money(it.unitPrice)}</td>
                        <td className="px-3 py-2 text-right tabular font-bold">{money(it.totalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile label="Total H.T" value={money(viewCommand.totalAmount)} />
                {viewCommand.tvaEnabled && <Tile label={`TVA ${viewCommand.tvaRate} %`} value={money(viewCommand.tvaAmount || 0)} />}
                <Tile label="Total TTC" value={money(commandTtc(viewCommand))} />
                <Tile label="Acompte" value={money(viewCommand.advancePaid)} color="text-pistachio" />
                <Tile label="Paye" value={money(viewCommand.paidAmount)} color="text-pistachio" />
                <Tile label="Reste" value={money(viewCommand.restAmount)} color="text-rose-deep" />
                <Tile label="Avancement" value={`${d.percent.toFixed(0)} %`} />
              </div>
              <Button variant="gold" className="w-full" onClick={() => printCommand(viewCommand)}>
                <Printer size={16} /> Imprimer le bon de commande
              </Button>
            </div>
          );
        })()}
      </Modal>

      {/* ------------------------------------------- detail d'une livraison */}
      <Modal open={!!viewDelivery} onClose={() => setViewDelivery(null)} title={`Livraison ${viewDelivery?.delivery.reference ?? ''}`} size="lg">
        {viewDelivery && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Remise le" value={formatDateTime(viewDelivery.delivery.deliveredAt, language)} />
              <Tile label="Commande" value={viewDelivery.command?.reference ?? '—'} />
              <Tile label="Lieu" value={viewDelivery.delivery.location || '—'} />
              <Tile label="Chauffeur" value={viewDelivery.delivery.driverName || '—'} />
              <Tile label="Facture generee" value={viewDelivery.delivery.saleReference || '—'} />
              <Tile label="Acompte impute" value={money(viewDelivery.delivery.advanceApplied ?? 0)} />
              <Tile label="Encaisse" value={money(viewDelivery.delivery.cashPaid ?? 0)} color="text-pistachio" />
              <Tile label="Reste" value={money(viewDelivery.delivery.restAmount ?? 0)} color="text-rose-deep" />
            </div>
            <div className="overflow-x-auto rounded-xl border border-gold/15">
              <table className="w-full text-sm">
                <thead className="bg-vanilla/60 text-text-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left">Produit remis</th>
                    <th className="px-3 py-2 text-right">Quantite</th>
                    <th className="px-3 py-2 text-right">Prix U</th>
                    <th className="px-3 py-2 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {viewDelivery.delivery.items.map((it, i) => {
                    const line = viewDelivery.command?.items.find(
                      (x) => (it.commandItemId && x.id === it.commandItemId) || x.productName === it.productName
                    );
                    return (
                      <tr key={i} className="border-t border-gold/10">
                        <td className="px-3 py-2 font-medium">{it.productName}</td>
                        <td className="px-3 py-2 text-right tabular">{it.quantity}{it.sellUnit ? ` ${it.sellUnit}` : ''}</td>
                        <td className="px-3 py-2 text-right tabular">{money(line?.unitPrice ?? 0)}</td>
                        <td className="px-3 py-2 text-right tabular font-bold">{money(it.quantity * (line?.unitPrice ?? 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(viewDelivery.delivery.consumptions ?? []).length > 0 && (
              <div className="rounded-xl border border-gold/15 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-muted">
                  <Package size={13} /> Matieres retirees du stock
                </p>
                {(viewDelivery.delivery.consumptions ?? []).map((c) => (
                  <div key={c.id} className="flex justify-between border-b border-gold/10 py-1 text-xs last:border-0">
                    <span>{c.productName} — {c.quantity}{c.unit ? ` ${c.unit}` : ''}</span>
                    <span className="font-bold tabular text-rose-deep">{money(c.lineCost)}</span>
                  </div>
                ))}
              </div>
            )}
            <Button variant="gold" className="w-full" onClick={() => printDelivery(viewDelivery)}>
              <Printer size={16} /> Imprimer le bon de livraison
            </Button>
          </div>
        )}
      </Modal>

      <EditSaleModal
        sale={editSale}
        onClose={() => setEditSale(null)}
        onSave={async (data) => {
          if (!editSale) return;
          await updateSale(editSale.id, data);
          toast.success('Facture modifiee — la fiche du client et la caisse ont suivi');
          setEditSale(null);
        }}
      />

      <EditPaymentModal
        payment={editPayment}
        onClose={() => setEditPayment(null)}
        onSave={async (amount, paidAt, notes, method) => {
          if (!editPayment) return;
          await updatePayment(editPayment.id, amount, paidAt, notes, method);
          toast.success('Versement modifie — la dette du client a ete recalculee');
          setEditPayment(null);
        }}
      />

      <PrintTitleDialog request={titleRequest} onClose={() => setTitleRequest(null)} />
      <EntryEditor request={entry} onClose={() => setEntry(null)} />

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ''}
        message={confirm?.message}
        onConfirm={() => {
          const run = confirm?.run;
          setConfirm(null);
          if (run) void run().catch((e) => toast.error((e as Error).message));
        }}
      />
    </>
  );
}

function Tile({ label, value, color = 'text-text-primary' }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-gold/10 bg-vanilla/40 p-2.5 text-center">
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-[13px] font-bold tabular ${color}`}>{value}</p>
    </div>
  );
}
