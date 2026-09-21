import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MoreVertical } from 'lucide-react';
import { menuVariants } from '@/lib/animations';
import { cn } from '@/lib/utils';

/* ============================================================================
 *  MENU « TROIS POINTS »
 * ----------------------------------------------------------------------------
 *  Les tableaux de l'application affichent BEAUCOUP de lignes : y poser cinq
 *  boutons par ligne rend l'ecran illisible et lourd a rendre. Chaque ligne
 *  n'expose donc qu'un bouton « trois points » qui deroule ses actions.
 *
 *  Le panneau est rendu dans un PORTAIL et positionne en `fixed` : il n'est
 *  jamais rogne par le `overflow-x-auto` du tableau ni par une fenetre modale.
 * ========================================================================== */

export interface ActionItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Action destructrice — libelle en rouge. */
  danger?: boolean;
  disabled?: boolean;
  /** Une action absente (permission refusee) se declare simplement `hidden`. */
  hidden?: boolean;
}

export function ActionMenu({
  items,
  label = 'Actions',
  align = 'right',
  className,
}: {
  items: ActionItem[];
  label?: string;
  align?: 'left' | 'right';
  className?: string;
}) {
  const visible = items.filter((i) => !i.hidden);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 212;
    const height = Math.min(visible.length * 38 + 12, 320);
    let left = align === 'right' ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = r.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6);
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const reposition = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={label}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted',
          'hover:bg-gold/12 hover:text-gold-dark transition-colors',
          open && 'bg-gold/15 text-gold-dark',
          className
        )}
      >
        <MoreVertical size={16} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              variants={menuVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              style={{ top: pos.top, left: pos.left, transformOrigin: 'top center' }}
              className="fixed z-[120] w-[212px] overflow-hidden rounded-xl border border-gold/25 bg-cream shadow-hover py-1.5"
            >
              {visible.map((item, i) => (
                <button
                  key={`${item.label}-${i}`}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => { setOpen(false); item.onClick(); }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] font-semibold transition-colors',
                    'disabled:opacity-40 disabled:pointer-events-none',
                    item.danger
                      ? 'text-rose-deep hover:bg-rose-deep/10'
                      : 'text-text-secondary hover:bg-gold/10 hover:text-text-primary'
                  )}
                >
                  <span className={cn('shrink-0', item.danger ? 'text-rose-deep' : 'text-gold')}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
