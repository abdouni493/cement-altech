import { useMemo, useState } from 'react';
import { Receipt, Eye, Wallet, Printer, Trash2, History, Percent } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { PayDebtModal } from '@/components/shared/PayDebtModal';
import { useSalesStore } from '@/store/salesStore';
import { useClientStore } from '@/store/clientStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, formatDateTime, matchesDateFilter, type DateFilter } from '@/lib/utils';
import { printSaleInvoice } from '@/lib/invoicePrint';
import { toast } from '@/components/ui/Toast';
import type { Sale } from '@/types';

export default function SalesPage() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const { sales, payDebt, deleteSale } = useSalesStore();
  const clients = useClientStore((s) => s.clients);
  const settings = useSettingsStore((s) => s.settings);

  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [viewing, setViewing] = useState<Sale | null>(null);
  const [paying, setPaying] = useState<Sale | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const clientName = (id: string | null) => id ? clients.find((c) => c.id === id)?.name || '—' : t('walkIn');

  const filtered = useMemo(
    () => sales.filter((s) => {
      const cl = clients.find((c) => c.id === s.clientId);
      const q = search.toLowerCase();
      const match =
        (cl?.name || '').toLowerCase().includes(q) ||
        (cl?.phone || '').includes(search) ||
        s.reference.toLowerCase().includes(q) ||
        (s.bonNumber || '').toLowerCase().includes(q);
      return match && matchesDateFilter(s.date, dateFilter);
    }),
    [sales, search, dateFilter, clients]
  );

  const handlePrint = (s: Sale) => {
    const cl = clients.find((c) => c.id === s.clientId);
    printSaleInvoice({
      reference: s.reference,
      date: s.date,
      client: { name: cl?.name || t('walkIn'), phone: cl?.phone, address: cl?.address },
      lines: s.products.map((l) => ({
        designation: l.productName || '', quantity: l.quantity, unit: l.unit,
        unitPrice: l.sellingPrice, basePrice: l.basePrice,
      })),
      total: s.totalAmount, reduction: s.reduction, final: s.finalAmount,
      tvaEnabled: s.tvaEnabled, tvaRate: s.tvaRate, tvaAmount: s.tvaAmount,
      historical: s.isHistorical,
      paid: s.paidAmount, rest: s.restAmount, createdBy: s.createdBy,
    }, settings);
  };

  return (
    <div>
      <PageHeader title={t('sales')} icon={<Receipt size={24} />} subtitle={`${sales.length} ventes`} />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex-1 min-w-[200px]"><SearchBar value={search} onChange={setSearch} placeholder="Rechercher par client, n° facture ou n° bon de commande…" /></div>
        <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)}
          options={[{ value: 'all', label: t('all') }, { value: 'today', label: t('today') }, { value: 'week', label: t('week') }, { value: 'month', label: t('month') }]} className="max-w-[180px]" />
        <ViewToggle view={view} onChange={setView} />
      </div>

      {filtered.length === 0 ? <EmptyState message={t('noData')} /> : view === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((s, i) => (
            <Card key={s.id} index={i} hoverable className="flex flex-col">
              <div className="flex justify-between items-start mb-1">
                <h3 className="font-display font-semibold text-text-primary flex flex-wrap items-center gap-1.5">
                  {s.reference}
                  {s.isHistorical && (
                    <Badge variant="warning" className="text-[9px] px-1.5 py-0">
                      <History size={9} /> Ancienne
                    </Badge>
                  )}
                  {s.tvaEnabled && (
                    <Badge variant="info" className="text-[9px] px-1.5 py-0">
                      <Percent size={9} /> TVA {s.tvaRate}%
                    </Badge>
                  )}
                </h3>
                <span className="text-xs text-text-muted">{formatDateTime(s.date, language)}</span>
              </div>
              <p className="text-sm text-text-secondary mb-1">{clientName(s.clientId)}</p>
              {s.bonNumber && <p className="text-xs text-gold-dark font-semibold mb-1">🧾 Bon N° {s.bonNumber}</p>}
              <p className="text-xs text-text-muted mb-1">{s.products.length} article(s)</p>
              {s.createdBy && <p className="text-xs text-text-muted mb-3">{t('createdBy')}: {s.createdBy}</p>}
              <div className="bg-vanilla/40 rounded-xl p-3 space-y-1 text-sm mb-3">
                {s.tvaEnabled && (
                  <>
                    <div className="flex justify-between text-xs"><span className="text-text-muted">Total HT</span><span className="tabular">{formatCurrency(Math.max(0, s.totalAmount - s.reduction))}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-text-muted">TVA {s.tvaRate}%</span><span className="tabular text-gold-dark font-semibold">+ {formatCurrency(s.tvaAmount || 0)}</span></div>
                  </>
                )}
                <div className="flex justify-between"><span className="text-text-muted">{s.tvaEnabled ? 'Total TTC' : t('total')}</span><span className="tabular font-medium">{formatCurrency(s.finalAmount)}</span></div>
                <div className="flex justify-between"><span className="text-text-muted">{t('paid')}</span><span className="tabular text-pistachio">{formatCurrency(s.paidAmount)}</span></div>
                <div className="flex justify-between"><span className="text-text-muted">{t('rest')}</span><span className={`tabular font-bold ${s.restAmount > 0 ? 'text-rose-deep' : 'text-pistachio'}`}>{formatCurrency(s.restAmount)}</span></div>
              </div>
              <Badge variant={s.status === 'paid' ? 'success' : 'danger'} className="mb-3 self-start">{s.status === 'paid' ? '✅ Payée' : '🔴 Dette'}</Badge>
              <div className="flex flex-wrap gap-1.5 mt-auto">
                <Button size="sm" variant="secondary" onClick={() => setViewing(s)}><Eye size={14} /></Button>
                {can('sales', 'pay') && s.restAmount > 0 && <Button size="sm" variant="gold" onClick={() => setPaying(s)}><Wallet size={14} /> {t('pay')}</Button>}
                <Button size="sm" variant="secondary" onClick={() => handlePrint(s)}><Printer size={14} /></Button>
                {can('sales', 'delete') && <Button size="sm" variant="ghost" onClick={() => setDeleteId(s.id)}><Trash2 size={14} className="text-rose-deep" /></Button>}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gold/15 bg-gradient-card shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-vanilla/60 text-text-secondary"><tr>
              <th className="text-left px-4 py-3">N°</th><th className="text-left px-4 py-3">{t('client')}</th><th className="text-left px-4 py-3">{t('date')}</th>
              <th className="text-right px-4 py-3">{t('total')}</th><th className="text-right px-4 py-3">{t('rest')}</th><th className="text-center px-4 py-3">{t('actions')}</th>
            </tr></thead>
            <tbody>{filtered.map((s) => (
              <tr key={s.id} className="border-t border-gold/10 hover:bg-gold/5">
                <td className="px-4 py-3 font-medium">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {s.reference}
                    {s.isHistorical && <Badge variant="warning" className="text-[9px] px-1.5 py-0"><History size={9} /> Ancienne</Badge>}
                    {s.tvaEnabled && <Badge variant="info" className="text-[9px] px-1.5 py-0">TVA {s.tvaRate}%</Badge>}
                  </span>
                </td><td className="px-4 py-3">{clientName(s.clientId)}</td><td className="px-4 py-3">{formatDateTime(s.date, language)}</td>
                <td className="px-4 py-3 text-right tabular">{formatCurrency(s.finalAmount)}</td>
                <td className="px-4 py-3 text-right tabular"><span className={s.restAmount > 0 ? 'text-rose-deep font-bold' : ''}>{formatCurrency(s.restAmount)}</span></td>
                <td className="px-4 py-3"><div className="flex justify-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setViewing(s)}><Eye size={16} /></Button>
                  {can('sales', 'pay') && s.restAmount > 0 && <Button size="icon" variant="ghost" onClick={() => setPaying(s)}><Wallet size={16} /></Button>}
                  <Button size="icon" variant="ghost" onClick={() => handlePrint(s)}><Printer size={16} /></Button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.reference} size="md">
        {viewing && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">{clientName(viewing.clientId)} — {formatDateTime(viewing.date, language)}</p>
            {viewing.isHistorical && (
              <div className="rounded-xl border border-rose-deep/35 bg-rose-deep/8 px-3 py-2 text-xs font-medium text-rose-deep">
                <span className="flex items-center gap-1.5 font-bold"><History size={13} /> Ancienne vente (saisie rétroactive)</span>
                Ni le stock ni le comptoir n'ont été modifiés ; cette vente sert à l'historique du
                client et aux rapports.
              </div>
            )}
            {viewing.bonNumber && <p className="text-xs text-gold-dark font-semibold">🧾 Bon de commande N° {viewing.bonNumber}</p>}
            {viewing.createdBy && <p className="text-xs text-text-muted">{t('createdBy')}: {viewing.createdBy}</p>}
            <div className="overflow-x-auto rounded-xl border border-gold/15">
              <table className="w-full text-sm">
                <thead className="bg-vanilla/60 text-text-secondary">
                  <tr>
                    <th className="text-left px-3 py-2">Produit</th>
                    <th className="text-right px-3 py-2">Qté</th>
                    <th className="text-right px-3 py-2">Prix catalogue</th>
                    <th className="text-right px-3 py-2">Prix appliqué</th>
                    <th className="text-right px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {viewing.products.map((l, i) => {
                    const overridden = l.basePrice !== undefined && Math.abs(l.basePrice - l.sellingPrice) > 0.001;
                    return (
                      <tr key={i} className="border-t border-gold/10">
                        <td className="px-3 py-2 font-medium">
                          {l.productName}
                          {l.sellByUnit && l.unit ? <span className="text-xs text-gold-dark"> · {l.unit}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular">
                          {l.quantity}{l.sellByUnit && l.unit ? ` ${l.unit}` : ''}
                        </td>
                        <td className="px-3 py-2 text-right tabular text-text-muted">
                          {l.basePrice !== undefined ? formatCurrency(l.basePrice) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular font-bold text-gold-dark">
                          {formatCurrency(l.sellingPrice)}{l.sellByUnit && l.unit ? `/${l.unit}` : ''}
                          {overridden && <Badge variant="warning" className="ml-1.5 text-[9px]">modifié</Badge>}
                        </td>
                        <td className="px-3 py-2 text-right tabular">{formatCurrency(l.quantity * l.sellingPrice)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Tile label={viewing.tvaEnabled ? 'Total brut HT' : t('total')} value={formatCurrency(viewing.totalAmount)} />
              <Tile label={t('reduction')} value={formatCurrency(viewing.reduction)} />
              {viewing.tvaEnabled && (
                <>
                  <Tile label="Base imposable HT" value={formatCurrency(Math.max(0, viewing.totalAmount - viewing.reduction))} />
                  <Tile label={`TVA ${viewing.tvaRate}%`} value={formatCurrency(viewing.tvaAmount || 0)} />
                  <Tile label="Net à payer TTC" value={formatCurrency(viewing.finalAmount)} />
                </>
              )}
              <Tile label={t('paid')} value={formatCurrency(viewing.paidAmount)} />
              <Tile label={t('rest')} value={formatCurrency(viewing.restAmount)} />
            </div>
            <Button variant="outline" onClick={() => handlePrint(viewing)}><Printer size={16} /> {t('print')}</Button>
          </div>
        )}
      </Modal>

      {paying && <PayDebtModal open={!!paying} onClose={() => setPaying(null)} reference={paying.reference} partyName={clientName(paying.clientId)} total={paying.finalAmount} paid={paying.paidAmount} onPay={(a, _n, paidAt) => { void payDebt(paying.id, a, (paidAt || new Date().toISOString()).slice(0, 10)); }} />}

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => { if (deleteId) { void deleteSale(deleteId).then(() => toast.success('Vente supprimée')); } }} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="bg-vanilla/40 rounded-lg p-2.5"><p className="text-xs text-text-muted">{label}</p><p className="text-sm font-bold tabular text-text-primary">{value}</p></div>;
}
