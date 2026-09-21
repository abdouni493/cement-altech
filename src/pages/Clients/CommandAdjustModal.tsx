import { useEffect, useMemo, useState } from 'react';
import { ScissorsSquare, PlusCircle, AlertTriangle, Package } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { formatCurrency, todayISO } from '@/lib/utils';
import { deliveryStatus, type Command, type AdjustmentInput } from '@/store/commandStore';
import { cn } from '@/lib/utils';

/* ============================================================================
 *  ANNULER LE RESTE  /  AUGMENTER LA COMMANDE
 * ----------------------------------------------------------------------------
 *  Deux situations que l'entreprise rencontre tous les jours, et qui ne doivent
 *  PAS obliger l'operateur a modifier la commande a la main ni a en creer une
 *  seconde :
 *
 *   · ANNULATION — commande de 100 unites, le client s'arrete a 70 et renonce
 *     au reste. L'ecran propose par defaut le reste NON LIVRE de chaque ligne ;
 *     a la validation, la commande est ramenee aux quantites reellement
 *     remises : plus de dette, plus de quantite « en attente de livraison ».
 *
 *   · AUGMENTATION — le client en redemande, qu'il ait atteint ou non le
 *     maximum de sa commande. L'operateur saisit le supplement ligne par ligne ;
 *     le total, la TVA et le reste du suivent immediatement.
 *
 *  Dans les deux cas l'operation est ARCHIVEE : elle apparait dans l'historique
 *  du client et dans une partie dediee du rapport general.
 * ========================================================================== */

