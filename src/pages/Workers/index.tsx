import { useMemo, useState } from 'react';
import { HardHat, Plus, Eye, Pencil, Shield, Wallet, CalendarX, Banknote, Trash2, Phone, Calendar } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { CreateWorker } from './CreateWorker';
import { WorkerPermissions } from './WorkerPermissions';
import { WorkerAcompte } from './WorkerAcompte';
import { WorkerAbsence } from './WorkerAbsence';
import { WorkerPayment } from './WorkerPayment';
import { useWorkerStore } from '@/store/workerStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { Worker } from '@/types';

type ModalType = 'create' | 'edit' | 'permissions' | 'acompte' | 'absence' | 'payment' | 'view' | null;

export default function WorkersPage() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const { workers, roles, deleteWorker } = useWorkerStore();

  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalType>(null);
  const [active, setActive] = useState<Worker | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name || '—';
  const filtered = useMemo(() => workers.filter((w) => w.fullName.toLowerCase().includes(search.toLowerCase()) || w.phone.includes(search)), [workers, search]);

  const open = (type: ModalType, worker?: Worker) => { setActive(worker || null); setModal(type); };
  const close = () => { setModal(null); setActive(null); };

  return (
    <div>
      <PageHeader title={t('workers')} icon={<HardHat size={24} />} subtitle={`${workers.length} employés`}
        actions={can('workers', 'create') && <Button variant="gold" onClick={() => open('create')}><Plus size={18} /> {t('newWorker')}</Button>} />

      <div className="mb-6 max-w-md"><SearchBar value={search} onChange={setSearch} placeholder={t('search')} /></div>

      {filtered.length === 0 ? <EmptyState message={t('noData')} /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((w, i) => (
            <Card key={w.id} index={i} hoverable className="flex flex-col">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-12 w-12 rounded-full bg-gradient-button flex items-center justify-center text-white font-semibold shadow-gold">{w.fullName.split(' ').map((n) => n[0]).slice(0, 2).join('')}</div>
                <div className="min-w-0">
                  <h3 className="font-display font-semibold text-text-primary truncate">{w.fullName}</h3>
                  <Badge variant="gold">{roleName(w.roleId)}</Badge>
                </div>
              </div>
              <div className="space-y-1 text-sm text-text-muted mb-3">
                <p className="flex items-center gap-1.5"><Phone size={12} /> {w.phone}</p>
                <p className="flex items-center gap-1.5"><Calendar size={12} /> {formatDate(w.startDate, language)}</p>
                {w.paymentEnabled && <p className="flex items-center gap-1.5"><Wallet size={12} /> {formatCurrency(w.paymentAmount)} / {w.paymentType === 'monthly' ? 'mois' : 'jour'}</p>}
              </div>
              <div className="grid grid-cols-3 gap-1.5 mt-auto">
                <ActionBtn icon={<Eye size={13} />} label={t('view')} onClick={() => open('view', w)} />
                {can('workers', 'edit') && <ActionBtn icon={<Pencil size={13} />} label={t('edit')} onClick={() => open('edit', w)} />}
                {can('workers', 'edit') && <ActionBtn icon={<Shield size={13} />} label="Perms" onClick={() => open('permissions', w)} />}
                <ActionBtn icon={<Wallet size={13} />} label="Acomptes" onClick={() => open('acompte', w)} />
                <ActionBtn icon={<CalendarX size={13} />} label="Absences" onClick={() => open('absence', w)} />
                <ActionBtn icon={<Banknote size={13} />} label="Paie" onClick={() => open('payment', w)} />
              </div>
              {can('workers', 'delete') && (
                <Button size="sm" variant="ghost" className="mt-1.5" onClick={() => setDeleteId(w.id)}><Trash2 size={14} className="text-rose-deep" /> {t('delete')}</Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit */}
      <Modal open={modal === 'create' || modal === 'edit'} onClose={close} title={modal === 'edit' ? t('edit') : t('newWorker')} size="lg">
        <CreateWorker initial={modal === 'edit' ? active : null} onClose={close} />
      </Modal>

      {/* Permissions */}
      <Modal open={modal === 'permissions'} onClose={close} title={`${t('permissions')} — ${active?.fullName}`} size="md">
        {active && <WorkerPermissions worker={active} onClose={close} />}
      </Modal>

      {/* Acompte */}
      <Modal open={modal === 'acompte'} onClose={close} title={`${t('acomptes')} — ${active?.fullName}`} size="md">
        {active && <WorkerAcompte worker={active} />}
      </Modal>

      {/* Absence */}
      <Modal open={modal === 'absence'} onClose={close} title={`${t('absences')} — ${active?.fullName}`} size="md">
        {active && <WorkerAbsence worker={active} />}
      </Modal>

      {/* Payment */}
      <Modal open={modal === 'payment'} onClose={close} title={`${t('payment')} — ${active?.fullName}`} size="md">
        {active && <WorkerPayment worker={active} onClose={close} />}
      </Modal>

      {/* View */}
      <Modal open={modal === 'view'} onClose={close} title={active?.fullName} size="md">
        {active && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Detail label={t('role')} value={roleName(active.roleId)} />
              <Detail label={t('phone')} value={active.phone} />
              <Detail label={t('birthday')} value={formatDate(active.birthday, language)} />
              <Detail label={t('idCard')} value={active.idCardNumber || '—'} />
              <Detail label={t('startDate')} value={formatDate(active.startDate, language)} />
              <Detail label={t('salary')} value={active.paymentEnabled ? `${formatCurrency(active.paymentAmount)} / ${active.paymentType === 'monthly' ? 'mois' : 'jour'}` : '—'} />
              {active.hasAccount && <Detail label={t('email')} value={active.email} />}
              {active.hasAccount && <Detail label={t('username')} value={active.username} />}
            </div>
            <div className="grid grid-cols-3 gap-3 pt-2">
              <Detail label={t('acomptes')} value={String(active.acomptes.length)} />
              <Detail label={t('absences')} value={String(active.absences.length)} />
              <Detail label="Paiements" value={String(active.payments.length)} />
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => { if (deleteId) { deleteWorker(deleteId); toast.success('Employé supprimé'); } }} />
    </div>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg bg-vanilla/50 hover:bg-gold/15 text-text-secondary transition-colors text-[11px]">
      {icon}{label}
    </button>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="bg-vanilla/40 rounded-lg px-3 py-2"><p className="text-xs text-text-muted">{label}</p><p className="text-sm font-medium text-text-primary">{value}</p></div>;
}
