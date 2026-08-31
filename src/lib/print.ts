import type { StoreSettings } from '@/types';
import { formatCurrency, formatDate, formatDateTime } from './utils';

interface InvoiceLine {
  designation: string;
  quantity: number;
  unitPrice: number;
}

interface InvoiceData {
  type: 'purchase' | 'sale';
  reference: string;
  date: string;
  partyName: string;
  partyPhone?: string;
  partyAddress?: string;
  /** N° du bon de livraison fournisseur (achats) */
  bonNumber?: string;
  /** Immatriculation du camion qui a livré (achats) */
  driverPlate?: string;
  lines: InvoiceLine[];
  total: number;
  reduction?: number;
  final?: number;
  paid: number;
  rest: number;
}

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #000; padding: 18px; background: #fff; font-size: 14px; font-weight: 600; line-height: 1.5; }
  .sheet { max-width: 800px; margin: 0 auto; border: 2.5px solid #000; border-radius: 12px; overflow: hidden; }

  /* Header */
  .header { display: flex; align-items: center; gap: 18px; padding: 20px 24px; background: #f4f4f4; border-bottom: 3px solid #000; }
  .logo-box { width: 112px; height: 112px; border-radius: 12px; border: 3px solid #000; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; padding: 3px; }
  .logo-box img { width:100%; height:100%; object-fit:contain; }
  .logo-fallback { font-family: Georgia, serif; font-size: 52px; color:#000; }
  .store-info { flex:1; }
  .store-name { font-family: Georgia, serif; font-size: 28px; font-weight: 900; color: #000; text-transform: uppercase; letter-spacing: -.3px; }
  .store-tag { font-size: 13px; font-weight: 700; color:#222; font-style: italic; margin-top:2px; }
  .store-meta { font-size: 13.5px; font-weight: 700; color: #000; margin-top: 8px; line-height: 1.7; }
  .store-meta span { display:inline-block; margin-right:14px; }

  /* Title bar */
  .title-bar { display:flex; justify-content:space-between; align-items:center; padding: 13px 24px; background:#000; color:#fff; }
  .title { font-size: 21px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; }
  .title-meta { text-align:right; font-size:14px; font-weight:700; line-height:1.7; }
  .title-meta strong { font-size:15px; font-weight:900; }

  .content { padding: 20px 24px 24px; }

  /* Party box */
  .party { background: #f4f4f4; border: 2px solid #000; border-left: 7px solid #000; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; font-size: 14px; font-weight: 700; line-height: 1.7; color:#000; }
  .party .lbl { font-size: 11.5px; text-transform: uppercase; letter-spacing: 1.2px; color:#000; font-weight:900; }
  .party strong { color: #000; font-size: 18px; font-weight: 900; }

  /* Items table */
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px; color:#000; }
  th { background: #000; color: #fff; padding: 10px 12px; text-align: left; font-weight:900; font-size:13px; text-transform:uppercase; letter-spacing:.5px; border:1.5px solid #000; }
  th:nth-child(2), th:nth-child(3), th:last-child, td:nth-child(2), td:nth-child(3), td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  td { padding: 10px 12px; border: 1.5px solid #333; font-weight: 700; color:#000; }
  tr:nth-child(even) td { background:#f4f4f4; }

  /* Totals */
  .totals-wrap { display:flex; justify-content:flex-end; }
  .totals { width: 340px; border:2.5px solid #000; border-radius:8px; overflow:hidden; font-size: 15px; font-weight:800; color:#000; }
  .totals div { display: flex; justify-content: space-between; gap:12px; padding: 9px 16px; border-bottom:1.5px solid #333; }
  .totals div:last-child { border-bottom:0; }
  .totals .grand { background:#000; color:#fff; font-weight: 900; font-size: 16px; }
  .totals .rest-pos { background: #fbdde3 !important; color:#8f0f22; font-weight:900; }

  /* Footer */
  .footer { margin-top: 20px; padding-top: 14px; border-top: 2px dashed #000; text-align:center; }
  .social { display:inline-flex; align-items:center; gap:6px; background:#f4f4f4; border:2px solid #000; border-radius:999px; padding:6px 18px; font-size:13.5px; color:#000; font-weight:800; }
  .thanks { margin-top:10px; font-size:13px; color:#222; font-weight:700; font-style: italic; }
  .signatures { display: flex; justify-content: space-between; margin-top: 32px; font-size: 13.5px; break-inside: avoid; }
  .sig-box { text-align: center; width: 45%; }
  .sig-line { border-top: 2px solid #000; margin-top: 40px; padding-top: 8px; color:#000; font-weight:900; text-transform:uppercase; letter-spacing:.5px; }

  @media print {
    body { padding: 0; font-size: 13.5px; }
    .sheet { border:none; border-radius:0; max-width:none; }
    @page { size: A4; margin: 9mm; }
  }
`;

function logoHtml(store: StoreSettings, big = true): string {
  const size = big ? '' : 'style="width:82px;height:82px;"';
  if (store.logo) {
    return `<div class="logo-box" ${size}><img src="${store.logo}" alt="logo"/></div>`;
  }
  return `<div class="logo-box" ${size}><span class="logo-fallback">🏗️</span></div>`;
}

export function printInvoice(data: InvoiceData, store: StoreSettings) {
  const win = window.open('', '_blank', 'width=860,height=960');
  if (!win) return;

  const titleLabel = data.type === 'purchase' ? "FACTURE D'ACHAT" : 'FACTURE DE VENTE';
  const partyLabel = data.type === 'purchase' ? 'Fournisseur' : 'Client';

  const rows = data.lines
    .map(
      (l) => `<tr>
        <td>${l.designation}</td>
        <td>${l.quantity}</td>
        <td>${formatCurrency(l.unitPrice)}</td>
        <td>${formatCurrency(l.quantity * l.unitPrice)}</td>
      </tr>`
    )
    .join('');

  const social = store.socialMedia
    ? `<div class="footer"><span class="social">🌐 ${store.socialMedia}</span><p class="thanks">Merci de votre confiance — À très bientôt !</p></div>`
    : `<div class="footer"><p class="thanks">Merci de votre confiance — À très bientôt !</p></div>`;

  win.document.write(`
    <html>
      <head><title>${data.reference}</title><style>${css}</style></head>
      <body>
        <div class="sheet">
          <div class="header">
            ${logoHtml(store)}
            <div class="store-info">
              <div class="store-name">${store.name}</div>
              ${store.description ? `<div class="store-tag">${store.description}</div>` : ''}
              <div class="store-meta">
                ${store.address ? `<span>📍 ${store.address}</span>` : ''}
                ${store.phone ? `<span>📞 ${store.phone}</span>` : ''}
                ${store.email ? `<span>✉️ ${store.email}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="title-bar">
            <div class="title">${titleLabel}</div>
            <div class="title-meta">
              <strong>N° ${data.reference}</strong><br/>
              Date: ${data.type === 'sale' ? formatDateTime(data.date) : formatDate(data.date)}
              ${data.bonNumber ? `<br/>Bon n° ${data.bonNumber}` : ''}
              ${data.driverPlate ? `<br/>Matricule: ${data.driverPlate}` : ''}
            </div>
          </div>

          <div class="content">
            <div class="party">
              <div class="lbl">${partyLabel}</div>
              <strong>${data.partyName}</strong><br/>
              ${data.partyAddress ? data.partyAddress + '<br/>' : ''}
              ${data.partyPhone ? '📞 ' + data.partyPhone : ''}
            </div>

            <table>
              <thead><tr><th>Désignation</th><th>Qté</th><th>P.U.</th><th>Total</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>

            <div class="totals-wrap">
              <div class="totals">
                <div><span>Total</span><span>${formatCurrency(data.total)}</span></div>
                ${data.reduction ? `<div><span>Réduction</span><span>- ${formatCurrency(data.reduction)}</span></div>` : ''}
                ${data.final !== undefined && data.reduction ? `<div><span>Net à payer</span><span>${formatCurrency(data.final)}</span></div>` : ''}
                <div><span>Montant payé</span><span>${formatCurrency(data.paid)}</span></div>
                <div class="grand ${data.rest > 0 ? 'rest-pos' : ''}"><span>Reste à payer</span><span>${formatCurrency(data.rest)}</span></div>
              </div>
            </div>

            <div class="signatures">
              <div class="sig-box"><div class="sig-line">Signature ${partyLabel}</div></div>
              <div class="sig-box"><div class="sig-line">Signature Gérant</div></div>
            </div>

            ${social}
          </div>
        </div>
        <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 350); };</script>
      </body>
    </html>
  `);
  win.document.close();
}

export function printDocument(htmlContent: string, title = 'Document') {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return;
  win.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <meta charset="utf-8" />
        <style>
          @page { size: A4; margin: 9mm; }
          html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body {
            margin: 0; padding: 0; font-family: Arial, 'Segoe UI', sans-serif;
            background: #fff; color: #000; font-size: 14px; font-weight: 600; line-height: 1.5;
          }
          table { font-variant-numeric: tabular-nums; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        ${htmlContent}
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          };
        </script>
      </body>
    </html>
  `);
  win.document.close();
}

