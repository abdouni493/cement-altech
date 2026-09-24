import { useEffect, useMemo, useState } from 'react';
import {
  Printer, Percent, ListChecks, CheckSquare, Square, Lock, Info, Table2, Coins, LayoutList,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatCurrency, DEFAULT_TVA_RATE } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { StatementTvaMode } from '@/lib/statementPrint';
import {
  DocTitlePicker, initialDocTitleChoice, resolvedDocTitle, resolvedPeriodPrefix, type DocTitleChoice,
} from './DocTitlePicker';

/* ============================================================================
 *  AVANT D'IMPRIMER UN COMPTE RENDU / UN BON DE LIVRAISON DE PERIODE
 * ----------------------------------------------------------------------------
 *  L'operateur choisit :
 *   1. CE QUI FORME LE TABLEAU des operations (livraisons, ventes, achats) —
 *      nouvelles et anciennes toujours ensemble, dans l'ordre des dates ;
 *   2. les ANCIENNES DETTES / la dette anterieure (au-dessus du total) et les
 *      VERSEMENTS (total, reste et liste en fin de document) ;
 *   3. les tableaux complementaires : MARCHANDISES (a cocher ou non),
 *      commandes en cours, annulations ;
 *   4. la TVA : celle des documents, aucune, ou un taux impose.
 *  L'apercu des totaux suit chaque case cochee : ce qui est affiche ici est ce
 *  qui sortira sur le papier.
 * ========================================================================== */

export type StatementPartKey =
  | 'deliveries' | 'sales' | 'purchases' | 'oldDebts' | 'versements'
  | 'products' | 'pendingCommands' | 'adjustments';

export interface StatementPrintChoice {
  deliveries: boolean;
  sales: boolean;
  purchases: boolean;
  oldDebts: boolean;
  versements: boolean;
  products: boolean;
  pendingCommands: boolean;
  adjustments: boolean;
  tvaMode: StatementTvaMode;
  tvaRate: number;
  /** Titre choisi pour l'en-tete du document. */
  docTitle?: string;
  /** Texte choisi devant les dates de la periode. */
  periodPrefix?: string;
}

export interface StatementPrintPart {
  key: StatementPartKey;
  label: string;
  hint?: string;
  count: number;
  total?: string;
  /** Toujours imprime (ex. les livraisons d'un bon de livraison de periode). */
  locked?: boolean;
  defaultChecked?: boolean;
  group: 'table' | 'foot' | 'extra';
}

export interface StatementPreview {
  ht: number;
  tva: number;
  total: number;
  versements: number;
  rest: number;
}

const EMPTY_CHOICE: StatementPrintChoice = {
  deliveries: false, sales: false, purchases: false, oldDebts: false, versements: false,
  products: false, pendingCommands: false, adjustments: false,
  tvaMode: 'documents', tvaRate: DEFAULT_TVA_RATE,
};

const PRODUCTS_KEY = (kind: string) => `altech.statement.products.${kind}`;

