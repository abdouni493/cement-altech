import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-wrap items-center justify-between gap-4 mb-6"
    >
      <div className="flex items-center gap-3">
        {icon && (
          <div className="h-12 w-12 rounded-2xl bg-gradient-button flex items-center justify-center text-white shadow-gold">
            {icon}
          </div>
        )}
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">{title}</h1>
          {subtitle && <p className="text-sm text-text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </motion.div>
  );
}
