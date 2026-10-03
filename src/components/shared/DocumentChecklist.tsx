import { useMemo } from 'react';
import { CheckSquare, Square, FileCheck2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import type { StatementPartKey } from './StatementPrintDialog';

export interface DocumentItem {
  id: string;
  /** Partie du document a laquelle il appartient (livraisons, ventes, achats). */
  part: StatementPartKey;
  date: string;
  reference: string;
  label?: string;
  /** Adresse de livraison — permet d'imprimer une seule adresse. */
  location?: string;
  amount: number;
}

const NO_ADDRESS = 'Sans adresse';
const addressOf = (d: DocumentItem) => d.location?.trim() || NO_ADDRESS;
const norm = (a: string) => a.trim().toLowerCase();

/**
 * Choix des documents imprimes : un par un, tout cocher / tout decocher, ou
 * par ADRESSE de livraison (ne garder que les bons livres au meme endroit).
 * Un document decoche sort du tableau ET des totaux.
 */
export function DocumentChecklist({
  items, excluded, onChange,
}: {
  items: DocumentItem[];
  excluded: string[];
  onChange: (excluded: string[]) => void;
}) {
  const addresses = useMemo(() => {
    const map = new Map<string, { label: string; ids: string[] }>();
    items.forEach((d) => {
      const a = addressOf(d);
      const cur = map.get(norm(a)) ?? { label: a, ids: [] };
      cur.ids.push(d.id);
      map.set(norm(a), cur);
    });
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }, [items]);

  if (!items.length) return null;
  const shown = items.filter((d) => !excluded.includes(d.id)).length;
  const toggle = (id: string) =>
    onChange(excluded.includes(id) ? excluded.filter((x) => x !== id) : [...excluded, id]);

  /** Etat d'une adresse : toute cochee, en partie, ou pas du tout. */
  const addrState = (ids: string[]) => {
    const on = ids.filter((id) => !excluded.includes(id)).length;
    return on === ids.length ? 'all' : on === 0 ? 'none' : 'some';
  };
  const toggleAddress = (ids: string[]) =>
    onChange(addrState(ids) === 'all'
      ? [...new Set([...excluded, ...ids])]
      : excluded.filter((x) => !ids.includes(x)));
  const onlyAddress = (ids: string[]) =>
    onChange(items.map((d) => d.id).filter((id) => !ids.includes(id)));

  return (
    <section className="space-y-2.5 rounded-2xl border border-gold/25 bg-vanilla/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-bold text-gold-dark">
          <FileCheck2 size={15} /> Documents à imprimer
          <span className="text-[11px] font-normal text-text-muted">({shown}/{items.length})</span>
        </p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => onChange([])}>
            Tout cocher
          </Button>
          <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => onChange(items.map((d) => d.id))}>
            Tout décocher
          </Button>
        </div>
      </div>

      {addresses.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
            <MapPin size={12} /> Par adresse de livraison
          </p>
          <div className="flex flex-wrap gap-1.5">
            {addresses.map((a) => {
              const st = addrState(a.ids);
              return (
                <span
                  key={a.label}
                  className={cn(
                    'flex items-center overflow-hidden rounded-full border text-[11px] font-semibold',
                    st === 'all' ? 'border-gold/50 bg-gold/15 text-gold-dark'
                      : st === 'some' ? 'border-gold/30 bg-gold/5 text-text-primary'
                      : 'border-gold/15 text-text-muted'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleAddress(a.ids)}
                    className="flex items-center gap-1 px-2.5 py-1 hover:bg-gold/10"
                    title="Cocher / décocher tous les documents de cette adresse"
                  >
                    {st === 'all' ? <CheckSquare size={13} /> : <Square size={13} />}
                    {a.label} <span className="font-normal opacity-70">({a.ids.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onlyAddress(a.ids)}
                    className="border-l border-gold/20 px-2 py-1 text-[10px] uppercase hover:bg-gold/10"
                    title="N'imprimer que cette adresse"
                  >
                    Seule
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {items.map((d) => {
          const on = !excluded.includes(d.id);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.id)}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                on ? 'border-gold/40 bg-gold/10' : 'border-gold/10 bg-transparent opacity-60 hover:bg-gold/5'
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {on ? <CheckSquare size={15} className="shrink-0 text-gold-dark" />
                  : <Square size={15} className="shrink-0 text-text-muted" />}
                <span className="shrink-0 tabular text-text-muted">{formatDate(d.date.slice(0, 10))}</span>
                <span className="shrink-0 font-semibold text-text-primary">{d.reference}</span>
                {d.label && <span className="truncate text-text-secondary">{d.label}</span>}
                <span className="flex shrink-0 items-center gap-0.5 text-text-muted">
                  <MapPin size={11} />{addressOf(d)}
                </span>
              </span>
              <span className="shrink-0 font-bold tabular text-gold-dark">{formatCurrency(d.amount)}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-text-muted">
        Un document décoché n'est pas imprimé et sort du total ; l'argent encaissé sur lui sort aussi des versements.
      </p>
    </section>
  );
}
