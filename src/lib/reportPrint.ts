// ============================================================
// Detailed, table-based report printing.
// Produces a clean, well-organised printable document (its own
// window) for both the Caisse reports and the global Reports page.
// Everything is rendered as detailed tables — no app-style cards.
// ============================================================
import type { StoreSettings, Lang } from '@/types';
import { formatDateTime } from './utils';

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
  headTitle: string;  // big printed title, e.g. "RAPPORT DE CAISSE"
  subtitle: string;   // period / date label
  meta?: PrintMeta[];
  kpis?: PrintKpi[];
  sections: PrintTableSection[];
}

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const toneClass: Record<CellTone, string> = {
  default: '',
  pos: 'pos',
  neg: 'neg',
  muted: 'muted',
  accent: 'accent',
};

function logoHtml(store: StoreSettings): string {
  if (store.logo) {
    return `<div class="logo-box"><img src="${store.logo}" alt="logo"/></div>`;
  }
  return `<div class="logo-box"><span class="logo-fallback">🧪</span></div>`;
}

// ------------------------------------------------------------
// Stylesheet — professional, print-friendly, theme accent
// ------------------------------------------------------------
const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Inter','Segoe UI',Arial,sans-serif; color: #000; background: #F0F6F8; padding: 18px; font-size: 14px; font-weight: 600; line-height: 1.45; }
  .page { max-width: 920px; margin: 0 auto; background: #fff; border: 2.5px solid #000; border-radius: 12px; overflow: hidden; }

  /* Toolbar (écran uniquement) */
  .toolbar { max-width: 920px; margin: 0 auto 14px; display: flex; justify-content: flex-end; gap: 10px; }
  .toolbar button { font: inherit; font-weight: 800; cursor: pointer; border: none; border-radius: 10px; padding: 10px 20px; color: #fff; background: #0F766E; }
  .toolbar button.ghost { background: #fff; color: #0F766E; border: 2px solid #0F766E; }

  /* Header — logo agrandi, coordonnées en gras noir */
  .header { display: flex; align-items: center; gap: 18px; padding: 20px 24px; background: #E6F5F2; border-bottom: 3px solid #000; }
  .logo-box { width: 110px; height: 110px; border-radius: 12px; border: 3px solid #000; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; padding: 3px; }
  .logo-box img { width:100%; height:100%; object-fit:contain; }
  .logo-fallback { font-size: 52px; }
  .store-info { flex:1; min-width:0; }
  .store-name { font-size: 28px; font-weight: 900; color: #000; letter-spacing:-.4px; text-transform: uppercase; }
  .store-tag { font-size: 13px; font-weight: 700; color:#222; font-style: italic; margin-top:2px; }
  .store-meta { font-size: 13.5px; font-weight: 700; color: #000; margin-top: 8px; line-height: 1.75; }
  .store-meta span { display:inline-block; margin-right:14px; }
  .fiscal { text-align: right; font-size: 13px; font-weight: 700; color:#000; line-height:1.85; flex-shrink:0; }
  .fiscal b { color:#000; font-weight: 900; }

  /* Title bar */
  .title-bar { display:flex; justify-content:space-between; align-items:center; padding: 13px 24px; background:#000; color:#fff; }
  .title-bar .t { font-size: 21px; font-weight: 900; letter-spacing: 1.6px; text-transform: uppercase; }
  .title-bar .s { text-align:right; font-size:13.5px; font-weight:700; line-height:1.7; }
  .title-bar .s b { font-size:15px; font-weight:900; }

  .content { padding: 20px 24px 26px; }

  /* Meta chips */
  .meta { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }
  .meta .chip { background:#F4F4F4; border:2px solid #000; border-radius:8px; padding:7px 13px; font-size:13px; }
  .meta .chip b { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:#000; font-weight:900; }
  .meta .chip span { font-weight:900; color:#000; font-size:14px; }

  /* KPI summary strip */
  .kpis { display:grid; grid-template-columns: repeat(4, 1fr); gap:9px; margin-bottom:20px; }
  .kpi { border:2px solid #000; border-radius:9px; padding:10px 13px; background:#FAFAFA; }
  .kpi .l { font-size:11.5px; text-transform:uppercase; letter-spacing:.6px; color:#000; font-weight:800; margin-bottom:4px; }
  .kpi .v { font-size:18px; font-weight:900; color:#000; letter-spacing:-.2px; font-variant-numeric:tabular-nums; }
  .kpi .v.pos { color:#0A5A38; } .kpi .v.neg { color:#8F0F22; } .kpi .v.accent { color:#000; } .kpi .v.muted { color:#333; }

  /* Sections */
  .section { margin-bottom: 20px; break-inside: avoid; }
  .section > h2 { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:15px; font-weight:900; color:#000; padding:9px 14px; background:#E6F5F2; border:2px solid #000; border-left:7px solid #000; border-radius:8px; margin-bottom:9px; text-transform:uppercase; letter-spacing:.5px; }
  .section > h2 .htotal { font-size:15px; color:#000; font-weight:900; font-variant-numeric:tabular-nums; }
  .section .note { font-size:12.5px; color:#222; font-weight:700; margin:-4px 0 9px 2px; font-style:italic; }

  /* Tables */
  table { width:100%; border-collapse:collapse; font-size:13.5px; color:#000; }
  thead { display: table-header-group; }
  th { background:#000; color:#fff; padding:9px 11px; text-align:left; font-weight:900; font-size:12.5px; text-transform:uppercase; letter-spacing:.4px; white-space:nowrap; border:1.5px solid #000; }
  td { padding:8px 11px; border:1.5px solid #444; vertical-align:top; font-weight:700; color:#000; }
  tr { break-inside: avoid; }
  tbody tr:nth-child(even) td { background:#F4F4F4; }
  .al-right { text-align:right; } .al-center { text-align:center; }
  td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; font-weight:800; }

  /* Row variants */
  tr.r-category td { background:#CFEAE6 !important; font-weight:900; color:#000; }
  tr.r-subheader td { background:#DDE7EA !important; font-weight:900; color:#000; }
  tr.r-detail td.first { padding-left:24px; color:#000; }
  tr.r-subtotal td { background:#EAF6F4 !important; font-weight:900; border-top:2px solid #000; }
  tr.r-total td { background:#000 !important; color:#fff; font-weight:900; font-size:14px; }
  tr.r-total td .pos, tr.r-total td .neg, tr.r-total td .accent, tr.r-total td .muted { color:#fff !important; }

  /* Tones on cell content */
  .pos { color:#0A5A38; font-weight:900; } .neg { color:#8F0F22; font-weight:900; }
  .muted { color:#333; font-weight:700; } .accent { color:#000; font-weight:900; }

  .empty { padding:15px; text-align:center; color:#222; font-weight:700; font-style:italic; border:2px dashed #000; border-radius:8px; background:#FAFAFA; }

  /* Footer */
  .doc-footer { margin-top:8px; padding:14px 24px; border-top:2px dashed #000; text-align:center; font-size:12.5px; font-weight:700; color:#222; }
  .doc-footer .social { color:#000; font-weight:900; }

  @media print {
    body { background:#fff; padding:0; font-size:12.5px; }
    .toolbar { display:none !important; }
    .page { border:none; border-radius:0; max-width:none; }
    @page { size: A4; margin: 9mm; }
  }
`;

// ------------------------------------------------------------
// Rendering
// ------------------------------------------------------------
function renderTable(sec: PrintTableSection): string {
  const nCols = sec.cols.length;
  const headCells = sec.cols
    .map((c) => `<th class="${c.align === 'right' ? 'num' : c.align === 'center' ? 'al-center' : ''}">${esc(c.label)}</th>`)
    .join('');

  const body = sec.rows
    .map((r) => {
      const cls = r.variant ? `r-${r.variant}` : '';
      if (r.span && r.cells.length >= 2) {
        // First cell spans everything but the last (used for category headers)
        const last = r.cells[r.cells.length - 1];
        const firstAlign = sec.cols[0]?.align;
        return `<tr class="${cls}"><td colspan="${nCols - 1}" class="${firstAlign === 'right' ? 'num' : firstAlign === 'center' ? 'al-center' : ''}">${esc(r.cells[0])}</td><td class="num ${toneClass[r.tone || 'default']}">${esc(last)}</td></tr>`;
      }
      const tds = r.cells
        .map((cell, i) => {
          const col = sec.cols[i];
          const align = col?.align;
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
      : `<table><thead><tr>${headCells}</tr></thead><tbody>${body}</tbody></table>`;

  return `
    <div class="section">
      <h2><span>${sec.icon ? sec.icon + ' ' : ''}${esc(sec.title)}</span>${sec.headerTotal ? `<span class="htotal">${esc(sec.headerTotal)}</span>` : ''}</h2>
      ${sec.note ? `<div class="note">${esc(sec.note)}</div>` : ''}
      ${table}
    </div>`;
}

export function printDetailedReport(doc: ReportDoc, store: StoreSettings, lang: Lang = 'fr') {
  const win = window.open('', '_blank', 'width=980,height=1040');
  if (!win) return;

  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const printedOn = lang === 'ar' ? 'طُبع في' : 'Imprimé le';
  const printBtn = lang === 'ar' ? '🖨️ طباعة' : '🖨️ Imprimer';
  const closeBtn = lang === 'ar' ? 'إغلاق' : 'Fermer';
  const footerNote =
    lang === 'ar'
      ? 'وثيقة تم إنشاؤها تلقائياً بواسطة نظام الإدارة'
      : 'Document généré automatiquement par le système de gestion';

  const fiscal = [
    store.rc ? `<div><b>RC:</b> ${esc(store.rc)}</div>` : '',
    store.nif ? `<div><b>NIF:</b> ${esc(store.nif)}</div>` : '',
    store.nis ? `<div><b>NIS:</b> ${esc(store.nis)}</div>` : '',
    store.article ? `<div><b>Art:</b> ${esc(store.article)}</div>` : '',
  ].join('');

  const metaHtml = doc.meta && doc.meta.length
    ? `<div class="meta">${doc.meta
        .map((m) => `<div class="chip"><b>${esc(m.label)}</b><span>${esc(m.value)}</span></div>`)
        .join('')}</div>`
    : '';

  const kpisHtml = doc.kpis && doc.kpis.length
    ? `<div class="kpis">${doc.kpis
        .map((k) => `<div class="kpi"><div class="l">${esc(k.label)}</div><div class="v ${k.tone || ''}">${esc(k.value)}</div></div>`)
        .join('')}</div>`
    : '';

  const sectionsHtml = doc.sections.map(renderTable).join('');

  win.document.write(`
    <!doctype html>
    <html lang="${lang}" dir="${dir}">
      <head>
        <meta charset="utf-8" />
        <title>${esc(doc.docTitle)}</title>
        <style>${css}</style>
      </head>
      <body>
        <div class="toolbar">
          <button onclick="window.print()">${printBtn}</button>
          <button class="ghost" onclick="window.close()">${closeBtn}</button>
        </div>
        <div class="page">
          <div class="header">
            ${logoHtml(store)}
            <div class="store-info">
              <div class="store-name">${esc(store.name || '')}</div>
              ${store.description ? `<div class="store-tag">${esc(store.description)}</div>` : ''}
              <div class="store-meta">
                ${store.address ? `<span>📍 ${esc(store.address)}</span>` : ''}
                ${store.phone ? `<span>📞 ${esc(store.phone)}</span>` : ''}
                ${store.email ? `<span>✉️ ${esc(store.email)}</span>` : ''}
              </div>
            </div>
            ${fiscal ? `<div class="fiscal">${fiscal}</div>` : ''}
          </div>

          <div class="title-bar">
            <div class="t">${esc(doc.headTitle)}</div>
            <div class="s"><b>${esc(doc.subtitle)}</b><br/>${printedOn}: ${esc(formatDateTime(new Date(), lang))}</div>
          </div>

          <div class="content">
            ${metaHtml}
            ${kpisHtml}
            ${sectionsHtml}
          </div>

          <div class="doc-footer">
            ${store.socialMedia ? `<span class="social">🌐 ${esc(store.socialMedia)}</span> — ` : ''}${footerNote}
          </div>
        </div>
        <script>window.onload=function(){setTimeout(function(){window.print();},400);};</script>
      </body>
    </html>
  `);
  win.document.close();
}
