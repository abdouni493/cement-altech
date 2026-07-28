import { useMemo, useState } from 'react';
import { CreditCard, Plus, Minus, X, Search, ShoppingBag, UserPlus, FlaskConical, Printer, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
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
import { motion, AnimatePresence } from 'framer-motion';
import type { Sale } from '@/types';

interface CartLine { id: string; productName: string; unitPrice: number; quantity: number; available: number; sellByUnit?: boolean; unit?: string; }

export default function POS() {
  const { t } = useLanguage();
  const items = useComptoirStore((s) => s.items);
  const { clients, addClient, getOrCreatePassager } = useClientStore();
  const addSale = useSalesStore((s) => s.addSale);
  const settings = useSettingsStore((s) => s.settings);
  const [printPrompt, setPrintPrompt] = useState<Sale | null>(null);

  const [search, setSearch] = useState('');
  const [keyboardEnabled, setKeyboardEnabled] = useState(() => localStorage.getItem('pos_keyboard_enabled') === 'true');
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [reductionEnabled, setReductionEnabled] = useState(false);
  const [reduction, setReduction] = useState<number>(0);
  const [paid, setPaid] = useState<number>(0);
  // Until the cashier edits "Client paie", it auto-follows the order total.
  const [paidEdited, setPaidEdited] = useState(false);
  const [showClientForm, setShowClientForm] = useState(false);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.quantity > 0 && i.categoryName) set.add(i.categoryName); });
    return [...set].map((name) => ({ value: name, label: name }));
  }, [items]);

  const available = useMemo(() => items.filter((i) =>
    i.quantity > 0 &&
    i.productName.toLowerCase().includes(search.toLowerCase()) &&
    (!categoryFilter || i.categoryName === categoryFilter)
  ), [items, search, categoryFilter]);
  const clientResults = useMemo(() => clientSearch ? clients.filter((c) => c.name.toLowerCase().includes(clientSearch.toLowerCase()) || c.phone.includes(clientSearch)).slice(0, 5) : [], [clientSearch, clients]);

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.quantity * l.unitPrice, 0), [cart]);
  const finalAmount = Math.max(0, subtotal - (reductionEnabled ? reduction : 0));
  // Defaults to the full total; the cashier can override it.
  const effectivePaid = paidEdited ? paid : finalAmount;
  const change = Math.max(0, effectivePaid - finalAmount);
  const rest = Math.max(0, finalAmount - effectivePaid);

  const addToCart = (item: typeof items[0]) => {
    const existing = cart.find((c) => c.id === item.id);
    if (existing) {
      if (existing.quantity >= item.quantity) { toast.warning('Stock insuffisant'); return; }
      setCart(cart.map((c) => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([...cart, { id: item.id, productName: item.productName, unitPrice: item.unitPrice, quantity: 1, available: item.quantity, sellByUnit: item.sellByUnit, unit: item.unit }]);
    }
  };

  const changeQty = (id: string, delta: number) => {
    setCart((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const q = c.quantity + delta;
      if (q > c.available) { toast.warning('Stock insuffisant'); return c; }
      return { ...c, quantity: Math.max(1, q) };
    }));
  };

  // Free-form quantity entry — used for products sold by unit (g / kg / …).
  const setQty = (id: string, value: number) => {
    setCart((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      if (value > c.available) { toast.warning('Stock insuffisant'); return { ...c, quantity: c.available }; }
      return { ...c, quantity: value < 0 ? 0 : value };
    }));
  };

  const reset = () => { setCart([]); setReduction(0); setReductionEnabled(false); setPaid(0); setPaidEdited(false); setClientId(null); setClientSearch(''); };

  const createSale = () => {
    if (cart.length === 0) { toast.error('Panier vide'); return; }
    if (rest > 0 && !clientId) { toast.error('Sélectionnez un client pour une vente à crédit'); return; }
    // No client selected → assign to the shared walk-in (passager) client, created on demand.
    const saleClientId = clientId ?? getOrCreatePassager(t('walkInClient')).id;
    const sale = addSale({
      clientId: saleClientId,
      date: new Date().toISOString(),
      products: cart.map((c) => ({ productId: c.id, productName: c.productName, quantity: c.quantity, sellingPrice: c.unitPrice, sellByUnit: c.sellByUnit, unit: c.unit })),
      reduction: reductionEnabled ? Number(reduction) : 0,
      paidAmount: Number(effectivePaid),
    });
    toast.success(rest > 0 ? 'Vente créée (dette)' : 'Vente créée et payée');
    setPrintPrompt(sale);
    reset();
  };

  const handlePrintInvoice = (sale: Sale) => {
    const cl = clients.find((c) => c.id === sale.clientId);
    printInvoice({
      type: 'sale', reference: sale.reference, date: sale.date,
      partyName: cl?.name || t('walkIn'), partyPhone: cl?.phone,
      lines: sale.products.map((l) => ({ designation: l.productName || '', quantity: l.quantity, unitPrice: l.sellingPrice })),
      total: sale.totalAmount, reduction: sale.reduction, final: sale.finalAmount, paid: sale.paidAmount, rest: sale.restAmount,
    }, settings);
    setPrintPrompt(null);
  };

  return (
    <div>
      <PageHeader
        title={t('pos')}
        icon={<CreditCard size={24} />}
        actions={
          <div className="flex items-center gap-2 bg-white/80 border border-gold/15 rounded-xl px-3 py-1.5 shadow-sm">
            <span className="text-xs font-semibold text-text-secondary">{t('virtualKeyboard')}</span>
            <Switch checked={keyboardEnabled} onChange={(val) => {
              setKeyboardEnabled(val);
              localStorage.setItem('pos_keyboard_enabled', String(val));
              if (!val) setShowKeyboard(false);
            }} />
          </div>
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Catalog */}
        <div className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[180px]">
              <SearchBar
                value={search}
                onChange={setSearch}
                placeholder={`${t('search')} produit`}
                onFocus={() => {
                  if (keyboardEnabled) {
                    setShowKeyboard(true);
                  }
                }}
              />
            </div>
            {categoryOptions.length > 0 && (
              <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} placeholder={t('allCategories')} options={categoryOptions} className="max-w-[200px]" />
            )}
          </div>
          <AnimatePresence>
            {keyboardEnabled && showKeyboard && (
              <div className="mb-4">
                <VirtualKeyboard
                  value={search}
                  onChange={setSearch}
                  onClose={() => setShowKeyboard(false)}
                />
              </div>
            )}
          </AnimatePresence>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {available.map((item, i) => (
              <motion.button
                key={item.id} custom={i} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }}
                whileHover={{ y: -3 }} whileTap={{ scale: 0.96 }}
                onClick={() => addToCart(item)}
                className="bg-gradient-card border border-gold/15 rounded-2xl p-4 text-left shadow-card hover:shadow-hover transition-shadow"
              >
                <div className="h-10 w-10 rounded-xl bg-gradient-rose flex items-center justify-center text-white mb-2"><FlaskConical size={20} /></div>
                <p className="font-medium text-text-primary text-sm truncate">{item.productName}</p>
                <p className="text-gold-dark font-bold tabular text-sm mt-1">{formatCurrency(item.unitPrice)}{item.sellByUnit && item.unit ? <span className="text-xs text-text-muted font-normal">/{item.unit}</span> : null}</p>
                <p className="text-xs text-text-muted">Dispo: {item.quantity}{item.sellByUnit && item.unit ? ` ${item.unit}` : ''}</p>
              </motion.button>
            ))}
            {available.length === 0 && <p className="col-span-full text-center text-text-muted py-10">{t('noData')}</p>}
          </div>
        </div>

        {/* Cart */}
        <div className="bg-gradient-card border border-gold/15 rounded-2xl p-4 shadow-card h-fit lg:sticky lg:top-20">
          <h3 className="font-display font-semibold text-text-primary flex items-center gap-2 mb-3"><ShoppingBag size={18} /> {t('cart')}</h3>

          {/* Client */}
          <div className="mb-3 relative">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <Input value={clientSearch} onChange={(e) => { setClientSearch(e.target.value); setClientId(null); }} placeholder={t('client')} className="pl-9" />
                {clientResults.length > 0 && !clientId && (
                  <div className="absolute z-20 mt-1 w-full bg-white rounded-xl border border-gold/20 shadow-hover overflow-hidden">
                    {clientResults.map((c) => <button key={c.id} onClick={() => { setClientId(c.id); setClientSearch(c.name); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gold/10">{c.name}</button>)}
                  </div>
                )}
              </div>
              <Button size="icon" variant="secondary" onClick={() => setShowClientForm(true)}><UserPlus size={16} /></Button>
            </div>
            {clientId ? (
              <p className="text-xs text-pistachio mt-1">✓ {clients.find((c) => c.id === clientId)?.name}</p>
            ) : (
              <p className="text-xs text-text-muted mt-1">{t('walkInClient')}</p>
            )}
          </div>

          {/* Items */}
          <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
            <AnimatePresence>
              {cart.map((l) => (
                <motion.div key={l.id} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                  className="flex items-center gap-2 bg-vanilla/50 rounded-xl p-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{l.productName}{l.sellByUnit && l.unit ? <span className="text-xs text-gold-dark"> · {l.unit}</span> : null}</p>
                    <p className="text-xs text-text-muted tabular">{formatCurrency(l.unitPrice)}{l.sellByUnit && l.unit ? `/${l.unit}` : ''} × {l.quantity}{l.sellByUnit && l.unit ? ` ${l.unit}` : ''}</p>
                  </div>
                  {l.sellByUnit ? (
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={l.quantity}
                      onChange={(e) => setQty(l.id, Number(e.target.value))}
                      className="w-20 h-7 rounded-md bg-white border border-gold/20 px-2 text-sm tabular text-center focus:outline-none focus:ring-2 focus:ring-gold/40"
                    />
                  ) : (
                    <div className="flex items-center gap-1">
                      <button onClick={() => changeQty(l.id, -1)} className="h-6 w-6 rounded-md bg-white border border-gold/20 flex items-center justify-center"><Minus size={12} /></button>
                      <span className="w-6 text-center text-sm tabular">{l.quantity}</span>
                      <button onClick={() => changeQty(l.id, 1)} className="h-6 w-6 rounded-md bg-white border border-gold/20 flex items-center justify-center"><Plus size={12} /></button>
                    </div>
                  )}
                  <span className="text-sm tabular font-semibold w-20 text-right">{formatCurrency(l.quantity * l.unitPrice)}</span>
                  <button onClick={() => setCart(cart.filter((c) => c.id !== l.id))} className="text-rose-deep"><X size={14} /></button>
                </motion.div>
              ))}
            </AnimatePresence>
            {cart.length === 0 && <p className="text-sm text-text-muted text-center py-6">Panier vide</p>}
          </div>

          {/* Totals */}
          <div className="border-t border-gold/15 pt-3 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-text-muted">{t('subtotal')}</span><span className="tabular">{formatCurrency(subtotal)}</span></div>
            <div className="flex items-center justify-between">
              <Switch checked={reductionEnabled} onChange={setReductionEnabled} label={t('reduction')} />
              {reductionEnabled && <Input type="number" value={reduction} onChange={(e) => setReduction(Number(e.target.value))} className="max-w-[100px] h-8" />}
            </div>
            <div className="flex justify-between text-base font-bold"><span>{t('total')}</span><span className="tabular text-gold-dark">{formatCurrency(finalAmount)}</span></div>
            <Input label={t('clientPays')} type="number" value={effectivePaid} onChange={(e) => { setPaid(Number(e.target.value)); setPaidEdited(true); }} />
            <div className="flex justify-between"><span className="text-text-muted">{t('change')}</span><span className="tabular text-pistachio">{formatCurrency(change)}</span></div>
            {rest > 0 && <div className="flex justify-between"><span className="text-text-muted">{t('rest')}</span><span className="tabular text-rose-deep font-bold">{formatCurrency(rest)}</span></div>}
          </div>

          <div className="mt-3 space-y-2">
            {rest <= 0 ? (
              <Button variant="gold" className="w-full" onClick={createSale}>{t('createSalePaid')} 🟢</Button>
            ) : (
              <Button variant="rose" className="w-full" onClick={createSale}>{t('createSaleDebt')} 🔴</Button>
            )}
            {cart.length > 0 && <Button variant="ghost" className="w-full" onClick={reset}>{t('cancel')}</Button>}
          </div>
        </div>
      </div>

      <Modal open={showClientForm} onClose={() => setShowClientForm(false)} title={t('newClient')} size="sm">
        <ClientForm onSubmit={(data) => { const c = addClient(data); setClientId(c.id); setClientSearch(c.name); setShowClientForm(false); toast.success('Client créé'); }} onCancel={() => setShowClientForm(false)} />
      </Modal>

      {/* Print invoice prompt after a successful sale */}
      <Modal open={!!printPrompt} onClose={() => setPrintPrompt(null)} size="sm">
        <div className="flex flex-col items-center text-center py-2">
          <div className="h-14 w-14 rounded-full bg-pistachio/15 flex items-center justify-center mb-4">
            <CheckCircle2 size={30} className="text-pistachio" />
          </div>
          <h3 className="font-display text-lg font-semibold text-text-primary mb-1">{t('createSalePaid').split('—')[0].trim()} ✅</h3>
          <p className="text-sm text-text-secondary mb-1">{printPrompt?.reference}</p>
          <p className="text-sm text-text-muted mb-6">Voulez-vous imprimer la facture ?</p>
          <div className="flex gap-3 w-full">
            <Button variant="secondary" className="flex-1" onClick={() => setPrintPrompt(null)}>Non, merci</Button>
            <Button variant="gold" className="flex-1" onClick={() => printPrompt && handlePrintInvoice(printPrompt)}>
              <Printer size={16} /> {t('print')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
