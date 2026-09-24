import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Truck, TrendingDown, PiggyBank, HandCoins, Printer, Search, ArrowRight, Scale,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { VersementModal } from '@/components/shared/VersementModal';
import { useClientStore } from '@/store/clientStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useSalesStore } from '@/store/salesStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useCommandStore } from '@/store/commandStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import {
  buildClientAccounts, buildSupplierAccounts, sumAccounts,
  type ClientAccount, type SupplierAccount,
} from '@/lib/accounts';
import { printListDocument } from '@/lib/statementPrint';
import { toast } from '@/components/ui/Toast';
import { cardVariants } from '@/lib/animations';
import { cn } from '@/lib/utils';
import type { PaymentMethodDetails } from '@/types';

/* ============================================================================
 *  RAPPORT GENERAL — SITUATION DES DETTES
 * ----------------------------------------------------------------------------
 *  Sur la page principale du rapport general : ce que doivent TOUS les
 *  clients et ce que l'entreprise doit a TOUS ses fournisseurs, acomptes
 *  deduits. Un clic ouvre le detail tiers par tiers, avec recherche, filtre
 *  et le bouton « Versement » pour regler une dette sans quitter l'ecran.
 * ========================================================================== */

type Tab = 'clients' | 'suppliers';
type Filter = 'debt' | 'credit' | 'all';

interface Row {
  id: string;
  name: string;
  phone: string;
  account: ClientAccount | SupplierAccount;
}

