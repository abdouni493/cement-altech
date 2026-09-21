import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Users, Plus, Pencil, Trash2, Phone, Printer, CheckCircle2,
  AlertTriangle, Receipt, TrendingDown, ClipboardList, Layers,
  FileBarChart, HandCoins, History, PiggyBank, Undo2,
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
import { ClientForm } from '@/components/shared/ClientForm';
import { VersementModal } from '@/components/shared/VersementModal';
import { ClientStatementModal } from '@/components/shared/ClientStatementModal';
import { ClientHistoryScreen } from '@/components/shared/ClientHistoryScreen';
import { OldDebtModal } from '@/components/shared/OldDebtModal';
import { RefundCreditModal } from '@/components/shared/RefundCreditModal';
import { useClientStore } from '@/store/clientStore';
import { useSalesStore } from '@/store/salesStore';
import { useCommandStore } from '@/store/commandStore';
import { useClientDebtStore } from '@/store/clientDebtStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency } from '@/lib/utils';
import { printPaymentReceipt } from '@/lib/documents';
import { computePartyBalance } from '@/lib/partyBalance';
import { netCommandTotals } from '@/lib/commandBilling';
import { toast } from '@/components/ui/Toast';
import type { Client, PartyPayment, PaymentMethodDetails, PartyOldDebt } from '@/types';

type ClientFilter = 'all' | 'debt' | 'clear' | 'credit';

/** Situation d'un client telle qu'affichee sur sa carte et dans le tableau. */
interface ClientStats {
  balance: ReturnType<typeof computePartyBalance>;
  total: number; paid: number; rest: number; credit: number;
  salesCount: number; commandsCount: number; paymentsCount: number;
  oldDebtsCount: number; refundsCount: number;
}

/** Client sans aucune ecriture — evite un `undefined` dans les tableaux. */
const EMPTY_CLIENT_STATS: ClientStats = {
  balance: computePartyBalance({ documentsBilled: 0, documentsPaid: 0, documentsRest: 0, oldDebts: [] }),
  total: 0, paid: 0, rest: 0, credit: 0,
  salesCount: 0, commandsCount: 0, paymentsCount: 0, oldDebtsCount: 0, refundsCount: 0,
};

/* ============================================================================
 *  CLIENTS
 * ----------------------------------------------------------------------------
 *  La carte du client porte deux boutons de suivi et non plus trois :
 *
 *    « Versement »   cree un nouveau versement (inchange) ;
 *    « Historique »  ouvre TOUT ce que l'application sait du client, organise
 *                    par type d'operation (ventes, commandes, livraisons,
 *                    versements, anciennes ecritures, excedents, annulations).
 *
 *  L'ancien bouton « Versements (n) », qui n'ouvrait qu'une liste partielle,
 *  a disparu : c'est lui qui laissait croire qu'un versement supprime restait
 *  compte dans le compte rendu, puisqu'il n'en montrait qu'une partie.
 *
 *  L'ecran s'affiche par defaut en TABLEAU ; le bouton en haut a droite permet
 *  de revenir aux cartes.
 * ========================================================================== */

