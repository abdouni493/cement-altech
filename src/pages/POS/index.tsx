import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard, Plus, Minus, X, Search, ShoppingBag, UserPlus, FlaskConical,
  Printer, CheckCircle2, Tag, RotateCcw, FileText, Layers, AlertTriangle,
  Factory, Phone, MapPin, Beaker, ClipboardList, Truck,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { ClientForm } from '@/components/shared/ClientForm';
import { VirtualKeyboard } from '@/components/shared/VirtualKeyboard';
import { useComptoirStore } from '@/store/comptoirStore';
import { useClientStore } from '@/store/clientStore';
import { useSalesStore, type PosProductionInput } from '@/store/salesStore';
import { useCommandStore } from '@/store/commandStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useStockStore } from '@/store/stockStore';
import { useFicheTechnicStore, type FicheTechnic } from '@/store/ficheTechnicStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, todayISO } from '@/lib/utils';
import { printSaleInvoice, type InvoiceProductionDetail } from '@/lib/invoicePrint';
import { toast } from '@/components/ui/Toast';
import type { Sale, ComptoirItem, Product, UsedProduct, Client } from '@/types';

/** An ingredient of a fiche technique, scaled to the quantity being sold. */
interface ScaledIngredient extends UsedProduct {
  isFiche: boolean;
  available: number;
}

interface CartLine {
  /** Unique key of the cart line (also ties a fiche line to its production). */
  key: string;
  kind: 'comptoir' | 'fiche';
  /** Comptoir item id, or fiche technique id. */
  refId: string;
  productName: string;
  /** Catalogue price of the item / fiche */
  basePrice: number;
  /** Price actually applied for this sale — editable by the cashier */
  unitPrice: number;
  quantity: number;
  /** Stock ceiling — `Infinity` for a fiche (limited by its ingredients). */
  available: number;
  sellByUnit?: boolean;
  unit?: string;
  // ---- fiche lines only ----
  fiche?: FicheTechnic;
  description?: string;
  categoryId?: string;
  categoryName?: string;
}

/**
 * Scales the recipe of a fiche technique to the quantity the cashier wants to
 * produce, and resolves the live stock/cost of each ingredient.
 */
function scaleIngredients(
  ft: FicheTechnic,
  outputQuantity: number,
  products: Product[]
): ScaledIngredient[] {
  const ratio = ft.outputQuantity > 0 ? outputQuantity / ft.outputQuantity : 0;
  return ft.usedProducts.map((u) => {
    const isFiche = u.sourceType === 'fiche';
    // Semi-finished (fiche) ingredients are not tracked in the raw stock.
    // Fall back to a name match so a re-created product is still found.
    const stockProd = isFiche
      ? undefined
      : products.find((p) => p.id === u.productId) ??
        products.find((p) => p.name.trim().toLowerCase() === u.productName.trim().toLowerCase());
    const quantityUsed = Number((u.quantityUsed * ratio).toFixed(4));
    const unitCost = isFiche ? (u.unitCost ?? 0) : stockProd ? stockProd.purchasePrice : (u.unitCost ?? 0);
    return {
      ...u,
      productId: stockProd ? stockProd.id : u.productId,
      isFiche,
      quantityUsed,
      unitCost,
      lineCost: Number((quantityUsed * unitCost).toFixed(2)),
      available: isFiche ? Infinity : stockProd ? stockProd.currentQuantity : 0,
    };
  });
}

