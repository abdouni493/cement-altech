import { useMemo, useState } from 'react';
import {
  HandCoins, History, Undo2, Eye, Pencil, Printer, Trash2, Wallet, Coins,
  Package, TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import type { DataColumn } from '@/components/ui/DataTable';
import type { ActionItem } from '@/components/ui/ActionMenu';
import { PartyHistoryModal, type HistorySection, type HistoryStat } from './PartyHistoryModal';
import { EditPaymentModal } from './EditPaymentModal';
import { useSupplierStore } from '@/store/supplierStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useLanguage } from '@/hooks/useLanguage';
import { buildSupplierHistory, type HistoryPayment } from '@/lib/partyHistory';
import { computePartyBalance } from '@/lib/partyBalance';
import { formatCurrency, formatDate, formatDateTime, paymentMethodLabel, todayISO } from '@/lib/utils';
import { printInvoice } from '@/lib/print';
import { printPaymentReceipt } from '@/lib/documents';
import { printListDocument } from '@/lib/statementPrint';
import type {
  Supplier, PartyOldDebt, PartyPayment, Purchase, PartyCreditRefund,
} from '@/types';

/* ============================================================================
 *  HISTORIQUE COMPLET D'UN FOURNISSEUR
 * ----------------------------------------------------------------------------
 *  Meme fenetre que celle du client, avec les parties du fournisseur :
 *     Achats · Versements · Anciens achats · Anciennes dettes ·
 *     Excedents recuperes
 *
 *  Comme pour le client, l'onglet « Versements » reunit les DEUX gisements
 *  d'argent (reglement direct saisi sur sa carte et reglement porte par une
 *  facture d'achat) : ce qui est affiche est ce qui est compte par le compte
 *  rendu imprime.
 * ========================================================================== */

interface Props {
  supplier: Supplier | null;
  onClose: () => void;
  onNewVersement?: (s: Supplier) => void;
  onNewOldDebt?: (s: Supplier) => void;
  onEditOldDebt?: (s: Supplier, d: PartyOldDebt) => void;
  onRefund?: (s: Supplier) => void;
  onStatement?: (s: Supplier) => void;
  onEditPurchase?: (p: Purchase) => void;
}

export function SupplierHistoryScreen({
  supplier, onClose, onNewVersement, onNewOldDebt, onEditOldDebt, onRefund,
  onStatement, onEditPurchase,
}: Props) {
  const { can } = usePermissions();
  const { language } = useLanguage();
  const settings = useSettingsStore((s) => s.settings);

  const suppliers = useSupplierStore((s) => s.suppliers);
  const payments = useSupplierStore((s) => s.payments);
  const oldDebts = useSupplierStore((s) => s.oldDebts);
  const refunds = useSupplierStore((s) => s.refunds);
  const updatePayment = useSupplierStore((s) => s.updatePayment);
  const deletePayment = useSupplierStore((s) => s.deletePayment);
  const deleteOldDebt = useSupplierStore((s) => s.deleteOldDebt);
  const deleteRefund = useSupplierStore((s) => s.deleteRefund);

  const purchases = usePurchaseStore((s) => s.purchases);
  const deletePurchase = usePurchaseStore((s) => s.deletePurchase);

  const [viewPurchase, setViewPurchase] = useState<Purchase | null>(null);
  const [editPayment, setEditPayment] = useState<PartyPayment | null>(null);
  const [confirm, setConfirm] = useState<
    { title: string; message?: string; run: () => Promise<void> } | null
  >(null);

  const history = useMemo(() => {
    if (!supplier) return null;
    return buildSupplierHistory({
      supplierId: supplier.id, purchases, payments, oldDebts, refunds,
    });
  }, [supplier, purchases, payments, oldDebts, refunds]);

  const balance = useMemo(() => {
    if (!supplier) return null;
    const ps = purchases.filter((p) => p.supplierId === supplier.id);
    return computePartyBalance({
      documentsBilled: ps.reduce((s, x) => s + x.totalAmount, 0),
      documentsPaid: ps.reduce((s, x) => s + x.paidAmount, 0),
      documentsRest: ps.reduce((s, x) => s + x.restAmount, 0),
      oldDebts: oldDebts.filter((d) => d.partyId === supplier.id),
      credit: suppliers.find((x) => x.id === supplier.id)?.creditAmount ?? 0,
    });
  }, [supplier, purchases, oldDebts, suppliers]);

  if (!supplier || !history || !balance) return null;

  const money = (v: number) => formatCurrency(v);
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const ask = (title: string, message: string, run: () => Promise<void>) =>
    setConfirm({ title, message, run });

  const partyLines = [
    supplier.address ? `ADRESSE : ${supplier.address}` : '',
    supplier.phone ? `TEL : ${supplier.phone}` : '',
  ].filter(Boolean);

  const printPurchase = (p: Purchase) =>
    printInvoice(
      {
        type: 'purchase', reference: p.reference, date: p.date,
        partyName: supplier.name, partyPhone: supplier.phone, partyAddress: supplier.address,
        bonNumber: p.bonNumber, driverPlate: p.driverPlate, historical: p.isHistorical,
        lines: p.products.map((l) => ({
          designation: l.productName || '', quantity: l.quantity, unitPrice: l.purchasePrice, unit: l.unit,
        })),
        total: p.totalAmount, paid: p.paidAmount, rest: p.restAmount,
      },
      settings
    );

  const printReceipt = (p: HistoryPayment) =>
    printPaymentReceipt(
      {
        kind: 'supplier',
        receiptNumber: `REG-${p.id.slice(0, 8).toUpperCase()}`,
        partyName: supplier.name,
        partyPhone: supplier.phone,
        amount: p.amount,
        paidAt: p.date,
        notes: p.notes || p.origin,
        method: p.method,
        chequeNumber: p.chequeNumber,
        virementNumber: p.virementNumber,
        bankName: p.bankName,
        totalDebt: balance.billed,
        totalPaid: balance.paid,
        restAmount: balance.rest,
      },
      settings
    );

  const printList = (
    title: string,
    columns: { label: string; align?: 'left' | 'center' | 'right'; width?: string }[],
    rows: (string | number)[][],
    totalLabel?: string,
    totalValue?: string
  ) =>
    printListDocument(
      {
        title,
        docDate: todayISO(),
        partyLabel: 'FOURNISSEUR',
        partyName: supplier.name,
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
        signatures: ['Le fournisseur', 'Signature'],
        fileName: `${title.replace(/\s+/g, '_')}_${supplier.name.replace(/\s+/g, '_')}`,
      },
      settings
    );

  const purchaseColumns: DataColumn<Purchase>[] = [
    { key: 'ref', label: 'N facture', render: (p) => <span className="font-semibold">{p.reference}</span> },
    { key: 'date', label: 'Date', render: (p) => formatDate(p.date, language) },
    { key: 'bon', label: 'N bon', hideOnMobile: true, render: (p) => p.bonNumber || '—' },
    { key: 'plate', label: 'Matricule', hideOnMobile: true, render: (p) => p.driverPlate || '—' },
    { key: 'art', label: 'Articles', align: 'right', render: (p) => p.products.length },
    { key: 'total', label: 'Total', align: 'right', render: (p) => money(p.totalAmount) },
    { key: 'paid', label: 'Regle', align: 'right', render: (p) => <span className="text-pistachio">{money(p.paidAmount)}</span> },
    { key: 'rest', label: 'Reste', align: 'right',
      render: (p) => (
        <span className={p.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>{money(p.restAmount)}</span>
      ) },
  ];

  const purchaseActions = (p: Purchase): ActionItem[] => [
    { label: 'Voir le detail', icon: <Eye size={15} />, onClick: () => setViewPurchase(p) },
    { label: 'Modifier', icon: <Pencil size={15} />, hidden: !can('suppliers', 'edit') || !onEditPurchase,
      onClick: () => onEditPurchase?.(p) },
    { label: 'Imprimer', icon: <Printer size={15} />, onClick: () => printPurchase(p) },
    {
      label: 'Supprimer', icon: <Trash2 size={15} />, danger: true, hidden: !can('suppliers', 'delete'),
      onClick: () =>
        ask(
          "Supprimer la facture d'achat",
          "La facture, ses lignes, ses reglements et l'ecriture de caisse partent ensemble ; le stock alimente par cette facture est repris.",
          async () => { await deletePurchase(p.id); toast.success('Facture supprimee'); }
        ),
    },
  ];

  const paymentColumns: DataColumn<HistoryPayment>[] = [
    { key: 'date', label: 'Date et heure', render: (p) => formatDateTime(p.date, language) },
    { key: 'origin', label: 'Origine', render: (p) => <span className="font-semibold">{p.origin}</span> },
    { key: 'kind', label: 'Type', align: 'center', hideOnMobile: true,
      render: (p) => (
        <Badge variant={p.source === 'direct' ? 'success' : 'info'} className="text-[10px]">
          {p.source === 'direct' ? 'Reglement direct' : 'Reglement sur facture'}
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
      hidden: p.source !== 'direct' || !can('suppliers', 'edit') || !p.payment,
      onClick: () => p.payment && setEditPayment(p.payment),
    },
    {
      label: 'Voir la facture', icon: <Eye size={15} />, hidden: p.source !== 'document',
      onClick: () => {
        const found = purchases.find((x) => x.id === p.documentId);
        if (found) setViewPurchase(found);
      },
    },
    {
      label: 'Supprimer definitivement', icon: <Trash2 size={15} />, danger: true,
      hidden: p.source !== 'direct' || !can('suppliers', 'delete'),
      onClick: () =>
        ask(
          'Supprimer le reglement',
          "Le montant redeviendra du au fournisseur, la sortie de caisse sera annulee et le reglement disparaitra du compte rendu.",
          async () => { await deletePayment(p.id); toast.success('Reglement supprime'); }
        ),
    },
  ];

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
    { label: 'Modifier', icon: <Pencil size={15} />, hidden: !can('suppliers', 'edit'),
      onClick: () => onEditOldDebt?.(supplier, d) },
    {
      label: 'Supprimer', icon: <Trash2 size={15} />, danger: true, hidden: !can('suppliers', 'delete'),
      onClick: () =>
        ask(
          "Supprimer l'ancienne dette",
          "La dette disparait du compte du fournisseur ; ce qui avait deja ete regle est reporte sur ses autres dettes.",
          async () => { await deleteOldDebt(d.id); toast.success('Ancienne dette supprimee'); }
        ),
    },
  ];

  const refundColumns: DataColumn<PartyCreditRefund>[] = [
    { key: 'date', label: 'Date et heure', render: (r) => formatDateTime(r.refundedAt, language) },
    { key: 'ref', label: 'Recu n', render: (r) => `EXC-${r.id.slice(0, 8).toUpperCase()}` },
    { key: 'method', label: 'Mode', hideOnMobile: true, render: (r) => paymentMethodLabel(r) },
    { key: 'note', label: 'Note', hideOnMobile: true, render: (r) => r.notes || '—' },
    { key: 'amount', label: 'Montant recupere', align: 'right',
      render: (r) => <span className="font-bold text-pistachio">+ {money(r.amount)}</span> },
  ];

  const refundActions = (r: PartyCreditRefund): ActionItem[] => [
    {
      label: 'Annuler la recuperation', icon: <Trash2 size={15} />, danger: true,
      hidden: !can('suppliers', 'delete'),
      onClick: () =>
        ask(
          'Annuler la recuperation',
          "Le trop-verse revient au compte du fournisseur et l'entree de caisse est supprimee.",
          async () => { await deleteRefund(r.id); toast.success('Recuperation annulee'); }
        ),
    },
  ];

  const purchaseStats = (list: Purchase[]): HistoryStat[] => [
    { label: 'Factures', value: String(list.length), icon: <Package size={12} /> },
    { label: 'Total achete', value: money(sum(list.map((p) => p.totalAmount))), tone: 'accent' },
    { label: 'Total regle', value: money(sum(list.map((p) => p.paidAmount))), tone: 'pos' },
    { label: 'Reste du', value: money(sum(list.map((p) => p.restAmount))), tone: 'neg' },
    { label: 'Articles', value: String(sum(list.map((p) => p.products.length))) },
  ];

  // L'onglet « Versements » ne montre QUE les reglements directs saisis sur la
  // carte du fournisseur — les reglements portes par une facture d'achat en
  // sont exclus, comme dans le compte rendu.
  const directPayments = history.payments.filter((p) => p.source === 'direct');
  const directTotal = sum(directPayments.map((p) => p.amount));

  const sections: HistorySection<never>[] = [
    {
      key: 'purchases', label: 'Achats', icon: <Package size={14} />,
      rows: history.purchases as never[],
      columns: purchaseColumns as DataColumn<never>[],
      actions: purchaseActions as unknown as (row: never, i: number) => ActionItem[],
      stats: purchaseStats(history.purchases),
      dateOf: (p: never) => (p as unknown as Purchase).date,
      searchOf: (p: never) => {
        const x = p as unknown as Purchase;
        return `${x.reference} ${x.bonNumber ?? ''} ${x.driverPlate ?? ''} ${x.products.map((l) => l.productName).join(' ')}`;
      },
      empty: 'Aucune facture pour ce fournisseur',
      onPrintAll: (rows: never[]) => {
        const list = rows as unknown as Purchase[];
        printList(
          'Liste des achats',
          [
            { label: 'Date', align: 'center', width: '13%' },
            { label: 'Designation', align: 'left' },
            { label: 'Articles', align: 'center', width: '10%' },
            { label: 'Regle', align: 'right', width: '18%' },
            { label: 'Total', align: 'right', width: '18%' },
          ],
          list.map((p) => [
            formatDate(p.date), `FACTURE ${p.reference}`, p.products.length,
            formatCurrency(p.paidAmount), formatCurrency(p.totalAmount),
          ]),
          'Total des achats',
          formatCurrency(sum(list.map((p) => p.totalAmount)))
        );
      },
    },
    {
      key: 'payments', label: 'Versements', icon: <Coins size={14} />,
      rows: directPayments as never[],
      columns: paymentColumns as DataColumn<never>[],
      actions: paymentActions as unknown as (row: never, i: number) => ActionItem[],
      stats: [
        { label: 'Reglements directs', value: String(directPayments.length), icon: <Coins size={12} /> },
        { label: 'Total regle', value: money(directTotal), tone: 'accent' },
      ],
      dateOf: (p: never) => (p as unknown as HistoryPayment).date,
      searchOf: (p: never) => {
        const x = p as unknown as HistoryPayment;
        return `${x.origin} ${x.notes ?? ''} ${x.documentRef ?? ''} ${x.amount}`;
      },
      empty: 'Aucun reglement direct pour ce fournisseur',
      note: "Uniquement les reglements directs saisis sur la carte du fournisseur — c'est ce que le compte rendu additionne.",
      onPrintAll: (rows: never[]) => {
        const list = rows as unknown as HistoryPayment[];
        printList(
          'Liste des reglements',
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
          'Total regle',
          formatCurrency(sum(list.map((p) => p.amount)))
        );
      },
    },
    {
      key: 'oldPurchases', label: 'Anciens achats', icon: <History size={14} />,
      rows: history.historicalPurchases as never[],
      columns: purchaseColumns as DataColumn<never>[],
      actions: purchaseActions as unknown as (row: never, i: number) => ActionItem[],
      stats: purchaseStats(history.historicalPurchases),
      dateOf: (p: never) => (p as unknown as Purchase).date,
      searchOf: (p: never) => (p as unknown as Purchase).reference,
      empty: 'Aucun ancien achat saisi pour ce fournisseur',
      note: "Factures anterieures au logiciel : ni le stock ni la caisse ne les ont vues passer.",
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
      empty: 'Aucune ancienne dette pour ce fournisseur',
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
      key: 'refunds', label: 'Excedents recuperes', icon: <Undo2 size={14} />,
      rows: history.refunds as never[],
      columns: refundColumns as DataColumn<never>[],
      actions: refundActions as unknown as (row: never, i: number) => ActionItem[],
      stats: [
        { label: 'Recuperations', value: String(history.refunds.length), icon: <Undo2 size={12} /> },
        { label: 'Total recupere', value: money(sum(history.refunds.map((r) => r.amount))), tone: 'pos' },
      ],
      dateOf: (r: never) => (r as unknown as PartyCreditRefund).refundedAt,
      searchOf: (r: never) => (r as unknown as PartyCreditRefund).notes ?? '',
      empty: 'Aucun trop-verse recupere aupres de ce fournisseur',
    },
  ];

  const headline: HistoryStat[] = [
    { label: 'Total achete', value: money(balance.billed), tone: 'accent' },
    { label: 'Total regle', value: money(balance.paid), tone: 'pos' },
    { label: 'Reste du', value: money(balance.rest), tone: 'neg' },
    { label: 'Trop-verse', value: money(balance.credit), tone: 'pos' },
    {
      label: balance.hasCredit ? 'Excedent a recuperer' : 'Solde net',
      value: balance.hasCredit ? `+ ${money(balance.creditToReturn)}` : money(Math.max(0, balance.net)),
      tone: balance.hasCredit ? 'pos' : 'neg',
    },
    { label: 'Part reglee', value: `${balance.paidPercent.toFixed(0)} %`, tone: 'accent' },
  ];

  return (
    <>
      <PartyHistoryModal
        open={!!supplier}
        onClose={onClose}
        title={`Historique — ${supplier.name}`}
        subtitle={`${supplier.phone || 'sans telephone'}${supplier.address ? ` · ${supplier.address}` : ''}`}
        headline={headline}
        sections={sections}
        headerActions={
          <>
            {can('suppliers', 'pay') && onNewVersement && (
              <Button size="sm" variant="gold" onClick={() => onNewVersement(supplier)}>
                <HandCoins size={15} /> Versement
              </Button>
            )}
            {can('suppliers', 'create') && onNewOldDebt && (
              <Button size="sm" variant="secondary" onClick={() => onNewOldDebt(supplier)}>
                <History size={15} /> Ancienne dette
              </Button>
            )}
            {balance.credit > 0 && can('suppliers', 'pay') && onRefund && (
              <Button size="sm" variant="mint" onClick={() => onRefund(supplier)}>
                <Undo2 size={15} /> Recuperer {money(balance.credit)}
              </Button>
            )}
            {onStatement && (
              <Button size="sm" variant="secondary" onClick={() => onStatement(supplier)}>
                <TrendingUp size={15} /> Compte rendu
              </Button>
            )}
          </>
        }
      />

      <Modal
        open={!!viewPurchase}
        onClose={() => setViewPurchase(null)}
        title={`Facture ${viewPurchase?.reference ?? ''}`}
        size="lg"
      >
        {viewPurchase && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Date" value={formatDate(viewPurchase.date, language)} />
              <Tile label="N BL fournisseur" value={viewPurchase.bonNumber || '—'} />
              <Tile label="Matricule" value={viewPurchase.driverPlate || '—'} />
              <Tile label="Type" value={viewPurchase.isHistorical ? 'Ancien achat' : 'Achat courant'} />
            </div>
            <div className="overflow-x-auto rounded-xl border border-gold/15">
              <table className="w-full text-sm">
                <thead className="bg-vanilla/60 text-text-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left">Produit</th>
                    <th className="px-3 py-2 text-right">Quantite</th>
                    <th className="px-3 py-2 text-right">Prix d&rsquo;achat</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {viewPurchase.products.map((l, i) => (
                    <tr key={i} className="border-t border-gold/10">
                      <td className="px-3 py-2 font-medium">{l.productName}</td>
                      <td className="px-3 py-2 text-right tabular">{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                      <td className="px-3 py-2 text-right tabular">{money(l.purchasePrice)}</td>
                      <td className="px-3 py-2 text-right tabular font-bold">{money(l.quantity * l.purchasePrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Tile label="Total" value={money(viewPurchase.totalAmount)} />
              <Tile label="Regle" value={money(viewPurchase.paidAmount)} color="text-pistachio" />
              <Tile label="Reste" value={money(viewPurchase.restAmount)} color="text-rose-deep" />
            </div>
            {viewPurchase.payments.length > 0 && (
              <div className="rounded-xl border border-gold/15 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">Reglements</p>
                {viewPurchase.payments.map((p, i) => (
                  <div key={i} className="flex justify-between border-b border-gold/10 py-1 text-xs last:border-0">
                    <span>{formatDate(p.date, language)} — {p.description || 'Reglement'}</span>
                    <span className="font-bold tabular text-pistachio">{money(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <Button variant="gold" className="w-full" onClick={() => printPurchase(viewPurchase)}>
              <Printer size={16} /> Imprimer la facture
            </Button>
          </div>
        )}
      </Modal>

      <EditPaymentModal
        payment={editPayment}
        onClose={() => setEditPayment(null)}
        onSave={async (amount, paidAt, notes, method) => {
          if (!editPayment) return;
          await updatePayment(editPayment.id, amount, paidAt, notes, method);
          toast.success('Reglement modifie — la dette du fournisseur a ete recalculee');
          setEditPayment(null);
        }}
      />

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
