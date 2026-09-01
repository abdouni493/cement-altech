import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Users, Plus, Pencil, Trash2, Phone, Wallet, Printer, CheckCircle2,
  AlertTriangle, Receipt, TrendingDown, Coins, ClipboardList, ShoppingBag, Eye,
  FileBarChart, HandCoins,
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
import { ClientForm } from '@/components/shared/ClientForm';
import { VersementModal } from '@/components/shared/VersementModal';
import { EditPaymentModal } from '@/components/shared/EditPaymentModal';
import { EditSaleModal } from '@/components/shared/EditSaleModal';
import { ClientStatementModal } from '@/components/shared/ClientStatementModal';
import { useClientStore } from '@/store/clientStore';
import { useSalesStore } from '@/store/salesStore';
import { useCommandStore, deliveryStatus } from '@/store/commandStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, formatDateTime, paymentMethodLabel } from '@/lib/utils';
import { printPaymentReceipt } from '@/lib/documents';
import { printSaleInvoice } from '@/lib/invoicePrint';
import { toast } from '@/components/ui/Toast';
import type { Client, PartyPayment, PaymentMethodDetails, Sale } from '@/types';

type ClientFilter = 'all' | 'debt' | 'clear';
type HistoryTab = 'payments' | 'sales' | 'commands';