export function DebtsOverview() {
  const { can } = usePermissions();
  const clients = useClientStore((s) => s.clients);
  const clientOldDebts = useClientStore((s) => s.oldDebts);
  const payClient = useClientStore((s) => s.payDebt);
  const suppliers = useSupplierStore((s) => s.suppliers);
  const supplierOldDebts = useSupplierStore((s) => s.oldDebts);
  const paySupplier = useSupplierStore((s) => s.payDebt);
  const sales = useSalesStore((s) => s.sales);
  const purchases = usePurchaseStore((s) => s.purchases);
  const commands = useCommandStore((s) => s.commands);
  const deliveries = useCommandStore((s) => s.deliveries);
  const settings = useSettingsStore((s) => s.settings);

  const [open, setOpen] = useState<Tab | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('debt');
  const [sort, setSort] = useState<'amount' | 'name'>('amount');
  const [paying, setPaying] = useState<{ tab: Tab; row: Row } | null>(null);

  const clientAccounts = useMemo(
    () => buildClientAccounts({ clients, sales, commands, deliveries, oldDebts: clientOldDebts }),
    [clients, sales, commands, deliveries, clientOldDebts]
  );
  const supplierAccounts = useMemo(
    () => buildSupplierAccounts({ suppliers, purchases, oldDebts: supplierOldDebts }),
    [suppliers, purchases, supplierOldDebts]
  );
  const cTotals = useMemo(() => sumAccounts(clientAccounts.values()), [clientAccounts]);
  const sTotals = useMemo(() => sumAccounts(supplierAccounts.values()), [supplierAccounts]);

  const rows = useMemo<Row[]>(() => {
    if (!open) return [];
    const base: Row[] = open === 'clients'
      ? clients.map((c) => ({ id: c.id, name: c.name, phone: c.phone || '', account: clientAccounts.get(c.id)! }))
      : suppliers.map((s) => ({ id: s.id, name: s.name, phone: s.phone || '', account: supplierAccounts.get(s.id)! }));
    const q = search.trim().toLowerCase();
    return base
      .filter((r) => r.account)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.phone.includes(q))
      .filter((r) =>
        filter === 'all' ? true : filter === 'debt' ? r.account.net > 0.005 : r.account.net < -0.005
      )
      .sort((a, b) =>
        sort === 'name'
          ? a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })
          : Math.abs(b.account.net) - Math.abs(a.account.net)
      );
  }, [open, clients, suppliers, clientAccounts, supplierAccounts, search, filter, sort]);

  const listTotals = useMemo(() => sumAccounts(rows.map((r) => r.account)), [rows]);

  const openList = (tab: Tab) => {
    setSearch('');
    setFilter('debt');
    setSort('amount');
    setOpen(tab);
  };

  const printList = () => {
    if (!open) return;
    const isClient = open === 'clients';
    printListDocument(
      {
        title: isClient ? 'Dettes des clients' : 'Dettes envers les fournisseurs',
        docDate: todayISO(),
        metaLines: [`SITUATION AU ${formatDate(todayISO())}`],
        tables: [
          {
            columns: [
              { label: isClient ? 'Client' : 'Fournisseur', align: 'left' },
              { label: 'Telephone', align: 'center', width: '15%' },
              { label: 'Reste du', align: 'right', width: '17%' },
              { label: 'Acompte', align: 'right', width: '16%' },
              { label: 'Solde', align: 'right', width: '17%' },
            ],
            rows: rows.map((r) => ({
              cells: [
                r.name.toUpperCase(), r.phone || '/',
                formatCurrency(r.account.rest),
                formatCurrency(r.account.credit + r.account.advance),
                r.account.net < 0 ? `+ ${formatCurrency(-r.account.net)}` : formatCurrency(r.account.net),
              ],
            })),
            totals: [
              { label: 'Total des dettes', value: formatCurrency(listTotals.debt), strong: true },
              { label: 'Total des acomptes', value: formatCurrency(listTotals.credit) },
            ],
          },
        ],
        signatures: ['Le responsable', 'Signature'],
        fileName: isClient ? 'Dettes_clients' : 'Dettes_fournisseurs',
      },
      settings
    );
  };

  const submitPayment = async (
    amount: number, notes: string, paidAt: string, method: PaymentMethodDetails,
  ) => {
    if (!paying) return;
    if (paying.tab === 'clients') await payClient(paying.row.id, amount, paidAt, notes, method);
    else await paySupplier(paying.row.id, amount, paidAt, notes, method);
    toast.success(`Versement enregistré — ${paying.row.name}`);
    setPaying(null);
  };

  const cards = [
    {
      key: 'clients' as Tab, icon: <Users size={20} />, title: 'Dettes des clients',
      value: cTotals.debt, sub: `${cTotals.debtors} client(s) endetté(s)`,
      extra: `Acomptes des clients : ${formatCurrency(cTotals.credit)}`, tone: 'rose',
    },
    {
      key: 'suppliers' as Tab, icon: <Truck size={20} />, title: 'Dettes envers les fournisseurs',
      value: sTotals.debt, sub: `${sTotals.debtors} fournisseur(s) à payer`,
      extra: `Trop-versés aux fournisseurs : ${formatCurrency(sTotals.credit)}`, tone: 'caramel',
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((c, i) => (
          <motion.button
            key={c.key}
            type="button"
            custom={i}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            whileHover="hover"
            onClick={() => openList(c.key)}
            className="group rounded-2xl border border-gold/20 bg-gradient-card p-5 text-left shadow-card transition-shadow hover:shadow-hover"
          >
            <div className="flex items-center justify-between">
              <span className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl text-white',
                c.tone === 'rose' ? 'bg-gradient-rose' : 'bg-gradient-button'
              )}>
                {c.icon}
              </span>
              <span className="flex items-center gap-1 text-[11px] font-semibold text-gold-dark opacity-70 group-hover:opacity-100">
                Voir le détail <ArrowRight size={13} />
              </span>
            </div>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-text-muted">{c.title}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular text-rose-deep">{formatCurrency(c.value)}</p>
            <p className="mt-1 text-xs text-text-secondary">{c.sub}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-pistachio"><PiggyBank size={12} /> {c.extra}</p>
          </motion.button>
        ))}
        <motion.div
          custom={2}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="rounded-2xl border border-gold/20 bg-gradient-card p-5 shadow-card"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-lavender text-white">
            <Scale size={20} />
          </span>
          <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-text-muted">Solde des tiers</p>
          <p className={cn(
            'mt-1 font-display text-2xl font-bold tabular',
            cTotals.debt - sTotals.debt >= 0 ? 'text-pistachio' : 'text-rose-deep'
          )}>
            {formatCurrency(cTotals.debt - sTotals.debt)}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Ce que les clients doivent − ce que l&rsquo;entreprise doit aux fournisseurs
          </p>
        </motion.div>
      </div>

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title={open === 'suppliers' ? 'Dettes envers les fournisseurs' : 'Dettes des clients'}
        size="xl"
      >
        {open && (
          <div className="space-y-4">
            <div className="inline-flex rounded-2xl border border-gold/20 bg-vanilla/40 p-1">
              {(['clients', 'suppliers'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setOpen(t)}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all',
                    open === t ? 'bg-gradient-button text-white shadow-card' : 'text-text-muted hover:text-text-primary'
                  )}
                >
                  {t === 'clients' ? <Users size={15} /> : <Truck size={15} />}
                  {t === 'clients' ? 'Clients' : 'Fournisseurs'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Mini label="Tiers affichés" value={String(rows.length)} />
              <Mini label="Total des dettes" value={formatCurrency(listTotals.debt)} tone="neg" />
              <Mini label={open === 'clients' ? 'Total des acomptes' : 'Total des trop-versés'} value={formatCurrency(listTotals.credit)} tone="pos" />
              <Mini label="Débiteurs" value={String(listTotals.debtors)} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gold" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher (nom, téléphone)…"
                  className="h-10 w-full rounded-xl border-2 border-[--border-input] bg-[--surface-input] pl-9 pr-3 text-sm font-medium text-text-primary placeholder:text-text-muted/70 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
                />
              </div>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as Filter)}
                className="h-10 rounded-xl border border-gold/20 bg-[--surface-input] px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold"
              >
                <option value="debt">Avec dette</option>
                <option value="credit">{open === 'clients' ? 'Avec acompte' : 'Avec trop-versé'}</option>
                <option value="all">Tous</option>
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as 'amount' | 'name')}
                className="h-10 rounded-xl border border-gold/20 bg-[--surface-input] px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold"
              >
                <option value="amount">Trier par montant</option>
                <option value="name">Trier par nom</option>
              </select>
              <Button size="sm" variant="gold" onClick={printList} disabled={rows.length === 0}>
                <Printer size={14} /> Imprimer la liste
              </Button>
            </div>

            {rows.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-gold/25 bg-vanilla/20 py-10 text-center text-sm italic text-text-muted">
                Aucun tiers ne correspond à ces filtres
              </p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-gold/15 bg-gradient-card shadow-card">
                <table className="w-full text-sm">
                  <thead className="bg-vanilla/60 text-text-secondary">
                    <tr>
                      {[open === 'clients' ? 'Client' : 'Fournisseur', 'Téléphone', 'Facturé', 'Réglé', 'Reste dû', 'Acompte', 'Solde', ''].map((h, i) => (
                        <th key={i} className={cn('whitespace-nowrap px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide', i < 2 ? 'text-left' : 'text-right')}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const a = r.account;
                      const credit = a.credit + a.advance;
                      return (
                        <tr key={r.id} className="border-t border-gold/10 hover:bg-gold/5">
                          <td className="px-3 py-2 text-xs font-semibold text-text-primary">{r.name}</td>
                          <td className="px-3 py-2 text-xs text-text-muted">{r.phone || '—'}</td>
                          <td className="px-3 py-2 text-right text-xs tabular">{formatCurrency(a.billed)}</td>
                          <td className="px-3 py-2 text-right text-xs tabular text-pistachio">{formatCurrency(a.paid)}</td>
                          <td className="px-3 py-2 text-right text-xs tabular text-rose-deep">{formatCurrency(a.rest)}</td>
                          <td className="px-3 py-2 text-right text-xs tabular text-pistachio">{credit > 0.004 ? formatCurrency(credit) : '—'}</td>
                          <td className="px-3 py-2 text-right text-xs tabular">
                            {a.hasDebt ? (
                              <Badge variant="danger" className="text-[10px]"><TrendingDown size={10} /> {formatCurrency(a.net)}</Badge>
                            ) : a.hasCredit ? (
                              <Badge variant="success" className="text-[10px]"><PiggyBank size={10} /> + {formatCurrency(a.creditToReturn)}</Badge>
                            ) : (
                              <Badge variant="success" className="text-[10px]">À jour</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {can(open === 'clients' ? 'clients' : 'suppliers', 'pay') && (
                              <Button size="sm" variant={a.hasDebt ? 'gold' : 'secondary'} onClick={() => setPaying({ tab: open, row: r })}>
                                <HandCoins size={13} /> Versement
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      {paying && (
        <VersementModal
          open={!!paying}
          onClose={() => setPaying(null)}
          kind={paying.tab === 'clients' ? 'client' : 'supplier'}
          clientName={paying.row.name}
          clientPhone={paying.row.phone}
          total={paying.row.account.billed}
          paid={paying.row.account.paid + paying.row.account.credit + paying.row.account.advance}
          credit={paying.row.account.credit + paying.row.account.advance}
          onSubmit={submitPayment}
        />
      )}
    </>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className={cn('mt-0.5 text-sm font-bold tabular', tone === 'pos' ? 'text-pistachio' : tone === 'neg' ? 'text-rose-deep' : 'text-text-primary')}>
        {value}
      </p>
    </div>
  );
}
