import { useMemo, useState } from 'react';
import {
  Banknote, Plus, Pencil, Trash2, Tag, Calendar, FileText, Printer, X,
  ClipboardList, Coins, TrendingDown,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/shared/StatCard';
import { CategorySelect } from '@/components/shared/CategorySelect';
import { UnitSelect } from '@/components/shared/UnitSelect';
import { useExpenseStore } from '@/store/expenseStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, todayISO, matchesDateFilter, type DateFilter } from '@/lib/utils';
import { printPurchaseOrder } from '@/lib/documents';
import { toast } from '@/components/ui/Toast';
import type { Expense, PurchaseOrder, PurchaseOrderItem } from '@/types';

type MainTab = 'expenses' | 'orders';

export default function ExpensesPage() {
  const { language } = useLanguage();
  const { can } = usePermissions();
  const {
    expenses, addExpense, updateExpense, deleteExpense,
    categories, addCategory, deleteCategory,
    orders, addOrder, updateOrder, deleteOrder,
  } = useExpenseStore();
  const settings = useSettingsStore((s) => s.settings);

  const [tab, setTab] = useState<MainTab>('expenses');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [catFilter, setCatFilter] = useState<string>('');

  // expense form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', amount: 0, date: todayISO(), categoryId: '' });
  const [saving, setSaving] = useState(false);

  // purchase-order form
  const [orderOpen, setOrderOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);
  const [orderForm, setOrderForm] = useState<{ date: string; supplierName: string; notes: string; items: PurchaseOrderItem[] }>({
    date: todayISO(), supplierName: '', notes: '', items: [{ productName: '', description: '', quantity: 1, unit: '' }],
  });
  const [printOrderPrompt, setPrintOrderPrompt] = useState<PurchaseOrder | null>(null);

  /* ------------------------------------------------------------ expenses */
  const dateMatched = useMemo(
    () =>
      expenses.filter(
        (e) => e.name.toLowerCase().includes(search.toLowerCase()) && matchesDateFilter(e.date, dateFilter)
      ),
    [expenses, search, dateFilter]
  );

  const categoryTotals = useMemo(() => {
    const map = new Map<string, { id: string; name: string; total: number; count: number }>();
    dateMatched.forEach((e) => {
      const id = e.categoryId || '__none__';
      const name = e.categoryName || 'Sans catégorie';
      const g = map.get(id) || { id, name, total: 0, count: 0 };
      g.total += e.amount;
      g.count += 1;
      map.set(id, g);
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [dateMatched]);

  const filtered = useMemo(
    () => dateMatched.filter((e) => !catFilter || (e.categoryId || '__none__') === catFilter),
    [dateMatched, catFilter]
  );
  const total = useMemo(() => filtered.reduce((s, e) => s + e.amount, 0), [filtered]);
  const grandTotal = useMemo(() => dateMatched.reduce((s, e) => s + e.amount, 0), [dateMatched]);
  const monthTotal = useMemo(() => {
    const now = new Date();
    return expenses
      .filter((e) => {
        const d = new Date(e.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((s, e) => s + e.amount, 0);
  }, [expenses]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', amount: 0, date: todayISO(), categoryId: '' });
    setFormOpen(true);
  };
  const openEdit = (e: Expense) => {
    setEditing(e);
    setForm({ name: e.name, description: e.description, amount: e.amount, date: e.date, categoryId: e.categoryId || '' });
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || form.amount <= 0) { toast.error('Nom et montant requis'); return; }
    setSaving(true);
    try {
      const categoryName = form.categoryId ? categories.find((c) => c.id === form.categoryId)?.name : undefined;
      const payload = {
        ...form,
        amount: Number(form.amount),
        categoryId: form.categoryId || undefined,
        categoryName,
      };
      if (editing) {
        await updateExpense(editing.id, payload);
        toast.success('Dépense modifiée');
      } else {
        await addExpense(payload);
        toast.success('Dépense enregistrée — sortie de caisse créée');
      }
      setFormOpen(false);
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------------------------------ purchase orders */
  const filteredOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.reference.toLowerCase().includes(search.toLowerCase()) ||
          (o.supplierName || '').toLowerCase().includes(search.toLowerCase()) ||
          o.items.some((i) => i.productName.toLowerCase().includes(search.toLowerCase()))
      ),
    [orders, search]
  );

  const openOrderCreate = () => {
    setEditingOrder(null);
    setOrderForm({ date: todayISO(), supplierName: '', notes: '', items: [{ productName: '', description: '', quantity: 1, unit: '' }] });
    setOrderOpen(true);
  };
  const openOrderEdit = (o: PurchaseOrder) => {
    setEditingOrder(o);
    setOrderForm({
      date: o.date, supplierName: o.supplierName || '', notes: o.notes || '',
      items: o.items.length ? o.items : [{ productName: '', description: '', quantity: 1, unit: '' }],
    });
    setOrderOpen(true);
  };

  const setItem = (idx: number, data: Partial<PurchaseOrderItem>) =>
    setOrderForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...data } : it)) }));
  const addItemRow = () =>
    setOrderForm((f) => ({ ...f, items: [...f.items, { productName: '', description: '', quantity: 1, unit: '' }] }));
  const removeItemRow = (idx: number) =>
    setOrderForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const handleSaveOrder = async () => {
    const items = orderForm.items.filter((i) => i.productName.trim() && Number(i.quantity) > 0);
    if (items.length === 0) { toast.error('Ajoutez au moins un produit avec une quantité'); return; }
    setSaving(true);
    try {
      const payload = {
        date: orderForm.date,
        supplierName: orderForm.supplierName.trim(),
        notes: orderForm.notes.trim(),
        items: items.map((i) => ({ ...i, quantity: Number(i.quantity) })),
      };
      if (editingOrder) {
        await updateOrder(editingOrder.id, payload);
        toast.success('Bon de commande modifié');
        const refreshed = useExpenseStore.getState().orders.find((o) => o.id === editingOrder.id);
        if (refreshed) setPrintOrderPrompt(refreshed);
      } else {
        const created = await addOrder(payload);
        toast.success('Bon de commande créé');
        if (created) setPrintOrderPrompt(created);
      }
      setOrderOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const doPrintOrder = (o: PurchaseOrder) =>
    printPurchaseOrder(
      { reference: o.reference, date: o.date, supplierName: o.supplierName, notes: o.notes, items: o.items },
      settings
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dépenses"
        icon={<Banknote size={24} />}
        subtitle={`${formatCurrency(total)} sur la période · ${orders.length} bon(s) de commande`}
        actions={
          <div className="flex gap-2">
            {can('expenses', 'create') && (
              <Button variant="secondary" onClick={openOrderCreate}>
                <ClipboardList size={18} /> Bon de commande
              </Button>
            )}
            {can('expenses', 'create') && (
              <Button variant="gold" onClick={openCreate}>
                <Plus size={18} /> Nouvelle dépense
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total période" value={total} format="currency" icon={<Coins size={22} />} index={0} accent="rose" />
        <StatCard label="Dépenses du mois" value={monthTotal} format="currency" icon={<TrendingDown size={22} />} index={1} accent="caramel" />
        <StatCard label="Nombre de dépenses" value={filtered.length} icon={<Banknote size={22} />} index={2} accent="gold" />
        <StatCard label="Bons de commande" value={orders.length} icon={<ClipboardList size={22} />} index={3} accent="lavender" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gold/15">
        {([['expenses', `Dépenses (${expenses.length})`], ['orders', `Bons de commande (${orders.length})`]] as const).map(
          ([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all border-b-2 -mb-[2px] ${
                tab === key ? 'border-gold-dark text-gold-dark' : 'border-transparent text-text-muted hover:text-text-secondary'
              }`}
            >
              {key === 'expenses' ? <Banknote size={16} /> : <ClipboardList size={16} />} {label}
            </button>
          )
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder={tab === 'expenses' ? 'Rechercher une dépense…' : 'Rechercher un bon de commande…'}
          />
        </div>
        {tab === 'expenses' && (
          <Select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            options={[
              { value: 'all', label: 'Toutes les dates' },
              { value: 'today', label: "Aujourd'hui" },
              { value: 'week', label: 'Cette semaine' },
              { value: 'month', label: 'Ce mois' },
            ]}
            className="max-w-[190px]"
          />
        )}
      </div>

      {/* ==================== EXPENSES ==================== */}
      {tab === 'expenses' && (
        <>
          {categoryTotals.length > 0 && (
            <Card index={0}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display font-semibold text-text-primary flex items-center gap-2">
                  <Tag size={18} className="text-gold-dark" /> Dépenses par catégorie
                </h3>
                <span className="text-sm font-bold tabular text-rose-deep">{formatCurrency(grandTotal)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setCatFilter('')}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                    !catFilter ? 'border-gold/40 bg-gold/10 text-gold-dark font-semibold' : 'border-gold/15 bg-vanilla/40 text-text-secondary hover:border-gold/30'
                  }`}
                >
                  Tout <span className="tabular font-bold">{formatCurrency(grandTotal)}</span>
                </button>
                {categoryTotals.map((cat) => {
                  const active = catFilter === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setCatFilter(active ? '' : cat.id)}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                        active ? 'border-gold/40 bg-gold/10 text-gold-dark font-semibold' : 'border-gold/15 bg-vanilla/40 text-text-secondary hover:border-gold/30'
                      }`}
                    >
                      <Tag size={13} className="text-gold-dark" /> {cat.name}
                      <span className="tabular font-bold text-rose-deep">{formatCurrency(cat.total)}</span>
                      <span className="text-[10px] text-text-muted">({cat.count})</span>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {filtered.length === 0 ? (
            <EmptyState message="Aucune dépense pour ces filtres" icon={<Banknote size={32} />} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((e, i) => (
                <Card key={e.id} index={i} hoverable className="flex flex-col">
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <h3 className="font-display font-semibold text-text-primary flex items-center gap-2 min-w-0">
                      <Tag size={16} className="text-caramel shrink-0" />
                      <span className="truncate">{e.name}</span>
                    </h3>
                    <span className="text-xs text-text-muted flex items-center gap-1 shrink-0">
                      <Calendar size={11} /> {formatDate(e.date, language)}
                    </span>
                  </div>
                  {e.categoryName && (
                    <span className="self-start inline-flex items-center gap-1 text-[10px] font-medium text-gold-dark bg-gold/10 rounded-full px-2 py-0.5 mb-2">
                      <Tag size={9} /> {e.categoryName}
                    </span>
                  )}
                  {e.description && <p className="text-sm text-text-secondary mb-3 line-clamp-2">{e.description}</p>}
                  <p className="text-2xl font-bold text-rose-deep tabular mb-1">{formatCurrency(e.amount)}</p>
                  {e.createdBy && <p className="text-xs text-text-muted mb-3">Créé par {e.createdBy}</p>}
                  <div className="flex gap-2 mt-auto">
                    {can('expenses', 'edit') && (
                      <Button size="sm" variant="secondary" className="flex-1" onClick={() => openEdit(e)}>
                        <Pencil size={14} /> Modifier
                      </Button>
                    )}
                    {can('expenses', 'delete') && (
                      <Button size="sm" variant="ghost" onClick={() => setDeleteId(e.id)}>
                        <Trash2 size={14} className="text-rose-deep" />
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* ==================== PURCHASE ORDERS ==================== */}
      {tab === 'orders' && (
        filteredOrders.length === 0 ? (
          <EmptyState message="Aucun bon de commande" icon={<ClipboardList size={32} />} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredOrders.map((o, i) => (
              <Card key={o.id} index={i} hoverable className="flex flex-col">
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-gold">{o.reference}</span>
                    <h3 className="font-display font-semibold text-text-primary truncate">
                      {o.supplierName || 'Sans fournisseur'}
                    </h3>
                  </div>
                  <span className="text-xs text-text-muted flex items-center gap-1 shrink-0">
                    <Calendar size={11} /> {formatDate(o.date, language)}
                  </span>
                </div>

                <div className="rounded-xl border border-gold/10 bg-vanilla/40 p-3 mb-3 space-y-1.5">
                  {o.items.slice(0, 4).map((it, idx) => (
                    <div key={idx} className="flex justify-between text-xs">
                      <span className="text-text-secondary truncate max-w-[140px]">{it.productName}</span>
                      <span className="tabular font-semibold text-text-primary">
                        {it.quantity}{it.unit ? ` ${it.unit}` : ''}
                      </span>
                    </div>
                  ))}
                  {o.items.length > 4 && (
                    <p className="text-[10px] text-text-muted">+ {o.items.length - 4} autre(s) produit(s)</p>
                  )}
                </div>

                {o.notes && <p className="text-xs text-text-muted italic mb-3 line-clamp-2">« {o.notes} »</p>}

                <div className="flex gap-1.5 mt-auto">
                  <Button size="sm" variant="gold" className="flex-1 text-xs" onClick={() => doPrintOrder(o)}>
                    <Printer size={14} /> Imprimer
                  </Button>
                  {can('expenses', 'edit') && (
                    <Button size="sm" variant="secondary" onClick={() => openOrderEdit(o)} title="Modifier">
                      <Pencil size={14} />
                    </Button>
                  )}
                  {can('expenses', 'delete') && (
                    <Button size="sm" variant="ghost" onClick={() => setDeleteOrderId(o.id)} title="Supprimer">
                      <Trash2 size={14} className="text-rose-deep" />
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {/* ---- Expense modal ---- */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Modifier la dépense' : 'Nouvelle dépense'} size="sm">
        <div className="space-y-4">
          <Input label="Nom *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          <CategorySelect
            label="Catégorie"
            categories={categories}
            value={form.categoryId}
            onChange={(id) => setForm({ ...form, categoryId: id })}
            onCreate={addCategory}
            onDelete={deleteCategory}
          />
          <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Montant (DA) *" type="number" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
            <Input label="Date *" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>Annuler</Button>
            <Button variant="gold" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---- Purchase order modal ---- */}
      <Modal
        open={orderOpen}
        onClose={() => setOrderOpen(false)}
        title={editingOrder ? `Modifier ${editingOrder.reference}` : 'Nouveau bon de commande'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-gold/20 bg-gold/5 px-4 py-3 flex items-start gap-2.5">
            <FileText size={18} className="text-gold shrink-0 mt-0.5" />
            <p className="text-xs text-text-secondary">
              Le bon de commande décrit ce que vous demandez à un fournisseur : nom du produit,
              description, quantité et unité. Il est imprimable et n'a aucun impact sur la caisse
              ni sur le stock.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Date" type="date" value={orderForm.date} onChange={(e) => setOrderForm({ ...orderForm, date: e.target.value })} />
            <Input
              label="Fournisseur (optionnel)"
              value={orderForm.supplierName}
              onChange={(e) => setOrderForm({ ...orderForm, supplierName: e.target.value })}
              placeholder="Nom du fournisseur destinataire"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-display font-semibold text-text-primary">Produits demandés</h4>
              <Button size="sm" variant="secondary" onClick={addItemRow}>
                <Plus size={14} /> Ajouter un produit
              </Button>
            </div>

            {orderForm.items.map((it, idx) => (
              <div key={idx} className="rounded-xl border border-gold/15 bg-vanilla/30 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gold">Produit {idx + 1}</span>
                  {orderForm.items.length > 1 && (
                    <button onClick={() => removeItemRow(idx)} className="text-rose-deep p-1 rounded-lg hover:bg-rose-deep/10">
                      <X size={15} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Input
                    label="Nom du produit *"
                    value={it.productName}
                    onChange={(e) => setItem(idx, { productName: e.target.value })}
                    placeholder="Ex : Ciment CRS 42.5"
                  />
                  <div className="grid grid-cols-2 gap-2.5">
                    <Input
                      label="Quantité *" type="number" step="any" min={0}
                      value={it.quantity}
                      onChange={(e) => setItem(idx, { quantity: Number(e.target.value) })}
                    />
                    <UnitSelect
                      label="Unité"
                      value={it.unit || ''}
                      onChange={(u) => setItem(idx, { unit: u })}
                      compact
                      allowDelete={false}
                    />
                  </div>
                </div>
                <Textarea
                  label="Description"
                  value={it.description}
                  onChange={(e) => setItem(idx, { description: e.target.value })}
                  placeholder="Qualité attendue, conditionnement, délai…"
                  rows={2}
                />
              </div>
            ))}
          </div>

          <Textarea
            label="Observations générales"
            value={orderForm.notes}
            onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })}
            rows={2}
          />

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setOrderOpen(false)} disabled={saving}>Annuler</Button>
            <Button variant="gold" onClick={handleSaveOrder} disabled={saving}>
              {saving ? 'Enregistrement…' : editingOrder ? 'Mettre à jour' : 'Créer le bon de commande'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---- Print prompt ---- */}
      <Modal open={!!printOrderPrompt} onClose={() => setPrintOrderPrompt(null)} size="sm">
        <div className="flex flex-col items-center text-center py-2">
          <div className="h-14 w-14 rounded-full bg-gold/15 flex items-center justify-center mb-4">
            <ClipboardList size={28} className="text-gold" />
          </div>
          <h3 className="font-display text-lg font-semibold text-text-primary mb-1">Bon de commande enregistré</h3>
          <p className="text-sm text-text-secondary mb-1">{printOrderPrompt?.reference}</p>
          <p className="text-sm text-text-muted mb-6">Voulez-vous l'imprimer maintenant ?</p>
          <div className="flex gap-3 w-full">
            <Button variant="secondary" className="flex-1" onClick={() => setPrintOrderPrompt(null)}>Plus tard</Button>
            <Button
              variant="gold" className="flex-1"
              onClick={() => { if (printOrderPrompt) doPrintOrder(printOrderPrompt); setPrintOrderPrompt(null); }}
            >
              <Printer size={16} /> Imprimer
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) void deleteExpense(deleteId).then(() => toast.success('Dépense supprimée')); }}
        title="Supprimer la dépense"
        message="La sortie de caisse correspondante sera également annulée."
      />
      <ConfirmDialog
        open={!!deleteOrderId}
        onClose={() => setDeleteOrderId(null)}
        onConfirm={() => { if (deleteOrderId) void deleteOrder(deleteOrderId).then(() => toast.success('Bon de commande supprimé')); }}
        title="Supprimer le bon de commande"
      />
    </div>
  );
}
