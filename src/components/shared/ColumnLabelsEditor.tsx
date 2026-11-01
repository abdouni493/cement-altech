import { Columns3, RotateCcw } from 'lucide-react';

/* ============================================================================
 *  NOMS DES COLONNES DU DOCUMENT IMPRIME
 * ----------------------------------------------------------------------------
 *  Affiche, dans la fenetre de confirmation d'impression, toutes les colonnes
 *  du tableau imprime ; l'operateur peut renommer chacune. Le choix est
 *  memorise par modele (`storageKey`) et repris a la prochaine impression.
 * ========================================================================== */

const KEY = (k: string) => `altech.columns.${k}`;

export function loadColumnLabels(storageKey: string, defaults: string[]): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY(storageKey)) || 'null');
    if (Array.isArray(saved) && saved.length === defaults.length) {
      return defaults.map((d, i) => (typeof saved[i] === 'string' && saved[i].trim() ? saved[i] : d));
    }
  } catch { /* stockage indisponible */ }
  return [...defaults];
}

export function saveColumnLabels(storageKey: string, labels: string[]) {
  try { localStorage.setItem(KEY(storageKey), JSON.stringify(labels)); } catch { /* mode prive */ }
}

export function ColumnLabelsEditor({
  defaults, value, onChange,
}: {
  defaults: string[];
  value: string[];
  onChange: (labels: string[]) => void;
}) {
  const changed = value.some((v, i) => v !== defaults[i]);
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-gold-dark">
          <Columns3 size={16} /> Colonnes du tableau imprimé
        </h4>
        {changed && (
          <button
            type="button"
            onClick={() => onChange([...defaults])}
            className="flex items-center gap-1 text-[11px] font-semibold text-text-muted hover:text-gold-dark"
          >
            <RotateCcw size={12} /> Noms d'origine
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 rounded-2xl border border-gold/20 bg-vanilla/40 p-3 sm:grid-cols-2">
        {defaults.map((d, i) => (
          <label key={i} className="space-y-1">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Colonne {i + 1} · {d}
            </span>
            <input
              value={value[i] ?? d}
              onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)))}
              onBlur={(e) => {
                if (!e.target.value.trim()) onChange(value.map((v, j) => (j === i ? d : v)));
              }}
              className="h-9 w-full rounded-lg border border-[--border-input] bg-[--surface-input] px-2.5 text-sm font-semibold text-text-primary focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
            />
          </label>
        ))}
      </div>
    </section>
  );
}
