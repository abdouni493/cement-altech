import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ============================================================================
 *  SAISIE DES DATES AU FORMAT jj/mm/aaaa
 * ----------------------------------------------------------------------------
 *  Le champ natif `<input type="date">` affiche la date au format de la LANGUE
 *  DU NAVIGATEUR (mm/dd/yyyy en anglais, yyyy-mm-dd sous Linux...). L'entreprise
 *  travaille en jj/mm/aaaa : ce composant impose donc l'affichage francais tout
 *  en conservant le contrat technique du champ natif — la valeur lue et ecrite
 *  reste `YYYY-MM-DD` (ou `YYYY-MM-DDTHH:mm` avec l'heure).
 *
 *  - frappe libre, masque applique au fil de l'eau : 05062026 -> 05/06/2026 ;
 *  - l'icone calendrier ouvre le selecteur natif du navigateur ;
 *  - une date incomplete ne detruit pas la valeur enregistree : elle n'est
 *    remontee au parent qu'une fois les 8 chiffres saisis.
 * ========================================================================== */

/** `YYYY-MM-DD` vers `jj/mm/aaaa` (chaine vide si la valeur est vide/invalide). */
export function isoToFr(iso: string | undefined | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** `jj/mm/aaaa` vers `YYYY-MM-DD` (chaine vide tant que la date est incomplete). */
export function frToIso(fr: string): string {
  const digits = fr.replace(/\D/g, '');
  if (digits.length < 8) return '';
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  const d = Number(day);
  const mo = Number(month);
  const y = Number(year);
  if (!d || d > 31 || !mo || mo > 12 || y < 1000) return '';
  return `${year}-${month}-${day}`;
}

/** Masque de frappe : n'accepte que des chiffres et pose les separateurs. */
function maskDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** `jj/mm/aaaa hh:mm` pour les champs qui portent aussi l'heure. */
function maskDateTime(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 12);
  let out = maskDate(d.slice(0, 8));
  if (d.length > 8) out += ` ${d.slice(8, 10)}`;
  if (d.length > 10) out += `:${d.slice(10, 12)}`;
  return out;
}

export function isoToFrDateTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(iso));
  if (!m) return isoToFr(iso);
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

export function frToIsoDateTime(fr: string): string {
  const digits = fr.replace(/\D/g, '');
  if (digits.length < 8) return '';
  const date = frToIso(digits.slice(0, 8));
  if (!date) return '';
  const hh = digits.length >= 10 ? digits.slice(8, 10) : '00';
  const mm = digits.length >= 12 ? digits.slice(10, 12) : '00';
  if (Number(hh) > 23 || Number(mm) > 59) return '';
  return `${date}T${hh}:${mm}`;
}

export interface DateFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label?: string;
  error?: string;
  icon?: ReactNode;
  /** `YYYY-MM-DD` ou `YYYY-MM-DDTHH:mm` selon `withTime`. */
  value?: string;
  withTime?: boolean;
  onChange?: (e: { target: { value: string } }) => void;
}

/**
 * Champ de date affiche en jj/mm/aaaa (jj/mm/aaaa hh:mm avec l'heure).
 * `onChange` recoit toujours un evenement dont `target.value` est la valeur ISO
 * attendue par le reste de l'application.
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(
  ({ className, label, error, icon, value, onChange, withTime = false, disabled, ...props }, ref) => {
    const format = withTime ? isoToFrDateTime : isoToFr;
    const parse = withTime ? frToIsoDateTime : frToIso;
    const mask = withTime ? maskDateTime : maskDate;

    const [text, setText] = useState(() => format(value));
    const nativeRef = useRef<HTMLInputElement | null>(null);
    const editing = useRef(false);

    // La valeur peut changer depuis l'exterieur (bouton « Ce mois-ci »,
    // ouverture d'une fiche...) : on ne reecrit pas le champ pendant la frappe.
    useEffect(() => {
      if (editing.current) return;
      setText(format(value));
    }, [value, withTime]); // eslint-disable-line react-hooks/exhaustive-deps

    const commit = (raw: string) => {
      const masked = mask(raw);
      setText(masked);
      const iso = parse(masked);
      if (iso || masked.replace(/\D/g, '').length === 0) {
        onChange?.({ target: { value: iso } });
      }
    };

    const openPicker = () => {
      const el = nativeRef.current;
      if (!el || disabled) return;
      // `showPicker()` n'existe pas partout : on retombe sur le focus natif.
      try {
        (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
      } catch {
        el.focus();
      }
    };

    return (
      <div className="w-full">
        {label && (
          <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gold pointer-events-none">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={withTime ? 'jj/mm/aaaa hh:mm' : 'jj/mm/aaaa'}
            value={text}
            disabled={disabled}
            onFocus={() => { editing.current = true; }}
            onBlur={() => {
              editing.current = false;
              // Une saisie incomplete revient a la derniere valeur valide.
              setText(format(parse(text) || value));
            }}
            onChange={(e) => commit(e.target.value)}
            className={cn(
              'w-full h-10 rounded-xl border-2 pl-3.5 pr-10 text-sm font-medium tabular transition-all shadow-sm focus:outline-none',
              'bg-[--surface-input] text-text-primary placeholder:text-text-muted/70',
              'focus:bg-[--surface-input-focus] focus:ring-2 focus:ring-gold/30 focus:border-gold',
              icon && 'pl-10',
              error ? 'border-rose-deep' : 'border-[--border-input]',
              className
            )}
            {...props}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={openPicker}
            disabled={disabled}
            title="Ouvrir le calendrier"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gold hover:bg-gold/10 transition-colors disabled:opacity-40"
          >
            <CalendarDays size={16} />
          </button>
          {/* Selecteur natif, invisible : il ne sert qu'au calendrier. */}
          <input
            ref={nativeRef}
            type={withTime ? 'datetime-local' : 'date'}
            tabIndex={-1}
            aria-hidden
            value={withTime ? (value || '').slice(0, 16) : (value || '').slice(0, 10)}
            onChange={(e) => {
              const v = e.target.value;
              setText(format(v));
              onChange?.({ target: { value: v } });
            }}
            className="absolute right-3 bottom-0 h-0 w-0 opacity-0 pointer-events-none"
          />
        </div>
        {error && <p className="text-xs text-rose-deep mt-1 font-medium">{error}</p>}
      </div>
    );
  }
);
DateField.displayName = 'DateField';
