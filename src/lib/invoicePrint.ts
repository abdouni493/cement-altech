// ============================================================================
//  Facture de vente — modèle professionnel A4
//  En-tête complet de l'entreprise (logo + coordonnées + identifiants
//  fiscaux), bloc client, détail des lignes, détail des productions
//  déclenchées par la vente, totaux, montant en lettres, puis les
//  emplacements du CACHET et des SIGNATURES.
// ============================================================================
import type { StoreSettings } from '@/types';
import { formatCurrency, formatDate, formatDateTime } from './utils';

export interface InvoiceIngredient {
  productName: string;
  quantityUsed: number;
  unit?: string;
  unitCost?: number;
  lineCost?: number;
}

export interface InvoiceProductionDetail {
  name: string;
  categoryName?: string;
  date?: string;
  hour?: string;
  outputQuantity: number;
  unit?: string;
  unitPrice?: number;
  totalCost?: number;
  ingredients: InvoiceIngredient[];
}

export interface InvoiceLine {
  designation: string;
  description?: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  basePrice?: number;
}

export interface SaleInvoiceData {
  reference: string;
  date: string; // ISO
  client: { name: string; phone?: string; address?: string };
  lines: InvoiceLine[];
  /** Productions launched by this sale (point de vente). */
  productions?: InvoiceProductionDetail[];
  total: number;
  reduction: number;
  final: number;
  paid: number;
  rest: number;
  createdBy?: string;
}

// ------------------------------------------------------------------ helpers --
function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)
  );
}

const qty = (n: number, unit?: string) => {
  const v = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return unit ? `${v} ${unit}` : v;
};

// ---- Montant en lettres (français) ------------------------------------------
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function below100(n: number): string {
  if (n < 20) return UNITS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t === 7 || t === 9) {
    const base = TENS[t] + (u === 1 && t === 7 ? '-et-' : '-');
    return base + UNITS[10 + u];
  }
  if (u === 0) return TENS[t] + (t === 8 ? 's' : '');
  if (u === 1 && t !== 8) return `${TENS[t]}-et-un`;
  return `${TENS[t]}-${UNITS[u]}`;
}

