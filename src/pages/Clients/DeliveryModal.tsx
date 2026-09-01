import { useEffect, useMemo, useState } from 'react';
import { Truck, PackageCheck, AlertTriangle, CalendarClock, User, Hash, MapPin } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { Command, DeliveryDriver } from '@/store/commandStore';
import type { CommandDelivery, CommandDeliveryItem } from '@/types';

interface DeliveryModalProps {
  open: boolean;
  command: Command | null;
  /** When set the modal edits this delivery instead of creating a new one. */
  editing?: CommandDelivery | null;
  onClose: () => void;
  onSave: (
    items: CommandDeliveryItem[],
    deliveredAt: string,
    notes: string,
    driver: DeliveryDriver
  ) => Promise<void>;
}

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return nowLocal();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Livraison d'une commande.
 * Pour chaque produit commandé, l'utilisateur saisit la quantité réellement
 * livrée ; le reste à livrer se recalcule immédiatement. Une commande n'est
 * marquée « livrée » que lorsque toutes les quantités ont été remises.
 */
export function DeliveryModal({ open, command, editing, onClose, onSave }: DeliveryModalProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [deliveredAt, setDeliveredAt] = useState(nowLocal());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  /** Chauffeur : par défaut celui de la commande, sinon saisi ici. */
  const [sameDriver, setSameDriver] = useState(true);
  const [driverName, setDriverName] = useState('');
  const [driverPlate, setDriverPlate] = useState('');

  useEffect(() => {
    if (!open || !command) return;
    const init: Record<string, number> = {};
    command.items.forEach((it, idx) => {
      const key = it.id || String(idx);
      if (editing) {
        const line = editing.items.find(
          (l) => (l.commandItemId && l.commandItemId === it.id) || l.productName === it.productName
        );
        init[key] = line?.quantity ?? 0;
      } else {
        // by default we propose the whole remaining quantity
        init[key] = Math.max(0, it.quantity - (it.deliveredQuantity ?? 0));
      }
    });
    setQuantities(init);
    setDeliveredAt(editing ? toLocal(editing.deliveredAt) : nowLocal());
    setNotes(editing?.notes ?? '');

    // Le chauffeur de la commande est proposé par défaut ; l'opérateur peut
    // décocher « même chauffeur » pour en désigner un autre pour ce voyage.
    const cmdName = command.driverName ?? '';
    const cmdPlate = command.driverPlate ?? '';
    const curName = editing?.driverName ?? cmdName;
    const curPlate = editing?.driverPlate ?? cmdPlate;
    setDriverName(curName);
    setDriverPlate(curPlate);
    setSameDriver(
      !!(cmdName || cmdPlate) && curName === cmdName && curPlate === cmdPlate
    );
  }, [open, command, editing]);

  /** Coche « même chauffeur » → on recopie celui de la commande. */
  const toggleSameDriver = (val: boolean) => {
    setSameDriver(val);
    if (val && command) {
      setDriverName(command.driverName ?? '');
      setDriverPlate(command.driverPlate ?? '');
    }
  };

  const rows = useMemo(() => {
    if (!command) return [];
    return command.items.map((it, idx) => {
      const key = it.id || String(idx);
      const alreadyDelivered = it.deliveredQuantity ?? 0;
      // when editing, the line being edited is not part of "already delivered"
      const editedQty = editing
        ? editing.items.find(
            (l) => (l.commandItemId && l.commandItemId === it.id) || l.productName === it.productName
          )?.quantity ?? 0
        : 0;
      const base = Math.max(0, alreadyDelivered - editedQty);
      const now = Number(quantities[key] ?? 0);
      const maxNow = Math.max(0, it.quantity - base);
      const remaining = Math.max(0, it.quantity - base - now);
      return { key, item: it, base, now, maxNow, remaining };
    });
  }, [command, quantities, editing]);

  const totalRemaining = rows.reduce((s, r) => s + r.remaining, 0);
  const totalNow = rows.reduce((s, r) => s + r.now, 0);
  /** Valeur marchande de la livraison en cours — reprise sur le bon imprimé. */
  const amountNow = rows.reduce((s, r) => s + r.now * (r.item.unitPrice || 0), 0);
  const amountRemaining = rows.reduce((s, r) => s + r.remaining * (r.item.unitPrice || 0), 0);

  const handleSave = async () => {
    if (!command) return;
    if (totalNow <= 0) { toast.error('Saisissez au moins une quantité à livrer'); return; }
    const over = rows.find((r) => r.now > r.maxNow + 0.0001);
    if (over) {
      toast.error(`« ${over.item.productName} » : la quantité dépasse le reste à livrer`);
      return;
    }
    setSaving(true);
    try {
      const items: CommandDeliveryItem[] = rows
        .filter((r) => r.now > 0)
        .map((r) => ({
          commandItemId: r.item.id,
          productName: r.item.productName,
          quantity: r.now,
          sellUnit: r.item.sellUnit,
        }));
      await onSave(items, new Date(deliveredAt).toISOString(), notes, {
        driverName: driverName.trim() || undefined,
        driverPlate: driverPlate.trim() || undefined,
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
      title={editing ? `Modifier la livraison ${editing.reference}` : `Livraison — ${command?.reference ?? ''}`}
      size="lg"
    >
      {command && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gold/20 bg-gradient-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-text-muted">Client</p>
              <p className="font-display font-semibold text-text-primary">{command.clientName}</p>
              {command.clientPhone && <p className="text-xs text-text-muted">📞 {command.clientPhone}</p>}
            </div>
            <div className="text-right">
              <p className="text-xs text-text-muted">Total commande</p>
              <p className="text-lg font-bold tabular text-gold-dark">{formatCurrency(command.totalAmount)}</p>
              {command.restAmount > 0 && (
                <p className="text-xs text-rose-deep">Reste à payer {formatCurrency(command.restAmount)}</p>
              )}
            </div>
          </div>

          {command.clientAddress && (
            <div className="flex items-start gap-2 rounded-xl border border-gold/20 bg-vanilla/40 px-3.5 py-2.5 text-xs">
              <MapPin size={14} className="text-gold shrink-0 mt-0.5" />
              <span className="text-text-secondary">
                <span className="font-bold uppercase tracking-wide text-text-muted">Adresse de livraison : </span>
                <span className="font-semibold text-text-primary">{command.clientAddress}</span>
              </span>
            </div>
          )}

          <Input
            label="Date et heure de la livraison"
            type="datetime-local"
            value={deliveredAt}
            onChange={(e) => setDeliveredAt(e.target.value)}
            icon={<CalendarClock size={15} />}
          />

          {/* ---- Chauffeur de cette livraison ---- */}
          <div className="rounded-2xl border border-gold/20 bg-vanilla/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-gold flex items-center gap-2">
                <Truck size={14} /> Chauffeur de la livraison
              </p>
              {(command.driverName || command.driverPlate) && (
                <label className="flex items-center gap-2 text-xs font-semibold text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sameDriver}
                    onChange={(e) => toggleSameDriver(e.target.checked)}
                    className="h-4 w-4 accent-[#B4881B]"
                  />
                  Même chauffeur que la commande
                  <span className="text-text-muted font-normal">
                    ({command.driverName || '—'}
                    {command.driverPlate ? ` · ${command.driverPlate}` : ''})
                  </span>
                </label>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Nom du chauffeur"
                value={driverName}
                onChange={(e) => { setDriverName(e.target.value); setSameDriver(false); }}
                placeholder="Ex : Karim B."
                icon={<User size={15} />}
              />
              <Input
                label="Matricule (facultatif)"
                value={driverPlate}
                onChange={(e) => { setDriverPlate(e.target.value); setSameDriver(false); }}
                placeholder="Ex : 12345-116-09"
                icon={<Hash size={15} />}
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gold/15">
            <table className="w-full text-sm">
              <thead className="bg-vanilla/60 text-text-secondary">
                <tr>
                  <th className="text-left px-3 py-2">Produit</th>
                  <th className="text-center px-3 py-2">Commandé</th>
                  <th className="text-center px-3 py-2">Déjà livré</th>
                  <th className="text-center px-3 py-2">À livrer maintenant</th>
                  <th className="text-center px-3 py-2">Reste après</th>
                  <th className="text-right px-3 py-2">P.U.</th>
                  <th className="text-right px-3 py-2">Montant livré</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const u = r.item.sellUnit ? ` ${r.item.sellUnit}` : '';
                  return (
                    <tr key={r.key} className="border-t border-gold/10">
                      <td className="px-3 py-2 font-medium text-text-primary">{r.item.productName}</td>
                      <td className="px-3 py-2 text-center tabular">{r.item.quantity}{u}</td>
                      <td className="px-3 py-2 text-center tabular text-text-muted">{r.base}{u}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1.5">
                          <input
                            type="number" step="any" min={0} max={r.maxNow}
                            value={r.now}
                            onChange={(e) =>
                              setQuantities((q) => ({ ...q, [r.key]: Math.max(0, Number(e.target.value)) }))
                            }
                            className="w-24 h-9 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-center text-sm tabular font-semibold text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold"
                          />
                          <button
                            type="button"
                            onClick={() => setQuantities((q) => ({ ...q, [r.key]: r.maxNow }))}
                            className="h-9 px-2 rounded-lg border border-gold/25 text-[11px] text-text-muted hover:bg-gold/10 hover:text-gold-dark"
                            title="Livrer tout le reste"
                          >
                            Max
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.remaining > 0 ? (
                          <Badge variant="warning">{r.remaining}{u}</Badge>
                        ) : (
                          <Badge variant="success">Complet</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular text-text-muted">
                        {formatCurrency(r.item.unitPrice || 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular font-bold text-gold-dark">
                        {formatCurrency(r.now * (r.item.unitPrice || 0))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gold/25 bg-vanilla/60">
                  <td className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-text-secondary" colSpan={3}>
                    Totaux de cette livraison
                  </td>
                  <td className="px-3 py-2 text-center tabular font-bold text-text-primary">{totalNow}</td>
                  <td className="px-3 py-2 text-center tabular text-text-muted">{totalRemaining}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular font-bold text-gold-dark">
                    {formatCurrency(amountNow)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Valeur de la livraison — reprise telle quelle sur le bon imprimé */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Money label="Valeur livrée maintenant" value={formatCurrency(amountNow)} accent="text-gold-dark" />
            <Money label="Valeur restant à livrer" value={formatCurrency(amountRemaining)} accent="text-rose-deep" />
            <Money label="Reste à payer sur la commande" value={formatCurrency(command.restAmount)} accent="text-rose-deep" />
          </div>

          <Textarea
            label="Observations (optionnel)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Remarques du client, état de la marchandise…"
            rows={2}
          />

          <div
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
              totalRemaining > 0
                ? 'border-caramel/40 bg-caramel/10 text-caramel'
                : 'border-pistachio/40 bg-pistachio/10 text-pistachio'
            }`}
          >
            {totalRemaining > 0 ? <AlertTriangle size={18} /> : <PackageCheck size={18} />}
            <p className="text-sm font-semibold">
              {totalRemaining > 0
                ? `Après cette livraison il restera ${totalRemaining} article(s) à livrer — la commande restera « partiellement livrée ».`
                : 'Cette livraison solde entièrement la commande.'}
            </p>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
            <Button variant="gold" onClick={handleSave} disabled={saving || totalNow <= 0}>
              <Truck size={16} /> {saving ? 'Enregistrement…' : editing ? 'Mettre à jour la livraison' : 'Valider la livraison'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Money({ label, value, accent = 'text-text-primary' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2.5 text-center">
      <p className="text-[10px] uppercase tracking-wide text-text-muted leading-tight">{label}</p>
      <p className={`text-sm font-bold tabular mt-0.5 ${accent}`}>{value}</p>
    </div>
  );
}
