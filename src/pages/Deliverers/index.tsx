import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bike, Plus, Pencil, Trash2, Phone, MapPin, Printer, Layers,
  CheckCircle2, AlertTriangle, Receipt, TrendingDown, HandCoins, Truck, FileBarChart,
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
import { DelivererHistoryModal } from '@/components/shared/DelivererHistoryModal';
import { DelivererStatementModal } from '@/components/shared/DelivererStatementModal';
import { useDelivererStore } from '@/store/delivererStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency } from '@/lib/utils';
import { printPaymentReceipt } from '@/lib/documents';
import { toast } from '@/components/ui/Toast';
import type { Deliverer, DelivererPayment, PaymentMethodDetails } from '@/types';

type DelivererFilter = 'all' | 'debt' | 'clear';

/** Situation d'un livreur telle qu'affichée sur sa carte et dans le tableau. */
export interface DelivererStats {
  /** Nombre d'achats sur lesquels le livreur est affecté. */
  count: number;
  /** Total des coûts de transport qui lui ont été fixés. */
  total: number;
  /** Payé au livreur (sur les achats + règlements directs). */
  paid: number;
  /** Reste dû au livreur. */
  rest: number;
  paymentsCount: number;
}

const EMPTY_STATS: DelivererStats = {
  count: 0, total: 0, paid: 0, rest: 0, paymentsCount: 0,
};

