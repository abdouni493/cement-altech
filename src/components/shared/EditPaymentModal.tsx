import { useEffect, useState } from 'react';
import { Hash, Landmark, Banknote, ReceiptText } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PAYMENT_METHODS } from '@/lib/utils';
import type { PartyPayment, PaymentMethod, PaymentMethodDetails } from '@/types';

/** `YYYY-MM-DDTHH:mm` in local time for an <input type="datetime-local">. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const METHOD_ICONS: Record<PaymentMethod, typeof Banknote> = {
  especes: Banknote,
  cheque: ReceiptText,
  virement: Landmark,
};

/**
 * Modification d'un versement déjà enregistré (historique client / fournisseur).
 * Le montant, la date, le mode de règlement et ses références bancaires sont
 * modifiables ; l'imputation sur les factures est recalculée côté base.
 */
export function EditPaymentModal({
  payment, onClose, onSave,
}: {
  payment: PartyPayment | null;
  onClose: () => void;
  onSave: (amount: number, paidAt: string, notes: string, method: PaymentMethodDetails) => Promise<void>;
}) {
  const [amount, setAmount] = useState(0);
  const [paidAt, setPaidAt] = useState('');
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [chequeNumber, setChequeNumber] = useState('');
  const [virementNumber, setVirementNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!payment) return;
    setAmount(payment.amount);
    setPaidAt(toLocalInput(payment.paidAt));
    setNotes(payment.notes || '');
    setMethod(payment.method ?? 'especes');
    setChequeNumber(payment.chequeNumber || '');
    setVirementNumber(payment.virementNumber || '');
    setBankName(payment.bankName || '');
  }, [payment]);

  return (
    <Modal open={!!payment} onClose={onClose} title="Modifier le versement" size="sm">
      <div className="space-y-4">
        <Input
          label="Montant (DA)" type="number" step="any"
          value={amount} onChange={(e) => setAmount(Number(e.target.value))} autoFocus
        />
        <Input
          label="Date et heure du versement" type="datetime-local"
          value={paidAt} onChange={(e) => setPaidAt(e.target.value)}
        />

        {/* ---- Mode de règlement ---- */}
        <div className="rounded-2xl border border-gold/20 bg-vanilla/40 p-3.5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">Mode de règlement</p>
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map((m) => {
              const Icon = METHOD_ICONS[m.value];
              const active = method === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={`flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-2.5 text-[11px] font-bold transition-all ${
                    active
                      ? 'border-gold bg-gold/15 text-gold-dark shadow-sm'
                      : 'border-gold/20 bg-cream text-text-muted hover:border-gold/50 hover:text-text-secondary'
                  }`}
                >
                  <Icon size={17} />
                  <span className="leading-tight text-center">{m.label}</span>
                </button>
              );
            })}
          </div>

          {method === 'cheque' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input
                label="N° du chèque (optionnel)" value={chequeNumber}
                onChange={(e) => setChequeNumber(e.target.value)} icon={<Hash size={15} />}
              />
              <Input
                label="Banque (optionnel)" value={bankName}
                onChange={(e) => setBankName(e.target.value)} icon={<Landmark size={15} />}
              />
            </div>
          )}

          {method === 'virement' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input
                label="N° du virement (optionnel)" value={virementNumber}
                onChange={(e) => setVirementNumber(e.target.value)} icon={<Hash size={15} />}
              />
              <Input
                label="Banque (optionnel)" value={bankName}
                onChange={(e) => setBankName(e.target.value)} icon={<Landmark size={15} />}
              />
            </div>
          )}
        </div>

        <Textarea label="Note" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button
            variant="gold"
            disabled={saving || amount <= 0}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(amount, new Date(paidAt).toISOString(), notes, {
                  method,
                  chequeNumber: method === 'cheque' ? chequeNumber.trim() || undefined : undefined,
                  virementNumber: method === 'virement' ? virementNumber.trim() || undefined : undefined,
                  bankName: method === 'especes' ? undefined : bankName.trim() || undefined,
                });
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
