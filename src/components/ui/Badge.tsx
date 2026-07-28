import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        success: 'bg-pistachio/15 text-pistachio',
        warning: 'bg-caramel/15 text-caramel',
        danger: 'bg-rose-deep/15 text-rose-deep',
        info: 'bg-gold/15 text-gold-dark',
        gold: 'bg-gradient-button text-white',
        neutral: 'bg-text-muted/15 text-text-secondary',
      },
    },
    defaultVariants: { variant: 'info' },
  }
);

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: ReactNode;
  className?: string;
}

export function Badge({ children, variant, className }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)}>{children}</span>;
}
