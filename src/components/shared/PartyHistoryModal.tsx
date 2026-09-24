import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X, Search, RotateCcw, ShoppingBag, ClipboardList, Truck, Coins, History,
  Undo2, ScissorsSquare, Eye, Pencil, Printer, Trash2, Wallet, Package,
  TrendingUp, TrendingDown, CheckCircle2, Layers, CalendarRange, FileDown,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import type { ActionItem } from '@/components/ui/ActionMenu';
import { panelVariants, EASE } from '@/lib/animations';
import { formatCurrency, formatDate, formatDateTime, paymentMethodLabel } from '@/lib/utils';
import { withinPeriod } from '@/lib/partyHistory';
import { lockScroll } from '@/lib/scrollLock';
import { PresenceLayer } from '@/components/ui/PresenceLayer';
import { cn } from '@/lib/utils';

/* ============================================================================
 *  FENETRE « HISTORIQUE » D'UN TIERS — PLEIN ECRAN
 * ----------------------------------------------------------------------------
 *  Un seul bouton sur la carte d'un client ou d'un fournisseur ouvre TOUT ce
 *  que l'application sait de lui, organise par TYPE D'OPERATION :
 *
 *    - un onglet par partie (ventes, commandes, livraisons, versements,
 *      anciennes ventes / commandes / livraisons / dettes, excedents,
 *      annulations et augmentations) ;
 *    - au-dessus du tableau, les statistiques propres a la partie affichee ;
 *    - un filtre de periode (du ... au ...) et une recherche libre ;
 *    - sur chaque ligne, un menu « trois points » : VOIR LE DETAIL, MODIFIER,
 *      IMPRIMER, SUPPRIMER.
 *
 *  La fenetre occupe tout l'ecran : ces tableaux ont jusqu'a huit colonnes et
 *  se lisent mal dans une boite de dialogue etroite.
 * ========================================================================== */

export interface HistoryStat {
  label: string;
  value: string;
  tone?: 'neutral' | 'pos' | 'neg' | 'accent';
  icon?: ReactNode;
}

export interface HistorySection<T = unknown> {
  key: string;
  label: string;
  icon: ReactNode;
  rows: T[];
  columns: DataColumn<T>[];
  actions?: (row: T, index: number) => ActionItem[];
  stats: HistoryStat[];
  /** Date portee par une ligne — filtre de periode et recherche par date. */
  dateOf: (row: T) => string;
  /** Texte balaye par la recherche libre. */
  searchOf: (row: T) => string;
  empty: string;
  note?: string;
  /** Impression de TOUTE la partie (modele du bon de livraison). */
  onPrintAll?: (rows: T[]) => void;
}

const toneClass: Record<NonNullable<HistoryStat['tone']>, string> = {
  neutral: 'text-text-primary',
  pos: 'text-pistachio',
  neg: 'text-rose-deep',
  accent: 'text-gold-dark',
};

