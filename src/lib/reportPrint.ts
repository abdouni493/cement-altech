// ============================================================================
//  COMPTES RENDUS ET RAPPORTS IMPRIMÉS
// ----------------------------------------------------------------------------
//  Même papier à en-tête que le bon de livraison de l'entreprise : coordonnées
//  et identifiants fiscaux à GAUCHE, raison sociale + activité au MILIEU, logo
//  à DROITE, mention « <VILLE> LE jj/mm/aaaa », titre du document souligné,
//  bloc d'identification, puis les sections en tableaux encadrés.
//  L'en-tête et la palette (or / ambre de l'application) sont importés de
//  `officialDoc.ts` : un seul papier à en-tête pour TOUTE l'application.
//
//  L'API publique (ReportDoc / PrintTableSection / PrintRow / PrintKpi) est
//  inchangée : compte rendu client, compte rendu fournisseur, rapport de caisse
//  et rapport général passent tous par `printDetailedReport()`.
// ============================================================================
import type { StoreSettings, Lang } from '@/types';
import { formatDate, formatDateTime } from './utils';
import { BRAND, BRAND_CSS, HEAD_CSS, headerCity, headerHtml } from './officialDoc';
import { openPrintPreview } from './printWindow';

export type CellTone = 'default' | 'pos' | 'neg' | 'muted' | 'accent';
export type RowVariant = 'category' | 'subheader' | 'detail' | 'subtotal' | 'total';

export interface PrintCol {
  label: string;
  align?: 'left' | 'right' | 'center';
}

export interface PrintRow {
  cells: string[];
  variant?: RowVariant;
  /** Tone applied to the LAST cell (usually the amount). */
  tone?: CellTone;
  /** When true, the first cell spans all columns but the last one. */
  span?: boolean;
}

export interface PrintTableSection {
  title: string;
  icon?: string; // emoji
  note?: string;
  headerTotal?: string;
  cols: PrintCol[];
  rows: PrintRow[];
  emptyLabel?: string;
}

export interface PrintKpi {
  label: string;
  value: string;
  tone?: CellTone;
}

export interface PrintMeta {
  label: string;
  value: string;
}

export interface ReportDoc {
  docTitle: string;   // browser tab title
  headTitle: string;  // big printed title, e.g. "COMPTE RENDU CLIENT"
  subtitle: string;   // period / date label
  meta?: PrintMeta[];
  kpis?: PrintKpi[];
  sections: PrintTableSection[];
}

// ------------------------------------------------------------ small helpers
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Tout le document est déjà en gras : seule la nuance « muted » reste utile.
const toneClass: Record<CellTone, string> = {
  default: '', pos: '', neg: '', muted: 'muted', accent: '',
};

// ------------------------------------------------------------------- styles
const css = `
  ${BRAND_CSS}
  ${HEAD_CSS}

  .toolbar { max-width: 920px; }
  .page {
    max-width: 920px; margin: 0 auto; background: #fff;
    border: 2px solid ${BRAND.goldDark}; border-radius: 4px; padding: 14px 16px 18px;
  }

  .doc-sub { text-align: center; font-size: 14px; font-weight: 700; text-transform: uppercase; color: ${BRAND.inkSoft}; margin: -6px 0 14px; }

  /* Identification */
  .meta { width: 100%; border-collapse: collapse; margin-bottom: 13px; }
  .meta td { border: 1.2px solid ${BRAND.grid}; padding: 7px 9px; font-size: 13.5px; font-weight: 700; }
  .meta td.k { text-transform: uppercase; width: 28%; background: ${BRAND.tint}; font-weight: 800; font-size: 12.5px; letter-spacing: .3px; }

  /* Chiffres clés */
  .kpis { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
  .kpis td { border: 1.2px solid ${BRAND.grid}; padding: 8px 10px; width: 25%; vertical-align: top; background: ${BRAND.wash}; }
  .kpis .l { font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; color: ${BRAND.goldDark}; }
  .kpis .v { font-size: 16.5px; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 3px; }

  /* Sections */
  .section { margin-bottom: 17px; break-inside: avoid; }
  .sec-title { display: flex; justify-content: space-between; gap: 10px; font-size: 15px; font-weight: 800; text-transform: uppercase; color: ${BRAND.goldDark}; border-left: 4px solid ${BRAND.gold}; padding-left: 8px; margin: 0 0 6px 2px; }
  .sec-note { font-size: 12.5px; font-weight: 700; font-style: italic; color: ${BRAND.inkSoft}; margin: 0 0 6px 10px; }

  table.data { width: 100%; border-collapse: collapse; }
  table.data th, table.data td { border: 1.2px solid ${BRAND.grid}; padding: 7px 8px; font-size: 13.5px; font-weight: 700; vertical-align: top; }
  table.data th { text-transform: uppercase; text-align: left; letter-spacing: .4px; background: ${BRAND.tint}; font-size: 12.5px; font-weight: 800; }
  table.data thead { display: table-header-group; }
  table.data tr { break-inside: avoid; }
  .al-right, th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .al-center { text-align: center; }

  tr.r-category td { background: ${BRAND.tint}; text-transform: uppercase; font-weight: 800; }
  tr.r-subheader td { background: ${BRAND.wash}; }
  tr.r-detail td.first { padding-left: 20px; }
  tr.r-subtotal td { background: ${BRAND.wash}; }
  tr.r-total td { background: ${BRAND.strong}; font-size: 15px; font-weight: 800; }

  .muted { color: ${BRAND.inkSoft}; }

  .empty { border: 1.2px solid ${BRAND.grid}; padding: 12px; text-align: center; font-style: italic; font-size: 13.5px; font-weight: 700; color: ${BRAND.inkSoft}; }

  .foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 22px; break-inside: avoid; }
  .foot .printed { font-size: 12.5px; font-weight: 700; font-style: italic; color: ${BRAND.inkSoft}; }
  .foot .sign { display: inline-block; text-align: center; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: ${BRAND.goldDark}; border-top: 2px solid ${BRAND.gold}; padding-top: 5px; margin-top: 34px; min-width: 150px; }

  .tag { margin-top: 16px; padding-top: 8px; border-top: 1.5px solid ${BRAND.gold}; text-align: center; font-size: 12px; font-style: italic; font-weight: 700; color: ${BRAND.inkSoft}; }

  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none !important; }
    .page { border: none; max-width: none; padding: 0; }
    @page { size: A4; margin: 9mm; }
  }
`;

