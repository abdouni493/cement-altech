import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cardVariants } from '@/lib/animations';
import { useCountUp } from '@/hooks/useCountUp';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: number;
  icon: ReactNode;
  format?: 'currency' | 'number';
  accent?: 'gold' | 'rose' | 'pistachio' | 'caramel' | 'lavender';
  index?: number;
  suffix?: string;
}

const accents = {
  gold: 'from-[#FF9CC0] to-[#F0568A]',
  rose: 'from-[#FFB0CB] to-[#F2547D]',
  pistachio: 'from-[#A6E9CE] to-[#3FB591]',
  caramel: 'from-[#FFD08A] to-[#F2944A]',
  lavender: 'from-[#CDB0F5] to-[#9B7ED8]',
};

export function StatCard({ label, value, icon, format = 'number', accent = 'gold', index = 0, suffix }: StatCardProps) {
  const animated = useCountUp(value, 1200);
  const display = format === 'currency' ? formatCurrency(animated) : formatNumber(Math.round(animated));

  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover="hover"
      className="rounded-2xl bg-gradient-card border border-gold/15 shadow-card p-5 relative overflow-hidden"
    >
      <div className={cn('absolute -top-6 -right-6 h-20 w-20 rounded-full bg-gradient-to-br opacity-10', accents[accent])} />
      <div className="flex items-start justify-between mb-3">
        <div className={cn('h-11 w-11 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shadow-sm', accents[accent])}>
          {icon}
        </div>
      </div>
      <p className="text-sm text-text-muted mb-1">{label}</p>
      <p className="text-2xl font-bold text-text-primary tabular">
        {display}
        {suffix && <span className="text-base font-medium text-text-muted ml-1">{suffix}</span>}
      </p>
    </motion.div>
  );
}
