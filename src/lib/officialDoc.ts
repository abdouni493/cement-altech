import type { StoreSettings } from '@/types';
import { formatCurrency, formatDate } from './utils';
import { openPrintPreview } from './printWindow';

/* ============================================================================
 *  MODÈLE OFFICIEL DES DOCUMENTS IMPRIMÉS
 * ----------------------------------------------------------------------------
 *  Reprise fidèle du modèle papier de l'entreprise, habillée aux couleurs de
 *  l'application (or / ambre sur encre ardoise) et portant son logo.
 *
 *      ┌──────────────────────────────────────────────────────────┐
 *      │ ADRESSE : …                                     ┌──────┐ │
 *      │ TEL : …            SARL ACTCE LOKMANE           │ LOGO │ │
 *      │ R.C : … NIF : …   FABRICATION DE BETON          └──────┘ │
 *      │ NIS : … ART : …      PRET A L'EMPLOI                     │
 *      └──────────────────────────────────────────────────────────┘
 *                                                BLIDA LE 05/04/2026
 *                        BON DE LIVRAISON            (souligné)
 *
 *      DOIT : HARAZI OULED AICHE                    N° BL : BL-0012
 *      ┌─────────────┬──────────────┬──────────┬──────────┬────────┐
 *      │ DESIGNATION │ ADRESSE DE   │ QUANTITE │  PRIX U  │ P.T HT │
 *      │             │  LIVRAISON   │          │          │        │
 *      ├─────────────┼──────────────┼──────────┼──────────┼────────┤
 *      │ BETON       │ OULED AICHE  │   74,5   │ 8 700,00 │ 648150 │
 *      └─────────────┴──────────────┴──────────┼──────────┼────────┤
 *                                              │ TOTAL HT │   …    │
 *                                              │VERSEMENT │   …    │
 *                                              │ LE REST  │   …    │
 *                                              └──────────┴────────┘
 *      CLIENT                                            SIGNATURE
 *
 *  TOUS les documents de l'application (bon de livraison, bon de commande,
 *  facture de vente, facture d'achat, reçu de versement, fiche de production…)
 *  sont rendus par ce même moteur : seuls le titre, les colonnes et le bloc de
 *  totaux changent.
 *
 *  Le bloc de totaux est « accroché » aux DEUX dernières colonnes du tableau,
 *  exactement comme sur le modèle : la partie gauche du tableau s'arrête et les
 *  totaux se poursuivent seuls, à droite.
 * ========================================================================== */

export type Align = 'left' | 'center' | 'right';

export interface DocColumn {
  label: string;
  align?: Align;
  /** Largeur CSS optionnelle (ex : '9%'). */
  width?: string;
}

export interface DocRow {
  cells: (string | number)[];
  /** Ligne de sous-total / regroupement — fond ambré et texte gras. */
  variant?: 'normal' | 'group' | 'subtotal';
  /** La première cellule occupe toutes les colonnes sauf la dernière. */
  span?: boolean;
}

export interface DocTotal {
  label: string;
  value: string;
  /** Ligne mise en évidence (TOTAL T.T.C, LE REST…). */
  strong?: boolean;
}

export interface DocTable {
  /** Titre de section, imprimé au-dessus du tableau (facultatif). */
  title?: string;
  columns: DocColumn[];
  rows: DocRow[];
  /** Bloc de totaux accroché au pied du tableau, sur ses 2 dernières colonnes. */
  totals?: DocTotal[];
  /**
   * Nombre de colonnes occupées par le LIBELLÉ d'un total (défaut : 1, ou 2
   * au-delà de six colonnes). Les comptes rendus l'élargissent pour que
   * « ANCIENNE DETTE DU 01/01/2026 — … » tienne sur une ligne.
   */
  totalsLabelSpan?: number;
  emptyLabel?: string;
  note?: string;
}

