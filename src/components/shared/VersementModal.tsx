import { useEffect, useState } from 'react';
import { Wallet, CalendarClock, ArrowRight, AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';

interface VersementModalProps {
  open: boolean;
  onClose: () => void;
  clientName: string;
  clientPhone?: string;
  /** Situation du client, toutes ventes et commandes confondues. */
  total: number;
  paid: number;
  /** (montant, note, dateHeure ISO) */
  onSubmit: (amount: number, notes: string, paidAt: string) => void | Promise<void>;
}

/** `YYYY-MM-DDTHH:mm` en heure locale — la valeur attendue par datetime-local. */
function nowLocalDateTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Versement d'un client.
 *
 * L'opérateur saisit librement le montant versé ; il est imputé sur les ventes
 * puis les commandes non soldées et vient donc DIMINUER la dette totale du
 * client. Le versement apparaît ensuite dans l'historique du client, où il peut
 * être imprimé, modifié ou supprimé.
 */
export function VersementModal({
  open, onClose, clientName, clientPhone, total, paid, onSubmit,
}: VersementModalProps) {
  const rest = Math.max(0, total - paid);
  const [amount, setAmount] = useState<number | ''>(rest || '');
  const [notes, setNotes] = useState('');
  const [paidAt, setPaidAt] = useState(nowLocalDateTime());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(rest || '');
    setNotes('');
    setPaidAt(nowLocalDateTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientName]);

  const value = Number(amount) || 0;
  const newRest = Math.max(0, rest - value);
  const excess = Math.max(0, value - rest);

  const handleSubmit = async () => {
    if (value <= 0) { toast.error('Saisissez le montant versé par le client'); return; }
    setSaving(true);
    try {
      await onSubmit(value, notes, new Date(paidAt).toISOString());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const quick = [rest, Math.round(rest / 2), 1000, 5000].filter(
    (v, i, arr) => v > 0 && arr.indexOf(v) === i
  );

  return (
    <Modal open={open} onClose={onClose} title={`Versement — ${clientName}`} size="sm">
      <div className="space-y-4">
        {/* Situation du client */}
        <div className="rounded-2xl border border-gold/20 bg-gradient-card p-4">
          <p className="text-xs text-text-muted mb-3">
            <span className="font-semibold text-text-primary">{clientName}</span>
            {clientPhone ? ` · ${clientPhone}` : ''}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Figure label="Dette totale" value={formatCurrency(total)} />
            <Figure label="Déjà versé" value={formatCurrency(paid)} accent="text-pistachio" />
            <Figure label="Reste dû" value={formatCurrency(rest)} accent="text-rose-deep" />
          </div>
        </div>

        <Input
          label="Montant versé par le client (DA) *"
          type="number" step="any" min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
          icon={<Wallet size={15} />}
          autoFocus
        />

        {quick.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {quick.map((v, i) => (
              <Button key={v} type="button" variant="secondary" size="sm" onClick={() => setAmount(v)}>
                {i === 0 ? `Tout régler (${formatCurrency(v)})` : formatCurrency(v)}
              </Button>
            ))}
          </div>
        )}

        <Input
          label="Date et heure du versement"
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

        {excess > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-caramel/40 bg-caramel/10 px-3.5 py-2.5 text-xs text-caramel">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>
              Le montant dépasse la dette de <strong>{formatCurrency(excess)}</strong>. Le versement
              sera tout de même enregistré et encaissé, l'excédent restera en avance sur le compte
              du client.
            </span>
          </div>
        )}

        {/* Nouvelle dette après le versement */}
        <div className="flex items-center justify-between rounded-2xl border border-gold/25 bg-gold/5 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="tabular font-semibold text-text-secondary">{formatCurrency(rest)}</span>
            <ArrowRight size={14} className="text-gold" />
            <span>dette après versement</span>
          </div>
          <span className={`text-lg font-bold tabular ${newRest > 0 ? 'text-rose-deep' : 'text-pistachio'}`}>
            {formatCurrency(newRest)}
          </span>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button variant="gold" onClick={handleSubmit} disabled={saving || value <= 0}>
            {saving ? 'Enregistrement…' : 'Enregistrer le versement'}
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
