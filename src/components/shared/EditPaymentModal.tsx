import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { PartyPayment } from '@/types';

/** `YYYY-MM-DDTHH:mm` in local time for an <input type="datetime-local">. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Modification d'un règlement déjà enregistré (historique client / fournisseur).
 * L'imputation sur les factures est recalculée côté base de données.
 */
export function EditPaymentModal({
  payment, onClose, onSave,
}: {
  payment: PartyPayment | null;
  onClose: () => void;
  onSave: (amount: number, paidAt: string, notes: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(0);
  const [paidAt, setPaidAt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!payment) return;
    setAmount(payment.amount);
    setPaidAt(toLocalInput(payment.paidAt));
    setNotes(payment.notes || '');
  }, [payment]);

  return (
    <Modal open={!!payment} onClose={onClose} title="Modifier le règlement" size="sm">
      <div className="space-y-4">
        <Input
          label="Montant (DA)" type="number" step="any"
          value={amount} onChange={(e) => setAmount(Number(e.target.value))} autoFocus
        />
        <Input
          label="Date et heure du règlement" type="datetime-local"
          value={paidAt} onChange={(e) => setPaidAt(e.target.value)}
        />
        <Textarea label="Note" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button
            variant="gold"
            disabled={saving || amount <= 0}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(amount, new Date(paidAt).toISOString(), notes);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
