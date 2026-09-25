import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ClipboardEdit, Pencil } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { EditPaymentModal } from '@/components/shared/EditPaymentModal';
import { OldDebtModal } from '@/components/shared/OldDebtModal';
import { DeliveryModal } from '@/pages/Clients/DeliveryModal';
import { CreatePurchase } from '@/pages/Purchase/CreatePurchase';
import { usePermissions } from '@/hooks/usePermissions';
import { useSalesStore } from '@/store/salesStore';
import { useCommandStore, type DeliveryDriver, type DeliveryPayment } from '@/store/commandStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useClientStore } from '@/store/clientStore';
import { useSupplierStore } from '@/store/supplierStore';
import { formatCurrency, formatDate, formatDateTime, paymentMethodLabel } from '@/lib/utils';
import type { LedgerSource } from '@/lib/ledger';
import type { CommandDeliveryItem, PartyPayment, PartyType, PaymentMethodDetails } from '@/types';
import { SaleFullEditModal } from './SaleFullEditModal';
import { CommandEditModal } from './CommandEditModal';

/* ============================================================================
 *  VOIR / MODIFIER UNE LIGNE DU RELEVE
 * ----------------------------------------------------------------------------
 *  Une seule porte d'entree pour toutes les lignes affichees dans un compte
 *  rendu (client, fournisseur), un bon de livraison de periode ou le rapport
 *  general : vente, bon de livraison, achat, ancienne dette, versement,
 *  excedent rendu, acompte et reglement de commande.
 *
 *  La modification passe TOUJOURS par la fonction de la base qui gere ce
 *  document : c'est elle qui repercute l'ecart sur les tables liees (facture,
 *  bon, commande, stock, caisse, dette et acompte du tiers). Les ecrans se
 *  rechargent ensuite : le releve et ses totaux se recalculent d'eux-memes.
 * ========================================================================== */

export type EntryTarget =
  | { kind: 'sale'; id: string }
  | { kind: 'delivery'; id: string }
  | { kind: 'purchase'; id: string }
  | { kind: 'oldDebt'; id: string; party: PartyType }
  | { kind: 'payment'; id: string; party: PartyType }
  | { kind: 'refund'; id: string; party: PartyType }
  | { kind: 'commandPayment'; id: string }
  | { kind: 'advance'; commandId: string }
  | { kind: 'command'; id: string };

export interface EntryRequest {
  target: EntryTarget;
  mode: 'view' | 'edit';
}

/** Ligne du releve -> enregistrement a ouvrir. */
export function targetFromLedger(src: LedgerSource, party: PartyType): EntryTarget | null {
  const docTarget = (id: string, kind?: string): EntryTarget => {
    if (kind === 'purchase') return { kind: 'purchase', id };
    // l'identifiant d'un « bon de livraison » du releve est celui de sa facture,
    // ou du bon lui-meme quand il n'a pas encore de facture
    const isSale = useSalesStore.getState().sales.some((s) => s.id === id);
    if (isSale) return { kind: 'sale', id };
    return { kind: 'delivery', id: id.replace(/-cash$/, '') };
  };

  if (src.side === 'debit') {
    if (src.kind === 'oldDebt') return { kind: 'oldDebt', id: src.id, party };
    return docTarget(src.id, src.kind);
  }
  switch (src.kind) {
    case 'payment': return { kind: 'payment', id: src.id, party };
    case 'refund': return { kind: 'refund', id: src.id, party };
    case 'docPayment': return src.debitId ? docTarget(src.debitId, src.debitKind) : null;
    case 'advance': return { kind: 'advance', commandId: src.id.replace(/-advance$/, '') };
    case 'commandPayment':
      return src.id.endsWith('-extra')
        ? { kind: 'command', id: src.id.replace(/-extra$/, '') }
        : { kind: 'commandPayment', id: src.id };
    default: return null;
  }
}

/** Ce type de ligne peut-il etre modifie ? Toutes le sont, commande comprise. */
export function isEditable(t: EntryTarget | null): boolean {
  return !!t;
}

/**
 * Commande a l'origine d'une ligne : le bon de livraison ou sa facture (pour
 * en corriger le PRIX unitaire, qui appartient a la commande).
 */
