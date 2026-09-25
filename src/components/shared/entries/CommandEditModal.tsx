import { useMemo, useState } from 'react';
import { AlertTriangle, Copy, Plus, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/Toast';
import { useCommandStore, type Command, type CommandItem } from '@/store/commandStore';
import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { formatCurrency, DEFAULT_TVA_RATE } from '@/lib/utils';
import { lineTotal } from '@/lib/commandBilling';

/* ============================================================================
 *  MODIFIER UNE COMMANDE EN ENTIER — depuis le compte rendu du client
 * ----------------------------------------------------------------------------
 *  Dates, adresse, chauffeur, n° de bon, notes, TVA, acompte et LIGNES
 *  (produit, quantite, prix unitaire). Tout part par `update_command()` :
 *  la base revalorise les bons de livraison au nouveau prix, reconstruit leurs
 *  factures, re-repartit l'argent de la commande et recalcule le reste du ;
 *  le compte du client, la caisse et le compte rendu se rechargent ensuite.
 *
 *  Une ligne deja livree ne descend jamais sous la quantite remise et ne peut
 *  pas etre retiree : la marchandise est partie.
 * ========================================================================== */

interface Props {
  command: Command;
  onClose: () => void;
  onSaved?: () => void;
}

export function CommandEditModal({ command, onClose, onSaved }: Props) {
  const updateCommand = useCommandStore((s) => s.updateCommand);
  const deliveriesCount = useCommandStore((s) => s.deliveries.filter((d) => d.commandId === command.id).length);
  const ficheTechnics = useFicheTechnicStore((s) => s.ficheTechnics);

  const [items, setItems] = useState<CommandItem[]>(() =>
    command.items.map((it, i) => ({ ...it, position: it.position ?? i }))
  );
  const linesSum = (list: CommandItem[]) =>
    list.reduce((s, it) => s + lineTotal(it.quantity, it.unitPrice, it.cancelledQuantity), 0);
  // pre-rempli seulement si le total avait VRAIMENT ete ajuste a la main
  const [customTotal, setCustomTotal] = useState<number | null>(() =>
    Math.abs(command.totalAmount - linesSum(command.items)) > 0.004 ? command.totalAmount : null
  );
  const [createdDate, setCreatedDate] = useState(command.createdAt.slice(0, 10));
  const [receiveDate, setReceiveDate] = useState(command.receiveDate || '');
  const [receiveHour, setReceiveHour] = useState(command.receiveHour || '14');
  const [receiveMinute, setReceiveMinute] = useState(command.receiveMinute || '30');
  const [address, setAddress] = useState(command.clientAddress ?? '');
  const [driverName, setDriverName] = useState(command.driverName ?? '');
  const [driverPlate, setDriverPlate] = useState(command.driverPlate ?? '');
  const [bonNumber, setBonNumber] = useState(command.bonNumber ?? '');
  const [notes, setNotes] = useState(command.notes ?? '');
  const [tvaEnabled, setTvaEnabled] = useState(!!command.tvaEnabled);
  const [tvaRate, setTvaRate] = useState(command.tvaRate || DEFAULT_TVA_RATE);
  const [advance, setAdvance] = useState(command.advancePaid ?? 0);
  const [recipe, setRecipe] = useState('');
  const [saving, setSaving] = useState(false);

  const computed = linesSum(items);
  const totalHt = customTotal ?? computed;
  const tva = tvaEnabled ? Math.round(totalHt * tvaRate) / 100 : 0;
  const ttc = totalHt + tva;

  const recipeMatches = useMemo(() => {
    const q = recipe.trim().toLowerCase();
    if (!q) return [];
    return ficheTechnics.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 8);
  }, [recipe, ficheTechnics]);

  /** Toute modification de ligne annule un total ajuste a la main. */
  const editLines = (next: CommandItem[]) => {
    setCustomTotal(null);
    setItems(next.map((it, i) => ({
      ...it, position: i, totalPrice: lineTotal(it.quantity, it.unitPrice, it.cancelledQuantity),
    })));
  };
  const patchLine = (index: number, patch: Partial<CommandItem>) =>
    editLines(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  const addRecipe = (id: string) => {
    const ft = ficheTechnics.find((f) => f.id === id);
    if (!ft) return;
    editLines([
      ...items,
      {
        ficheTechnicId: ft.id, productName: ft.name, quantity: 1, unitPrice: ft.unitPrice,
        totalPrice: ft.unitPrice, sellByUnit: ft.sellByUnit, sellUnit: ft.sellUnit,
      },
    ]);
    setRecipe('');
  };

  const belowDelivered = items.some((it) => it.quantity < (it.deliveredQuantity ?? 0) - 0.0001);
  const valid = items.length > 0 && items.every((it) => it.quantity > 0 && it.unitPrice >= 0)
    && !belowDelivered && advance >= 0 && address.trim().length > 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const originalDay = command.createdAt.slice(0, 10);
      const kept = await updateCommand(command.id, {
        clientId: command.clientId,
        clientName: command.clientName,
        clientPhone: command.clientPhone,
        clientAddress: address.trim(),
        driverName: driverName.trim(),
        driverPlate: driverPlate.trim(),
        bonNumber: bonNumber.trim(),
        notes,
        receiveDate, receiveHour, receiveMinute,
        items,
        // sans total ajuste, la base le recalcule des lignes
        totalAmount: customTotal ?? undefined,
        tvaEnabled,
        tvaRate: tvaEnabled ? tvaRate : 0,
        advancePaid: advance,
        createdAt: createdDate && createdDate !== originalDay
          ? new Date(createdDate + 'T12:00:00').toISOString()
          : undefined,
      });
      if (kept) toast.success('Commande modifiée — bons, factures, reste dû et compte du client recalculés');
      else toast.warning('Commande modifiée — une ligne déjà livrée a été conservée');
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const cell = 'w-full rounded-lg border border-gold/30 bg-[--surface-input] px-2 py-1 text-right text-xs text-text-primary tabular';

  return (
    <Modal open onClose={onClose} title={`Modifier la commande ${command.reference} — ${command.clientName}`} size="xl">
      <div className="space-y-4">
        {deliveriesCount > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-caramel/40 bg-caramel/10 px-3 py-2.5 text-xs text-caramel">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              {deliveriesCount} bon(s) de livraison rattaché(s) : ils seront revalorisés au nouveau prix, leurs
              factures reconstruites, et le reste dû comme le compte du client recalculés. Une ligne déjà livrée ne
              peut pas descendre sous la quantité remise.
            </span>
          </div>
        )}

        {/* ------------------------------------------------------ en-tete -- */}
        <div className="grid grid-cols-1 gap-3 rounded-2xl border border-gold/20 bg-vanilla/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Commande du" type="date" value={createdDate} onChange={(e) => setCreatedDate(e.target.value)} />
          <Input label="Livraison prévue" type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Heure" type="number" min={0} max={23} value={receiveHour}
              onChange={(e) => setReceiveHour(e.target.value.padStart(2, '0').slice(-2))} />
            <Input label="Min" type="number" min={0} max={59} value={receiveMinute}
              onChange={(e) => setReceiveMinute(e.target.value.padStart(2, '0').slice(-2))} />
          </div>
          <Input label="N° de bon (facultatif)" value={bonNumber} onChange={(e) => setBonNumber(e.target.value)} />
          <div className="sm:col-span-2">
            <Input label="Adresse de livraison" value={address} onChange={(e) => setAddress(e.target.value)}
              error={address.trim() ? undefined : "L'adresse est obligatoire"} />
          </div>
          <Input label="Chauffeur" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
          <Input label="Matricule (facultatif)" value={driverPlate} onChange={(e) => setDriverPlate(e.target.value)} />
        </div>

        {/* ------------------------------------------------------- lignes -- */}
        <div className="space-y-2 rounded-2xl border border-gold/20 bg-vanilla/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gold">Produits commandés</h3>
            <div className="relative w-full sm:w-72">
              <Input placeholder="Ajouter un produit…" value={recipe} icon={<Plus size={14} />}
                onChange={(e) => setRecipe(e.target.value)} />
              {recipeMatches.length > 0 && (
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-gold/25 bg-[--surface-dropdown] shadow-lg">
                  {recipeMatches.map((f) => (
                    <button key={f.id} type="button" onClick={() => addRecipe(f.id)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-gold/10">
                      <span className="font-semibold text-text-primary">{f.name}</span>
                      <span className="tabular text-gold-dark">{formatCurrency(f.unitPrice)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gold/15">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-vanilla/60 text-[11px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Produit</th>
                  <th className="px-3 py-2 text-right">Quantité</th>
                  <th className="px-3 py-2 text-right">Livré</th>
                  <th className="px-3 py-2 text-right">Annulé</th>
                  <th className="px-3 py-2 text-right">Prix U</th>
                  <th className="px-3 py-2 text-right">Total H.T</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const delivered = it.deliveredQuantity ?? 0;
                  const locked = delivered > 0.0001;
                  const low = it.quantity < delivered - 0.0001;
                  return (
                    <tr key={it.id ?? `new-${i}`} className="border-t border-gold/10">
                      <td className="px-3 py-1.5">
                        <input value={it.productName} onChange={(e) => patchLine(i, { productName: e.target.value })}
                          className={`${cell} text-left font-semibold`} />
                      </td>
                      <td className="w-24 px-3 py-1.5">
                        <input type="number" step="any" min={delivered || 0.01} value={it.quantity}
                          onChange={(e) => patchLine(i, { quantity: Number(e.target.value) })}
                          className={`${cell} ${low ? 'border-rose-deep text-rose-deep' : ''}`} />
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs tabular text-text-muted">{delivered}</td>
                      <td className="px-3 py-1.5 text-right text-xs tabular text-text-muted">{it.cancelledQuantity ?? 0}</td>
                      <td className="w-28 px-3 py-1.5">
                        <input type="number" step="any" min={0} value={it.unitPrice}
                          onChange={(e) => patchLine(i, { unitPrice: Number(e.target.value) })}
                          className={cell} />
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs font-bold tabular text-gold-dark">
                        {formatCurrency(lineTotal(it.quantity, it.unitPrice, it.cancelledQuantity))}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" title="Même produit à un autre prix"
                            onClick={() => editLines([
                              ...items.slice(0, i + 1),
                              { ...it, id: undefined, deliveredQuantity: 0, cancelledQuantity: 0 },
                              ...items.slice(i + 1),
                            ])}
                            className="rounded-lg p-1 text-gold-dark hover:bg-gold/10">
                            <Copy size={14} />
                          </button>
                          <button type="button" disabled={locked}
                            title={locked ? 'Ligne déjà livrée : elle ne peut pas être retirée' : 'Retirer cette ligne'}
                            onClick={() => editLines(items.filter((_, j) => j !== i))}
                            className="rounded-lg p-1 text-rose-deep hover:bg-rose-deep/10 disabled:opacity-30">
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {belowDelivered && (
            <p className="text-xs font-semibold text-rose-deep">
              Une quantité est inférieure à ce qui a déjà été livré.
            </p>
          )}
        </div>

        {/* ------------------------------------------------ montants -------- */}
        <div className="grid grid-cols-1 gap-3 rounded-2xl border border-gold/20 bg-vanilla/40 p-4 sm:grid-cols-3">
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-text-secondary">Total calculé H.T</p>
            <p className="flex h-10 items-center rounded-xl border border-gold/20 bg-vanilla/60 px-4 text-sm font-bold tabular text-gold">
              {formatCurrency(computed)}
            </p>
          </div>
          <Input label="Ajuster le total H.T (facultatif)" type="number" step="any"
            value={customTotal ?? ''} placeholder={String(computed)}
            onChange={(e) => setCustomTotal(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))} />
          <Input label="Acompte versé à la commande (DA)" type="number" step="any" min={0}
            value={advance} onChange={(e) => setAdvance(Math.max(0, Number(e.target.value)))} />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
            <Switch checked={tvaEnabled} onChange={setTvaEnabled} label="TVA" />
            {tvaEnabled && (
              <div className="w-28">
                <Input type="number" step="any" min={0} value={tvaRate} suffix="%"
                  onChange={(e) => setTvaRate(Math.max(0, Number(e.target.value)))} />
              </div>
            )}
            <div className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span className="text-text-muted">H.T <b className="tabular text-text-primary">{formatCurrency(totalHt)}</b></span>
              {tvaEnabled && <span className="text-text-muted">TVA <b className="tabular text-text-primary">{formatCurrency(tva)}</b></span>}
              <span className="text-text-muted">T.T.C <b className="tabular text-gold-dark">{formatCurrency(ttc)}</b></span>
            </div>
          </div>
          {customTotal !== null && deliveriesCount > 0 && (
            <p className="text-[11px] text-caramel sm:col-span-3">
              Les bons de livraison sont toujours facturés au prix unitaire des lignes : pour qu&rsquo;ils suivent,
              modifiez plutôt le prix unitaire.
            </p>
          )}
        </div>

        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

        <div className="flex gap-2 border-t border-gold/15 pt-4">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Annuler</Button>
          <Button variant="gold" className="flex-1 font-bold" disabled={saving || !valid} onClick={handleSave}>
            {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
