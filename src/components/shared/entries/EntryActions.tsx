import { Eye, Pencil } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { isEditable, type EntryRequest, type EntryTarget } from './EntryEditor';

/** Module de droits qui gouverne la modification d'une ligne. */
function moduleOf(t: EntryTarget): 'clients' | 'suppliers' | 'purchase' {
  if (t.kind === 'purchase') return 'purchase';
  if ('party' in t) return t.party === 'supplier' ? 'suppliers' : 'clients';
  return 'clients';
}

/**
 * Boutons « Voir » et « Modifier » d'une ligne de releve / de rapport.
 * Rien n'est affiche quand la ligne ne renvoie a aucun enregistrement.
 */
export function EntryActions({
  target, onOpen,
}: {
  target: EntryTarget | null;
  onOpen: (req: EntryRequest) => void;
}) {
  const { can } = usePermissions();
  if (!target) return <span className="text-text-muted">—</span>;
  const editable = isEditable(target) && can(moduleOf(target), 'edit');
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <button
        type="button"
        title="Voir le détail"
        onClick={() => onOpen({ target, mode: 'view' })}
        className="rounded-lg border border-gold/20 p-1.5 text-text-secondary transition-colors hover:bg-gold/10 hover:text-gold-dark"
      >
        <Eye size={14} />
      </button>
      {editable && (
        <button
          type="button"
          title="Modifier"
          onClick={() => onOpen({ target, mode: 'edit' })}
          className="rounded-lg border border-gold/20 p-1.5 text-text-secondary transition-colors hover:bg-gold/10 hover:text-gold-dark"
        >
          <Pencil size={14} />
        </button>
      )}
    </span>
  );
}
