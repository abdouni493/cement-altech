import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
}

export function SearchBar({ value, onChange, placeholder = 'Rechercher...', className, onFocus }: SearchBarProps) {
  return (
    <div className={cn('relative w-full', className)}>
      <Search
        size={18}
        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gold pointer-events-none transition-colors"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={onFocus}
        className={cn(
          'w-full h-11 rounded-xl border-2 pl-11 pr-10 text-sm font-medium transition-all shadow-sm focus:outline-none',
          'bg-[--surface-input] border-[--border-input] text-text-primary placeholder:text-text-muted/80',
          'focus:border-gold focus:ring-2 focus:ring-gold/30 focus:bg-[--surface-input-focus]'
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-rose-deep transition-colors p-1 rounded-full"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
