import { useEffect, useMemo, useState } from 'react';
import {
  Truck, PackageCheck, AlertTriangle, CalendarClock, User, Hash, MapPin, Package, History,
  Percent, Wallet, Receipt, PiggyBank,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, DEFAULT_TVA_RATE } from '@/lib/utils';
import { stockRequirementsForDelivery } from '@/lib/ficheStock';
import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { useStockStore } from '@/store/stockStore';
import { toast } from '@/components/ui/Toast';
import type { Command, DeliveryDriver, DeliveryPayment } from '@/store/commandStore';
import type { CommandDelivery, CommandDeliveryItem } from '@/types';

interface DeliveryModalProps {
  open: boolean;
  command: Command | null;
  /** When set the modal edits this delivery instead of creating a new one. */
  editing?: CommandDelivery | null;
  /** Acompte de la commande encore disponible pour être imputé sur ce bon. */
  advanceAvailable?: number;
  onClose: () => void;
  onSave: (
    items: CommandDeliveryItem[],
    deliveredAt: string,
    notes: string,
    driver: DeliveryDriver,
    payment: DeliveryPayment
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
 * LIVRAISON D'UNE COMMANDE — ET VENTE.
 *
 * Pour chaque produit commandé, l'utilisateur saisit la quantité réellement
 * livrée ; le reste à livrer se recalcule immédiatement. Une commande n'est
 * marquée « livrée » que lorsque toutes les quantités ont été remises.
 *
 * La livraison VAUT VENTE : la valeur de la marchandise remise est facturée
 * (TVA optionnelle), l'opérateur saisit ce que le client paie maintenant et le
 * solde devient une DETTE inscrite sur la fiche du client. Une facture apparaît
 * aussitôt dans « Ventes », dans la caisse et dans les rapports.
 */
export function DeliveryModal({
  open, command, editing, advanceAvailable = 0, onClose, onSave,
}: DeliveryModalProps) {
  const ficheTechnics = useFicheTechnicStore((s) => s.ficheTechnics);
  const products = useStockStore((s) => s.products);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [deliveredAt, setDeliveredAt] = useState(nowLocal());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  /** Chauffeur : par défaut celui de la commande, sinon saisi ici. */
  const [sameDriver, setSameDriver] = useState(true);
  const [driverName, setDriverName] = useState('');
  const [driverPlate, setDriverPlate] = useState('');
  /** Lieu réellement livré — par défaut l'adresse de la commande. */
  const [location, setLocation] = useState('');
  /** TVA de CE bon — par défaut celle de la commande, modifiable. */
  const [tvaEnabled, setTvaEnabled] = useState(false);
  const [tvaRate, setTvaRate] = useState(DEFAULT_TVA_RATE);
  /** Argent réellement encaissé au moment de la remise. */
  const [cashPaid, setCashPaid] = useState(0);
  /** Part de l'acompte de la commande imputée sur ce bon. */
  const [advanceApplied, setAdvanceApplied] = useState(0);
  const isHistorical = !!command?.isHistorical;

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
        init[key] = Math.max(
          0, it.quantity - (it.deliveredQuantity ?? 0) - (it.cancelledQuantity ?? 0)
        );
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
    setLocation(editing?.location ?? command.clientAddress ?? '');

    // TVA : celle du bon en modification, celle de la commande en création
    const tvaOn = editing ? !!editing.tvaEnabled : !!command.tvaEnabled;
    setTvaEnabled(tvaOn);
    setTvaRate(
      (editing?.tvaRate || command.tvaRate || DEFAULT_TVA_RATE) as number
    );
    setCashPaid(editing?.cashPaid ?? 0);
    // L'ACOMPTE DE LA COMMANDE EST IMPUTE D'OFFICE SUR LE BON.
    //
    // C'etait la cause du bug « toutes mes ventes affichent une dette alors
    // que le client a deja tout paye » : le client (souvent un passager)
    // reglait sa commande d'avance, mais le bon de livraison partait avec un
    // acompte impute de 0. La facture engendree naissait donc « non payee »,
    // s'affichait en DETTE dans /ventes et faussait la caisse et les rapports.
    // On propose desormais la totalite de l'acompte encore disponible ;
    // l'operateur peut toujours le reduire s'il ne veut pas l'imputer ici.
    setAdvanceApplied(editing ? (editing.advanceApplied ?? 0) : -1);
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
      // La quantite a laquelle le client a RENONCE n'est plus a livrer.
      const expected = Math.max(0, it.quantity - (it.cancelledQuantity ?? 0));
      const maxNow = Math.max(0, expected - base);
      const remaining = Math.max(0, expected - base - now);
      return { key, item: it, base, now, maxNow, remaining };
    });
  }, [command, quantities, editing]);

  /**
   * Matières premières qui vont réellement quitter « Gestion de stock » quand
   * cette livraison sera validée. La commande, elle, n'a rien entamé : chaque
   * recette est dépliée au prorata de la quantité livrée maintenant.
   * (Le calcul est refait — et appliqué — par la base de données.)
   */
  const requirements = useMemo(() => {
    const lines = rows
      .filter((r) => r.now > 0)
      .map((r) => ({
        ficheTechnicId: r.item.ficheTechnicId,
        productId: r.item.productId,
        productName: r.item.productName,
        quantity: r.now,
      }));
    if (!lines.length) return [];
    return stockRequirementsForDelivery(lines, ficheTechnics, products);
  }, [rows, ficheTechnics, products]);

  const requirementsCost = requirements.reduce((s, r) => s + r.lineCost, 0);
  const shortages = requirements.filter((r) => r.shortage);

  const totalRemaining = rows.reduce((s, r) => s + r.remaining, 0);
  const totalNow = rows.reduce((s, r) => s + r.now, 0);
  /** Valeur marchande de la livraison en cours — reprise sur le bon imprimé. */
  const amountNow = rows.reduce((s, r) => s + r.now * (r.item.unitPrice || 0), 0);
  const amountRemaining = rows.reduce((s, r) => s + r.remaining * (r.item.unitPrice || 0), 0);

  /* ------------------------------------------------------------------------
   *  LA LIVRAISON EST UNE VENTE : valeur HT → TVA → net à payer → reste dû.
   * --------------------------------------------------------------------- */
  const tvaAmount = tvaEnabled ? Math.round(amountNow * tvaRate) / 100 : 0;
  const totalTtc = amountNow + tvaAmount;
  /** Acompte imputable : ce qui reste de l'acompte, plafonné par la facture. */
  const maxAdvance = Math.max(0, Math.min(advanceAvailable, totalTtc));
  /**
   * `-1` signifie « l'operateur n'a rien saisi » : on impute alors tout
   * l'acompte disponible, plafonne par le montant du bon. Des qu'il touche au
   * champ, sa valeur fait foi (0 compris).
   */
  const advanceUsed = advanceApplied < 0
    ? maxAdvance
    : Math.max(0, Math.min(advanceApplied, maxAdvance));
  const maxCash = Math.max(0, totalTtc - advanceUsed);
  const cashUsed = Math.max(0, Math.min(cashPaid, maxCash));
  const paidTotal = advanceUsed + cashUsed;
  const restToPay = Math.max(0, totalTtc - paidTotal);

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
      await onSave(
        items,
        new Date(deliveredAt).toISOString(),
        notes,
        {
          driverName: driverName.trim() || undefined,
          driverPlate: driverPlate.trim() || undefined,
          location: location.trim() || undefined,
        },
        { tvaEnabled, tvaRate, cashPaid: cashUsed, advanceApplied: advanceUsed }
      );
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

          {isHistorical && (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-deep/40 bg-rose-deep/10 px-4 py-3">
              <History size={18} className="shrink-0 mt-0.5 text-rose-deep" />
              <div>
                <p className="text-sm font-bold text-rose-deep">Ancienne livraison</p>
                <p className="text-xs text-text-secondary mt-0.5">
                  Cette commande est une <b>ancienne commande</b> : la livraison est enregistrée pour
                  l'historique et les statistiques uniquement. <b>Aucune matière ne sera retirée du
                  stock</b> et aucune production ne sera lancée.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Date et heure de la livraison"
              type="datetime-local"
              value={deliveredAt}
              onChange={(e) => setDeliveredAt(e.target.value)}
              icon={<CalendarClock size={15} />}
            />
            <Input
              label="Lieu de livraison (localisation)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Ex : Beni Mered, Blida…"
              icon={<MapPin size={15} />}
            />
          </div>

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

          {/* ---- Matières premières déduites du stock par cette livraison ---- */}
          {!isHistorical && (
          <div className="rounded-2xl border border-gold/20 bg-vanilla/30 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/15 bg-gold/8 px-4 py-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-gold-dark flex items-center gap-2">
                <Package size={14} /> Matières déduites du stock par cette livraison
              </p>
              {requirements.length > 0 && (
                <span className="text-xs font-bold tabular text-gold-dark">
                  Coût matière {formatCurrency(requirementsCost)}
                </span>
              )}
            </div>

            {requirements.length === 0 ? (
              <p className="px-4 py-3 text-xs italic text-text-muted">
                Aucune matière à déduire : saisissez une quantité à livrer, ou les produits de cette
                commande ne sont rattachés à aucune fiche technique ni à un produit du stock.
              </p>
            ) : (
              <>
                <p className="px-4 pt-3 text-[11px] italic text-text-muted">
                  La commande n'entame pas le stock. Ces quantités seront retirées de « Gestion de
                  stock » au moment où vous validez la livraison, au prorata des quantités remises.
                </p>
                <div className="overflow-x-auto px-2 pb-2">
                  <table className="w-full text-xs">
                    <thead className="text-text-secondary">
                      <tr>
                        <th className="text-left px-2 py-2">Matière première</th>
                        <th className="text-right px-2 py-2">À déduire</th>
                        <th className="text-right px-2 py-2">Stock actuel</th>
                        <th className="text-right px-2 py-2">Stock après</th>
                        <th className="text-right px-2 py-2">Coût</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requirements.map((r) => {
                        const u = r.unit ? ` ${r.unit}` : '';
                        return (
                          <tr key={r.productId ?? r.productName} className="border-t border-gold/10">
                            <td className="px-2 py-1.5 font-medium text-text-primary">
                              {r.productName}
                              {r.available === undefined && (
                                <span className="ml-1.5 text-[10px] font-semibold text-rose-deep">
                                  (absente du stock)
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular font-semibold text-rose-deep">
                              − {r.quantity}{u}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular text-text-muted">
                              {r.available === undefined ? '—' : `${r.available}${u}`}
                            </td>
                            <td className={`px-2 py-1.5 text-right tabular font-semibold ${r.shortage ? 'text-rose-deep' : 'text-pistachio'}`}>
                              {r.available === undefined
                                ? '—'
                                : `${Math.round((r.available - r.quantity) * 1000) / 1000}${u}`}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular text-gold-dark">
                              {formatCurrency(r.lineCost)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {shortages.length > 0 && (
              <p className="mx-3 mb-3 rounded-xl border border-caramel/40 bg-caramel/10 px-3 py-2 text-[11px] font-semibold text-caramel">
                <AlertTriangle size={12} className="inline mr-1" />
                Stock insuffisant pour {shortages.map((x) => x.productName).join(', ')} — la livraison
                ramènera ces matières à zéro.
              </p>
            )}
          </div>
          )}

          {/* ---- LA LIVRAISON EST UNE VENTE : TVA + encaissement ---- */}
          <div className="rounded-2xl border-2 border-gold/30 bg-gold/5 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/20 bg-gold/10 px-4 py-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-gold-dark flex items-center gap-2">
                <Receipt size={14} /> Facturation de la livraison
              </p>
              <span className="text-[11px] italic text-text-muted">
                Cette livraison crée une vente dans « Ventes », la caisse et les rapports.
              </span>
            </div>

            <div className="p-4 space-y-3">
              {/* TVA activable / désactivable */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tvaEnabled}
                    onChange={(e) => setTvaEnabled(e.target.checked)}
                    className="h-4 w-4 accent-[#B4881B]"
                  />
                  <Percent size={14} className="text-gold-dark" /> Appliquer la TVA sur cette livraison
                </label>
                {tvaEnabled && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" step="any" min={0} max={100}
                      value={tvaRate}
                      onChange={(e) => setTvaRate(Math.max(0, Number(e.target.value)))}
                      className="w-20 h-9 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-center text-sm tabular font-semibold text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold"
                    />
                    <span className="text-sm font-semibold text-text-secondary">%</span>
                    <span className="text-xs text-text-muted">
                      = {formatCurrency(tvaAmount)}
                    </span>
                  </div>
                )}
                {!tvaEnabled && (
                  <span className="text-xs italic text-text-muted">
                    La TVA n'apparaîtra ni sur la facture ni sur le bon imprimé.
                  </span>
                )}
              </div>

              {/* Encaissement */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {maxAdvance > 0 && (
                  <div>
                    <label className="text-xs font-semibold text-text-secondary flex items-center gap-1.5 mb-1">
                      <PiggyBank size={13} className="text-pistachio" />
                      Acompte de la commande à imputer
                      <span className="text-text-muted font-normal">
                        (disponible {formatCurrency(maxAdvance)})
                      </span>
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="number" step="any" min={0} max={maxAdvance}
                        value={advanceUsed}
                        onChange={(e) => setAdvanceApplied(Math.max(0, Number(e.target.value)))}
                        className="flex-1 h-10 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-3 text-sm tabular font-semibold text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold"
                      />
                      <button
                        type="button"
                        onClick={() => setAdvanceApplied(maxAdvance)}
                        className="h-10 px-3 rounded-lg border border-gold/25 text-[11px] font-semibold text-text-muted hover:bg-gold/10 hover:text-gold-dark"
                      >
                        Tout
                      </button>
                    </div>
                    <p className="text-[10px] text-text-muted mt-1">
                      Déjà encaissé à la commande — n'entre pas une seconde fois en caisse.
                    </p>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-text-secondary flex items-center gap-1.5 mb-1">
                    <Wallet size={13} className="text-gold-dark" />
                    Montant payé par le client maintenant
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="number" step="any" min={0} max={maxCash}
                      value={cashPaid}
                      onChange={(e) => setCashPaid(Math.max(0, Number(e.target.value)))}
                      className="flex-1 h-10 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-3 text-sm tabular font-bold text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold"
                    />
                    <button
                      type="button"
                      onClick={() => setCashPaid(maxCash)}
                      className="h-10 px-3 rounded-lg border border-gold/25 text-[11px] font-semibold text-text-muted hover:bg-gold/10 hover:text-gold-dark"
                      title="Le client solde la livraison"
                    >
                      Tout payer
                    </button>
                    <button
                      type="button"
                      onClick={() => setCashPaid(0)}
                      className="h-10 px-3 rounded-lg border border-rose-deep/25 text-[11px] font-semibold text-rose-deep hover:bg-rose-deep/10"
                      title="Livraison entièrement à crédit"
                    >
                      À crédit
                    </button>
                  </div>
                  <p className="text-[10px] text-text-muted mt-1">
                    Cet argent entre en caisse à la date de la livraison.
                  </p>
                </div>
              </div>

              {/* Récapitulatif de la facture générée */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <Money label="Total H.T" value={formatCurrency(amountNow)} />
                <Money
                  label={tvaEnabled ? `TVA ${tvaRate} %` : 'TVA (désactivée)'}
                  value={formatCurrency(tvaAmount)}
                  accent={tvaEnabled ? 'text-gold-dark' : 'text-text-muted'}
                />
                <Money label="Net à payer T.T.C" value={formatCurrency(totalTtc)} accent="text-gold-dark" />
                <Money label="Versement" value={formatCurrency(paidTotal)} accent="text-pistachio" />
                <Money
                  label="Reste (dette client)"
                  value={formatCurrency(restToPay)}
                  accent={restToPay > 0 ? 'text-rose-deep' : 'text-pistachio'}
                />
              </div>

              <div
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs font-semibold ${
                  restToPay > 0
                    ? 'border-rose-deep/40 bg-rose-deep/8 text-rose-deep'
                    : 'border-pistachio/40 bg-pistachio/10 text-pistachio'
                }`}
              >
                {restToPay > 0 ? <AlertTriangle size={15} /> : <PackageCheck size={15} />}
                {restToPay > 0
                  ? `${formatCurrency(restToPay)} resteront dus : le montant sera ajouté à la dette de ${command.clientName} sur sa fiche client.`
                  : 'Cette livraison est intégralement réglée : aucune dette ne sera créée.'}
              </div>
            </div>
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
