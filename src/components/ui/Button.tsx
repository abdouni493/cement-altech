import { forwardRef } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold tracking-[0.01em] select-none whitespace-nowrap ' +
    'transition-[background-color,border-color,color,box-shadow,filter] duration-150 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-cream ' +
    'disabled:opacity-45 disabled:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Or metallique, texte noir — l'action principale de chaque ecran
        primary:
          'bg-gradient-button text-[--btn-on-gold] border border-gold-dark/50 ' +
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_2px_rgba(0,0,0,0.25)] hover:brightness-110 hover:shadow-gold',
        gold:
          'bg-gradient-button text-[--btn-on-gold] border border-gold-dark/50 ' +
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_1px_2px_rgba(0,0,0,0.25)] hover:brightness-110 hover:shadow-gold',

        // Surface neutre, filet dore au survol
        secondary:
          'bg-chocolate text-text-primary border border-[--border-input] shadow-sm ' +
          'hover:border-gold/70 hover:text-gold-dark hover:bg-vanilla/60',

        // Noir et or — action forte mais secondaire
        liver:
          'bg-[#111111] text-gold-light border border-gold/40 shadow-sm ' +
          'hover:bg-black hover:border-gold hover:text-[#f4dc8f]',

        rose: 'bg-rose-deep text-white border border-rose-deep shadow-sm hover:brightness-110',
        danger: 'bg-rose-deep text-white border border-rose-deep shadow-sm hover:brightness-110',
        lavender: 'bg-lavender-deep text-white border border-lavender-deep shadow-sm hover:brightness-110',
        mint: 'bg-emerald-600 text-white border border-emerald-700 shadow-sm hover:bg-emerald-700',

        ghost: 'bg-transparent text-text-secondary hover:bg-gold/10 hover:text-text-primary',

        outline:
          'bg-transparent border border-gold/70 text-gold-dark ' +
          'hover:bg-gold hover:text-[--btn-on-gold] hover:border-gold',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-[15px]',
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
      whileTap={{ scale: 0.98 }}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </motion.button>
  )
);
Button.displayName = 'Button';
