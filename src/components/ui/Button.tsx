import { forwardRef } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap active:scale-[0.98]',
  {
    variants: {
      variant: {
        // Gold buttons remain signature rich metallic gold
        primary: 'bg-gradient-button text-stone-950 font-bold shadow-gold hover:brightness-105 border border-amber-300/40',
        gold: 'bg-gradient-button text-stone-950 font-bold shadow-gold hover:brightness-105 border border-amber-300/40',

        // Theme-adaptive secondary button
        secondary:
          'border font-semibold shadow-sm ' +
          'bg-vanilla text-text-secondary border-[--border-input] hover:bg-gold/10 hover:text-text-primary',

        liver:
          'border font-bold shadow-md ' +
          'bg-gradient-to-r from-[#6b574d] to-[#54433a] text-amber-50 border-[#45362e] hover:from-[#5c4940] hover:to-[#483931]',

        rose:
          'text-white shadow-md border ' +
          'bg-gradient-to-r from-rose-600 to-rose-700 border-rose/60 hover:from-rose-700 hover:to-rose-800',

        danger:
          'text-white shadow-md border ' +
          'bg-gradient-to-r from-rose-600 to-rose-700 border-rose/60 hover:from-rose-700 hover:to-rose-800',

        lavender:
          'text-white shadow-md border ' +
          'bg-gradient-to-r from-purple-600 to-indigo-600 border-purple-400 hover:from-purple-700 hover:to-indigo-700',

        mint:
          'text-white shadow-md border ' +
          'bg-gradient-to-r from-emerald-600 to-teal-700 border-emerald-500 hover:from-emerald-700 hover:to-teal-800',

        ghost:
          'bg-transparent font-medium ' +
          'text-text-secondary hover:bg-gold/10 hover:text-text-primary',

        outline:
          'bg-transparent border-2 font-bold ' +
          'border-gold/60 text-gold hover:bg-gold/15 hover:text-gold-dark',
      },
      size: {
        sm: 'text-xs px-3 py-1.5 h-8',
        md: 'text-sm px-4 py-2.5 h-10',
        lg: 'text-base px-6 py-3 h-12',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends Omit<HTMLMotionProps<'button'>, 'ref'>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, children, ...props }, ref) => (
    <motion.button
      ref={ref}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </motion.button>
  )
);
Button.displayName = 'Button';