export default function ClientsPage() {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const {
    clients, payments, oldDebts, refunds, addClient, updateClient, deleteClient,
    payDebt, addOldDebt, updateOldDebt, refundCredit,
  } = useClientStore();
  const sales = useSalesStore((s) => s.sales);
  const commands = useCommandStore((s) => s.commands);
  const debts = useClientDebtStore((s) => s.debts);
  const settings = useSettingsStore((s) => s.settings);

  const [view, setView] = useViewMode('clients');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ClientFilter>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [history, setHistory] = useState<Client | null>(null);
  const [versing, setVersing] = useState<Client | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [statement, setStatement] = useState<Client | null>(null);
  const [printPrompt, setPrintPrompt] = useState<{ client: Client; payment: PartyPayment } | null>(null);
  const [oldDebtFor, setOldDebtFor] = useState<Client | null>(null);
  const [editOldDebt, setEditOldDebt] = useState<PartyOldDebt | null>(null);
  const [refunding, setRefunding] = useState<Client | null>(null);

  /**
   * SITUATION DE CHAQUE CLIENT, CALCULEE UNE SEULE FOIS.
   *
   * L'ancienne version rebalayait les ventes, les commandes et les versements
   * pour CHAQUE client, a CHAQUE rendu : avec 200 clients et 5 000 ventes,
   * l'ecran faisait un million de comparaisons a chaque frappe dans la barre
   * de recherche — d'ou la lenteur. Les listes sont desormais indexees une
   * seule fois par client, et `statsOf()` se contente de lire le resultat.
   */
  const statsByClient = useMemo(() => {
    interface Bucket {
      cs: typeof sales; cc: typeof commands; pays: number;
      olds: typeof oldDebts; versements: number; refs: number;
    }
    const index = new Map<string, Bucket>();
    const bucket = (id: string): Bucket => {
      let b = index.get(id);
      if (!b) { b = { cs: [], cc: [], pays: 0, olds: [], versements: 0, refs: 0 }; index.set(id, b); }
      return b;
    };
    const creditOf = new Map(clients.map((c) => [c.id, c.creditAmount ?? 0]));
    clients.forEach((c) => bucket(c.id));
    sales.forEach((x) => { if (x.clientId) bucket(x.clientId).cs.push(x); });
    commands.forEach((c) => { if (c.clientId) bucket(c.clientId).cc.push(c); });
    payments.forEach((x) => { bucket(x.partyId).pays += 1; });
    oldDebts.forEach((d) => { bucket(d.partyId).olds.push(d); });
    refunds.forEach((r) => { bucket(r.partyId).refs += 1; });
    debts.forEach((d) => { bucket(d.clientId).versements += (d.versements ?? []).length; });

    const out = new Map<string, ClientStats>();
    index.forEach((b, id) => {
      // Une commande deja transformee en bon(s) de livraison est deja facturee
      // par ses ventes : on n'ajoute que la part qui n'est pas encore livree.
      const netCmd = netCommandTotals(b.cc, b.cs);
      const balance = computePartyBalance({
        documentsBilled: b.cs.reduce((x, y) => x + y.finalAmount, 0) + netCmd.billed,
        documentsPaid: b.cs.reduce((x, y) => x + y.paidAmount, 0) + netCmd.paid,
        documentsRest: b.cs.reduce((x, y) => x + y.restAmount, 0) + netCmd.rest,
        oldDebts: b.olds,
        credit: creditOf.get(id) ?? 0,
      });
      out.set(id, {
        balance,
        total: balance.billed, paid: balance.paid, rest: balance.rest, credit: balance.credit,
        salesCount: b.cs.length,
        commandsCount: b.cc.length,
        // Toutes les ecritures de versement du client, y compris celles passees
        // sur une dette enregistree : c'est le compte affiche sur sa carte.
        paymentsCount: b.pays + b.versements,
        oldDebtsCount: b.olds.length,
        refundsCount: b.refs,
      });
    });
    return out;
  }, [clients, sales, commands, payments, oldDebts, refunds, debts]);

  const statsOf = (clientId: string): ClientStats =>
    statsByClient.get(clientId) ?? EMPTY_CLIENT_STATS;

  const filtered = useMemo(
    () =>
      clients.filter((c) => {
        const q = search.toLowerCase();
        const match =
          c.name.toLowerCase().includes(q) ||
          (c.phone || '').includes(search) ||
          (c.address || '').toLowerCase().includes(q);
        if (!match) return false;
        const bal = statsOf(c.id).balance;
        if (filter === 'debt') return bal.hasDebt;
        if (filter === 'credit') return bal.credit > 0;
        if (filter === 'clear') return !bal.hasDebt && bal.credit <= 0;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients, search, filter, statsByClient]
  );

  const globals = useMemo(() => {
    const netAll = netCommandTotals(commands, sales);
    const total =
      sales.reduce((s, x) => s + x.finalAmount, 0) + netAll.billed
      + oldDebts.reduce((s, x) => s + x.amount, 0);
    const paid =
      sales.reduce((s, x) => s + x.paidAmount, 0) + netAll.paid
      + oldDebts.reduce((s, x) => s + x.paidAmount, 0);
    const rest =
      sales.reduce((s, x) => s + x.restAmount, 0) + netAll.rest
      + oldDebts.reduce((s, x) => s + x.restAmount, 0);
    const credit = clients.reduce((s, c) => s + Math.max(0, c.creditAmount ?? 0), 0);
    const withDebt = clients.filter((c) => statsOf(c.id).balance.hasDebt).length;
    return { total, paid, rest, credit, withDebt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, commands, clients, oldDebts, statsByClient]);

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

  const handleOldDebt = async (
    client: Client, amount: number, date: string, description: string,
  ) => {
    if (editOldDebt) {
      await updateOldDebt(editOldDebt.id, amount, date, description);
      toast.success('Ancienne dette modifiée — la dette du client a été recalculée');
    } else {
      await addOldDebt(client.id, amount, date, description);
      toast.success('Ancienne dette enregistrée — elle s’ajoute à la dette du client');
    }
    setEditOldDebt(null);
    setOldDebtFor(null);
  };

  const handleRefund = async (
    client: Client, amount: number, notes: string, refundedAt: string,
    method: PaymentMethodDetails,
  ) => {
    await refundCredit(client.id, amount, refundedAt, notes, method);
    toast.success('Excédent rendu au client — la sortie de caisse a été enregistrée');
    setRefunding(null);
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

  /* --------------------------------------------------- actions communes --- */
  const clientActions = (c: Client): ActionItem[] => {
    const st = statsOf(c.id);
    return [
      { label: 'Historique complet', icon: <Layers size={15} />, onClick: () => setHistory(c) },
      { label: 'Compte rendu (période)', icon: <FileBarChart size={15} />, onClick: () => setStatement(c) },
      {
        label: 'Nouveau versement', icon: <HandCoins size={15} />, hidden: !can('clients', 'pay'),
        onClick: () => setVersing(c),
      },
      {
        label: 'Ancienne dette', icon: <History size={15} />, hidden: !can('clients', 'create'),
        onClick: () => { setEditOldDebt(null); setOldDebtFor(c); },
      },
      {
        label: `Rendre l'excédent (${formatCurrency(st.credit)})`, icon: <Undo2 size={15} />,
        hidden: st.credit <= 0 || !can('clients', 'pay'),
        onClick: () => setRefunding(c),
      },
      {
        label: 'Modifier la fiche', icon: <Pencil size={15} />, hidden: !can('clients', 'edit'),
        onClick: () => { setEditing(c); setFormOpen(true); },
      },
      {
        label: 'Supprimer le client', icon: <Trash2 size={15} />, danger: true,
        hidden: !can('clients', 'delete'),
        onClick: () => setDeleteId(c.id),
      },
    ];
  };

  const columns: DataColumn<Client>[] = [
    {
      key: 'name', label: 'Client',
      render: (c) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-button text-[11px] font-bold text-white">
            {c.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-text-primary">{c.name}</span>
            <span className="block truncate text-[11px] text-text-muted">{c.phone || '—'}</span>
          </span>
        </div>
      ),
    },
    { key: 'address', label: 'Adresse', hideOnMobile: true, render: (c) => c.address || '—' },
    {
      key: 'docs', label: 'Documents', align: 'center', hideOnMobile: true,
      render: (c) => {
        const st = statsOf(c.id);
        return (
          <span className="text-[11px] text-text-muted">
            {st.salesCount} vente(s) · {st.commandsCount} cmd · {st.paymentsCount} vers.
          </span>
        );
      },
    },
    { key: 'total', label: 'Total facturé', align: 'right', render: (c) => formatCurrency(statsOf(c.id).total) },
    {
      key: 'paid', label: 'Encaissé', align: 'right',
      render: (c) => <span className="text-pistachio">{formatCurrency(statsOf(c.id).paid)}</span>,
    },
    {
      key: 'rest', label: 'Solde', align: 'right',
      render: (c) => {
        const bal = statsOf(c.id).balance;
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
      render: (c) => {
        const bal = statsOf(c.id).balance;
        return bal.hasDebt ? (
          <Badge variant="danger" className="text-[10px]"><AlertTriangle size={10} /> Dette</Badge>
        ) : bal.hasCredit ? (
          <Badge variant="success" className="text-[10px]"><PiggyBank size={10} /> Avance</Badge>
        ) : (
          <Badge variant="success" className="text-[10px]"><CheckCircle2 size={10} /> À jour</Badge>
        );
      },
    },
  ];

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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Chiffre d'affaires clients" value={globals.total} format="currency" icon={<Receipt size={22} />} index={0} accent="gold" />
        <StatCard label="Total encaissé" value={globals.paid} format="currency" icon={<CheckCircle2 size={22} />} index={1} accent="pistachio" />
        <StatCard label="Dettes clients" value={globals.rest} format="currency" icon={<TrendingDown size={22} />} index={2} accent="rose" />
        <StatCard label="Avances à rendre" value={globals.credit} format="currency" icon={<PiggyBank size={22} />} index={3} accent="pistachio" />
        <StatCard label="Clients endettés" value={globals.withDebt} icon={<AlertTriangle size={22} />} index={4} accent="caramel" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un client (nom / téléphone / adresse)…" />
        </div>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ClientFilter)}
          options={[
            { value: 'all', label: 'Tous les clients' },
            { value: 'debt', label: 'Avec dette' },
            { value: 'credit', label: 'Avec excédent' },
            { value: 'clear', label: 'Sans dette' },
          ]}
          className="max-w-[200px]"
        />
        <ViewToggle view={view} onChange={setView} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="Aucun client ne correspond à ces filtres" icon={<Users size={32} />} />
      ) : view === 'table' ? (
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(c) => c.id}
          actions={clientActions}
          onRowClick={(c) => setHistory(c)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c, i) => {
            const st = statsOf(c.id);
            const bal = st.balance;
            const hasDebt = bal.hasDebt;
            const hasCredit = bal.hasCredit;
            return (
              <Card
                key={c.id}
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
                    {c.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-display font-semibold text-text-primary">{c.name}</h3>
                    <p className="flex items-center gap-1 truncate text-xs text-text-muted">
                      <Phone size={11} /> {c.phone || '—'}
                    </p>
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
                      <Fig label="Dette totale" value={formatCurrency(st.total)} />
                      <Fig label="Total payé" value={formatCurrency(st.paid)} accent="text-pistachio" />
                      <Fig
                        label={hasCredit ? 'Solde en sa faveur' : 'Reste'}
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
                        {st.salesCount} vente(s) · {st.commandsCount} commande(s)
                        {st.oldDebtsCount > 0 && ` · ${st.oldDebtsCount} ancienne(s) dette(s)`}
                      </span>
                      <span>{st.paymentsCount} versement(s) · {bal.paidPercent.toFixed(0)} %</span>
                    </div>
                  </div>

                  <div className="mt-auto space-y-2">
                    {can('clients', 'pay') && (
                      <Button
                        variant="gold" className="w-full font-bold"
                        onClick={() => setVersing(c)}
                        title="Enregistrer un versement du client"
                      >
                        <HandCoins size={16} />
                        {hasDebt ? `Versement (reste ${formatCurrency(bal.net)})` : 'Versement'}
                      </Button>
                    )}

                    {bal.credit > 0 && can('clients', 'pay') && (
                      <Button
                        variant="mint" className="w-full font-bold"
                        onClick={() => setRefunding(c)}
                        title="Rendre au client l'argent qu'il a versé en trop"
                      >
                        <Undo2 size={16} /> Rendre l&rsquo;excédent ({formatCurrency(bal.credit)})
                      </Button>
                    )}

                    <div className="grid grid-cols-2 gap-1.5">
                      {/* NOUVEAU BOUTON — remplace « Versements (n) » */}
                      <Button
                        size="sm" variant="secondary" className="text-xs"
                        onClick={() => setHistory(c)}
                        title="Tout l'historique du client, opération par opération"
                      >
                        <Layers size={14} /> Historique
                      </Button>
                      <Button
                        size="sm" variant="secondary" className="text-xs"
                        onClick={() => setStatement(c)}
                        title="Compte rendu sur une période"
                      >
                        <FileBarChart size={14} /> Compte rendu
                      </Button>
                    </div>
                    {can('clients', 'create') && (
                      <Button
                        size="sm" variant="secondary" className="w-full text-xs"
                        onClick={() => { setEditOldDebt(null); setOldDebtFor(c); }}
                        title="Saisir une ardoise que le client devait déjà avant le logiciel"
                      >
                        <History size={14} /> Ancienne dette
                        {st.oldDebtsCount > 0 && ` (${st.oldDebtsCount})`}
                      </Button>
                    )}
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

      {/* ---- HISTORIQUE COMPLET (plein écran) ---- */}
      <ClientHistoryScreen
        client={history}
        onClose={() => setHistory(null)}
        onNewVersement={(c) => { setHistory(null); setVersing(c); }}
        onNewOldDebt={(c) => { setHistory(null); setEditOldDebt(null); setOldDebtFor(c); }}
        onEditOldDebt={(c, d) => { setHistory(null); setEditOldDebt(d); setOldDebtFor(c); }}
        onRefund={(c) => { setHistory(null); setRefunding(c); }}
        onStatement={(c) => { setHistory(null); setStatement(c); }}
      />

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
            paid={st.paid + st.credit}
            onSubmit={(amount, notes, paidAt, method) =>
              handleVersement(versing, amount, notes, paidAt, method)}
          />
        );
      })()}

      {/* ---- Ancienne dette (ardoise d'avant le logiciel) ---- */}
      {oldDebtFor && (
        <OldDebtModal
          open={!!oldDebtFor}
          onClose={() => { setOldDebtFor(null); setEditOldDebt(null); }}
          kind="client"
          partyName={oldDebtFor.name}
          initial={editOldDebt}
          onSubmit={(amount, date, description) =>
            handleOldDebt(oldDebtFor, amount, date, description)}
        />
      )}

      {/* ---- Rendre au client l'excédent qu'il a versé ---- */}
      {refunding && (() => {
        const st = statsOf(refunding.id);
        return (
          <RefundCreditModal
            open={!!refunding}
            onClose={() => setRefunding(null)}
            kind="client"
            partyName={refunding.name}
            partyPhone={refunding.phone}
            credit={st.credit}
            onSubmit={(amount, notes, refundedAt, method) =>
              handleRefund(refunding, amount, notes, refundedAt, method)}
          />
        );
      })()}

      {/* ---- Période : compte rendu détaillé ---- */}
      <ClientStatementModal client={statement} onClose={() => setStatement(null)} />

      {/* ---- Ask to print after a payment ---- */}
      <Modal open={!!printPrompt} onClose={() => setPrintPrompt(null)} size="sm">
        <div className="flex flex-col items-center py-2 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-pistachio/15">
            <CheckCircle2 size={30} className="text-pistachio" />
          </div>
          <h3 className="mb-1 font-display text-lg font-semibold text-text-primary">Versement enregistré</h3>
          <p className="mb-1 text-sm text-text-secondary">
            {printPrompt && formatCurrency(printPrompt.payment.amount)} — {printPrompt?.client.name}
          </p>
          <p className="mb-6 text-sm text-text-muted">Voulez-vous imprimer le reçu de versement ?</p>
          <div className="flex w-full gap-3">
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
