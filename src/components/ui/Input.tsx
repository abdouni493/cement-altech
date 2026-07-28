import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, suffix, ...props }, ref) => (
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
          className={cn(
            'w-full h-10 rounded-xl border-2 px-3.5 text-sm font-medium transition-all shadow-sm focus:outline-none',
            'bg-[--surface-input] text-text-primary placeholder:text-text-muted/70',
            'focus:bg-[--surface-input-focus] focus:ring-2 focus:ring-gold/30 focus:border-gold',
            icon && 'pl-10',
            suffix && 'pr-12',
            error ? 'border-rose-deep' : 'border-[--border-input]',
            className
          )}
          {...props}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2">{suffix}</span>}
      </div>
      {error && <p className="text-xs text-rose-deep mt-1 font-medium">{error}</p>}
    </div>
  )
);
Input.displayName = 'Input';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, ...props }, ref) => (
    <div className="w-full">
      {label && (
        <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        className={cn(
          'w-full rounded-xl border-2 px-3.5 py-2.5 text-sm font-medium transition-all min-h-[80px] resize-y shadow-sm focus:outline-none',
          'bg-[--surface-input] text-text-primary placeholder:text-text-muted/70',
          'focus:bg-[--surface-input-focus] focus:ring-2 focus:ring-gold/30 focus:border-gold',
          error ? 'border-rose-deep' : 'border-[--border-input]',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-rose-deep mt-1 font-medium">{error}</p>}
    </div>
  )
);
Textarea.displayName = 'Textarea';
