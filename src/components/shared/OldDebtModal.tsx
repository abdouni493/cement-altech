import { useEffect, useState } from 'react';
import { History, Wallet, CalendarDays, Info } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { formatCurrency, todayISO } from '@/lib/utils';
import type { PartyOldDebt, PartyType } from '@/types';

interface OldDebtModalProps {
  open: boolean;
  onClose: () => void;
  kind: PartyType;
  partyName: string;
  /** Ardoise en cours de modification — création quand la valeur est nulle. */
  initial?: PartyOldDebt | null;
  onSubmit: (amount: number, date: string, description: string) => void | Promise<void>;
}

/**
 * ANCIENNE DETTE — l'ardoise d'avant le logiciel.
 *
 * L'opérateur saisit le montant, la description et la date de la dette telle
 * qu'elle existait déjà : ce que le client nous devait, ou ce que nous devions
 * au fournisseur. Elle s'ajoute à sa dette et se règle ensuite par le bouton
 * « Versement » habituel.
 *
 * Aucune écriture de caisse n'est créée ici : aucun argent n'a bougé le jour de
 * la saisie. C'est le règlement de cette ardoise qui alimentera la caisse.
 */
export function OldDebtModal({
  open, onClose, kind, partyName, initial = null, onSubmit,
}: OldDebtModalProps) {
  const isClient = kind === 'client';
  const [amount, setAmount] = useState<number | ''>('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(initial ? initial.amount : '');
    setDate(initial ? initial.date : todayISO());
    setDescription(initial ? initial.description : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, partyName]);

  const value = Number(amount) || 0;
  // On ne peut pas descendre sous ce qui a déjà été réglé sur cette ardoise :
  // la base libèrerait l'excédent, ce qui surprendrait l'opérateur.
  const alreadyPaid = initial?.paidAmount ?? 0;

  const handleSubmit = async () => {
    if (value <= 0) {
      toast.error('Saisissez le montant de l’ancienne dette');
      return;
    }
    if (!description.trim()) {
      toast.error('Décrivez cette ancienne dette (origine, période…)');
      return;
    }
    setSaving(true);
    try {
      await onSubmit(value, date, description.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${initial ? 'Modifier l’ancienne dette' : 'Ancienne dette'} — ${partyName}`}
      size="sm"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-2xl border border-gold/25 bg-gold/5 px-3.5 py-3 text-xs text-text-secondary">
          <History size={16} className="shrink-0 mt-0.5 text-gold-dark" />
          <span>
            {isClient
              ? `Ardoise que ${partyName} devait DÉJÀ avant d’être suivi par le logiciel.`
              : `Somme que l’entreprise devait DÉJÀ à ${partyName} avant d’être suivie par le logiciel.`}{' '}
            Elle s&rsquo;ajoute à sa dette et se règle ensuite par le bouton « Versement ».
          </span>
        </div>

        <Input
          label="Montant de l'ancienne dette (DA) *"
          type="number" step="any" min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
          icon={<Wallet size={15} />}
          autoFocus
        />

        {alreadyPaid > 0 && (
          <p className="text-[11px] text-caramel">
            {formatCurrency(alreadyPaid)} ont déjà été réglés sur cette ardoise. Si vous saisissez
            un montant inférieur, la différence sera automatiquement reportée sur ses autres dettes.
          </p>
        )}

        <Input
          label="Date de la dette *"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          icon={<CalendarDays size={15} />}
        />

        <Textarea
          label="Description *"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={isClient
            ? 'Ex : ardoise 2025 reprise du cahier, livraisons non facturées…'
            : 'Ex : solde du compte 2025 repris du cahier…'}
          rows={3}
        />

        <div className="flex items-start gap-2 rounded-xl border border-caramel/35 bg-caramel/10 px-3.5 py-2.5 text-[11px] text-caramel">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>
            Aucune entrée ni sortie de caisse n&rsquo;est créée : aucun argent ne bouge aujourd&rsquo;hui.
            L&rsquo;ancienne dette apparaît dans l&rsquo;historique, le compte rendu et les rapports ;
            c&rsquo;est son règlement qui alimentera la caisse.
          </span>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-gold/25 bg-vanilla/40 px-4 py-3">
          <span className="text-xs text-text-muted">Dette ajoutée au compte</span>
          <span className="text-lg font-bold tabular text-rose-deep">{formatCurrency(value)}</span>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button variant="gold" onClick={handleSubmit} disabled={saving || value <= 0}>
            {saving ? 'Enregistrement…' : initial ? 'Enregistrer les modifications' : 'Enregistrer l’ancienne dette'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
