import { useEffect, useState } from 'react';
import { Wallet, CalendarClock, ArrowRight } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';

interface PayDebtModalProps {
  open: boolean;
  onClose: () => void;
  reference: string;
  partyName: string;
  total: number;
  paid: number;
  /** (amount, notes, paidAt ISO datetime) */
  onPay: (amount: number, notes: string, paidAt: string) => void | Promise<void>;
  title?: string;
}

/** `YYYY-MM-DDTHH:mm` in local time — the value an <input type="datetime-local"> wants. */
export function nowLocalDateTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Règlement d'une dette.
 *  · rappelle la dette totale, le total déjà payé et le reste,
 *  · l'utilisateur saisit le montant → le nouveau reste se recalcule tout seul,
 *  · la date ET l'heure du règlement sont pré-remplies avec l'instant présent.
 */
export function PayDebtModal({
  open, onClose, reference, partyName, total, paid, onPay, title,
}: PayDebtModalProps) {
  const rest = Math.max(0, total - paid);
  const [amount, setAmount] = useState<number | ''>(rest);
  const [notes, setNotes] = useState('');
  const [paidAt, setPaidAt] = useState(nowLocalDateTime());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(rest);
      setNotes('');
      setPaidAt(nowLocalDateTime());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reference]);

  const value = Number(amount) || 0;
  const newPaid = paid + Math.min(value, rest);
  const newRest = Math.max(0, total - newPaid);

  const handlePay = async () => {
    if (value <= 0) { toast.error('Montant invalide'); return; }
    if (value > rest + 0.001) { toast.error('Le montant dépasse la dette restante'); return; }
    setSaving(true);
    try {
      await onPay(Math.min(value, rest), notes, new Date(paidAt).toISOString());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title || 'Régler la dette'} size="sm">
      <div className="space-y-4">
        {/* Situation */}
        <div className="rounded-2xl border border-gold/20 bg-gradient-card p-4">
          <p className="text-xs text-text-muted mb-3">
            {reference && <span className="font-semibold text-text-primary">{reference} · </span>}
            {partyName}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Figure label="Dette totale" value={formatCurrency(total)} />
            <Figure label="Total payé" value={formatCurrency(paid)} accent="text-pistachio" />
            <Figure label="Reste" value={formatCurrency(rest)} accent="text-rose-deep" />
          </div>
        </div>

        <Input
          label="Montant à payer maintenant (DA)"
          type="number" step="any" min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
          icon={<Wallet size={15} />}
          autoFocus
        />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setAmount(rest)}>
            Tout régler ({formatCurrency(rest)})
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAmount(Math.round(rest / 2))}>
            La moitié
          </Button>
        </div>

        <Input
          label="Date et heure du règlement"
          type="datetime-local"
          value={paidAt}
          onChange={(e) => setPaidAt(e.target.value)}
          icon={<CalendarClock size={15} />}
        />

        <Textarea
          label="Note (optionnel)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Espèces, chèque n°…, virement…"
          rows={2}
        />

        {/* Live recalculation */}
        <div className="flex items-center justify-between rounded-2xl border border-gold/25 bg-gold/5 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="tabular font-semibold text-text-secondary">{formatCurrency(rest)}</span>
            <ArrowRight size={14} className="text-gold" />
            <span>reste après paiement</span>
          </div>
          <span className={`text-lg font-bold tabular ${newRest > 0 ? 'text-rose-deep' : 'text-pistachio'}`}>
            {formatCurrency(newRest)}
          </span>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button variant="gold" onClick={handlePay} disabled={saving || value <= 0}>
            {saving ? 'Enregistrement…' : 'Valider le règlement'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Figure({ label, value, accent = 'text-text-primary' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-vanilla/50 border border-gold/10 px-2.5 py-2 text-center">
      <p className="text-[10px] text-text-muted leading-tight">{label}</p>
      <p className={`text-xs font-bold tabular ${accent} mt-0.5`}>{value}</p>
    </div>
  );
}