function readProductsPref(kind: string): boolean | null {
  try {
    const v = localStorage.getItem(PRODUCTS_KEY(kind));
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

function writeProductsPref(kind: string, on: boolean) {
  try { localStorage.setItem(PRODUCTS_KEY(kind), on ? '1' : '0'); } catch { /* mode prive */ }
}

export function StatementPrintDialog({
  open, onClose, onPrint, parts, kind, preview, note,
  title = 'Impression du compte rendu', printLabel = 'Imprimer',
  defaultDocTitle, defaultPeriodPrefix, periodSuffix,
}: {
  open: boolean;
  onClose: () => void;
  onPrint: (choice: StatementPrintChoice) => void;
  parts: StatementPrintPart[];
  kind: 'client' | 'supplier';
  preview?: (choice: StatementPrintChoice) => StatementPreview;
  note?: string;
  title?: string;
  printLabel?: string;
  /** Titre imprime par defaut — ex. « COMPTE RENDU CLIENT ». */
  defaultDocTitle: string;
  /** Texte d'origine devant les dates — ex. « COMPTE RENDU ». */
  defaultPeriodPrefix: string;
  /** « DU 01/09/2026 AU 25/09/2026 ». */
  periodSuffix?: string;
}) {
  const [choice, setChoice] = useState<StatementPrintChoice>(EMPTY_CHOICE);
  const [titleChoice, setTitleChoice] = useState<DocTitleChoice>(() =>
    initialDocTitleChoice(defaultDocTitle, defaultPeriodPrefix));

  // Chaque impression repart des valeurs par defaut ; seul le choix
  // « marchandises » est memorise (il depend des habitudes de l'entreprise).
  useEffect(() => {
    if (!open) return;
    const next: StatementPrintChoice = { ...EMPTY_CHOICE };
    parts.forEach((p) => {
      next[p.key] = p.locked ? true : p.defaultChecked ?? p.count > 0;
    });
    const pref = readProductsPref(kind);
    if (pref !== null && parts.some((p) => p.key === 'products')) next.products = pref;
    setChoice(next);
    setTitleChoice(initialDocTitleChoice(defaultDocTitle, defaultPeriodPrefix));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (p: StatementPrintPart) => {
    if (p.locked) return;
    setChoice((c) => {
      const next = { ...c, [p.key]: !c[p.key] };
      if (p.key === 'products') writeProductsPref(kind, next.products);
      return next;
    });
  };

  const totals = useMemo(() => (preview ? preview(choice) : null), [preview, choice]);
  const nothingInTable = !parts.some((p) => p.group === 'table' && choice[p.key]);

  const groups: { key: StatementPrintPart['group']; label: string; icon: JSX.Element }[] = [
    { key: 'table', label: 'Tableau des operations', icon: <Table2 size={15} /> },
    { key: 'foot', label: 'Au pied du tableau', icon: <Coins size={15} /> },
    { key: 'extra', label: 'Tableaux complementaires', icon: <LayoutList size={15} /> },
  ];

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-5">
        <section className="space-y-3">
          <h4 className="flex items-center gap-2 text-sm font-bold text-gold-dark">
            <ListChecks size={16} /> Ce qui figure sur le document
          </h4>
          {groups.map((g) => {
            const list = parts.filter((p) => p.group === g.key);
            if (!list.length) return null;
            return (
              <div key={g.key} className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  {g.icon} {g.label}
                </p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {list.map((p) => {
                    const on = choice[p.key];
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => toggle(p)}
                        className={cn(
                          'flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                          on ? 'border-gold/50 bg-gold/10' : 'border-gold/15 bg-vanilla/30 hover:bg-gold/5',
                          p.locked && 'cursor-default'
                        )}
                      >
                        <span className="flex min-w-0 items-start gap-2">
                          {p.locked ? <Lock size={15} className="mt-0.5 shrink-0 text-gold-dark" />
                            : on ? <CheckSquare size={16} className="mt-0.5 shrink-0 text-gold-dark" />
                            : <Square size={16} className="mt-0.5 shrink-0 text-text-muted" />}
                          <span className="min-w-0">
                            <span className="block text-[13px] font-semibold text-text-primary">
                              {p.label}
                              <span className="ml-1 text-[11px] font-normal text-text-muted">({p.count})</span>
                            </span>
                            {p.hint && <span className="block text-[11px] text-text-muted">{p.hint}</span>}
                          </span>
                        </span>
                        {p.total && <span className="shrink-0 text-[11px] font-bold tabular text-gold-dark">{p.total}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        <DocTitlePicker
          value={titleChoice}
          onChange={setTitleChoice}
          defaultTitle={defaultDocTitle}
          defaultPeriodPrefix={defaultPeriodPrefix}
          periodSuffix={periodSuffix}
          scope={kind === 'client' && defaultDocTitle.startsWith('BON') ? 'delivery' : 'statement'}
        />

        <section className="space-y-2.5">
          <h4 className="flex items-center gap-2 text-sm font-bold text-gold-dark">
            <Percent size={16} /> T.V.A
          </h4>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gold/25 bg-vanilla/40 p-3">
            <Button
              size="sm"
              variant={choice.tvaMode === 'documents' ? 'gold' : 'secondary'}
              onClick={() => setChoice((c) => ({ ...c, tvaMode: 'documents' }))}
            >
              TVA des documents
            </Button>
            <Button
              size="sm"
              variant={choice.tvaMode === 'none' ? 'gold' : 'secondary'}
              onClick={() => setChoice((c) => ({ ...c, tvaMode: 'none' }))}
            >
              Sans TVA
            </Button>
            <Button
              size="sm"
              variant={choice.tvaMode === 'forced' ? 'gold' : 'secondary'}
              onClick={() => setChoice((c) => ({ ...c, tvaMode: 'forced' }))}
            >
              <Percent size={14} /> Avec TVA
            </Button>
            {choice.tvaMode === 'forced' && (
              <label className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
                Taux
                <input
                  type="number" step="any" min={0} max={100}
                  value={choice.tvaRate}
                  onChange={(e) => setChoice((c) => ({ ...c, tvaRate: Math.max(0, Number(e.target.value)) }))}
                  className="h-9 w-20 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-center text-sm font-semibold tabular text-text-primary focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
                />
                %
              </label>
            )}
            <span className="w-full text-[11px] text-text-muted">
              « TVA des documents » reprend la TVA réellement facturée sur chaque bon / facture : le reste imprimé est alors
              exactement celui du compte.
            </span>
          </div>
        </section>

        {totals && (
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label={totals.tva > 0 ? 'Total H.T' : 'Total opérations'} value={formatCurrency(totals.ht)} />
            <Tile label="Total général" value={formatCurrency(totals.total)} strong />
            <Tile label="Total versements" value={formatCurrency(totals.versements)} muted={!choice.versements} />
            <Tile
              label={totals.rest >= 0 ? 'Reste à payer' : kind === 'client' ? 'En faveur du client' : 'Trop-versé'}
              value={formatCurrency(Math.abs(totals.rest))}
              strong
              muted={!choice.versements}
            />
          </section>
        )}

        {note && (
          <p className="flex items-start gap-2 rounded-xl border border-gold/20 bg-vanilla/40 px-3 py-2 text-[11px] text-text-muted">
            <Info size={14} className="mt-0.5 shrink-0 text-gold" /> {note}
          </p>
        )}

        <div className="flex gap-2 border-t border-gold/15 pt-4">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Annuler</Button>
          <Button variant="gold" className="flex-1 font-bold" disabled={nothingInTable} onClick={() => onPrint({
            ...choice,
            docTitle: resolvedDocTitle(titleChoice, defaultDocTitle),
            periodPrefix: resolvedPeriodPrefix(titleChoice, defaultPeriodPrefix),
          })}>
            <Printer size={16} /> {printLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Tile({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn('rounded-xl border border-gold/20 bg-vanilla/50 px-2.5 py-2 text-center', muted && 'opacity-50')}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{label}</p>
      <p className={cn('mt-0.5 text-sm font-bold tabular', strong ? 'text-gold-dark' : 'text-text-primary')}>{value}</p>
    </div>
  );
}