export default function DeliverersPage() {
  const { can } = usePermissions();
  const {
    deliverers, payments, assignments,
    addDeliverer, updateDeliverer, deleteDeliverer, payDebt,
  } = useDelivererStore();
  const settings = useSettingsStore((s) => s.settings);

  const [view, setView] = useViewMode('deliverers');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<DelivererFilter>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Deliverer | null>(null);
  const [history, setHistory] = useState<Deliverer | null>(null);
  const [statement, setStatement] = useState<Deliverer | null>(null);
  const [paying, setPaying] = useState<Deliverer | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [printPrompt, setPrintPrompt] = useState<{ deliverer: Deliverer; payment: DelivererPayment } | null>(null);

  /** Situation de chaque livreur, calculée une seule fois. */
  const statsById = useMemo(() => {
    const out = new Map<string, DelivererStats>();
    const ensure = (id: string) => {
      let s = out.get(id);
      if (!s) { s = { ...EMPTY_STATS }; out.set(id, s); }
      return s;
    };
    deliverers.forEach((d) => ensure(d.id));
    Object.values(assignments).forEach((a) => {
      if (!a.delivererId) return;
      const s = ensure(a.delivererId);
      s.count += 1;
      s.total += Number(a.cost) || 0;
      s.paid += Number(a.paid) || 0;
    });
    payments.forEach((pay) => {
      const s = ensure(pay.delivererId);
      s.paid += Number(pay.amount) || 0;
      s.paymentsCount += 1;
    });
    out.forEach((s) => { s.rest = Math.max(0, s.total - s.paid); });
    return out;
  }, [deliverers, assignments, payments]);

  const statsOf = (id: string): DelivererStats => statsById.get(id) ?? EMPTY_STATS;

  const filtered = useMemo(
    () =>
      deliverers.filter((d) => {
        const q = search.toLowerCase();
        const match =
          d.name.toLowerCase().includes(q) ||
          (d.phone || '').includes(search) ||
          (d.address || '').toLowerCase().includes(q);
        if (!match) return false;
        const st = statsOf(d.id);
        if (filter === 'debt') return st.rest > 0.004;
        if (filter === 'clear') return st.rest <= 0.004;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deliverers, search, filter, statsById]
  );

  const globals = useMemo(() => {
    let total = 0, paid = 0, rest = 0, withDebt = 0;
    statsById.forEach((s) => {
      total += s.total; paid += s.paid; rest += s.rest;
      if (s.rest > 0.004) withDebt += 1;
    });
    return { total, paid, rest, withDebt };
  }, [statsById]);

  const handleSubmit = async (data: { name: string; phone: string; address: string }) => {
    if (editing) {
      await updateDeliverer(editing.id, data);
      toast.success('Livreur modifié');
    } else {
      await addDeliverer(data);
      toast.success('Livreur créé');
    }
    setFormOpen(false);
    setEditing(null);
  };

  const handlePay = async (
    deliverer: Deliverer, amount: number, notes: string, paidAt: string, method: PaymentMethodDetails,
  ) => {
    const payment = await payDebt(deliverer.id, amount, paidAt, notes, method);
    toast.success('Règlement enregistré — la dette du livreur a été réduite');
    setPaying(null);
    if (payment) setPrintPrompt({ deliverer, payment });
  };

  const doPrintReceipt = (deliverer: Deliverer, payment: DelivererPayment) => {
    const st = statsOf(deliverer.id);
    printPaymentReceipt(
      {
        kind: 'supplier',
        receiptNumber: `RGL-${payment.id.slice(0, 8).toUpperCase()}`,
        partyName: deliverer.name,
        partyPhone: deliverer.phone,
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

  const actionsFor = (d: Deliverer): ActionItem[] => [
    { label: 'Détails & historique', icon: <Layers size={15} />, onClick: () => setHistory(d) },
    { label: 'Compte rendu (période)', icon: <FileBarChart size={15} />, onClick: () => setStatement(d) },
    {
      label: 'Payer la dette', icon: <HandCoins size={15} />, hidden: !can('suppliers', 'pay'),
      onClick: () => setPaying(d),
    },
    {
      label: 'Modifier la fiche', icon: <Pencil size={15} />, hidden: !can('suppliers', 'edit'),
      onClick: () => { setEditing(d); setFormOpen(true); },
    },
    {
      label: 'Supprimer le livreur', icon: <Trash2 size={15} />, danger: true,
      hidden: !can('suppliers', 'delete'),
      onClick: () => setDeleteId(d.id),
    },
  ];

  const columns: DataColumn<Deliverer>[] = [
    {
      key: 'name', label: 'Livreur',
      render: (d) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-button text-[11px] font-bold text-white">
            {d.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-text-primary">{d.name}</span>
            <span className="block truncate text-[11px] text-text-muted">{d.phone || '—'}</span>
          </span>
        </div>
      ),
    },
    { key: 'address', label: 'Adresse', hideOnMobile: true, render: (d) => d.address || '—' },
    {
      key: 'docs', label: 'Opérations', align: 'center', hideOnMobile: true,
      render: (d) => {
        const st = statsOf(d.id);
        return (
          <span className="text-[11px] text-text-muted">
            {st.count} achat(s) · {st.paymentsCount} règlement(s)
          </span>
        );
      },
    },
    { key: 'total', label: 'Total coûts', align: 'right', render: (d) => formatCurrency(statsOf(d.id).total) },
    {
      key: 'paid', label: 'Payé', align: 'right',
      render: (d) => <span className="text-pistachio">{formatCurrency(statsOf(d.id).paid)}</span>,
    },
    {
      key: 'rest', label: 'Reste dû', align: 'right',
      render: (d) => {
        const st = statsOf(d.id);
        return (
          <span className={st.rest > 0.004 ? 'font-bold text-rose-deep' : 'text-pistachio'}>
            {formatCurrency(st.rest)}
          </span>
        );
      },
    },
    {
      key: 'state', label: 'État', align: 'center',
      render: (d) => {
        const st = statsOf(d.id);
        return st.rest > 0.004 ? (
          <Badge variant="danger" className="text-[10px]"><AlertTriangle size={10} /> Dette</Badge>
        ) : (
          <Badge variant="success" className="text-[10px]"><CheckCircle2 size={10} /> À jour</Badge>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Livreurs"
        icon={<Bike size={24} />}
        subtitle={`${deliverers.length} livreur(s) · ${formatCurrency(globals.rest)} de dettes en cours`}
        actions={
          can('suppliers', 'create') && (
            <Button variant="gold" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus size={18} /> Nouveau livreur
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total coûts livreurs" value={globals.total} format="currency" icon={<Receipt size={22} />} index={0} accent="gold" />
        <StatCard label="Total payé" value={globals.paid} format="currency" icon={<CheckCircle2 size={22} />} index={1} accent="pistachio" />
        <StatCard label="Dettes livreurs" value={globals.rest} format="currency" icon={<TrendingDown size={22} />} index={2} accent="rose" />
        <StatCard label="Livreurs à payer" value={globals.withDebt} icon={<AlertTriangle size={22} />} index={3} accent="caramel" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un livreur (nom / téléphone / adresse)…" />
        </div>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as DelivererFilter)}
          options={[
            { value: 'all', label: 'Tous les livreurs' },
            { value: 'debt', label: 'Avec dette' },
            { value: 'clear', label: 'Sans dette' },
          ]}
          className="max-w-[210px]"
        />
        <ViewToggle view={view} onChange={setView} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="Aucun livreur ne correspond à ces filtres" icon={<Bike size={32} />} />
      ) : view === 'table' ? (
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(d) => d.id}
          actions={actionsFor}
          onRowClick={(d) => setHistory(d)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((d, i) => {
            const st = statsOf(d.id);
            const hasDebt = st.rest > 0.004;
            const pct = st.total > 0 ? Math.min(100, (st.paid / st.total) * 100) : 100;
            return (
              <Card
                key={d.id}
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
                    {d.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-display font-semibold text-text-primary">{d.name}</h3>
                    <p className="flex items-center gap-1 truncate text-xs text-text-muted">
                      <Phone size={11} /> {d.phone || '—'}
                    </p>
                    {d.address && (
                      <p className="flex items-center gap-1 truncate text-[11px] text-text-muted">
                        <MapPin size={10} /> {d.address}
                      </p>
                    )}
                  </div>
                  {hasDebt ? (
                    <Badge variant="danger" className="gap-1"><AlertTriangle size={10} /> Dette</Badge>
                  ) : (
                    <Badge variant="success" className="gap-1"><CheckCircle2 size={10} /> À jour</Badge>
                  )}
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-3 rounded-xl border border-gold/15 bg-vanilla/40 p-3">
                    <div className="mb-2.5 grid grid-cols-3 gap-2">
                      <Fig label="Total coûts" value={formatCurrency(st.total)} />
                      <Fig label="Payé" value={formatCurrency(st.paid)} accent="text-pistachio" />
                      <Fig label="Reste" value={formatCurrency(st.rest)} accent={hasDebt ? 'text-rose-deep' : 'text-pistachio'} />
                    </div>
                    <div className="h-2 overflow-hidden rounded-full border border-gold/10 bg-vanilla">
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: pct / 100 }}
                        style={{ transformOrigin: '0% 50%' }}
                        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        className={`h-full w-full rounded-full ${hasDebt ? 'bg-gradient-button' : 'bg-gradient-mint'}`}
                      />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[10px] text-text-muted">
                      <span>{st.count} achat(s)</span>
                      <span>{st.paymentsCount} règlement(s) · {pct.toFixed(0)} %</span>
                    </div>
                  </div>

                  <div className="mt-auto space-y-2">
                    {can('suppliers', 'pay') && (
                      <Button
                        variant="gold" className="w-full font-bold"
                        onClick={() => setPaying(d)}
                        title="Enregistrer un règlement au livreur"
                      >
                        <HandCoins size={16} />
                        {hasDebt ? `Payer la dette (reste ${formatCurrency(st.rest)})` : 'Payer la dette'}
                      </Button>
                    )}

                    <div className="grid grid-cols-2 gap-1.5">
                      <Button
                        size="sm" variant="secondary" className="text-xs"
                        onClick={() => setHistory(d)}
                        title="Toutes les opérations du livreur"
                      >
                        <Layers size={14} /> Historique
                      </Button>
                      <Button
                        size="sm" variant="secondary" className="text-xs"
                        onClick={() => setStatement(d)}
                        title="Compte rendu sur une période (imprimable)"
                      >
                        <FileBarChart size={14} /> Compte rendu
                      </Button>
                    </div>

                    <div className="flex gap-1.5">
                      {can('suppliers', 'edit') && (
                        <Button size="sm" variant="ghost" className="flex-1 text-xs" onClick={() => { setEditing(d); setFormOpen(true); }}>
                          <Pencil size={14} /> Modifier
                        </Button>
                      )}
                      {can('suppliers', 'delete') && (
                        <Button size="sm" variant="ghost" className="flex-1 text-xs" onClick={() => setDeleteId(d.id)}>
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

      {/* ---- Create / edit deliverer ---- */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Modifier le livreur' : 'Nouveau livreur'} size="sm">
        <SupplierForm initial={editing as any} onSubmit={handleSubmit} onCancel={() => setFormOpen(false)} />
      </Modal>

      {/* ---- Détails & historique ---- */}
      <DelivererHistoryModal
        deliverer={history}
        stats={history ? statsOf(history.id) : EMPTY_STATS}
        onClose={() => setHistory(null)}
        onPay={(d) => { setHistory(null); setPaying(d); }}
      />

      {/* ---- Compte rendu sur une période ---- */}
      <DelivererStatementModal deliverer={statement} onClose={() => setStatement(null)} />

      {/* ---- Payer la dette ---- */}
      {paying && (() => {
        const st = statsOf(paying.id);
        return (
          <VersementModal
            open={!!paying}
            onClose={() => setPaying(null)}
            clientName={paying.name}
            clientPhone={paying.phone}
            kind="supplier"
            total={st.total}
            paid={st.paid}
            onSubmit={(amount, notes, paidAt, method) =>
              handlePay(paying, amount, notes, paidAt, method)}
          />
        );
      })()}

      {/* ---- Proposer l'impression du reçu ---- */}
      <Modal open={!!printPrompt} onClose={() => setPrintPrompt(null)} size="sm">
        <div className="flex flex-col items-center py-2 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-pistachio/15">
            <CheckCircle2 size={30} className="text-pistachio" />
          </div>
          <h3 className="mb-1 font-display text-lg font-semibold text-text-primary">Règlement enregistré</h3>
          <p className="mb-1 text-sm text-text-secondary">
            {printPrompt && formatCurrency(printPrompt.payment.amount)} — {printPrompt?.deliverer.name}
          </p>
          <p className="mb-6 text-sm text-text-muted">Voulez-vous imprimer le reçu de règlement ?</p>
          <div className="flex w-full gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setPrintPrompt(null)}>Non, merci</Button>
            <Button
              variant="gold" className="flex-1"
              onClick={() => {
                if (printPrompt) doPrintReceipt(printPrompt.deliverer, printPrompt.payment);
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
        onConfirm={() => { if (deleteId) void deleteDeliverer(deleteId).then(() => toast.success('Livreur supprimé')); }}
        title="Supprimer le livreur"
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
