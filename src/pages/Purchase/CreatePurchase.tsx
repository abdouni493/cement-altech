import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, X, Truck, Package, Wallet, Ruler, Check, FileText, CarFront, History, AlertTriangle, PencilLine, PiggyBank } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { ProductForm } from '@/components/shared/ProductForm';
import { SupplierForm } from '@/components/shared/SupplierForm';
import { useStockStore } from '@/store/stockStore';
import { useSupplierStore } from '@/store/supplierStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { formatCurrency, todayISO } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { PurchaseLine, Product, Purchase } from '@/types';

interface CreatePurchaseProps {
  onClose: () => void;
  onCreated?: (purchase: Purchase) => void;
  /**
   * « Ancien achat » : la facture est saisie a posteriori pour reconstituer
   * l'historique du fournisseur. Même formulaire que l'achat normal, mais les
   * quantités NE SONT PAS ajoutées au stock actuel et la caisse n'est pas
   * mouvementée — seuls le fournisseur, ses dettes et les rapports suivent.
   */
  historical?: boolean;
  /**
   * Facture déjà enregistrée à corriger. Le formulaire s'ouvre pré-rempli et
   * TOUT reste modifiable (fournisseur, date, bon, matricule, lignes,
   * règlement) : à l'enregistrement, le stock alimenté par l'ancienne version
   * est repris puis les nouvelles quantités sont réappliquées.
   */
  editing?: Purchase | null;
}

interface Line extends PurchaseLine {
  _key: string;
  /** Stock réel du produit aujourd'hui, tel qu'il figure dans /stock. */
  stockCurrent: number;
  /** Quantité déjà enregistrée sur cette ligne (0 pour une ligne ajoutée). */
  originalQuantity: number;
}

