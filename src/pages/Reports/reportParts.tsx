import type { ReactNode } from 'react';
import type { DocColumn, DocRow } from '@/lib/officialDoc';

/* ============================================================================
 *  LES PARTIES DU RAPPORT GENERAL
 * ----------------------------------------------------------------------------
 *  Une PARTIE = un bloc de l'application (ventes, commandes, livraisons,
 *  versements clients, achats, dettes, depenses, employes, caisse,
 *  productions...) restreint a la periode choisie.
 *
 *  Chaque partie decrit en un seul endroit :
 *    · ce qui s'affiche a l'ecran (`columns` / `rows`) ;
 *    · ce qui s'imprime (`printColumns` / `printRows`), sur le modele du bon
 *      de livraison — colonne DATE, colonne DESIGNATION, puis les montants ;
 *    · ses statistiques et son total.
 *
 *  Le bouton « Imprimer » de la partie et la liste a cocher du rapport general
 *  partent donc EXACTEMENT des memes lignes : ce qui est lu a l'ecran est ce
 *  qui sort sur le papier.
 * ========================================================================== */

export interface ReportStat {
  label: string;
  value: string;
  tone?: 'neutral' | 'pos' | 'neg' | 'accent';
}

export interface ReportPart {
  key: string;
  /** Famille affichee dans la barre laterale : clients, fournisseurs... */
  group: 'clients' | 'suppliers' | 'company';
  label: string;
  icon: ReactNode;
  /** Explication courte affichee au-dessus du tableau. */
  note?: string;
  columns: { label: string; align?: 'left' | 'right' | 'center' }[];
  rows: ReactNode[][];
  stats: ReportStat[];
  count: number;
  /** Total imprime dans la liste a cocher. */
  total?: string;
  printColumns: DocColumn[];
  printRows: DocRow[];
  printTotalLabel?: string;
  printTotalValue?: string;
}

/**
 * TRI « PAR TIERS PUIS PAR DATE ».
 *
 * L'entreprise veut lire ses listes groupees :
 *
 *      Client1 …
 *      Client1 …
 *      Client2 …
 *      Client2 …
 *
 * et non des lignes eparpillees dans l'ordre chronologique. Toutes les listes
 * qui portent un nom de client ou de fournisseur passent donc par ici.
 */
export function groupByParty<T>(rows: T[], nameOf: (row: T) => string, dateOf: (row: T) => string): T[] {
  return [...rows].sort((a, b) => {
    const byName = nameOf(a).localeCompare(nameOf(b), 'fr', { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return (dateOf(a) || '').localeCompare(dateOf(b) || '');
  });
}

/** Ligne de sous-total inseree quand le tiers change (document imprime). */
export function withPartySubtotals(
  rows: { party: string; cells: (string | number)[]; amount: number }[],
  totalColumns: number
): DocRow[] {
  const out: DocRow[] = [];
  let current = '';
  let running = 0;
  const flush = () => {
    if (current && running > 0) {
      out.push({
        cells: [`SOUS-TOTAL ${current.toUpperCase()}`, fmt(running)],
        span: true,
        variant: 'subtotal',
      });
    }
  };
  rows.forEach((r) => {
    if (r.party !== current) {
      flush();
      current = r.party;
      running = 0;
      out.push({ cells: [current.toUpperCase(), ''], span: true, variant: 'group' });
    }
    running += r.amount;
    out.push({ cells: r.cells });
  });
  flush();
  void totalColumns;
  return out;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(n || 0) + ' DA';
}
