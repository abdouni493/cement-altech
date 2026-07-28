import { cn } from '@/lib/utils';

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  className?: string;
}

export function Switch({ checked, onChange, label, className }: SwitchProps) {
  return (
    <label className={cn('inline-flex items-center gap-2.5 cursor-pointer select-none', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 rounded-full transition-colors duration-200 shrink-0',
          checked ? 'bg-gradient-button' : 'bg-text-muted/30'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
            checked && 'translate-x-5'
          )}
        />
      </button>
      {label && <span className="text-sm text-text-secondary">{label}</span>}
    </label>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  className?: string;
}

export function Checkbox({ checked, onChange, label, className }: CheckboxProps) {
  return (
    <label className={cn('inline-flex items-center gap-2 cursor-pointer select-none', className)}>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          'h-5 w-5 rounded-md border-2 flex items-center justify-center transition-colors shrink-0',
          checked ? 'bg-gold border-gold' : 'bg-white/60 border-gold/40'
        )}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
      {label && <span className="text-sm text-text-secondary">{label}</span>}
    </label>
  );
}
