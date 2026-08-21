import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard, Plus, Minus, X, Search, ShoppingBag, UserPlus, FlaskConical,
  Printer, CheckCircle2, Tag, RotateCcw,
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
import { useSalesStore } from '@/store/salesStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency } from '@/lib/utils';
import { printInvoice } from '@/lib/print';
import { toast } from '@/components/ui/Toast';
import type { Sale, ComptoirItem } from '@/types';

interface CartLine {
  id: string;
  productName: string;
  /** catalogue price of the comptoir item */
  basePrice: number;
  /** price actually applied for this sale — editable by the cashier */
  unitPrice: number;
  quantity: number;
  available: number;
  sellByUnit?: boolean;
  unit?: string;
}

export default function POS() {
  const { t } = useLanguage();
  const items = useComptoirStore((s) => s.items);
  const { clients, addClient, getOrCreatePassager } = useClientStore();
  const addSale = useSalesStore((s) => s.addSale);
  const settings = useSettingsStore((s) => s.settings);

  const [printPrompt, setPrintPrompt] = useState<Sale | null>(null);
  const [search, setSearch] = useState('');
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

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.quantity > 0 && i.categoryName) set.add(i.categoryName); });
    return [...set].map((name) => ({ value: name, label: name }));
  }, [items]);

  const available = useMemo(
    () =>
      items.filter(
        (i) =>
          i.quantity > 0 &&
          i.productName.toLowerCase().includes(search.toLowerCase()) &&
          (!categoryFilter || i.categoryName === categoryFilter)
      ),
    [items, search, categoryFilter]
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
            .slice(0, 5)
        : [],
    [clientSearch, clients]
  );

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.quantity * l.unitPrice, 0), [cart]);
  const finalAmount = Math.max(0, subtotal - (reductionEnabled ? reduction : 0));
  const effectivePaid = paidEdited ? paid : finalAmount;
  const change = Math.max(0, effectivePaid - finalAmount);
  const rest = Math.max(0, finalAmount - effectivePaid);

  const addToCart = (item: ComptoirItem) => {
    const existing = cart.find((c) => c.id === item.id);
    if (existing) {
      if (existing.quantity >= item.quantity) { toast.warning('Stock comptoir insuffisant'); return; }
      setCart(cart.map((c) => (c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c)));
      return;
    }
    setCart([
      ...cart,
      {
        id: item.id,
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

  const changeQty = (id: string, delta: number) =>
    setCart((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const q = c.quantity + delta;
        if (q > c.available) { toast.warning('Stock comptoir insuffisant'); return c; }
        return { ...c, quantity: Math.max(1, q) };
      })
    );

  const setQty = (id: string, value: number) =>
    setCart((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (value > c.available) { toast.warning('Stock comptoir insuffisant'); return { ...c, quantity: c.available }; }
        return { ...c, quantity: value < 0 ? 0 : value };
      })
    );

  /** The cashier can override the unit price for THIS sale only. */
  const setUnitPrice = (id: string, value: number) =>
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, unitPrice: Math.max(0, value) } : c)));

  const resetPrice = (id: string) =>
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, unitPrice: c.basePrice } : c)));

  const reset = () => {
    setCart([]); setReduction(0); setReductionEnabled(false);
    setPaid(0); setPaidEdited(false); setClientId(null); setClientSearch('');
  };

  const createSale = async () => {
    if (cart.length === 0) { toast.error('Panier vide'); return; }
    if (rest > 0 && !clientId) { toast.error('Sélectionnez un client pour une vente à crédit'); return; }
    setSaving(true);
    try {
      const saleClientId = clientId ?? (await getOrCreatePassager(t('walkInClient'))).id;
      const sale = await addSale({
        clientId: saleClientId,
        date: new Date().toISOString(),
        products: cart.map((c) => ({
          productId: c.id,
          productName: c.productName,
          quantity: c.quantity,
          sellingPrice: c.unitPrice,
          basePrice: c.basePrice,
          sellByUnit: c.sellByUnit,
          unit: c.unit,
        })),
        reduction: reductionEnabled ? Number(reduction) : 0,
        paidAmount: Number(effectivePaid),
      });
      toast.success(rest > 0 ? 'Vente créée (dette client)' : 'Vente créée et payée');
      setPrintPrompt(sale);
      reset();
    } catch {
      /* the store already showed the error */
    } finally {
      setSaving(false);
    }
  };

  const handlePrintInvoice = (sale: Sale) => {
    const cl = clients.find((c) => c.id === sale.clientId);
    printInvoice(
      {
        type: 'sale', reference: sale.reference, date: sale.date,
        partyName: cl?.name || t('walkIn'), partyPhone: cl?.phone,
        lines: sale.products.map((l) => ({
          designation: l.productName || '', quantity: l.quantity, unitPrice: l.sellingPrice,
        })),
        total: sale.totalAmount, reduction: sale.reduction, final: sale.finalAmount,
        paid: sale.paidAmount, rest: sale.restAmount,
      },
      settings
    );
    setPrintPrompt(null);
  };

  const priceOverrides = cart.filter((c) => Math.abs(c.unitPrice - c.basePrice) > 0.001).length;

  return (
    <div>
      <PageHeader
        title="Point de vente"
        icon={<CreditCard size={24} />}
        subtitle="Produits issus de la production, prix modifiable à la vente"
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ---------------- Catalogue ---------------- */}
        <div className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[180px]">
              <SearchBar
                value={search}
                onChange={setSearch}
                placeholder="Rechercher un produit du comptoir…"
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
          <AnimatePresence>
            {keyboardEnabled && showKeyboard && (
              <div className="mb-4">
                <VirtualKeyboard value={search} onChange={setSearch} onClose={() => setShowKeyboard(false)} />
              </div>
            )}
          </AnimatePresence>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {available.map((item, i) => {
              const inCart = cart.find((c) => c.id === item.id);
              return (
                <motion.button
                  key={item.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.03 }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => addToCart(item)}
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
            {available.length === 0 && (
              <p className="col-span-full text-center text-text-muted py-10">
                Aucun produit disponible au comptoir
              </p>
            )}
          </div>
        </div>

        {/* ---------------- Panier ---------------- */}
        <div className="bg-gradient-card border border-gold/15 rounded-2xl p-4 shadow-card h-fit lg:sticky lg:top-20">
          <h3 className="font-display font-semibold text-text-primary flex items-center gap-2 mb-3">
            <ShoppingBag size={18} /> Panier
            {priceOverrides > 0 && (
              <Badge variant="warning" className="ml-auto text-[10px]">
                {priceOverrides} prix modifié{priceOverrides > 1 ? 's' : ''}
              </Badge>
            )}
          </h3>

          {/* Client */}
          <div className="mb-3 relative">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <Input
                  value={clientSearch}
                  onChange={(e) => { setClientSearch(e.target.value); setClientId(null); }}
                  placeholder="Client…"
                  className="pl-9"
                />
                {clientResults.length > 0 && !clientId && (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-gold/20 bg-[--surface-dropdown] shadow-hover overflow-hidden">
                    {clientResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { setClientId(c.id); setClientSearch(c.name); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gold/10"
                      >
                        {c.name}
                        {c.phone && <span className="text-text-muted text-xs"> · {c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button size="icon" variant="secondary" onClick={() => setShowClientForm(true)}>
                <UserPlus size={16} />
              </Button>
            </div>
            {clientId ? (
              <p className="text-xs text-pistachio mt-1">✓ {clients.find((c) => c.id === clientId)?.name}</p>
            ) : (
              <p className="text-xs text-text-muted mt-1">{t('walkInClient')}</p>
            )}
          </div>

          {/* Lines */}
          <div className="space-y-2 mb-3 max-h-[22rem] overflow-y-auto pr-1">
            <AnimatePresence>
              {cart.map((l) => {
                const overridden = Math.abs(l.unitPrice - l.basePrice) > 0.001;
                return (
                  <motion.div
                    key={l.id}
                    layout
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="rounded-xl bg-vanilla/50 border border-gold/10 p-2.5"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {l.productName}
                          {l.unit && <span className="text-xs text-gold-dark"> · {l.unit}</span>}
                        </p>
                        <p className="text-[10px] text-text-muted">
                          Prix catalogue : {formatCurrency(l.basePrice)}{l.unit ? `/${l.unit}` : ''}
                        </p>
                      </div>
                      <button onClick={() => setCart(cart.filter((c) => c.id !== l.id))} className="text-rose-deep shrink-0">
                        <X size={14} />
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
                            onChange={(e) => setUnitPrice(l.id, Number(e.target.value))}
                            className={`w-full h-8 rounded-lg pl-8 pr-2 text-sm tabular font-semibold border-2 bg-[--surface-input] text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/30 ${
                              overridden ? 'border-caramel' : 'border-[--border-input]'
                            }`}
                          />
                        </div>
                      </div>
                      {overridden && (
                        <button
                          onClick={() => resetPrice(l.id)}
                          className="h-8 px-2 rounded-lg border border-gold/25 text-text-muted hover:text-gold-dark hover:bg-gold/10 transition-colors"
                          title="Revenir au prix catalogue"
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>

                    {/* Quantity + line total */}
                    <div className="flex items-center justify-between gap-2">
                      {l.sellByUnit ? (
                        <input
                          type="number" step="any" min={0}
                          value={l.quantity}
                          onChange={(e) => setQty(l.id, Number(e.target.value))}
                          className="w-24 h-8 rounded-lg bg-[--surface-input] border border-gold/20 px-2 text-sm tabular text-center focus:outline-none focus:ring-2 focus:ring-gold/40"
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          <button onClick={() => changeQty(l.id, -1)} className="h-7 w-7 rounded-md bg-[--surface-input] border border-gold/20 flex items-center justify-center">
                            <Minus size={12} />
                          </button>
                          <span className="w-8 text-center text-sm tabular font-semibold">{l.quantity}</span>
                          <button onClick={() => changeQty(l.id, 1)} className="h-7 w-7 rounded-md bg-[--surface-input] border border-gold/20 flex items-center justify-center">
                            <Plus size={12} />
                          </button>
                        </div>
                      )}
                      <span className="text-sm tabular font-bold text-gold-dark">
                        {formatCurrency(l.quantity * l.unitPrice)}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {cart.length === 0 && <p className="text-sm text-text-muted text-center py-6">Panier vide</p>}
          </div>

          {/* Totals */}
          <div className="border-t border-gold/15 pt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Sous-total</span>
              <span className="tabular">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <Switch checked={reductionEnabled} onChange={setReductionEnabled} label="Réduction" />
              {reductionEnabled && (
                <Input
                  type="number" value={reduction}
                  onChange={(e) => setReduction(Number(e.target.value))}
                  className="max-w-[100px] h-8"
                />
              )}
            </div>
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span className="tabular text-gold-dark">{formatCurrency(finalAmount)}</span>
            </div>
            <Input
              label="Le client paie"
              type="number"
              value={effectivePaid}
              onChange={(e) => { setPaid(Number(e.target.value)); setPaidEdited(true); }}
            />
            <div className="flex justify-between">
              <span className="text-text-muted">Monnaie à rendre</span>
              <span className="tabular text-pistachio">{formatCurrency(change)}</span>
            </div>
            {rest > 0 && (
              <div className="flex justify-between">
                <span className="text-text-muted">Reste (dette)</span>
                <span className="tabular text-rose-deep font-bold">{formatCurrency(rest)}</span>
              </div>
            )}
          </div>

          <div className="mt-3 space-y-2">
            <Button
              variant={rest <= 0 ? 'gold' : 'rose'}
              className="w-full"
              onClick={createSale}
              disabled={saving || cart.length === 0}
            >
              {saving ? 'Enregistrement…' : rest <= 0 ? 'Valider la vente (payée)' : 'Valider la vente (dette)'}
            </Button>
            {cart.length > 0 && (
              <Button variant="ghost" className="w-full" onClick={reset} disabled={saving}>Annuler</Button>
            )}
          </div>
        </div>
      </div>

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

      {/* Print prompt after a successful sale */}
      <Modal open={!!printPrompt} onClose={() => setPrintPrompt(null)} size="sm">
        <div className="flex flex-col items-center text-center py-2">
          <div className="h-14 w-14 rounded-full bg-pistachio/15 flex items-center justify-center mb-4">
            <CheckCircle2 size={30} className="text-pistachio" />
          </div>
          <h3 className="font-display text-lg font-semibold text-text-primary mb-1">Vente enregistrée</h3>
          <p className="text-sm text-text-secondary mb-1">{printPrompt?.reference}</p>
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
