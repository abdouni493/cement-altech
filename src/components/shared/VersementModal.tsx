import { useEffect, useState } from 'react';
import {
  Wallet, CalendarClock, ArrowRight, AlertTriangle, Banknote, Landmark, ReceiptText, Hash,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatCurrency, PAYMENT_METHODS } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { PaymentMethod, PaymentMethodDetails } from '@/types';

interface VersementModalProps {
  open: boolean;
  onClose: () => void;
  /** Client par défaut — « supplier » inverse simplement le vocabulaire. */
  kind?: 'client' | 'supplier';
  clientName: string;
  clientPhone?: string;
  /** Situation du tiers, toutes factures / commandes confondues. */
  total: number;
  paid: number;
  /** (montant, note, dateHeure ISO, mode de règlement) */
  onSubmit: (
    amount: number,
    notes: string,
    paidAt: string,
    method: PaymentMethodDetails,
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
 * Versement d'un client — ou règlement d'un fournisseur.
 *
 * L'opérateur saisit librement le montant versé ; il est imputé sur les ventes
 * puis les commandes non soldées (les factures d'achat côté fournisseur) et
 * vient donc DIMINUER la dette totale du tiers. Le versement apparaît ensuite
 * dans son historique, où il peut être imprimé, modifié ou supprimé.
 *
 * Le mode de règlement est enregistré avec le versement : espèces, chèque
 * bancaire (n° de chèque + banque facultatifs) ou virement bancaire
 * (n° de virement + banque facultatifs).
 */
export function VersementModal({
  open, onClose, kind = 'client', clientName, clientPhone, total, paid, onSubmit,
}: VersementModalProps) {
  const isClient = kind === 'client';
  const rest = Math.max(0, total - paid);
  const [amount, setAmount] = useState<number | ''>(rest || '');
  const [notes, setNotes] = useState('');
  const [paidAt, setPaidAt] = useState(nowLocalDateTime());
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [chequeNumber, setChequeNumber] = useState('');
  const [virementNumber, setVirementNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(rest || '');
    setNotes('');
    setPaidAt(nowLocalDateTime());
    setMethod('especes');
    setChequeNumber('');
    setVirementNumber('');
    setBankName('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientName]);

  const value = Number(amount) || 0;
  const newRest = Math.max(0, rest - value);
  const excess = Math.max(0, value - rest);

  const handleSubmit = async () => {
    if (value <= 0) {
      toast.error(isClient ? 'Saisissez le montant versé par le client' : 'Saisissez le montant versé au fournisseur');
      return;
    }
    setSaving(true);
    try {
      await onSubmit(value, notes, new Date(paidAt).toISOString(), {
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

  const quick = [rest, Math.round(rest / 2), 1000, 5000].filter(
    (v, i, arr) => v > 0 && arr.indexOf(v) === i
  );

  return (
    <Modal open={open} onClose={onClose} title={`Versement — ${clientName}`} size="sm">
      <div className="space-y-4">
        {/* Situation du tiers */}
        <div className="rounded-2xl border border-gold/20 bg-gradient-card p-4">
          <p className="text-xs text-text-muted mb-3">
            <span className="font-semibold text-text-primary">{clientName}</span>
            {clientPhone ? ` · ${clientPhone}` : ''}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Figure label="Dette totale" value={formatCurrency(total)} />
            <Figure label={isClient ? 'Déjà versé' : 'Déjà payé'} value={formatCurrency(paid)} accent="text-pistachio" />
            <Figure label="Reste dû" value={formatCurrency(rest)} accent="text-rose-deep" />
          </div>
        </div>

        <Input
          label={isClient ? 'Montant versé par le client (DA) *' : 'Montant versé au fournisseur (DA) *'}
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
          placeholder="Précisions sur ce versement…"
          rows={2}
        />

        {excess > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-caramel/40 bg-caramel/10 px-3.5 py-2.5 text-xs text-caramel">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>
              Le montant dépasse la dette de <strong>{formatCurrency(excess)}</strong>. Le versement
              sera tout de même enregistré {isClient ? 'et encaissé' : 'et décaissé'}, l&rsquo;excédent restera en avance
              sur le compte {isClient ? 'du client' : 'du fournisseur'}.
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
