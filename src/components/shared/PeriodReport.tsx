import type { ReactNode } from 'react';
import { CalendarRange } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { todayISO } from '@/lib/utils';

/* ============================================================================
 *  Briques partagées des « comptes rendus de période » (clients,
 *  fournisseurs, employés) : sélection de la période, vignettes de synthèse
 *  et tableaux détaillés.
 * ========================================================================== */

/** First day of the current month, as `YYYY-MM-DD`. */
export function firstDayOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** True when `date` (any parsable form) falls inside [from, to] inclusive. */
export function inPeriod(date: string | undefined, from: string, to: string): boolean {
  if (!date) return false;
  const d = date.slice(0, 10);
  return d >= from && d <= to;
}

const PRESETS: Array<[string, () => [string, string]]> = [
  ['Ce mois-ci', () => [firstDayOfMonth(), todayISO()]],
  ['30 derniers jours', () => {
    const d = new Date(); d.setDate(d.getDate() - 29);
    return [d.toISOString().slice(0, 10), todayISO()];
  }],
  ['Cette année', () => [`${new Date().getFullYear()}-01-01`, todayISO()]],
];

export function PeriodPicker({
  from, to, onChange, onGenerate, generating, label = 'Générer le compte rendu',
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  onGenerate: () => void;
  generating?: boolean;
  label?: string;
}) {
  const invalid = !from || !to || from > to;
  return (
    <div className="rounded-2xl border border-gold/20 bg-vanilla/40 p-4 space-y-3">
      <p className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
        <CalendarRange size={14} className="text-gold" /> Période du compte rendu
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Date de début" type="date" value={from}
          onChange={(e) => onChange(e.target.value, to)}
        />
        <Input
          label="Date de fin" type="date" value={to}
          onChange={(e) => onChange(from, e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(([presetLabel, compute]) => (
          <button
            key={presetLabel}
            onClick={() => { const [f, t] = compute(); onChange(f, t); }}
            className="rounded-lg border border-gold/25 bg-cream px-2.5 py-1 text-[11px] font-semibold text-text-secondary hover:bg-gold/10 hover:text-gold-dark transition-colors"
          >
            {presetLabel}
          </button>
        ))}
      </div>
      {invalid && <p className="text-xs text-rose-deep">La date de début doit précéder la date de fin.</p>}
      <Button variant="gold" className="w-full" disabled={invalid || generating} onClick={onGenerate}>
        {generating ? 'Génération…' : label}
      </Button>
    </div>
  );
}

export interface ReportKpi {
  label: string;
  value: string;
  color?: string;
}

export function ReportKpis({ items }: { items: ReportKpi[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
      {items.map((k) => (
        <div key={k.label} className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wide text-text-muted leading-tight">{k.label}</p>
          <p className={`text-sm font-bold tabular mt-0.5 ${k.color ?? 'text-text-primary'}`}>{k.value}</p>
        </div>
      ))}
    </div>
  );
}

export function ReportSection({
  title, icon, total, head, rows, empty, note,
}: {
  title: string;
  icon?: ReactNode;
  total?: string;
  head: string[];
  rows: ReactNode[][];
  empty: string;
  note?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-xl border-l-4 border-gold bg-gold/8 px-3 py-2">
        <h4 className="text-sm font-bold text-gold-dark flex items-center gap-2">{icon}{title}</h4>
        {total && <span className="text-sm font-bold tabular text-gold-dark">{total}</span>}
      </div>
      {note && <p className="text-[11px] italic text-text-muted px-1">{note}</p>}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gold/25 bg-vanilla/20 py-4 text-center text-xs italic text-text-muted">
          {empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gold/15">
          <table className="w-full text-sm">
            <thead className="bg-vanilla/60 text-text-secondary">
              <tr>
                {head.map((h, i) => (
                  <th key={h} className={`px-3 py-2 whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gold/10">
                  {r.map((cell, j) => (
                    <td key={j} className={`px-3 py-2 text-xs ${j === 0 ? 'text-left' : 'text-right tabular'}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