// ---------------------------------------------------------------- rendering
function renderTable(sec: PrintTableSection): string {
  const nCols = sec.cols.length;
  const headCells = sec.cols
    .map((c) => `<th class="${c.align === 'right' ? 'num' : c.align === 'center' ? 'al-center' : ''}">${esc(c.label)}</th>`)
    .join('');

  const body = sec.rows
    .map((r) => {
      const cls = r.variant ? `r-${r.variant}` : '';
      if (r.span && r.cells.length >= 2) {
        const last = r.cells[r.cells.length - 1];
        const firstAlign = sec.cols[0]?.align;
        return `<tr class="${cls}"><td colspan="${nCols - 1}" class="${firstAlign === 'right' ? 'num' : firstAlign === 'center' ? 'al-center' : ''}">${esc(r.cells[0])}</td><td class="num ${toneClass[r.tone || 'default']}">${esc(last)}</td></tr>`;
      }
      const tds = r.cells
        .map((cell, i) => {
          const align = sec.cols[i]?.align;
          const isLast = i === r.cells.length - 1;
          const first = i === 0 && r.variant === 'detail' ? 'first' : '';
          const alignCls = align === 'right' ? 'num' : align === 'center' ? 'al-center' : '';
          const toneCls = isLast && r.tone ? toneClass[r.tone] : '';
          return `<td class="${alignCls} ${first} ${toneCls}">${esc(cell)}</td>`;
        })
        .join('');
      return `<tr class="${cls}">${tds}</tr>`;
    })
    .join('');

  const table =
    sec.rows.length === 0
      ? `<div class="empty">${esc(sec.emptyLabel || '—')}</div>`
      : `<table class="data"><thead><tr>${headCells}</tr></thead><tbody>${body}</tbody></table>`;

  return `
    <div class="section">
      <div class="sec-title"><span>${esc(sec.title)}</span>${sec.headerTotal ? `<span>${esc(sec.headerTotal)}</span>` : ''}</div>
      ${sec.note ? `<div class="sec-note">${esc(sec.note)}</div>` : ''}
      ${table}
    </div>`;
}

export function printDetailedReport(doc: ReportDoc, store: StoreSettings, lang: Lang = 'fr') {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const printedOn = lang === 'ar' ? 'طُبع في' : 'Imprimé le';
  const printBtn = lang === 'ar' ? 'طباعة' : 'Imprimer';
  const closeBtn = lang === 'ar' ? 'إغلاق' : 'Fermer';

  const city = headerCity(store);

  const metaHtml = doc.meta && doc.meta.length
    ? `<table class="meta">${doc.meta
        .map((m) => `<tr><td class="k">${esc(m.label)}</td><td>${esc(m.value)}</td></tr>`)
        .join('')}</table>`
    : '';

  const kpiCells = (doc.kpis ?? []).map(
    (k) => `<td><div class="l">${esc(k.label)}</div><div class="v ${k.tone || ''}">${esc(k.value)}</div></td>`
  );
  const kpiRows: string[] = [];
  for (let i = 0; i < kpiCells.length; i += 4) {
    const slice = kpiCells.slice(i, i + 4);
    while (slice.length < 4) slice.push('<td></td>');
    kpiRows.push(`<tr>${slice.join('')}</tr>`);
  }
  const kpisHtml = kpiRows.length ? `<table class="kpis">${kpiRows.join('')}</table>` : '';

  const sectionsHtml = doc.sections.map(renderTable).join('');

  openPrintPreview(`<!doctype html>
<html lang="${lang}" dir="${dir}">
  <head><meta charset="utf-8"/><title>${esc(doc.docTitle)}</title><style>${css}</style></head>
  <body>
    <div class="toolbar">
      <button onclick="window.print()">${printBtn}</button>
      <button class="ghost" onclick="window.close()">${closeBtn}</button>
    </div>
    <div class="page">
      ${headerHtml(store)}
      <div class="city">${city ? `${esc(city)} LE ` : 'LE '}${esc(formatDate(new Date(), lang))}</div>

      <div class="doc-title"><span>${esc(doc.headTitle)}</span></div>
      <div class="doc-sub">${esc(doc.subtitle)}</div>

      ${metaHtml}
      ${kpisHtml}
      ${sectionsHtml}

      <div class="foot">
        <div class="printed">${printedOn} : ${esc(formatDateTime(new Date(), lang))}</div>
        <div class="sign">Signature</div>
      </div>
      ${store.socialMedia ? `<div class="tag">${esc(store.socialMedia)}</div>` : ''}
    </div>
    <script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>
  </body>
</html>`, doc.docTitle);
}
