import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingCart, Plus, Search, Calendar, Clock, Eye, Pencil, Trash2, CheckCircle2,
  AlertTriangle, Printer, UserPlus, X, Coins, User, Phone, Receipt, Truck,
  PackageCheck, History, ClipboardList, MapPin, Hash,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { SearchBar } from '@/components/ui/SearchBar';
import { StatCard } from '@/components/shared/StatCard';
import { toast } from '@/components/ui/Toast';
import { DeliveryModal } from './DeliveryModal';
import {
  useCommandStore, deliveryStatus,
  type Command, type CommandLine, type DeliveryDriver,
} from '@/store/commandStore';
import { useClientStore } from '@/store/clientStore';
import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, formatDateTime, todayISO } from '@/lib/utils';
import { printCommandOrder, printDeliveryNote } from '@/lib/documents';
import { cardVariants } from '@/lib/animations';
import type { CommandDelivery } from '@/types';

type DateFilter = 'today' | 'week' | 'month' | 'period' | 'all';
type StatusFilter = 'all' | 'paid' | 'debt' | 'undelivered' | 'partial' | 'delivered';

export default function CommandsPage() {
  const { language } = useLanguage();
  const { can } = usePermissions();
  const navigate = useNavigate();

  const {
    commands, deliveries, addCommand, updateCommand, deleteCommand, payDebt,
    addDelivery, updateDelivery, deleteDelivery,
  } = useCommandStore();
  const { clients, addClient, updateClient } = useClientStore();
  const { ficheTechnics } = useFicheTechnicStore();
  const settings = useSettingsStore((s) => s.settings);

  // Filters
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());

  // Create / edit form
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] =
    useState<{ id: string; name: string; phone?: string; address?: string } | null>(null);
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');
  /** Adresse de livraison — redemandée à CHAQUE commande. */
  const [clientAddress, setClientAddress] = useState('');
  const [addressError, setAddressError] = useState(false);
  /** Chauffeur qui emmènera la commande (matricule facultatif). */
  const [driverName, setDriverName] = useState('');
  const [driverPlate, setDriverPlate] = useState('');
  const [recipeSearch, setRecipeSearch] = useState('');
  const [selectedItems, setSelectedItems] = useState<CommandLine[]>([]);
  const [receiveDate, setReceiveDate] = useState(todayISO());
  const [receiveHour, setReceiveHour] = useState('14');
  const [receiveMinute, setReceiveMinute] = useState('30');
  const [customTotal, setCustomTotal] = useState<number | null>(null);
  const [versement, setVersement] = useState(0);
  const [bonNumber, setBonNumber] = useState('');
  const [createdDate, setCreatedDate] = useState(todayISO());
  const [originalCreatedDate, setOriginalCreatedDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  // Interaction modals
  const [viewingCmd, setViewingCmd] = useState<Command | null>(null);
  const [deliverCmd, setDeliverCmd] = useState<Command | null>(null);
  const [editingDelivery, setEditingDelivery] = useState<CommandDelivery | null>(null);
  const [historyCmd, setHistoryCmd] = useState<Command | null>(null);
  const [payCmd, setPayCmd] = useState<Command | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteDeliveryId, setDeleteDeliveryId] = useState<string | null>(null);
  const [printPrompt, setPrintPrompt] = useState<
    { kind: 'command'; cmd: Command } | { kind: 'delivery'; cmd: Command; delivery: CommandDelivery } | null
  >(null);

  const deliveriesOf = (commandId: string) =>
    deliveries.filter((d) => d.commandId === commandId).sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt));

  /* --------------------------------------------------------------- filters */
  const filteredCommands = useMemo(() => {
    return commands.filter((c) => {
      const q = search.toLowerCase();
      const matchesSearch =
        c.clientName.toLowerCase().includes(q) ||
        c.reference.toLowerCase().includes(q) ||
        (c.bonNumber || '').toLowerCase().includes(q) ||
        (c.clientPhone ? c.clientPhone.includes(search) : false);

      const d = deliveryStatus(c);
      let matchesStatus = true;
      if (statusFilter === 'paid') matchesStatus = c.restAmount <= 0;
      else if (statusFilter === 'debt') matchesStatus = c.restAmount > 0;
      else if (statusFilter === 'undelivered') matchesStatus = d.delivered <= 0;
      else if (statusFilter === 'partial') matchesStatus = d.isPartial;
      else if (statusFilter === 'delivered') matchesStatus = d.isFull;

      let matchesDate = true;
      const cmdTime = new Date(c.createdAt).getTime();
      if (dateFilter === 'today') {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        const end = new Date(); end.setHours(23, 59, 59, 999);
        matchesDate = cmdTime >= start.getTime() && cmdTime <= end.getTime();
      } else if (dateFilter === 'week') {
        const start = new Date(); start.setDate(start.getDate() - 7);
        matchesDate = cmdTime >= start.getTime();
      } else if (dateFilter === 'month') {
        const start = new Date(); start.setDate(start.getDate() - 30);
        matchesDate = cmdTime >= start.getTime();
      } else if (dateFilter === 'period') {
        const start = new Date(from); start.setHours(0, 0, 0, 0);
        const end = new Date(to + 'T23:59:59');
        matchesDate = cmdTime >= start.getTime() && cmdTime <= end.getTime();
      }

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [commands, search, statusFilter, dateFilter, from, to]);

  const stats = useMemo(() => {
    const totalPaid = filteredCommands.reduce((s, c) => s + c.paidAmount, 0);
    const totalRest = filteredCommands.reduce((s, c) => s + c.restAmount, 0);
    const totalValue = filteredCommands.reduce((s, c) => s + c.totalAmount, 0);
    const pendingDelivery = filteredCommands.filter((c) => !deliveryStatus(c).isFull).length;
    return { totalPaid, totalRest, totalValue, pendingDelivery };
  }, [filteredCommands]);

  const clientSearchResults = useMemo(
    () =>
      clientSearch
        ? clients.filter(
            (c) =>
              c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
              (c.phone || '').includes(clientSearch)
          )
        : [],
    [clients, clientSearch]
  );

  const recipeSearchResults = useMemo(
    () => (recipeSearch ? ficheTechnics.filter((ft) => ft.name.toLowerCase().includes(recipeSearch.toLowerCase())) : []),
    [ficheTechnics, recipeSearch]
  );

  /* ---------------------------------------------------------------- form */
  const handleCreateClientInline = async () => {
    if (!newClientName.trim()) { toast.error('Nom du client requis'); return; }
    if (!newClientAddress.trim()) { toast.error('Adresse du client requise'); return; }
    const newCli = await addClient({
      name: newClientName.trim(),
      phone: newClientPhone.trim(),
      address: newClientAddress.trim(),
    });
    setSelectedClient(newCli);
    setClientAddress(newCli.address || newClientAddress.trim());
    setAddressError(false);
    setNewClientName(''); setNewClientPhone(''); setNewClientAddress('');
    setShowNewClientForm(false);
    toast.success('Client créé et sélectionné');
  };

  /** Sélection d'un client : son adresse connue est proposée, jamais imposée. */
  const handleSelectClient = (cli: { id: string; name: string; phone?: string; address?: string }) => {
    setSelectedClient(cli);
    setClientAddress(cli.address || '');
    setAddressError(false);
    setClientSearch('');
  };

  const handleAddRecipeLine = (ft: (typeof ficheTechnics)[0]) => {
    if (selectedItems.find((item) => item.ficheTechnicId === ft.id)) {
      toast.error('Ce produit est déjà dans la commande');
      return;
    }
    setSelectedItems([
      ...selectedItems,
      {
        ficheTechnicId: ft.id,
        productName: ft.name,
        quantity: 1,
        unitPrice: ft.unitPrice,
        totalPrice: ft.unitPrice,
        sellByUnit: ft.sellByUnit,
        sellUnit: ft.sellUnit,
      },
    ]);
    setRecipeSearch('');
  };

  const handleUpdateItemQty = (index: number, qty: number) =>
    setSelectedItems(selectedItems.map((it, i) => (i === index ? { ...it, quantity: qty, totalPrice: qty * it.unitPrice } : it)));
  const handleUpdateItemPrice = (index: number, price: number) =>
    setSelectedItems(selectedItems.map((it, i) => (i === index ? { ...it, unitPrice: price, totalPrice: it.quantity * price } : it)));
  const handleRemoveItem = (index: number) => setSelectedItems(selectedItems.filter((_, i) => i !== index));

  const computedTotalSum = selectedItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const finalTotalAmount = customTotal !== null ? customTotal : computedTotalSum;

  const handleOpenCreateForm = () => {
    setEditingId(null); setSelectedClient(null); setSelectedItems([]);
    setReceiveDate(todayISO()); setReceiveHour('14'); setReceiveMinute('30');
    setCustomTotal(null); setVersement(0); setClientSearch(''); setRecipeSearch('');
    setBonNumber(''); setCreatedDate(todayISO()); setOriginalCreatedDate(todayISO());
    // l'adresse et le chauffeur sont redemandés à chaque nouvelle commande
    setClientAddress(''); setAddressError(false);
    setDriverName(''); setDriverPlate('');
    setNewClientName(''); setNewClientPhone(''); setNewClientAddress('');
    setShowNewClientForm(false); setFormOpen(true);
  };

  const handleOpenEditForm = (cmd: Command) => {
    setEditingId(cmd.id);
    const known = clients.find((c) => c.id === cmd.clientId);
    setSelectedClient({
      id: cmd.clientId, name: cmd.clientName, phone: cmd.clientPhone,
      address: cmd.clientAddress ?? known?.address,
    });
    setClientAddress(cmd.clientAddress || known?.address || '');
    setAddressError(false);
    setDriverName(cmd.driverName || '');
    setDriverPlate(cmd.driverPlate || '');
    setSelectedItems(cmd.items);
    setReceiveDate(cmd.receiveDate); setReceiveHour(cmd.receiveHour); setReceiveMinute(cmd.receiveMinute);
    setCustomTotal(cmd.totalAmount); setVersement(cmd.paidAmount);
    setBonNumber(cmd.bonNumber || '');
    setCreatedDate(cmd.createdAt.slice(0, 10)); setOriginalCreatedDate(cmd.createdAt.slice(0, 10));
    setFormOpen(true);
  };

  const handleSaveCommand = async () => {
    if (!selectedClient) { toast.error('Veuillez sélectionner un client'); return; }
    if (!clientAddress.trim()) {
      setAddressError(true);
      toast.error("L'adresse de livraison du client est obligatoire");
      return;
    }
    if (selectedItems.length === 0) { toast.error('Ajoutez au moins un produit'); return; }
    if (versement < 0) { toast.error('Le versement ne peut pas être négatif'); return; }

    setSaving(true);
    try {
      // Back-date the command only when the operator actually changed the date;
      // otherwise the real timestamp (create) or the original one (edit) is kept.
      const baseline = editingId ? originalCreatedDate : todayISO();
      const createdAtOverride =
        createdDate && createdDate !== baseline
          ? new Date(createdDate + 'T12:00:00').toISOString()
          : undefined;

      const address = clientAddress.trim();
      // l'adresse saisie devient l'adresse de référence du client
      if (address && address !== (clients.find((c) => c.id === selectedClient.id)?.address || '')) {
        await updateClient(selectedClient.id, { address });
      }

      const cmdData = {
        clientId: selectedClient.id,
        clientName: selectedClient.name,
        clientPhone: selectedClient.phone,
        clientAddress: address,
        driverName: driverName.trim() || undefined,
        driverPlate: driverPlate.trim() || undefined,
        receiveDate, receiveHour, receiveMinute,
        items: selectedItems,
        totalAmount: finalTotalAmount,
        advancePaid: versement,
        paidAmount: versement,
        bonNumber: bonNumber.trim() || undefined,
        createdAt: createdAtOverride,
      };

      if (editingId) {
        const linesUpdated = await updateCommand(editingId, cmdData);
        if (linesUpdated) toast.success('Commande modifiée');
        else toast.warning('Commande modifiée — les produits sont figés car une livraison existe déjà');
        const updated = useCommandStore.getState().commands.find((c) => c.id === editingId);
        if (updated) setPrintPrompt({ kind: 'command', cmd: updated });
      } else {
        const newCmd = await addCommand(cmdData);
        toast.success('Commande créée');
        if (newCmd) setPrintPrompt({ kind: 'command', cmd: newCmd });
      }
      setFormOpen(false);
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------------------------------------- deliveries */
  const handleSaveDelivery = async (
    items: Parameters<typeof addDelivery>[1],
    deliveredAt: string,
    notes: string,
    driver: DeliveryDriver
  ) => {
    if (!deliverCmd) return;
    if (editingDelivery) {
      await updateDelivery(editingDelivery.id, items, deliveredAt, notes, driver);
      toast.success('Livraison modifiée');
      setEditingDelivery(null);
      setDeliverCmd(null);
      return;
    }
    const delivery = await addDelivery(deliverCmd.id, items, deliveredAt, notes, driver);
    const refreshed = useCommandStore.getState().commands.find((c) => c.id === deliverCmd.id) ?? deliverCmd;
    toast.success('Livraison enregistrée');
    setDeliverCmd(null);
    if (delivery) setPrintPrompt({ kind: 'delivery', cmd: refreshed, delivery });
  };

  const doPrintDelivery = (cmd: Command, delivery: CommandDelivery) => {
    printDeliveryNote(
      {
        reference: delivery.reference,
        commandReference: cmd.reference,
        bonNumber: cmd.bonNumber,
        clientName: cmd.clientName,
        clientPhone: cmd.clientPhone,
        clientAddress: cmd.clientAddress,
        deliveredAt: delivery.deliveredAt,
        notes: delivery.notes,
        driverName: delivery.driverName || cmd.driverName,
        driverPlate: delivery.driverPlate || cmd.driverPlate,
        lines: cmd.items.map((it) => {
          const line = delivery.items.find(
            (l) => (l.commandItemId && l.commandItemId === it.id) || l.productName === it.productName
          );
          return {
            productName: it.productName,
            ordered: it.quantity,
            deliveredNow: line?.quantity ?? 0,
            deliveredTotal: it.deliveredQuantity ?? 0,
            unit: it.sellUnit,
          };
        }),
      },
      settings
    );
  };

  /* ------------------------------------------------------------ payments */
  const handlePayDebt = async () => {
    if (!payCmd) return;
    if (payAmount <= 0) { toast.error('Montant invalide'); return; }
    if (payAmount > payCmd.restAmount) { toast.error('Le montant dépasse la dette restante'); return; }
    await payDebt(payCmd.id, payAmount);
    toast.success('Paiement enregistré');
    setPayCmd(null);
    setPayAmount(0);
  };

  /* -------------------------------------------------- printing (command) */
  const printBonDeCommande = (cmd: Command) =>
    printCommandOrder(
      {
        reference: cmd.reference,
        bonNumber: cmd.bonNumber,
        createdAt: cmd.createdAt,
        receiveDate: cmd.receiveDate,
        receiveHour: cmd.receiveHour,
        receiveMinute: cmd.receiveMinute,
        clientName: cmd.clientName,
        clientPhone: cmd.clientPhone,
        clientAddress: cmd.clientAddress,
        driverName: cmd.driverName,
        driverPlate: cmd.driverPlate,
        notes: cmd.notes,
        lines: cmd.items.map((l) => ({
          productName: l.productName,
          quantity: l.quantity,
          deliveredQuantity: l.deliveredQuantity ?? 0,
          unit: l.sellByUnit ? l.sellUnit : undefined,
          unitPrice: l.unitPrice,
          totalPrice: l.totalPrice,
        })),
        totalAmount: cmd.totalAmount,
        paidAmount: cmd.paidAmount,
        restAmount: cmd.restAmount,
      },
      settings
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commandes clients"
        icon={<ShoppingCart size={24} />}
        subtitle={`${filteredCommands.length} commande(s) · ${stats.pendingDelivery} en attente de livraison`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/clients')}>
              <User size={18} /> Clients
            </Button>
            {can('clients', 'create') && (
              <Button variant="gold" onClick={handleOpenCreateForm}>
                <Plus size={18} /> Nouvelle commande
              </Button>
            )}
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total commandes" value={stats.totalValue} format="currency" icon={<Receipt size={22} />} index={0} accent="gold" />
        <StatCard label="Total versé" value={stats.totalPaid} format="currency" icon={<CheckCircle2 size={22} />} index={1} accent="pistachio" />
        <StatCard label="Dettes restantes" value={stats.totalRest} format="currency" icon={<Coins size={22} />} index={2} accent="rose" />
        <StatCard label="À livrer" value={stats.pendingDelivery} icon={<Truck size={22} />} index={3} accent="caramel" />
      </div>

      {/* Filters */}
      <Card index={3}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <SearchBar value={search} onChange={setSearch} placeholder="Rechercher par client, téléphone, référence ou n° bon de commande…" />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="w-full h-11 px-4 rounded-xl border border-gold/20 bg-[--surface-input] text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold"
            >
              <option value="all">Tous les statuts</option>
              <option value="undelivered">Non livrées</option>
              <option value="partial">Partiellement livrées</option>
              <option value="delivered">Entièrement livrées</option>
              <option value="paid">Totalement payées</option>
              <option value="debt">Avec dette</option>
            </select>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="w-full h-11 px-4 rounded-xl border border-gold/20 bg-[--surface-input] text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold"
            >
              <option value="all">Toutes les dates</option>
              <option value="today">Aujourd'hui</option>
              <option value="week">7 derniers jours</option>
              <option value="month">30 derniers jours</option>
              <option value="period">Par période</option>
            </select>
          </div>
          <AnimatePresence>
            {dateFilter === 'period' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex gap-3 overflow-hidden"
              >
                <Input label="Du" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <Input label="Au" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>

      {/* Cards */}
      {filteredCommands.length === 0 ? (
        <EmptyState message="Aucune commande pour ces filtres" icon={<ShoppingCart size={36} />} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredCommands.map((cmd, i) => {
            const d = deliveryStatus(cmd);
            const cmdDeliveries = deliveriesOf(cmd.id);
            return (
              <motion.div
                key={cmd.id}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className={`flex flex-col rounded-2xl bg-gradient-card p-0 overflow-hidden shadow-card transition-all border ${
                  d.isFull ? 'border-pistachio/35' : d.isPartial ? 'border-caramel/45' : 'border-rose-deep/35'
                }`}
              >
                {/* Delivery alert band */}
                <div
                  className={`px-4 py-2 flex items-center gap-2 text-xs font-bold ${
                    d.isFull
                      ? 'bg-pistachio/15 text-pistachio'
                      : d.isPartial
                      ? 'bg-caramel/15 text-caramel'
                      : 'bg-rose-deep/15 text-rose-deep'
                  }`}
                >
                  {d.isFull ? (
                    <><PackageCheck size={14} /> Entièrement livrée</>
                  ) : (
                    <motion.span
                      className="flex items-center gap-2"
                      animate={{ opacity: [1, 0.55, 1] }}
                      transition={{ duration: 1.8, repeat: Infinity }}
                    >
                      <AlertTriangle size={14} />
                      {d.isPartial
                        ? `Livraison incomplète — reste ${d.remaining} article(s)`
                        : `Non livrée — ${d.ordered} article(s) à livrer`}
                    </motion.span>
                  )}
                  <span className="ml-auto tabular">{d.percent.toFixed(0)}%</span>
                </div>

                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex justify-between items-start mb-3 gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-gold">{cmd.reference}</span>
                      {cmd.bonNumber && <span className="text-[10px] font-semibold text-text-muted ml-1.5">· Bon N° {cmd.bonNumber}</span>}
                      <h3 className="font-display font-semibold text-text-primary text-base truncate">{cmd.clientName}</h3>
                      {cmd.clientPhone && (
                        <p className="text-xs text-text-muted flex items-center gap-1 mt-0.5">
                          <Phone size={11} /> {cmd.clientPhone}
                        </p>
                      )}
                      {cmd.clientAddress && (
                        <p className="text-xs text-text-muted flex items-start gap-1 mt-0.5">
                          <MapPin size={11} className="shrink-0 mt-0.5" />
                          <span className="truncate">{cmd.clientAddress}</span>
                        </p>
                      )}
                      {(cmd.driverName || cmd.driverPlate) && (
                        <p className="text-xs text-gold-dark font-semibold flex items-center gap-1 mt-0.5">
                          <Truck size={11} /> {cmd.driverName || 'Chauffeur'}
                          {cmd.driverPlate ? ` · ${cmd.driverPlate}` : ''}
                        </p>
                      )}
                    </div>
                    <Badge variant={cmd.restAmount > 0 ? 'danger' : 'success'}>
                      {cmd.restAmount > 0 ? 'Dette' : 'Payée'}
                    </Badge>
                  </div>

                  {/* Delivery gauge */}
                  <div className="mb-3">
                    <div className="flex justify-between text-[10px] text-text-muted mb-1">
                      <span>Livré {d.delivered} / {d.ordered}</span>
                      <span>{cmdDeliveries.length} livraison(s)</span>
                    </div>
                    <div className="h-2 rounded-full bg-vanilla overflow-hidden border border-gold/10">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${d.percent}%` }}
                        transition={{ delay: i * 0.05, duration: 0.8 }}
                        className={`h-full rounded-full ${d.isFull ? 'bg-gradient-mint' : 'bg-gradient-button'}`}
                      />
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="bg-vanilla/50 rounded-xl p-3 text-xs space-y-1 border border-gold/10 mb-3">
                    <div className="flex justify-between items-center text-text-muted">
                      <span className="flex items-center gap-1"><Calendar size={11} /> Créée le</span>
                      <span className="font-semibold text-text-primary">{formatDate(cmd.createdAt.slice(0, 10), language)}</span>
                    </div>
                    <div className="flex justify-between items-center text-gold-dark font-semibold">
                      <span className="flex items-center gap-1"><Clock size={11} /> Livraison prévue</span>
                      <span>{formatDate(cmd.receiveDate, language)} à {cmd.receiveHour}h{cmd.receiveMinute}</span>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="mb-3">
                    <h4 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                      Produits ({cmd.items.length})
                    </h4>
                    <div className="space-y-1 max-h-[110px] overflow-y-auto pr-1">
                      {cmd.items.map((item, idx) => {
                        const done = (item.deliveredQuantity ?? 0) >= item.quantity;
                        return (
                          <div key={idx} className="flex justify-between text-xs py-1 border-b border-gold/5 last:border-b-0">
                            <span className="text-text-primary truncate max-w-[140px] flex items-center gap-1">
                              {done ? <CheckCircle2 size={11} className="text-pistachio shrink-0" /> : <span className="w-[11px]" />}
                              {item.productName}
                            </span>
                            <span className="text-text-muted tabular">
                              {item.deliveredQuantity ?? 0}/{item.quantity}
                              {item.sellByUnit && item.sellUnit ? ` ${item.sellUnit}` : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Money */}
                  <div className="border-t border-gold/10 pt-3 space-y-1 text-xs bg-vanilla/30 p-2.5 rounded-xl mb-3">
                    <div className="flex justify-between text-text-muted">
                      <span>Total</span><span className="font-bold text-text-primary">{formatCurrency(cmd.totalAmount)}</span>
                    </div>
                    <div className="flex justify-between text-text-muted">
                      <span>Versé</span><span className="font-semibold text-pistachio">{formatCurrency(cmd.paidAmount)}</span>
                    </div>
                    <div className="flex justify-between font-bold pt-1 border-t border-gold/10">
                      <span>Reste</span>
                      <span className={cmd.restAmount > 0 ? 'text-rose-deep' : 'text-pistachio'}>
                        {formatCurrency(cmd.restAmount)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="space-y-2 mt-auto pt-2 border-t border-gold/15">
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="secondary" className="text-xs" onClick={() => setViewingCmd(cmd)}>
                        <Eye size={13} /> Détails
                      </Button>
                      <Button
                        size="sm"
                        variant={d.isFull ? 'secondary' : 'gold'}
                        className="text-xs font-bold"
                        disabled={d.isFull}
                        onClick={() => { setEditingDelivery(null); setDeliverCmd(cmd); }}
                      >
                        <Truck size={13} /> {d.isFull ? 'Livrée' : 'Livraison'}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="secondary" className="text-xs" onClick={() => setHistoryCmd(cmd)}>
                        <History size={13} /> Livraisons ({cmdDeliveries.length})
                      </Button>
                      <Button size="sm" variant="secondary" className="text-xs" onClick={() => printBonDeCommande(cmd)}>
                        <Printer size={13} /> Bon commande
                      </Button>
                    </div>
                    <div className="flex gap-1.5">
                      {cmd.restAmount > 0 && can('clients', 'pay') && (
                        <Button
                          size="sm" variant="gold" className="flex-1 text-xs"
                          onClick={() => { setPayCmd(cmd); setPayAmount(cmd.restAmount); }}
                        >
                          <Coins size={13} /> Payer
                        </Button>
                      )}
                      {can('clients', 'edit') && (
                        <Button size="sm" variant="secondary" onClick={() => handleOpenEditForm(cmd)} title="Modifier">
                          <Pencil size={13} />
                        </Button>
                      )}
                      {can('clients', 'delete') && (
                        <Button size="sm" variant="ghost" onClick={() => setDeleteId(cmd.id)} title="Supprimer">
                          <Trash2 size={13} className="text-rose-deep" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ================= Create / edit ================= */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Modifier la commande' : 'Nouvelle commande'}
        size="lg"
      >
        <div className="space-y-4">
          {/* Client */}
          <div className="border border-gold/20 rounded-2xl p-4 bg-vanilla/40 relative">
            <h3 className="text-xs font-bold text-gold uppercase tracking-wider mb-3 flex items-center gap-2">
              <User size={15} /> 1. Client
            </h3>
            {selectedClient ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-xl bg-vanilla/60 border border-gold/30">
                  <div>
                    <p className="font-bold text-sm text-text-primary">{selectedClient.name}</p>
                    {selectedClient.phone && <p className="text-xs text-text-muted">📞 {selectedClient.phone}</p>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedClient(null); setClientAddress(''); }}>
                    <X size={14} /> Changer
                  </Button>
                </div>
                <Input
                  label="Adresse de livraison du client *"
                  placeholder="Ex : Cité 200 logements, Bt 4, Blida"
                  value={clientAddress}
                  icon={<MapPin size={15} />}
                  error={addressError ? 'Adresse obligatoire' : undefined}
                  onChange={(e) => { setClientAddress(e.target.value); setAddressError(false); }}
                />
                <p className="text-[11px] text-text-muted -mt-1">
                  L'adresse est demandée à chaque commande : vérifiez-la ou corrigez-la, elle sera
                  imprimée sur le bon de commande et sur les bons de livraison, et mise à jour sur
                  la fiche du client.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                    <Input
                      placeholder="Rechercher un client…"
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Button variant="secondary" onClick={() => setShowNewClientForm(!showNewClientForm)}>
                    <UserPlus size={16} /> Client
                  </Button>
                </div>
                <AnimatePresence>
                  {showNewClientForm && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="p-3 border border-gold/30 rounded-xl bg-vanilla/80 space-y-3"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input placeholder="Nom du client *" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} />
                        <Input placeholder="Téléphone" value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} />
                      </div>
                      <Input
                        placeholder="Adresse du client *"
                        value={newClientAddress}
                        onChange={(e) => setNewClientAddress(e.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setShowNewClientForm(false)}>Annuler</Button>
                        <Button size="sm" variant="gold" onClick={handleCreateClientInline}>Créer &amp; sélectionner</Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {clientSearch && clientSearchResults.length > 0 && (
                  <div className="border border-gold/30 rounded-xl bg-[--surface-dropdown] max-h-[160px] overflow-y-auto shadow-xl">
                    {clientSearchResults.map((cli) => (
                      <button
                        key={cli.id}
                        onClick={() => handleSelectClient(cli)}
                        className="w-full text-left p-3 hover:bg-gold/20 border-b border-gold/10 last:border-b-0 text-xs text-text-primary flex items-center justify-between"
                      >
                        <span className="font-bold">{cli.name}</span>
                        {cli.phone && <span className="text-text-muted">📞 {cli.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Delivery date */}
          <div className="border border-gold/20 rounded-2xl p-4 bg-vanilla/40">
            <h3 className="text-xs font-bold text-gold uppercase tracking-wider mb-3 flex items-center gap-2">
              <Calendar size={15} /> 2. Date et heure de livraison prévue
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="Date de livraison *" type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">Heure</label>
                <select
                  value={receiveHour}
                  onChange={(e) => setReceiveHour(e.target.value)}
                  className="w-full h-10 px-4 rounded-xl border border-gold/20 bg-[--surface-input] text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold"
                >
                  {Array.from({ length: 24 }).map((_, h) => {
                    const val = String(h).padStart(2, '0');
                    return <option key={val} value={val}>{val}h</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">Minute</label>
                <select
                  value={receiveMinute}
                  onChange={(e) => setReceiveMinute(e.target.value)}
                  className="w-full h-10 px-4 rounded-xl border border-gold/20 bg-[--surface-input] text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold"
                >
                  {['00', '15', '30', '45'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Creation date + bon de commande number */}
          <div className="border border-gold/20 rounded-2xl p-4 bg-vanilla/40">
            <h3 className="text-xs font-bold text-gold uppercase tracking-wider mb-3 flex items-center gap-2">
              <ClipboardList size={15} /> 3. Date de création & n° de bon de commande
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Date de création de la commande"
                type="date" value={createdDate}
                onChange={(e) => setCreatedDate(e.target.value)}
              />
              <Input
                label="N° bon de commande (facultatif)"
                placeholder="Ex : BC-2026-014"
                value={bonNumber}
                onChange={(e) => setBonNumber(e.target.value)}
              />
            </div>
          </div>

          {/* Chauffeur */}
          <div className="border border-gold/20 rounded-2xl p-4 bg-vanilla/40">
            <h3 className="text-xs font-bold text-gold uppercase tracking-wider mb-3 flex items-center gap-2">
              <Truck size={15} /> 4. Chauffeur qui emmènera la commande
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Nom du chauffeur"
                placeholder="Ex : Karim B."
                value={driverName}
                icon={<User size={15} />}
                onChange={(e) => setDriverName(e.target.value)}
              />
              <Input
                label="Matricule du camion (facultatif)"
                placeholder="Ex : 12345-116-09"
                value={driverPlate}
                icon={<Hash size={15} />}
                onChange={(e) => setDriverPlate(e.target.value)}
              />
            </div>
            <p className="text-[11px] text-text-muted mt-2">
              Ce chauffeur sera proposé par défaut pour chaque livraison de cette commande ; vous
              pourrez en désigner un autre au moment de livrer.
            </p>
          </div>

          {/* Products */}
          <div className="border border-gold/20 rounded-2xl p-4 bg-vanilla/40 space-y-3">
            <h3 className="text-xs font-bold text-gold uppercase tracking-wider mb-2 flex items-center gap-2">
              <Receipt size={15} /> 5. Produits commandés
            </h3>
            {editingId && deliveriesOf(editingId).length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-caramel/40 bg-caramel/10 px-3 py-2.5 text-xs text-caramel">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <span>
                  Cette commande a déjà été livrée : la liste des produits ne peut plus être
                  modifiée (les quantités livrées y sont rattachées). Vous pouvez toujours
                  changer la date de livraison prévue et le total.
                </span>
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
              <Input
                placeholder="Rechercher une fiche technique / formule…"
                value={recipeSearch}
                onChange={(e) => setRecipeSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            {recipeSearch && recipeSearchResults.length > 0 && (
              <div className="border border-gold/30 rounded-xl bg-[--surface-dropdown] max-h-[160px] overflow-y-auto shadow-xl">
                {recipeSearchResults.map((ft) => (
                  <button
                    key={ft.id}
                    onClick={() => handleAddRecipeLine(ft)}
                    className="w-full text-left p-3 hover:bg-gold/20 border-b border-gold/10 last:border-b-0 text-xs text-text-primary flex items-center justify-between"
                  >
                    <span className="font-bold">{ft.name}</span>
                    <span className="text-gold tabular">
                      {formatCurrency(ft.unitPrice)}{ft.sellByUnit && ft.sellUnit ? `/${ft.sellUnit}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {selectedItems.length > 0 ? (
              <div className="overflow-x-auto border border-gold/15 rounded-xl bg-vanilla/40">
                <table className="w-full text-xs">
                  <thead className="bg-vanilla/60 text-text-secondary">
                    <tr>
                      <th className="text-left px-3 py-2">Produit</th>
                      <th className="text-right px-3 py-2">Quantité</th>
                      <th className="text-right px-3 py-2">P.U (DA)</th>
                      <th className="text-right px-3 py-2">Total</th>
                      <th className="text-center px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedItems.map((item, idx) => (
                      <tr key={idx} className="border-t border-gold/10">
                        <td className="px-3 py-2 font-semibold text-text-primary">{item.productName}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number" min={0.01} step="any" value={item.quantity}
                            onChange={(e) => handleUpdateItemQty(idx, Number(e.target.value))}
                            className="w-20 px-2 py-1 text-right bg-[--surface-input] border border-gold/30 rounded-lg text-text-primary text-xs"
                          />
                          {item.sellByUnit && item.sellUnit ? ` ${item.sellUnit}` : ''}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number" min={0} step="any" value={item.unitPrice}
                            onChange={(e) => handleUpdateItemPrice(idx, Number(e.target.value))}
                            className="w-24 px-2 py-1 text-right bg-[--surface-input] border border-gold/30 rounded-lg text-text-primary text-xs"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-bold tabular text-gold">{formatCurrency(item.totalPrice)}</td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => handleRemoveItem(idx)} className="p-1 rounded-lg text-rose-deep hover:bg-rose-deep/10">
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-center text-text-muted py-4 italic border border-dashed border-gold/15 rounded-xl">
                Aucun produit sélectionné.
              </p>
            )}
          </div>

          {/* Pricing */}
          <div className="border border-gold/20 rounded-2xl p-4 bg-vanilla/40 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">Total calculé</label>
              <div className="w-full h-10 px-4 flex items-center rounded-xl border border-gold/20 bg-vanilla/60 text-gold font-bold text-sm tabular">
                {formatCurrency(computedTotalSum)}
              </div>
            </div>
            <Input
              label="Ajuster le total (DA)" type="number"
              value={customTotal !== null ? customTotal : ''}
              placeholder={String(computedTotalSum)}
              onChange={(e) => setCustomTotal(e.target.value ? Number(e.target.value) : null)}
            />
            <Input
              label="Acompte / versement (DA)" type="number"
              value={versement} onChange={(e) => setVersement(Number(e.target.value))}
            />
          </div>

          <div className="flex justify-between items-center p-3 rounded-xl bg-gold/10 border border-gold/30 text-gold-dark font-bold text-xs">
            <span>Reste à payer (dette enregistrée)</span>
            <span className="text-sm tabular text-rose-deep">{formatCurrency(Math.max(0, finalTotalAmount - versement))}</span>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gold/10">
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>Annuler</Button>
            <Button variant="gold" onClick={handleSaveCommand} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer la commande'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ================= Details ================= */}
      <Modal open={!!viewingCmd} onClose={() => setViewingCmd(null)} title={`Commande ${viewingCmd?.reference ?? ''}`} size="md">
        {viewingCmd && (() => {
          const d = deliveryStatus(viewingCmd);
          return (
            <div className="space-y-4">
              <div className="bg-vanilla/50 p-3 rounded-xl border border-gold/20 space-y-1 text-xs">
                <Row label="Client" value={viewingCmd.clientName} strong />
                {viewingCmd.bonNumber && <Row label="N° bon de commande" value={viewingCmd.bonNumber} strong />}
                {viewingCmd.clientPhone && <Row label="Téléphone" value={viewingCmd.clientPhone} />}
                <Row label="Adresse de livraison" value={viewingCmd.clientAddress || '—'} strong />
                {(viewingCmd.driverName || viewingCmd.driverPlate) && (
                  <Row
                    label="Chauffeur"
                    value={`${viewingCmd.driverName || '—'}${viewingCmd.driverPlate ? ` · ${viewingCmd.driverPlate}` : ''}`}
                  />
                )}
                <Row
                  label="Livraison prévue"
                  value={`${formatDate(viewingCmd.receiveDate, 'fr')} à ${viewingCmd.receiveHour}h${viewingCmd.receiveMinute}`}
                />
                <Row label="Créée par" value={viewingCmd.createdBy || '—'} />
              </div>

              <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold border ${
                d.isFull ? 'border-pistachio/40 bg-pistachio/10 text-pistachio'
                  : d.isPartial ? 'border-caramel/40 bg-caramel/10 text-caramel'
                  : 'border-rose-deep/40 bg-rose-deep/10 text-rose-deep'
              }`}>
                {d.isFull ? <PackageCheck size={15} /> : <AlertTriangle size={15} />}
                {d.isFull ? 'Commande entièrement livrée'
                  : d.isPartial ? `Livraison partielle — ${d.delivered}/${d.ordered} (${d.percent.toFixed(0)}%)`
                  : 'Aucune livraison effectuée'}
              </div>

              <div className="overflow-x-auto rounded-xl border border-gold/20">
                <table className="w-full text-xs">
                  <thead className="bg-vanilla/60 text-text-secondary">
                    <tr>
                      <th className="text-left px-3 py-2">Produit</th>
                      <th className="text-center px-3 py-2">Commandé</th>
                      <th className="text-center px-3 py-2">Livré</th>
                      <th className="text-right px-3 py-2">P.U</th>
                      <th className="text-right px-3 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingCmd.items.map((it, idx) => {
                      const u = it.sellByUnit && it.sellUnit ? ` ${it.sellUnit}` : '';
                      const done = (it.deliveredQuantity ?? 0) >= it.quantity;
                      return (
                        <tr key={idx} className="border-t border-gold/10">
                          <td className="px-3 py-2 font-bold">{it.productName}</td>
                          <td className="px-3 py-2 text-center tabular">{it.quantity}{u}</td>
                          <td className={`px-3 py-2 text-center tabular font-bold ${done ? 'text-pistachio' : 'text-caramel'}`}>
                            {it.deliveredQuantity ?? 0}{u}
                          </td>
                          <td className="px-3 py-2 text-right tabular">{formatCurrency(it.unitPrice)}</td>
                          <td className="px-3 py-2 text-right tabular font-bold text-gold">{formatCurrency(it.totalPrice)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Tile label="Total" value={formatCurrency(viewingCmd.totalAmount)} />
                <Tile label="Versé" value={formatCurrency(viewingCmd.paidAmount)} color="text-pistachio" />
                <Tile label="Reste" value={formatCurrency(viewingCmd.restAmount)} color="text-rose-deep" />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gold/10">
                <Button variant="secondary" onClick={() => printBonDeCommande(viewingCmd)}>
                  <Printer size={15} /> Bon de commande
                </Button>
                <Button variant="gold" onClick={() => { setViewingCmd(null); setHistoryCmd(viewingCmd); }}>
                  <History size={15} /> Historique des livraisons
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ================= Delivery history ================= */}
      <Modal
        open={!!historyCmd}
        onClose={() => setHistoryCmd(null)}
        title={`Livraisons — ${historyCmd?.reference ?? ''}`}
        size="lg"
      >
        {historyCmd && (() => {
          const list = deliveriesOf(historyCmd.id);
          const d = deliveryStatus(historyCmd);
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Tile label="Commandé" value={String(d.ordered)} />
                <Tile label="Livré" value={String(d.delivered)} color="text-pistachio" />
                <Tile label="Reste à livrer" value={String(d.remaining)} color="text-rose-deep" />
                <Tile label="Livraisons" value={String(list.length)} color="text-gold-dark" />
              </div>

              {!d.isFull && (
                <Button
                  variant="gold" className="w-full"
                  onClick={() => { setEditingDelivery(null); setDeliverCmd(historyCmd); setHistoryCmd(null); }}
                >
                  <Truck size={16} /> Nouvelle livraison
                </Button>
              )}

              {list.length === 0 ? (
                <EmptyState message="Aucune livraison enregistrée" icon={<Truck size={30} />} />
              ) : (
                <div className="space-y-3">
                  {list.map((dl) => (
                    <div key={dl.id} className="rounded-xl border border-gold/15 bg-vanilla/30 p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                        <div>
                          <p className="font-semibold text-text-primary text-sm flex items-center gap-2">
                            <Truck size={14} className="text-gold" /> {dl.reference}
                          </p>
                          <p className="text-[11px] text-text-muted">{formatDateTime(dl.deliveredAt)}</p>
                          {(dl.driverName || dl.driverPlate) && (
                            <p className="text-[11px] font-semibold text-gold-dark flex items-center gap-1">
                              <Truck size={11} /> {dl.driverName || 'Chauffeur'}
                              {dl.driverPlate ? ` · ${dl.driverPlate}` : ''}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" title="Imprimer le bon de livraison"
                            onClick={() => doPrintDelivery(historyCmd, dl)}>
                            <Printer size={15} />
                          </Button>
                          {can('clients', 'edit') && (
                            <Button
                              size="icon" variant="ghost" title="Modifier"
                              onClick={() => { setEditingDelivery(dl); setDeliverCmd(historyCmd); setHistoryCmd(null); }}
                            >
                              <Pencil size={15} />
                            </Button>
                          )}
                          {can('clients', 'delete') && (
                            <Button size="icon" variant="ghost" title="Supprimer" onClick={() => setDeleteDeliveryId(dl.id)}>
                              <Trash2 size={15} className="text-rose-deep" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        {dl.items.map((li, i) => (
                          <div key={i} className="flex justify-between text-xs py-1 border-b border-gold/5 last:border-0">
                            <span className="text-text-secondary">{li.productName}</span>
                            <span className="tabular font-semibold text-pistachio">
                              {li.quantity}{li.sellUnit ? ` ${li.sellUnit}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                      {dl.notes && <p className="text-[11px] text-text-muted italic mt-2">« {dl.notes} »</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ================= Delivery modal ================= */}
      <DeliveryModal
        open={!!deliverCmd}
        command={deliverCmd}
        editing={editingDelivery}
        onClose={() => { setDeliverCmd(null); setEditingDelivery(null); }}
        onSave={handleSaveDelivery}
      />

      {/* ================= Pay ================= */}
      <Modal open={!!payCmd} onClose={() => setPayCmd(null)} title="Règlement de commande" size="sm">
        {payCmd && (
          <div className="space-y-4">
            <div className="bg-vanilla/50 p-3 rounded-xl text-xs space-y-1 border border-gold/20">
              <Row label="N° commande" value={payCmd.reference} strong />
              <Row label="Client" value={payCmd.clientName} />
              <Row label="Reste à payer" value={formatCurrency(payCmd.restAmount)} />
            </div>
            <Input
              label="Montant du versement (DA) *" type="number" step="any"
              value={payAmount || ''} onChange={(e) => setPayAmount(Number(e.target.value))} autoFocus
            />
            <div className="flex items-center justify-between rounded-xl border border-gold/25 bg-gold/5 px-4 py-3 text-sm">
              <span className="text-text-muted">Reste après paiement</span>
              <span className="font-bold tabular text-rose-deep">
                {formatCurrency(Math.max(0, payCmd.restAmount - payAmount))}
              </span>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gold/10">
              <Button variant="secondary" onClick={() => setPayCmd(null)}>Annuler</Button>
              <Button variant="gold" onClick={handlePayDebt}>Valider le versement</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) void deleteCommand(deleteId).then(() => toast.success('Commande supprimée')); }}
        title="Supprimer la commande"
      />
      <ConfirmDialog
        open={!!deleteDeliveryId}
        onClose={() => setDeleteDeliveryId(null)}
        onConfirm={() => {
          if (deleteDeliveryId) void deleteDelivery(deleteDeliveryId).then(() => toast.success('Livraison supprimée'));
        }}
        title="Supprimer la livraison"
        message="Les quantités livrées seront recalculées et la commande repassera éventuellement en « non livrée »."
      />

      {/* ================= Print prompt ================= */}
      <Modal open={!!printPrompt} onClose={() => setPrintPrompt(null)} size="sm">
        <div className="flex flex-col items-center text-center py-2">
          <div className="h-14 w-14 rounded-full bg-pistachio/15 flex items-center justify-center mb-4">
            <CheckCircle2 size={30} className="text-pistachio" />
          </div>
          <h3 className="font-display text-lg font-bold text-text-primary mb-1">
            {printPrompt?.kind === 'delivery' ? 'Livraison enregistrée' : 'Commande enregistrée'}
          </h3>
          <p className="text-xs text-gold mb-1">
            {printPrompt?.kind === 'delivery' ? printPrompt.delivery.reference : printPrompt?.cmd.reference}
          </p>
          <p className="text-xs text-text-muted mb-6">
            {printPrompt?.kind === 'delivery'
              ? 'Voulez-vous imprimer le bon de livraison ?'
              : 'Voulez-vous imprimer le bon de commande ?'}
          </p>
          <div className="flex gap-2 w-full">
            <Button variant="secondary" className="flex-1 text-xs" onClick={() => setPrintPrompt(null)}>Fermer</Button>
            <Button
              variant="gold" className="flex-1 text-xs font-bold"
              onClick={() => {
                if (!printPrompt) return;
                if (printPrompt.kind === 'delivery') doPrintDelivery(printPrompt.cmd, printPrompt.delivery);
                else printBonDeCommande(printPrompt.cmd);
                setPrintPrompt(null);
              }}
            >
              <Printer size={16} /> Imprimer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-text-muted">{label}</span>
      <span className={strong ? 'font-bold text-text-primary' : 'text-text-secondary'}>{value}</span>
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