function commandOfTarget(t: EntryTarget): string | null {
  const { sales } = useSalesStore.getState();
  const { deliveries } = useCommandStore.getState();
  if (t.kind === 'delivery') return deliveries.find((d) => d.id === t.id)?.commandId ?? null;
  if (t.kind === 'sale') {
    const s = sales.find((x) => x.id === t.id);
    if (!s?.deliveryId) return null;
    return deliveries.find((d) => d.id === s.deliveryId)?.commandId ?? s.commandId ?? null;
  }
  return null;
}

/* -------------------------------------------------------------------------- */

export function EntryEditor({ request, onClose }: { request: EntryRequest | null; onClose: () => void }) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  /** Commande ouverte depuis un bon de livraison (« Modifier la commande »). */
  const [commandId, setCommandId] = useState<string | null>(null);
  useEffect(() => { if (request) { setMode(request.mode); setCommandId(null); } }, [request]);
  if (!request) return null;
  const { target } = request;
  if (commandId) return <EntryEdit target={{ kind: 'command', id: commandId }} onClose={onClose} />;
  const parentCommand = commandOfTarget(target);
  return mode === 'view'
    ? (
      <EntryView
        target={target}
        onClose={onClose}
        onEdit={isEditable(target) ? () => setMode('edit') : undefined}
        onEditCommand={parentCommand ? () => setCommandId(parentCommand) : undefined}
      />
    )
    : <EntryEdit target={target} onClose={onClose} />;
}

/* ================================================================ VOIR ==== */

interface ViewData {
  title: string;
  fields: [string, ReactNode][];
  lines?: { designation: string; quantity: string; unitPrice: number; amount: number }[];
  totals?: [string, number, boolean?][];
  moves?: [string, number][];
  module: 'clients' | 'suppliers' | 'purchase';
}

