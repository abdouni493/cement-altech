import { useMemo, useState } from 'react';
import {
  Receipt, Eye, Wallet, Printer, Trash2, History, Percent, Pencil, Truck, Store,
} from 'lucide-react';
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
import { useViewMode } from '@/components/ui/DataTable';
import { PayDebtModal } from '@/components/shared/PayDebtModal';
import { EditSaleModal } from '@/components/shared/EditSaleModal';
import { StatCard } from '@/components/shared/StatCard';
import { useSalesStore } from '@/store/salesStore';
import { useCommandStore } from '@/store/commandStore';
import { useClientStore } from '@/store/clientStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, formatDateTime, matchesDateFilter, type DateFilter } from '@/lib/utils';
import { printSaleInvoice } from '@/lib/invoicePrint';
import { toast } from '@/components/ui/Toast';
import type { Sale } from '@/types';

/** D'où vient la facture : caisse (point de vente) ou bon de livraison. */
type OriginFilter = 'all' | 'pos' | 'delivery';

export default function SalesPage() {
  const { t, language } = useLanguage();
  const { can } = usePermissions();
  const { sales, payDebt, deleteSale, updateSale } = useSalesStore();
  const clients = useClientStore((s) => s.clients);
  const commands = useCommandStore((s) => s.commands);
  const deliveries = useCommandStore((s) => s.deliveries);
  const settings = useSettingsStore((s) => s.settings);

  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [origin, setOrigin] = useState<OriginFilter>('all');
  // L'affichage en TABLEAU est le mode par defaut de tous les ecrans ;
  // le choix de l'operateur est memorise pour cet ecran.
  const [view, setView] = useViewMode('sales');
  const [viewing, setViewing] = useState<Sale | null>(null);
  const [paying, setPaying] = useState<Sale | null>(null);
  const [editing, setEditing] = useState<Sale | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  /** Bon de livraison et commande à l'origine d'une facture, quand il y en a. */
  const deliveryOf = (s: Sale) => deliveries.find((d) => d.id === s.deliveryId);
  const commandOf = (s: Sale) => commands.find((c) => c.id === s.commandId);

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
      const matchesOrigin =
        origin === 'all' ? true : origin === 'delivery' ? !!s.deliveryId : !s.deliveryId;
      return match && matchesOrigin && matchesDateFilter(s.date, dateFilter);
    }),
    [sales, search, dateFilter, origin, clients]
  );

  /**
   * Totaux de l'écran : les livraisons sont des ventes comme les autres, on
   * distingue simplement leur origine pour la lecture.
   */
  const totals = useMemo(() => {
    const all = filtered.reduce((a, s) => a + s.finalAmount, 0);
    const fromDelivery = filtered.filter((s) => !!s.deliveryId);
    const fromPos = filtered.filter((s) => !s.deliveryId);
    return {
      all,
      posTotal: fromPos.reduce((a, s) => a + s.finalAmount, 0),
      posCount: fromPos.length,
      deliveryTotal: fromDelivery.reduce((a, s) => a + s.finalAmount, 0),
      deliveryCount: fromDelivery.length,
      debt: filtered.reduce((a, s) => a + s.restAmount, 0),
      paid: filtered.reduce((a, s) => a + s.paidAmount, 0),
    };
  }, [filtered]);

  const handlePrint = (s: Sale) => {
    const cl = clients.find((c) => c.id === s.clientId);
    printSaleInvoice({
      reference: s.reference,
      date: s.date,
      deliveryReference: deliveryOf(s)?.reference,
      commandReference: commandOf(s)?.reference,
      client: {
        name: cl?.name || t('walkIn'), phone: cl?.phone, address: cl?.address,
        rc: cl?.rc, nif: cl?.nif, nis: cl?.nis, article: cl?.article,
      },
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
      <PageHeader
        title={t('sales')}
        icon={<Receipt size={24} />}
        subtitle={`${sales.length} vente(s) — caisse et bons de livraison réunis`}
      />

      {/* Ventes de caisse + ventes issues des livraisons + dettes */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard index={0} label="Total ventes" value={totals.all} format="currency" icon={<Receipt size={20} />} accent="gold" />
        <StatCard index={1} label={`Ventes caisse (${totals.posCount})`} value={totals.posTotal} format="currency" icon={<Store size={20} />} accent="pistachio" />
        <StatCard index={2} label={`Livraisons facturées (${totals.deliveryCount})`} value={totals.deliveryTotal} format="currency" icon={<Truck size={20} />} accent="lavender" />
        <StatCard index={3} label="Dettes clients" value={totals.debt} format="currency" icon={<Wallet size={20} />} accent="rose" />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex-1 min-w-[200px]"><SearchBar value={search} onChange={setSearch} placeholder="Rechercher par client, n° facture ou n° bon de commande…" /></div>
        <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)}
          options={[{ value: 'all', label: t('all') }, { value: 'today', label: t('today') }, { value: 'week', label: t('week') }, { value: 'month', label: t('month') }]} className="max-w-[180px]" />
        <Select value={origin} onChange={(e) => setOrigin(e.target.value as OriginFilter)}
          options={[
            { value: 'all', label: 'Toutes les origines' },
            { value: 'pos', label: 'Ventes caisse' },
            { value: 'delivery', label: 'Bons de livraison' },
          ]} className="max-w-[200px]" />
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
                  {s.deliveryId && (
                    <Badge variant="info" className="text-[9px] px-1.5 py-0">
                      <Truck size={9} /> {deliveryOf(s)?.reference ?? 'Livraison'}
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
                <Button size="sm" variant="secondary" onClick={() => setViewing(s)} title="Détails"><Eye size={14} /></Button>
                {can('sales', 'pay') && s.restAmount > 0 && <Button size="sm" variant="gold" onClick={() => setPaying(s)}><Wallet size={14} /> {t('pay')}</Button>}
                {can('sales', 'edit') && <Button size="sm" variant="secondary" onClick={() => setEditing(s)} title="Modifier"><Pencil size={14} /></Button>}
                <Button size="sm" variant="secondary" onClick={() => handlePrint(s)} title="Imprimer la facture"><Printer size={14} /></Button>
                {can('sales', 'delete') && <Button size="sm" variant="ghost" onClick={() => setDeleteId(s.id)} title="Supprimer"><Trash2 size={14} className="text-rose-deep" /></Button>}
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
                    {s.deliveryId && <Badge variant="info" className="text-[9px] px-1.5 py-0"><Truck size={9} /> {deliveryOf(s)?.reference ?? 'Livraison'}</Badge>}
                  </span>
                </td><td className="px-4 py-3">{clientName(s.clientId)}</td><td className="px-4 py-3">{formatDateTime(s.date, language)}</td>
                <td className="px-4 py-3 text-right tabular">{formatCurrency(s.finalAmount)}</td>
                <td className="px-4 py-3 text-right tabular"><span className={s.restAmount > 0 ? 'text-rose-deep font-bold' : ''}>{formatCurrency(s.restAmount)}</span></td>
                <td className="px-4 py-3"><div className="flex justify-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setViewing(s)} title="Détails"><Eye size={16} /></Button>
                  {can('sales', 'pay') && s.restAmount > 0 && <Button size="icon" variant="ghost" onClick={() => setPaying(s)} title="Payer la dette"><Wallet size={16} /></Button>}
                  {can('sales', 'edit') && <Button size="icon" variant="ghost" onClick={() => setEditing(s)} title="Modifier"><Pencil size={16} /></Button>}
                  <Button size="icon" variant="ghost" onClick={() => handlePrint(s)} title="Imprimer"><Printer size={16} /></Button>
                  {can('sales', 'delete') && <Button size="icon" variant="ghost" onClick={() => setDeleteId(s.id)} title="Supprimer"><Trash2 size={16} className="text-rose-deep" /></Button>}
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
            {viewing.deliveryId && (
              <div className="rounded-xl border border-gold/35 bg-gold/8 px-3 py-2 text-xs font-medium text-gold-dark">
                <span className="flex items-center gap-1.5 font-bold"><Truck size={13} /> Vente issue d'un bon de livraison</span>
                Bon {deliveryOf(viewing)?.reference ?? '—'}
                {commandOf(viewing) ? ` · commande ${commandOf(viewing)!.reference}` : ''}
                {(deliveryOf(viewing)?.advanceApplied ?? 0) > 0
                  ? ` · dont ${formatCurrency(deliveryOf(viewing)!.advanceApplied!)} imputés sur l'acompte de la commande`
                  : ''}
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
                          {/* ligne issue d'une fiche technique : le lot a été
                              lancé à la validation et a consommé le stock */}
                          {l.productionId && (
                            <Badge variant="success" className="ml-1.5 text-[9px]">production lancée</Badge>
                          )}
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
            {/* ------------------------------------------------------------
                LES VERSEMENTS DE LA FACTURE.
                Une facture nee d'un bon de livraison est souvent deja payee
                par l'acompte de la commande : la liste ci-dessous montre d'ou
                vient chaque dinar, pour qu'aucune facture reglee ne puisse
                plus passer pour une dette.
            ------------------------------------------------------------- */}
            {viewing.payments.length > 0 && (
              <div className="rounded-xl border border-gold/15 bg-vanilla/30 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-muted">
                  <Wallet size={13} className="text-gold" /> Versements de cette facture
                </p>
                {viewing.payments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 border-b border-gold/10 py-1 text-xs last:border-0">
                    <span className="min-w-0 truncate">
                      {formatDate(p.date, language)} — {p.description || 'Règlement'}
                      {p.origin === 'delivery_advance' && (
                        <Badge variant="info" className="ml-1.5 text-[9px]">acompte commande</Badge>
                      )}
                      {p.origin === 'delivery_cash' && (
                        <Badge variant="success" className="ml-1.5 text-[9px]">encaissé à la remise</Badge>
                      )}
                    </span>
                    <span className="shrink-0 font-bold tabular text-pistachio">{formatCurrency(p.amount)}</span>
                  </div>
                ))}
                <div className="mt-1.5 flex justify-between border-t border-gold/20 pt-1.5 text-xs font-bold">
                  <span>Total versé</span>
                  <span className="tabular text-pistachio">{formatCurrency(viewing.paidAmount)}</span>
                </div>
              </div>
            )}

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

      <EditSaleModal
        sale={editing}
        onClose={() => setEditing(null)}
        onSave={async (data) => {
          if (!editing) return;
          await updateSale(editing.id, data);
          toast.success(
            editing.deliveryId
              ? 'Vente modifiée — le bon de livraison a été mis à jour'
              : 'Vente modifiée'
          );
          setEditing(null);
        }}
      />

      {paying && <PayDebtModal open={!!paying} onClose={() => setPaying(null)} reference={paying.reference} partyName={clientName(paying.clientId)} total={paying.finalAmount} paid={paying.paidAmount} onPay={(a, _n, paidAt) => { void payDebt(paying.id, a, (paidAt || new Date().toISOString()).slice(0, 10)); }} />}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Supprimer la vente"
        message={
          sales.find((s) => s.id === deleteId)?.deliveryId
            ? "Cette vente provient d'un bon de livraison : le bon sera supprimé lui aussi, les matières reviendront en stock et la commande repassera en « non livrée »."
            : undefined
        }
        onConfirm={() => { if (deleteId) { void deleteSale(deleteId).then(() => toast.success('Vente supprimée')); } }}
      />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="bg-vanilla/40 rounded-lg p-2.5"><p className="text-xs text-text-muted">{label}</p><p className="text-sm font-bold tabular text-text-primary">{value}</p></div>;
}
