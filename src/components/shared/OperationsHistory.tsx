import { useMemo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Receipt, ShoppingCart, ClipboardList, Truck, ChevronDown, ChevronUp, Search,
  History, Package, Percent, Calendar, Hash, Coins, Undo2, Users,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSalesStore } from '@/store/salesStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useCommandStore, deliveryStatus } from '@/store/commandStore';
import { useClientStore } from '@/store/clientStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, formatDateTime, paymentMethodLabel } from '@/lib/utils';

/* ============================================================================
 *  HISTORIQUE DÉTAILLÉ DES OPÉRATIONS
 * ----------------------------------------------------------------------------
 *  Un seul composant, partagé par l'écran Caisse et l'écran Rapports : il
 *  affiche, sur la période choisie par l'écran hôte, l'historique complet des
 *      · VENTES        — facture, client, articles, TVA, payé / reste
 *      · ACHATS        — facture fournisseur, articles, payé / reste
 *      · COMMANDES     — client, produits commandés, avancement des livraisons
 *      · LIVRAISONS    — bon de livraison, quantités remises ET matières
 *                        premières réellement retirées du stock
 *      · ANCIENNES DETTES — ardoises d'avant le logiciel (clients ET
 *                        fournisseurs). Elles n'écrivent RIEN en caisse : aucun
 *                        argent n'a bougé le jour de leur saisie, c'est leur
 *                        règlement qui alimente le tiroir.
 *      · EXCÉDENTS     — argent rendu à un client (sortie de caisse) ou
 *                        récupéré auprès d'un fournisseur (entrée de caisse).
 *  Chaque ligne se déplie sur son détail complet.
 * ========================================================================== */

type TabKey = 'sales' | 'purchases' | 'commands' | 'deliveries' | 'oldDebts' | 'refunds';

interface Props {
  /** Vrai quand la date (ISO ou YYYY-MM-DD) appartient à la période affichée. */
  inPeriod: (date: string) => boolean;
  /** Libellé de la période, rappelé dans l'entête. */
  periodLabel?: string;
  /** Onglet ouvert au premier affichage. */
  defaultTab?: TabKey;
  className?: string;
}

