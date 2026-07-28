import { useMemo, useState } from 'react';
import { Banknote, Plus, Pencil, Trash2, Tag, Calendar } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { CategorySelect } from '@/components/shared/CategorySelect';
import { useExpenseStore } from '@/store/expenseStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, todayISO, matchesDateFilter, type DateFilter } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import type { Expense } from '@/types';

export default function ExpensesPage() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const {
    expenses, addExpense, updateExpense, deleteExpense,
    categories, addCategory, deleteCategory,
  } = useExpenseStore();

  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [catFilter, setCatFilter] = useState<string>(''); // '' = all
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', amount: 0, date: todayISO(), categoryId: '' });

  // Expenses matching search + date (before category filter) — drives the category totals
  const dateMatched = useMemo(
    () => expenses.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()) && matchesDateFilter(e.date, dateFilter)),
    [expenses, search, dateFilter]
  );

  // Totals grouped by category (over the date-matched set)
  const categoryTotals = useMemo(() => {
    const map = new Map<string, { id: string; name: string; total: number; count: number }>();
    dateMatched.forEach((e) => {
      const id = e.categoryId || '__none__';
      const name = e.categoryName || t('noCategory');
      const g = map.get(id) || { id, name, total: 0, count: 0 };
      g.total += e.amount;
      g.count += 1;
      map.set(id, g);
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [dateMatched, t]);

  const filtered = useMemo(
    () => dateMatched.filter((e) => !catFilter || (e.categoryId || '__none__') === catFilter),
    [dateMatched, catFilter]
  );
  const total = useMemo(() => filtered.reduce((s, e) => s + e.amount, 0), [filtered]);

  const openCreate = () => { setEditing(null); setForm({ name: '', description: '', amount: 0, date: todayISO(), categoryId: '' }); setFormOpen(true); };
  const openEdit = (e: Expense) => { setEditing(e); setForm({ name: e.name, description: e.description, amount: e.amount, date: e.date, categoryId: e.categoryId || '' }); setFormOpen(true); };

  const handleSubmit = () => {
    if (!form.name.trim() || form.amount <= 0) { toast.error('Nom et montant requis'); return; }
    const categoryName = form.categoryId ? categories.find((c) => c.id === form.categoryId)?.name : undefined;
    const payload = { ...form, amount: Number(form.amount), categoryId: form.categoryId || undefined, categoryName };
    if (editing) { updateExpense(editing.id, payload); toast.success('Dépense modifiée'); }
    else { addExpense(payload); toast.success('Dépense créée'); }
    setFormOpen(false);
  };

  const grandTotal = useMemo(() => dateMatched.reduce((s, e) => s + e.amount, 0), [dateMatched]);

  return (
    <div>
      <PageHeader title={t('expenses')} icon={<Banknote size={24} />} subtitle={`Total: ${formatCurrency(total)}`}
        actions={can('expenses', 'create') && <Button variant="gold" onClick={openCreate}><Plus size={18} /> {t('newExpense')}</Button>} />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex-1 min-w-[200px]"><SearchBar value={search} onChange={setSearch} placeholder={t('search')} /></div>
        <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)}
          options={[{ value: 'all', label: t('all') }, { value: 'today', label: t('today') }, { value: 'week', label: t('week') }, { value: 'month', label: t('month') }]} className="max-w-[180px]" />
      </div>

      {/* ===== Category totals + filter chips ===== */}
      {categoryTotals.length > 0 && (
        <Card index={0} className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-text-primary flex items-center gap-2"><Tag size={18} className="text-gold-dark" /> {t('expensesByCategory')}</h3>
            <span className="text-sm font-bold tabular text-rose-deep">{formatCurrency(grandTotal)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setCatFilter('')}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${!catFilter ? 'border-gold/40 bg-gold/10 text-gold-dark font-semibold' : 'border-gold/15 bg-vanilla/40 text-text-secondary hover:border-gold/30'}`}
            >
              {t('all')} <span className="tabular font-bold">{formatCurrency(grandTotal)}</span>
            </button>
            {categoryTotals.map((cat) => {
              const active = catFilter === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setCatFilter(active ? '' : cat.id)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${active ? 'border-gold/40 bg-gold/10 text-gold-dark font-semibold' : 'border-gold/15 bg-vanilla/40 text-text-secondary hover:border-gold/30'}`}
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

      {filtered.length === 0 ? <EmptyState message={t('noData')} /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((e, i) => (
            <Card key={e.id} index={i} hoverable className="flex flex-col">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-display font-semibold text-text-primary flex items-center gap-2"><Tag size={16} className="text-caramel" /> {e.name}</h3>
                <span className="text-xs text-text-muted flex items-center gap-1"><Calendar size={11} /> {formatDate(e.date, language)}</span>
              </div>
              {e.categoryName && <span className="self-start inline-flex items-center gap-1 text-[10px] font-medium text-gold-dark bg-gold/10 rounded-full px-2 py-0.5 mb-2"><Tag size={9} /> {e.categoryName}</span>}
              <p className="text-sm text-text-secondary mb-3 line-clamp-2">{e.description}</p>
              <p className="text-2xl font-bold text-rose-deep tabular mb-1">{formatCurrency(e.amount)}</p>
              {e.createdBy && <p className="text-xs text-text-muted mb-3">{t('createdBy')}: {e.createdBy}</p>}
              <div className="flex gap-2 mt-auto">
                {can('expenses', 'edit') && <Button size="sm" variant="secondary" className="flex-1" onClick={() => openEdit(e)}><Pencil size={14} /> {t('edit')}</Button>}
                {can('expenses', 'delete') && <Button size="sm" variant="ghost" onClick={() => setDeleteId(e.id)}><Trash2 size={14} className="text-rose-deep" /></Button>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('edit') : t('newExpense')} size="sm">
        <div className="space-y-4">
          <Input label={`${t('name')} *`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <CategorySelect
            label={t('category')}
            categories={categories}
            value={form.categoryId}
            onChange={(id) => setForm({ ...form, categoryId: id })}
            onCreate={addCategory}
            onDelete={deleteCategory}
          />
          <Textarea label={t('description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={`${t('amount')} (DA) *`} type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
            <Input label={`${t('date')} *`} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setFormOpen(false)}>{t('cancel')}</Button>
            <Button variant="gold" onClick={handleSubmit}>{t('save')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => { if (deleteId) { deleteExpense(deleteId); toast.success('Dépense supprimée'); } }} />
    </div>
  );
}