export default function ClientsPage() {
  const { language } = useLanguage();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const {
    clients, payments, addClient, updateClient, deleteClient,
    payDebt, updatePayment, deletePayment,
  } = useClientStore();
  const { sales, updateSale, deleteSale } = useSalesStore();
  const commands = useCommandStore((s) => s.commands);
  const settings = useSettingsStore((s) => s.settings);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ClientFilter>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [history, setHistory] = useState<Client | null>(null);
  const [historyTab, setHistoryTab] = useState<HistoryTab>('payments');
  const [versing, setVersing] = useState<Client | null>(null);
  const [editPayment, setEditPayment] = useState<PartyPayment | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [viewSale, setViewSale] = useState<Sale | null>(null);
  const [editSale, setEditSale] = useState<Sale | null>(null);
  const [deleteSaleId, setDeleteSaleId] = useState<string | null>(null);
  const [statement, setStatement] = useState<Client | null>(null);
  const [printPrompt, setPrintPrompt] = useState<{ client: Client; payment: PartyPayment } | null>(null);

  /** Full debt situation of a client — sales + commands. */
  const statsOf = (clientId: string) => {
    const cs = sales.filter((s) => s.clientId === clientId);
    const cc = commands.filter((c) => c.clientId === clientId);
    const pays = payments.filter((p) => p.partyId === clientId);
    const total = cs.reduce((s, x) => s + x.finalAmount, 0) + cc.reduce((s, x) => s + x.totalAmount, 0);
    const paid = cs.reduce((s, x) => s + x.paidAmount, 0) + cc.reduce((s, x) => s + x.paidAmount, 0);
    const rest = cs.reduce((s, x) => s + x.restAmount, 0) + cc.reduce((s, x) => s + x.restAmount, 0);
    return {
      total, paid, rest,
      salesList: [...cs].sort((a, b) => b.date.localeCompare(a.date)),
      commandsList: [...cc].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      payments: [...pays].sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
      salesTotal: cs.reduce((s, x) => s + x.finalAmount, 0),
      commandsTotal: cc.reduce((s, x) => s + x.totalAmount, 0),
    };
  };

  const filtered = useMemo(
    () =>
      clients.filter((c) => {
        const q = search.toLowerCase();
        const match = c.name.toLowerCase().includes(q) || (c.phone || '').includes(search);
        if (!match) return false;
        const rest = statsOf(c.id).rest;
        if (filter === 'debt') return rest > 0;
        if (filter === 'clear') return rest <= 0;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients, search, filter, sales, commands, payments]
  );

  const globals = useMemo(() => {
    const total =
      sales.reduce((s, x) => s + x.finalAmount, 0) + commands.reduce((s, x) => s + x.totalAmount, 0);
    const paid =
      sales.reduce((s, x) => s + x.paidAmount, 0) + commands.reduce((s, x) => s + x.paidAmount, 0);
    const rest =
      sales.reduce((s, x) => s + x.restAmount, 0) + commands.reduce((s, x) => s + x.restAmount, 0);
    const withDebt = clients.filter((c) => statsOf(c.id).rest > 0).length;
    return { total, paid, rest, withDebt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, commands, clients, payments]);

  const handleSubmit = async (data: Omit<Client, 'id'>) => {
    if (editing) {
      await updateClient(editing.id, data);
      toast.success('Client modifié');
    } else {
      await addClient(data);
      toast.success('Client créé');
    }
    setFormOpen(false);
    setEditing(null);
  };

  const handleVersement = async (
    client: Client, amount: number, notes: string, paidAt: string, method: PaymentMethodDetails,
  ) => {
    const payment = await payDebt(client.id, amount, paidAt, notes, method);
    toast.success('Versement enregistré — la dette du client a été réduite');
    setVersing(null);
    if (payment) setPrintPrompt({ client, payment });
  };

  const doPrintReceipt = (client: Client, payment: PartyPayment) => {
    const st = statsOf(client.id);
    printPaymentReceipt(
      {
        kind: 'client',
        receiptNumber: `VER-${payment.id.slice(0, 8).toUpperCase()}`,
        partyName: client.name,
        partyPhone: client.phone,
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

  /** Facture professionnelle : logo, entreprise, client, cachet et signatures. */
  const doPrintInvoice = (sale: Sale, client: Client) => {
    printSaleInvoice(
      {
        reference: sale.reference,
        date: sale.date,
        client: { name: client.name, phone: client.phone, address: client.address },
        lines: sale.products.map((l) => ({
          designation: l.productName || '',
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.sellingPrice,
          basePrice: l.basePrice,
        })),
        total: sale.totalAmount, reduction: sale.reduction, final: sale.finalAmount,
        paid: sale.paidAmount, rest: sale.restAmount, createdBy: sale.createdBy,
      },
      settings
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        icon={<Users size={24} />}
        subtitle={`${clients.length} client(s) · ${formatCurrency(globals.rest)} de dettes en cours`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/commands')}>
              <ClipboardList size={18} /> Commandes
            </Button>
            {can('clients', 'create') && (
              <Button variant="gold" onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus size={18} /> Nouveau client
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Chiffre d'affaires clients" value={globals.total} format="currency" icon={<Receipt size={22} />} index={0} accent="gold" />
        <StatCard label="Total encaissé" value={globals.paid} format="currency" icon={<CheckCircle2 size={22} />} index={1} accent="pistachio" />
        <StatCard label="Dettes clients" value={globals.rest} format="currency" icon={<TrendingDown size={22} />} index={2} accent="rose" />
        <StatCard label="Clients endettés" value={globals.withDebt} icon={<AlertTriangle size={22} />} index={3} accent="caramel" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un client (nom / téléphone)…" />
        </div>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ClientFilter)}
          options={[
            { value: 'all', label: 'Tous les clients' },
            { value: 'debt', label: 'Avec dette' },
            { value: 'clear', label: 'Sans dette' },
          ]}
          className="max-w-[200px]"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="Aucun client ne correspond à ces filtres" icon={<Users size={32} />} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((c, i) => {
            const st = statsOf(c.id);
            const hasDebt = st.rest > 0;
            const paidPct = st.total > 0 ? Math.min(100, (st.paid / st.total) * 100) : 100;
            return (
              <Card
                key={c.id}
                index={i}
                hoverable
                className={`flex flex-col rounded-2xl p-0 overflow-hidden border ${
                  hasDebt ? 'border-rose-deep/35' : 'border-gold/20'
                }`}
              >
                <div className={`px-4 py-3.5 flex items-center gap-3 ${hasDebt ? 'bg-rose-deep/10' : 'bg-gold/10'}`}>
                  <div className={`h-11 w-11 rounded-full flex items-center justify-center text-white font-bold shrink-0 ${
                    hasDebt ? 'bg-gradient-rose' : 'bg-gradient-button'
                  }`}>
                    {c.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display font-semibold text-text-primary truncate">{c.name}</h3>
                    <p className="text-xs text-text-muted flex items-center gap-1 truncate">
                      <Phone size={11} /> {c.phone || '—'}
                    </p>
                  </div>
                  {hasDebt ? (
                    <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 2, repeat: Infinity }}>
                      <Badge variant="danger" className="gap-1"><AlertTriangle size={10} /> Dette</Badge>
                    </motion.div>
                  ) : (
                    <Badge variant="success" className="gap-1"><CheckCircle2 size={10} /> À jour</Badge>
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col">
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
                      <span>{st.salesList.length} vente(s) · {st.commandsList.length} commande(s)</span>
                      <span>{st.payments.length} versement(s) · {paidPct.toFixed(0)}%</span>
                    </div>
                  </div>

                  <div className="mt-auto space-y-2">
                    {can('clients', 'pay') && (
                      <Button
                        variant="gold"
                        className="w-full font-bold"
                        onClick={() => setVersing(c)}
                        title="Enregistrer un versement du client"
                      >
                        <HandCoins size={16} />
                        {hasDebt ? `Versement (reste ${formatCurrency(st.rest)})` : 'Versement'}
                      </Button>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button
                        size="sm" variant="secondary" className="text-xs"
                        onClick={() => { setHistory(c); setHistoryTab('payments'); }}
                        title="Versements, ventes et commandes du client"
                      >
                        <Wallet size={14} /> Versements ({st.payments.length})
                      </Button>
                      <Button
                        size="sm" variant="secondary" className="text-xs"
                        onClick={() => setStatement(c)}
                        title="Compte rendu sur une période"
                      >
                        <FileBarChart size={14} /> Compte rendu
                      </Button>
                    </div>
                    <div className="flex gap-1.5">
                      {can('clients', 'edit') && (
                        <Button size="sm" variant="ghost" className="flex-1 text-xs" onClick={() => { setEditing(c); setFormOpen(true); }}>
                          <Pencil size={14} /> Modifier
                        </Button>
                      )}
                      {can('clients', 'delete') && (
                        <Button size="sm" variant="ghost" className="flex-1 text-xs" onClick={() => setDeleteId(c.id)}>
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

      {/* ---- Create / edit ---- */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Modifier le client' : 'Nouveau client'} size="sm">
        <ClientForm initial={editing} onSubmit={handleSubmit} onCancel={() => setFormOpen(false)} />
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

              {can('clients', 'pay') && (
                <Button
                  variant="gold" className="w-full"
                  onClick={() => { setVersing(history); setHistory(null); }}
                >
                  <HandCoins size={16} /> Nouveau versement
                </Button>
              )}

              <div className="flex gap-2 border-b border-gold/15 overflow-x-auto">
                {([
                  ['payments', `Versements (${st.payments.length})`],
                  ['sales', `Ventes (${st.salesList.length})`],
                  ['commands', `Commandes (${st.commandsList.length})`],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setHistoryTab(key)}
                    className={`pb-2 px-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                      historyTab === key ? 'border-gold text-gold-dark' : 'border-transparent text-text-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {historyTab === 'payments' && (
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
                            <td className="px-3 py-2 text-right tabular font-bold text-pistachio">{formatCurrency(p.amount)}</td>
                            <td className="px-3 py-2 text-xs">
                              <Badge variant={p.method === 'especes' || !p.method ? 'success' : 'info'}>
                                {paymentMethodLabel(p)}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-xs text-text-muted">{p.notes || '—'}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-center gap-1">
                                <Button size="icon" variant="ghost" title="Imprimer le reçu du versement" onClick={() => doPrintReceipt(history, p)}>
                                  <Printer size={15} />
                                </Button>
                                {can('clients', 'edit') && (
                                  <Button size="icon" variant="ghost" title="Modifier" onClick={() => setEditPayment(p)}>
                                    <Pencil size={15} />
                                  </Button>
                                )}
                                {can('clients', 'delete') && (
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
              )}

              {historyTab === 'sales' && (
                st.salesList.length === 0 ? (
                  <EmptyState message="Aucune vente" icon={<ShoppingBag size={30} />} />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gold/15">
                    <table className="w-full text-sm">
                      <thead className="bg-vanilla/60 text-text-secondary">
                        <tr>
                          <th className="text-left px-3 py-2">N°</th>
                          <th className="text-left px-3 py-2">Date</th>
                          <th className="text-right px-3 py-2">Articles</th>
                          <th className="text-right px-3 py-2">Total</th>
                          <th className="text-right px-3 py-2">Reste</th>
                          <th className="text-center px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {st.salesList.map((s) => (
                          <tr key={s.id} className="border-t border-gold/10">
                            <td className="px-3 py-2 font-medium">{s.reference}</td>
                            <td className="px-3 py-2 text-xs">{formatDate(s.date, language)}</td>
                            <td className="px-3 py-2 text-right tabular">{s.products.length}</td>
                            <td className="px-3 py-2 text-right tabular">{formatCurrency(s.finalAmount)}</td>
                            <td className={`px-3 py-2 text-right tabular ${s.restAmount > 0 ? 'text-rose-deep' : 'text-pistachio'}`}>
                              {formatCurrency(s.restAmount)}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-center gap-1">
                                <Button size="icon" variant="ghost" onClick={() => setViewSale(s)} title="Voir les détails">
                                  <Eye size={15} />
                                </Button>
                                <Button size="icon" variant="ghost" title="Imprimer la facture" onClick={() => doPrintInvoice(s, history)}>
                                  <Printer size={15} />
                                </Button>
                                {can('clients', 'edit') && (
                                  <Button size="icon" variant="ghost" title="Modifier la facture" onClick={() => setEditSale(s)}>
                                    <Pencil size={15} />
                                  </Button>
                                )}
                                {can('clients', 'delete') && (
                                  <Button size="icon" variant="ghost" title="Supprimer la facture" onClick={() => setDeleteSaleId(s.id)}>
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
              )}

              {historyTab === 'commands' && (
                st.commandsList.length === 0 ? (
                  <EmptyState message="Aucune commande" icon={<ClipboardList size={30} />} />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gold/15">
                    <table className="w-full text-sm">
                      <thead className="bg-vanilla/60 text-text-secondary">
                        <tr>
                          <th className="text-left px-3 py-2">N°</th>
                          <th className="text-left px-3 py-2">Créée le</th>
                          <th className="text-left px-3 py-2">Livraison</th>
                          <th className="text-right px-3 py-2">Total</th>
                          <th className="text-right px-3 py-2">Reste</th>
                          <th className="text-center px-3 py-2">État</th>
                        </tr>
                      </thead>
                      <tbody>
                        {st.commandsList.map((cmd) => {
                          const d = deliveryStatus(cmd);
                          return (
                            <tr key={cmd.id} className="border-t border-gold/10">
                              <td className="px-3 py-2 font-medium">{cmd.reference}</td>
                              <td className="px-3 py-2 text-xs">{formatDate(cmd.createdAt.slice(0, 10), language)}</td>
                              <td className="px-3 py-2 text-xs">
                                {formatDate(cmd.receiveDate, language)} à {cmd.receiveHour}h{cmd.receiveMinute}
                              </td>
                              <td className="px-3 py-2 text-right tabular">{formatCurrency(cmd.totalAmount)}</td>
                              <td className={`px-3 py-2 text-right tabular ${cmd.restAmount > 0 ? 'text-rose-deep' : 'text-pistachio'}`}>
                                {formatCurrency(cmd.restAmount)}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <Badge variant={d.isFull ? 'success' : d.isPartial ? 'warning' : 'danger'}>
                                  {d.isFull ? 'Livrée' : d.isPartial ? `Partielle ${d.percent.toFixed(0)}%` : 'Non livrée'}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ---- Sale detail (shows the unit price actually applied) ---- */}
      <Modal open={!!viewSale} onClose={() => setViewSale(null)} title={`Vente ${viewSale?.reference ?? ''}`} size="md">
        {viewSale && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              {formatDateTime(viewSale.date, language)}
              {viewSale.createdBy ? ` · par ${viewSale.createdBy}` : ''}
            </p>
            <div className="overflow-x-auto rounded-xl border border-gold/15">
              <table className="w-full text-sm">
                <thead className="bg-vanilla/60 text-text-secondary">
                  <tr>
                    <th className="text-left px-3 py-2">Produit</th>
                    <th className="text-right px-3 py-2">Qté</th>
                    <th className="text-right px-3 py-2">Prix catalogue</th>
                    <th className="text-right px-3 py-2">Prix appliqué</th>
                    <th className="text-right px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {viewSale.products.map((l, i) => {
                    const overridden = l.basePrice !== undefined && Math.abs(l.basePrice - l.sellingPrice) > 0.001;
                    return (
                      <tr key={i} className="border-t border-gold/10">
                        <td className="px-3 py-2 font-medium">
                          {l.productName}
                          {l.unit && <span className="text-xs text-gold-dark"> · {l.unit}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular">{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                        <td className="px-3 py-2 text-right tabular text-text-muted">
                          {l.basePrice !== undefined ? formatCurrency(l.basePrice) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular font-bold text-gold-dark">
                          {formatCurrency(l.sellingPrice)}
                          {overridden && <Badge variant="warning" className="ml-1.5 text-[9px]">modifié</Badge>}
                        </td>
                        <td className="px-3 py-2 text-right tabular">{formatCurrency(l.quantity * l.sellingPrice)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Tile label="Total" value={formatCurrency(viewSale.totalAmount)} />
              <Tile label="Réduction" value={formatCurrency(viewSale.reduction)} />
              <Tile label="Payé" value={formatCurrency(viewSale.paidAmount)} color="text-pistachio" />
              <Tile label="Reste" value={formatCurrency(viewSale.restAmount)} color="text-rose-deep" />
            </div>
            {history && (
              <Button variant="gold" className="w-full" onClick={() => doPrintInvoice(viewSale, history)}>
                <Printer size={16} /> Imprimer la facture
              </Button>
            )}
          </div>
        )}
      </Modal>

      {/* ---- Versement du client ---- */}
      {versing && (() => {
        const st = statsOf(versing.id);
        return (
          <VersementModal
            open={!!versing}
            onClose={() => setVersing(null)}
            clientName={versing.name}
            clientPhone={versing.phone}
            total={st.total}
            paid={st.paid}
            onSubmit={(amount, notes, paidAt, method) =>
              handleVersement(versing, amount, notes, paidAt, method)}
          />
        );
      })()}

      {/* ---- Edit a sale invoice ---- */}
      <EditSaleModal
        sale={editSale}
        onClose={() => setEditSale(null)}
        onSave={async (data) => {
          if (!editSale) return;
          await updateSale(editSale.id, data);
          toast.success('Facture modifiée');
          setEditSale(null);
        }}
      />

      {/* ---- Période : compte rendu détaillé ---- */}
      <ClientStatementModal client={statement} onClose={() => setStatement(null)} />

      <EditPaymentModal
        payment={editPayment}
        onClose={() => setEditPayment(null)}
        onSave={async (amount, paidAt, notes, method) => {
          if (!editPayment) return;
          await updatePayment(editPayment.id, amount, paidAt, notes, method);
          toast.success('Versement modifié — la dette du client a été recalculée');
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
            {printPrompt && formatCurrency(printPrompt.payment.amount)} — {printPrompt?.client.name}
          </p>
          <p className="text-sm text-text-muted mb-6">Voulez-vous imprimer le reçu de versement ?</p>
          <div className="flex gap-3 w-full">
            <Button variant="secondary" className="flex-1" onClick={() => setPrintPrompt(null)}>Non, merci</Button>
            <Button
              variant="gold" className="flex-1"
              onClick={() => {
                if (printPrompt) doPrintReceipt(printPrompt.client, printPrompt.payment);
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
        onConfirm={() => { if (deleteId) void deleteClient(deleteId).then(() => toast.success('Client supprimé')); }}
        title="Supprimer le client"
      />
      <ConfirmDialog
        open={!!deleteSaleId}
        onClose={() => setDeleteSaleId(null)}
        onConfirm={() => {
          if (deleteSaleId) void deleteSale(deleteSaleId).then(() => { setViewSale(null); toast.success('Facture supprimée'); });
        }}
        title="Supprimer la facture de vente"
        message="La vente, ses lignes et son encaissement de caisse seront supprimés."
      />
      <ConfirmDialog
        open={!!deletePaymentId}
        onClose={() => setDeletePaymentId(null)}
        onConfirm={() => { if (deletePaymentId) void deletePayment(deletePaymentId).then(() => toast.success('Versement supprimé')); }}
        title="Supprimer le versement"
        message="Le montant redeviendra dû et l'entrée de caisse sera annulée."
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
