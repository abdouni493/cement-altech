import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingCart, Plus, Search, Calendar, Clock, CreditCard, ChevronRight,
  Eye, Pencil, Trash2, CheckCircle2, AlertTriangle, Printer, UserPlus, X, Coins,
  User, Phone, Check, Receipt, Truck, FileText, PackageCheck
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
import { toast } from '@/components/ui/Toast';
import { useCommandStore, type Command, type CommandLine } from '@/store/commandStore';
import { useClientStore } from '@/store/clientStore';
import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { useComptoirStore } from '@/store/comptoirStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { printDocument } from '@/lib/print';
import { cardVariants } from '@/lib/animations';

type DateFilter = 'today' | 'week' | 'month' | 'period' | 'all';
type StatusFilter = 'all' | 'paid' | 'debt' | 'pending' | 'finalised';

export default function CommandsPage() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const navigate = useNavigate();

  const { commands, addCommand, updateCommand, deleteCommand, payDebt, finaliseCommand } = useCommandStore();
  const { clients, addClient } = useClientStore();
  const { ficheTechnics } = useFicheTechnicStore();
  const comptoirItems = useComptoirStore((s) => s.items);
  const settings = useSettingsStore((s) => s.settings);

  // Filters
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());

  // Form states
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Client selection / creation inline
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string; phone?: string } | null>(null);
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');

  // Item builder states
  const [recipeSearch, setRecipeSearch] = useState('');
  const [selectedItems, setSelectedItems] = useState<CommandLine[]>([]);
  const [receiveDate, setReceiveDate] = useState(todayISO());
  const [receiveHour, setReceiveHour] = useState('14');
  const [receiveMinute, setReceiveMinute] = useState('30');
  const [customTotal, setCustomTotal] = useState<number | null>(null);
  const [versement, setVersement] = useState(0);

  // Interaction modals
  const [viewingCmd, setViewingCmd] = useState<Command | null>(null);
  const [finaliseCmd, setFinaliseCmd] = useState<Command | null>(null);
  const [payCmd, setPayCmd] = useState<Command | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payDescription, setPayDescription] = useState('Paiement acompte commande');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Print prompt modal
  const [printPromptCmd, setPrintPromptCmd] = useState<Command | null>(null);
  const [printPromptType, setPrintPromptType] = useState<'bon_commande' | 'bon_livraison'>('bon_commande');

  // Comptoir stock helper
  const getComptoirStock = (productName: string) => {
    return comptoirItems
      .filter((i) => i.productName.toLowerCase() === productName.toLowerCase())
      .reduce((sum, i) => sum + i.quantity, 0);
  };

  // Filter logic
  const filteredCommands = useMemo(() => {
    return commands.filter((c) => {
      const matchesSearch = c.clientName.toLowerCase().includes(search.toLowerCase()) || 
        (c.clientPhone && c.clientPhone.includes(search));
      
      let matchesStatus = true;
      if (statusFilter === 'paid') matchesStatus = c.restAmount <= 0;
      else if (statusFilter === 'debt') matchesStatus = c.restAmount > 0;
      else if (statusFilter === 'pending') matchesStatus = c.status === 'pending';
      else if (statusFilter === 'finalised') matchesStatus = c.status === 'finalised';

      let matchesDate = true;
      const cmdTime = new Date(c.createdAt).getTime();
      
      if (dateFilter === 'today') {
        const start = new Date(); start.setHours(0,0,0,0);
        const end = new Date(); end.setHours(23,59,59,999);
        matchesDate = cmdTime >= start.getTime() && cmdTime <= end.getTime();
      } else if (dateFilter === 'week') {
        const start = new Date(); start.setDate(start.getDate() - 7);
        matchesDate = cmdTime >= start.getTime();
      } else if (dateFilter === 'month') {
        const start = new Date(); start.setDate(start.getDate() - 30);
        matchesDate = cmdTime >= start.getTime();
      } else if (dateFilter === 'period') {
        const start = new Date(from); start.setHours(0,0,0,0);
        const end = new Date(to + 'T23:59:59');
        matchesDate = cmdTime >= start.getTime() && cmdTime <= end.getTime();
      }

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [commands, search, statusFilter, dateFilter, from, to]);

  // Statistics
  const stats = useMemo(() => {
    const totalPaid = filteredCommands.reduce((sum, c) => sum + c.paidAmount, 0);
    const totalRest = filteredCommands.reduce((sum, c) => sum + c.restAmount, 0);
    const totalValue = filteredCommands.reduce((sum, c) => sum + c.totalAmount, 0);
    return { totalPaid, totalRest, totalValue };
  }, [filteredCommands]);

  // Client search results
  const clientSearchResults = useMemo(() => {
    if (!clientSearch) return [];
    return clients.filter((c) =>
      c.name.toLowerCase().includes(clientSearch.toLowerCase()) || c.phone.includes(clientSearch)
    );
  }, [clients, clientSearch]);

  // Fiche techniques search results
  const recipeSearchResults = useMemo(() => {
    if (!recipeSearch) return [];
    return ficheTechnics.filter((ft) =>
      ft.name.toLowerCase().includes(recipeSearch.toLowerCase())
    );
  }, [ficheTechnics, recipeSearch]);

  const handleCreateClientInline = () => {
    if (!newClientName.trim()) { toast.error('Nom du client requis'); return; }
    const newCli = addClient({ name: newClientName.trim(), phone: newClientPhone.trim() });
    setSelectedClient(newCli);
    setNewClientName('');
    setNewClientPhone('');
    setShowNewClientForm(false);
    toast.success('Client créé et sélectionné');
  };

  const handleAddRecipeLine = (ft: typeof ficheTechnics[0]) => {
    const exists = selectedItems.find((item) => item.ficheTechnicId === ft.id);
    if (exists) {
      toast.error('Ce produit est déjà ajouté à la commande');
      return;
    }
    const newLine: CommandLine = {
      ficheTechnicId: ft.id,
      productName: ft.name,
      quantity: 1,
      unitPrice: ft.unitPrice,
      totalPrice: ft.unitPrice,
      sellByUnit: ft.sellByUnit,
      sellUnit: ft.sellUnit,
    };
    setSelectedItems([...selectedItems, newLine]);
    setRecipeSearch('');
    toast.success('Produit ajouté');
  };

  const handleUpdateItemQty = (index: number, qty: number) => {
    setSelectedItems(
      selectedItems.map((item, idx) => {
        if (idx !== index) return item;
        return {
          ...item,
          quantity: qty,
          totalPrice: qty * item.unitPrice,
        };
      })
    );
  };

  const handleUpdateItemPrice = (index: number, price: number) => {
    setSelectedItems(
      selectedItems.map((item, idx) => {
        if (idx !== index) return item;
        return {
          ...item,
          unitPrice: price,
          totalPrice: item.quantity * price,
        };
      })
    );
  };

  const handleRemoveItem = (index: number) => {
    setSelectedItems(selectedItems.filter((_, idx) => idx !== index));
  };

  const computedTotalSum = selectedItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const finalTotalAmount = customTotal !== null ? customTotal : computedTotalSum;

  const handleOpenCreateForm = () => {
    setEditingId(null);
    setSelectedClient(null);
    setSelectedItems([]);
    setReceiveDate(todayISO());
    setReceiveHour('14');
    setReceiveMinute('30');
    setCustomTotal(null);
    setVersement(0);
    setClientSearch('');
    setRecipeSearch('');
    setShowNewClientForm(false);
    setFormOpen(true);
  };

  const handleOpenEditForm = (cmd: Command) => {
    setEditingId(cmd.id);
    setSelectedClient({ id: cmd.clientId, name: cmd.clientName, phone: cmd.clientPhone });
    setSelectedItems(cmd.items);
    setReceiveDate(cmd.receiveDate);
    setReceiveHour(cmd.receiveHour);
    setReceiveMinute(cmd.receiveMinute);
    setCustomTotal(cmd.totalAmount);
    setVersement(cmd.paidAmount);
    setFormOpen(true);
  };

  const handleSaveCommand = () => {
    if (!selectedClient) { toast.error('Veuillez sélectionner un client'); return; }
    if (selectedItems.length === 0) { toast.error('Ajoutez au moins un produit à la commande'); return; }
    if (versement < 0) { toast.error('Le versement ne peut pas être négatif'); return; }

    const cmdData = {
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      clientPhone: selectedClient.phone,
      receiveDate,
      receiveHour,
      receiveMinute,
      items: selectedItems,
      totalAmount: finalTotalAmount,
      paidAmount: versement,
    };

    if (editingId) {
      updateCommand(editingId, cmdData);
      toast.success('Commande modifiée avec succès');
      const updatedCmd = useCommandStore.getState().commands.find((c) => c.id === editingId);
      if (updatedCmd) promptPrint(updatedCmd, 'bon_commande');
    } else {
      const newCmd = addCommand(cmdData);
      toast.success('Commande créée avec succès !');
      promptPrint(newCmd, 'bon_commande');
    }
    setFormOpen(false);
  };

  const promptPrint = (cmd: Command, type: 'bon_commande' | 'bon_livraison' = 'bon_commande') => {
    setPrintPromptCmd(cmd);
    setPrintPromptType(type);
  };

  // Print Bon de Commande
  const printBonDeCommande = (cmd: Command) => {
    const rows = cmd.items
      .map(
        (l) => `<tr>
        <td style="padding: 10px; border-bottom: 1px solid #ddd; font-weight: bold;">${l.productName}</td>
        <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: center;">${l.quantity}${l.sellByUnit && l.sellUnit ? ` ${l.sellUnit}` : ''}</td>
        <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right;">${formatCurrency(l.unitPrice)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right; font-weight: bold;">${formatCurrency(l.totalPrice)}</td>
      </tr>`
      )
      .join('');

    const logoHtml = settings.logo
      ? `<img src="${settings.logo}" style="max-height: 70px; margin-bottom: 5px;" />`
      : `<div style="font-size: 32px; font-weight: bold; color: #d97706;">🏗️ ${settings.name || 'ALTECH PRODUCTION'}</div>`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #000; padding: 25px; max-width: 800px; margin: 0 auto; border: 2px solid #000; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px;">
          <div>
            ${logoHtml}
            <h2 style="margin: 5px 0 2px 0; font-size: 20px; font-weight: bold;">${settings.name || 'ALTECH PRODUCTION'}</h2>
            <p style="margin: 2px 0; font-size: 12px;">📍 ${settings.address || 'Adresse non spécifiée'}</p>
            <p style="margin: 2px 0; font-size: 12px;">📞 Tel: ${settings.phone || 'N/A'}</p>
            ${settings.nif ? `<p style="margin: 2px 0; font-size: 11px;">NIF: ${settings.nif} | NIS: ${settings.nis || ''} | RC: ${settings.rc || ''}</p>` : ''}
          </div>
          <div style="text-align: right;">
            <h1 style="margin: 0; font-size: 22px; font-weight: bold; background: #000; color: #fff; padding: 6px 16px; border-radius: 4px; display: inline-block;">BON DE COMMANDE</h1>
            <p style="margin: 8px 0 2px 0; font-size: 14px; font-weight: bold;">Réf: ${cmd.reference}</p>
            <p style="margin: 2px 0; font-size: 12px;">Date: ${formatDate(cmd.createdAt.slice(0, 10), 'fr')}</p>
            <p style="margin: 2px 0; font-size: 12px; font-weight: bold; color: #b45309;">Livraison prévue: ${formatDate(cmd.receiveDate, 'fr')} à ${cmd.receiveHour}h${cmd.receiveMinute}</p>
          </div>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #ddd; padding: 12px 15px; border-radius: 6px; margin-bottom: 20px; font-size: 13px;">
          <p style="margin: 0 0 4px 0;"><strong>CLIENT :</strong> ${cmd.clientName}</p>
          ${cmd.clientPhone ? `<p style="margin: 0;"><strong>TÉLÉPHONE :</strong> ${cmd.clientPhone}</p>` : ''}
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px;">
          <thead>
            <tr style="background-color: #f2f2f2;">
              <th style="border: 1px solid #ddd; padding: 10px; text-align: left;">Désignation Produit / Ciment</th>
              <th style="border: 1px solid #ddd; padding: 10px; text-align: center;">Quantité</th>
              <th style="border: 1px solid #ddd; padding: 10px; text-align: right;">Prix Unitaire</th>
              <th style="border: 1px solid #ddd; padding: 10px; text-align: right;">Total (DA)</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div style="display: flex; justify-content: flex-end; margin-bottom: 30px;">
          <div style="width: 300px; border: 1px solid #000; border-radius: 6px; overflow: hidden; font-size: 13px;">
            <div style="display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #ddd;">
              <span>Total Commande:</span>
              <strong style="font-size: 14px;">${formatCurrency(cmd.totalAmount)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #ddd; background: #e6fffa;">
              <span>Acompte Versé:</span>
              <strong style="color: #047857;">${formatCurrency(cmd.paidAmount)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 10px 12px; background: #fff1f2; font-weight: bold;">
              <span>Reste à Payer:</span>
              <strong style="color: #be123c; font-size: 15px;">${formatCurrency(cmd.restAmount)}</strong>
            </div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; text-align: center; font-size: 12px; margin-top: 40px;">
          <div style="width: 45%; border: 1px solid #000; padding: 15px; height: 90px; border-radius: 6px;">
            <p style="margin: 0 0 50px 0; font-weight: bold;">Signature Client</p>
          </div>
          <div style="width: 45%; border: 1px solid #000; padding: 15px; height: 90px; border-radius: 6px;">
            <p style="margin: 0 0 50px 0; font-weight: bold;">Cachet &amp; Signature Entreprise</p>
          </div>
        </div>
      </div>
    `;

    printDocument(htmlContent, `Bon_de_Commande_${cmd.reference}`);
  };

  // Print Bon de Livraison
  const printBonDeLivraison = (cmd: Command) => {
    const rows = cmd.items
      .map(
        (l) => `<tr>
        <td style="padding: 10px; border-bottom: 1px solid #ddd; font-weight: bold;">${l.productName}</td>
        <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: center; font-size: 14px; font-weight: bold;">${l.quantity}${l.sellByUnit && l.sellUnit ? ` ${l.sellUnit}` : ''}</td>
        <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: center;">Conforme ✅</td>
      </tr>`
      )
      .join('');

    const logoHtml = settings.logo
      ? `<img src="${settings.logo}" style="max-height: 70px; margin-bottom: 5px;" />`
      : `<div style="font-size: 32px; font-weight: bold; color: #d97706;">🚚 ${settings.name || 'CEMENT STORE'}</div>`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #000; padding: 25px; max-width: 800px; margin: 0 auto; border: 2px solid #000; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px;">
          <div>
            ${logoHtml}
            <h2 style="margin: 5px 0 2px 0; font-size: 20px; font-weight: bold;">${settings.name || 'CEMENT STORE'}</h2>
            <p style="margin: 2px 0; font-size: 12px;">📍 ${settings.address || 'Adresse non spécifiée'}</p>
            <p style="margin: 2px 0; font-size: 12px;">📞 Tel: ${settings.phone || 'N/A'}</p>
          </div>
          <div style="text-align: right;">
            <h1 style="margin: 0; font-size: 22px; font-weight: bold; background: #000; color: #fff; padding: 6px 16px; border-radius: 4px; display: inline-block;">BON DE LIVRAISON</h1>
            <p style="margin: 8px 0 2px 0; font-size: 14px; font-weight: bold;">Réf Commande: ${cmd.reference}</p>
            <p style="margin: 2px 0; font-size: 12px; font-weight: bold;">Date de Livraison: ${formatDate(cmd.receiveDate, 'fr')} à ${cmd.receiveHour}h${cmd.receiveMinute}</p>
          </div>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #ddd; padding: 12px 15px; border-radius: 6px; margin-bottom: 20px; font-size: 13px;">
          <p style="margin: 0 0 4px 0;"><strong>DESTINATAIRE (CLIENT) :</strong> ${cmd.clientName}</p>
          ${cmd.clientPhone ? `<p style="margin: 0;"><strong>TÉLÉPHONE :</strong> ${cmd.clientPhone}</p>` : ''}
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 13px;">
          <thead>
            <tr style="background-color: #f2f2f2;">
              <th style="border: 1px solid #ddd; padding: 10px; text-align: left;">Désignation Matériau / Produit Livré</th>
              <th style="border: 1px solid #ddd; padding: 10px; text-align: center;">Quantité Livrée</th>
              <th style="border: 1px solid #ddd; padding: 10px; text-align: center;">État de Réception</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div style="background: #fdf2f8; border: 1px solid #fbcfe8; padding: 10px 15px; border-radius: 6px; margin-bottom: 30px; font-size: 12px; text-align: center;">
          <p style="margin: 0; font-weight: bold; color: #9d174d;">Attestation de livraison : Le client reconnaît avoir reçu les marchandises ci-dessus en parfait état.</p>
        </div>

        <div style="display: flex; justify-content: space-between; text-align: center; font-size: 12px; margin-top: 40px;">
          <div style="width: 45%; border: 1px solid #000; padding: 15px; height: 100px; border-radius: 6px;">
            <p style="margin: 0 0 55px 0; font-weight: bold;">Signature &amp; Bon pour Réception (Client)</p>
          </div>
          <div style="width: 45%; border: 1px solid #000; padding: 15px; height: 100px; border-radius: 6px;">
            <p style="margin: 0 0 55px 0; font-weight: bold;">Cachet &amp; Signature Expéditeur (Magasin)</p>
          </div>
        </div>
      </div>
    `;

    printDocument(htmlContent, `Bon_de_Livraison_${cmd.reference}`);
  };

  const handleConfirmFinalise = () => {
    if (!finaliseCmd) return;
    const cmdSnapshot = finaliseCmd;
    finaliseCommand(finaliseCmd.id);
    toast.success('Livraison confirmée ! Commande finalisée et stock comptoir mis à jour.');
    setFinaliseCmd(null);
    promptPrint(cmdSnapshot, 'bon_livraison');
  };

  const handlePayDebt = () => {
    if (!payCmd) return;
    if (payAmount <= 0) { toast.error('Montant invalide'); return; }
    if (payAmount > payCmd.restAmount) { toast.error('Le montant dépasse la dette restante'); return; }

    payDebt(payCmd.id, payAmount, payDescription);
    toast.success('Paiement enregistré avec succès !');
    setPayCmd(null);
    setPayAmount(0);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commandes Clients"
        icon={<ShoppingCart size={24} className="text-gold" />}
        subtitle={`${filteredCommands.length} commandes enregistrées`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/clients')}>
              <User size={18} /> Retour aux Clients
            </Button>
            {can('clients', 'create') && (
              <Button variant="gold" onClick={handleOpenCreateForm}>
                <Plus size={18} /> Nouvelle Commande
              </Button>
            )}
          </div>
        }
      />

      {/* ===== Statistics Cards ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card index={0} className="relative overflow-hidden border border-gold/15">
          <p className="text-xs text-text-muted mb-1">Total Commandes</p>
          <p className="text-2xl font-bold tabular text-gold">{formatCurrency(stats.totalValue)}</p>
        </Card>
        <Card index={1} className="relative overflow-hidden border border-gold/15">
          <p className="text-xs text-text-muted mb-1">Total Versé (Acomptes)</p>
          <p className="text-2xl font-bold tabular text-emerald-400">{formatCurrency(stats.totalPaid)}</p>
        </Card>
        <Card index={2} className="relative overflow-hidden border border-gold/15">
          <p className="text-xs text-text-muted mb-1">Total Dettes Restantes</p>
          <p className="text-2xl font-bold tabular text-rose-400">{formatCurrency(stats.totalRest)}</p>
        </Card>
      </div>

      {/* ===== Search & Filter Controls ===== */}
      <Card index={3}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <SearchBar value={search} onChange={setSearch} placeholder="Rechercher par nom de client ou téléphone..." />
            </div>
            <div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full h-11 px-4 rounded-xl border border-gold/20 bg-vanilla/40 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              >
                <option value="all">Tous les statuts</option>
                <option value="pending">En attente (Non livrées)</option>
                <option value="finalised">Livrées / Finalisées</option>
                <option value="paid">Totalement Payées</option>
                <option value="debt">Avec Dette</option>
              </select>
            </div>
            <div>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                className="w-full h-11 px-4 rounded-xl border border-gold/20 bg-vanilla/40 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              >
                <option value="all">Toutes les dates</option>
                <option value="today">Aujourd'hui</option>
                <option value="week">7 derniers jours</option>
                <option value="month">30 derniers jours</option>
                <option value="period">Par période</option>
              </select>
            </div>
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

      {/* ===== Commands Cards Grid ===== */}
      {filteredCommands.length === 0 ? (
        <EmptyState message="Aucune commande enregistrée pour ces filtres" icon={<ShoppingCart size={36} />} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCommands.map((cmd, i) => {
            const isFinalised = cmd.status === 'finalised';
            return (
              <motion.div
                key={cmd.id}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="flex flex-col border border-gold/20 rounded-2xl bg-gradient-card p-5 shadow-card hover:border-gold/50 transition-all relative justify-between"
              >
                <div>
                  {/* Header info */}
                  <div className="flex justify-between items-start mb-3 gap-2">
                    <div>
                      <span className="text-xs font-bold text-gold">{cmd.reference}</span>
                      <h3 className="font-display font-semibold text-text-primary text-base truncate">{cmd.clientName}</h3>
                      {cmd.clientPhone && (
                        <p className="text-xs text-text-muted flex items-center gap-1 mt-0.5">
                          <Phone size={11} /> {cmd.clientPhone}
                        </p>
                      )}
                    </div>
                    <Badge variant={isFinalised ? 'success' : 'warning'}>
                      {isFinalised ? 'Livrée' : 'En attente'}
                    </Badge>
                  </div>

                  {/* Dates info */}
                  <div className="bg-vanilla/50 rounded-xl p-3 text-xs space-y-1 border border-gold/10 mb-3">
                    <div className="flex justify-between items-center text-text-muted">
                      <span className="flex items-center gap-1"><Calendar size={11} /> Créée le :</span>
                      <span className="font-semibold text-text-primary">{formatDate(cmd.createdAt.slice(0, 10), language)}</span>
                    </div>
                    <div className="flex justify-between items-center text-amber-400 font-semibold">
                      <span className="flex items-center gap-1"><Clock size={11} /> Date Livraison :</span>
                      <span>{formatDate(cmd.receiveDate, language)} à {cmd.receiveHour}h{cmd.receiveMinute}</span>
                    </div>
                  </div>

                  {/* Items preview list */}
                  <div className="mb-3">
                    <h4 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">Produits ({cmd.items.length})</h4>
                    <div className="space-y-1 max-h-[120px] overflow-y-auto pr-1">
                      {cmd.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs py-1 border-b border-gold/5 last:border-b-0">
                          <span className="text-text-primary truncate max-w-[150px]">{item.productName}</span>
                          <span className="text-text-muted font-mono">{item.quantity}{item.sellByUnit && item.sellUnit ? ` ${item.sellUnit}` : ''} × {formatCurrency(item.unitPrice)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Pricing info */}
                  <div className="border-t border-gold/10 pt-3 space-y-1 text-xs bg-vanilla/30 p-2.5 rounded-xl">
                    <div className="flex justify-between text-text-muted">
                      <span>Total Commande:</span>
                      <span className="font-bold text-text-primary">{formatCurrency(cmd.totalAmount)}</span>
                    </div>
                    <div className="flex justify-between text-text-muted">
                      <span>Acompte Versé:</span>
                      <span className="font-semibold text-emerald-400">{formatCurrency(cmd.paidAmount)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-xs pt-1 border-t border-gold/10">
                      <span>Reste à Payer:</span>
                      <span className={cmd.restAmount > 0 ? 'text-rose-400 font-extrabold' : 'text-emerald-400'}>
                        {formatCurrency(cmd.restAmount)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions Grid */}
                <div className="space-y-2 mt-4 pt-3 border-t border-gold/15">
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="secondary" className="text-xs" onClick={() => setViewingCmd(cmd)}>
                      <Eye size={13} /> Voir détails
                    </Button>
                    {!isFinalised ? (
                      <Button size="sm" variant="gold" className="text-xs font-bold" onClick={() => setFinaliseCmd(cmd)}>
                        <Truck size={13} /> Livraison
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" className="text-xs text-emerald-400" onClick={() => printBonDeLivraison(cmd)}>
                        <Printer size={13} /> Bon Livraison
                      </Button>
                    )}
                  </div>

                  <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" className="flex-1 text-[11px]" onClick={() => printBonDeCommande(cmd)}>
                      <Printer size={12} /> Bon Commande
                    </Button>

                    {can('clients', 'edit') && (
                      <Button size="sm" variant="secondary" onClick={() => handleOpenEditForm(cmd)} title="Modifier">
                        <Pencil size={13} />
                      </Button>
                    )}

                    {cmd.restAmount > 0 && (
                      <Button
                        size="sm"
                        variant="gold"
                        title="Payer acompte"
                        onClick={() => {
                          setPayCmd(cmd);
                          setPayAmount(cmd.restAmount);
                          setPayDescription(`Versement acompte pour commande ${cmd.reference}`);
                        }}
                      >
                        <Coins size={13} />
                      </Button>
                    )}

                    {can('clients', 'delete') && (
                      <Button size="sm" variant="ghost" onClick={() => setDeleteId(cmd.id)} className="hover:bg-rose-500/20 text-rose-400" title="Supprimer">
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ===== Create / Edit Command Modal ===== */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Modifier la commande' : 'Créer une nouvelle commande'}
        size="lg"
      >
        <div className="space-y-4">
          {/* Client Selection Row */}
          <div className="border border-gold/20 rounded-2xl p-4 bg-vanilla/40 relative">
            <h3 className="text-xs font-bold text-gold uppercase tracking-wider mb-3 flex items-center gap-2">
              <User size={15} /> 1. Sélectionner ou créer le client
            </h3>
            
            {selectedClient ? (
              <div className="flex items-center justify-between p-3 rounded-xl bg-vanilla/60 border border-gold/30">
                <div>
                  <p className="font-bold text-sm text-text-primary">{selectedClient.name}</p>
                  {selectedClient.phone && <p className="text-xs text-text-muted">📞 Tel: {selectedClient.phone}</p>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedClient(null)}>
                  <X size={14} /> Changer
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                    <Input
                      placeholder="Rechercher client par nom ou téléphone..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Button variant="secondary" onClick={() => setShowNewClientForm(!showNewClientForm)} title="Créer un client">
                    <UserPlus size={16} /> Client
                  </Button>
                </div>

                {/* Inline Client Creation */}
                <AnimatePresence>
                  {showNewClientForm && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="p-3 border border-gold/30 rounded-xl bg-vanilla/80 space-y-3"
                    >
                      <p className="text-xs font-bold text-gold">Créer et Sélectionner un Client</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input placeholder="Nom du client *" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} />
                        <Input placeholder="Téléphone" value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setShowNewClientForm(false)}>Annuler</Button>
                        <Button size="sm" variant="gold" onClick={handleCreateClientInline}>Créer &amp; Sélectionner</Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Search Results List */}
                {clientSearch && clientSearchResults.length > 0 && (
                  <div className="border border-gold/30 rounded-xl bg-[--surface-dropdown] max-h-[160px] overflow-y-auto shadow-xl">
                    {clientSearchResults.map((cli) => (
                      <button
                        key={cli.id}
                        onClick={() => { setSelectedClient(cli); setClientSearch(''); }}
                        className="w-full text-left p-3 hover:bg-gold/20 border-b border-gold/10 last:border-b-0 text-xs text-text-primary transition-colors flex items-center justify-between"
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

          {/* Dates & Hours Row */}
          <div className="border border-gold/20 rounded-2xl p-4 bg-vanilla/40">
            <h3 className="text-xs font-bold text-gold uppercase tracking-wider mb-3 flex items-center gap-2">
              <Calendar size={15} /> 2. Date et heure de livraison
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="Date de livraison *" type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1">Heure (00-23)</label>
                <select
                  value={receiveHour}
                  onChange={(e) => setReceiveHour(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl border border-gold/20 bg-vanilla/40 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold"
                >
                  {Array.from({ length: 24 }).map((_, h) => {
                    const val = String(h).padStart(2, '0');
                    return <option key={val} value={val}>{val}h</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1">Minute (00-59)</label>
                <select
                  value={receiveMinute}
                  onChange={(e) => setReceiveMinute(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl border border-gold/20 bg-vanilla/40 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold"
                >
                  {['00', '15', '30', '45'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Products Select & List */}
          <div className="border border-gold/20 rounded-2xl p-4 bg-vanilla/40 space-y-3">
            <h3 className="text-xs font-bold text-gold uppercase tracking-wider mb-2 flex items-center gap-2">
              <Receipt size={15} /> 3. Sélectionner les produits (Sélection Multiple)
            </h3>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
              <Input
                placeholder="Rechercher une Formule ou Fiche Technique à ajouter..."
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
                    className="w-full text-left p-3 hover:bg-gold/20 border-b border-gold/10 last:border-b-0 text-xs text-text-primary transition-colors flex items-center justify-between"
                  >
                    <span className="font-bold">{ft.name}</span>
                    <span className="text-gold font-mono">{formatCurrency(ft.unitPrice)}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Selected Items Table */}
            {selectedItems.length > 0 ? (
              <div className="overflow-x-auto border border-gold/15 rounded-xl bg-vanilla/40">
                <table className="w-full text-xs">
                  <thead className="bg-vanilla/60 text-text-secondary">
                    <tr>
                      <th className="text-left px-3 py-2">Produit</th>
                      <th className="text-right px-3 py-2">Quantité</th>
                      <th className="text-right px-3 py-2">P.U (DA)</th>
                      <th className="text-right px-3 py-2">Total (DA)</th>
                      <th className="text-center px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedItems.map((item, idx) => (
                      <tr key={idx} className="border-t border-gold/10">
                        <td className="px-3 py-2 font-semibold text-text-primary">{item.productName}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0.01}
                            step="any"
                            value={item.quantity}
                            onChange={(e) => handleUpdateItemQty(idx, Number(e.target.value))}
                            className="w-20 px-2 py-1 text-right bg-[--surface-input] border border-gold/30 rounded-lg text-text-primary text-xs"
                          />
                          {item.sellByUnit && item.sellUnit ? ` ${item.sellUnit}` : ''}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={item.unitPrice}
                            onChange={(e) => handleUpdateItemPrice(idx, Number(e.target.value))}
                            className="w-24 px-2 py-1 text-right bg-[--surface-input] border border-gold/30 rounded-lg text-text-primary text-xs"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-bold tabular text-gold">
                          {formatCurrency(item.totalPrice)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => handleRemoveItem(idx)} className="p-1 rounded-lg text-rose-400 hover:bg-rose-500/20">
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
                Aucun produit sélectionné. Recherchez une formule ci-dessus pour l'ajouter.
              </p>
            )}
          </div>

          {/* Pricing calculations */}
          <div className="border border-gold/20 rounded-2xl p-4 bg-vanilla/40 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Total calculé</label>
              <div className="w-full h-11 px-4 flex items-center rounded-xl border border-gold/20 bg-vanilla/60 text-gold font-bold text-sm">
                {formatCurrency(computedTotalSum)}
              </div>
            </div>
            <Input
              label="Ajuster le total final (DA)"
              type="number"
              value={customTotal !== null ? customTotal : ''}
              placeholder={String(computedTotalSum)}
              onChange={(e) => setCustomTotal(e.target.value ? Number(e.target.value) : null)}
            />
            <Input
              label="Acompte / Versement (DA)"
              type="number"
              value={versement}
              onChange={(e) => setVersement(Number(e.target.value))}
            />
          </div>

          {/* Balance Preview */}
          <div className="flex justify-between items-center p-3 rounded-xl bg-gold/10 border border-gold/30 text-gold font-bold text-xs">
            <span>Reste à payer (Dette enregistrée) :</span>
            <span className="text-sm font-mono text-rose-400">{formatCurrency(Math.max(0, finalTotalAmount - versement))}</span>
          </div>

          {/* Footer buttons */}
          <div className="flex justify-end gap-2 pt-2 border-t border-gold/10">
            <Button variant="secondary" onClick={() => setFormOpen(false)}>Annuler</Button>
            <Button variant="gold" onClick={handleSaveCommand}>Enregistrer Commande</Button>
          </div>
        </div>
      </Modal>

      {/* ===== Voir Détails Modal ===== */}
      <Modal open={!!viewingCmd} onClose={() => setViewingCmd(null)} title={`Détails Commande ${viewingCmd?.reference}`} size="md">
        {viewingCmd && (
          <div className="space-y-4">
            <div className="bg-vanilla/50 p-3 rounded-xl border border-gold/20 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-text-muted">Client:</span>
                <span className="font-bold text-text-primary">{viewingCmd.clientName}</span>
              </div>
              {viewingCmd.clientPhone && (
                <div className="flex justify-between">
                  <span className="text-text-muted">Téléphone:</span>
                  <span>{viewingCmd.clientPhone}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-text-muted">Date de Livraison:</span>
                <span className="font-bold text-gold">{formatDate(viewingCmd.receiveDate, 'fr')} à {viewingCmd.receiveHour}h{viewingCmd.receiveMinute}</span>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-gold mb-2 uppercase">Liste des produits commandés</h4>
              <div className="border border-gold/20 rounded-xl overflow-hidden bg-vanilla/40">
                <table className="w-full text-xs">
                  <thead className="bg-vanilla/60 text-text-secondary">
                    <tr>
                      <th className="text-left px-3 py-2">Produit</th>
                      <th className="text-center px-3 py-2">Quantité</th>
                      <th className="text-right px-3 py-2">P.U</th>
                      <th className="text-right px-3 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingCmd.items.map((it, idx) => (
                      <tr key={idx} className="border-t border-gold/10">
                        <td className="px-3 py-2 font-bold">{it.productName}</td>
                        <td className="px-3 py-2 text-center">{it.quantity}{it.sellByUnit && it.sellUnit ? ` ${it.sellUnit}` : ''}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(it.unitPrice)}</td>
                        <td className="px-3 py-2 text-right font-bold text-gold">{formatCurrency(it.totalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-vanilla/50 p-3 rounded-xl border border-gold/20 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-text-muted">Total Commande:</span>
                <span className="font-bold">{formatCurrency(viewingCmd.totalAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Acompte Versé:</span>
                <span className="font-bold text-emerald-400">{formatCurrency(viewingCmd.paidAmount)}</span>
              </div>
              <div className="flex justify-between font-bold text-sm border-t border-gold/10 pt-1">
                <span>Reste à Payer:</span>
                <span className={viewingCmd.restAmount > 0 ? 'text-rose-400' : 'text-emerald-400'}>{formatCurrency(viewingCmd.restAmount)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gold/10">
              <Button variant="secondary" onClick={() => printBonDeCommande(viewingCmd)}>
                <Printer size={15} /> Imprimer Bon Commande
              </Button>
              <Button variant="gold" onClick={() => printBonDeLivraison(viewingCmd)}>
                <Printer size={15} /> Imprimer Bon Livraison
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ===== Delivery Confirmation Modal ===== */}
      <Modal open={!!finaliseCmd} onClose={() => setFinaliseCmd(null)} title="Confirmer la Livraison de la commande" size="md">
        {finaliseCmd && (
          <div className="space-y-4">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 font-semibold flex items-center gap-2">
              <AlertTriangle size={18} />
              <span>Voulez-vous valider la livraison et déduire les marchandises du stock ?</span>
            </div>

            <div className="bg-vanilla/50 p-3 rounded-xl text-xs space-y-1.5 border border-gold/20">
              <div className="flex justify-between">
                <span className="text-text-muted">Client:</span>
                <span className="font-bold text-text-primary">{finaliseCmd.clientName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Total Commande:</span>
                <span className="font-bold text-gold">{formatCurrency(finaliseCmd.totalAmount)}</span>
              </div>
              <div className="flex justify-between font-bold text-rose-400 border-t border-gold/10 pt-1">
                <span>Dette à conserver:</span>
                <span>{formatCurrency(finaliseCmd.restAmount)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gold/10">
              <Button variant="secondary" onClick={() => setFinaliseCmd(null)}>Annuler</Button>
              <Button variant="gold" onClick={handleConfirmFinalise}>
                <Truck size={16} /> Valider Livraison &amp; Imprimer Bon
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ===== Pay Debt Modal ===== */}
      <Modal open={!!payCmd} onClose={() => setPayCmd(null)} title="Règlement Acompte / Dette Commande" size="sm">
        {payCmd && (
          <div className="space-y-4">
            <div className="bg-vanilla/50 p-3 rounded-xl text-xs space-y-1 border border-gold/20">
              <p><strong>N° Commande :</strong> {payCmd.reference}</p>
              <p><strong>Client :</strong> {payCmd.clientName}</p>
              <p><strong>Reste à payer :</strong> <strong className="text-rose-400">{formatCurrency(payCmd.restAmount)}</strong></p>
            </div>

            <Input
              label="Montant du versement (DA) *"
              type="number"
              value={payAmount || ''}
              onChange={(e) => setPayAmount(Number(e.target.value))}
            />

            <Input
              label="Description / Note"
              type="text"
              value={payDescription}
              onChange={(e) => setPayDescription(e.target.value)}
            />

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
        onConfirm={() => { if (deleteId) { deleteCommand(deleteId); toast.success('Commande supprimée'); } }}
      />

      {/* ===== Print Prompt Modal ===== */}
      <Modal open={!!printPromptCmd} onClose={() => setPrintPromptCmd(null)} size="sm">
        <div className="flex flex-col items-center text-center py-2">
          <div className="h-14 w-14 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
            <CheckCircle2 size={30} className="text-emerald-400" />
          </div>
          <h3 className="font-display text-lg font-bold text-text-primary mb-1">
            Opération Réussie !
          </h3>
          <p className="text-xs text-gold mb-1">{printPromptCmd?.reference}</p>
          <p className="text-xs text-text-muted mb-6">
            Voulez-vous imprimer le document ?
          </p>
          <div className="flex gap-2 w-full">
            <Button variant="secondary" className="flex-1 text-xs" onClick={() => setPrintPromptCmd(null)}>Fermer</Button>
            <Button
              variant="gold"
              className="flex-1 text-xs font-bold"
              onClick={() => {
                if (printPromptCmd) {
                  if (printPromptType === 'bon_livraison') printBonDeLivraison(printPromptCmd);
                  else printBonDeCommande(printPromptCmd);
                  setPrintPromptCmd(null);
                }
              }}
            >
              <Printer size={16} /> Imprimer Document
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