function below1000(n: number): string {
  if (n < 100) return below100(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  const head = h === 1 ? 'cent' : `${UNITS[h]} cent`;
  if (r === 0) return h === 1 ? 'cent' : `${head}s`;
  return `${head} ${below100(r)}`;
}

/** "12 350,50" → "douze mille trois cent cinquante dinars et cinquante centimes". */
export function amountInWords(amount: number): string {
  const value = Math.max(0, Math.round((amount || 0) * 100) / 100);
  const whole = Math.floor(value);
  const cents = Math.round((value - whole) * 100);

  const chunk = (n: number, singular: string, plural: string): string => {
    if (n === 0) return '';
    if (n === 1 && singular === 'mille') return 'mille';
    return `${below1000(n)} ${n > 1 ? plural : singular}`;
  };

  let rest = whole;
  const parts: string[] = [];
  const billions = Math.floor(rest / 1_000_000_000); rest %= 1_000_000_000;
  const millions = Math.floor(rest / 1_000_000); rest %= 1_000_000;
  const thousands = Math.floor(rest / 1000); rest %= 1000;

  if (billions) parts.push(chunk(billions, 'milliard', 'milliards'));
  if (millions) parts.push(chunk(millions, 'million', 'millions'));
  if (thousands) parts.push(chunk(thousands, 'mille', 'mille'));
  if (rest || parts.length === 0) parts.push(below1000(rest));

  const text = parts.filter(Boolean).join(' ');
  const dinars = `${text} ${whole > 1 ? 'dinars' : 'dinar'}`;
  if (!cents) return dinars.charAt(0).toUpperCase() + dinars.slice(1);
  const centWords = `${below100(cents)} ${cents > 1 ? 'centimes' : 'centime'}`;
  const full = `${dinars} et ${centWords}`;
  return full.charAt(0).toUpperCase() + full.slice(1);
}

// ------------------------------------------------------------------- styles --
const CSS = `
  *{ box-sizing:border-box; margin:0; padding:0; }
  html{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body{ font-family:'Inter','Segoe UI',Arial,sans-serif; color:#1F2937; background:#EEF2F5; padding:20px; font-size:12px; line-height:1.5; }

  .toolbar{ max-width:830px; margin:0 auto 14px; display:flex; justify-content:flex-end; gap:10px; }
  .toolbar button{ font:inherit; font-weight:600; cursor:pointer; border:none; border-radius:9px; padding:9px 18px; color:#fff; background:linear-gradient(135deg,#B4881B,#8A6410); box-shadow:0 4px 12px rgba(138,100,16,.28); }
  .toolbar button.ghost{ background:#fff; color:#8A6410; border:1px solid #E3CB8A; box-shadow:none; }

  .sheet{ max-width:830px; margin:0 auto; background:#fff; border:1px solid #E3CB8A; border-radius:12px; overflow:hidden; box-shadow:0 10px 30px rgba(31,41,55,.10); }

  /* En-tête entreprise */
  .head{ display:flex; gap:18px; align-items:flex-start; padding:20px 24px; background:linear-gradient(135deg,#FCF7E9 0%,#F7EDD4 100%); border-bottom:3px solid #B4881B; }
  .logo{ width:82px; height:82px; border-radius:12px; border:2px solid #B4881B; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; }
  .logo img{ width:100%; height:100%; object-fit:contain; }
  .logo span{ font-size:32px; }
  .brand{ flex:1; min-width:0; }
  .brand h1{ font-size:23px; font-weight:800; color:#6B4A05; letter-spacing:-.3px; }
  .brand .tag{ font-size:11.5px; font-style:italic; color:#8A6410; margin-top:2px; }
  .brand .meta{ font-size:11px; color:#4B5563; margin-top:8px; line-height:1.75; }
  .brand .meta b{ color:#374151; }
  .fiscal{ flex-shrink:0; text-align:right; font-size:10.5px; color:#4B5563; line-height:1.8; border-left:1px dashed #D9BE7C; padding-left:14px; }
  .fiscal b{ color:#6B4A05; }

  /* Bandeau titre */
  .titlebar{ display:flex; justify-content:space-between; align-items:center; gap:16px; padding:12px 24px; background:linear-gradient(135deg,#B4881B 0%,#8A6410 100%); color:#fff; }
  .titlebar .t{ font-size:18px; font-weight:800; letter-spacing:2px; }
  .titlebar .s{ text-align:right; font-size:11.5px; line-height:1.7; }
  .titlebar .s b{ font-size:13px; }

  .body{ padding:20px 24px 26px; }

  /* Bloc client / règlement */
  .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:18px; }
  .box{ border:1px solid #E5E7EB; border-left:4px solid #B4881B; border-radius:9px; padding:11px 14px; background:#FCFBF7; }
  .box .lbl{ font-size:9.5px; text-transform:uppercase; letter-spacing:1.2px; color:#8A6410; font-weight:800; margin-bottom:4px; }
  .box .nm{ font-size:15px; font-weight:800; color:#111827; }
  .box .ln{ font-size:11.5px; color:#4B5563; margin-top:3px; }
  .box.alt{ border-left-color:#0F766E; }
  .box.alt .lbl{ color:#0F766E; }

  /* Tableaux */
  table{ width:100%; border-collapse:collapse; font-size:11.5px; border:1px solid #E5E7EB; border-radius:8px; overflow:hidden; margin-bottom:16px; }
  thead{ display:table-header-group; }
  th{ background:#6B4A05; color:#fff; padding:8px 10px; text-align:left; font-weight:700; font-size:10.5px; text-transform:uppercase; letter-spacing:.4px; white-space:nowrap; }
  td{ padding:8px 10px; border-top:1px solid #EFEAE0; vertical-align:top; }
  tbody tr:nth-child(even) td{ background:#FCFBF7; }
  tr{ break-inside:avoid; }
  .num{ text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .ctr{ text-align:center; }
  .muted{ color:#6B7280; font-size:10.5px; }
  .strike{ text-decoration:line-through; color:#9CA3AF; }

  h2.sec{ font-size:12.5px; font-weight:800; color:#6B4A05; padding:7px 12px; background:#F7EDD4; border-left:4px solid #B4881B; border-radius:7px; margin-bottom:9px; display:flex; justify-content:space-between; align-items:center; }
  .sub{ font-size:10.5px; color:#6B7280; margin:-4px 0 8px 2px; font-style:italic; }

  /* Fiche de production */
  .prod{ border:1px solid #E5E7EB; border-radius:9px; padding:0; margin-bottom:12px; overflow:hidden; break-inside:avoid; }
  .prod .ph{ display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 12px; background:#F0FDFA; border-bottom:1px solid #CCFBF1; }
  .prod .ph .n{ font-weight:800; color:#0F766E; font-size:12.5px; }
  .prod .ph .q{ font-size:11px; color:#134E4A; font-weight:700; }
  .prod table{ margin:0; border:none; border-radius:0; }
  .prod th{ background:#0F766E; }

  /* Totaux */
  .totwrap{ display:flex; justify-content:space-between; gap:16px; align-items:flex-start; margin-bottom:6px; }
  .words{ flex:1; border:1px dashed #B4881B; border-radius:9px; padding:11px 14px; background:#FCF7E9; font-size:11.5px; }
  .words .lbl{ font-size:9.5px; text-transform:uppercase; letter-spacing:1.2px; color:#8A6410; font-weight:800; margin-bottom:3px; }
  .words .v{ font-weight:700; color:#374151; font-style:italic; }
  .totals{ width:300px; flex-shrink:0; border:1px solid #E3CB8A; border-radius:9px; overflow:hidden; font-size:12px; }
  .totals div{ display:flex; justify-content:space-between; padding:7px 14px; }
  .totals div:nth-child(odd){ background:#FCFBF7; }
  .totals .grand{ background:#6B4A05; color:#fff; font-weight:800; font-size:13.5px; }
  .totals .due{ background:linear-gradient(135deg,#E11D48,#9F1239); color:#fff; font-weight:800; }
  .totals .ok{ background:linear-gradient(135deg,#059669,#047857); color:#fff; font-weight:800; }

  /* Cachet & signatures */
  .signs{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:26px; break-inside:avoid; }
  .sign{ border:1.5px solid #9CA3AF; border-radius:9px; height:110px; padding:8px 10px; display:flex; flex-direction:column; }
  .sign .lbl{ font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.8px; color:#4B5563; }
  .sign .hint{ font-size:9px; color:#9CA3AF; margin-top:auto; text-align:center; font-style:italic; }
  .sign.stamp{ border-style:dashed; border-color:#B4881B; background:#FCFBF7; }
  .sign.stamp .lbl{ color:#8A6410; }

  .foot{ margin-top:20px; padding-top:12px; border-top:2px dashed #E3CB8A; text-align:center; font-size:10.5px; color:#6B7280; }
  .foot .social{ color:#8A6410; font-weight:700; }

  @media print{
    body{ background:#fff; padding:0; font-size:11.5px; }
    .toolbar{ display:none !important; }
    .sheet{ border:none; box-shadow:none; border-radius:0; max-width:none; }
    @page{ size:A4; margin:11mm; }
  }
`;

// ----------------------------------------------------------------- rendering --
function logoHtml(store: StoreSettings): string {
  return store.logo
    ? `<div class="logo"><img src="${store.logo}" alt="logo"/></div>`
    : `<div class="logo"><span>🏗️</span></div>`;
}

function productionHtml(p: InvoiceProductionDetail): string {
  const rows = p.ingredients
    .map(
      (i) => `<tr>
        <td>${esc(i.productName)}</td>
        <td class="num">${esc(qty(i.quantityUsed, i.unit))}</td>
        <td class="num">${formatCurrency(i.unitCost ?? 0)}</td>
        <td class="num">${formatCurrency(i.lineCost ?? (i.quantityUsed * (i.unitCost ?? 0)))}</td>
      </tr>`
    )
    .join('');

  const meta = [
    p.categoryName ? esc(p.categoryName) : '',
    p.date ? `${formatDate(p.date)}${p.hour ? ` — ${esc(p.hour)}` : ''}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return `
    <div class="prod">
      <div class="ph">
        <div><span class="n">${esc(p.name)}</span>${meta ? `<span class="muted"> · ${meta}</span>` : ''}</div>
        <div class="q">Quantité produite : ${esc(qty(p.outputQuantity, p.unit))}${
          p.totalCost !== undefined ? ` · Coût matières : ${formatCurrency(p.totalCost)}` : ''
        }</div>
      </div>
      ${
        rows
          ? `<table>
              <thead><tr><th>Matière consommée</th><th class="num">Quantité</th><th class="num">Coût unitaire</th><th class="num">Coût ligne</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<div style="padding:10px 12px" class="muted">Aucune matière détaillée.</div>'
      }
    </div>`;
}

export function printSaleInvoice(data: SaleInvoiceData, store: StoreSettings) {
  const win = window.open('', '_blank', 'width=900,height=1040');
  if (!win) return;

  const rows = data.lines
    .map((l, i) => {
      const overridden = l.basePrice !== undefined && Math.abs(l.basePrice - l.unitPrice) > 0.001;
      return `<tr>
        <td class="ctr">${i + 1}</td>
        <td>
          <b>${esc(l.designation)}</b>
          ${l.description ? `<div class="muted">${esc(l.description)}</div>` : ''}
        </td>
        <td class="num">${esc(qty(l.quantity, l.unit))}</td>
        <td class="num">
          ${formatCurrency(l.unitPrice)}
          ${overridden ? `<div class="muted strike">${formatCurrency(l.basePrice as number)}</div>` : ''}
        </td>
        <td class="num"><b>${formatCurrency(l.quantity * l.unitPrice)}</b></td>
      </tr>`;
    })
    .join('');

  const fiscal = [
    store.rc ? `<div><b>RC</b> ${esc(store.rc)}</div>` : '',
    store.nif ? `<div><b>NIF</b> ${esc(store.nif)}</div>` : '',
    store.nis ? `<div><b>NIS</b> ${esc(store.nis)}</div>` : '',
    store.article ? `<div><b>Art.</b> ${esc(store.article)}</div>` : '',
  ]
    .filter(Boolean)
    .join('');

  const prods = data.productions && data.productions.length
    ? `<h2 class="sec"><span>Détail des productions réalisées</span><span>${data.productions.length} fiche(s)</span></h2>
       <div class="sub">Lots fabriqués et livrés au titre de cette facture, avec les matières consommées.</div>
       ${data.productions.map(productionHtml).join('')}`
    : '';

  win.document.write(`<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Facture ${esc(data.reference)}</title>
    <style>${CSS}</style>
  </head>
  <body>
    <div class="toolbar">
      <button onclick="window.print()">🖨️ Imprimer</button>
      <button class="ghost" onclick="window.close()">Fermer</button>
    </div>

    <div class="sheet">
      <div class="head">
        ${logoHtml(store)}
        <div class="brand">
          <h1>${esc(store.name || 'ALTECH PRODUCTION')}</h1>
          ${store.description ? `<div class="tag">${esc(store.description)}</div>` : ''}
          <div class="meta">
            ${store.address ? `<div><b>Adresse :</b> ${esc(store.address)}</div>` : ''}
            ${store.phone ? `<span><b>Tél :</b> ${esc(store.phone)}</span>` : ''}
            ${store.email ? `<span> &nbsp;·&nbsp; <b>Email :</b> ${esc(store.email)}</span>` : ''}
          </div>
        </div>
        ${fiscal ? `<div class="fiscal">${fiscal}</div>` : ''}
      </div>

      <div class="titlebar">
        <div class="t">FACTURE DE VENTE</div>
        <div class="s">
          <b>N° ${esc(data.reference)}</b><br/>
          Date : ${esc(formatDateTime(data.date))}
          ${data.createdBy ? `<br/>Établie par : ${esc(data.createdBy)}` : ''}
        </div>
      </div>

      <div class="body">
        <div class="grid2">
          <div class="box">
            <div class="lbl">Client</div>
            <div class="nm">${esc(data.client.name)}</div>
            ${data.client.phone ? `<div class="ln">Tél : ${esc(data.client.phone)}</div>` : ''}
            ${data.client.address ? `<div class="ln">${esc(data.client.address)}</div>` : ''}
          </div>
          <div class="box alt">
            <div class="lbl">Règlement</div>
            <div class="nm">${data.rest > 0 ? 'Vente à crédit' : 'Réglée intégralement'}</div>
            <div class="ln">Payé : ${formatCurrency(data.paid)} · Reste : ${formatCurrency(data.rest)}</div>
            <div class="ln">${data.lines.length} article(s) facturé(s)</div>
          </div>
        </div>

        <h2 class="sec"><span>Désignation des articles</span><span>${formatCurrency(data.total)}</span></h2>
        <table>
          <thead>
            <tr>
              <th class="ctr" style="width:34px">#</th>
              <th>Désignation</th>
              <th class="num">Quantité</th>
              <th class="num">Prix unitaire</th>
              <th class="num">Montant</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        ${prods}

        <div class="totwrap">
          <div class="words">
            <div class="lbl">Arrêtée la présente facture à la somme de</div>
            <div class="v">${esc(amountInWords(data.final))}</div>
          </div>
          <div class="totals">
            <div><span>Total brut</span><span>${formatCurrency(data.total)}</span></div>
            ${data.reduction ? `<div><span>Réduction</span><span>− ${formatCurrency(data.reduction)}</span></div>` : ''}
            <div class="grand"><span>Net à payer</span><span>${formatCurrency(data.final)}</span></div>
            <div><span>Montant versé</span><span>${formatCurrency(data.paid)}</span></div>
            <div class="${data.rest > 0 ? 'due' : 'ok'}"><span>Reste à payer</span><span>${formatCurrency(data.rest)}</span></div>
          </div>
        </div>

        <div class="signs">
          <div class="sign">
            <div class="lbl">Signature du client</div>
            <div class="hint">Lu et approuvé</div>
          </div>
          <div class="sign stamp">
            <div class="lbl">Cachet de l'entreprise</div>
            <div class="hint">Emplacement réservé au cachet</div>
          </div>
          <div class="sign">
            <div class="lbl">Signature du gérant</div>
            <div class="hint">Nom &amp; qualité</div>
          </div>
        </div>

        <div class="foot">
          ${store.socialMedia ? `<span class="social">🌐 ${esc(store.socialMedia)}</span> — ` : ''}
          Merci de votre confiance. Facture générée automatiquement par le système de gestion.
        </div>
      </div>
    </div>
    <script>window.onload=function(){setTimeout(function(){window.print();},400);};</script>
  </body>
</html>`);
  win.document.close();
}