function EntryView({
  target, onClose, onEdit, onEditCommand,
}: {
  target: EntryTarget;
  onClose: () => void;
  onEdit?: () => void;
  /** Bon de livraison / sa facture : ouvrir la commande (prix, quantites). */
  onEditCommand?: () => void;
}) {
  const { can } = usePermissions();
  const sales = useSalesStore((s) => s.sales);
  const { commands, deliveries } = useCommandStore();
  const purchases = usePurchaseStore((s) => s.purchases);
  const client = useClientStore();
  const supplier = useSupplierStore();

  const data = useMemo<ViewData | null>(() => {
    const clientName = (id?: string | null) => client.clients.find((c) => c.id === id)?.name ?? '—';
    const supplierName = (id?: string) => supplier.suppliers.find((s) => s.id === id)?.name ?? '—';
    const q = (n: number, unit?: string) => `${Math.round(n * 1000) / 1000}${unit ? ` ${unit}` : ''}`;

    switch (target.kind) {
      case 'sale': {
        const s = sales.find((x) => x.id === target.id);
        if (!s) return null;
        const d = s.deliveryId ? deliveries.find((x) => x.id === s.deliveryId) : undefined;
        return {
          module: 'clients',
          title: d ? `Bon de livraison ${d.reference} — facture ${s.reference}` : `Vente ${s.reference}`,
          fields: [
            ['Client', clientName(s.clientId)],
            ['Date', formatDate(s.date)],
            ['Origine', d ? 'Bon de livraison' : s.isHistorical ? 'Ancienne vente' : 'Caisse'],
            ...(d?.location ? [['Lieu de livraison', d.location] as [string, ReactNode]] : []),
            ...(s.bonNumber ? [['N° bon', s.bonNumber] as [string, ReactNode]] : []),
          ],
          lines: s.products.map((l) => ({
            designation: l.productName ?? 'Produit', quantity: q(l.quantity, l.unit),
            unitPrice: l.sellingPrice, amount: l.quantity * l.sellingPrice,
          })),
          totals: [
            ['Total H.T', s.totalAmount - (s.reduction || 0)],
            ...(s.reduction ? [['Réduction', s.reduction] as [string, number]] : []),
            ...(s.tvaEnabled ? [[`TVA ${s.tvaRate} %`, s.tvaAmount ?? 0] as [string, number]] : []),
            ['Net à payer', s.finalAmount, true],
            ['Payé', s.paidAmount],
            ['Reste', s.restAmount, true],
          ],
          moves: (s.payments ?? []).map((p) => [`Encaissé le ${formatDate(p.date)}`, p.amount]),
        };
      }
      case 'delivery': {
        const d = deliveries.find((x) => x.id === target.id);
        if (!d) return null;
        const cmd = commands.find((c) => c.id === d.commandId);
        return {
          module: 'clients',
          title: `Bon de livraison ${d.reference}`,
          fields: [
            ['Client', cmd?.clientName ?? '—'],
            ['Date', formatDateTime(d.deliveredAt)],
            ['Commande', cmd?.reference ?? '—'],
            ['Lieu', d.location || cmd?.clientAddress || '—'],
            ['Chauffeur', [d.driverName, d.driverPlate].filter(Boolean).join(' · ') || '—'],
          ],
          lines: d.items.map((it) => {
            const line = cmd?.items.find((x) => (it.commandItemId && x.id === it.commandItemId) || x.productName === it.productName);
            const pu = line?.unitPrice ?? 0;
            return { designation: it.productName, quantity: q(it.quantity, it.sellUnit), unitPrice: pu, amount: it.quantity * pu };
          }),
          totals: [
            ['Total H.T', d.totalHt ?? 0],
            ...(d.tvaEnabled ? [[`TVA ${d.tvaRate} %`, d.tvaAmount ?? 0] as [string, number]] : []),
            ['Total T.T.C', d.totalTtc ?? 0, true],
            ['Acompte imputé', d.advanceApplied ?? 0],
            ['Encaissé à la remise', d.cashPaid ?? 0],
            ['Reste', d.restAmount ?? 0, true],
          ],
        };
      }
      case 'purchase': {
        const p = purchases.find((x) => x.id === target.id);
        if (!p) return null;
        return {
          module: 'purchase',
          title: `Facture d'achat ${p.reference}`,
          fields: [
            ['Fournisseur', supplierName(p.supplierId)],
            ['Date', formatDate(p.date)],
            ['N° de bon', p.bonNumber || '—'],
            ['Matricule', p.driverPlate || '—'],
            ['Type', p.isHistorical ? 'Ancien achat' : 'Achat'],
          ],
          lines: p.products.map((l) => ({
            designation: l.productName ?? 'Produit', quantity: q(l.quantity, l.unit),
            unitPrice: l.purchasePrice, amount: l.quantity * l.purchasePrice,
          })),
          totals: [['Total', p.totalAmount, true], ['Réglé', p.paidAmount], ['Reste', p.restAmount, true]],
          moves: (p.payments ?? []).map((x) => [`Réglé le ${formatDate(x.date)}`, x.amount]),
        };
      }
      case 'oldDebt': {
        const list = target.party === 'client' ? client.oldDebts : supplier.oldDebts;
        const d = list.find((x) => x.id === target.id);
        if (!d) return null;
        return {
          module: target.party === 'client' ? 'clients' : 'suppliers',
          title: 'Ancienne dette',
          fields: [
            [target.party === 'client' ? 'Client' : 'Fournisseur', d.partyName ?? '—'],
            ['Date', formatDate(d.date)],
            ['Description', d.description || '—'],
          ],
          totals: [['Montant', d.amount, true], ['Réglé', d.paidAmount], ['Reste', d.restAmount, true]],
        };
      }
      case 'payment': {
        const list = target.party === 'client' ? client.payments : supplier.payments;
        const p = list.find((x) => x.id === target.id);
        if (!p) return null;
        return {
          module: target.party === 'client' ? 'clients' : 'suppliers',
          title: 'Versement',
          fields: [
            [target.party === 'client' ? 'Client' : 'Fournisseur',
              target.party === 'client' ? clientName(p.partyId) : supplierName(p.partyId)],
            ['Date', formatDateTime(p.paidAt || p.date)],
            ['Mode', paymentMethodLabel(p)],
            ['Note', p.notes || '—'],
          ],
          totals: [['Montant', p.amount, true]],
        };
      }
      case 'refund': {
        const list = target.party === 'client' ? client.refunds : supplier.refunds;
        const r = list.find((x) => x.id === target.id);
        if (!r) return null;
        return {
          module: target.party === 'client' ? 'clients' : 'suppliers',
          title: target.party === 'client' ? 'Excédent rendu au client' : 'Excédent récupéré du fournisseur',
          fields: [
            [target.party === 'client' ? 'Client' : 'Fournisseur', r.partyName ?? '—'],
            ['Date', formatDateTime(r.refundedAt || r.date)],
            ['Mode', paymentMethodLabel(r)],
            ['Note', r.notes || '—'],
          ],
          totals: [['Montant', r.amount, true]],
        };
      }
      case 'commandPayment':
      case 'advance':
      case 'command': {
        const cmd = target.kind === 'commandPayment'
          ? commands.find((c) => (c.payments ?? []).some((p) => p.id === target.id))
          : commands.find((c) => c.id === (target.kind === 'advance' ? target.commandId : target.id));
        if (!cmd) return null;
        const pay = target.kind === 'commandPayment' ? cmd.payments?.find((p) => p.id === target.id) : undefined;
        return {
          module: 'clients',
          title: pay ? `Règlement de la commande ${cmd.reference}`
            : target.kind === 'advance' ? `Acompte de la commande ${cmd.reference}` : `Commande ${cmd.reference}`,
          fields: [
            ['Client', cmd.clientName],
            ['Commande du', formatDate(cmd.createdAt.slice(0, 10))],
            ...(pay ? [['Réglé le', formatDate(pay.date)] as [string, ReactNode], ['Note', pay.notes || '—'] as [string, ReactNode]] : []),
          ],
          lines: cmd.items.map((it) => ({
            designation: it.productName, quantity: q(it.quantity, it.sellByUnit ? it.sellUnit : undefined),
            unitPrice: it.unitPrice, amount: it.totalPrice,
          })),
          totals: [
            ...(pay ? [['Montant du règlement', pay.amount, true] as [string, number, boolean]] : []),
            ...(target.kind === 'advance' ? [['Acompte', cmd.advancePaid, true] as [string, number, boolean]] : []),
            ['Total commande T.T.C', cmd.totalTtc ?? cmd.totalAmount],
            ['Payé', cmd.paidAmount],
            ['Reste', cmd.restAmount],
          ],
        };
      }
    }
  }, [target, sales, commands, deliveries, purchases, client, supplier]);

  return (
    <Modal open onClose={onClose} title={data?.title ?? 'Détail'} size="lg">
      {!data ? (
        <p className="py-6 text-center text-sm text-text-muted">Cette ligne est introuvable — elle a peut-être été supprimée.</p>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-xl border border-gold/20 bg-vanilla/40 p-3 text-sm sm:grid-cols-2">
            {data.fields.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-text-muted">{k}</dt>
                <dd className="text-right font-semibold text-text-primary">{v}</dd>
              </div>
            ))}
          </dl>

          {data.lines && data.lines.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gold/20">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="bg-vanilla/60 text-[11px] uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Désignation</th>
                    <th className="px-3 py-2 text-right">Quantité</th>
                    <th className="px-3 py-2 text-right">Prix U</th>
                    <th className="px-3 py-2 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l, i) => (
                    <tr key={i} className="border-t border-gold/10">
                      <td className="px-3 py-1.5 font-semibold text-text-primary">{l.designation}</td>
                      <td className="px-3 py-1.5 text-right tabular">{l.quantity}</td>
                      <td className="px-3 py-1.5 text-right tabular">{formatCurrency(l.unitPrice)}</td>
                      <td className="px-3 py-1.5 text-right font-bold tabular text-gold-dark">{formatCurrency(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.totals && (
            <div className="ml-auto max-w-sm space-y-1 text-sm">
              {data.totals.map(([k, v, strong]) => (
                <div key={k} className="flex justify-between gap-4">
                  <span className={strong ? 'font-bold text-text-primary' : 'text-text-muted'}>{k}</span>
                  <span className={`tabular ${strong ? 'font-bold text-gold-dark' : 'text-text-secondary'}`}>{formatCurrency(v)}</span>
                </div>
              ))}
            </div>
          )}

          {data.moves && data.moves.length > 0 && (
            <div className="rounded-xl border border-gold/15 bg-vanilla/30 p-3 text-xs">
              {data.moves.map(([k, v], i) => (
                <div key={i} className="flex justify-between"><span className="text-text-muted">{k}</span><span className="tabular font-semibold text-pistachio">{formatCurrency(v)}</span></div>
              ))}
            </div>
          )}

          <div className="flex gap-2 border-t border-gold/15 pt-4">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Fermer</Button>
            {onEditCommand && can('clients', 'edit') && (
              <Button variant="secondary" className="flex-1" onClick={onEditCommand}>
                <ClipboardEdit size={15} /> Modifier la commande (prix)
              </Button>
            )}
            {onEdit && can(data.module, 'edit') && (
              <Button variant="gold" className="flex-1 font-bold" onClick={onEdit}>
                <Pencil size={15} /> Modifier
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================ MODIFIER ==== */

function EntryEdit({ target, onClose }: { target: EntryTarget; onClose: () => void }) {
  const sales = useSalesStore((s) => s.sales);
  const updateSale = useSalesStore((s) => s.updateSale);
  const updateSaleLines = useSalesStore((s) => s.updateSaleLines);
  const { commands, deliveries, updateDelivery, updateCommandPayment } = useCommandStore();
  const purchases = usePurchaseStore((s) => s.purchases);
  const client = useClientStore();
  const supplier = useSupplierStore();

  const done = (msg: string) => { toast.success(msg); onClose(); };

  /* ---- vente de caisse, ou bon de livraison (via sa facture) ------------ */
  if (target.kind === 'sale' || target.kind === 'delivery') {
    const sale = target.kind === 'sale' ? sales.find((s) => s.id === target.id) : undefined;
    const deliveryId = target.kind === 'delivery' ? target.id : sale?.deliveryId;
    if (deliveryId) {
      const delivery = deliveries.find((d) => d.id === deliveryId) ?? null;
      const command = delivery ? commands.find((c) => c.id === delivery.commandId) ?? null : null;
      if (!delivery || !command) return <Missing onClose={onClose} />;
      const used = deliveries
        .filter((d) => d.commandId === command.id && d.id !== delivery.id)
        .reduce((s, d) => s + (d.advanceApplied ?? 0), 0);
      const advanceAvailable = Math.max(
        0, (command.advancePaid ?? 0) + (command.extraPaid ?? 0) + (command.creditApplied ?? 0) - used
      );
      const credit = Math.max(0, client.clients.find((c) => c.id === command.clientId)?.creditAmount ?? 0);
      return (
        <DeliveryModal
          open
          command={command}
          editing={delivery}
          advanceAvailable={advanceAvailable}
          clientCredit={credit}
          onClose={onClose}
          onSave={async (
            items: CommandDeliveryItem[], deliveredAt: string, notes: string,
            driver: DeliveryDriver, payment: DeliveryPayment,
          ) => {
            await updateDelivery(delivery.id, items, deliveredAt, notes, driver, payment);
            const saleId = useCommandStore.getState().deliveries.find((d) => d.id === delivery.id)?.saleId;
            if (saleId && (payment.creditUsed ?? 0) > 0.004) {
              try { await client.applyCreditToSale(saleId, payment.creditUsed); } catch { /* message deja affiche */ }
            }
            done('Bon de livraison modifié — facture, commande, stock et compte du client recalculés');
          }}
        />
      );
    }
    if (!sale) return <Missing onClose={onClose} />;
    return (
      <SaleFullEditModal
        sale={sale}
        onClose={onClose}
        onSave={async (lines, header) => {
          if (lines.length) await updateSaleLines(sale.id, lines, header);
          else await updateSale(sale.id, header);
          done('Vente modifiée — total, reste, stock et compte du client recalculés');
        }}
      />
    );
  }

  /* ---- facture d'achat : le formulaire complet de l'ecran Achats -------- */
  if (target.kind === 'purchase') {
    const purchase = purchases.find((p) => p.id === target.id);
    if (!purchase) return <Missing onClose={onClose} />;
    return (
      <Modal open onClose={onClose} title={`Modifier la facture ${purchase.reference}`} size="lg">
        <CreatePurchase
          editing={purchase}
          onClose={onClose}
          onCreated={() => toast.success('Achat modifié — stock, caisse et compte du fournisseur recalculés')}
        />
      </Modal>
    );
  }

  /* ---- ancienne dette ---------------------------------------------------- */
  if (target.kind === 'oldDebt') {
    const store = target.party === 'client' ? client : supplier;
    const debt = store.oldDebts.find((d) => d.id === target.id);
    if (!debt) return <Missing onClose={onClose} />;
    return (
      <OldDebtModal
        open
        onClose={onClose}
        kind={target.party}
        partyName={debt.partyName ?? ''}
        initial={debt}
        onSubmit={async (amount, date, description) => {
          await store.updateOldDebt(debt.id, amount, date, description);
          done('Ancienne dette modifiée — la dette du tiers a été recalculée');
        }}
      />
    );
  }

  /* ---- versement direct ------------------------------------------------- */
  if (target.kind === 'payment') {
    const store = target.party === 'client' ? client : supplier;
    const payment = store.payments.find((p) => p.id === target.id) ?? null;
    if (!payment) return <Missing onClose={onClose} />;
    return (
      <EditPaymentModal
        payment={payment}
        onClose={onClose}
        onSave={async (amount, paidAt, notes, method) => {
          await store.updatePayment(payment.id, amount, paidAt, notes, method);
          done('Versement modifié — imputations, caisse et solde recalculés');
        }}
      />
    );
  }

  /* ---- excedent rendu / recupere ---------------------------------------- */
  if (target.kind === 'refund') {
    const store = target.party === 'client' ? client : supplier;
    const refund = store.refunds.find((r) => r.id === target.id);
    if (!refund) return <Missing onClose={onClose} />;
    const asPayment: PartyPayment = {
      id: refund.id, partyId: refund.partyId, partyName: refund.partyName, amount: refund.amount,
      date: refund.date, paidAt: refund.refundedAt || refund.date, notes: refund.notes,
      method: refund.method, chequeNumber: refund.chequeNumber, virementNumber: refund.virementNumber,
      bankName: refund.bankName,
    };
    return (
      <EditPaymentModal
        payment={asPayment}
        onClose={onClose}
        onSave={async (amount, paidAt, notes, method: PaymentMethodDetails) => {
          await store.updateRefund(refund.id, amount, paidAt, notes, method);
          done('Excédent modifié — acompte du tiers et caisse recalculés');
        }}
      />
    );
  }

  /* ---- reglement / acompte d'une commande ------------------------------- */
  if (target.kind === 'commandPayment') {
    const cmd = commands.find((c) => (c.payments ?? []).some((p) => p.id === target.id));
    const pay = cmd?.payments?.find((p) => p.id === target.id);
    if (!cmd || !pay) return <Missing onClose={onClose} />;
    return (
      <AmountDateModal
        title={`Modifier le règlement — ${cmd.reference}`}
        amount={pay.amount}
        date={pay.date.slice(0, 10)}
        notes={pay.notes ?? ''}
        onClose={onClose}
        onSave={async (amount, date, notes) => {
          await updateCommandPayment(pay.id, amount, date, notes);
          done('Règlement modifié — la commande et la caisse ont été recalculées');
        }}
      />
    );
  }

  /* ---- commande (et son acompte) : tout se modifie, lignes comprises ---- */
  if (target.kind === 'advance' || target.kind === 'command') {
    const cmd = commands.find((c) => c.id === (target.kind === 'advance' ? target.commandId : target.id));
    if (!cmd) return <Missing onClose={onClose} />;
    return <CommandEditModal command={cmd} onClose={onClose} />;
  }

  return <Missing onClose={onClose} />;
}

function Missing({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Modification" size="sm">
      <p className="py-4 text-center text-sm text-text-muted">Cette ligne est introuvable — elle a peut-être été supprimée.</p>
      <Button variant="secondary" className="w-full" onClick={onClose}>Fermer</Button>
    </Modal>
  );
}

function AmountDateModal({
  title, amount, date, notes, dateLocked, allowZero, onClose, onSave,
}: {
  title: string;
  amount: number;
  date: string;
  notes?: string;
  dateLocked?: boolean;
  allowZero?: boolean;
  onClose: () => void;
  onSave: (amount: number, date: string, notes: string) => Promise<void>;
}) {
  const [a, setA] = useState(amount);
  const [d, setD] = useState(date);
  const [n, setN] = useState(notes ?? '');
  const [saving, setSaving] = useState(false);
  const valid = allowZero ? a >= 0 : a > 0;
  return (
    <Modal open onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        <Input label="Montant (DA)" type="number" step="any" min={0} value={a}
          onChange={(e) => setA(Math.max(0, Number(e.target.value)))} autoFocus />
        <Input label={dateLocked ? 'Date (celle de la commande)' : 'Date'} type="date" value={d}
          disabled={dateLocked} onChange={(e) => setD(e.target.value)} />
        {notes !== undefined && (
          <Textarea label="Note (facultatif)" rows={2} value={n} onChange={(e) => setN(e.target.value)} />
        )}
        <div className="flex gap-2 border-t border-gold/15 pt-4">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Annuler</Button>
          <Button
            variant="gold" className="flex-1 font-bold" disabled={saving || !valid || !d}
            onClick={async () => {
              setSaving(true);
              try { await onSave(a, d, n); } finally { setSaving(false); }
            }}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