export interface DocData {
  /** Titre souligné : BON DE LIVRAISON, BON DE COMMANDE… */
  title: string;
  /** Date portée par la mention « <VILLE> LE jj/mm/aaaa ». */
  docDate: string;
  /** Libellé du destinataire : DOIT, FOURNISSEUR, EMPLOYÉ… */
  doitLabel?: string;
  doitName?: string;
  /** Identifiants du destinataire (adresse, R.C, NIF, NIS, article, tél). */
  doitLines?: string[];
  /** Références du document (N° BL, commande liée, chauffeur…) — à DROITE du DOIT. */
  metaLines?: string[];
  /** Mentions encadrées (LIVRAISON PARTIELLE, ANCIENNE COMMANDE…). */
  stamps?: { label: string; tone?: 'ok' | 'warn' }[];
  tables: DocTable[];
  /** Montant en toutes lettres — encadré sous les tableaux. */
  amountInWords?: string;
  /** Lignes libres en bas à gauche : « VERSEMENT DE … DA LE … ». */
  footNotes?: string[];
  /** Observations encadrées. */
  observations?: string;
  /**
   * Cartouches de signature. Deux entrées ⇒ la 1re à GAUCHE (« LE CLIENT ») et
   * la 2de à DROITE (« SIGNATURE »), comme sur le modèle papier.
   */
  signatures?: string[];
  /** Nom du fichier / onglet d'impression. */
  fileName: string;
}

/* ------------------------------------------------------------------ helpers */

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)
  );
}

/** « VERSEMENT DE 600 000,00 DA LE 09/06/2026 » — ligne de pied de document. */
export function versementLine(amount: number, date: string): string {
  return `VERSEMENT DE ${formatCurrency(amount)} LE ${formatDate(date)}`;
}

/* ---------------------------------------------------------------- feuille */

/**
 * Palette reprise de l'application (thème clair) : or / ambre sur ardoise.
 * Elle est partagée avec `reportPrint.ts` et `barcodeUtils.ts` pour que TOUS
 * les documents imprimés portent la même identité visuelle.
 */
export const BRAND = {
  ink: '#0f172a',
  inkSoft: '#334155',
  gold: '#d97706',
  goldDark: '#b45309',
  goldLight: '#fbbf24',
  wash: '#fffbeb',
  tint: '#fef3c7',
  strong: '#fde68a',
  grid: '#1e293b',
};

