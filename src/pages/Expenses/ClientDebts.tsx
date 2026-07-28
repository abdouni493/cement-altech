import { useMemo, useState } from 'react';
import { Coins, Plus, Search, Eye, Trash2, Pencil, Calendar, Wallet, FileText, UserPlus, X, Printer, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/shared/StatCard';
import { useClientDebtStore } from '@/store/clientDebtStore';
import { useClientStore } from '@/store/clientStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { printDocument } from '@/lib/print';
import type { ClientDebt, ClientDebtVersement } from '@/types';

export default function ClientDebtsPage() {
  const { language } = useLanguage();
  const { can } = usePermissions();
  const { debts, addDebt, updateDebt, deleteDebt, addVersement, deleteVersement } = useClientDebtStore();

  const [search, setSearch] = useState('');
  
  // Modals
  const [createDebtOpen, setCreateDebtOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<ClientDebt | null>(null);
  const [viewingDebt, setViewingDebt] = useState<ClientDebt | null>(null);
  const [deletingDebtId, setDeletingDebtId] = useState<string | null>(null);
  const [versementDebt, setVersementDebt] = useState<ClientDebt | null>(null);
  const [printHistoryOpen, setPrintHistoryOpen] = useState(false);

  // Filtered Debts
  const filteredDebts = useMemo(() => {
    return debts.filter((d) =>
      d.clientName.toLowerCase().includes(search.toLowerCase()) ||
      (d.clientPhone && d.clientPhone.includes(search)) ||
      d.description.toLowerCase().includes(search.toLowerCase())
    );
  }, [debts, search]);

  // Statistics
  const totalDebtSum = useMemo(() => debts.reduce((s, d) => s + d.totalDebt, 0), [debts]);
  const totalPaidSum = useMemo(() => debts.reduce((s, d) => s + d.totalPaid, 0), [debts]);
  const totalRestSum = useMemo(() => debts.reduce((s, d) => s + d.restAmount, 0), [debts]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dettes Clients"
        icon={<Coins size={24} className="text-gold" />}
        subtitle="Gestion des créances, encaissements et historiques de paiement"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPrintHistoryOpen(true)}>
              <Printer size={18} /> Imprimer Rapport Versements
            </Button>
            {can('expenses', 'create') && (
              <Button variant="gold" onClick={() => setCreateDebtOpen(true)}>
                <Plus size={18} /> Nouvelle Dette Client
              </Button>
            )}
          </div>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total Créances Clients"
          value={totalDebtSum}
          format="currency"
          icon={<Coins size={22} className="text-gold" />}
          accent="gold"
        />
        <StatCard
          label="Total Encaissements"
          value={totalPaidSum}
          format="currency"
          icon={<Wallet size={22} className="text-emerald-400" />}
          accent="pistachio"
        />
        <StatCard
          label="Reste à Recouvrer"
          value={totalRestSum}
          format="currency"
          icon={<FileText size={22} className="text-rose-400" />}
          accent="rose"
        />
      </div>

      {/* Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex-1 min-w-[280px]">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Rechercher par nom de client, téléphone ou motif..."
          />
        </div>
      </div>

      {/* Debts Grid */}
      {filteredDebts.length === 0 ? (
        <EmptyState message="Aucune dette client enregistrée." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDebts.map((debt, index) => {
            const isSettled = debt.restAmount <= 0;
            return (
              <Card key={debt.id} index={index} className="flex flex-col justify-between space-y-4 border border-gold/15 hover:border-gold/40">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-bold text-base text-text-primary">{debt.clientName}</h3>
                      {debt.clientPhone && <p className="text-xs text-text-muted">Tel: {debt.clientPhone}</p>}
                    </div>
                    <Badge variant={isSettled ? 'success' : 'danger'}>
                      {isSettled ? 'Réglée' : `Reste: ${formatCurrency(debt.restAmount)}`}
                    </Badge>
                  </div>

                  <p className="text-xs text-text-muted mb-3 flex items-center gap-1">
                    <Calendar size={12} /> {formatDate(debt.date, language)}
                  </p>

                  {debt.description && (
                    <p className="text-xs text-text-secondary italic mb-3 bg-vanilla/30 p-2 rounded-lg">
                      « {debt.description} »
                    </p>
                  )}

                  <div className="bg-vanilla/40 rounded-xl p-3 space-y-1 text-xs border border-gold/10">
                    <div className="flex justify-between text-text-muted">
                      <span>Dette Totale Initial:</span>
                      <span className="font-semibold text-text-primary tabular">{formatCurrency(debt.totalDebt)}</span>
                    </div>
                    <div className="flex justify-between text-text-muted">
                      <span>Total Payé:</span>
                      <span className="font-semibold text-emerald-400 tabular">{formatCurrency(debt.totalPaid)}</span>
                    </div>
                    <div className="flex justify-between text-text-muted border-t border-gold/10 pt-1 mt-1 font-bold">
                      <span className="text-text-primary">Reste à Payer:</span>
                      <span className={`tabular ${debt.restAmount > 0 ? 'text-rose-400 font-extrabold' : 'text-emerald-400'}`}>
                        {formatCurrency(debt.restAmount)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-gold/10">
                  <Button
                    variant="gold"
                    size="sm"
                    className="w-full text-xs font-bold"
                    onClick={() => setVersementDebt(debt)}
                  >
                    <Wallet size={14} /> Effectuer Versement
                  </Button>

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => setViewingDebt(debt)}
                    >
                      <Eye size={13} /> Versements ({debt.versements.length})
                    </Button>

                    {can('expenses', 'edit') && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditingDebt(debt)}
                        title="Modifier"
                      >
                        <Pencil size={13} />
                      </Button>
                    )}

                    {can('expenses', 'delete') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingDebtId(debt.id)}
                        className="hover:bg-rose-500/20 text-rose-400"
                        title="Supprimer"
                      >
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal: Create Debt */}
      <Modal open={createDebtOpen} onClose={() => setCreateDebtOpen(false)} title="Nouvelle Dette Client" size="md">
        <CreateDebtModal
          onClose={() => setCreateDebtOpen(false)}
          onSuccess={(newDebt) => {
            addDebt(newDebt);
            toast.success('Dette client enregistrée avec succès !');
            setCreateDebtOpen(false);
          }}
        />
      </Modal>

      {/* Modal: Edit Debt */}
      <Modal open={!!editingDebt} onClose={() => setEditingDebt(null)} title="Modifier Dette Client" size="md">
        {editingDebt && (
          <EditDebtModal
            debt={editingDebt}
            onClose={() => setEditingDebt(null)}
            onSuccess={(data) => {
              updateDebt(editingDebt.id, data);
              toast.success('Dette mise à jour !');
              setEditingDebt(null);
            }}
          />
        )}
      </Modal>

      {/* Modal: Versement (Payment) */}
      <Modal open={!!versementDebt} onClose={() => setVersementDebt(null)} title={`Nouveau Versement — ${versementDebt?.clientName}`} size="sm">
        {versementDebt && (
          <VersementModal
            debt={versementDebt}
            onClose={() => setVersementDebt(null)}
            onSuccess={(data) => {
              addVersement(data);
              toast.success('Versement enregistré ! Montant ajouté à la Caisse.');
              setVersementDebt(null);
            }}
          />
        )}
      </Modal>

      {/* Modal: View Debt Details & Versements History */}
      <Modal open={!!viewingDebt} onClose={() => setViewingDebt(null)} title={`Historique Versements — ${viewingDebt?.clientName}`} size="md">
        {viewingDebt && (
          <ViewingDebtModal
            debt={viewingDebt}
            onDeleteVersement={(vId) => {
              deleteVersement(viewingDebt.id, vId);
              toast.success('Versement supprimé');
            }}
            onClose={() => setViewingDebt(null)}
          />
        )}
      </Modal>

      {/* Confirm Delete Debt */}
      <ConfirmDialog
        open={!!deletingDebtId}
        onClose={() => setDeletingDebtId(null)}
        onConfirm={() => {
          if (deletingDebtId) {
            deleteDebt(deletingDebtId);
            toast.success('Dette supprimée');
          }
        }}
        title="Supprimer Dette"
        message="Êtes-vous sûr de vouloir supprimer cette dette client ?"
      />

      {/* Modal: Print Versements History */}
      <Modal open={printHistoryOpen} onClose={() => setPrintHistoryOpen(false)} title="Imprimer Historique des Versements" size="sm">
        <PrintHistoryModal debts={debts} onClose={() => setPrintHistoryOpen(false)} />
      </Modal>
    </div>
  );
}

// -------------------------------------------------------------
// Component: Create Debt Modal
// -------------------------------------------------------------
function CreateDebtModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (data: {
    clientId: string;
    clientName: string;
    clientPhone?: string;
    totalDebt: number;
    date: string;
    description: string;
  }) => void;
}) {
  const { clients, addClient } = useClientStore();

  const [clientSearch, setClientSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedClientName, setSelectedClientName] = useState('');
  const [selectedClientPhone, setSelectedClientPhone] = useState('');
  
  // Inline Client Creation
  const [inlineCreatingClient, setInlineCreatingClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');

  const [amount, setAmount] = useState<number | ''>('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');

  const filteredClients = useMemo(() => {
    if (!clientSearch) return clients.slice(0, 5);
    const q = clientSearch.toLowerCase();
    return clients.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  }, [clients, clientSearch]);

  const handleSelectClient = (c: { id: string; name: string; phone: string }) => {
    setSelectedClientId(c.id);
    setSelectedClientName(c.name);
    setSelectedClientPhone(c.phone);
    setClientSearch(c.name);
  };

  const handleCreateInlineClient = () => {
    if (!newClientName.trim()) {
      toast.error('Nom du client requis');
      return;
    }
    const created = addClient({ name: newClientName.trim(), phone: newClientPhone.trim() });
    handleSelectClient(created);
    setInlineCreatingClient(false);
    setNewClientName('');
    setNewClientPhone('');
    toast.success('Nouveau client créé !');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientName.trim()) {
      toast.error('Veuillez sélectionner ou créer un client');
      return;
    }
    if (!amount || amount <= 0) {
      toast.error('Montant de la dette valide requis');
      return;
    }

    onSuccess({
      clientId: selectedClientId || 'guest',
      clientName: selectedClientName.trim(),
      clientPhone: selectedClientPhone.trim(),
      totalDebt: Number(amount),
      date,
      description: description.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Client Picker */}
      <div className="space-y-2">
        <label className="block text-xs font-semibold text-text-secondary">Client *</label>
        
        {inlineCreatingClient ? (
          <div className="bg-vanilla/50 p-3 rounded-xl border border-gold/30 space-y-3">
            <div className="flex justify-between items-center text-xs font-bold text-gold">
              <span>Créer un nouveau client</span>
              <button type="button" onClick={() => setInlineCreatingClient(false)} className="text-text-muted hover:text-text-primary">
                <X size={14} />
              </button>
            </div>
            <Input label="Nom complet *" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="Ex: Karim Benali" />
            <Input label="Numéro de téléphone" value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} placeholder="0661000000" />
            <Button type="button" variant="gold" size="sm" className="w-full text-xs font-bold" onClick={handleCreateInlineClient}>
              Enregistrer &amp; Sélectionner Client
            </Button>
          </div>
        ) : (
          <div className="relative">
            <div className="flex gap-2">
              <Input
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  if (selectedClientName) setSelectedClientName('');
                }}
                placeholder="Rechercher par nom ou numéro..."
                className="flex-1"
              />
              <Button type="button" variant="secondary" onClick={() => setInlineCreatingClient(true)} title="Créer un client">
                <UserPlus size={16} /> Client
              </Button>
            </div>

            {clientSearch && !selectedClientName && filteredClients.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-[--surface-dropdown] border border-gold/30 rounded-xl shadow-xl max-h-40 overflow-y-auto">
                {filteredClients.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelectClient(c)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-gold/20 flex justify-between items-center border-b border-gold/10 last:border-0"
                  >
                    <span className="font-semibold text-text-primary">{c.name}</span>
                    <span className="text-text-muted">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedClientName && (
          <div className="text-xs text-gold flex items-center gap-1 font-semibold">
            ✓ Client sélectionné: {selectedClientName} {selectedClientPhone && `(${selectedClientPhone})`}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Montant de la dette (DA) *"
          type="number"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder="Ex: 50000"
          required
        />
        <Input
          label="Date de la dette *"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      <Textarea
        label="Description / Motif *"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Raison ou détail de la créance..."
        rows={3}
      />

      <div className="flex justify-end gap-2 pt-3 border-t border-gold/10">
        <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
        <Button type="submit" variant="gold">Enregistrer Dette</Button>
      </div>
    </form>
  );
}

// -------------------------------------------------------------
// Component: Edit Debt Modal
// -------------------------------------------------------------
function EditDebtModal({
  debt,
  onClose,
  onSuccess,
}: {
  debt: ClientDebt;
  onClose: () => void;
  onSuccess: (data: Partial<ClientDebt>) => void;
}) {
  const [totalDebt, setTotalDebt] = useState<number>(debt.totalDebt);
  const [date, setDate] = useState(debt.date);
  const [description, setDescription] = useState(debt.description);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (totalDebt < debt.totalPaid) {
      toast.error(`Le montant total ne peut pas être inférieur au montant déjà payé (${formatCurrency(debt.totalPaid)})`);
      return;
    }

    onSuccess({
      totalDebt,
      date,
      description,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Client"
        value={debt.clientName}
        disabled
        className="opacity-70 cursor-not-allowed"
      />

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Montant Total Dette (DA) *"
          type="number"
          step="any"
          value={totalDebt}
          onChange={(e) => setTotalDebt(Number(e.target.value))}
          required
        />
        <Input
          label="Date de la dette *"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      <Textarea
        label="Description *"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
      />

      <div className="flex justify-end gap-2 pt-3 border-t border-gold/10">
        <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
        <Button type="submit" variant="gold">Mettre à jour</Button>
      </div>
    </form>
  );
}

// -------------------------------------------------------------
// Component: Versement (Payment) Modal
// -------------------------------------------------------------
function VersementModal({
  debt,
  onClose,
  onSuccess,
}: {
  debt: ClientDebt;
  onClose: () => void;
  onSuccess: (data: { debtId: string; amount: number; date: string; notes?: string }) => void;
}) {
  const [amount, setAmount] = useState<number | ''>('');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');

  const numAmount = Number(amount || 0);
  const remainingRest = Math.max(0, debt.restAmount - numAmount);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!numAmount || numAmount <= 0) {
      toast.error('Veuillez saisir un montant de versement valide');
      return;
    }
    if (numAmount > debt.restAmount) {
      toast.error(`Le versement ne peut pas dépasser le reste à payer (${formatCurrency(debt.restAmount)})`);
      return;
    }

    onSuccess({
      debtId: debt.id,
      amount: numAmount,
      date,
      notes: notes.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Summary Card */}
      <div className="bg-vanilla/50 rounded-xl p-3 border border-gold/20 space-y-1 text-xs">
        <div className="flex justify-between text-text-muted">
          <span>Client:</span>
          <span className="font-bold text-text-primary">{debt.clientName}</span>
        </div>
        <div className="flex justify-between text-text-muted">
          <span>Dette Totale:</span>
          <span>{formatCurrency(debt.totalDebt)}</span>
        </div>
        <div className="flex justify-between text-text-muted">
          <span>Déjà Payé:</span>
          <span className="text-emerald-400 font-semibold">{formatCurrency(debt.totalPaid)}</span>
        </div>
        <div className="flex justify-between border-t border-gold/10 pt-1 text-sm font-bold text-rose-400">
          <span>Reste Actuel à Payer:</span>
          <span>{formatCurrency(debt.restAmount)}</span>
        </div>
      </div>

      <div className="space-y-3">
        <Input
          label="Montant à Verser (DA) *"
          type="number"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder="Montant payé par le client..."
          autoFocus
          required
        />

        {numAmount > 0 && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-xs flex justify-between items-center font-bold">
            <span className="text-emerald-400">Nouveau Reste à Payer:</span>
            <span className="text-emerald-300 text-sm">{formatCurrency(remainingRest)}</span>
          </div>
        )}

        <Input
          label="Date du versement *"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />

        <Input
          label="Notes / Remarques (Optionnel)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ex: Versement par chèque / espèces"
        />
      </div>

      <div className="flex justify-end gap-2 pt-3 border-t border-gold/10">
        <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
        <Button type="submit" variant="gold" disabled={!numAmount || numAmount <= 0}>
          Enregistrer Versement
        </Button>
      </div>
    </form>
  );
}

// -------------------------------------------------------------
// Component: Viewing Debt Modal (Versements History)
// -------------------------------------------------------------
function ViewingDebtModal({
  debt,
  onDeleteVersement,
  onClose,
}: {
  debt: ClientDebt;
  onDeleteVersement: (vId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Header Info */}
      <div className="bg-vanilla/50 rounded-xl p-3 border border-gold/20 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-text-muted">Client:</span>
          <span className="font-bold text-text-primary">{debt.clientName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Date Dette:</span>
          <span>{formatDate(debt.date, 'fr')}</span>
        </div>
        <div className="flex justify-between border-t border-gold/10 pt-1">
          <span className="text-text-muted">Dette Totale:</span>
          <span className="font-bold">{formatCurrency(debt.totalDebt)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Total Encaissements:</span>
          <span className="font-bold text-emerald-400">{formatCurrency(debt.totalPaid)}</span>
        </div>
        <div className="flex justify-between font-bold text-sm">
          <span className="text-text-primary">Reste:</span>
          <span className={debt.restAmount > 0 ? 'text-rose-400' : 'text-emerald-400'}>
            {formatCurrency(debt.restAmount)}
          </span>
        </div>
      </div>

      {/* Versements List */}
      <div>
        <h4 className="text-xs font-bold text-gold mb-2">Historique des Versements ({debt.versements.length})</h4>
        
        {debt.versements.length === 0 ? (
          <p className="text-xs text-text-muted italic py-4 text-center bg-vanilla/20 rounded-xl">
            Aucun versement effectué pour le moment.
          </p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {debt.versements.map((v) => (
              <div key={v.id} className="bg-vanilla/40 border border-gold/15 rounded-xl p-3 flex justify-between items-center text-xs">
                <div>
                  <p className="font-bold text-emerald-400 text-sm">{formatCurrency(v.amount)}</p>
                  <p className="text-[11px] text-text-muted">
                    {v.createdAt || `${v.date} ${v.createdAt}`}
                    {v.createdBy && ` — par ${v.createdBy}`}
                  </p>
                  {v.notes && <p className="text-[11px] text-text-secondary italic">« {v.notes} »</p>}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDeleteVersement(v.id)}
                  className="hover:bg-rose-500/20 text-rose-400"
                  title="Supprimer ce versement"
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end pt-2 border-t border-gold/10">
        <Button variant="secondary" onClick={onClose}>Fermer</Button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Component: Print History Modal
// -------------------------------------------------------------
function PrintHistoryModal({
  debts,
  onClose,
}: {
  debts: ClientDebt[];
  onClose: () => void;
}) {
  const storeSettings = useSettingsStore((s) => s.settings);
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());

  const handlePrint = () => {
    // Gather all versements within [startDate, endDate]
    const allVersements: Array<ClientDebtVersement & { clientName: string }> = [];
    debts.forEach((d) => {
      d.versements.forEach((v) => {
        if (v.date >= startDate && v.date <= endDate) {
          allVersements.push({ ...v, clientName: d.clientName });
        }
      });
    });

    const totalPeriodAmount = allVersements.reduce((sum, v) => sum + v.amount, 0);

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #000; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px;">
          <div>
            ${storeSettings.logo ? `<img src="${storeSettings.logo}" style="max-height: 60px; margin-bottom: 5px;" />` : ''}
            <h1 style="margin: 0; font-size: 20px; font-weight: bold;">${storeSettings.name || 'ALTECH PRODUCTION'}</h1>
            <p style="margin: 3px 0; font-size: 11px;">${storeSettings.address || ''} | Tel: ${storeSettings.phone || ''}</p>
            ${storeSettings.nif ? `<p style="margin: 2px 0; font-size: 10px;">NIF: ${storeSettings.nif} | NIS: ${storeSettings.nis || ''}</p>` : ''}
          </div>
          <div style="text-align: right;">
            <h2 style="margin: 0; font-size: 16px; text-transform: uppercase;">Rapport des Versements</h2>
            <p style="margin: 4px 0; font-size: 12px; font-weight: bold;">Période: ${formatDate(startDate, 'fr')} au ${formatDate(endDate, 'fr')}</p>
            <p style="margin: 2px 0; font-size: 10px; color: #555;">Généré le: ${new Date().toLocaleString('fr-FR')}</p>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px;">
          <thead>
            <tr style="background-color: #f2f2f2;">
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Client</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Date &amp; Heure</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Notes</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Montant Versé</th>
            </tr>
          </thead>
          <tbody>
            ${
              allVersements.length === 0
                ? `<tr><td colspan="4" style="text-align: center; padding: 15px; color: #888;">Aucun versement enregistré pour cette période.</td></tr>`
                : allVersements
                    .map(
                      (v) => `
              <tr>
                <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold;">${v.clientName}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${v.createdAt || v.date}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${v.notes || '—'}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: right; font-weight: bold;">${formatCurrency(v.amount)}</td>
              </tr>
            `
                    )
                    .join('')
            }
          </tbody>
          <tfoot>
            <tr style="background-color: #f9f9f9; font-weight: bold;">
              <td colspan="3" style="border: 1px solid #ddd; padding: 10px; text-align: right;">TOTAL VERSEMENTS PÉRIODE:</td>
              <td style="border: 1px solid #ddd; padding: 10px; text-align: right; font-size: 14px; color: #000;">${formatCurrency(totalPeriodAmount)}</td>
            </tr>
          </tfoot>
        </table>

        <div style="margin-top: 40px; display: flex; justify-content: space-between; text-align: center; font-size: 12px;">
          <div style="width: 40%; border: 1px solid #ccc; padding: 15px; height: 80px;">
            <p style="margin: 0 0 40px 0; font-weight: bold;">Cachet &amp; Signature Entreprise</p>
          </div>
          <div style="width: 40%; border: 1px solid #ccc; padding: 15px; height: 80px;">
            <p style="margin: 0 0 40px 0; font-weight: bold;">Visa Responsable</p>
          </div>
        </div>
      </div>
    `;

    printDocument(htmlContent, `Rapport_Versements_${startDate}_au_${endDate}`);
    onClose();
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-secondary">
        Sélectionnez la période pour générer le rapport imprimable de tous les versements reçus.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Date Début *"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          required
        />
        <Input
          label="Date Fin *"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          required
        />
      </div>

      <div className="flex justify-end gap-2 pt-3 border-t border-gold/10">
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button variant="gold" onClick={handlePrint}>
          <Printer size={16} /> Imprimer Rapport
        </Button>
      </div>
    </div>
  );
}
