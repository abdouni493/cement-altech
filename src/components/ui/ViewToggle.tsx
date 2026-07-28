import { LayoutGrid, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ViewToggleProps {
  view: 'cards' | 'table';
  onChange: (v: 'cards' | 'table') => void;
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="inline-flex rounded-xl bg-vanilla/60 p-1 border border-gold/20">
      <button
        onClick={() => onChange('cards')}
        className={cn(
          'p-2 rounded-lg transition-colors',
          view === 'cards' ? 'bg-gradient-button text-white shadow-gold' : 'text-text-muted hover:text-text-primary'
        )}
        title="Cartes"
      >
        <LayoutGrid size={18} />
      </button>
      <button
        onClick={() => onChange('table')}
        className={cn(
          'p-2 rounded-lg transition-colors',
          view === 'table' ? 'bg-gradient-button text-white shadow-gold' : 'text-text-muted hover:text-text-primary'
        )}
        title="Tableau"
      >
        <Table2 size={18} />
      </button>
    </div>
  );
}
