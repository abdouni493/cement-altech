import { ChevronsDown } from 'lucide-react';
import { Button } from './Button';

interface ShowMoreProps {
  /** Lignes deja affichees. */
  shown: number;
  /** Nombre total de lignes correspondant aux filtres. */
  total: number;
  /** Combien de lignes un clic ajoute. */
  step: number;
  loading?: boolean;
  onMore: () => void;
}

/**
 * « Afficher plus » : sous une liste, ajoute la tranche suivante pour
 * continuer a defiler sans changer de page.
 */
export function ShowMore({ shown, total, step, loading, onMore }: ShowMoreProps) {
  const rest = Math.max(0, total - shown);
  return (
    <div className="flex flex-col items-center gap-2 py-3 text-xs text-text-muted">
      <span>{Math.min(shown, total)} / {total} affichée(s)</span>
      {rest > 0 && (
        <Button variant="secondary" disabled={loading} onClick={onMore}>
          <ChevronsDown size={16} />
          {loading ? 'Chargement…' : `Afficher plus (${Math.min(step, rest)} de ${rest} restante(s))`}
        </Button>
      )}
    </div>
  );
}