/** Base commune (corps, barre d'outils) partagée par tous les documents. */
export const BRAND_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: 'Segoe UI', Inter, system-ui, 'Helvetica Neue', Arial, sans-serif;
    color: ${BRAND.ink}; background: #eef2f6; padding: 18px;
    font-size: 14px; font-weight: 600; line-height: 1.42;
  }
  .toolbar { max-width: 880px; margin: 0 auto 14px; display: flex; justify-content: flex-end; gap: 9px; }
  .toolbar button {
    font: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
    border: 1.5px solid ${BRAND.goldDark}; border-radius: 8px; padding: 9px 24px;
    background: linear-gradient(135deg, ${BRAND.goldLight} 0%, ${BRAND.gold} 55%, ${BRAND.goldDark} 100%);
    color: #fff; letter-spacing: .3px;
  }
  .toolbar button.ghost { background: #fff; color: ${BRAND.goldDark}; }
`;

/** En-tête officiel — identique sur les documents et sur les comptes rendus. */
export const HEAD_CSS = `
  .head {
    border: 1.6px solid ${BRAND.grid}; border-top: 5px solid ${BRAND.gold};
    background: ${BRAND.wash}; padding: 11px 13px;
  }
  .head .row { display: flex; align-items: center; gap: 12px; }
  .head .info {
    flex: 0 0 28%; max-width: 28%; text-align: left;
    font-size: 11.5px; font-weight: 700; line-height: 1.55;
    color: ${BRAND.inkSoft}; text-transform: uppercase; overflow-wrap: anywhere;
  }
  .head .center { flex: 1 1 auto; min-width: 0; text-align: center; }
  .head .logo-box { flex: 0 0 28%; max-width: 28%; text-align: right; }
  .head .logo { width: 108px; height: 108px; object-fit: contain; display: inline-block; }
  .head .brand {
    font-size: 27px; font-weight: 800; letter-spacing: .6px; line-height: 1.15;
    text-transform: uppercase; color: ${BRAND.goldDark};
  }
  .head .rule { width: 62%; margin: 7px auto 0; border-top: 2.5px solid ${BRAND.gold}; }
  .head .activity {
    font-size: 15.5px; font-weight: 700; letter-spacing: .3px; margin-top: 6px;
    line-height: 1.25; text-transform: uppercase; color: ${BRAND.ink};
  }
  .city { text-align: right; font-size: 14px; font-weight: 700; font-style: italic; text-transform: uppercase; margin: 8px 2px 0; }
  .doc-title {
    text-align: center; font-size: 22px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 2px; margin: 12px 0 14px; color: ${BRAND.goldDark};
  }
  .doc-title span { border-bottom: 3px solid ${BRAND.gold}; padding: 0 14px 5px; }
`;

const CSS = `
  ${BRAND_CSS}
  ${HEAD_CSS}

  .sheet {
    max-width: 880px; margin: 0 auto; background: #fff;
    border: 2px solid ${BRAND.goldDark}; border-radius: 4px;
    padding: 14px 16px 18px;
  }

  /* ---- Bandeau DOIT (à gauche) / références du document (à droite) ---- */
  .party { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin: 0 2px 9px; }
  .party .doit { font-size: 16px; font-weight: 800; text-transform: uppercase; }
  .party .doit .lbl { color: ${BRAND.goldDark}; border-bottom: 2px solid ${BRAND.gold}; padding-bottom: 1px; }
  .party .doit .sub { display: block; font-size: 12.5px; font-weight: 700; color: ${BRAND.inkSoft}; margin-top: 4px; line-height: 1.6; }
  .party .meta { text-align: right; font-size: 13.5px; font-weight: 700; text-transform: uppercase; line-height: 1.65; white-space: nowrap; }

  /* ---- Tableaux ---- */
  .sec-title { font-size: 15px; font-weight: 800; text-transform: uppercase; color: ${BRAND.goldDark}; border-left: 4px solid ${BRAND.gold}; padding-left: 8px; margin: 16px 0 6px 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1.2px solid ${BRAND.grid}; padding: 7px 8px; font-size: 13.5px; font-weight: 600; vertical-align: middle; }
  th {
    text-transform: uppercase; text-align: center; letter-spacing: .4px;
    background: ${BRAND.tint}; color: ${BRAND.ink}; font-size: 12.5px; font-weight: 800;
  }
  td.l, th.l { text-align: left; }
  td.c, th.c { text-align: center; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  tbody td { font-weight: 700; }
  tr.group td { text-transform: uppercase; background: ${BRAND.tint}; font-weight: 800; }
  tr.subtotal td { background: ${BRAND.wash}; }
  tr { break-inside: avoid; }
  .empty { text-align: center; font-style: italic; font-weight: 700; padding: 12px; font-size: 13.5px; color: ${BRAND.inkSoft}; }

  /* ---- Totaux accrochés aux DEUX dernières colonnes ---- */
  td.tot-void { border: none; background: transparent; }
  td.tot-label { text-align: right; font-weight: 800; text-transform: uppercase; letter-spacing: .4px; background: ${BRAND.wash}; font-size: 13px; }
  td.tot-value { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; font-size: 13.5px; white-space: nowrap; }
  tr.grand td.tot-label, tr.grand td.tot-value { background: ${BRAND.strong}; font-size: 15px; }

  /* ---- Montant en lettres · observations ---- */
  .words, .obs { border: 1.2px solid ${BRAND.grid}; border-left: 4px solid ${BRAND.gold}; background: ${BRAND.wash}; padding: 9px 11px; font-size: 13.5px; font-weight: 700; margin: 11px 0; }
  .words b, .obs b { display: block; text-transform: uppercase; font-size: 11.5px; font-weight: 800; letter-spacing: .6px; color: ${BRAND.goldDark}; margin-bottom: 2px; }
  .words i { font-style: italic; font-weight: 700; }

  .stamps { margin: 11px 0 2px; }
  .stamp { display: inline-block; border: 1.5px solid ${BRAND.goldDark}; border-radius: 4px; padding: 3px 13px; font-size: 12.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; margin: 0 8px 6px 0; color: ${BRAND.goldDark}; }
  .stamp.warn { background: ${BRAND.tint}; }

  /* ---- Pied : « LE CLIENT » à gauche, « SIGNATURE » à droite ---- */
  .foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 22px; margin-top: 24px; break-inside: avoid; }
  .foot .col { min-width: 165px; }
  .foot .col.right { text-align: right; }
  .foot .notes { font-size: 13px; font-weight: 700; text-transform: uppercase; line-height: 1.8; margin-bottom: 14px; }
  .foot .sign { display: inline-block; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: ${BRAND.goldDark}; border-top: 2px solid ${BRAND.gold}; padding-top: 5px; margin-top: 34px; min-width: 150px; text-align: center; }

  .tag { margin-top: 16px; padding-top: 8px; border-top: 1.5px solid ${BRAND.gold}; text-align: center; font-size: 12px; font-style: italic; font-weight: 700; color: ${BRAND.inkSoft}; }

  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none !important; }
    .sheet { border: none; max-width: none; padding: 0; }
    @page { size: A4 portrait; margin: 9mm; }
  }
