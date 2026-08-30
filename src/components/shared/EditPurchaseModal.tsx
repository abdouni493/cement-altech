import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';
import type { Purchase } from '@/types';

/**
 * Modification d'une facture d'achat déjà enregistrée (historique
 * fournisseur). Seul l'en-tête est modifiable — date, n° de bon de livraison,
 * matricule du chauffeur et montant payé : les lignes ont déjà alimenté le
 * stock, elles ne sont pas rejouées. Le reste dû et l'écriture de caisse sont
 * recalculés par la base de données.
 */
export function EditPurchaseModal({
  purchase, onClose, onSave,
}: {
  purchase: Purchase | null;
  onClose: () => void;
  onSave: (data: {
    date: string; bonNumber: string; driverPlate: string; paidAmount: number; note?: string;
  }) => Promise<void>;
}) {
  const [date, setDate] = useState('');
  const [bonNumber, setBonNumber] = useState('');
  const [driverPlate, setDriverPlate] = useState('');
  const [paidAmount, setPaidAmount] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!purchase) return;
    setDate(purchase.date.slice(0, 10));
    setBonNumber(purchase.bonNumber || '');
    setDriverPlate(purchase.driverPlate || '');
    setPaidAmount(purchase.paidAmount);
    setNote('');
  }, [purchase]);

  const total = purchase?.totalAmount ?? 0;
  const rest = Math.max(0, total - Math.min(paidAmount, total));

  return (
    <Modal open={!!purchase} onClose={onClose} title={`Modifier la facture ${purchase?.reference ?? ''}`} size="sm">
      <div className="space-y-4">
        <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3.5 py-2.5 text-xs text-text-secondary">
          <div className="flex justify-between">
            <span>Total des marchandises</span>
            <span className="tabular font-bold text-text-primary">{formatCurrency(total)}</span>
          </div>
          <p className="mt-1 text-[11px] italic text-text-muted">
            Les lignes de la facture ne sont pas modifiables ici : le stock a déjà été alimenté.
          </p>
        </div>

        <Input label="Date de la facture" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="N° du bon de livraison" value={bonNumber}
            onChange={(e) => setBonNumber(e.target.value)} placeholder="BL-2026-001"
          />
          <Input
            label="Matricule du chauffeur" value={driverPlate}
            onChange={(e) => setDriverPlate(e.target.value.toUpperCase())} placeholder="00123-114-09"
          />
        </div>
        <Input
          label="Montant payé (DA)" type="number" step="any" min={0}
          value={paidAmount} onChange={(e) => setPaidAmount(Math.max(0, Number(e.target.value)))}
        />
        <Textarea label="Note (facultatif)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />

        <div className="rounded-xl border border-gold/15 bg-vanilla/40 p-2.5 text-center">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Reste à payer</p>
          <p className={`text-sm font-bold tabular ${rest > 0 ? 'text-rose-deep' : 'text-pistachio'}`}>
            {formatCurrency(rest)}
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button
            variant="gold"
            disabled={saving || !date}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  date, bonNumber: bonNumber.trim(), driverPlate: driverPlate.trim(),
                  paidAmount, note: note.trim() || undefined,
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