export function CreatePurchase({ onClose, onCreated, historical = false, editing = null }: CreatePurchaseProps) {
  const products = useStockStore((s) => s.products);
  const addProduct = useStockStore((s) => s.addProduct);
  const { suppliers, addSupplier, applyCreditToPurchase, payDebt: paySupplier } = useSupplierStore();
  const addPurchase = usePurchaseStore((s) => s.addPurchase);
  const updatePurchase = usePurchaseStore((s) => s.updatePurchase);

  const isEdit = !!editing;
  /** Une facture rétroactive le reste quand on la corrige. */
  const isHistorical = editing ? !!editing.isHistorical : historical;

  const [productSearch, setProductSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [date, setDate] = useState(todayISO());
  const [dateTouched, setDateTouched] = useState(false);
  const [driverPlate, setDriverPlate] = useState('');
  const [bonNumber, setBonNumber] = useState('');
  const [showProductForm, setShowProductForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Trop-versé du fournisseur (versé en trop auparavant) utilisé sur cette facture. */
  const [useSupplierCredit, setUseSupplierCredit] = useState(true);
  const [creditInput, setCreditInput] = useState<number | null>(null);

  // ---- Pré-remplissage en modification -----------------------------------
  // La base réconcilie le stock PAR ÉCART (nouvelle quantité − ancienne) : on
  // garde donc le stock réel d'aujourd'hui et la quantité déjà facturée, ce
  // qui suffit à annoncer exactement le stock qui sera obtenu.
  useEffect(() => {
    if (!editing) return;
    setSupplierId(editing.supplierId);
    setSupplierSearch(suppliers.find((s) => s.id === editing.supplierId)?.name || '');
    setDate(editing.date.slice(0, 10));
    setDateTouched(true);
    setBonNumber(editing.bonNumber || '');
    setDriverPlate(editing.driverPlate || '');
    setPaidAmount(editing.paidAmount);
    setLines(
      editing.products.map((l, i) => {
        const prod = products.find((p) => p.id === l.productId);
        return {
          ...l,
          _key: `${l.productId}-${i}`,
          quantity: Number(l.quantity),
          purchasePrice: Number(l.purchasePrice),
          minAlertQuantity: l.minAlertQuantity ?? prod?.minAlertQuantity ?? 0,
          unit: l.unit || prod?.unit || '',
          // Un ancien achat n'a jamais alimenté le stock : son écart est nul.
          originalQuantity: editing.isHistorical ? 0 : Number(l.quantity),
          stockCurrent: prod?.currentQuantity ?? 0,
        };
      })
    );
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.purchasePrice) || 0), 0),
    [lines]
  );

  /* ---- TROP-VERSE DU FOURNISSEUR -------------------------------------------
   * L'entreprise a déjà versé plus que ses factures : ce trop-versé paie la
   * nouvelle facture sans nouvelle sortie de caisse. */
  const supplierCredit = !isEdit && supplierId
    ? Math.max(0, suppliers.find((s) => s.id === supplierId)?.creditAmount ?? 0)
    : 0;
  const creditUsed = useSupplierCredit && supplierCredit > 0
    ? Math.max(0, Math.min(creditInput ?? supplierCredit, supplierCredit, total))
    : 0;
  const dueAfterCredit = Math.max(0, total - creditUsed);
  /** Payé EN PLUS du dû : devient un versement au fournisseur (trop-versé). */
  const overpaid = !isEdit ? Math.max(0, (Number(paidAmount) || 0) - dueAfterCredit) : 0;

  const productResults = useMemo(() => {
    if (!productSearch) return [];
    const s = productSearch.toLowerCase();
    return products
      .filter((p) => p.name.toLowerCase().includes(s) || (p.description || '').toLowerCase().includes(s))
      .slice(0, 8);
  }, [productSearch, products]);

  const supplierResults = useMemo(() => {
    if (!supplierSearch) return [];
    const s = supplierSearch.toLowerCase();
    return suppliers.filter((sup) => sup.name.toLowerCase().includes(s)).slice(0, 6);
  }, [supplierSearch, suppliers]);

  const addLine = (p: Product) => {
    if (lines.some((l) => l.productId === p.id)) {
      toast.warning('Produit déjà ajouté à la facture');
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        _key: p.id + Date.now(),
        productId: p.id,
        productName: p.name,
        quantity: 1,
        minAlertQuantity: p.minAlertQuantity,
        // the price the product is normally bought at — editable per invoice
        purchasePrice: p.purchasePrice,
        unitEnabled: true,
        unit: p.unit || '',
        expirationEnabled: p.expirationEnabled,
        expirationDate: p.expirationDate,
        stockCurrent: p.currentQuantity,
        originalQuantity: 0,
      },
    ]);
    setProductSearch('');
  };

  const updateLine = (key: string, data: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l._key === key ? { ...l, ...data } : l)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l._key !== key));

  const handleProductCreated = async (data: Omit<Product, 'id' | 'createdAt'>) => {
    const p = await addProduct(data);
    addLine(p);
    setShowProductForm(false);
    toast.success('Produit créé et ajouté à la facture');
  };

  const handleSupplierCreated = async (data: { name: string; phone: string; address: string }) => {
    const s = await addSupplier(data);
    setSupplierId(s.id);
    setSupplierSearch(s.name);
    setShowSupplierForm(false);
    toast.success('Fournisseur créé');
  };

  const handleSubmit = async () => {
    if (lines.length === 0) { toast.error('Ajoutez au moins un produit'); return; }
    if (!supplierId) { toast.error('Sélectionnez un fournisseur'); return; }
    if (lines.some((l) => !(Number(l.quantity) > 0))) {
      toast.error('Chaque produit doit avoir une quantité supérieure à 0');
      return;
    }
    if (!date) { toast.error('Choisissez la date de la facture'); return; }
    if (isHistorical && !dateTouched) {
      toast.warning("Indiquez la date d'origine de cet ancien achat");
      return;
    }
    setSaving(true);
    try {
      const payloadLines = lines.map(({ _key, stockCurrent, originalQuantity, ...l }) => ({
        ...l,
        quantity: Number(l.quantity),
        purchasePrice: Number(l.purchasePrice),
      }));

      if (editing) {
        await updatePurchase(editing.id, {
          supplierId,
          date,
          bonNumber: bonNumber.trim(),
          driverPlate: driverPlate.trim(),
          isHistorical,
          products: payloadLines,
          paidAmount: Number(paidAmount),
        });
        toast.success(
          isHistorical
            ? 'Ancien achat modifié — historique du fournisseur mis à jour'
            : 'Facture modifiée — stock, caisse et dette fournisseur recalculés'
        );
        const saved = usePurchaseStore.getState().purchases.find((p) => p.id === editing.id);
        if (saved) onCreated?.(saved);
        onClose();
        return;
      }

      const cash = Math.min(Number(paidAmount) || 0, dueAfterCredit);
      const purchase = await addPurchase({
        supplierId,
        date,
        driverPlate: driverPlate.trim(),
        bonNumber: bonNumber.trim(),
        isHistorical: historical,
        products: payloadLines,
        paidAmount: cash,
      });
      if (creditUsed > 0.004 && purchase?.id) {
        try {
          const applied = await applyCreditToPurchase(purchase.id, creditUsed);
          if (applied > 0) toast.info(`Trop-versé du fournisseur utilisé : ${formatCurrency(applied)}`);
        } catch { /* message déjà affiché */ }
      }
      if (overpaid > 0.004 && !historical) {
        try {
          await paySupplier(
            supplierId, overpaid, new Date(`${date}T12:00:00`).toISOString(),
            `Versé en plus de la facture ${purchase.reference}`, { method: 'especes' }
          );
          toast.info(`${formatCurrency(overpaid)} versés en plus : trop-versé du fournisseur`);
        } catch { /* message déjà affiché */ }
      }
      toast.success(
        historical
          ? "Ancien achat enregistré — stock actuel inchangé, historique du fournisseur mis à jour"
          : 'Facture enregistrée — quantités du stock mises à jour'
      );
      onCreated?.(purchase);
      onClose();
    } catch {
      /* the store already showed the error */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Bandeau « modification » — rappelle ce qui va être recalculé */}
      {isEdit && (
        <div className="rounded-2xl border-2 border-gold/40 bg-gold/10 p-4">
          <p className="flex items-center gap-2 font-display font-bold text-gold-dark">
            <PencilLine size={18} /> Modification de la facture {editing?.reference}
          </p>
          <ul className="mt-2 space-y-1 text-xs font-medium text-text-secondary">
            <li className="flex items-start gap-1.5">
              <Check size={13} className="mt-0.5 shrink-0 text-pistachio" />
              Tout est modifiable : fournisseur, date, bon de livraison, matricule, produits,
              quantités, prix et règlement.
            </li>
            <li className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-caramel" />
              {isHistorical
                ? "Ancien achat : le stock actuel reste inchangé, seuls l'historique et la dette du fournisseur suivent."
                : "Le stock n'est corrigé que de l'écart entre l'ancienne et la nouvelle quantité — la marchandise déjà vendue n'est donc jamais recomptée. La fiche produit, la caisse et la dette du fournisseur suivent."}
            </li>
          </ul>
        </div>
      )}

      {/* Bandeau « ancien achat » — rappelle en permanence que le stock ne bouge pas */}
      {isHistorical && !isEdit && (
        <div className="rounded-2xl border-2 border-caramel/50 bg-caramel/10 p-4">
          <p className="flex items-center gap-2 font-display font-bold text-gold-dark">
            <History size={18} /> Mode « ancien achat » — saisie rétroactive
          </p>
          <ul className="mt-2 space-y-1 text-xs font-medium text-text-secondary">
            <li className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-caramel" />
              Les quantités de cette facture <b>ne seront pas ajoutées au stock actuel</b>.
            </li>
            <li className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-caramel" />
              Aucune écriture de caisse n'est générée : la facture est déjà réglée dans le passé.
            </li>
            <li className="flex items-start gap-1.5">
              <Check size={13} className="mt-0.5 shrink-0 text-pistachio" />
              Elle apparaît dans l'<b>historique et le compte rendu du fournisseur</b> ainsi que dans les
              <b> rapports généraux</b>, à la date que vous indiquez ci-dessous.
            </li>
          </ul>
        </div>
      )}

      {/* 1 — Produits */}
      <section className="bg-vanilla/30 rounded-2xl p-4 border border-gold/15">
        <h3 className="font-display font-semibold text-text-primary mb-3 flex items-center gap-2 text-sm">
          <Package size={16} className="text-gold" /> 1. Produits achetés
        </h3>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Rechercher un produit du stock…"
              className="pl-10"
            />
            {productResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-xl border border-gold/20 bg-[--surface-dropdown] shadow-hover overflow-hidden max-h-64 overflow-y-auto">
                {productResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addLine(p)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gold/10 flex items-center justify-between gap-3 border-b border-gold/5 last:border-0"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-text-primary truncate">{p.name}</span>
                      {p.unit && <Badge variant="warning" className="shrink-0 text-[10px]">{p.unit}</Badge>}
                    </span>
                    <span className="text-text-muted tabular shrink-0 text-xs">
                      {formatCurrency(p.purchasePrice)}{p.unit ? `/${p.unit}` : ''} · stock {p.currentQuantity}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button variant="secondary" onClick={() => setShowProductForm(true)}>
            <Plus size={16} /> Nouveau produit
          </Button>
        </div>

        <div className="space-y-3">
          {lines.map((l) => {
            const qty = Number(l.quantity) || 0;
            const price = Number(l.purchasePrice) || 0;
            const unit = l.unit || '';
            // Écart réellement appliqué au stock par la base : en création la
            // quantité entière, en modification la seule différence.
            const delta = qty - l.originalQuantity;
            const newStock = Math.max(0, l.stockCurrent + delta);
            return (
              <div key={l._key} className="rounded-xl border border-gold/15 bg-gradient-card p-3.5">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary truncate">{l.productName}</p>
                    <p className="text-[11px] text-text-muted flex items-center gap-1.5 mt-0.5">
                      <Ruler size={11} className="text-gold" />
                      Unité du produit :
                      <span className="font-bold text-gold-dark">{unit || 'non définie'}</span>
                      <span className="text-text-muted/70">
                        · stock actuel {l.stockCurrent}{unit ? ` ${unit}` : ''}
                      </span>
                    </p>
                  </div>
                  <button onClick={() => removeLine(l._key)} className="text-rose-deep shrink-0 p-1 rounded-lg hover:bg-rose-deep/10">
                    <X size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <Input
                    label={unit ? `Quantité (${unit})` : 'Quantité'}
                    type="number" step="any" min={0}
                    value={l.quantity}
                    onChange={(e) => updateLine(l._key, { quantity: Number(e.target.value) })}
                  />
                  <Input
                    label={unit ? `Prix pour 1 ${unit} (DA)` : 'Prix unitaire (DA)'}
                    type="number" step="any" min={0}
                    value={l.purchasePrice}
                    onChange={(e) => updateLine(l._key, { purchasePrice: Number(e.target.value) })}
                  />
                  <Input
                    label={unit ? `Seuil d'alerte (${unit})` : "Seuil d'alerte"}
                    type="number" step="any" min={0}
                    value={l.minAlertQuantity}
                    onChange={(e) => updateLine(l._key, { minAlertQuantity: Number(e.target.value) })}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-gold/10">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={!!l.expirationEnabled}
                      onChange={(v) => updateLine(l._key, { expirationEnabled: v })}
                      label="Péremption"
                    />
                    {l.expirationEnabled && (
                      <Input
                        type="date"
                        value={l.expirationDate || ''}
                        onChange={(e) => updateLine(l._key, { expirationDate: e.target.value })}
                        className="max-w-[170px] h-9"
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="text-[10px] text-text-muted leading-none">
                        {isHistorical ? 'Stock actuel' : 'Nouveau stock'}
                      </p>
                      {isHistorical ? (
                        <p className="text-xs font-bold tabular text-caramel">
                          {l.stockCurrent}{unit ? ` ${unit}` : ''} · inchangé
                        </p>
                      ) : (
                        <p className="text-xs font-bold tabular text-pistachio">
                          {l.stockCurrent} {delta < 0 ? '−' : '+'} {Math.abs(delta)} = {newStock}
                          {unit ? ` ${unit}` : ''}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] text-text-muted leading-none">Total ligne</p>
                      <p className="text-sm font-bold tabular text-gold-dark">{formatCurrency(qty * price)}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {lines.length === 0 && (
            <p className="text-sm text-text-muted text-center py-6 rounded-xl border border-dashed border-gold/20">
              Aucun produit sélectionné — recherchez un produit ci-dessus.
            </p>
          )}
        </div>
      </section>

      {/* 2 — Fournisseur */}
      <section className="bg-vanilla/30 rounded-2xl p-4 border border-gold/15">
        <h3 className="font-display font-semibold text-text-primary mb-3 flex items-center gap-2 text-sm">
          <Truck size={16} className="text-gold" /> 2. Fournisseur, date &amp; livraison
          {isHistorical && (
            <Badge variant="warning" className="ml-1 text-[10px]">date d'origine obligatoire</Badge>
          )}
        </h3>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input
              value={supplierSearch}
              onChange={(e) => { setSupplierSearch(e.target.value); setSupplierId(''); }}
              placeholder="Rechercher un fournisseur…"
              className="pl-10"
            />
            {supplierResults.length > 0 && !supplierId && (
              <div className="absolute z-20 mt-1 w-full rounded-xl border border-gold/20 bg-[--surface-dropdown] shadow-hover overflow-hidden">
                {supplierResults.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setSupplierId(s.id); setSupplierSearch(s.name); }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gold/10"
                  >
                    {s.name} {s.phone && <span className="text-text-muted text-xs">· {s.phone}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Input
            type="date"
            value={date}
            max={isHistorical ? todayISO() : undefined}
            onChange={(e) => { setDate(e.target.value); setDateTouched(true); }}
            className={`max-w-[180px] ${isHistorical && !dateTouched ? 'border-caramel' : ''}`}
          />
          <Button variant="secondary" onClick={() => setShowSupplierForm(true)}>
            <Plus size={16} /> Fournisseur
          </Button>
        </div>
        {supplierId && (
          <p className="text-sm text-pistachio mt-2 flex items-center gap-1.5">
            <Check size={15} /> {suppliers.find((s) => s.id === supplierId)?.name}
          </p>
        )}

        {/* Bon de livraison & camion — facultatifs, saisis tels qu'ils figurent sur le bon papier */}
        <div className="mt-4 pt-4 border-t border-gold/10">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2.5 flex items-center gap-1.5">
            <FileText size={12} className="text-gold" /> Bon de livraison &amp; camion
            <span className="normal-case tracking-normal font-medium text-text-muted/70">(facultatif)</span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Input
              label="N° du bon"
              icon={<FileText size={16} />}
              value={bonNumber}
              onChange={(e) => setBonNumber(e.target.value)}
              placeholder="Ex : BL-2026-0142"
            />
            <Input
              label="Matricule du chauffeur"
              icon={<CarFront size={16} />}
              value={driverPlate}
              onChange={(e) => setDriverPlate(e.target.value.toUpperCase())}
              placeholder="Ex : 09876-114-09"
              className="uppercase tabular"
            />
          </div>
        </div>
      </section>

      {/* 3 — Paiement */}
      <section className="bg-vanilla/30 rounded-2xl p-4 border border-gold/15">
        <h3 className="font-display font-semibold text-text-primary mb-3 flex items-center gap-2 text-sm">
          <Wallet size={16} className="text-gold" /> 3. Paiement
        </h3>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[150px]">
            <p className="text-xs text-text-muted">Total de la facture</p>
            <p className="text-2xl font-bold text-gold-dark tabular">{formatCurrency(total)}</p>
          </div>
          <Input
            label="Montant payé (DA)"
            type="number" step="any" min={0}
            value={paidAmount}
            onChange={(e) => setPaidAmount(Number(e.target.value))}
            className="max-w-[180px]"
          />
          <Button variant="secondary" size="sm" onClick={() => setPaidAmount(isEdit ? total : dueAfterCredit)}>Tout payer</Button>
          <div>
            <p className="text-xs text-text-muted">Reste (dette fournisseur)</p>
            <p className="text-xl font-bold text-rose-deep tabular">
              {formatCurrency(Math.max(0, (isEdit ? total : dueAfterCredit) - paidAmount))}
            </p>
          </div>
        </div>

        {supplierCredit > 0 && (
          <div className="mt-3 rounded-xl border border-pistachio/40 bg-pistachio/10 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Switch
                checked={useSupplierCredit}
                onChange={setUseSupplierCredit}
                label="Utiliser le trop-versé du fournisseur"
              />
              <span className="flex items-center gap-1 text-xs font-bold tabular text-pistachio">
                <PiggyBank size={13} /> {formatCurrency(supplierCredit)} disponible
              </span>
            </div>
            {useSupplierCredit && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-muted">Montant imputé sur cette facture</span>
                <Input
                  type="number" step="any" min={0}
                  value={creditUsed}
                  onChange={(e) => setCreditInput(Math.max(0, Number(e.target.value)))}
                  className="max-w-[160px] h-9"
                />
                <span className="text-xs text-text-muted">
                  → reste à payer <b className="tabular text-gold-dark">{formatCurrency(dueAfterCredit)}</b>
                </span>
              </div>
            )}
            <p className="text-[11px] text-text-muted">
              Argent déjà versé au fournisseur en plus de ses factures : aucune nouvelle sortie de caisse.
            </p>
          </div>
        )}

        {overpaid > 0.004 && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-caramel/40 bg-caramel/10 px-3 py-2 text-xs text-caramel">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Le montant payé dépasse la facture de <b>{formatCurrency(overpaid)}</b> : cet excédent est enregistré comme
              un versement au fournisseur et devient son <b>trop-versé</b>, utilisable sur ses prochains achats.
            </span>
          </p>
        )}

        {isEdit && (editing?.allocatedAmount ?? 0) > 0.004 && (
          <p className="mt-3 text-[11px] text-text-muted">
            Dont <b className="text-pistachio">{formatCurrency(editing?.allocatedAmount ?? 0)}</b> payés par le compte du
            fournisseur (versements / trop-versé) — sans écriture de caisse propre.
          </p>
        )}
      </section>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
        <Button variant="gold" onClick={handleSubmit} disabled={saving}>
          {saving
            ? 'Enregistrement…'
            : isEdit
              ? isHistorical
                ? "Enregistrer les modifications (sans toucher au stock)"
                : 'Enregistrer les modifications & recalculer le stock'
              : isHistorical
                ? "Enregistrer l'ancien achat (sans toucher au stock)"
                : 'Créer la facture & mettre à jour le stock'}
        </Button>
      </div>

      <Modal open={showProductForm} onClose={() => setShowProductForm(false)} title="Nouveau produit" size="lg">
        <ProductForm onSubmit={handleProductCreated} onCancel={() => setShowProductForm(false)} />
      </Modal>
      <Modal open={showSupplierForm} onClose={() => setShowSupplierForm(false)} title="Nouveau fournisseur" size="sm">
        <SupplierForm onSubmit={handleSupplierCreated} onCancel={() => setShowSupplierForm(false)} />
      </Modal>
    </div>
  );
}