export function PartyHistoryModal({
  open, onClose, title, subtitle, sections, headerActions, headline,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  sections: HistorySection<never>[];
  /** Boutons metier repris en haut de la fenetre (versement, ancienne dette...). */
  headerActions?: ReactNode;
  /** Bandeau de synthese globale du tiers. */
  headline?: HistoryStat[];
}) {
  const [tab, setTab] = useState(sections[0]?.key ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setTab(sections[0]?.key ?? '');
    setFrom(''); setTo(''); setSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, title]);

  // La fermeture passe par une ref : l'effet ne depend que de `open` et ne se
  // rejoue plus a chaque rendu de l'ecran parent (qui recreait sa fonction).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    // L'ecran occupe toute la fenetre : la page qui est dessous ne defile
    // plus. Le verrou est PARTAGE avec les fenetres modales : fermer une
    // fenetre ouverte par-dessus ne rend plus le defilement trop tot, et
    // fermer l'historique le rend toujours.
    const release = lockScroll();
    const onKey = (e: KeyboardEvent) => {
      // Echap ne ferme l'historique que si aucune fenetre n'est ouverte
      // par-dessus (detail d'une vente, confirmation de suppression...).
      if (e.key !== 'Escape') return;
      if (document.querySelector('[data-modal-open="true"]')) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      release();
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = sections.find((s) => s.key === tab) ?? sections[0];

  /** Lignes de l'onglet apres filtre de periode et recherche — de la plus
   *  ANCIENNE a la plus RECENTE. */
  const filtered = useMemo(() => {
    if (!active) return [] as never[];
    const q = search.trim().toLowerCase();
    return (active.rows as never[])
      .filter((row) => {
        if (!withinPeriod(active.dateOf(row), from || undefined, to || undefined)) return false;
        if (!q) return true;
        const haystack = `${active.searchOf(row)} ${formatDate(active.dateOf(row))} ${active.dateOf(row)}`;
        return haystack.toLowerCase().includes(q);
      })
      .map((row, i) => ({ row, i }))
      .sort((a, b) =>
        (active.dateOf(a.row) || '').localeCompare(active.dateOf(b.row) || '') || a.i - b.i
      )
      .map((x) => x.row);
  }, [active, from, to, search]);

  return createPortal(
    <AnimatePresence>
      {open && active && (
      <PresenceLayer
        key="party-history"
        className="fixed inset-0 z-[70] flex flex-col bg-cream"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: EASE } }}
        exit={{ opacity: 0, y: 8, transition: { duration: 0.14, ease: EASE } }}
      >
        {/* ---------------------------------------------------- en-tete ---- */}
        <div className="shrink-0 border-b border-gold/20 bg-gradient-card px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-lg sm:text-xl font-bold text-text-primary truncate flex items-center gap-2">
                <Layers size={20} className="text-gold shrink-0" /> {title}
              </h2>
              {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {headerActions}
              <button
                onClick={onClose}
                title="Fermer l'historique"
                className="rounded-xl border border-gold/25 bg-vanilla p-2 text-text-muted transition-colors hover:bg-rose-deep/10 hover:text-rose-deep"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {headline && headline.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {headline.map((k) => (
                <div key={k.label} className="rounded-xl border border-gold/15 bg-vanilla/50 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted leading-tight">{k.label}</p>
                  <p className={cn('mt-0.5 text-sm font-bold tabular', toneClass[k.tone ?? 'neutral'])}>{k.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---------------------------------------------------- onglets ---- */}
        <div className="shrink-0 border-b border-gold/15 bg-vanilla/30 px-2 sm:px-4">
          <div className="flex gap-1 overflow-x-auto py-2">
            {sections.map((s) => {
              const on = s.key === active.key;
              return (
                <button
                  key={s.key}
                  onClick={() => { setTab(s.key); setSearch(''); }}
                  className={cn(
                    'relative flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-colors',
                    on ? 'text-white' : 'text-text-secondary hover:bg-gold/10 hover:text-text-primary'
                  )}
                >
                  {on && (
                    <motion.span
                      layoutId="party-history-tab"
                      transition={{ duration: 0.18, ease: EASE }}
                      className="absolute inset-0 rounded-xl bg-gradient-button shadow-gold"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    {s.icon}
                    {s.label}
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular',
                        on ? 'bg-white/25 text-white' : 'bg-gold/15 text-gold-dark'
                      )}
                    >
                      {s.rows.length}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ------------------------------------------------------ corps ---- */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={active.key}
              variants={panelVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="space-y-4"
            >
              {/* ---- statistiques de la partie affichee ---- */}
              {active.stats.length > 0 && (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                  {active.stats.map((k) => (
                    <div
                      key={k.label}
                      className="rounded-2xl border border-gold/15 bg-gradient-card px-3.5 py-3 shadow-card"
                    >
                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-text-muted">
                        {k.icon}{k.label}
                      </p>
                      <p className={cn('mt-1 text-base font-bold tabular', toneClass[k.tone ?? 'neutral'])}>
                        {k.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* ---- filtres : periode, recherche, impression de la partie ---- */}
              <div className="flex flex-wrap items-end gap-2.5 rounded-2xl border border-gold/20 bg-vanilla/40 p-3">
                <p className="flex w-full items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted sm:w-auto">
                  <CalendarRange size={14} className="text-gold" /> Periode
                </p>
                <Input
                  type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  className="max-w-[185px]" aria-label="Date de debut"
                />
                <Input
                  type="date" value={to} onChange={(e) => setTo(e.target.value)}
                  className="max-w-[185px]" aria-label="Date de fin"
                />
                <div className="relative min-w-[200px] flex-1">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gold" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher (n, date jj/mm/aaaa, produit, note)…"
                    className="h-10 w-full rounded-xl border-2 border-[--border-input] bg-[--surface-input] pl-9 pr-3 text-sm font-medium text-text-primary placeholder:text-text-muted/70 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
                  />
                </div>
                {(from || to || search) && (
                  <Button size="sm" variant="secondary" onClick={() => { setFrom(''); setTo(''); setSearch(''); }}>
                    <RotateCcw size={14} /> Tout afficher
                  </Button>
                )}
                {active.onPrintAll && (
                  <Button
                    size="sm" variant="gold"
                    onClick={() => active.onPrintAll?.(filtered)}
                    title="Imprimer cette partie sur le modele du bon de livraison"
                  >
                    <FileDown size={14} /> Imprimer la liste
                  </Button>
                )}
              </div>

              {active.note && (
                <p className="px-1 text-[11px] italic text-text-muted">{active.note}</p>
              )}

              <p className="px-1 text-xs text-text-muted">
                {filtered.length} ligne(s) affichee(s) sur {active.rows.length}
                {(from || to) &&
                  ` · du ${from ? formatDate(from) : '…'} au ${to ? formatDate(to) : '…'}`}
              </p>

              <DataTable
                rows={filtered}
                columns={active.columns as DataColumn<never>[]}
                rowKey={(_row, i) => `${active.key}-${i}`}
                actions={active.actions}
                empty={
                  <div className="rounded-2xl border border-dashed border-gold/25 bg-vanilla/20 py-12 text-center">
                    <p className="text-sm italic text-text-muted">{active.empty}</p>
                  </div>
                }
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </PresenceLayer>
      )}
    </AnimatePresence>,
    document.body
  );
}

/* -------------------------------------------------------------------------- */
/*  Petites briques reutilisees par les ecrans clients / fournisseurs          */
/* -------------------------------------------------------------------------- */

export const HistoryIcons = {
  sales: <ShoppingBag size={14} />,
  commands: <ClipboardList size={14} />,
  deliveries: <Truck size={14} />,
  payments: <Coins size={14} />,
  oldDebts: <History size={14} />,
  refunds: <Undo2 size={14} />,
  adjustments: <ScissorsSquare size={14} />,
  purchases: <Package size={14} />,
  wallet: <Wallet size={14} />,
  up: <TrendingUp size={14} />,
  down: <TrendingDown size={14} />,
  ok: <CheckCircle2 size={14} />,
};

export const rowActionIcons = {
  view: <Eye size={15} />,
  edit: <Pencil size={15} />,
  print: <Printer size={15} />,
  delete: <Trash2 size={15} />,
};

/** Cellule « montant » coloree selon qu'il reste ou non quelque chose a payer. */
export function Money({ value, tone }: { value: number; tone?: 'pos' | 'neg' | 'accent' }) {
  return (
    <span className={cn('font-semibold tabular', tone && toneClass[tone])}>
      {formatCurrency(value)}
    </span>
  );
}

/** Badge d'etat d'un document (payee / dette / ancienne...). */
export function StateBadge({ paid, label }: { paid: boolean; label?: string }) {
  return (
    <Badge variant={paid ? 'success' : 'danger'} className="text-[10px]">
      {label ?? (paid ? 'Soldee' : 'Dette')}
    </Badge>
  );
}

export { formatDate, formatDateTime, formatCurrency, paymentMethodLabel };
