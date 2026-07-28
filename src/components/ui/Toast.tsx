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

const config = {
  success: { icon: CheckCircle2, color: '#7A9E7E', bg: '#F0F7F1' },
  error: { icon: XCircle, color: '#C4687A', bg: '#FBEEF2' },
  warning: { icon: AlertTriangle, color: '#D4854A', bg: '#FCF3EA' },
  info: { icon: Info, color: '#C9A84C', bg: '#FBF6E9' },
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
              style={{ background: c.bg, borderColor: c.color + '40' }}
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
