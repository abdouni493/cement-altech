import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { modalVariants } from '@/lib/animations';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
}

const sizes = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
};

export function Modal({ open, onClose, title, children, size = 'md', footer }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) {
      document.addEventListener('keydown', handler);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-[#7A2E55]/30 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              'relative z-10 w-full bg-cream rounded-2xl shadow-hover border border-gold/20 max-h-[92vh] flex flex-col',
              sizes[size]
            )}
          >
            {title && (
              <div className="flex items-center justify-between px-6 py-4 border-b border-gold/15 shrink-0">
                <h2 className="font-display text-xl font-semibold text-text-primary">{title}</h2>
                <button
                  onClick={onClose}
                  className="text-text-muted hover:text-rose-deep transition-colors rounded-lg p-1 hover:bg-rose/10"
                >
                  <X size={20} />
                </button>
              </div>
            )}
            <div className="overflow-y-auto px-6 py-5 flex-1">{children}</div>
            {footer && (
              <div className="px-6 py-4 border-t border-gold/15 flex justify-end gap-3 shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
