import { useEffect, useState } from 'react';
import {
  HandCoins, CalendarClock, ArrowRight, AlertTriangle, Banknote, Landmark, ReceiptText, Hash,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { formatCurrency, PAYMENT_METHODS } from '@/lib/utils';
import type { PaymentMethod, PaymentMethodDetails, PartyType } from '@/types';

interface RefundCreditModalProps {
  open: boolean;
  onClose: () => void;
  kind: PartyType;
  partyName: string;
  partyPhone?: string;
  /** Excédent disponible — le montant rendu ne peut pas le dépasser. */
  credit: number;
  onSubmit: (
    amount: number, notes: string, refundedAt: string, method: PaymentMethodDetails,
  ) => void | Promise<void>;
}

/** `YYYY-MM-DDTHH:mm` en heure locale — la valeur attendue par datetime-local. */
function nowLocalDateTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const METHOD_ICONS: Record<PaymentMethod, typeof Banknote> = {
  especes: Banknote,
  cheque: ReceiptText,
  virement: Landmark,
};

/**
 * RENDRE L'EXCÉDENT — le client a versé PLUS que sa dette, on lui restitue la
 * différence (ou l'on récupère le trop-versé auprès d'un fournisseur).
 *
 * C'est un vrai mouvement d'argent : il apparaît immédiatement dans les
 * transactions de caisse — en SORTIE pour un client, en ENTRÉE pour un
 * fournisseur — puis dans l'historique du tiers, son compte rendu et les
 * rapports.
 */
export function RefundCreditModal({
  open, onClose, kind, partyName, partyPhone, credit, onSubmit,
}: RefundCreditModalProps) {
  const isClient = kind === 'client';
  const [amount, setAmount] = useState<number | ''>(credit || '');
  const [notes, setNotes] = useState('');
  const [refundedAt, setRefundedAt] = useState(nowLocalDateTime());
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [chequeNumber, setChequeNumber] = useState('');
  const [virementNumber, setVirementNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(credit || '');
    setNotes('');
    setRefundedAt(nowLocalDateTime());
    setMethod('especes');
    setChequeNumber('');
    setVirementNumber('');
    setBankName('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partyName, credit]);

  const value = Number(amount) || 0;
  const tooMuch = value > credit + 0.005;
  const remaining = Math.max(0, credit - value);

  const handleSubmit = async () => {
    if (value <= 0) {
      toast.error('Saisissez le montant à rendre');
      return;
    }
    if (tooMuch) {
      toast.error(`Le montant dépasse l'excédent disponible (${formatCurrency(credit)})`);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(value, notes, new Date(refundedAt).toISOString(), {
        method,
        chequeNumber: method === 'cheque' ? chequeNumber.trim() || undefined : undefined,
        virementNumber: method === 'virement' ? virementNumber.trim() || undefined : undefined,
        bankName: method === 'especes' ? undefined : bankName.trim() || undefined,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${isClient ? "Rendre l'excédent" : "Récupérer l'excédent"} — ${partyName}`}
      size="sm"
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-pistachio/35 bg-pistachio/10 p-4">
          <p className="text-xs text-text-muted mb-2">
            <span className="font-semibold text-text-primary">{partyName}</span>
            {partyPhone ? ` · ${partyPhone}` : ''}
          </p>
          <p className="text-xs text-text-secondary">
            {isClient
              ? 'Ce client a versé PLUS que sa dette : l’entreprise lui doit'
              : 'Ce fournisseur a été payé EN TROP : il doit à l’entreprise'}
          </p>
          <p className="text-2xl font-bold tabular text-pistachio mt-1">+ {formatCurrency(credit)}</p>
        </div>

        <Input
          label={isClient ? 'Montant rendu au client (DA) *' : 'Montant récupéré (DA) *'}
          type="number" step="any" min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
          icon={<HandCoins size={15} />}
          autoFocus
        />

        {credit > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setAmount(credit)}>
              Tout rendre ({formatCurrency(credit)})
            </Button>
            {credit > 1 && (
              <Button
                type="button" variant="secondary" size="sm"
                onClick={() => setAmount(Math.round(credit / 2))}
              >
                {formatCurrency(Math.round(credit / 2))}
              </Button>
            )}
          </div>
        )}

        {/* ---- Mode de règlement ---- */}
        <div className="rounded-2xl border border-gold/20 bg-vanilla/40 p-3.5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
            Mode de règlement *
          </p>
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
                label="N° du chèque (optionnel)"
                value={chequeNumber}
                onChange={(e) => setChequeNumber(e.target.value)}
                placeholder="Ex : 4587123"
                icon={<Hash size={15} />}
              />
              <Input
                label="Banque (optionnel)"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Ex : BNA, CPA, BADR…"
                icon={<Landmark size={15} />}
              />
            </div>
          )}

          {method === 'virement' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input
                label="N° du virement (optionnel)"
                value={virementNumber}
                onChange={(e) => setVirementNumber(e.target.value)}
                placeholder="Ex : VIR-2026-0145"
                icon={<Hash size={15} />}
              />
              <Input
                label="Banque (optionnel)"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Ex : BNA, CPA, BADR…"
                icon={<Landmark size={15} />}
              />
            </div>
          )}

          {method === 'especes' && (
            <p className="text-[11px] italic text-text-muted">
              Règlement en espèces — aucune référence bancaire à saisir.
            </p>
          )}
        </div>

        <Input
          label="Date et heure"
          type="datetime-local"
          value={refundedAt}
          onChange={(e) => setRefundedAt(e.target.value)}
          icon={<CalendarClock size={15} />}
        />

        <Textarea
          label="Note (optionnel)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Précisions sur cette restitution…"
          rows={2}
        />

        {tooMuch && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-deep/40 bg-rose-deep/10 px-3.5 py-2.5 text-xs text-rose-deep">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>
              Le montant dépasse l&rsquo;excédent disponible de{' '}
              <strong>{formatCurrency(value - credit)}</strong>. Réduisez-le à{' '}
              {formatCurrency(credit)} au maximum.
            </span>
          </div>
        )}

        <div className="flex items-center justify-between rounded-2xl border border-gold/25 bg-gold/5 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="tabular font-semibold text-text-secondary">{formatCurrency(credit)}</span>
            <ArrowRight size={14} className="text-gold" />
            <span>excédent restant</span>
          </div>
          <span className="text-lg font-bold tabular text-pistachio">{formatCurrency(remaining)}</span>
        </div>

        <p className="text-[11px] italic text-text-muted">
          {isClient
            ? 'Cette restitution est une SORTIE de caisse : elle apparaîtra dans les transactions de caisse et dans les rapports.'
            : 'Cette récupération est une ENTRÉE de caisse : elle apparaîtra dans les transactions de caisse et dans les rapports.'}
        </p>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button variant="gold" onClick={handleSubmit} disabled={saving || value <= 0 || tooMuch}>
            {saving ? 'Enregistrement…' : isClient ? 'Rendre l’excédent' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