`;

/** Coordonnées et identifiants fiscaux — colonne de GAUCHE de l'en-tête. */
export function headerInfoLines(store: StoreSettings): string[] {
  return [
    store.activityPlace ? `LIEU D'ACTIVITE : ${store.activityPlace}` : '',
    store.address ? `SIEGE SOCIAL : ${store.address}` : '',
    store.phone ? `TEL : ${store.phone}` : '',
    store.email ? `EMAIL : ${store.email}` : '',
    store.rc ? `R.C : ${store.rc}` : '',
    store.nif ? `NIF : ${store.nif}` : '',
    store.nis ? `NIS : ${store.nis}` : '',
    store.article ? `ART : ${store.article}` : '',
  ].filter(Boolean);
}

/** Ville de la mention « <VILLE> LE … » — réglage, sinon fin de l'adresse. */
export function headerCity(store: StoreSettings): string {
  if (store.city && store.city.trim()) return store.city.trim().toUpperCase();
  const parts = (store.address || '').split(/[,\-–]/).map((p) => p.trim()).filter(Boolean);
  return (parts[parts.length - 1] || '').toUpperCase();
}

/** Bloc d'en-tête complet : infos à gauche, raison sociale au centre, logo à droite. */
export function headerHtml(store: StoreSettings): string {
  return `
    <div class="head">
      <div class="row">
        <div class="info">${headerInfoLines(store).map(esc).join('<br/>')}</div>
        <div class="center">
          <div class="brand">${esc(store.name || 'ALTECH PRODUCTION')}</div>
          <div class="rule"></div>
          ${store.description ? `<div class="activity">${esc(store.description)}</div>` : ''}
        </div>
        <div class="logo-box">
          ${store.logo ? `<img class="logo" src="${store.logo}" alt=""/>` : ''}
        </div>
      </div>
    </div>`;
}

function alignClass(a?: Align): string {
  return a === 'right' ? 'r' : a === 'center' ? 'c' : 'l';
}