export function OperationsHistory({ inPeriod, periodLabel, defaultTab = 'sales', className }: Props) {
  const { language } = useLanguage();
  const sales = useSalesStore((s) => s.sales);
  const purchases = usePurchaseStore((s) => s.purchases);
  const commands = useCommandStore((s) => s.commands);
  const deliveries = useCommandStore((s) => s.deliveries);
  const clients = useClientStore((s) => s.clients);
  const suppliers = useSupplierStore((s) => s.suppliers);
  const clientOldDebts = useClientStore((s) => s.oldDebts);
  const supplierOldDebts = useSupplierStore((s) => s.oldDebts);
  const clientRefunds = useClientStore((s) => s.refunds);
  const supplierRefunds = useSupplierStore((s) => s.refunds);

  const [tab, setTab] = useState<TabKey>(defaultTab);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const clientName = (id: string | null | undefined) =>
    (id ? clients.find((c) => c.id === id)?.name : undefined) ?? 'Client de passage';
  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? '—';
  const commandOf = (id: string) => commands.find((c) => c.id === id);

  const q = search.trim().toLowerCase();
  const hit = (...parts: (string | undefined)[]) =>
    !q || parts.some((x) => (x ?? '').toLowerCase().includes(q));

  /* ------------------------------------------------------------- ventes -- */
  const salesRows = useMemo(
    () =>
      sales
        .filter((s) => inPeriod(s.date))
        .filter((s) => hit(s.reference, s.bonNumber, clientName(s.clientId)))
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date)),
    [sales, clients, q, inPeriod] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ------------------------------------------------------------- achats -- */
  const purchaseRows = useMemo(
    () =>
      purchases
        .filter((p) => inPeriod(p.date))
        .filter((p) => hit(p.reference, p.bonNumber, supplierName(p.supplierId)))
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date)),
    [purchases, suppliers, q, inPeriod] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ---------------------------------------------------------- commandes -- */
  const commandRows = useMemo(
    () =>
      commands
        .filter((c) => inPeriod(c.createdAt) || inPeriod(c.receiveDate))
        .filter((c) => hit(c.reference, c.bonNumber, c.clientName, c.driverName))
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [commands, q, inPeriod] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* --------------------------------------------------------- livraisons -- */
  const deliveryRows = useMemo(
    () =>
      deliveries
        .filter((d) => inPeriod(d.deliveredAt))
        .filter((d) => {
          const cmd = commandOf(d.commandId);
          return hit(d.reference, cmd?.reference, cmd?.clientName, d.driverName, d.driverPlate);
        })
        .slice()
        .sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt)),
    [deliveries, commands, q, inPeriod] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* -------------------------------------------------- anciennes dettes -- */
  const oldDebtRows = useMemo(
    () =>
      [...clientOldDebts, ...supplierOldDebts]
        .filter((d) => inPeriod(d.date))
        .filter((d) => hit(d.partyName, d.description))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [clientOldDebts, supplierOldDebts, q, inPeriod] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ------------------------------------------------ excedents rendus --- */
  const refundRows = useMemo(
    () =>
      [...clientRefunds, ...supplierRefunds]
        .filter((r) => inPeriod(r.refundedAt))
        .filter((r) => hit(r.partyName, r.notes))
        .sort((a, b) => b.refundedAt.localeCompare(a.refundedAt)),
    [clientRefunds, supplierRefunds, q, inPeriod] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const salesTotal = salesRows.reduce((s, x) => s + x.finalAmount, 0);
  const purchasesTotal = purchaseRows.reduce((s, x) => s + x.totalAmount, 0);
  const commandsTotal = commandRows.reduce((s, x) => s + x.totalAmount, 0);
  const deliveriesQty = deliveryRows.reduce(
    (s, d) => s + d.items.reduce((a, i) => a + i.quantity, 0), 0
  );
  const oldDebtsTotal = oldDebtRows.reduce((s, x) => s + x.amount, 0);
  const refundsTotal = refundRows.reduce((s, x) => s + x.amount, 0);

  const tabs: { key: TabKey; label: string; icon: ReactNode; count: number; total: string }[] = [
    { key: 'sales', label: 'Ventes', icon: <Receipt size={15} />, count: salesRows.length, total: formatCurrency(salesTotal) },
    { key: 'purchases', label: 'Achats', icon: <ShoppingCart size={15} />, count: purchaseRows.length, total: formatCurrency(purchasesTotal) },
    { key: 'commands', label: 'Commandes', icon: <ClipboardList size={15} />, count: commandRows.length, total: formatCurrency(commandsTotal) },
    { key: 'deliveries', label: 'Livraisons', icon: <Truck size={15} />, count: deliveryRows.length, total: `${Math.round(deliveriesQty * 1000) / 1000} livrés` },
    { key: 'oldDebts', label: 'Anciennes dettes', icon: <History size={15} />, count: oldDebtRows.length, total: formatCurrency(oldDebtsTotal) },
    { key: 'refunds', label: 'Excédents rendus', icon: <Undo2 size={15} />, count: refundRows.length, total: formatCurrency(refundsTotal) },
  ];

  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));

  return (
    <Card index={0} className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display font-semibold text-text-primary flex items-center gap-2">
            <History size={18} className="text-gold-dark" /> Historique détaillé des opérations
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Ventes, achats, commandes et livraisons{periodLabel ? ` — ${periodLabel}` : ''}. Cliquez une ligne pour son détail.
          </p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (n°, client, fournisseur, chauffeur…)"
            className="h-9 w-full sm:w-72 rounded-xl border-2 border-[--border-input] bg-[--surface-input] pl-9 pr-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold"
          />
        </div>
      </div>

      {/* ---- Onglets ---- */}
      <div className="flex flex-wrap gap-1.5 p-1 rounded-2xl bg-vanilla/60 border border-gold/15 mb-4">
        {tabs.map((tb) => {
          const active = tab === tb.key;
          return (
            <button
              key={tb.key}
              onClick={() => { setTab(tb.key); setOpenId(null); }}
              className="relative flex-1 min-w-[140px] px-3 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {active && (
                <motion.span
                  layoutId="ops-history-pill"
                  className="absolute inset-0 rounded-xl bg-gradient-button shadow-gold"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className={`relative z-10 flex flex-col items-center gap-0.5 ${active ? 'text-white' : 'text-text-secondary'}`}>
                <span className="flex items-center gap-1.5">{tb.icon} {tb.label}</span>
                <span className={`text-[10px] tabular ${active ? 'text-white/85' : 'text-text-muted'}`}>
                  {tb.count} · {tb.total}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
        {/* ============================ VENTES ============================ */}
        {tab === 'sales' && (salesRows.length === 0 ? (
          <EmptyState message="Aucune vente sur cette période" icon={<Receipt size={28} />} />
        ) : salesRows.map((s) => {
          const open = openId === s.id;
          const baseHT = Math.max(0, s.totalAmount - s.reduction);
          return (
            <Row
              key={s.id}
              open={open}
              onToggle={() => toggle(s.id)}
              title={s.reference}
              subtitle={`${clientName(s.clientId)} · ${formatDate(s.date, language)} · ${s.products.length} article(s)`}
              amount={s.finalAmount}
              amountClass="text-pistachio"
              badges={
                <>
                  {s.tvaEnabled && <Badge variant="info"><Percent size={9} /> TVA {s.tvaRate ?? 0}%</Badge>}
                  {s.isHistorical && <Badge variant="neutral">ancienne vente</Badge>}
                  <Badge variant={s.restAmount > 0 ? 'danger' : 'success'}>
                    {s.restAmount > 0 ? `reste ${formatCurrency(s.restAmount)}` : 'payée'}
                  </Badge>
                </>
              }
            >
              <DetailTable
                head={['Produit', 'Quantité', 'P.U. appliqué', 'Montant']}
                rows={s.products.map((l) => [
                  l.productName || '—',
                  `${l.quantity}${l.unit ? ` ${l.unit}` : ''}`,
                  formatCurrency(l.sellingPrice),
                  formatCurrency(l.quantity * l.sellingPrice),
                ])}
              />
              <Facts
                items={[
                  { label: 'Total HT', value: formatCurrency(baseHT) },
                  { label: 'Réduction', value: formatCurrency(s.reduction) },
                  { label: `TVA${s.tvaEnabled ? ` (${s.tvaRate ?? 0} %)` : ''}`, value: formatCurrency(s.tvaAmount || 0) },
                  { label: 'Net à payer TTC', value: formatCurrency(s.finalAmount) },
                  { label: 'Payé', value: formatCurrency(s.paidAmount) },
                  { label: 'Reste', value: formatCurrency(s.restAmount) },
                  ...(s.bonNumber ? [{ label: 'N° bon de commande', value: s.bonNumber }] : []),
                  ...(s.createdBy ? [{ label: 'Enregistrée par', value: s.createdBy }] : []),
                ]}
              />
              {s.payments.length > 0 && (
                <DetailTable
                  title="Règlements"
                  head={['Date', 'Description', 'Montant']}
                  rows={s.payments.map((p) => [
                    formatDate(p.date, language), p.description || '—', formatCurrency(p.amount),
                  ])}
                />
              )}
            </Row>
          );
        }))}

        {/* ============================ ACHATS ============================ */}
        {tab === 'purchases' && (purchaseRows.length === 0 ? (
          <EmptyState message="Aucun achat sur cette période" icon={<ShoppingCart size={28} />} />
        ) : purchaseRows.map((p) => {
          const open = openId === p.id;
          return (
            <Row
              key={p.id}
              open={open}
              onToggle={() => toggle(p.id)}
              title={p.reference}
              subtitle={`${supplierName(p.supplierId)} · ${formatDate(p.date, language)} · ${p.products.length} article(s)`}
              amount={p.totalAmount}
              amountClass="text-caramel"
              badges={
                <>
                  {p.isHistorical && <Badge variant="neutral">ancien achat</Badge>}
                  {p.driverPlate && <Badge variant="info"><Hash size={9} /> {p.driverPlate}</Badge>}
                  <Badge variant={p.restAmount > 0 ? 'danger' : 'success'}>
                    {p.restAmount > 0 ? `reste ${formatCurrency(p.restAmount)}` : 'réglé'}
                  </Badge>
                </>
              }
            >
              <DetailTable
                head={['Produit', 'Quantité', "Prix d'achat", 'Montant']}
                rows={p.products.map((l) => [
                  l.productName || '—',
                  `${l.quantity}${l.unit ? ` ${l.unit}` : ''}`,
                  formatCurrency(l.purchasePrice),
                  formatCurrency(l.quantity * l.purchasePrice),
                ])}
              />
              <Facts
                items={[
                  { label: 'Total facture', value: formatCurrency(p.totalAmount) },
                  { label: 'Payé', value: formatCurrency(p.paidAmount) },
                  { label: 'Reste dû', value: formatCurrency(p.restAmount) },
                  ...(p.bonNumber ? [{ label: 'N° bon de livraison', value: p.bonNumber }] : []),
                  ...(p.driverPlate ? [{ label: 'Matricule camion', value: p.driverPlate }] : []),
                  ...(p.createdBy ? [{ label: 'Enregistré par', value: p.createdBy }] : []),
                ]}
              />
              {p.payments.length > 0 && (
                <DetailTable
                  title="Versements au fournisseur"
                  head={['Date', 'Description', 'Montant']}
                  rows={p.payments.map((x) => [
                    formatDate(x.date, language), x.description || '—', formatCurrency(x.amount),
                  ])}
                />
              )}
            </Row>
          );
        }))}

        {/* ========================== COMMANDES ========================== */}
        {tab === 'commands' && (commandRows.length === 0 ? (
          <EmptyState message="Aucune commande sur cette période" icon={<ClipboardList size={28} />} />
        ) : commandRows.map((c) => {
          const open = openId === c.id;
          const d = deliveryStatus(c);
          const cmdDeliveries = deliveries.filter((x) => x.commandId === c.id);
          return (
            <Row
              key={c.id}
              open={open}
              onToggle={() => toggle(c.id)}
              title={c.reference}
              subtitle={`${c.clientName} · créée le ${formatDate(c.createdAt, language)}${c.receiveDate ? ` · livraison prévue ${formatDate(c.receiveDate, language)}` : ''}`}
              amount={c.totalAmount}
              amountClass="text-gold-dark"
              badges={
                <>
                  <Badge variant={d.isFull ? 'success' : d.isPartial ? 'warning' : 'danger'}>
                    {d.isFull ? 'livrée' : d.isPartial ? `livrée à ${d.percent.toFixed(0)} %` : 'non livrée'}
                  </Badge>
                  <Badge variant={c.restAmount > 0 ? 'danger' : 'success'}>
                    {c.restAmount > 0 ? `reste ${formatCurrency(c.restAmount)}` : 'payée'}
                  </Badge>
                  {c.bonNumber && <Badge variant="neutral">bon n° {c.bonNumber}</Badge>}
                </>
              }
            >
              <DetailTable
                head={['Produit', 'Commandé', 'Livré', 'Reste à livrer', 'P.U.', 'Montant']}
                rows={c.items.map((it) => {
                  const u = it.sellByUnit && it.sellUnit ? ` ${it.sellUnit}` : '';
                  const done = it.deliveredQuantity ?? 0;
                  return [
                    it.productName || '—',
                    `${it.quantity}${u}`,
                    `${done}${u}`,
                    `${Math.max(0, it.quantity - done)}${u}`,
                    formatCurrency(it.unitPrice),
                    formatCurrency(it.totalPrice),
                  ];
                })}
              />
              <Facts
                items={[
                  { label: 'Total commande', value: formatCurrency(c.totalAmount) },
                  { label: 'Acompte / payé', value: formatCurrency(c.paidAmount) },
                  { label: 'Reste à payer', value: formatCurrency(c.restAmount) },
                  { label: 'Livraisons', value: `${cmdDeliveries.length} bon(s)` },
                  ...(c.clientPhone ? [{ label: 'Téléphone', value: c.clientPhone }] : []),
                  ...(c.clientAddress ? [{ label: 'Adresse de livraison', value: c.clientAddress }] : []),
                  ...(c.driverName ? [{ label: 'Chauffeur prévu', value: `${c.driverName}${c.driverPlate ? ` · ${c.driverPlate}` : ''}` }] : []),
                  ...(c.createdBy ? [{ label: 'Enregistrée par', value: c.createdBy }] : []),
                ]}
              />
              {cmdDeliveries.length > 0 && (
                <DetailTable
                  title="Bons de livraison rattachés"
                  head={['Bon', 'Date', 'Chauffeur', 'Quantité livrée']}
                  rows={cmdDeliveries
                    .slice()
                    .sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt))
                    .map((dl) => [
                      dl.reference,
                      formatDateTime(dl.deliveredAt, language),
                      dl.driverName ? `${dl.driverName}${dl.driverPlate ? ` · ${dl.driverPlate}` : ''}` : '—',
                      String(Math.round(dl.items.reduce((a, i) => a + i.quantity, 0) * 1000) / 1000),
                    ])}
                />
              )}
              {c.notes && <p className="text-[11px] italic text-text-muted mt-2">« {c.notes} »</p>}
            </Row>
          );
        }))}

        {/* ====================== ANCIENNES DETTES ======================= */}
        {tab === 'oldDebts' && (oldDebtRows.length === 0 ? (
          <EmptyState message="Aucune ancienne dette sur cette période" icon={<History size={28} />} />
        ) : oldDebtRows.map((d) => {
          const open = openId === d.id;
          const isClient = d.partyType === 'client';
          return (
            <Row
              key={d.id}
              open={open}
              onToggle={() => toggle(d.id)}
              title={d.partyName || '—'}
              subtitle={`${isClient ? 'Client' : 'Fournisseur'} · ${formatDate(d.date, language)} · ${d.description || 'sans description'}`}
              amount={d.amount}
              amountClass={isClient ? 'text-rose-deep' : 'text-caramel'}
              badges={
                <>
                  <Badge variant={isClient ? 'info' : 'warning'}>
                    <Users size={9} /> {isClient ? 'dette client' : 'dette fournisseur'}
                  </Badge>
                  <Badge variant={d.restAmount > 0 ? 'danger' : 'success'}>
                    {d.restAmount > 0 ? `reste ${formatCurrency(d.restAmount)}` : 'soldée'}
                  </Badge>
                  <Badge variant="neutral">hors caisse</Badge>
                </>
              }
            >
              <Facts
                items={[
                  { label: 'Montant de l’ardoise', value: formatCurrency(d.amount) },
                  { label: 'Déjà réglé', value: formatCurrency(d.paidAmount) },
                  { label: 'Reste dû', value: formatCurrency(d.restAmount) },
                  { label: 'Date de la dette', value: formatDate(d.date, language) },
                  ...(d.createdBy ? [{ label: 'Enregistrée par', value: d.createdBy }] : []),
                ]}
              />
              <p className="mt-3 rounded-xl border border-caramel/30 bg-caramel/10 px-3 py-2 text-[11px] font-medium text-caramel">
                Ardoise antérieure au logiciel : aucun argent n’a bougé le jour de sa saisie, elle
                n’écrit donc rien en caisse. C’est son règlement (bouton « Versement » de la fiche)
                qui alimente le tiroir.
              </p>
              {d.description && <p className="text-[11px] italic text-text-muted mt-2">« {d.description} »</p>}
            </Row>
          );
        }))}

        {/* ======================= EXCÉDENTS RENDUS ====================== */}
        {tab === 'refunds' && (refundRows.length === 0 ? (
          <EmptyState message="Aucun excédent rendu sur cette période" icon={<Undo2 size={28} />} />
        ) : refundRows.map((r) => {
          const open = openId === r.id;
          const isClient = r.partyType === 'client';
          return (
            <Row
              key={r.id}
              open={open}
              onToggle={() => toggle(r.id)}
              title={r.partyName || '—'}
              subtitle={`${isClient ? 'Excédent rendu au client' : 'Excédent récupéré du fournisseur'} · ${formatDateTime(r.refundedAt, language)}`}
              amount={r.amount}
              amountClass={isClient ? 'text-caramel' : 'text-pistachio'}
              badges={
                <>
                  <Badge variant={isClient ? 'warning' : 'success'}>
                    {isClient ? 'sortie de caisse' : 'entrée de caisse'}
                  </Badge>
                  <Badge variant="info">{paymentMethodLabel(r)}</Badge>
                </>
              }
            >
              <Facts
                items={[
                  { label: 'Montant', value: formatCurrency(r.amount) },
                  { label: 'Sens', value: isClient ? 'Sortie de caisse' : 'Entrée de caisse' },
                  { label: 'Mode de règlement', value: paymentMethodLabel(r) },
                  { label: 'Reçu n°', value: `EXC-${r.id.slice(0, 8).toUpperCase()}` },
                  ...(r.createdBy ? [{ label: 'Enregistré par', value: r.createdBy }] : []),
                ]}
              />
              {r.notes && <p className="text-[11px] italic text-text-muted mt-2">« {r.notes} »</p>}
            </Row>
          );
        }))}

        {/* ========================= LIVRAISONS ========================== */}
        {tab === 'deliveries' && (deliveryRows.length === 0 ? (
          <EmptyState message="Aucune livraison sur cette période" icon={<Truck size={28} />} />
        ) : deliveryRows.map((dl) => {
          const open = openId === dl.id;
          const cmd = commandOf(dl.commandId);
          const qty = dl.items.reduce((a, i) => a + i.quantity, 0);
          // valeur marchande : la quantité remise au prix de la commande
          const value = dl.items.reduce((a, i) => {
            const line = cmd?.items.find(
              (it) => (i.commandItemId && i.commandItemId === it.id) || it.productName === i.productName
            );
            return a + i.quantity * (line?.unitPrice ?? 0);
          }, 0);
          const materials = dl.consumptions ?? [];
          const materialCost = materials.reduce((a, x) => a + x.lineCost, 0);
          return (
            <Row
              key={dl.id}
              open={open}
              onToggle={() => toggle(dl.id)}
              title={dl.reference}
              subtitle={`${cmd?.clientName ?? '—'} · ${formatDateTime(dl.deliveredAt, language)}${cmd ? ` · commande ${cmd.reference}` : ''}`}
              amount={value}
              amountClass="text-gold-dark"
              badges={
                <>
                  <Badge variant="success">{Math.round(qty * 1000) / 1000} livré(s)</Badge>
                  {dl.driverName && <Badge variant="info"><Truck size={9} /> {dl.driverName}</Badge>}
                  {materials.length > 0 ? (
                    <Badge variant="warning"><Package size={9} /> stock déduit</Badge>
                  ) : (
                    <Badge variant="neutral">stock non déduit</Badge>
                  )}
                </>
              }
            >
              <DetailTable
                head={['Produit livré', 'Quantité remise', 'P.U. commande', 'Montant livré']}
                rows={dl.items.map((i) => {
                  const line = cmd?.items.find(
                    (it) => (i.commandItemId && i.commandItemId === it.id) || it.productName === i.productName
                  );
                  return [
                    i.productName,
                    `${i.quantity}${i.sellUnit ? ` ${i.sellUnit}` : ''}`,
                    formatCurrency(line?.unitPrice ?? 0),
                    formatCurrency(i.quantity * (line?.unitPrice ?? 0)),
                  ];
                })}
              />

              {/* Ce que la livraison a réellement retiré de « Gestion de stock » */}
              {materials.length > 0 ? (
                <DetailTable
                  title={`Matières premières déduites du stock — coût ${formatCurrency(materialCost)}`}
                  head={['Matière première', 'Quantité retirée', 'Coût unitaire', 'Coût']}
                  rows={materials.map((m) => [
                    m.productName,
                    `− ${m.quantity}${m.unit ? ` ${m.unit}` : ''}`,
                    formatCurrency(m.unitCost),
                    formatCurrency(m.lineCost),
                  ])}
                />
              ) : (
                <p className="mt-3 rounded-xl border border-caramel/30 bg-caramel/10 px-3 py-2 text-[11px] font-medium text-caramel">
                  Aucune matière retirée du stock pour ce bon : les produits livrés ne sont rattachés
                  à aucune fiche technique ni à un produit du stock, ou la livraison date d'avant la
                  mise à jour « déduction du stock à la livraison ».
                </p>
              )}

              <Facts
                items={[
                  ...(cmd ? [{ label: 'Commande', value: cmd.reference }] : []),
                  ...(cmd?.clientAddress ? [{ label: 'Adresse', value: cmd.clientAddress }] : []),
                  { label: 'Chauffeur', value: dl.driverName || cmd?.driverName || '—' },
                  { label: 'Matricule', value: dl.driverPlate || cmd?.driverPlate || '—' },
                  { label: 'Valeur livrée', value: formatCurrency(value) },
                  { label: 'Coût matière', value: formatCurrency(materialCost) },
                ]}
              />
              {dl.notes && <p className="text-[11px] italic text-text-muted mt-2">« {dl.notes} »</p>}
            </Row>
          );
        }))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ bricks */

function Row({
  open, onToggle, title, subtitle, amount, amountClass = 'text-text-primary', badges, children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string;
  amount: number;
  amountClass?: string;
  badges?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border border-gold/12 rounded-xl overflow-hidden bg-vanilla/10">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-gold/5 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-text-primary truncate">{title}</p>
          <p className="text-[11px] text-text-muted truncate flex items-center gap-1">
            <Calendar size={10} /> {subtitle}
          </p>
          {badges && <div className="flex flex-wrap items-center gap-1.5 mt-1.5">{badges}</div>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-sm font-bold tabular ${amountClass}`}>{formatCurrency(amount)}</span>
          {open ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-gold/10 bg-vanilla/40"
          >
            <div className="p-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailTable({ title, head, rows }: { title?: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="mt-3 first:mt-0">
      {title && (
        <p className="text-[10px] font-bold uppercase tracking-wider text-gold-dark mb-1.5">{title}</p>
      )}
      <div className="overflow-x-auto rounded-lg border border-gold/12">
        <table className="w-full text-xs">
          <thead className="bg-vanilla/60 text-text-secondary">
            <tr>
              {head.map((h, i) => (
                <th key={h} className={`px-2 py-1.5 font-medium whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="px-2 py-2 text-text-muted italic" colSpan={head.length}>—</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="border-t border-gold/8">
                {r.map((cell, j) => (
                  <td key={j} className={`px-2 py-1.5 ${j === 0 ? 'text-left font-medium text-text-primary' : 'text-right tabular text-text-secondary'}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Facts({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {items.map((f) => (
        <div key={f.label} className="rounded-lg border border-gold/12 bg-cream/60 px-2.5 py-1.5">
          <p className="text-[9px] uppercase tracking-wide text-text-muted leading-tight">{f.label}</p>
          <p className="text-xs font-bold text-text-primary mt-0.5 break-words">{f.value}</p>
        </div>
      ))}
    </div>
  );
}

/** Vignettes de synthèse « ventes / achats / commandes / livraisons ». */
export function OperationsTotals({ inPeriod }: { inPeriod: (date: string) => boolean }) {
  const sales = useSalesStore((s) => s.sales);
  const purchases = usePurchaseStore((s) => s.purchases);
  const commands = useCommandStore((s) => s.commands);
  const deliveries = useCommandStore((s) => s.deliveries);
  const clientOldDebts = useClientStore((s) => s.oldDebts);
  const supplierOldDebts = useSupplierStore((s) => s.oldDebts);
  const clientRefunds = useClientStore((s) => s.refunds);
  const supplierRefunds = useSupplierStore((s) => s.refunds);

  const stats = useMemo(() => {
    const pSales = sales.filter((s) => inPeriod(s.date));
    const pPurch = purchases.filter((p) => inPeriod(p.date));
    const pCmd = commands.filter((c) => inPeriod(c.createdAt) || inPeriod(c.receiveDate));
    const pDel = deliveries.filter((d) => inPeriod(d.deliveredAt));
    const pOld = [...clientOldDebts, ...supplierOldDebts].filter((d) => inPeriod(d.date));
    const pRef = [...clientRefunds, ...supplierRefunds].filter((r) => inPeriod(r.refundedAt));
    return {
      salesCount: pSales.length,
      salesTotal: pSales.reduce((s, x) => s + x.finalAmount, 0),
      purchasesCount: pPurch.length,
      purchasesTotal: pPurch.reduce((s, x) => s + x.totalAmount, 0),
      commandsCount: pCmd.length,
      commandsTotal: pCmd.reduce((s, x) => s + x.totalAmount, 0),
      commandsRest: pCmd.reduce((s, x) => s + x.restAmount, 0),
      deliveriesCount: pDel.length,
      deliveriesQty: pDel.reduce((s, d) => s + d.items.reduce((a, i) => a + i.quantity, 0), 0),
      materialsCost: pDel.reduce(
        (s, d) => s + (d.consumptions ?? []).reduce((a, x) => a + x.lineCost, 0), 0
      ),
      oldDebtsCount: pOld.length,
      oldDebtsTotal: pOld.reduce((s, x) => s + x.amount, 0),
      oldDebtsRest: pOld.reduce((s, x) => s + x.restAmount, 0),
      refundsCount: pRef.length,
      refundsTotal: pRef.reduce((s, x) => s + x.amount, 0),
    };
  }, [
    sales, purchases, commands, deliveries,
    clientOldDebts, supplierOldDebts, clientRefunds, supplierRefunds, inPeriod,
  ]);

  const tiles = [
    { icon: <Receipt size={17} />, label: 'Ventes', value: formatCurrency(stats.salesTotal), sub: `${stats.salesCount} facture(s)`, grad: 'from-[#A6E9CE] to-[#3FB591]' },
    { icon: <ShoppingCart size={17} />, label: 'Achats', value: formatCurrency(stats.purchasesTotal), sub: `${stats.purchasesCount} facture(s)`, grad: 'from-[#FFD08A] to-[#F2944A]' },
    { icon: <ClipboardList size={17} />, label: 'Commandes', value: formatCurrency(stats.commandsTotal), sub: `${stats.commandsCount} · reste ${formatCurrency(stats.commandsRest)}`, grad: 'from-[#FF9CC0] to-[#F0568A]' },
    { icon: <Truck size={17} />, label: 'Livraisons', value: `${Math.round(stats.deliveriesQty * 1000) / 1000} livrés`, sub: `${stats.deliveriesCount} bon(s) · matière ${formatCurrency(stats.materialsCost)}`, grad: 'from-[#CDB0F5] to-[#9B7ED8]' },
    { icon: <History size={17} />, label: 'Anciennes dettes', value: formatCurrency(stats.oldDebtsTotal), sub: `${stats.oldDebtsCount} ardoise(s) · reste ${formatCurrency(stats.oldDebtsRest)}`, grad: 'from-[#F5C6A5] to-[#D98E4F]' },
    { icon: <Undo2 size={17} />, label: 'Excédents rendus', value: formatCurrency(stats.refundsTotal), sub: `${stats.refundsCount} opération(s)`, grad: 'from-[#A5D8F5] to-[#4F9ED9]' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {tiles.map((tile, i) => (
        <motion.div
          key={tile.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="rounded-2xl bg-gradient-card border border-gold/15 shadow-card p-4"
        >
          <div className={`h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shadow-sm mb-2.5 ${tile.grad}`}>
            {tile.icon}
          </div>
          <p className="text-xs text-text-muted">{tile.label}</p>
          <p className="text-lg font-bold tabular text-text-primary leading-tight">{tile.value}</p>
          <p className="text-[10px] text-text-muted mt-0.5 flex items-center gap-1">
            <Coins size={9} /> {tile.sub}
          </p>
        </motion.div>
      ))}
    </div>
  );
}