export function CommandAdjustModal({
  open, mode, command, onClose, onSubmit,
}: {
  open: boolean;
  mode: 'cancel' | 'increase';
  command: Command | null;
  onClose: () => void;
  onSubmit: (lines: AdjustmentInput[], reason: string, date: string) => Promise<void>;
}) {
  const isCancel = mode === 'cancel';
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !command) return;
    const init: Record<string, number> = {};
    command.items.forEach((it, i) => {
      const key = it.id || String(i);
      const delivered = it.deliveredQuantity ?? 0;
      const cancelled = it.cancelledQuantity ?? 0;
      // Annulation : on propose d'emblee tout le reste non livré.
      init[key] = isCancel ? Math.max(0, it.quantity - delivered - cancelled) : 0;
    });
    setQuantities(init);
    setReason('');
    setDate(todayISO());
  }, [open, command, isCancel]);

  const rows = useMemo(() => {
    if (!command) return [];
    return command.items.map((it, i) => {
      const key = it.id || String(i);
      const delivered = it.deliveredQuantity ?? 0;
      const cancelled = it.cancelledQuantity ?? 0;
      const remaining = Math.max(0, it.quantity - delivered - cancelled);
      const value = Number(quantities[key] ?? 0);
      return { key, item: it, delivered, cancelled, remaining, value };
    });
  }, [command, quantities]);

  const totalQty = rows.reduce((s, r) => s + r.value, 0);
  const totalAmount = rows.reduce((s, r) => s + r.value * (r.item.unitPrice || 0), 0);
  const over = rows.find((r) => isCancel && r.value > r.remaining + 0.0001);

  const submit = async () => {
    if (!command) return;
    if (totalQty <= 0) {
      toast.error(isCancel ? 'Saisissez au moins une quantité à annuler' : 'Saisissez au moins une quantité à ajouter');
      return;
    }
    if (over) {
      toast.error(`« ${over.item.productName} » : on ne peut pas annuler plus que le reste non livré`);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(
        rows
          .filter((r) => r.value > 0)
          .map((r): AdjustmentInput => ({
            commandItemId: r.item.id,
            productName: r.item.productName,
            quantity: r.value,
            unitPrice: r.item.unitPrice,
            unit: r.item.sellByUnit ? r.item.sellUnit : undefined,
          })),
        reason.trim(),
        date
      );
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const st = command ? deliveryStatus(command) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        isCancel
          ? `Annuler le reste — ${command?.reference ?? ''}`
          : `Augmenter la commande — ${command?.reference ?? ''}`
      }
      size="lg"
    >
      {command && st && (
        <div className="space-y-4">
          <div className={cn(
            'flex items-start gap-3 rounded-2xl border px-4 py-3',
            isCancel ? 'border-rose-deep/35 bg-rose-deep/8' : 'border-pistachio/40 bg-pistachio/10'
          )}>
            {isCancel ? <ScissorsSquare size={18} className="mt-0.5 shrink-0 text-rose-deep" />
                      : <PlusCircle size={18} className="mt-0.5 shrink-0 text-pistachio" />}
            <div>
              <p className={cn('text-sm font-bold', isCancel ? 'text-rose-deep' : 'text-pistachio')}>
                {isCancel ? 'Le client renonce au reste de sa commande' : 'Le client demande davantage'}
              </p>
              <p className="mt-0.5 text-xs text-text-secondary">
                {isCancel
                  ? "Les quantités annulées disparaissent du « reste à livrer » ET de la dette du client. "
                    + "La commande passera en « livrée » si plus rien n'est attendu."
                  : "Les quantités ajoutées augmentent la commande, son total et le reste dû. "
                    + 'Aucune nouvelle commande n’est créée.'}
                {' '}L&rsquo;opération est enregistrée dans l&rsquo;historique du client et dans le rapport général.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Commandé" value={String(st.ordered)} />
            <Tile label="Livré" value={String(st.delivered)} color="text-pistachio" />
            <Tile label="Déjà annulé" value={String(st.cancelled)} color="text-rose-deep" />
            <Tile label="Reste à livrer" value={String(st.remaining)} color="text-gold-dark" />
          </div>

          <div className="overflow-x-auto rounded-xl border border-gold/15">
            <table className="w-full text-sm">
              <thead className="bg-vanilla/60 text-text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase">Produit</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase">Commandé</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase">Livré</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase">Reste</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase">Prix U</th>
                  <th className="px-3 py-2 text-center text-[11px] font-bold uppercase">
                    {isCancel ? 'À annuler' : 'À ajouter'}
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase">Valeur</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-gold/10">
                    <td className="px-3 py-2">
                      <span className="font-medium text-text-primary">{r.item.productName}</span>
                      {r.item.sellByUnit && r.item.sellUnit && (
                        <span className="ml-1 text-[11px] text-gold-dark">· {r.item.sellUnit}</span>
                      )}
                      {r.cancelled > 0 && (
                        <Badge variant="danger" className="ml-1.5 text-[9px]">−{r.cancelled} annulé</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular">{r.item.quantity}</td>
                    <td className="px-3 py-2 text-right tabular text-pistachio">{r.delivered}</td>
                    <td className="px-3 py-2 text-right tabular font-semibold text-gold-dark">{r.remaining}</td>
                    <td className="px-3 py-2 text-right tabular">{formatCurrency(r.item.unitPrice)}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number" min={0} step="any"
                        max={isCancel ? r.remaining : undefined}
                        value={r.value || ''}
                        onChange={(e) =>
                          setQuantities((q) => ({ ...q, [r.key]: Math.max(0, Number(e.target.value)) }))}
                        className={cn(
                          'h-9 w-24 rounded-lg border-2 bg-[--surface-input] px-2 text-center text-sm font-semibold tabular text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/30',
                          isCancel && r.value > r.remaining + 0.0001 ? 'border-rose-deep' : 'border-[--border-input] focus:border-gold'
                        )}
                      />
                    </td>
                    <td className={cn(
                      'px-3 py-2 text-right tabular font-bold',
                      isCancel ? 'text-rose-deep' : 'text-pistachio'
                    )}>
                      {r.value > 0 ? `${isCancel ? '−' : '+'}${formatCurrency(r.value * (r.item.unitPrice || 0))}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isCancel && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm" variant="secondary"
                onClick={() =>
                  setQuantities(Object.fromEntries(rows.map((r) => [r.key, r.remaining])))}
              >
                <Package size={14} /> Annuler tout le reste
              </Button>
              <Button
                size="sm" variant="ghost"
                onClick={() => setQuantities(Object.fromEntries(rows.map((r) => [r.key, 0])))}
              >
                Remettre à zéro
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Date de l'opération" type="date"
              value={date} onChange={(e) => setDate(e.target.value)}
            />
            <div className={cn(
              'flex flex-col justify-center rounded-xl border px-4 py-2',
              isCancel ? 'border-rose-deep/30 bg-rose-deep/8' : 'border-pistachio/35 bg-pistachio/10'
            )}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
                {isCancel ? 'Total annulé' : 'Total ajouté'}
              </p>
              <p className={cn('text-base font-bold tabular', isCancel ? 'text-rose-deep' : 'text-pistachio')}>
                {isCancel ? '−' : '+'}{totalQty} unité(s) · {isCancel ? '−' : '+'}{formatCurrency(totalAmount)}
              </p>
            </div>
          </div>

          <Textarea
            label="Motif (facultatif)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={isCancel
              ? "Ex. : le client n'a plus besoin du reste de la commande"
              : 'Ex. : le client a redemandé du béton sur le même chantier'}
          />

          {over && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-deep">
              <AlertTriangle size={14} /> Une quantité dépasse le reste non livré.
            </p>
          )}

          <div className="flex gap-2 border-t border-gold/15 pt-4">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Annuler</Button>
            <Button
              variant={isCancel ? 'rose' : 'mint'}
              className="flex-1 font-bold"
              disabled={saving || totalQty <= 0 || !!over}
              onClick={submit}
            >
              {isCancel ? <ScissorsSquare size={16} /> : <PlusCircle size={16} />}
              {saving ? 'Enregistrement…' : isCancel ? 'Annuler le reste' : 'Augmenter la commande'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Tile({ label, value, color = 'text-text-primary' }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-gold/10 bg-vanilla/40 p-2.5 text-center">
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-base font-bold tabular ${color}`}>{value}</p>
    </div>
  );
}
