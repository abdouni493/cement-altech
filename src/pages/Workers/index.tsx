import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  HardHat, Plus, Eye, Pencil, Shield, Wallet, CalendarX, Banknote, Trash2,
  Phone, Calendar, Clock, History, KeyRound, AlertTriangle, Users, Coins,
  FileBarChart,
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
import { CreateWorker } from './CreateWorker';
import { WorkerPermissions } from './WorkerPermissions';
import { WorkerAcompte } from './WorkerAcompte';
import { WorkerAbsence } from './WorkerAbsence';
import { WorkerPayment } from './WorkerPayment';
import { WorkerOvertime } from './WorkerOvertime';
import { WorkerHistory, type WorkerHistoryTab } from './WorkerHistory';
import { useWorkerStore } from '@/store/workerStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { Worker } from '@/types';

type ModalType =
  | 'create' | 'edit' | 'permissions' | 'acompte' | 'absence'
  | 'payment' | 'overtime' | 'history' | 'view' | null;

type WorkerFilter = 'all' | 'account' | 'noAccount' | 'unpaidOvertime';

export default function WorkersPage() {
  const { language } = useLanguage();
  const { can } = usePermissions();
  const { workers, roles, deleteWorker } = useWorkerStore();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<WorkerFilter>('all');
  const [modal, setModal] = useState<ModalType>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<WorkerHistoryTab>('payments');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // always read the live row so a modal reflects what the database returned
  const active = workers.find((w) => w.id === activeId) || null;
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name || '—';

  const unpaidOvertimeOf = (w: Worker) => {
    const list = (w.overtimes ?? []).filter((o) => !o.isPaid);
    return { count: list.length, amount: list.reduce((s, o) => s + o.amount, 0), hours: list.reduce((s, o) => s + o.hours, 0) };
  };

  const filtered = useMemo(
    () =>
      workers.filter((w) => {
        const q = search.toLowerCase();
        const match = w.fullName.toLowerCase().includes(q) || (w.phone || '').includes(search);
        if (!match) return false;
        if (filter === 'account') return w.hasAccount;
        if (filter === 'noAccount') return !w.hasAccount;
        if (filter === 'unpaidOvertime') return unpaidOvertimeOf(w).count > 0;
        return true;
      }),
    [workers, search, filter]
  );

  const stats = useMemo(() => {
    const monthly = workers
      .filter((w) => w.paymentEnabled && w.paymentType === 'monthly')
      .reduce((s, w) => s + w.paymentAmount, 0);
    const unpaidOvertime = workers.reduce((s, w) => s + unpaidOvertimeOf(w).amount, 0);
    const acomptes = workers.reduce((s, w) => s + w.acomptes.reduce((a, x) => a + x.amount, 0), 0);
    return { count: workers.length, monthly, unpaidOvertime, acomptes };
  }, [workers]);

  const open = (type: ModalType, worker?: Worker, tab: WorkerHistoryTab = 'payments') => {
    setActiveId(worker?.id ?? null);
    setHistoryTab(tab);
    setModal(type);
  };
  const close = () => { setModal(null); setActiveId(null); };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employés"
        icon={<HardHat size={24} />}
        subtitle={`${workers.length} employé(s) · ${formatCurrency(stats.unpaidOvertime)} d'heures supplémentaires à régler`}
        actions={
          can('workers', 'create') && (
            <Button variant="gold" onClick={() => open('create')}>
              <Plus size={18} /> Nouvel employé
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Employés actifs" value={stats.count} icon={<Users size={22} />} index={0} accent="gold" />
        <StatCard label="Masse salariale / mois" value={stats.monthly} format="currency" icon={<Banknote size={22} />} index={1} accent="pistachio" />
        <StatCard label="Heures sup. à payer" value={stats.unpaidOvertime} format="currency" icon={<Clock size={22} />} index={2} accent="caramel" />
        <StatCard label="Acomptes versés" value={stats.acomptes} format="currency" icon={<Coins size={22} />} index={3} accent="lavender" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un employé (nom / téléphone)…" />
        </div>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as WorkerFilter)}
          options={[
            { value: 'all', label: 'Tous les employés' },
            { value: 'account', label: 'Avec compte de connexion' },
            { value: 'noAccount', label: 'Sans compte' },
            { value: 'unpaidOvertime', label: 'Heures sup. non payées' },
          ]}
          className="max-w-[230px]"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="Aucun employé ne correspond à ces filtres" icon={<HardHat size={32} />} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((w, i) => {
            const ot = unpaidOvertimeOf(w);
            return (
              <Card key={w.id} index={i} hoverable className="flex flex-col rounded-2xl p-0 overflow-hidden border border-gold/20">
                {/* Header */}
                <div className="px-4 py-3.5 bg-gold/10 flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-gradient-button flex items-center justify-center text-white font-bold shadow-gold shrink-0">
                    {w.fullName.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display font-semibold text-text-primary truncate">{w.fullName}</h3>
                    <Badge variant="gold" className="mt-0.5">{roleName(w.roleId)}</Badge>
                  </div>
                  {w.hasAccount && (
                    <Badge variant="success" className="gap-1 shrink-0"><KeyRound size={10} /> Compte</Badge>
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col">
                  <div className="space-y-1 text-sm text-text-muted mb-3">
                    <p className="flex items-center gap-1.5"><Phone size={12} /> {w.phone || '—'}</p>
                    <p className="flex items-center gap-1.5"><Calendar size={12} /> Depuis le {formatDate(w.startDate, language)}</p>
                    {w.paymentEnabled && (
                      <p className="flex items-center gap-1.5">
                        <Wallet size={12} /> {formatCurrency(w.paymentAmount)} / {w.paymentType === 'monthly' ? 'mois' : 'jour'}
                      </p>
                    )}
                    {w.hasAccount && w.username && (
                      <p className="flex items-center gap-1.5 text-xs"><KeyRound size={12} /> Identifiant : <span className="font-semibold text-text-secondary">{w.username}</span></p>
                    )}
                  </div>

                  {/* Overtime alert */}
                  {ot.count > 0 && (
                    <motion.div
                      animate={{ opacity: [1, 0.65, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="mb-3 flex items-center gap-2 rounded-xl border border-caramel/40 bg-caramel/10 px-3 py-2 text-xs font-semibold text-caramel"
                    >
                      <AlertTriangle size={14} />
                      {ot.count} h. sup. non payées · {ot.hours.toFixed(2)} h · {formatCurrency(ot.amount)}
                    </motion.div>
                  )}

                  {/* Counters */}
                  <div className="grid grid-cols-4 gap-1.5 mb-3">
                    <Mini label="Acomptes" value={String(w.acomptes.length)} />
                    <Mini label="Absences" value={String(w.absences.length)} />
                    <Mini label="Paiements" value={String(w.payments.length)} />
                    <Mini label="H. sup." value={String((w.overtimes ?? []).length)} />
                  </div>

                  {/* Actions */}
                  <div className="grid grid-cols-3 gap-1.5 mt-auto">
                    <ActionBtn icon={<Eye size={13} />} label="Fiche" onClick={() => open('view', w)} />
                    <ActionBtn icon={<History size={13} />} label="Historique" onClick={() => open('history', w)} />
                    <ActionBtn icon={<FileBarChart size={13} />} label="Rapport" onClick={() => open('history', w, 'report')} />
                    <ActionBtn
                      icon={<Clock size={13} />} label="Heures sup." highlight={ot.count > 0}
                      onClick={() => open('overtime', w)}
                    />
                    <ActionBtn icon={<Wallet size={13} />} label="Acomptes" onClick={() => open('acompte', w)} />
                    <ActionBtn icon={<CalendarX size={13} />} label="Absences" onClick={() => open('absence', w)} />
                    <ActionBtn icon={<Banknote size={13} />} label="Paie" onClick={() => open('payment', w)} />
                    {can('workers', 'edit') && (
                      <ActionBtn icon={<Pencil size={13} />} label="Modifier" onClick={() => open('edit', w)} />
                    )}
                    {can('workers', 'edit') && (
                      <ActionBtn icon={<Shield size={13} />} label="Permissions" onClick={() => open('permissions', w)} />
                    )}
                    {can('workers', 'delete') && (
                      <ActionBtn icon={<Trash2 size={13} className="text-rose-deep" />} label="Supprimer" onClick={() => setDeleteId(w.id)} />
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit */}
      <Modal
        open={modal === 'create' || modal === 'edit'}
        onClose={close}
        title={modal === 'edit' ? `Modifier — ${active?.fullName ?? ''}` : 'Nouvel employé'}
        size="lg"
      >
        <CreateWorker initial={modal === 'edit' ? active : null} onClose={close} />
      </Modal>

      <Modal open={modal === 'permissions'} onClose={close} title={`Permissions — ${active?.fullName ?? ''}`} size="md">
        {active && <WorkerPermissions worker={active} onClose={close} />}
      </Modal>

      <Modal open={modal === 'acompte'} onClose={close} title={`Acomptes — ${active?.fullName ?? ''}`} size="md">
        {active && <WorkerAcompte worker={active} />}
      </Modal>

      <Modal open={modal === 'absence'} onClose={close} title={`Absences — ${active?.fullName ?? ''}`} size="md">
        {active && <WorkerAbsence worker={active} />}
      </Modal>

      <Modal open={modal === 'payment'} onClose={close} title={`Paie — ${active?.fullName ?? ''}`} size="lg">
        {active && <WorkerPayment worker={active} onClose={close} />}
      </Modal>

      <Modal open={modal === 'overtime'} onClose={close} title={`Heures supplémentaires — ${active?.fullName ?? ''}`} size="lg">
        {active && <WorkerOvertime worker={active} />}
      </Modal>

      <Modal open={modal === 'history'} onClose={close} title={`Historique — ${active?.fullName ?? ''}`} size="lg">
        {active && <WorkerHistory worker={active} roleName={roleName(active.roleId)} initialTab={historyTab} />}
      </Modal>

      {/* Fiche */}
      <Modal open={modal === 'view'} onClose={close} title={active?.fullName} size="md">
        {active && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Detail label="Poste" value={roleName(active.roleId)} />
              <Detail label="Téléphone" value={active.phone || '—'} />
              <Detail label="Date de naissance" value={formatDate(active.birthday, language)} />
              <Detail label="Carte d'identité" value={active.idCardNumber || '—'} />
              <Detail label="Date d'embauche" value={formatDate(active.startDate, language)} />
              <Detail
                label="Salaire"
                value={active.paymentEnabled
                  ? `${formatCurrency(active.paymentAmount)} / ${active.paymentType === 'monthly' ? 'mois' : 'jour'}`
                  : '—'}
              />
              {active.hasAccount && <Detail label="Email" value={active.email} />}
              {active.hasAccount && <Detail label="Identifiant" value={active.username} />}
            </div>
            <div className="grid grid-cols-4 gap-3 pt-2">
              <Detail label="Acomptes" value={String(active.acomptes.length)} />
              <Detail label="Absences" value={String(active.absences.length)} />
              <Detail label="Paiements" value={String(active.payments.length)} />
              <Detail label="Heures sup." value={String((active.overtimes ?? []).length)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => { setHistoryTab('payments'); setModal('history'); }}>
                <History size={16} /> Historique complet
              </Button>
              <Button variant="gold" onClick={() => { setHistoryTab('report'); setModal('history'); }}>
                <FileBarChart size={16} /> Créer un rapport
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) void deleteWorker(deleteId).then(() => toast.success('Employé supprimé')); }}
        title="Supprimer l'employé"
        message="Ses acomptes, absences, paiements et heures supplémentaires seront également supprimés."
      />
    </div>
  );
}

function ActionBtn({ icon, label, onClick, highlight }: {
  icon: React.ReactNode; label: string; onClick: () => void; highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-colors text-[10px] font-medium ${
        highlight
          ? 'bg-caramel/15 text-caramel hover:bg-caramel/25'
          : 'bg-vanilla/50 text-text-secondary hover:bg-gold/15'
      }`}
    >
      {icon}{label}
    </button>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-vanilla/40 border border-gold/10 px-1.5 py-1.5 text-center">
      <p className="text-[9px] text-text-muted leading-tight">{label}</p>
      <p className="text-xs font-bold tabular text-text-primary">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-vanilla/40 rounded-lg px-3 py-2 border border-gold/10">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-sm font-medium text-text-primary break-words">{value}</p>
    </div>
  );
}
