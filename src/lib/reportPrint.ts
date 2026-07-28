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
  /* Palette matches the app: teal #0D9488 / dark #0F766E, green #10B981, red #E11D48, orange #F59E0B, slate #0F172A */
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Inter','Segoe UI',Arial,sans-serif; color: #0F172A; background: #F0F6F8; padding: 22px; font-size: 12px; line-height: 1.45; }
  .page { max-width: 900px; margin: 0 auto; background: #fff; border: 1px solid #CCFBF1; border-radius: 14px; overflow: hidden; box-shadow: 0 8px 30px rgba(13,148,136,.14); }

  /* Toolbar (screen only) */
  .toolbar { max-width: 900px; margin: 0 auto 14px; display: flex; justify-content: flex-end; gap: 10px; }
  .toolbar button { font: inherit; font-weight: 600; cursor: pointer; border: none; border-radius: 10px; padding: 9px 18px; color: #fff; background: linear-gradient(135deg,#0D9488 0%,#0891B2 50%,#0284C7 100%); box-shadow: 0 4px 14px rgba(13,148,136,.3); }
  .toolbar button.ghost { background: #fff; color: #0F766E; border: 1px solid #99F6E4; box-shadow: none; }

  /* Header */
  .header { display: flex; align-items: center; gap: 16px; padding: 20px 24px; background: linear-gradient(135deg,#F0FDFA 0%,#E0F2FE 100%); border-bottom: 3px solid #0D9488; }
  .logo-box { width: 66px; height: 66px; border-radius: 14px; border: 2px solid #0D9488; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; }
  .logo-box img { width:100%; height:100%; object-fit:cover; }
  .logo-fallback { font-size: 30px; }
  .store-info { flex:1; min-width:0; }
  .store-name { font-family: 'Inter', sans-serif; font-size: 22px; font-weight: 800; color: #0F766E; letter-spacing:-.3px; }
  .store-tag { font-size: 11px; color:#0D9488; font-style: italic; margin-top:1px; }
  .store-meta { font-size: 11px; color: #475569; margin-top: 6px; line-height: 1.7; }
  .store-meta span { display:inline-block; margin-right:12px; }
  .fiscal { text-align: right; font-size: 10px; color:#64748B; line-height:1.7; flex-shrink:0; }
  .fiscal b { color:#0F766E; }

  /* Title bar */
  .title-bar { display:flex; justify-content:space-between; align-items:center; padding: 13px 24px; background:linear-gradient(135deg,#0D9488 0%,#0891B2 50%,#0284C7 100%); color:#fff; }
  .title-bar .t { font-size: 17px; font-weight: bold; letter-spacing: 1.5px; text-transform: uppercase; }
  .title-bar .s { text-align:right; font-size:12px; line-height:1.6; }
  .title-bar .s b { font-size:13px; }

  .content { padding: 20px 24px 26px; }

  /* Meta chips */
  .meta { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }
  .meta .chip { background:#F0FDFA; border:1px solid #CCFBF1; border-radius:8px; padding:6px 12px; font-size:11px; }
  .meta .chip b { display:block; font-size:10px; text-transform:uppercase; letter-spacing:.5px; color:#64748B; }
  .meta .chip span { font-weight:700; color:#0F172A; font-size:12.5px; }

  /* KPI summary strip */
  .kpis { display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; margin-bottom:22px; }
  .kpi { border:1px solid #CCFBF1; border-radius:10px; padding:9px 12px; background:#F7FDFC; }
  .kpi .l { font-size:10px; text-transform:uppercase; letter-spacing:.5px; color:#64748B; margin-bottom:3px; }
  .kpi .v { font-size:15px; font-weight:800; color:#0F172A; letter-spacing:-.2px; }
  .kpi .v.pos { color:#059669; } .kpi .v.neg { color:#E11D48; } .kpi .v.accent { color:#0F766E; } .kpi .v.muted { color:#64748B; }

  /* Sections */
  .section { margin-bottom: 22px; break-inside: avoid; }
  .section > h2 { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13.5px; font-weight:800; color:#0F766E; padding:8px 12px; background:linear-gradient(135deg,#F0FDFA,#CCFBF1); border-left:4px solid #0D9488; border-radius:8px; margin-bottom:8px; }
  .section > h2 .htotal { font-size:13px; color:#0F766E; font-weight:800; }
  .section .note { font-size:11px; color:#64748B; margin:-4px 0 8px 2px; font-style:italic; }

  /* Tables */
  table { width:100%; border-collapse:collapse; font-size:11.5px; border:1px solid #CFEAE9; border-radius:8px; overflow:hidden; }
  thead { display: table-header-group; }
  th { background:#0F766E; color:#fff; padding:7px 10px; text-align:left; font-weight:600; font-size:11px; white-space:nowrap; }
  td { padding:6px 10px; border-top:1px solid #E2F0EF; vertical-align:top; }
  tr { break-inside: avoid; }
  tbody tr:nth-child(even) td { background:#F7FDFC; }
  .al-right { text-align:right; } .al-center { text-align:center; }
  td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }

  /* Row variants */
  tr.r-category td { background:#CCFBF1 !important; font-weight:800; color:#0F766E; border-top:1px solid #99F6E4; }
  tr.r-subheader td { background:#E1EDF0 !important; font-weight:700; color:#155E75; }
  tr.r-detail td.first { padding-left:22px; color:#334155; }
  tr.r-subtotal td { background:#F0FDFA !important; font-weight:700; border-top:1.5px solid #99F6E4; }
  tr.r-total td { background:#0F766E !important; color:#fff; font-weight:800; }
  tr.r-total td .pos, tr.r-total td .neg, tr.r-total td .accent, tr.r-total td .muted { color:#fff !important; }

  /* Tones on cell content */
  .pos { color:#059669; font-weight:700; } .neg { color:#E11D48; font-weight:700; }
  .muted { color:#64748B; } .accent { color:#0F766E; font-weight:700; }

  .empty { padding:14px; text-align:center; color:#64748B; font-style:italic; border:1px dashed #99F6E4; border-radius:8px; background:#F7FDFC; }

  /* Footer */
  .doc-footer { margin-top:8px; padding:14px 24px; border-top:2px dashed #99F6E4; text-align:center; font-size:10.5px; color:#64748B; }
  .doc-footer .social { color:#0F766E; font-weight:700; }

  @media print {
    body { background:#fff; padding:0; }
    .toolbar { display:none !important; }
    .page { border:none; box-shadow:none; border-radius:0; max-width:none; }
    @page { margin: 12mm; }
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
