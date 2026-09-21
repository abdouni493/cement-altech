import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { rowVariants } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { ActionMenu, type ActionItem } from './ActionMenu';

/* ============================================================================
 *  TABLEAU DE DONNEES PARTAGE
 * ----------------------------------------------------------------------------
 *  Tous les ecrans qui affichaient des cartes peuvent desormais afficher leurs
 *  donnees en TABLEAU — c'est le mode par defaut, demande par l'entreprise :
 *  on lit plus vite, on compare plus vite et l'ecran se rend beaucoup plus vite
 *  (une ligne de tableau coute infiniment moins cher qu'une carte animee).
 *
 *  Les boutons d'action ne sont plus alignes sur chaque ligne : ils sont
 *  regroupes dans le menu « trois points » de la derniere colonne.
 * ========================================================================== */

export interface DataColumn<T> {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  /** Colonne masquee sur les petits ecrans. */
  hideOnMobile?: boolean;
  width?: string;
  render: (row: T, index: number) => ReactNode;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T, index: number) => string;
  /** Actions de la ligne, regroupees dans le menu « trois points ». */
  actions?: (row: T, index: number) => ActionItem[];
  /** Ligne de totaux collee en bas du tableau. */
  footer?: ReactNode;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
  /** Anime l'apparition des lignes (desactive au-dela de 120 lignes). */
  animate?: boolean;
  dense?: boolean;
}

const alignClass = (a?: 'left' | 'center' | 'right') =>
  a === 'right' ? 'text-right tabular' : a === 'center' ? 'text-center' : 'text-left';

export function DataTable<T>({
  rows, columns, rowKey, actions, footer, empty, onRowClick, className,
  animate = true, dense = false,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  // Au-dela de 120 lignes l'animation d'apparition coute plus qu'elle n'apporte.
  const motionOn = animate && rows.length <= 120;
  const pad = dense ? 'px-3 py-1.5' : 'px-4 py-2.5';

  return (
    <div className={cn('overflow-x-auto rounded-2xl border border-gold/15 bg-gradient-card shadow-card', className)}>
      <table className="w-full text-sm">
        <thead className="bg-vanilla/60 text-text-secondary">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={cn(
                  'whitespace-nowrap text-[11px] font-bold uppercase tracking-wide',
                  pad, alignClass(c.align),
                  c.hideOnMobile && 'hidden md:table-cell'
                )}
              >
                {c.label}
              </th>
            ))}
            {actions && <th className={cn(pad, 'w-12 text-center text-[11px] font-bold uppercase')}>•••</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const body = (
              <>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      pad, 'text-xs md:text-[13px]', alignClass(c.align),
                      c.hideOnMobile && 'hidden md:table-cell'
                    )}
                  >
                    {c.render(row, i)}
                  </td>
                ))}
                {actions && (
                  <td className={cn(pad, 'text-center')} onClick={(e) => e.stopPropagation()}>
                    <ActionMenu items={actions(row, i)} />
                  </td>
                )}
              </>
            );
            const cls = cn(
              'border-t border-gold/10 transition-colors hover:bg-gold/5',
              onRowClick && 'cursor-pointer'
            );
            return motionOn ? (
              <motion.tr
                key={rowKey(row, i)}
                custom={i}
                variants={rowVariants}
                initial="hidden"
                animate="visible"
                className={cls}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {body}
              </motion.tr>
            ) : (
              <tr
                key={rowKey(row, i)}
                className={cls}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {body}
              </tr>
            );
          })}
          {footer}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export type ViewMode = 'table' | 'cards';

/**
 * Preference d'affichage d'un ecran, MEMORISEE par ecran.
 * Valeur par defaut : « tableau » — c'est la demande de l'entreprise pour
 * toutes les interfaces du menu lateral.
 */
export function useViewMode(screen: string, fallback: ViewMode = 'table') {
  const storageKey = `altech.view.${screen}`;
  const [view, setView] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === 'cards' || saved === 'table' ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, view); } catch { /* mode prive */ }
  }, [storageKey, view]);
  return [view, setView] as const;
}
