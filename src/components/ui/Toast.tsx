import { create } from 'zustand';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { uid } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (message: string, type?: ToastType) => void;
  remove: (id: string) => void;
}

const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (message, type = 'success') => {
    const id = uid('toast');
    set({ toasts: [...get().toasts, { id, message, type }] });
    setTimeout(() => get().remove(id), 3500);
  },
  remove: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

// Imperative helper
export const toast = {
  success: (msg: string) => useToastStore.getState().push(msg, 'success'),
  error: (msg: string) => useToastStore.getState().push(msg, 'error'),
  warning: (msg: string) => useToastStore.getState().push(msg, 'warning'),
  info: (msg: string) => useToastStore.getState().push(msg, 'info'),
};

// Colors come from CSS variables so toasts adapt to light/dark mode
const config = {
  success: {
    icon: CheckCircle2,
    color: 'var(--toast-success-fg)',
    bg: 'var(--toast-success-bg)',
    border: 'var(--toast-success-border)',
  },
  error: {
    icon: XCircle,
    color: 'var(--toast-error-fg)',
    bg: 'var(--toast-error-bg)',
    border: 'var(--toast-error-border)',
  },
  warning: {
    icon: AlertTriangle,
    color: 'var(--toast-warning-fg)',
    bg: 'var(--toast-warning-bg)',
    border: 'var(--toast-warning-border)',
  },
  info: {
    icon: Info,
    color: 'var(--toast-info-fg)',
    bg: 'var(--toast-info-bg)',
    border: 'var(--toast-info-border)',
  },
};

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  return (
    <div className="fixed top-5 right-5 z-[100] flex flex-col gap-3 max-w-sm pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => {
          const c = config[t.type];
          const Icon = c.icon;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 80, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.9 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 shadow-hover border"
              style={{ background: c.bg, borderColor: c.border }}
            >
              <Icon size={22} style={{ color: c.color }} className="shrink-0" />
              <span className="text-sm font-medium text-text-primary flex-1">{t.message}</span>
              <button onClick={() => remove(t.id)} className="text-text-muted hover:text-text-primary">
                <X size={16} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
