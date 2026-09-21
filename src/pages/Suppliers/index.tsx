import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Truck, Plus, Pencil, Trash2, Phone, MapPin, Printer, Layers,
  CheckCircle2, AlertTriangle, Receipt, TrendingDown, FileBarChart,
  HandCoins, History, PiggyBank, Undo2,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { DataTable, useViewMode, type DataColumn } from '@/components/ui/DataTable';
import type { ActionItem } from '@/components/ui/ActionMenu';
import { StatCard } from '@/components/shared/StatCard';
import { SupplierForm } from '@/components/shared/SupplierForm';
import { VersementModal } from '@/components/shared/VersementModal';
import { CreatePurchase } from '@/pages/Purchase/CreatePurchase';
import { SupplierStatementModal } from '@/components/shared/SupplierStatementModal';
import { SupplierHistoryScreen } from '@/components/shared/SupplierHistoryScreen';
import { OldDebtModal } from '@/components/shared/OldDebtModal';
import { RefundCreditModal } from '@/components/shared/RefundCreditModal';
import { useSupplierStore } from '@/store/supplierStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency } from '@/lib/utils';
import { printPaymentReceipt } from '@/lib/documents';
import { computePartyBalance } from '@/lib/partyBalance';
import { toast } from '@/components/ui/Toast';
import type {
  Supplier, PartyPayment, PaymentMethodDetails, Purchase, PartyOldDebt,
} from '@/types';

type SupplierFilter = 'all' | 'debt' | 'clear' | 'credit';

/** Situation d'un fournisseur telle qu'affichee sur sa carte et dans le tableau. */
interface SupplierStats {
  count: number;
  balance: ReturnType<typeof computePartyBalance>;
  total: number; paid: number; rest: number; credit: number;
  paymentsCount: number; oldDebtsCount: number; refundsCount: number;
}

/** Fournisseur sans aucune ecriture — evite un `undefined` dans les tableaux. */
const EMPTY_SUPPLIER_STATS: SupplierStats = {
  count: 0,
  balance: computePartyBalance({ documentsBilled: 0, documentsPaid: 0, documentsRest: 0, oldDebts: [] }),
  total: 0, paid: 0, rest: 0, credit: 0,
  paymentsCount: 0, oldDebtsCount: 0, refundsCount: 0,
};

/* ============================================================================
 *  FOURNISSEURS
 * ----------------------------------------------------------------------------
 *  Meme principe que l'ecran « Clients » : le bouton « Versements (n) » a ete
 *  remplace par « Historique », qui ouvre en plein ecran toutes les parties du
 *  fournisseur (achats, versements, anciens achats, anciennes dettes,
 *  excedents recuperes), chacune avec ses statistiques, son filtre de periode
 *  et ses actions VOIR / MODIFIER / IMPRIMER / SUPPRIMER.
 *  Le bouton « Versement », qui CREE un reglement, est conserve.
 * ========================================================================== */

