import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useWorkerStore } from '@/store/workerStore';
import { toast } from '@/components/ui/Toast';
import type { Acompte, Absence, WorkerPaymentRecord } from '@/types';

export type WorkerEntry =
  | { kind: 'acompte'; workerId: string; row: Acompte }
  | { kind: 'absence'; workerId: string; row: Absence }
  | { kind: 'payment'; workerId: string; row: WorkerPaymentRecord };

const TITLES: Record<WorkerEntry['kind'], string> = {
  acompte: "l'acompte",
  absence: "l'absence",
  payment: 'le paiement',
};

/** Boutons Modifier / Supprimer d'une ligne de l'historique d'un employé. */
export function EntryActions({ entry }: { entry: WorkerEntry }) {
  const { deleteAcompte, deleteAbsence, deletePayment } = useWorkerStore();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    try {
      if (entry.kind === 'acompte') await deleteAcompte(entry.workerId, entry.row.id);
      else if (entry.kind === 'absence') await deleteAbsence(entry.workerId, entry.row.id);
      else await deletePayment(entry.workerId, entry.row.id);
      toast.success('Entrée supprimée');
    } catch {
      /* store already showed the error */
    }
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <Button size="icon" variant="ghost" title="Modifier" onClick={() => setEditing(true)}>
        <Pencil size={14} />
      </Button>
      <Button size="icon" variant="ghost" title="Supprimer" onClick={() => setDeleting(true)}>
        <Trash2 size={14} className="text-rose-deep" />
      </Button>
      {editing && <EntryEditModal entry={entry} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => void remove()}
        title={`Supprimer ${TITLES[entry.kind]}`}
        message={
          entry.kind === 'payment' && entry.row.kind === 'overtime'
            ? 'Les heures supplémentaires réglées par ce paiement redeviendront « non payées ».'
            : undefined
        }
      />
    </div>
  );
}

function EntryEditModal({ entry, onClose }: { entry: WorkerEntry; onClose: () => void }) {
  const { updateAcompte, updateAbsence, updatePayment } = useWorkerStore();
  const r = entry.row;
  const [date, setDate] = useState(r.date?.slice(0, 10) ?? '');
  const [amount, setAmount] = useState<number>(
    entry.kind === 'absence' ? entry.row.cost : entry.row.amount
  );
  const [description, setDescription] = useState(r.description ?? '');
  const [period, setPeriod] = useState(entry.kind === 'payment' ? entry.row.period ?? '' : '');
  const [saving, setSaving] = useState(false);

  const isOvertimePayment = entry.kind === 'payment' && entry.row.kind === 'overtime';

  const save = async () => {
    if (entry.kind !== 'absence' && !(Number(amount) > 0)) { toast.error('Montant invalide'); return; }
    if (Number(amount) < 0) { toast.error('Montant invalide'); return; }
    setSaving(true);
    try {
      const value = Number(amount) || 0;
      if (entry.kind === 'acompte') await updateAcompte(r.id, { date, amount: value, description });
      else if (entry.kind === 'absence') await updateAbsence(r.id, { date, cost: value, description });
      else await updatePayment(r.id, { date, amount: value, description, period });
      toast.success('Modification enregistrée');
      onClose();
    } catch {
      /* store already showed the error */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Modifier ${TITLES[entry.kind]}`}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button variant="gold" onClick={save} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input
          label={entry.kind === 'absence' ? 'Coût (DA)' : 'Montant (DA)'}
          type="number" step="any" min={0}
          value={amount}
          disabled={isOvertimePayment}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
        {isOvertimePayment && (
          <p className="text-[11px] text-text-muted">
            Le montant d'un paiement d'heures sup. suit les heures réglées : supprimez-le puis
            réglez à nouveau pour le changer.
          </p>
        )}
        {entry.kind === 'payment' && (
          <Input label="Période" value={period} onChange={(e) => setPeriod(e.target.value)} />
        )}
        <Input
          label={entry.kind === 'absence' ? 'Motif' : 'Description'}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </Modal>
  );
}
