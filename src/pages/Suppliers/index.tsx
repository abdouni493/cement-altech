import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Truck, Plus, Pencil, Trash2, Phone, MapPin, Wallet, Printer,
  CheckCircle2, AlertTriangle, Receipt, TrendingDown, Coins, FileBarChart, Eye,
  HandCoins,
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
import { StatCard } from '@/components/shared/StatCard';
import { SupplierForm } from '@/components/shared/SupplierForm';
import { VersementModal } from '@/components/shared/VersementModal';
import { EditPaymentModal } from '@/components/shared/EditPaymentModal';
import { EditPurchaseModal } from '@/components/shared/EditPurchaseModal';
import { SupplierStatementModal } from '@/components/shared/SupplierStatementModal';
import { useSupplierStore } from '@/store/supplierStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, formatDateTime, paymentMethodLabel } from '@/lib/utils';
import { printPaymentReceipt } from '@/lib/documents';
import { printInvoice } from '@/lib/print';
import { toast } from '@/components/ui/Toast';
import type { Supplier, PartyPayment, PaymentMethodDetails, Purchase } from '@/types';

type SupplierFilter = 'all' | 'debt' | 'clear';

export default function SuppliersPage() {
  const { can } = usePermissions();
  const { suppliers, payments, addSupplier, updateSupplier, deleteSupplier, payDebt, updatePayment, deletePayment } =
    useSupplierStore();
  const { purchases, updatePurchase, deletePurchase } = usePurchaseStore();
  const settings = useSettingsStore((s) => s.settings);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SupplierFilter>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<Supplier | null>(null);
  const [historyTab, setHistoryTab] = useState<'purchases' | 'payments'>('payments');
  const [versing, setVersing] = useState<Supplier | null>(null);
  const [editPayment, setEditPayment] = useState<PartyPayment | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [viewPurchase, setViewPurchase] = useState<Purchase | null>(null);
  const [editPurchase, setEditPurchase] = useState<Purchase | null>(null);
  const [deletePurchaseId, setDeletePurchaseId] = useState<string | null>(null);
  const [statement, setStatement] = useState<Supplier | null>(null);
  const [printPrompt, setPrintPrompt] = useState<{ supplier: Supplier; payment: PartyPayment } | null>(null);

  /** Debt situation of a supplier, computed from its invoices. */
  const statsOf = (id: string) => {
    const ps = purchases.filter((p) => p.supplierId === id);
    const pays = payments.filter((p) => p.partyId === id);
    return {
      count: ps.length,
      total: ps.reduce((s, x) => s + x.totalAmount, 0),
      paid: ps.reduce((s, x) => s + x.paidAmount, 0),
      rest: ps.reduce((s, x) => s + x.restAmount, 0),
      list: ps,
      payments: [...pays].sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
      settled: pays.reduce((s, x) => s + x.amount, 0),
    };
  };

  const filtered = useMemo(
    () =>
      suppliers.filter((s) => {
        const q = search.toLowerCase();
        const match = s.name.toLowerCase().includes(q) || (s.phone || '').includes(search);
        if (!match) return false;
        const rest = statsOf(s.id).rest;
        if (filter === 'debt') return rest > 0;
        if (filter === 'clear') return rest <= 0;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suppliers, search, filter, purchases, payments]
  );

  const globals = useMemo(() => {
    const total = purchases.reduce((s, p) => s + p.totalAmount, 0);
    const paid = purchases.reduce((s, p) => s + p.paidAmount, 0);
    const rest = purchases.reduce((s, p) => s + p.restAmount, 0);
    const withDebt = suppliers.filter((s) => statsOf(s.id).rest > 0).length;
    return { total, paid, rest, withDebt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchases, suppliers, payments]);

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

  /** Facture d'achat imprimée depuis l'historique du fournisseur. */
  const doPrintPurchase = (purchase: Purchase, supplier: Supplier) => {
    printInvoice(
      {
        type: 'purchase', reference: purchase.reference, date: purchase.date,
        partyName: supplier.name, partyPhone: supplier.phone, partyAddress: supplier.address,
        bonNumber: purchase.bonNumber, driverPlate: purchase.driverPlate,
        lines: purchase.products.map((l) => ({
          designation: l.productName || '', quantity: l.quantity, unitPrice: l.purchasePrice,
        })),
        total: purchase.totalAmount, paid: purchase.paidAmount, rest: purchase.restAmount,
      },
      settings
    );
  };

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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total des achats" value={globals.total} format="currency" icon={<Receipt size={22} />} index={0} accent="gold" />
        <StatCard label="Total payé" value={globals.paid} format="currency" icon={<CheckCircle2 size={22} />} index={1} accent="pistachio" />
        <StatCard label="Dettes restantes" value={globals.rest} format="currency" icon={<TrendingDown size={22} />} index={2} accent="rose" />
        <StatCard label="Fournisseurs à régler" value={globals.withDebt} icon={<AlertTriangle size={22} />} index={3} accent="caramel" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un fournisseur (nom / téléphone)…" />
        </div>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as SupplierFilter)}
          options={[
            { value: 'all', label: 'Tous les fournisseurs' },
            { value: 'debt', label: 'Avec dette' },
            { value: 'clear', label: 'Soldés' },
          ]}
          className="max-w-[200px]"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="Aucun fournisseur ne correspond à ces filtres" icon={<Truck size={32} />} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((s, i) => {
            const st = statsOf(s.id);
            const hasDebt = st.rest > 0;
            const paidPct = st.total > 0 ? Math.min(100, (st.paid / st.total) * 100) : 100;
            return (
              <Card
                key={s.id}
                index={i}
                hoverable
                className={`flex flex-col rounded-2xl p-0 overflow-hidden border ${
                  hasDebt ? 'border-rose-deep/35' : 'border-gold/20'
                }`}
              >
                {/* Header band */}
                <div className={`px-4 py-3.5 flex items-center gap-3 ${hasDebt ? 'bg-rose-deep/10' : 'bg-gold/10'}`}>
                  <div className={`h-11 w-11 rounded-xl flex items-center justify-center text-white shrink-0 ${
                    hasDebt ? 'bg-gradient-rose' : 'bg-gradient-button'
                  }`}>
                    <Truck size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display font-semibold text-text-primary truncate">{s.name}</h3>
                    <p className="text-xs text-text-muted flex items-center gap-1 truncate">
                      <Phone size={11} /> {s.phone || '—'}
                    </p>
                  </div>
                  {hasDebt ? (
                    <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 2, repeat: Infinity }}>
                      <Badge variant="danger" className="gap-1"><AlertTriangle size={10} /> Dette</Badge>
                    </motion.div>
                  ) : (
                    <Badge variant="success" className="gap-1"><CheckCircle2 size={10} /> Soldé</Badge>
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col">
                  {s.address && (
                    <p className="text-[11px] text-text-muted flex items-start gap-1 mb-3">
                      <MapPin size={12} className="mt-0.5 shrink-0 text-gold" /> {s.address}
                    </p>
                  )}

                  {/* Money block */}
                  <div className="rounded-xl border border-gold/15 bg-vanilla/40 p-3 mb-3">
                    <div className="grid grid-cols-3 gap-2 mb-2.5">
                      <Fig label="Dette totale" value={formatCurrency(st.total)} />
                      <Fig label="Total payé" value={formatCurrency(st.paid)} accent="text-pistachio" />
                      <Fig label="Reste" value={formatCurrency(st.rest)} accent={hasDebt ? 'text-rose-deep' : 'text-pistachio'} />
                    </div>
                    <div className="h-2 rounded-full bg-vanilla overflow-hidden border border-gold/10">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${paidPct}%` }}
                        transition={{ delay: i * 0.05, duration: 0.8 }}
                        className={`h-full rounded-full ${hasDebt ? 'bg-gradient-button' : 'bg-gradient-mint'}`}
                      />
                    </div>
                    <div className="flex justify-between mt-1.5 text-[10px] text-text-muted">
                      <span>{st.count} facture(s)</span>
                      <span>{st.payments.length} versement(s) · {paidPct.toFixed(0)}% payé</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-auto space-y-2">
                    {can('suppliers', 'pay') && (
                      <Button
                        variant="gold"
                        className="w-full font-bold"
                        onClick={() => setVersing(s)}
                        title="Enregistrer un versement au fournisseur"
                      >
                        <HandCoins size={16} />
                        {hasDebt ? `Versement (reste ${formatCurrency(st.rest)})` : 'Versement'}
                      </Button>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button
                        size="sm" variant="secondary" className="text-xs"
                        onClick={() => { setHistory(s); setHistoryTab('payments'); }}
                        title="Versements et factures du fournisseur"
                      >
                        <Wallet size={14} /> Versements ({st.payments.length})
                      </Button>
                      <Button
                        size="sm" variant="secondary" className="text-xs"
                        onClick={() => setStatement(s)}
                        title="Compte rendu sur une periode"
                      >
                        <FileBarChart size={14} /> Compte rendu
                      </Button>
                    </div>
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

      {/* ---- History ---- */}
      <Modal open={!!history} onClose={() => setHistory(null)} title={`Historique — ${history?.name ?? ''}`} size="lg">
        {history && (() => {
          const st = statsOf(history.id);
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Tile label="Dette totale" value={formatCurrency(st.total)} />
                <Tile label="Total payé" value={formatCurrency(st.paid)} color="text-pistachio" />
                <Tile label="Reste à payer" value={formatCurrency(st.rest)} color="text-rose-deep" />
                <Tile label="Versements" value={String(st.payments.length)} color="text-gold-dark" />
              </div>

              {can('suppliers', 'pay') && (
                <Button
                  variant="gold" className="w-full"
                  onClick={() => { setVersing(history); setHistory(null); }}
                >
                  <HandCoins size={16} /> Nouveau versement
                </Button>
              )}

              <div className="flex gap-2 border-b border-gold/15">
                {([['payments', `Versements (${st.payments.length})`], ['purchases', `Factures (${st.list.length})`]] as const).map(
                  ([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setHistoryTab(key)}
                      className={`pb-2 px-3 text-sm font-semibold border-b-2 transition-all ${
                        historyTab === key ? 'border-gold text-gold-dark' : 'border-transparent text-text-muted'
                      }`}
                    >
                      {label}
                    </button>
                  )
                )}
              </div>

              {historyTab === 'payments' ? (
                st.payments.length === 0 ? (
                  <EmptyState message="Aucun versement enregistré" icon={<Coins size={30} />} />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gold/15">
                    <table className="w-full text-sm">
                      <thead className="bg-vanilla/60 text-text-secondary">
                        <tr>
                          <th className="text-left px-3 py-2">Date &amp; heure</th>
                          <th className="text-right px-3 py-2">Montant</th>
                          <th className="text-left px-3 py-2">Mode de règlement</th>
                          <th className="text-left px-3 py-2">Note</th>
                          <th className="text-center px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {st.payments.map((p) => (
                          <tr key={p.id} className="border-t border-gold/10">
                            <td className="px-3 py-2 tabular text-xs">{formatDateTime(p.paidAt)}</td>
                            <td className="px-3 py-2 text-right tabular font-bold text-pistachio">
                              {formatCurrency(p.amount)}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <Badge variant={p.method === 'especes' || !p.method ? 'success' : 'info'}>
                                {paymentMethodLabel(p)}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-xs text-text-muted">{p.notes || '—'}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-center gap-1">
                                <Button size="icon" variant="ghost" title="Imprimer le reçu"
                                  onClick={() => doPrintReceipt(history, p)}>
                                  <Printer size={15} />
                                </Button>
                                {can('suppliers', 'edit') && (
                                  <Button size="icon" variant="ghost" title="Modifier" onClick={() => setEditPayment(p)}>
                                    <Pencil size={15} />
                                  </Button>
                                )}
                                {can('suppliers', 'delete') && (
                                  <Button size="icon" variant="ghost" title="Supprimer" onClick={() => setDeletePaymentId(p.id)}>
                                    <Trash2 size={15} className="text-rose-deep" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : st.list.length === 0 ? (
                <EmptyState message="Aucune facture d'achat" icon={<Receipt size={30} />} />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gold/15">
                  <table className="w-full text-sm">
                    <thead className="bg-vanilla/60 text-text-secondary">
                      <tr>
                        <th className="text-left px-3 py-2">N°</th>
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-right px-3 py-2">Articles</th>
                        <th className="text-right px-3 py-2">Total</th>
                        <th className="text-right px-3 py-2">Payé</th>
                        <th className="text-right px-3 py-2">Reste</th>
                        <th className="text-center px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {st.list.map((p) => (
                        <tr key={p.id} className="border-t border-gold/10">
                          <td className="px-3 py-2 font-medium">
                            {p.reference}
                            {p.bonNumber && <span className="block text-[10px] text-text-muted">Bon {p.bonNumber}</span>}
                          </td>
                          <td className="px-3 py-2 text-xs">{formatDate(p.date)}</td>
                          <td className="px-3 py-2 text-right tabular">{p.products.length}</td>
                          <td className="px-3 py-2 text-right tabular">{formatCurrency(p.totalAmount)}</td>
                          <td className="px-3 py-2 text-right tabular text-pistachio">{formatCurrency(p.paidAmount)}</td>
                          <td className="px-3 py-2 text-right tabular text-rose-deep">{formatCurrency(p.restAmount)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-center gap-1">
                              <Button size="icon" variant="ghost" title="Voir les details" onClick={() => setViewPurchase(p)}>
                                <Eye size={15} />
                              </Button>
                              <Button size="icon" variant="ghost" title="Imprimer la facture" onClick={() => doPrintPurchase(p, history)}>
                                <Printer size={15} />
                              </Button>
                              {can('suppliers', 'edit') && (
                                <Button size="icon" variant="ghost" title="Modifier la facture" onClick={() => setEditPurchase(p)}>
                                  <Pencil size={15} />
                                </Button>
                              )}
                              {can('suppliers', 'delete') && (
                                <Button size="icon" variant="ghost" title="Supprimer la facture" onClick={() => setDeletePurchaseId(p.id)}>
                                  <Trash2 size={15} className="text-rose-deep" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ---- Versement au fournisseur ---- */}
      {versing && (() => {
        const st = statsOf(versing.id);
        return (
          <VersementModal
            open={!!versing}
            onClose={() => setVersing(null)}
            kind="supplier"
            clientName={versing.name}
            clientPhone={versing.phone}
            total={st.total}
            paid={st.paid}
            onSubmit={(amount, notes, paidAt, method) =>
              handleVersement(versing, amount, notes, paidAt, method)}
          />
        );
      })()}

      {/* ---- Purchase invoice detail ---- */}
      <Modal
        open={!!viewPurchase}
        onClose={() => setViewPurchase(null)}
        title={`Facture ${viewPurchase?.reference ?? ''}`}
        size="md"
      >
        {viewPurchase && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
              <span>{formatDate(viewPurchase.date)}</span>
              {viewPurchase.bonNumber && <Badge variant="info">Bon n° {viewPurchase.bonNumber}</Badge>}
              {viewPurchase.driverPlate && <Badge variant="warning">Matricule {viewPurchase.driverPlate}</Badge>}
              {viewPurchase.createdBy && <span className="text-xs text-text-muted">par {viewPurchase.createdBy}</span>}
            </div>
            <div className="overflow-x-auto rounded-xl border border-gold/15">
              <table className="w-full text-sm">
                <thead className="bg-vanilla/60 text-text-secondary">
                  <tr>
                    <th className="text-left px-3 py-2">Produit</th>
                    <th className="text-right px-3 py-2">Qté</th>
                    <th className="text-right px-3 py-2">Prix d&rsquo;achat</th>
                    <th className="text-right px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {viewPurchase.products.map((l, i) => (
                    <tr key={i} className="border-t border-gold/10">
                      <td className="px-3 py-2 font-medium">{l.productName}</td>
                      <td className="px-3 py-2 text-right tabular">{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                      <td className="px-3 py-2 text-right tabular">{formatCurrency(l.purchasePrice)}</td>
                      <td className="px-3 py-2 text-right tabular">{formatCurrency(l.quantity * l.purchasePrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Tile label="Total" value={formatCurrency(viewPurchase.totalAmount)} />
              <Tile label="Payé" value={formatCurrency(viewPurchase.paidAmount)} color="text-pistachio" />
              <Tile label="Reste" value={formatCurrency(viewPurchase.restAmount)} color="text-rose-deep" />
            </div>
            {history && (
              <Button variant="gold" className="w-full" onClick={() => doPrintPurchase(viewPurchase, history)}>
                <Printer size={16} /> Imprimer la facture
              </Button>
            )}
          </div>
        )}
      </Modal>

      {/* ---- Edit a purchase invoice ---- */}
      <EditPurchaseModal
        purchase={editPurchase}
        onClose={() => setEditPurchase(null)}
        onSave={async (data) => {
          if (!editPurchase) return;
          await updatePurchase(editPurchase.id, data);
          toast.success('Facture modifiée');
          setEditPurchase(null);
        }}
      />

      {/* ---- Période : compte rendu détaillé ---- */}
      <SupplierStatementModal supplier={statement} onClose={() => setStatement(null)} />

      {/* ---- Edit an existing payment ---- */}
      <EditPaymentModal
        payment={editPayment}
        onClose={() => setEditPayment(null)}
        onSave={async (amount, paidAt, notes, method) => {
          if (!editPayment) return;
          await updatePayment(editPayment.id, amount, paidAt, notes, method);
          toast.success('Versement modifié — la dette du fournisseur a été recalculée');
          setEditPayment(null);
        }}
      />

      {/* ---- Ask to print after a payment ---- */}
      <Modal open={!!printPrompt} onClose={() => setPrintPrompt(null)} size="sm">
        <div className="flex flex-col items-center text-center py-2">
          <div className="h-14 w-14 rounded-full bg-pistachio/15 flex items-center justify-center mb-4">
            <CheckCircle2 size={30} className="text-pistachio" />
          </div>
          <h3 className="font-display text-lg font-semibold text-text-primary mb-1">Versement enregistré</h3>
          <p className="text-sm text-text-secondary mb-1">
            {printPrompt && formatCurrency(printPrompt.payment.amount)} — {printPrompt?.supplier.name}
          </p>
          <p className="text-sm text-text-muted mb-6">Voulez-vous imprimer le reçu de versement ?</p>
          <div className="flex gap-3 w-full">
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
      <ConfirmDialog
        open={!!deletePurchaseId}
        onClose={() => setDeletePurchaseId(null)}
        onConfirm={() => {
          if (deletePurchaseId) void deletePurchase(deletePurchaseId).then(() => { setViewPurchase(null); toast.success('Facture supprimée'); });
        }}
        title="Supprimer la facture fournisseur"
        message="La facture, ses lignes et sa sortie de caisse seront supprimées."
      />
      <ConfirmDialog
        open={!!deletePaymentId}
        onClose={() => setDeletePaymentId(null)}
        onConfirm={() => { if (deletePaymentId) void deletePayment(deletePaymentId).then(() => toast.success('Versement supprimé')); }}
        title="Supprimer le versement"
        message="Le montant sera de nouveau dû et la sortie de caisse annulée."
      />
    </div>
  );
}

function Fig({ label, value, accent = 'text-text-primary' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="text-center">
      <p className="text-[9px] uppercase tracking-wide text-text-muted leading-tight">{label}</p>
      <p className={`text-[11px] font-bold tabular ${accent} mt-0.5`}>{value}</p>
    </div>
  );
}

function Tile({ label, value, color = 'text-text-primary' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-vanilla/40 rounded-xl p-3 text-center border border-gold/10">
      <p className="text-xs text-text-muted mb-0.5">{label}</p>
      <p className={`text-base font-bold tabular ${color}`}>{value}</p>
    </div>
  );
}