function tableHtml(t: DocTable): string {
  const cols = t.columns;
  const head = `<tr>${cols
    .map((c) => `<th class="${alignClass(c.align)}"${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.label)}</th>`)
    .join('')}</tr>`;

  const body = t.rows.length
    ? t.rows
        .map((r) => {
          const cls = r.variant && r.variant !== 'normal' ? ` class="${r.variant}"` : '';
          if (r.span) {
            const last = r.cells[r.cells.length - 1];
            return `<tr${cls}><td class="l" colspan="${cols.length - 1}">${r.cells[0]}</td><td class="${alignClass(
              cols[cols.length - 1].align
            )}">${last}</td></tr>`;
          }
          return `<tr${cls}>${r.cells
            .map((cell, i) => `<td class="${alignClass(cols[i]?.align)}">${cell}</td>`)
            .join('')}</tr>`;
        })
        .join('')
    : `<tr><td class="empty" colspan="${cols.length}">${esc(t.emptyLabel || 'Aucune ligne')}</td></tr>`;

  /* Les totaux ne tiennent que sur les DEUX dernières colonnes : la partie
     gauche du tableau s'arrête, comme sur le modèle papier. Au-delà de six
     colonnes, le libellé prend deux colonnes pour ne pas se couper en deux. */
  const labelSpan = Math.max(1, Math.min(cols.length - 1, t.totalsLabelSpan ?? (cols.length >= 6 ? 2 : 1)));
  const voidSpan = Math.max(0, cols.length - 1 - labelSpan);
  const voidCell = voidSpan > 0 ? `<td class="tot-void" colspan="${voidSpan}"></td>` : '';
  const totals = (t.totals ?? [])
    .map(
      (x) => `<tr class="tot${x.strong ? ' grand' : ''}">
        ${voidCell}
        <td class="tot-label" colspan="${labelSpan}">${esc(x.label)}</td>
        <td class="tot-value">${x.value}</td>
      </tr>`
    )
    .join('');

  /* Les totaux sont rendus comme DERNIÈRES lignes du corps du tableau, et non
     dans un <tfoot> : un <tfoot> est répété par le navigateur au bas de CHAQUE
     page quand le tableau déborde sur plusieurs feuilles, ce qui affichait le
     bloc de totaux sur toutes les pages. En corps de tableau, il n'apparaît
     qu'une seule fois, à la fin réelle du tableau (sur la dernière page). */
  return `
    ${t.title ? `<div class="sec-title">${esc(t.title)}</div>` : ''}
    <table>
      <thead>${head}</thead>
      <tbody>${body}${totals}</tbody>
    </table>
    ${t.note ? `<div class="obs">${esc(t.note)}</div>` : ''}`;
}

/**
 * Rend et ouvre un document officiel dans une fenêtre d'impression.
 * Tous les modèles de l'application passent par ici : l'entreprise a un seul
 * papier à en-tête, quel que soit le document.
 */
export function printOfficialDocument(data: DocData, store: StoreSettings) {
  const signs = data.signatures?.length ? data.signatures : ['Signature'];
  // Modèle papier : le premier cartouche à GAUCHE, le dernier à DROITE.
  const leftSign = signs.length > 1 ? signs[0] : '';
  const rightSign = signs[signs.length - 1];
  const city = headerCity(store);

  openPrintPreview(`<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8"/><title>${esc(data.fileName)}</title><style>${CSS}</style></head>
  <body>
    <div class="toolbar">
      <button onclick="window.print()">Imprimer</button>
      <button class="ghost" onclick="window.close()">Fermer</button>
    </div>
    <div class="sheet">
      ${headerHtml(store)}
      <div class="city">${city ? `${esc(city)} LE ` : 'LE '}${esc(formatDate(data.docDate))}</div>
      <div class="doc-title"><span>${esc(data.title)}</span></div>
      <div class="party">
        <div class="doit">${
          data.doitName
            ? `<span class="lbl">${esc(data.doitLabel || 'DOIT')} :</span> ${esc(data.doitName)}
               ${data.doitLines?.length ? `<span class="sub">${data.doitLines.map(esc).join('<br/>')}</span>` : ''}`
            : ''
        }</div>
        <div class="meta">${(data.metaLines ?? []).map(esc).join('<br/>')}</div>
      </div>
      ${data.tables.map(tableHtml).join('')}
      ${
        data.amountInWords
          ? `<div class="words"><b>Arrêtée la présente à la somme de :</b><i>${esc(data.amountInWords)}</i></div>`
          : ''
      }
      ${data.observations ? `<div class="obs"><b>Observations</b>${esc(data.observations)}</div>` : ''}
      ${
        data.stamps?.length
          ? `<div class="stamps">${data.stamps
              .map((s) => `<span class="stamp${s.tone === 'warn' ? ' warn' : ''}">${esc(s.label)}</span>`)
              .join('')}</div>`
          : ''
      }
      <div class="foot">
        <div class="col">
          <div class="notes">${(data.footNotes ?? []).map(esc).join('<br/>')}</div>
          ${leftSign ? `<div class="sign">${esc(leftSign)}</div>` : ''}
        </div>
        <div class="col right"><div class="sign">${esc(rightSign)}</div></div>
      </div>
      ${store.socialMedia ? `<div class="tag">${esc(store.socialMedia)}</div>` : ''}
    </div>
    <script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script>
  </body>
</html>`, data.fileName);
}
