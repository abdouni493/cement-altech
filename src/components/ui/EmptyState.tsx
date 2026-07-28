import { motion } from 'framer-motion';
import { PackageOpen } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  message?: string;
  icon?: ReactNode;
}

export function EmptyState({ message = 'Aucune donnée', icon }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center py-16 text-text-muted"
    >
      <div className="h-16 w-16 rounded-2xl bg-vanilla/70 flex items-center justify-center mb-4 text-gold">
        {icon || <PackageOpen size={32} />}
      </div>
      <p className="text-sm font-medium">{message}</p>
    </motion.div>
  );
}
