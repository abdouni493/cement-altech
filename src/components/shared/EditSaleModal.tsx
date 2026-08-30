import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';
import type { Sale } from '@/types';

/**
 * Modification d'une facture de vente déjà enregistrée (historique client).
 * Seul l'en-tête commercial est modifiable — date, réduction et montant payé :
 * les lignes ont déjà décrémenté le comptoir, elles ne sont pas rejouées.
 * Le reste dû, le statut, l'écriture de caisse et la dette client sont
 * recalculés par la base de données.
 */
export function EditSaleModal({
  sale, onClose, onSave,
}: {
  sale: Sale | null;
  onClose: () => void;
  onSave: (data: { date: string; reduction: number; paidAmount: number; note?: string }) => Promise<void>;
}) {
  const [date, setDate] = useState('');
  const [reduction, setReduction] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sale) return;
    setDate(sale.date.slice(0, 10));
    setReduction(sale.reduction);
    setPaidAmount(sale.paidAmount);
    setNote('');
  }, [sale]);

  const total = sale?.totalAmount ?? 0;
  const finalAmount = Math.max(0, total - Math.min(reduction, total));
  const rest = Math.max(0, finalAmount - Math.min(paidAmount, finalAmount));

  return (
    <Modal open={!!sale} onClose={onClose} title={`Modifier la vente ${sale?.reference ?? ''}`} size="sm">
      <div className="space-y-4">
        <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3.5 py-2.5 text-xs text-text-secondary">
          <div className="flex justify-between">
            <span>Total des articles</span>
            <span className="tabular font-bold text-text-primary">{formatCurrency(total)}</span>
          </div>
          <p className="mt-1 text-[11px] italic text-text-muted">
            Les lignes de la vente ne sont pas modifiables ici : le stock du comptoir a déjà été décrémenté.
          </p>
        </div>

        <Input label="Date de la vente" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input
          label="Réduction (DA)" type="number" step="any" min={0}
          value={reduction} onChange={(e) => setReduction(Math.max(0, Number(e.target.value)))}
        />
        <Input
          label="Montant payé (DA)" type="number" step="any" min={0}
          value={paidAmount} onChange={(e) => setPaidAmount(Math.max(0, Number(e.target.value)))}
        />
        <Textarea label="Note (facultatif)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-gold/15 bg-vanilla/40 p-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wide text-text-muted">Net à payer</p>
            <p className="text-sm font-bold tabular text-gold-dark">{formatCurrency(finalAmount)}</p>
          </div>
          <div className="rounded-xl border border-gold/15 bg-vanilla/40 p-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wide text-text-muted">Reste dû</p>
            <p className={`text-sm font-bold tabular ${rest > 0 ? 'text-rose-deep' : 'text-pistachio'}`}>
              {formatCurrency(rest)}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button
            variant="gold"
            disabled={saving || !date}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({ date, reduction, paidAmount, note: note.trim() || undefined });
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
