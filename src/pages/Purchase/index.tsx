import { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart, Plus, Eye, Wallet, Printer, Trash2, Calendar, Folder, DollarSign, TrendingDown, CheckCircle2, FileText, CarFront, History, PencilLine, Bike } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { DataTable, useViewMode, type DataColumn } from '@/components/ui/DataTable';
import type { ActionItem } from '@/components/ui/ActionMenu';
import { CreatePurchase } from './CreatePurchase';
import { PayDebtModal } from '@/components/shared/PayDebtModal';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useDelivererStore } from '@/store/delivererStore';
import { useStockStore } from '@/store/stockStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, todayISO, type DateFilter } from '@/lib/utils';
import { getPurchase, isPurchaseSummary, listPurchaseSummaries, type PurchaseSummaryPage } from '@/lib/purchaseQueries';
import { useAuthStore } from '@/store/authStore';
import { isWriteBusy } from '@/lib/persist';
import { printInvoice } from '@/lib/print';
import { toast } from '@/components/ui/Toast';
import type { Purchase } from '@/types';

export default function PurchasePage() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const { revision, payDebt, deletePurchase } = usePurchaseStore();
  const accountId = useAuthStore((s) => s.user?.id);
  const suppliers = useSupplierStore((s) => s.suppliers);
  const delivererAssignments = useDelivererStore((s) => s.assignments);
  const settings = useSettingsStore((s) => s.settings);
  const stockProducts = useStockStore((s) => s.products);
  const units = useStockStore((s) => s.units);

  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter | 'period'>('all');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [unitFilter, setUnitFilter] = useState('');
  // Toutes les interfaces s'ouvrent en TABLEAU par defaut ; le choix de
  // l'operateur est memorise pour cet ecran.
  const [view, setView] = useViewMode('purchase');

  const [createOpen, setCreateOpen] = useState(false);
  /** Ouvre le même formulaire en mode « ancien achat » (saisie rétroactive). */
  const [createHistoricalOpen, setCreateHistoricalOpen] = useState(false);
  const [viewing, setViewing] = useState<Purchase | null>(null);
  /** Facture rouverte dans le formulaire de création pour être corrigée. */
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [paying, setPaying] = useState<Purchase | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const supplierNames = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const productUnits = useMemo(() => new Map(stockProducts.map((p) => [p.id, p.unit])), [stockProducts]);
  const supplierName = (id: string) => supplierNames.get(id) || '—';
  const [page, setPage] = useState(0);
  const [pageData, setPageData] = useState<PurchaseSummaryPage | null>(null);
  const [pageOwner, setPageOwner] = useState(accountId);
  const [listError, setListError] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const readGeneration = useRef(0);
  const PAGE_SIZE = 50;

  useEffect(() => { setPage(0); }, [search, dateFilter, startDate, endDate, unitFilter, accountId]);
  useEffect(() => {
    setPageData(null); setViewing(null); setEditing(null); setPaying(null); setDeleteId(null);
    setCreateOpen(false); setCreateHistoricalOpen(false);
  }, [accountId]);
  useEffect(() => {
    const generation = ++readGeneration.current;
    setListLoading(true); setListError('');
    const now = new Date();
    let from: string | null = null; let to: string | null = null;
    if (dateFilter === 'today') from = to = todayISO();
    else if (dateFilter === 'week') {
      const start = new Date(); start.setDate(start.getDate() - 6);
      from = start.toISOString().slice(0, 10); to = todayISO();
    } else if (dateFilter === 'month') {
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`;
    } else if (dateFilter === 'period') { from = startDate; to = endDate; }
    const q = search.toLowerCase();
    const delivererIds = q ? Object.entries(delivererAssignments)
      .filter(([, a]) => (a.delivererName || '').toLowerCase().includes(q)).map(([id]) => id) : [];
    const timer = window.setTimeout(() => {
      void listPurchaseSummaries({ search, unit: unitFilter, from, to, delivererIds,
        limit: PAGE_SIZE, offset: page * PAGE_SIZE }).then((result) => {
        if (generation !== readGeneration.current) return;
        setPageData(result); setPageOwner(accountId); setListLoading(false);
        if (page > 0 && page * PAGE_SIZE >= result.totalCount) setPage(Math.max(0, Math.ceil(result.totalCount / PAGE_SIZE) - 1));
      }).catch((error: Error) => {
        if (generation !== readGeneration.current) return;
        setListError(error.message); setListLoading(false);
      });
    }, 150);
    return () => { window.clearTimeout(timer); readGeneration.current += 1; };
  }, [search, dateFilter, startDate, endDate, unitFilter, delivererAssignments, page, revision, refreshVersion, accountId]);

  useEffect(() => {
    const refresh = () => {
      if (!isWriteBusy() && document.visibilityState !== 'hidden') setRefreshVersion((v) => v + 1);
    };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, []);

  const visiblePage = pageOwner === accountId ? pageData : null;
  const filtered = visiblePage?.rows ?? [];
  const stats = visiblePage?.stats ?? { totalPurchases: 0, totalPaid: 0, totalDebt: 0 };
  const itemCount = (p: Purchase) => isPurchaseSummary(p) ? p.lineCount : p.products.length;
  const withDetail = async (purchase: Purchase, action: (p: Purchase) => void) => {
    try {
      const row = isPurchaseSummary(purchase) ? await getPurchase(purchase.id) : purchase;
      if (accountId === useAuthStore.getState().user?.id) action(row);
    }
    catch (error) { toast.error((error as Error).message); }
  };

  /** Units involved in an invoice — displayed as badges on the card. */
  const getPurchaseUnits = (purchase: Purchase) => {
    if (isPurchaseSummary(purchase)) return purchase.units;
    const list = purchase.products
      .map((line) => line.unit || productUnits.get(line.productId) || null)
      .filter(Boolean) as string[];
    return Array.from(new Set(list));
  };

  const handlePrint = (p: Purchase) => {
    if (isPurchaseSummary(p)) { void withDetail(p, handlePrint); return; }
    const sup = suppliers.find((s) => s.id === p.supplierId);
    printInvoice({
      type: 'purchase', reference: p.reference, date: p.date,
      partyName: sup?.name || '—', partyPhone: sup?.phone, partyAddress: sup?.address,
      bonNumber: p.bonNumber, driverPlate: p.driverPlate, historical: p.isHistorical,
      lines: p.products.map((l) => ({ designation: l.productName || '', quantity: l.quantity, unitPrice: l.purchasePrice })),
      total: p.totalAmount, paid: p.paidAmount, rest: p.restAmount,
    }, settings);
  };

  /* ------------------------------------------------------------ tableau --
   * Les actions ne sont plus alignees sur chaque ligne : elles sont
   * regroupees dans le menu « trois points » de la derniere colonne.
   * -------------------------------------------------------------------- */
  const purchaseColumns: DataColumn<Purchase>[] = [
    {
      key: 'ref', label: t('reference'),
      render: (p) => (
        <span className="flex items-center gap-1.5 font-semibold">
          {p.reference}
          {p.isHistorical && (
            <Badge variant="warning" className="px-1.5 py-0 text-[9px]"><History size={9} /> Ancien</Badge>
          )}
        </span>
      ),
    },
    { key: 'supplier', label: t('supplier'), render: (p) => supplierName(p.supplierId) },
    { key: 'date', label: t('date'), render: (p) => formatDate(p.date, language) },
    { key: 'bon', label: 'N° BL / matricule', hideOnMobile: true,
      render: (p) => [p.bonNumber, p.driverPlate].filter(Boolean).join(' · ') || '—' },
    { key: 'items', label: 'Articles', align: 'right', render: (p) => itemCount(p) },
    { key: 'total', label: t('total'), align: 'right', render: (p) => formatCurrency(p.totalAmount) },
    { key: 'paid', label: t('paid'), align: 'right',
      render: (p) => <span className="text-pistachio">{formatCurrency(p.paidAmount)}</span> },
    { key: 'rest', label: t('rest'), align: 'right',
      render: (p) => (
        <span className={p.restAmount > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>
          {formatCurrency(p.restAmount)}
        </span>
      ) },
  ];

  const purchaseActions = (p: Purchase): ActionItem[] => [
    { label: 'Voir le détail', icon: <Eye size={15} />, onClick: () => { void withDetail(p, setViewing); } },
    { label: 'Modifier la facture', icon: <PencilLine size={15} />, hidden: !can('purchase', 'edit'),
      onClick: () => { void withDetail(p, setEditing); } },
    { label: 'Payer la dette', icon: <Wallet size={15} />,
      hidden: !can('purchase', 'pay') || p.restAmount <= 0, onClick: () => { void withDetail(p, setPaying); } },
    { label: t('print'), icon: <Printer size={15} />, onClick: () => handlePrint(p) },
    { label: t('delete'), icon: <Trash2 size={15} />, danger: true, hidden: !can('purchase', 'delete'),
      onClick: () => setDeleteId(p.id) },
  ];

  return (
    <div>
      <PageHeader title={t('purchase')} icon={<ShoppingCart size={24} />} subtitle={`${visiblePage?.totalCount ?? 0} factures`}
        actions={can('purchase', 'create') && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="gold" onClick={() => setCreateOpen(true)}><Plus size={18} /> {t('newPurchase')}</Button>
            <Button
              variant="secondary"
              onClick={() => setCreateHistoricalOpen(true)}
              title="Saisir une facture d'achat antérieure sans toucher au stock actuel"
            >
              <History size={18} /> Ancien achat
            </Button>
          </div>
        )}
      />

      {/* Stats Cards Section */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 animate-fadeIn">
        <div className="bg-gradient-to-br from-gold/10 to-gold/5 border border-gold/20 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Total des Achats</p>
            <p className="text-xl font-bold text-gold-dark mt-1 tabular">{formatCurrency(stats.totalPurchases)}</p>
          </div>
          <div className="bg-gold/15 p-3 rounded-xl text-gold-dark">
            <DollarSign size={20} />
          </div>
        </div>

        <div className="bg-gradient-to-br from-pistachio/10 to-pistachio/5 border border-pistachio/20 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Total Payé</p>
            <p className="text-xl font-bold text-pistachio mt-1 tabular">{formatCurrency(stats.totalPaid)}</p>
          </div>
          <div className="bg-pistachio/15 p-3 rounded-xl text-pistachio">
            <CheckCircle2 size={20} />
          </div>
        </div>

        <div className="bg-gradient-to-br from-rose-deep/10 to-rose-deep/5 border border-rose-deep/20 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Total Dette / Restant</p>
            <p className="text-xl font-bold text-rose-deep mt-1 tabular">{formatCurrency(stats.totalDebt)}</p>
          </div>
          <div className="bg-rose-deep/15 p-3 rounded-xl text-rose-deep">
            <TrendingDown size={20} />
          </div>
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6 bg-vanilla/20 p-4 rounded-2xl border border-gold/10">
        <div className="flex-1 min-w-[200px]">
          <SearchBar value={search} onChange={setSearch} placeholder={`${t('search')} ${t('supplier')}, Réf., n° de bon ou matricule`} />
        </div>
        
        {/* Unit filtering */}
        <div className="w-[180px] flex items-center gap-2">
          <Folder size={16} className="text-gold-dark shrink-0" />
          <Select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            placeholder="Toutes unités"
            options={units.map((u) => ({ value: u.name, label: u.name }))}
            className="w-full"
          />
        </div>

        {/* Date filtering */}
        <div className="w-[180px] flex items-center gap-2">
          <Calendar size={16} className="text-gold-dark shrink-0" />
          <Select 
            value={dateFilter} 
            onChange={(e) => setDateFilter(e.target.value as any)}
            options={[
              { value: 'all', label: t('all') }, 
              { value: 'today', label: 'Ce jour' }, 
              { value: 'week', label: 'La semaine dernière' }, 
              { value: 'month', label: 'Le mois dernier' },
              { value: 'period', label: 'Par période' }
            ]}
            className="w-full" 
          />
        </div>

        <ViewToggle view={view} onChange={setView} />

        {/* Period inputs */}
        {/* Champs de date de l'application : affiches en jj/mm/aaaa comme
            partout ailleurs, et non au format de la langue du navigateur. */}
        {dateFilter === 'period' && (
          <div className="flex items-end gap-2 animate-fadeIn">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="max-w-[170px]"
            />
            <span className="pb-2.5 text-xs text-text-muted">à</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="max-w-[170px]"
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 text-sm">
        <Button variant="secondary" size="sm" disabled={listLoading} onClick={() => setRefreshVersion((v) => v + 1)}>Actualiser</Button>
        <span>{listLoading ? 'Chargement…' : `${visiblePage?.totalCount ?? 0} factures`} · Page {page + 1} / {Math.max(1, Math.ceil((visiblePage?.totalCount ?? 0) / PAGE_SIZE))}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={listLoading || page === 0} onClick={() => setPage((v) => Math.max(0, v - 1))}>Précédent</Button>
          <Button variant="secondary" size="sm" disabled={listLoading || (page + 1) * PAGE_SIZE >= (visiblePage?.totalCount ?? 0)} onClick={() => setPage((v) => v + 1)}>Suivant</Button>
        </div>
      </div>
      {listError && <p role="alert" className="text-rose-deep mb-4">Lecture impossible : {listError}</p>}
      {filtered.length === 0 ? <EmptyState message={t('noData')} /> : view === 'table' ? (
        <DataTable
          rows={filtered}
          columns={purchaseColumns}
          rowKey={(p) => p.id}
          actions={purchaseActions}
          onRowClick={(p) => { void withDetail(p, setViewing); }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 animate-fadeIn">
          {filtered.map((p, i) => {
            const cats = getPurchaseUnits(p);
            return (
              <Card key={p.id} index={i} hoverable className="flex flex-col border border-gold/10 hover:border-gold/30 transition-all duration-300">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-display font-semibold text-text-primary flex items-center gap-1.5">
                    {p.reference}
                    {p.isHistorical && (
                      <Badge variant="warning" className="text-[9px] px-1.5 py-0">
                        <History size={9} /> Ancien
                      </Badge>
                    )}
                  </h3>
                  <span className="text-xs text-text-muted">{formatDate(p.date, language)}</span>
                </div>
                <p className="text-sm font-semibold text-text-secondary mb-1">{supplierName(p.supplierId)}</p>
                <p className="text-xs text-text-muted mb-2">{itemCount(p)} article(s)</p>

                {(p.bonNumber || p.driverPlate) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 text-[11px] text-text-secondary">
                    {p.bonNumber && (
                      <span className="flex items-center gap-1"><FileText size={11} className="text-gold" /> Bon <span className="font-semibold tabular">{p.bonNumber}</span></span>
                    )}
                    {p.driverPlate && (
                      <span className="flex items-center gap-1"><CarFront size={11} className="text-gold" /> <span className="font-semibold tabular">{p.driverPlate}</span></span>
                    )}
                  </div>
                )}
                
                {/* Categories Badge Display */}
                {cats.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {cats.map((catName) => (
                      <Badge key={catName} variant="info" className="bg-gold/10 text-gold-dark border-0 text-[10px] py-0.5 px-2">
                        {catName}
                      </Badge>
                    ))}
                  </div>
                )}

                {p.createdBy && <p className="text-xs text-text-muted mb-3">{t('createdBy')}: {p.createdBy}</p>}
                
                <div className="bg-vanilla/40 rounded-xl p-3 space-y-1.5 text-xs mb-3">
                  <div className="flex justify-between"><span className="text-text-muted">{t('total')}</span><span className="tabular font-semibold text-text-primary">{formatCurrency(p.totalAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-text-muted">{t('paid')}</span><span className="tabular text-pistachio font-medium">{formatCurrency(p.paidAmount)}</span></div>
                  <div className="flex justify-between border-t border-gold/5 pt-1.5 mt-1.5"><span className="text-text-muted font-medium">{t('rest')}</span>
                    <span className={`tabular font-bold ${p.restAmount > 0 ? 'text-rose-deep animate-pulse' : 'text-pistachio'}`}>{formatCurrency(p.restAmount)}</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-gold/5">
                  {p.restAmount > 0 ? (
                    <Badge variant="danger" className="bg-rose-deep/10 text-rose-deep border-0 text-[10px]">Dette</Badge>
                  ) : (
                    <Badge variant="success" className="bg-pistachio/10 text-pistachio border-0 text-[10px]">Soldée</Badge>
                  )}
                  
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="secondary" className="px-2" onClick={() => { void withDetail(p, setViewing); }} title={t('view')}><Eye size={13} /></Button>
                    {can('purchase', 'edit') && (
                      <Button
                        size="sm" variant="secondary" className="px-2"
                        onClick={() => { void withDetail(p, setEditing); }}
                        title="Modifier la facture (produits, quantités, prix, règlement)"
                      >
                        <PencilLine size={13} className="text-gold-dark" />
                      </Button>
                    )}
                    {can('purchase', 'pay') && p.restAmount > 0 && (
                      <Button size="sm" variant="gold" className="text-xs" onClick={() => { void withDetail(p, setPaying); }}>
                        <Wallet size={13} /> {t('pay')}
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" className="px-2" onClick={() => handlePrint(p)} title={t('print')}><Printer size={13} /></Button>
                    {can('purchase', 'delete') && (
                      <Button size="sm" variant="ghost" className="px-2 hover:bg-rose-deep/5" onClick={() => setDeleteId(p.id)} title={t('delete')}>
                        <Trash2 size={13} className="text-rose-deep" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('newPurchase')} size="lg">
        <CreatePurchase onClose={() => setCreateOpen(false)} onCreated={(pur) => setViewing(pur)} />
      </Modal>

      <Modal
        open={createHistoricalOpen}
        onClose={() => setCreateHistoricalOpen(false)}
        title="Ancien achat — saisie rétroactive"
        size="lg"
      >
        <CreatePurchase
          historical
          onClose={() => setCreateHistoricalOpen(false)}
          onCreated={(pur) => setViewing(pur)}
        />
      </Modal>

      {/* Modification : MÊME formulaire que la création, pré-rempli */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Modifier la facture ${editing?.reference ?? ''}`}
        size="lg"
      >
        {editing && (
          <CreatePurchase
            editing={editing}
            onClose={() => setEditing(null)}
            onCreated={(pur) => setViewing(pur)}
          />
        )}
      </Modal>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.reference} size="md">
        {viewing && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">{supplierName(viewing.supplierId)} — {formatDate(viewing.date, language)}</p>
            {viewing.isHistorical && (
              <div className="rounded-xl border border-caramel/40 bg-caramel/10 px-3 py-2 text-xs font-medium text-gold-dark">
                <span className="flex items-center gap-1.5 font-bold"><History size={13} /> Ancien achat (saisie rétroactive)</span>
                Les quantités de cette facture n'ont pas été ajoutées au stock actuel ; elle ne sert
                qu'à l'historique du fournisseur et aux rapports.
              </div>
            )}
            {(viewing.bonNumber || viewing.driverPlate) && (
              <div className="flex flex-wrap gap-2">
                {viewing.bonNumber && (
                  <Badge variant="info" className="bg-gold/10 text-gold-dark border-0"><FileText size={12} /> Bon n° {viewing.bonNumber}</Badge>
                )}
                {viewing.driverPlate && (
                  <Badge variant="info" className="bg-gold/10 text-gold-dark border-0"><CarFront size={12} /> Matricule {viewing.driverPlate}</Badge>
                )}
              </div>
            )}
            {delivererAssignments[viewing.id] && (() => {
              const a = delivererAssignments[viewing.id];
              return (
                <div className="rounded-xl border border-gold/20 bg-gold/5 px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-gold-dark">
                    <Bike size={14} /> Livreur : {a.delivererName || '—'}
                  </p>
                  <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-[10px] uppercase text-text-muted">Coût livreur</p>
                      <p className="tabular font-bold text-text-primary">{formatCurrency(a.cost || 0)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-text-muted">Payé au livreur</p>
                      <p className="tabular font-bold text-pistachio">{formatCurrency(a.paid || 0)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-text-muted">Reste dû</p>
                      <p className="tabular font-bold text-rose-deep">
                        {formatCurrency(Math.max(0, (a.cost || 0) - (a.paid || 0)))}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}
            {viewing.createdBy && <p className="text-xs text-text-muted">{t('createdBy')}: {viewing.createdBy}</p>}
            <table className="w-full text-sm">
              <thead className="bg-vanilla/60"><tr><th className="text-left px-3 py-2">{t('name')}</th><th className="text-right px-3 py-2">{t('quantity')}</th><th className="text-right px-3 py-2">P.U.</th><th className="text-right px-3 py-2">Total</th></tr></thead>
              <tbody>{viewing.products.map((l, i) => (
                <tr key={i} className="border-t border-gold/10"><td className="px-3 py-2">{l.productName}{l.unitEnabled && l.unit ? <span className="text-xs text-gold-dark"> · {l.unit}</span> : null}</td><td className="px-3 py-2 text-right tabular">{l.quantity}{l.unitEnabled && l.unit ? ` ${l.unit}` : ''}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(l.purchasePrice)}{l.unitEnabled && l.unit ? `/${l.unit}` : ''}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(l.quantity * l.purchasePrice)}</td></tr>
              ))}</tbody>
            </table>
            {viewing.payments.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-text-secondary mb-2">Paiements</h4>
                {viewing.payments.map((pay, i) => (
                  <div key={i} className="flex justify-between text-sm py-1 border-b border-gold/10">
                    <span className="text-text-muted">{formatDate(pay.date, language)} — {pay.description}</span>
                    <span className="tabular">{formatCurrency(pay.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => handlePrint(viewing)}><Printer size={16} /> {t('print')}</Button>
              {can('purchase', 'edit') && (
                <Button
                  variant="gold"
                  onClick={() => { setEditing(viewing); setViewing(null); }}
                >
                  <PencilLine size={16} /> Modifier la facture
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {paying && (
        <PayDebtModal open={!!paying} onClose={() => setPaying(null)} reference={paying.reference} partyName={supplierName(paying.supplierId)}
          total={paying.totalAmount} paid={paying.paidAmount} onPay={(amount, _desc, paidAt) => { void payDebt(paying.id, amount, (paidAt || new Date().toISOString()).slice(0, 10)); }} />
      )}

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => { if (deleteId) { void deletePurchase(deleteId).then(() => toast.success('Facture supprimée')); } }} />
    </div>
  );
}