export default function SuppliersPage() {
  const { can } = usePermissions();
  const {
    suppliers, payments, oldDebts, refunds,
    addSupplier, updateSupplier, deleteSupplier, payDebt,
    addOldDebt, updateOldDebt, refundCredit,
  } = useSupplierStore();
  const { purchases } = usePurchaseStore();
  const settings = useSettingsStore((s) => s.settings);

  const [view, setView] = useViewMode('suppliers');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SupplierFilter>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<Supplier | null>(null);
  const [versing, setVersing] = useState<Supplier | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editPurchase, setEditPurchase] = useState<Purchase | null>(null);
  const [statement, setStatement] = useState<Supplier | null>(null);
  const [printPrompt, setPrintPrompt] = useState<{ supplier: Supplier; payment: PartyPayment } | null>(null);
  const [oldDebtFor, setOldDebtFor] = useState<Supplier | null>(null);
  const [editOldDebt, setEditOldDebt] = useState<PartyOldDebt | null>(null);
  const [refunding, setRefunding] = useState<Supplier | null>(null);

  /**
   * SITUATION DE CHAQUE FOURNISSEUR, CALCULEE UNE SEULE FOIS.
   * Comme sur l'ecran des clients, les listes sont indexees une fois par
   * fournisseur au lieu d'etre rebalayees a chaque rendu ET pour chaque carte.
   */
  const statsBySupplier = useMemo(() => {
    interface Bucket { ps: typeof purchases; pays: number; olds: typeof oldDebts; refs: number }
    const index = new Map<string, Bucket>();
    const bucket = (id: string): Bucket => {
      let b = index.get(id);
      if (!b) { b = { ps: [], pays: 0, olds: [], refs: 0 }; index.set(id, b); }
      return b;
    };
    const creditOf = new Map(suppliers.map((x) => [x.id, x.creditAmount ?? 0]));
    suppliers.forEach((x) => bucket(x.id));
    purchases.forEach((p) => { if (p.supplierId) bucket(p.supplierId).ps.push(p); });
    payments.forEach((p) => { bucket(p.partyId).pays += 1; });
    oldDebts.forEach((d) => { bucket(d.partyId).olds.push(d); });
    refunds.forEach((r) => { bucket(r.partyId).refs += 1; });

    const out = new Map<string, SupplierStats>();
    index.forEach((b, id) => {
      const balance = computePartyBalance({
        documentsBilled: b.ps.reduce((x, y) => x + y.totalAmount, 0),
        documentsPaid: b.ps.reduce((x, y) => x + y.paidAmount, 0),
        documentsRest: b.ps.reduce((x, y) => x + y.restAmount, 0),
        oldDebts: b.olds,
        credit: creditOf.get(id) ?? 0,
      });
      out.set(id, {
        count: b.ps.length,
        balance,
        total: balance.billed,
        paid: balance.paid,
        rest: balance.rest,
        credit: balance.credit,
        // Tous les reglements du fournisseur : ceux saisis sur sa carte ET ceux
        // portes par une facture d'achat.
        paymentsCount: b.pays + b.ps.reduce((x, p) => x + (p.payments ?? []).length, 0),
        oldDebtsCount: b.olds.length,
        refundsCount: b.refs,
      });
    });
    return out;
  }, [suppliers, purchases, payments, oldDebts, refunds]);

  const statsOf = (id: string): SupplierStats =>
    statsBySupplier.get(id) ?? EMPTY_SUPPLIER_STATS;

  const filtered = useMemo(
    () =>
      suppliers.filter((s) => {
        const q = search.toLowerCase();
        const match =
          s.name.toLowerCase().includes(q) ||
          (s.phone || '').includes(search) ||
          (s.address || '').toLowerCase().includes(q);
        if (!match) return false;
        const bal = statsOf(s.id).balance;
        if (filter === 'debt') return bal.hasDebt;
        if (filter === 'credit') return bal.credit > 0;
        if (filter === 'clear') return !bal.hasDebt && bal.credit <= 0;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suppliers, search, filter, statsBySupplier]
  );

  const globals = useMemo(() => {
    const total = purchases.reduce((s, p) => s + p.totalAmount, 0)
      + oldDebts.reduce((s, d) => s + d.amount, 0);
    const paid = purchases.reduce((s, p) => s + p.paidAmount, 0)
      + oldDebts.reduce((s, d) => s + d.paidAmount, 0);
    const rest = purchases.reduce((s, p) => s + p.restAmount, 0)
      + oldDebts.reduce((s, d) => s + d.restAmount, 0);
    const credit = suppliers.reduce((s, x) => s + Math.max(0, x.creditAmount ?? 0), 0);
    const withDebt = suppliers.filter((s) => statsOf(s.id).balance.hasDebt).length;
    return { total, paid, rest, credit, withDebt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchases, suppliers, oldDebts, statsBySupplier]);

  const handleSubmit = async (data: Omit<Supplier, 'id'>) => {
    if (editing) {
      await updateSupplier(editing.id, data);
      toast.success('Fournisseur modifié');
    } else {
      await addSupplier(data);
      toast.success('Fournisseur créé');
    }
    setFormOpen(false);
    setEditing(null);
  };

  const handleVersement = async (
    supplier: Supplier, amount: number, notes: string, paidAt: string, method: PaymentMethodDetails,
  ) => {
    const payment = await payDebt(supplier.id, amount, paidAt, notes, method);
    toast.success('Versement enregistré — la dette du fournisseur a été réduite');
    setVersing(null);
    if (payment) setPrintPrompt({ supplier, payment });
  };

  const handleOldDebt = async (
    supplier: Supplier, amount: number, date: string, description: string,
  ) => {
    if (editOldDebt) {
      await updateOldDebt(editOldDebt.id, amount, date, description);
      toast.success('Ancienne dette modifiée — la dette du fournisseur a été recalculée');
    } else {
      await addOldDebt(supplier.id, amount, date, description);
      toast.success('Ancienne dette enregistrée — elle s’ajoute à la dette du fournisseur');
    }
    setEditOldDebt(null);
    setOldDebtFor(null);
  };

  const handleRefund = async (
    supplier: Supplier, amount: number, notes: string, refundedAt: string,
    method: PaymentMethodDetails,
  ) => {
    await refundCredit(supplier.id, amount, refundedAt, notes, method);
    toast.success('Excédent récupéré — l’entrée de caisse a été enregistrée');
    setRefunding(null);
  };

  const doPrintReceipt = (supplier: Supplier, payment: PartyPayment) => {
    const st = statsOf(supplier.id);
    printPaymentReceipt(
      {
        kind: 'supplier',
        receiptNumber: `RGF-${payment.id.slice(0, 8).toUpperCase()}`,
        partyName: supplier.name,
        partyPhone: supplier.phone,
        amount: payment.amount,
        paidAt: payment.paidAt,
        notes: payment.notes,
        method: payment.method,
        chequeNumber: payment.chequeNumber,
        virementNumber: payment.virementNumber,
        bankName: payment.bankName,
        totalDebt: st.total,
        totalPaid: st.paid,
        restAmount: st.rest,
      },
      settings
    );
  };

  const supplierActions = (s: Supplier): ActionItem[] => {
    const st = statsOf(s.id);
    return [
      { label: 'Historique complet', icon: <Layers size={15} />, onClick: () => setHistory(s) },
      { label: 'Compte rendu (période)', icon: <FileBarChart size={15} />, onClick: () => setStatement(s) },
      {
        label: 'Nouveau versement', icon: <HandCoins size={15} />, hidden: !can('suppliers', 'pay'),
        onClick: () => setVersing(s),
      },
      {
        label: 'Ancienne dette', icon: <History size={15} />, hidden: !can('suppliers', 'create'),
        onClick: () => { setEditOldDebt(null); setOldDebtFor(s); },
      },
      {
        label: `Récupérer l'excédent (${formatCurrency(st.credit)})`, icon: <Undo2 size={15} />,
        hidden: st.credit <= 0 || !can('suppliers', 'pay'),
        onClick: () => setRefunding(s),
      },
      {
        label: 'Modifier la fiche', icon: <Pencil size={15} />, hidden: !can('suppliers', 'edit'),
        onClick: () => { setEditing(s); setFormOpen(true); },
      },
      {
        label: 'Supprimer le fournisseur', icon: <Trash2 size={15} />, danger: true,
        hidden: !can('suppliers', 'delete'),
        onClick: () => setDeleteId(s.id),
      },
    ];
  };

  const columns: DataColumn<Supplier>[] = [
    {
      key: 'name', label: 'Fournisseur',
      render: (s) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-button text-[11px] font-bold text-white">
            {s.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-text-primary">{s.name}</span>
            <span className="block truncate text-[11px] text-text-muted">{s.phone || '—'}</span>
          </span>
        </div>
      ),
    },
    { key: 'address', label: 'Adresse', hideOnMobile: true, render: (s) => s.address || '—' },
    {
      key: 'docs', label: 'Documents', align: 'center', hideOnMobile: true,
      render: (s) => {
        const st = statsOf(s.id);
        return (
          <span className="text-[11px] text-text-muted">
            {st.count} facture(s) · {st.paymentsCount} règlement(s)
          </span>
        );
      },
    },
    { key: 'total', label: 'Total acheté', align: 'right', render: (s) => formatCurrency(statsOf(s.id).total) },
    {
      key: 'paid', label: 'Réglé', align: 'right',
      render: (s) => <span className="text-pistachio">{formatCurrency(statsOf(s.id).paid)}</span>,
    },
    {
      key: 'rest', label: 'Solde', align: 'right',
      render: (s) => {
        const bal = statsOf(s.id).balance;
        return bal.hasCredit ? (
          <span className="font-bold text-pistachio">+ {formatCurrency(bal.creditToReturn)}</span>
        ) : (
          <span className={bal.hasDebt ? 'font-bold text-rose-deep' : 'text-pistachio'}>
            {formatCurrency(Math.max(0, bal.net))}
          </span>
        );
      },
    },
    {
      key: 'state', label: 'État', align: 'center',
      render: (s) => {
        const bal = statsOf(s.id).balance;
        return bal.hasDebt ? (
          <Badge variant="danger" className="text-[10px]"><AlertTriangle size={10} /> Dette</Badge>
        ) : bal.hasCredit ? (
          <Badge variant="success" className="text-[10px]"><PiggyBank size={10} /> Trop-versé</Badge>
        ) : (
          <Badge variant="success" className="text-[10px]"><CheckCircle2 size={10} /> À jour</Badge>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fournisseurs"
        icon={<Truck size={24} />}
        subtitle={`${suppliers.length} fournisseur(s) · ${formatCurrency(globals.rest)} de dettes en cours`}
        actions={
          can('suppliers', 'create') && (
            <Button variant="gold" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus size={18} /> Nouveau fournisseur
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total achats" value={globals.total} format="currency" icon={<Receipt size={22} />} index={0} accent="gold" />
        <StatCard label="Total réglé" value={globals.paid} format="currency" icon={<CheckCircle2 size={22} />} index={1} accent="pistachio" />
        <StatCard label="Dettes fournisseurs" value={globals.rest} format="currency" icon={<TrendingDown size={22} />} index={2} accent="rose" />
        <StatCard label="Trop-versés à récupérer" value={globals.credit} format="currency" icon={<PiggyBank size={22} />} index={3} accent="pistachio" />
        <StatCard label="Fournisseurs à payer" value={globals.withDebt} icon={<AlertTriangle size={22} />} index={4} accent="caramel" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un fournisseur (nom / téléphone / adresse)…" />
        </div>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as SupplierFilter)}
          options={[
            { value: 'all', label: 'Tous les fournisseurs' },
            { value: 'debt', label: 'Avec dette' },
            { value: 'credit', label: 'Avec trop-versé' },
            { value: 'clear', label: 'Sans dette' },
          ]}
          className="max-w-[210px]"
        />
        <ViewToggle view={view} onChange={setView} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="Aucun fournisseur ne correspond à ces filtres" icon={<Truck size={32} />} />
      ) : view === 'table' ? (
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(s) => s.id}
          actions={supplierActions}
          onRowClick={(s) => setHistory(s)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s, i) => {
            const st = statsOf(s.id);
            const bal = st.balance;
            const hasDebt = bal.hasDebt;
            const hasCredit = bal.hasCredit;
            return (
              <Card
                key={s.id}
                index={i}
                hoverable
                className={`flex flex-col overflow-hidden rounded-2xl border p-0 ${
                  hasDebt ? 'border-rose-deep/35' : 'border-gold/20'
                }`}
              >
                <div className={`flex items-center gap-3 px-4 py-3.5 ${hasDebt ? 'bg-rose-deep/10' : 'bg-gold/10'}`}>
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-bold text-white ${
                    hasDebt ? 'bg-gradient-rose' : 'bg-gradient-button'
                  }`}>
                    {s.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-display font-semibold text-text-primary">{s.name}</h3>
                    <p className="flex items-center gap-1 truncate text-xs text-text-muted">
                      <Phone size={11} /> {s.phone || '—'}
                    </p>
                    {s.address && (
                      <p className="flex items-center gap-1 truncate text-[11px] text-text-muted">
                        <MapPin size={10} /> {s.address}
                      </p>
                    )}
                  </div>
                  {hasDebt ? (
                    <Badge variant="danger" className="gap-1"><AlertTriangle size={10} /> Dette</Badge>
                  ) : hasCredit ? (
                    <Badge variant="success" className="gap-1">
                      <PiggyBank size={10} /> + {formatCurrency(bal.creditToReturn)}
                    </Badge>
                  ) : (
                    <Badge variant="success" className="gap-1"><CheckCircle2 size={10} /> À jour</Badge>
                  )}
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-3 rounded-xl border border-gold/15 bg-vanilla/40 p-3">
                    <div className="mb-2.5 grid grid-cols-3 gap-2">
                      <Fig label="Total acheté" value={formatCurrency(st.total)} />
                      <Fig label="Total réglé" value={formatCurrency(st.paid)} accent="text-pistachio" />
                      <Fig
                        label={hasCredit ? 'Trop-versé' : 'Reste'}
                        value={hasCredit ? `+ ${formatCurrency(bal.creditToReturn)}` : formatCurrency(Math.max(0, bal.net))}
                        accent={hasDebt ? 'text-rose-deep' : 'text-pistachio'}
                      />
                    </div>
                    <div className="h-2 overflow-hidden rounded-full border border-gold/10 bg-vanilla">
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: bal.paidPercent / 100 }}
                        style={{ transformOrigin: '0% 50%' }}
                        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        className={`h-full w-full rounded-full ${hasDebt ? 'bg-gradient-button' : 'bg-gradient-mint'}`}
                      />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[10px] text-text-muted">
                      <span>
                        {st.count} facture(s)
                        {st.oldDebtsCount > 0 && ` · ${st.oldDebtsCount} ancienne(s) dette(s)`}
                      </span>
                      <span>{st.paymentsCount} règlement(s) · {bal.paidPercent.toFixed(0)} %</span>
                    </div>
                  </div>

                  <div className="mt-auto space-y-2">
                    {can('suppliers', 'pay') && (
                      <Button
                        variant="gold" className="w-full font-bold"
                        onClick={() => setVersing(s)}
                        title="Enregistrer un versement au fournisseur"
                      >
                        <HandCoins size={16} />
                        {hasDebt ? `Versement (reste ${formatCurrency(bal.net)})` : 'Versement'}
                      </Button>
                    )}

                    {bal.credit > 0 && can('suppliers', 'pay') && (
                      <Button
                        variant="mint" className="w-full font-bold"
                        onClick={() => setRefunding(s)}
                        title="Enregistrer la restitution du trop-versé par le fournisseur"
                      >
                        <Undo2 size={16} /> Récupérer l&rsquo;excédent ({formatCurrency(bal.credit)})
                      </Button>
                    )}

                    <div className="grid grid-cols-2 gap-1.5">
                      {/* NOUVEAU BOUTON — remplace « Versements (n) » */}
                      <Button
                        size="sm" variant="secondary" className="text-xs"
                        onClick={() => setHistory(s)}
                        title="Tout l'historique du fournisseur, opération par opération"
                      >
                        <Layers size={14} /> Historique
                      </Button>
                      <Button
                        size="sm" variant="secondary" className="text-xs"
                        onClick={() => setStatement(s)}
                        title="Compte rendu sur une période"
                      >
                        <FileBarChart size={14} /> Compte rendu
                      </Button>
                    </div>
                    {can('suppliers', 'create') && (
                      <Button
                        size="sm" variant="secondary" className="w-full text-xs"
                        onClick={() => { setEditOldDebt(null); setOldDebtFor(s); }}
                        title="Saisir une somme déjà due au fournisseur avant le logiciel"
                      >
                        <History size={14} /> Ancienne dette
                        {st.oldDebtsCount > 0 && ` (${st.oldDebtsCount})`}
                      </Button>
                    )}
                    <div className="flex gap-1.5">
                      {can('suppliers', 'edit') && (
                        <Button size="sm" variant="ghost" className="flex-1 text-xs" onClick={() => { setEditing(s); setFormOpen(true); }}>
                          <Pencil size={14} /> Modifier
                        </Button>
                      )}
                      {can('suppliers', 'delete') && (
                        <Button size="sm" variant="ghost" className="flex-1 text-xs" onClick={() => setDeleteId(s.id)}>
                          <Trash2 size={14} className="text-rose-deep" /> Supprimer
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ---- Create / edit supplier ---- */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Modifier le fournisseur' : 'Nouveau fournisseur'} size="sm">
        <SupplierForm initial={editing} onSubmit={handleSubmit} onCancel={() => setFormOpen(false)} />
      </Modal>

      {/* ---- HISTORIQUE COMPLET (plein écran) ---- */}
      <SupplierHistoryScreen
        supplier={history}
        onClose={() => setHistory(null)}
        onNewVersement={(s) => { setHistory(null); setVersing(s); }}
        onNewOldDebt={(s) => { setHistory(null); setEditOldDebt(null); setOldDebtFor(s); }}
        onEditOldDebt={(s, d) => { setHistory(null); setEditOldDebt(d); setOldDebtFor(s); }}
        onRefund={(s) => { setHistory(null); setRefunding(s); }}
        onStatement={(s) => { setHistory(null); setStatement(s); }}
        onEditPurchase={(p) => { setHistory(null); setEditPurchase(p); }}
      />

      {/* ---- Modification d'une facture d'achat ---- */}
      <Modal
        open={!!editPurchase}
        onClose={() => setEditPurchase(null)}
        title={`Modifier la facture ${editPurchase?.reference ?? ''}`}
        size="xl"
      >
        {editPurchase && (
          <CreatePurchase editing={editPurchase} onClose={() => setEditPurchase(null)} />
        )}
      </Modal>

      {/* ---- Versement au fournisseur ---- */}
      {versing && (() => {
        const st = statsOf(versing.id);
        return (
          <VersementModal
            open={!!versing}
            onClose={() => setVersing(null)}
            clientName={versing.name}
            clientPhone={versing.phone}
            total={st.total}
            paid={st.paid + st.credit}
            onSubmit={(amount, notes, paidAt, method) =>
              handleVersement(versing, amount, notes, paidAt, method)}
          />
        );
      })()}

      {/* ---- Ancienne dette fournisseur ---- */}
      {oldDebtFor && (
        <OldDebtModal
          open={!!oldDebtFor}
          onClose={() => { setOldDebtFor(null); setEditOldDebt(null); }}
          kind="supplier"
          partyName={oldDebtFor.name}
          initial={editOldDebt}
          onSubmit={(amount, date, description) =>
            handleOldDebt(oldDebtFor, amount, date, description)}
        />
      )}

      {/* ---- Récupérer le trop-versé ---- */}
      {refunding && (() => {
        const st = statsOf(refunding.id);
        return (
          <RefundCreditModal
            open={!!refunding}
            onClose={() => setRefunding(null)}
            kind="supplier"
            partyName={refunding.name}
            partyPhone={refunding.phone}
            credit={st.credit}
            onSubmit={(amount, notes, refundedAt, method) =>
              handleRefund(refunding, amount, notes, refundedAt, method)}
          />
        );
      })()}

      {/* ---- Compte rendu sur une période ---- */}
      <SupplierStatementModal supplier={statement} onClose={() => setStatement(null)} />

      {/* ---- Proposer l'impression du reçu ---- */}
      <Modal open={!!printPrompt} onClose={() => setPrintPrompt(null)} size="sm">
        <div className="flex flex-col items-center py-2 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-pistachio/15">
            <CheckCircle2 size={30} className="text-pistachio" />
          </div>
          <h3 className="mb-1 font-display text-lg font-semibold text-text-primary">Versement enregistré</h3>
          <p className="mb-1 text-sm text-text-secondary">
            {printPrompt && formatCurrency(printPrompt.payment.amount)} — {printPrompt?.supplier.name}
          </p>
          <p className="mb-6 text-sm text-text-muted">Voulez-vous imprimer le reçu de règlement ?</p>
          <div className="flex w-full gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setPrintPrompt(null)}>Non, merci</Button>
            <Button
              variant="gold" className="flex-1"
              onClick={() => {
                if (printPrompt) doPrintReceipt(printPrompt.supplier, printPrompt.payment);
                setPrintPrompt(null);
              }}
            >
              <Printer size={16} /> Imprimer
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) void deleteSupplier(deleteId).then(() => toast.success('Fournisseur supprimé')); }}
        title="Supprimer le fournisseur"
      />
    </div>
  );
}

function Fig({ label, value, accent = 'text-text-primary' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="text-center">
      <p className="text-[9px] uppercase leading-tight tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-[11px] font-bold tabular ${accent}`}>{value}</p>
    </div>
  );
}
