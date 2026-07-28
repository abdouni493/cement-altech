import { type SelectHTMLAttributes, forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Option {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  error?: string;
  options: Option[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, placeholder, ...props }, ref) => (
    <div className="w-full">
      {label && (
        <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            'w-full h-10 rounded-xl border px-3.5 pr-10 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold transition-all appearance-none cursor-pointer shadow-sm',
            'bg-[--surface-input]',
            error ? 'border-rose-deep' : 'border-[--border-input]',
            className
          )}
          {...props}
        >
          {placeholder && <option value="" className="bg-[--surface-dropdown] text-text-primary">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-[--surface-dropdown] text-text-primary">
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
        />
      </div>
      {error && <p className="text-xs text-rose-deep mt-1 font-medium">{error}</p>}
    </div>
  )
);
Select.displayName = 'Select';
