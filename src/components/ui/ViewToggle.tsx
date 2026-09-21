import { useId } from 'react';
import { motion } from 'framer-motion';
import { LayoutGrid, Table2 } from 'lucide-react';
import { SNAP } from '@/lib/animations';
import { cn } from '@/lib/utils';

/* ============================================================================
 *  BASCULE « TABLEAU / CARTES »
 * ----------------------------------------------------------------------------
 *  Presente sur tous les ecrans de la barre laterale. Le mode TABLEAU est le
 *  mode par defaut de l'application (cf. `useViewMode`).
 *
 *  Le fond dore ne « saute » pas d'un bouton a l'autre : il GLISSE, grace a un
 *  `layoutId` partage par les deux etats. Seul `transform` est anime — le GPU
 *  s'en charge, rien n'est recalcule.
 * ========================================================================== */

interface ViewToggleProps {
  view: 'cards' | 'table';
  onChange: (v: 'cards' | 'table') => void;
}

const OPTIONS: { value: 'table' | 'cards'; label: string; icon: typeof Table2 }[] = [
  { value: 'table', label: 'Tableau', icon: Table2 },
  { value: 'cards', label: 'Cartes', icon: LayoutGrid },
];

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  // Propre a CETTE bascule : deux bascules affichees ensemble ne se volent
  // jamais leur pastille doree.
  const pillId = useId();

  return (
    <div className="inline-flex rounded-xl bg-vanilla/60 p-1 border border-gold/20">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = view === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            title={label}
            aria-pressed={active}
            className={cn(
              'relative p-2 rounded-lg transition-colors',
              active ? 'text-white' : 'text-text-muted hover:text-text-primary'
            )}
          >
            {active && (
              <motion.span
                layoutId={pillId}
                transition={SNAP}
                className="absolute inset-0 rounded-lg bg-gradient-button shadow-gold"
              />
            )}
            <motion.span
              className="relative block"
              whileTap={{ scale: 0.88 }}
              transition={SNAP}
            >
              <Icon size={18} />
            </motion.span>
          </button>
        );
      })}
    </div>
  );
}
