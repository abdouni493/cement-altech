import { CheckSquare, Square, Coins } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn, formatCurrency, formatDate } from '@/lib/utils';

export interface VersementItem {
  id: string;
  date: string;
  label: string;
  amount: number;
}

/**
 * Liste a cocher des versements imprimes. Un versement decoche n'apparait
 * plus dans la liste du document, mais reste compte dans les totaux.
 */
export function VersementChecklist({
  items, hidden, onChange, title = 'Versements affichés sur le document',
}: {
  items: VersementItem[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  title?: string;
}) {
  if (!items.length) return null;
  const shown = items.filter((v) => !hidden.includes(v.id)).length;
  const toggle = (id: string) =>
    onChange(hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);

  return (
    <section className="space-y-2 rounded-2xl border border-gold/25 bg-vanilla/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-bold text-gold-dark">
          <Coins size={15} /> {title}
          <span className="text-[11px] font-normal text-text-muted">({shown}/{items.length})</span>
        </p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => onChange([])}>
            Tout cocher
          </Button>
          <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => onChange(items.map((v) => v.id))}>
            Tout décocher
          </Button>
        </div>
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {items.map((v) => {
          const on = !hidden.includes(v.id);
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => toggle(v.id)}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                on ? 'border-gold/40 bg-gold/10' : 'border-gold/10 bg-transparent opacity-60 hover:bg-gold/5'
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {on ? <CheckSquare size={15} className="shrink-0 text-gold-dark" />
                  : <Square size={15} className="shrink-0 text-text-muted" />}
                <span className="shrink-0 tabular text-text-muted">{formatDate(v.date.slice(0, 10))}</span>
                <span className="truncate font-semibold text-text-primary">{v.label}</span>
              </span>
              <span className="shrink-0 font-bold tabular text-pistachio">{formatCurrency(v.amount)}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-text-muted">
        Un versement décoché est seulement masqué de la liste imprimée : il reste compté dans « Total versements » et le reste à payer.
      </p>
    </section>
  );
}