export default function POS() {
  const { t } = useLanguage();
  const items = useComptoirStore((s) => s.items);
  const products = useStockStore((s) => s.products);
  const ficheTechnics = useFicheTechnicStore((s) => s.ficheTechnics);
  const { clients, addClient, getOrCreatePassager } = useClientStore();
  const addPosSale = useSalesStore((s) => s.addPosSale);
  const addCommand = useCommandStore((s) => s.addCommand);
  const settings = useSettingsStore((s) => s.settings);

  const [printPrompt, setPrintPrompt] = useState<
    { sale: Sale; productions: InvoiceProductionDetail[]; client: Client | null } | null
  >(null);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<'all' | 'comptoir' | 'fiche'>('all');
  const [keyboardEnabled, setKeyboardEnabled] = useState(
    () => localStorage.getItem('pos_keyboard_enabled') === 'true'
  );
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [reductionEnabled, setReductionEnabled] = useState(false);
  const [reduction, setReduction] = useState<number>(0);
  const [paid, setPaid] = useState<number>(0);
  const [paidEdited, setPaidEdited] = useState(false);
  const [showClientForm, setShowClientForm] = useState(false);
  const [saving, setSaving] = useState(false);
  // ---- document mode : vente directe vs commande ----
  const [posMode, setPosMode] = useState<'sale' | 'command'>('sale');
  /** Creation date shared by both modes (editable / back-datable). */
  const [docDate, setDocDate] = useState(todayISO());
  /** Manual "N° bon de commande" — searchable in /sales and /clients/commands. */
  const [bonNumber, setBonNumber] = useState('');
  // ---- command-only fields (mirror the "Nouvelle commande" form) ----
  const [receiveDate, setReceiveDate] = useState(todayISO());
  const [receiveHour, setReceiveHour] = useState('14');
  const [receiveMinute, setReceiveMinute] = useState('30');
  const [cmdCustomTotal, setCmdCustomTotal] = useState<number | null>(null);
  const [versement, setVersement] = useState<number>(0);
  /** Fiche technique being configured before it enters the cart. */
  const [ficheModal, setFicheModal] = useState<FicheTechnic | null>(null);
  /** Fiche line of the cart whose recipe is being inspected. */
  const [recipeLine, setRecipeLine] = useState<CartLine | null>(null);

  const selectedClient = clients.find((c) => c.id === clientId) ?? null;

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.quantity > 0 && i.categoryName) set.add(i.categoryName); });
    ficheTechnics.forEach((f) => { if (f.categoryName) set.add(f.categoryName); });
    return [...set].sort().map((name) => ({ value: name, label: name }));
  }, [items, ficheTechnics]);

  const availableItems = useMemo(
    () =>
      source === 'fiche'
        ? []
        : items.filter(
            (i) =>
              i.quantity > 0 &&
              i.productName.toLowerCase().includes(search.toLowerCase()) &&
              (!categoryFilter || i.categoryName === categoryFilter)
          ),
    [items, search, categoryFilter, source]
  );

  const availableFiches = useMemo(
    () =>
      source === 'comptoir'
        ? []
        : ficheTechnics.filter(
            (f) =>
              f.name.toLowerCase().includes(search.toLowerCase()) &&
              (!categoryFilter || f.categoryName === categoryFilter)
          ),
    [ficheTechnics, search, categoryFilter, source]
  );

  const clientResults = useMemo(
    () =>
      clientSearch
        ? clients
            .filter(
              (c) =>
                c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
                (c.phone || '').includes(clientSearch)
            )
            .slice(0, 6)
        : [],
    [clientSearch, clients]
  );

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.quantity * l.unitPrice, 0), [cart]);
  const finalAmount = Math.max(0, subtotal - (reductionEnabled ? reduction : 0));
  const effectivePaid = paidEdited ? paid : finalAmount;
  const change = Math.max(0, effectivePaid - finalAmount);
  const rest = Math.max(0, finalAmount - effectivePaid);

  /** Fiche lines resolved into the batches that will be produced on validation. */
  const plannedProductions = useMemo(
    () =>
      cart
        .filter((l): l is CartLine & { fiche: FicheTechnic } => l.kind === 'fiche' && !!l.fiche)
        .map((l) => ({
          line: l,
          ingredients: scaleIngredients(l.fiche, l.quantity, products),
        })),
    [cart, products]
  );

  const productionCost = useMemo(
    () =>
      plannedProductions.reduce(
        (s, p) => s + p.ingredients.reduce((a, i) => a + (i.lineCost ?? 0), 0),
        0
      ),
    [plannedProductions]
  );

  /** Raw materials missing to honour every fiche line of the cart. */
  const missingStock = useMemo(() => {
    const needed = new Map<string, { name: string; unit?: string; required: number; available: number }>();
    plannedProductions.forEach(({ ingredients }) =>
      ingredients.forEach((i) => {
        if (i.isFiche) return;
        const prev = needed.get(i.productId) ?? {
          name: i.productName, unit: i.unit, required: 0, available: i.available,
        };
        prev.required += i.quantityUsed;
        needed.set(i.productId, prev);
      })
    );
    return [...needed.values()].filter((n) => n.required > n.available + 1e-6);
  }, [plannedProductions]);

  // ------------------------------------------------------------------ cart --
  const addComptoirToCart = (item: ComptoirItem) => {
    const existing = cart.find((c) => c.kind === 'comptoir' && c.refId === item.id);
    if (existing) {
      if (existing.quantity >= item.quantity) { toast.warning('Stock comptoir insuffisant'); return; }
      setCart(cart.map((c) => (c.key === existing.key ? { ...c, quantity: c.quantity + 1 } : c)));
      return;
    }
    setCart([
      ...cart,
      {
        key: `cpt-${item.id}`,
        kind: 'comptoir',
        refId: item.id,
        productName: item.productName,
        basePrice: item.unitPrice,
        unitPrice: item.unitPrice,
        quantity: 1,
        available: item.quantity,
        sellByUnit: item.sellByUnit,
        unit: item.unit,
      },
    ]);
  };

  const addFicheToCart = (ft: FicheTechnic, quantity: number, unitPrice: number) => {
    const existing = cart.find((c) => c.kind === 'fiche' && c.refId === ft.id);
    if (existing) {
      setCart(cart.map((c) => (c.key === existing.key ? { ...c, quantity, unitPrice } : c)));
      toast.success(`Production « ${ft.name} » mise à jour dans le panier`);
      return;
    }
    setCart([
      ...cart,
      {
        key: `ft-${ft.id}-${Date.now().toString(36)}`,
        kind: 'fiche',
        refId: ft.id,
        productName: ft.name,
        basePrice: ft.unitPrice,
        unitPrice,
        quantity,
        available: Infinity,
        sellByUnit: ft.sellByUnit,
        unit: ft.sellByUnit ? ft.sellUnit : undefined,
        fiche: ft,
        description: ft.description,
        categoryId: ft.categoryId,
        categoryName: ft.categoryName,
      },
    ]);
    toast.success(`Production « ${ft.name} » ajoutée — elle sera lancée à la validation`);
  };

  const changeQty = (key: string, delta: number) =>
    setCart((prev) =>
      prev.map((c) => {
        if (c.key !== key) return c;
        const q = c.quantity + delta;
        if (q > c.available) { toast.warning('Stock comptoir insuffisant'); return c; }
        return { ...c, quantity: Math.max(c.kind === 'fiche' ? 0.001 : 1, q) };
      })
    );

  const setQty = (key: string, value: number) =>
    setCart((prev) =>
      prev.map((c) => {
        if (c.key !== key) return c;
        if (value > c.available) { toast.warning('Stock comptoir insuffisant'); return { ...c, quantity: c.available }; }
        return { ...c, quantity: value < 0 ? 0 : value };
      })
    );

  /** The cashier can override the unit price for THIS sale only. */
  const setUnitPrice = (key: string, value: number) =>
    setCart((prev) => prev.map((c) => (c.key === key ? { ...c, unitPrice: Math.max(0, value) } : c)));

  const resetPrice = (key: string) =>
    setCart((prev) => prev.map((c) => (c.key === key ? { ...c, unitPrice: c.basePrice } : c)));

  const reset = () => {
    setCart([]); setReduction(0); setReductionEnabled(false);
    setPaid(0); setPaidEdited(false); setClientId(null); setClientSearch('');
    setDocDate(todayISO()); setBonNumber('');
    setReceiveDate(todayISO()); setReceiveHour('14'); setReceiveMinute('30');
    setCmdCustomTotal(null); setVersement(0);
  };

  // ---------------------------------------------------------------- create --
  const createSale = async () => {
    if (cart.length === 0) { toast.error('Panier vide'); return; }
    if (cart.some((c) => c.quantity <= 0)) { toast.error('Une ligne a une quantité nulle'); return; }
    if (rest > 0 && !clientId) { toast.error('Sélectionnez un client pour une vente à crédit'); return; }
    if (missingStock.length > 0) {
      toast.error('Stock de matières premières insuffisant pour lancer la production');
      return;
    }
    setSaving(true);
    try {
      const saleClientId = clientId ?? (await getOrCreatePassager(t('walkInClient'))).id;

      const productions: PosProductionInput[] = plannedProductions.map(({ line, ingredients }) => ({
        lineKey: line.key,
        ficheTechnicId: line.refId,
        name: line.productName,
        description: line.description,
        categoryId: line.categoryId,
        categoryName: line.categoryName,
        outputQuantity: line.quantity,
        unitPrice: line.unitPrice,
        sellByUnit: line.sellByUnit,
        sellUnit: line.unit,
        usedProducts: ingredients.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          quantityUsed: i.quantityUsed,
          sourceType: i.sourceType ?? 'stock',
          unit: i.unit,
          unitCost: i.unitCost,
          lineCost: i.lineCost,
        })),
      }));

      // snapshot the recipe details before the cart is emptied — the invoice
      // prints them under "détail des productions réalisées"
      const invoiceProductions: InvoiceProductionDetail[] = plannedProductions.map(({ line, ingredients }) => ({
        name: line.productName,
        categoryName: line.categoryName,
        date: new Date().toISOString(),
        outputQuantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        totalCost: ingredients.reduce((s, i) => s + (i.lineCost ?? 0), 0),
        ingredients: ingredients.map((i) => ({
          productName: i.productName,
          quantityUsed: i.quantityUsed,
          unit: i.unit,
          unitCost: i.unitCost,
          lineCost: i.lineCost,
        })),
      }));

      const sale = await addPosSale({
        clientId: saleClientId,
        date: docDate,
        bonNumber: bonNumber.trim() || undefined,
        reduction: reductionEnabled ? Number(reduction) : 0,
        paidAmount: Number(effectivePaid),
        products: cart.map((c) => ({
          lineKey: c.kind === 'fiche' ? c.key : undefined,
          productId: c.refId,
          productName: c.productName,
          quantity: c.quantity,
          sellingPrice: c.unitPrice,
          basePrice: c.basePrice,
          sellByUnit: c.sellByUnit,
          unit: c.unit,
        })),
        productions,
      });

      toast.success(
        productions.length > 0
          ? `Vente créée · ${productions.length} production(s) lancée(s)`
          : rest > 0 ? 'Vente créée (dette client)' : 'Vente créée et payée'
      );
      setPrintPrompt({
        sale,
        productions: invoiceProductions,
        client: clients.find((c) => c.id === saleClientId) ?? null,
      });
      reset();
    } catch {
      /* the store already showed the error */
    } finally {
      setSaving(false);
    }
  };

  // ---- command total (mirrors the "Nouvelle commande" pricing) ----
  const cmdComputedTotal = subtotal;
  const cmdFinalTotal = cmdCustomTotal !== null ? cmdCustomTotal : cmdComputedTotal;
  const cmdRest = Math.max(0, cmdFinalTotal - (Number(versement) || 0));

  // --------------------------------------------------------- create command --
  const createCommandFromCart = async () => {
    if (cart.length === 0) { toast.error('Panier vide'); return; }
    if (cart.some((c) => c.quantity <= 0)) { toast.error('Une ligne a une quantité nulle'); return; }
    if (Number(versement) < 0) { toast.error('Le versement ne peut pas être négatif'); return; }
    if (!receiveDate) { toast.error('Choisissez une date de livraison'); return; }

    setSaving(true);
    try {
      // A command may be placed for the walk-in client, exactly like a sale.
      const client = selectedClient ?? (await getOrCreatePassager(t('walkInClient')));

      // Back-date only when the operator changed the creation date.
      const createdAtOverride =
        docDate && docDate !== todayISO()
          ? new Date(docDate + 'T12:00:00').toISOString()
          : undefined;

      const cmd = await addCommand({
        clientId: client.id,
        clientName: client.name,
        clientPhone: client.phone,
        receiveDate, receiveHour, receiveMinute,
        items: cart.map((c) => ({
          // comptoir lines are neither a stock product nor a fiche → keep both ids null
          ficheTechnicId: c.kind === 'fiche' ? c.refId : undefined,
          productName: c.productName,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          totalPrice: c.quantity * c.unitPrice,
          sellByUnit: c.sellByUnit,
          sellUnit: c.unit,
        })),
        totalAmount: cmdFinalTotal,
        advancePaid: Number(versement) || 0,
        paidAmount: Number(versement) || 0,
        bonNumber: bonNumber.trim() || undefined,
        createdAt: createdAtOverride,
      });

      toast.success(`Commande créée · ${cmd.reference}`);
      reset();
    } catch {
      /* the store already showed the error */
    } finally {
      setSaving(false);
    }
  };

  const handlePrintInvoice = (prompt: NonNullable<typeof printPrompt>) => {
    const { sale, client } = prompt;
    printSaleInvoice(
      {
        reference: sale.reference,
        date: sale.date,
        client: {
          name: client?.name || t('walkIn'),
          phone: client?.phone,
          address: client?.address,
        },
        lines: sale.products.map((l) => ({
          designation: l.productName || '',
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.sellingPrice,
          basePrice: l.basePrice,
        })),
        productions: prompt.productions,
        total: sale.totalAmount,
        reduction: sale.reduction,
        final: sale.finalAmount,
        paid: sale.paidAmount,
        rest: sale.restAmount,
        createdBy: sale.createdBy,
      },
      settings
    );
    setPrintPrompt(null);
  };

  const priceOverrides = cart.filter((c) => Math.abs(c.unitPrice - c.basePrice) > 0.001).length;
  const ficheLines = cart.filter((c) => c.kind === 'fiche').length;

  return (
    <div>
      <PageHeader
        title="Point de vente"
        icon={<CreditCard size={24} />}
        subtitle="Comptoir et fiches techniques — la production est lancée automatiquement à la vente"
        actions={
          <div className="flex items-center gap-2 rounded-xl border border-gold/15 bg-gradient-card px-3 py-1.5 shadow-sm">
            <span className="text-xs font-semibold text-text-secondary">{t('virtualKeyboard')}</span>
            <Switch
              checked={keyboardEnabled}
              onChange={(val) => {
                setKeyboardEnabled(val);
                localStorage.setItem('pos_keyboard_enabled', String(val));
                if (!val) setShowKeyboard(false);
              }}
            />
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* ---------------- Catalogue ---------------- */}
        <div className="xl:col-span-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[180px]">
              <SearchBar
                value={search}
                onChange={setSearch}
                placeholder="Rechercher un produit ou une fiche technique…"
                onFocus={() => { if (keyboardEnabled) setShowKeyboard(true); }}
              />
            </div>
            {categoryOptions.length > 0 && (
              <Select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                placeholder={t('allCategories')}
                options={categoryOptions}
                className="max-w-[200px]"
              />
            )}
          </div>

          {/* Source switch — comptoir vs fiches techniques */}
          <div className="mb-4 inline-flex rounded-xl border border-gold/20 bg-vanilla/40 p-1">
            {([
              ['all', 'Tout', <Layers key="i" size={14} />, items.filter((i) => i.quantity > 0).length + ficheTechnics.length],
              ['comptoir', 'Comptoir', <ShoppingBag key="i" size={14} />, items.filter((i) => i.quantity > 0).length],
              ['fiche', 'Fiches techniques', <FileText key="i" size={14} />, ficheTechnics.length],
            ] as const).map(([key, label, icon, count]) => (
              <button
                key={key}
                onClick={() => setSource(key)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  source === key
                    ? 'bg-gradient-button text-stone-950 shadow-gold'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {icon} {label}
                <span className={`text-[10px] rounded-full px-1.5 ${source === key ? 'bg-stone-950/15' : 'bg-gold/10'}`}>
                  {count}
                </span>
              </button>
            ))}
          </div>

          <AnimatePresence>
            {keyboardEnabled && showKeyboard && (
              <div className="mb-4">
                <VirtualKeyboard value={search} onChange={setSearch} onClose={() => setShowKeyboard(false)} />
              </div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Fiches techniques — produce on demand */}
            {availableFiches.map((ft, i) => {
              const inCart = cart.find((c) => c.kind === 'fiche' && c.refId === ft.id);
              return (
                <motion.button
                  key={`ft-${ft.id}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.03 }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setFicheModal(ft)}
                  className={`bg-gradient-card rounded-2xl p-4 text-left shadow-card hover:shadow-hover transition-shadow border ${
                    inCart ? 'border-pistachio/60' : 'border-pistachio/25'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="h-10 w-10 rounded-xl bg-gradient-mint flex items-center justify-center text-white">
                      <Beaker size={20} />
                    </div>
                    {inCart
                      ? <Badge variant="success">×{inCart.quantity}</Badge>
                      : <Badge variant="info" className="bg-pistachio/15 text-pistachio border-0 text-[9px]">À produire</Badge>}
                  </div>
                  <p className="font-medium text-text-primary text-sm truncate">{ft.name}</p>
                  <p className="text-pistachio font-bold tabular text-sm mt-1">
                    {formatCurrency(ft.unitPrice)}
                    {ft.sellByUnit && ft.sellUnit && (
                      <span className="text-xs text-text-muted font-normal">/{ft.sellUnit}</span>
                    )}
                  </p>
                  <p className="text-xs text-text-muted truncate">
                    {ft.usedProducts.length} matière(s) · rendement {ft.outputQuantity}
                    {ft.sellByUnit && ft.sellUnit ? ` ${ft.sellUnit}` : ''}
                  </p>
                </motion.button>
              );
            })}

            {/* Comptoir — already produced */}
            {availableItems.map((item, i) => {
              const inCart = cart.find((c) => c.kind === 'comptoir' && c.refId === item.id);
              return (
                <motion.button
                  key={`cpt-${item.id}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.03 }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => addComptoirToCart(item)}
                  className={`bg-gradient-card rounded-2xl p-4 text-left shadow-card hover:shadow-hover transition-shadow border ${
                    inCart ? 'border-gold/60' : 'border-gold/15'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="h-10 w-10 rounded-xl bg-gradient-button flex items-center justify-center text-white">
                      <FlaskConical size={20} />
                    </div>
                    {inCart && <Badge variant="gold">×{inCart.quantity}</Badge>}
                  </div>
                  <p className="font-medium text-text-primary text-sm truncate">{item.productName}</p>
                  <p className="text-gold-dark font-bold tabular text-sm mt-1">
                    {formatCurrency(item.unitPrice)}
                    {item.sellByUnit && item.unit && (
                      <span className="text-xs text-text-muted font-normal">/{item.unit}</span>
                    )}
                  </p>
                  <p className="text-xs text-text-muted">
                    Disponible : {item.quantity}{item.sellByUnit && item.unit ? ` ${item.unit}` : ''}
                  </p>
                </motion.button>
              );
            })}

            {availableItems.length === 0 && availableFiches.length === 0 && (
              <p className="col-span-full text-center text-text-muted py-10">
                Aucun produit ni fiche technique ne correspond à cette recherche
              </p>
            )}
          </div>
        </div>

        {/* ---------------- Panier ---------------- */}
        <div className="xl:col-span-2 bg-gradient-card border border-gold/20 rounded-2xl p-5 shadow-card h-fit xl:sticky xl:top-20">
          <h3 className="font-display text-lg font-semibold text-text-primary flex items-center gap-2 mb-3">
            <ShoppingBag size={20} /> Panier
            <span className="text-sm font-normal text-text-muted">({cart.length})</span>
            {priceOverrides > 0 && (
              <Badge variant="warning" className="ml-auto text-[10px]">
                {priceOverrides} prix modifié{priceOverrides > 1 ? 's' : ''}
              </Badge>
            )}
          </h3>

          {/* Mode : vente directe ou commande client */}
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-gold/20 bg-vanilla/40 p-1">
            {([
              ['sale', 'Vente directe', <CreditCard key="i" size={14} />],
              ['command', 'Commande', <ClipboardList key="i" size={14} />],
            ] as const).map(([key, label, icon]) => (
              <button
                key={key}
                onClick={() => setPosMode(key)}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                  posMode === key
                    ? 'bg-gradient-button text-stone-950 shadow-gold'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {/* ---- Client ---- */}
          <div className="mb-4 rounded-2xl border border-gold/20 bg-vanilla/40 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2">Client</p>
            <div className="flex gap-2 relative">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <Input
                  value={clientSearch}
                  onChange={(e) => { setClientSearch(e.target.value); setClientId(null); }}
                  placeholder="Rechercher par nom ou téléphone…"
                  className="pl-9 h-11"
                />
                {clientResults.length > 0 && !clientId && (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-gold/20 bg-[--surface-dropdown] shadow-hover overflow-hidden max-h-56 overflow-y-auto">
                    {clientResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { setClientId(c.id); setClientSearch(c.name); }}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-gold/10 border-b border-gold/5 last:border-0"
                      >
                        <span className="font-medium text-text-primary">{c.name}</span>
                        {c.phone && <span className="text-text-muted text-xs block">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button variant="secondary" className="h-11 shrink-0" onClick={() => setShowClientForm(true)}>
                <UserPlus size={16} /> Nouveau
              </Button>
            </div>

            {selectedClient ? (
              <div className="mt-3 flex items-start gap-3 rounded-xl border border-pistachio/30 bg-pistachio/8 p-3">
                <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-mint text-white font-bold flex items-center justify-center">
                  {selectedClient.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-text-primary truncate">{selectedClient.name}</p>
                  <p className="text-xs text-text-muted flex items-center gap-1 truncate">
                    <Phone size={11} /> {selectedClient.phone || '—'}
                  </p>
                  {selectedClient.address && (
                    <p className="text-xs text-text-muted flex items-center gap-1 truncate">
                      <MapPin size={11} /> {selectedClient.address}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => { setClientId(null); setClientSearch(''); }}
                  className="text-rose-deep shrink-0"
                  title="Retirer le client"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <p className="text-xs text-text-muted mt-2.5">
                Aucun client sélectionné — {posMode === 'command' ? 'la commande' : 'la vente'} sera enregistrée pour « {t('walkInClient')} ».
              </p>
            )}
          </div>

          {/* ---- Date de création + n° bon de commande (les deux modes) ---- */}
          <div className="mb-4 rounded-2xl border border-gold/20 bg-vanilla/40 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label={posMode === 'command' ? 'Date de création' : 'Date de la vente'}
              type="date"
              value={docDate}
              onChange={(e) => setDocDate(e.target.value)}
              className="h-11"
            />
            <Input
              label="N° bon de commande"
              placeholder="Facultatif"
              value={bonNumber}
              onChange={(e) => setBonNumber(e.target.value)}
              className="h-11"
            />
          </div>

          {/* ---- Production warning (ventes uniquement) ---- */}
          {posMode === 'sale' && ficheLines > 0 && (
            <div className={`mb-3 rounded-xl border px-3.5 py-2.5 text-xs ${
              missingStock.length > 0
                ? 'border-rose-deep/30 bg-rose-deep/8 text-rose-deep'
                : 'border-pistachio/30 bg-pistachio/8 text-pistachio'
            }`}>
              <p className="font-bold flex items-center gap-1.5">
                {missingStock.length > 0 ? <AlertTriangle size={13} /> : <Factory size={13} />}
                {missingStock.length > 0
                  ? 'Matières premières insuffisantes'
                  : `${ficheLines} production(s) seront lancées à la validation`}
              </p>
              {missingStock.length > 0 ? (
                <ul className="mt-1 space-y-0.5">
                  {missingStock.map((m) => (
                    <li key={m.name}>
                      • {m.name} : besoin {m.required.toFixed(2)}{m.unit ? ` ${m.unit}` : ''} · dispo {m.available}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 text-text-muted">
                  Coût matières estimé : <span className="font-bold">{formatCurrency(productionCost)}</span>
                </p>
              )}
            </div>
          )}

          {/* ---- Lines ---- */}
          <div className="space-y-2.5 mb-4 max-h-[28rem] overflow-y-auto pr-1">
            <AnimatePresence>
              {cart.map((l) => {
                const overridden = Math.abs(l.unitPrice - l.basePrice) > 0.001;
                const isFiche = l.kind === 'fiche';
                return (
                  <motion.div
                    key={l.key}
                    layout
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className={`rounded-xl border p-3 ${
                      isFiche ? 'bg-pistachio/5 border-pistachio/25' : 'bg-vanilla/50 border-gold/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary truncate flex items-center gap-1.5">
                          {isFiche && (
                            <Badge variant="info" className="bg-pistachio/20 text-pistachio border-0 text-[9px] px-1.5 py-0">
                              Production
                            </Badge>
                          )}
                          {l.productName}
                          {l.unit && <span className="text-xs text-gold-dark">· {l.unit}</span>}
                        </p>
                        <p className="text-[10px] text-text-muted">
                          Prix catalogue : {formatCurrency(l.basePrice)}{l.unit ? `/${l.unit}` : ''}
                          {isFiche && ' · lot fabriqué à la validation'}
                        </p>
                      </div>
                      <button onClick={() => setCart(cart.filter((c) => c.key !== l.key))} className="text-rose-deep shrink-0">
                        <X size={15} />
                      </button>
                    </div>

                    {/* Editable unit price */}
                    <div className="flex items-end gap-2 mb-2">
                      <div className="flex-1">
                        <label className="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-0.5">
                          {l.unit ? `Prix de vente / ${l.unit}` : 'Prix de vente unitaire'}
                        </label>
                        <div className="relative">
                          <Tag size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gold" />
                          <input
                            type="number" step="any" min={0}
                            value={l.unitPrice}
                            onChange={(e) => setUnitPrice(l.key, Number(e.target.value))}
                            className={`w-full h-9 rounded-lg pl-8 pr-2 text-sm tabular font-semibold border-2 bg-[--surface-input] text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/30 ${
                              overridden ? 'border-caramel' : 'border-[--border-input]'
                            }`}
                          />
                        </div>
                      </div>
                      {overridden && (
                        <button
                          onClick={() => resetPrice(l.key)}
                          className="h-9 px-2 rounded-lg border border-gold/25 text-text-muted hover:text-gold-dark hover:bg-gold/10 transition-colors"
                          title="Revenir au prix catalogue"
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>

                    {/* Quantity + line total */}
                    <div className="flex items-center justify-between gap-2">
                      {l.sellByUnit || isFiche ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-text-muted">Qté</span>
                          <input
                            type="number" step="any" min={0}
                            value={l.quantity}
                            onChange={(e) => setQty(l.key, Number(e.target.value))}
                            className="w-24 h-9 rounded-lg bg-[--surface-input] border border-gold/20 px-2 text-sm tabular text-center focus:outline-none focus:ring-2 focus:ring-gold/40"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button onClick={() => changeQty(l.key, -1)} className="h-8 w-8 rounded-md bg-[--surface-input] border border-gold/20 flex items-center justify-center">
                            <Minus size={13} />
                          </button>
                          <span className="w-9 text-center text-sm tabular font-semibold">{l.quantity}</span>
                          <button onClick={() => changeQty(l.key, 1)} className="h-8 w-8 rounded-md bg-[--surface-input] border border-gold/20 flex items-center justify-center">
                            <Plus size={13} />
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        {isFiche && (
                          <button
                            onClick={() => setRecipeLine(l)}
                            className="text-[10px] font-semibold text-pistachio underline underline-offset-2"
                          >
                            Voir la formule
                          </button>
                        )}
                        <span className="text-base tabular font-bold text-gold-dark">
                          {formatCurrency(l.quantity * l.unitPrice)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {cart.length === 0 && (
              <p className="text-sm text-text-muted text-center py-8">
                Panier vide — choisissez un produit du comptoir ou une fiche technique
              </p>
            )}
          </div>

          {/* ======================= VENTE DIRECTE ======================= */}
          {posMode === 'sale' && (
            <>
              {/* ---- Totals ---- */}
              <div className="border-t border-gold/15 pt-4 space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-muted">Sous-total</span>
                  <span className="tabular font-semibold">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <Switch checked={reductionEnabled} onChange={setReductionEnabled} label="Réduction" />
                  {reductionEnabled && (
                    <Input
                      type="number" value={reduction}
                      onChange={(e) => setReduction(Number(e.target.value))}
                      className="max-w-[120px] h-9"
                    />
                  )}
                </div>
                <div className="flex justify-between items-center text-lg font-bold border-y border-gold/15 py-2.5">
                  <span>Total</span>
                  <span className="tabular text-gold-dark">{formatCurrency(finalAmount)}</span>
                </div>
                <Input
                  label="Le client paie"
                  type="number"
                  className="h-11 text-base"
                  value={effectivePaid}
                  onChange={(e) => { setPaid(Number(e.target.value)); setPaidEdited(true); }}
                />
                <div className="flex justify-between">
                  <span className="text-text-muted">Monnaie à rendre</span>
                  <span className="tabular font-semibold text-pistachio">{formatCurrency(change)}</span>
                </div>
                {rest > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Reste (dette)</span>
                    <span className="tabular text-rose-deep font-bold">{formatCurrency(rest)}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2">
                <Button
                  variant={rest <= 0 ? 'gold' : 'rose'}
                  className="w-full h-12 text-base"
                  onClick={createSale}
                  disabled={saving || cart.length === 0 || missingStock.length > 0}
                >
                  {saving ? 'Enregistrement…' : rest <= 0 ? 'Valider la vente (payée)' : 'Valider la vente (dette)'}
                </Button>
                {cart.length > 0 && (
                  <Button variant="ghost" className="w-full" onClick={reset} disabled={saving}>Annuler</Button>
                )}
              </div>
            </>
          )}

          {/* ========================= COMMANDE ========================= */}
          {posMode === 'command' && (
            <>
              {/* Delivery date / time */}
              <div className="border-t border-gold/15 pt-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
                  <Truck size={13} className="text-gold" /> Livraison prévue
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Input
                    label="Date" type="date" value={receiveDate}
                    onChange={(e) => setReceiveDate(e.target.value)} className="h-10"
                  />
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">Heure</label>
                    <select
                      value={receiveHour}
                      onChange={(e) => setReceiveHour(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-gold/20 bg-[--surface-input] text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold"
                    >
                      {Array.from({ length: 24 }).map((_, h) => {
                        const val = String(h).padStart(2, '0');
                        return <option key={val} value={val}>{val}h</option>;
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">Minute</label>
                    <select
                      value={receiveMinute}
                      onChange={(e) => setReceiveMinute(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-gold/20 bg-[--surface-input] text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold"
                    >
                      {['00', '15', '30', '45'].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Command totals */}
              <div className="border-t border-gold/15 mt-4 pt-4 space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-muted">Total calculé</span>
                  <span className="tabular font-semibold">{formatCurrency(cmdComputedTotal)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted">Ajuster le total</span>
                  <Input
                    type="number"
                    value={cmdCustomTotal !== null ? cmdCustomTotal : ''}
                    placeholder={String(cmdComputedTotal)}
                    onChange={(e) => setCmdCustomTotal(e.target.value ? Number(e.target.value) : null)}
                    className="max-w-[140px] h-9"
                  />
                </div>
                <div className="flex justify-between items-center text-lg font-bold border-y border-gold/15 py-2.5">
                  <span>Total commande</span>
                  <span className="tabular text-gold-dark">{formatCurrency(cmdFinalTotal)}</span>
                </div>
                <Input
                  label="Acompte / versement"
                  type="number"
                  className="h-11 text-base"
                  value={versement}
                  onChange={(e) => setVersement(Number(e.target.value))}
                />
                <div className="flex justify-between">
                  <span className="text-text-muted">Reste à payer (dette)</span>
                  <span className={`tabular font-bold ${cmdRest > 0 ? 'text-rose-deep' : 'text-pistachio'}`}>
                    {formatCurrency(cmdRest)}
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <Button
                  variant="gold"
                  className="w-full h-12 text-base"
                  onClick={createCommandFromCart}
                  disabled={saving || cart.length === 0}
                >
                  <ClipboardList size={18} />
                  {saving ? 'Enregistrement…' : 'Enregistrer la commande'}
                </Button>
                {cart.length > 0 && (
                  <Button variant="ghost" className="w-full" onClick={reset} disabled={saving}>Annuler</Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ---- Configure a fiche technique before adding it to the cart ---- */}
      <Modal
        open={!!ficheModal}
        onClose={() => setFicheModal(null)}
        title={`Produire & vendre — ${ficheModal?.name ?? ''}`}
        size="lg"
      >
        {ficheModal && (
          <FicheSaleForm
            fiche={ficheModal}
            products={products}
            initialQuantity={cart.find((c) => c.kind === 'fiche' && c.refId === ficheModal.id)?.quantity}
            initialPrice={cart.find((c) => c.kind === 'fiche' && c.refId === ficheModal.id)?.unitPrice}
            onCancel={() => setFicheModal(null)}
            onConfirm={(quantity, unitPrice) => {
              addFicheToCart(ficheModal, quantity, unitPrice);
              setFicheModal(null);
            }}
          />
        )}
      </Modal>

      {/* ---- Recipe of a cart line ---- */}
      <Modal
        open={!!recipeLine}
        onClose={() => setRecipeLine(null)}
        title={`Formule — ${recipeLine?.productName ?? ''}`}
        size="md"
      >
        {recipeLine?.fiche && (
          <IngredientTable
            ingredients={scaleIngredients(recipeLine.fiche, recipeLine.quantity, products)}
            outputQuantity={recipeLine.quantity}
            unit={recipeLine.unit}
          />
        )}
      </Modal>

      <Modal open={showClientForm} onClose={() => setShowClientForm(false)} title="Nouveau client" size="sm">
        <ClientForm
          onSubmit={async (data) => {
            const c = await addClient(data);
            setClientId(c.id);
            setClientSearch(c.name);
            setShowClientForm(false);
            toast.success('Client créé');
          }}
          onCancel={() => setShowClientForm(false)}
        />
      </Modal>

      {/* ---- Print prompt after a successful sale ---- */}
      <Modal open={!!printPrompt} onClose={() => setPrintPrompt(null)} size="sm">
        <div className="flex flex-col items-center text-center py-2">
          <div className="h-14 w-14 rounded-full bg-pistachio/15 flex items-center justify-center mb-4">
            <CheckCircle2 size={30} className="text-pistachio" />
          </div>
          <h3 className="font-display text-lg font-semibold text-text-primary mb-1">Vente enregistrée</h3>
          <p className="text-sm text-text-secondary mb-1">{printPrompt?.sale.reference}</p>
          {!!printPrompt?.productions.length && (
            <p className="text-xs text-pistachio mb-1">
              {printPrompt.productions.length} production(s) créée(s) et visible(s) dans « Production »
            </p>
          )}
          <p className="text-sm text-text-muted mb-6">Voulez-vous imprimer la facture ?</p>
          <div className="flex gap-3 w-full">
            <Button variant="secondary" className="flex-1" onClick={() => setPrintPrompt(null)}>Non, merci</Button>
            <Button variant="gold" className="flex-1" onClick={() => printPrompt && handlePrintInvoice(printPrompt)}>
              <Printer size={16} /> Imprimer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Configure the batch produced from a fiche technique
// ---------------------------------------------------------------------------
function FicheSaleForm({
  fiche, products, initialQuantity, initialPrice, onCancel, onConfirm,
}: {
  fiche: FicheTechnic;
  products: Product[];
  initialQuantity?: number;
  initialPrice?: number;
  onCancel: () => void;
  onConfirm: (quantity: number, unitPrice: number) => void;
}) {
  const [quantity, setQuantity] = useState<number>(initialQuantity ?? fiche.outputQuantity);
  const [unitPrice, setUnitPrice] = useState<number>(initialPrice ?? fiche.unitPrice);

  const ingredients = useMemo(
    () => scaleIngredients(fiche, quantity, products),
    [fiche, quantity, products]
  );
  const ratio = fiche.outputQuantity > 0 ? quantity / fiche.outputQuantity : 0;
  const totalCost = ingredients.reduce((s, i) => s + (i.lineCost ?? 0), 0);
  const costPerUnit = quantity > 0 ? totalCost / quantity : 0;
  const revenue = quantity * unitPrice;
  const gains = revenue - totalCost;
  const short = ingredients.filter((i) => !i.isFiche && i.quantityUsed > i.available + 1e-6);
  const su = fiche.sellByUnit && fiche.sellUnit ? ` ${fiche.sellUnit}` : '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/10 pb-3">
        <div>
          <p className="font-display font-semibold text-text-primary">{fiche.name}</p>
          <p className="text-xs text-text-muted">
            {fiche.categoryName} · rendement de base {fiche.outputQuantity}{su}
          </p>
        </div>
        <Badge variant="info" className="bg-pistachio/15 text-pistachio border-0">
          Facteur {ratio.toFixed(2)}×
        </Badge>
      </div>

      {fiche.description && (
        <p className="text-xs text-text-secondary bg-vanilla/40 p-2.5 rounded-lg italic">« {fiche.description} »</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label={`Quantité obtenue de cette production${su ? ` (${fiche.sellUnit})` : ''}`}
          type="number" step="any" min={0} autoFocus
          value={quantity}
          onChange={(e) => setQuantity(Math.max(0, Number(e.target.value)))}
          className="text-lg font-bold tabular"
        />
        <Input
          label={`Prix de vente unitaire${su ? ` / ${fiche.sellUnit}` : ''}`}
          type="number" step="any" min={0}
          value={unitPrice}
          onChange={(e) => setUnitPrice(Math.max(0, Number(e.target.value)))}
          className="text-lg font-bold tabular"
        />
      </div>

      <p className="text-xs text-text-muted -mt-1">
        Modifier la quantité recalcule automatiquement les quantités de matières consommées.
      </p>

      {short.length > 0 && (
        <div className="rounded-xl border border-rose-deep/25 bg-rose-deep/8 p-3 text-xs text-rose-deep">
          <p className="font-bold flex items-center gap-1.5"><AlertTriangle size={13} /> Stock insuffisant</p>
          <ul className="mt-1 space-y-0.5">
            {short.map((s) => (
              <li key={s.productId}>
                • {s.productName} : besoin {s.quantityUsed}{s.unit ? ` ${s.unit}` : ''} · disponible {s.available}
              </li>
            ))}
          </ul>
        </div>
      )}

      <IngredientTable ingredients={ingredients} outputQuantity={quantity} unit={fiche.sellByUnit ? fiche.sellUnit : undefined} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Coût matières" value={formatCurrency(totalCost)} color="text-rose-deep" />
        <Stat label="Coût de revient / unité" value={formatCurrency(costPerUnit)} color="text-rose-deep" />
        <Stat label="Chiffre d'affaires" value={formatCurrency(revenue)} color="text-gold-dark" />
        <Stat label="Gain estimé" value={formatCurrency(gains)} color={gains >= 0 ? 'text-pistachio' : 'text-rose-deep'} />
      </div>

      <div className="flex justify-end gap-3 border-t border-gold/10 pt-4">
        <Button variant="secondary" onClick={onCancel}>Annuler</Button>
        <Button
          variant="gold"
          disabled={quantity <= 0 || short.length > 0}
          onClick={() => onConfirm(quantity, unitPrice)}
        >
          <ShoppingBag size={16} /> Ajouter au panier
        </Button>
      </div>
    </div>
  );
}

function IngredientTable({ ingredients, outputQuantity, unit }: {
  ingredients: ScaledIngredient[]; outputQuantity: number; unit?: string;
}) {
  const total = ingredients.reduce((s, i) => s + (i.lineCost ?? 0), 0);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-text-secondary">Produits utilisés pour cette production</h4>
        <span className="text-xs font-bold text-pistachio tabular">
          Rendement : {outputQuantity}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div className="rounded-xl border border-gold/15 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-vanilla/60 text-text-secondary">
            <tr>
              <th className="text-left px-3 py-2">Matière</th>
              <th className="text-right px-3 py-2">Quantité</th>
              <th className="text-right px-3 py-2">Stock</th>
              <th className="text-right px-3 py-2">Coût unit.</th>
              <th className="text-right px-3 py-2">Coût ligne</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((i) => {
              const shortfall = !i.isFiche && i.quantityUsed > i.available + 1e-6;
              return (
                <tr key={i.productId} className={`border-t border-gold/10 ${shortfall ? 'bg-rose-deep/5' : ''}`}>
                  <td className="px-3 py-2 font-medium">
                    <span className="flex items-center gap-1.5">
                      {i.isFiche && (
                        <Badge variant="info" className="bg-pistachio/15 text-pistachio border-0 text-[9px] px-1.5 py-0">
                          Semi-fini
                        </Badge>
                      )}
                      {i.productName}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right tabular font-bold ${shortfall ? 'text-rose-deep' : ''}`}>
                    {i.quantityUsed}{i.unit ? ` ${i.unit}` : ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-text-muted">
                    {i.isFiche ? '—' : `${i.available}${i.unit ? ` ${i.unit}` : ''}`}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{formatCurrency(i.unitCost ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular text-rose-deep">{formatCurrency(i.lineCost ?? 0)}</td>
                </tr>
              );
            })}
            {ingredients.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-text-muted text-xs">Aucune matière sur cette fiche</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-gold/15 bg-vanilla/40 font-semibold text-text-primary">
              <td className="px-3 py-2" colSpan={4}>Coût total des matières</td>
              <td className="px-3 py-2 text-right tabular text-rose-deep">{formatCurrency(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, color = 'text-text-primary' }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2.5 text-center">
      <p className="text-[10px] uppercase tracking-wide text-text-muted leading-tight">{label}</p>
      <p className={`text-sm font-bold tabular ${color} mt-0.5`}>{value}</p>
    </div>
  );
}
