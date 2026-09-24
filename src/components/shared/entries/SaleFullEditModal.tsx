import { useEffect, useMemo, useState } from 'react';
import { Trash2, RotateCcw, Info } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { formatCurrency, DEFAULT_TVA_RATE } from '@/lib/utils';
import type { Sale } from '@/types';
import type { SaleLineEdit, UpdateSaleInput } from '@/store/salesStore';

/* ============================================================================
 *  MODIFIER UNE VENTE DE CAISSE EN ENTIER — DEPUIS LE RELEVE
 * ----------------------------------------------------------------------------
 *  Date, lignes (designation, quantite, prix unitaire), reduction, TVA et
 *  montant paye. La base corrige le stock / le comptoir de l'ecart de
 *  quantite puis recalcule total, reste, dette du client et caisse
 *  (update_sale_lines).
 * ========================================================================== */

interface Row extends SaleLineEdit {
  original: number;
  unit?: string;
  removed: boolean;
}

export function SaleFullEditModal({
  sale, onClose, onSave,
}: {
  sale: Sale | null;
  onClose: () => void;
  /** `lines` vide quand aucune ligne n'a change (seul l'en-tete est ecrit). */
  onSave: (lines: SaleLineEdit[], header: UpdateSaleInput) => Promise<void>;
}) {
  const [date, setDate] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [reduction, setReduction] = useState(0);
  const [tvaEnabled, setTvaEnabled] = useState(false);
  const [tvaRate, setTvaRate] = useState(DEFAULT_TVA_RATE);
  const [paid, setPaid] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sale) return;
    setDate(sale.date.slice(0, 10));
    setRows(
      sale.products.map((l) => ({
        lineId: l.lineId ?? '',
        productName: l.productName ?? 'Produit',
        quantity: l.quantity,
        sellingPrice: l.sellingPrice,
        original: l.quantity,
        unit: l.unit,
        removed: false,
      }))
    );
    setReduction(sale.reduction || 0);
    setTvaEnabled(!!sale.tvaEnabled);
    setTvaRate(sale.tvaRate || DEFAULT_TVA_RATE);
    setPaid(sale.paidAmount);
    setNote('');
  }, [sale]);

  const totals = useMemo(() => {
    const total = rows.filter((r) => !r.removed).reduce((s, r) => s + r.quantity * r.sellingPrice, 0);
    const red = Math.min(Math.max(0, reduction), total);
    const base = total - red;
    const tva = tvaEnabled ? Math.round(base * tvaRate) / 100 : 0;
    const final = base + tva;
    return { total, base, tva, final, rest: Math.max(0, final - Math.min(paid, final)) };
  }, [rows, reduction, tvaEnabled, tvaRate, paid]);

  const linesEditable = !!sale && rows.every((r) => r.lineId);
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((list) => list.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const keptCount = rows.filter((r) => !r.removed && r.quantity > 0).length;

  const submit = async () => {
    if (!sale) return;
    const changed = rows.filter((r, i) => {
      const o = sale.products[i];
      return r.removed || r.quantity !== o.quantity || r.sellingPrice !== o.sellingPrice
        || r.productName.trim() !== (o.productName ?? '').trim();
    });
    setSaving(true);
    try {
      await onSave(
        changed.map((r) => ({
          lineId: r.lineId,
          productName: r.productName.trim(),
          quantity: r.removed ? 0 : r.quantity,
          sellingPrice: r.sellingPrice,
        })),
        {
          date, reduction, paidAmount: paid, note: note.trim() || undefined,
          tvaEnabled, tvaRate,
        }
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!sale} onClose={onClose} title={`Modifier la vente ${sale?.reference ?? ''}`} size="lg">
      {sale && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Date de la vente" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input
              label="Réduction (DA)" type="number" step="any" min={0}
              value={reduction} onChange={(e) => setReduction(Math.max(0, Number(e.target.value)))}
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-gold/20">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-vanilla/60 text-[11px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-2 py-2 text-left">Désignation</th>
                  <th className="px-2 py-2 text-right">Quantité</th>
                  <th className="px-2 py-2 text-right">Prix U</th>
                  <th className="px-2 py-2 text-right">Montant</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.lineId || i} className={r.removed ? 'opacity-40' : ''}>
                    <td className="px-2 py-1.5">
                      <input
                        value={r.productName}
                        disabled={r.removed || !linesEditable}
                        onChange={(e) => setRow(i, { productName: e.target.value })}
                        className="h-9 w-full rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-sm font-semibold text-text-primary focus:border-gold focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number" step="any" min={0}
                        value={r.quantity}
                        disabled={r.removed || !linesEditable}
                        onChange={(e) => setRow(i, { quantity: Math.max(0, Number(e.target.value)) })}
                        className="h-9 w-24 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-right text-sm tabular text-text-primary focus:border-gold focus:outline-none"
                      />
                      {r.unit && <span className="ml-1 text-[11px] text-text-muted">{r.unit}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number" step="any" min={0}
                        value={r.sellingPrice}
                        disabled={r.removed || !linesEditable}
                        onChange={(e) => setRow(i, { sellingPrice: Math.max(0, Number(e.target.value)) })}
                        className="h-9 w-28 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-right text-sm tabular text-text-primary focus:border-gold focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-bold tabular text-gold-dark">
                      {formatCurrency(r.removed ? 0 : r.quantity * r.sellingPrice)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {linesEditable && (
                        <button
                          type="button"
                          title={r.removed ? 'Rétablir la ligne' : 'Retirer la ligne'}
                          disabled={!r.removed && keptCount <= 1}
                          onClick={() => setRow(i, { removed: !r.removed })}
                          className="rounded-lg p-1.5 text-text-muted hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-30"
                        >
                          {r.removed ? <RotateCcw size={15} /> : <Trash2 size={15} />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!linesEditable && (
            <p className="flex items-start gap-2 text-[11px] text-text-muted">
              <Info size={13} className="mt-0.5 shrink-0" />
              Rechargez la page pour modifier les lignes de cette vente.
            </p>
          )}
          {!sale.isHistorical && (
            <p className="flex items-start gap-2 rounded-xl border border-gold/20 bg-vanilla/40 px-3 py-2 text-[11px] text-text-muted">
              <Info size={13} className="mt-0.5 shrink-0 text-gold" />
              Une quantité modifiée corrige le stock (ou le comptoir) de l&rsquo;écart : augmentation = sortie de stock,
              diminution = retour en stock.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/20 bg-vanilla/40 px-3 py-2">
            <Switch checked={tvaEnabled} onChange={setTvaEnabled} label="TVA" />
            {tvaEnabled && (
              <label className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
                Taux
                <input
                  type="number" step="any" min={0} max={100} value={tvaRate}
                  onChange={(e) => setTvaRate(Math.max(0, Number(e.target.value)))}
                  className="h-9 w-20 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-center text-sm tabular text-text-primary focus:border-gold focus:outline-none"
                />
                %
              </label>
            )}
          </div>

          <Input
            label="Montant payé (DA)" type="number" step="any" min={0}
            value={paid} onChange={(e) => setPaid(Math.max(0, Number(e.target.value)))}
          />
          <Textarea label="Note (facultatif)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />

          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <Tile label="Total H.T" value={formatCurrency(totals.base)} />
            <Tile label="TVA" value={formatCurrency(totals.tva)} />
            <Tile label="Net à payer" value={formatCurrency(totals.final)} strong />
            <Tile label="Reste" value={formatCurrency(totals.rest)} strong />
          </div>

          <div className="flex gap-2 border-t border-gold/15 pt-4">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Annuler</Button>
            <Button variant="gold" className="flex-1 font-bold" disabled={saving || !date} onClick={() => void submit()}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-gold/20 bg-vanilla/50 px-2 py-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{label}</p>
      <p className={`text-sm font-bold tabular ${strong ? 'text-gold-dark' : 'text-text-primary'}`}>{value}</p>
    </div>
  );
}
