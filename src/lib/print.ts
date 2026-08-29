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
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #5A2A47; padding: 24px; background: #fff; }
  .sheet { max-width: 760px; margin: 0 auto; border: 2px solid #FFC2DD; border-radius: 18px; overflow: hidden; box-shadow: 0 6px 24px rgba(229,84,127,.08); }

  /* Header */
  .header { display: flex; align-items: center; gap: 18px; padding: 22px 26px; background: linear-gradient(135deg,#FFF4FA 0%,#FFEAF3 100%); border-bottom: 3px solid #FF7FB0; }
  .logo-box { width: 78px; height: 78px; border-radius: 16px; border: 2px solid #FF7FB0; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; }
  .logo-box img { width:100%; height:100%; object-fit:cover; }
  .logo-fallback { font-family: Georgia, serif; font-size: 30px; color:#FF7FB0; }
  .store-info { flex:1; }
  .store-name { font-family: Georgia, serif; font-size: 24px; font-weight: bold; color: #6E3B5C; }
  .store-tag { font-size: 12px; color:#B06A8C; font-style: italic; margin-top:2px; }
  .store-meta { font-size: 12px; color: #8A4A6B; margin-top: 8px; line-height: 1.6; }
  .store-meta span { display:inline-block; margin-right:14px; }

  /* Title bar */
  .title-bar { display:flex; justify-content:space-between; align-items:center; padding: 14px 26px; background:#FF7FB0; color:#fff; }
  .title { font-size: 18px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; }
  .title-meta { text-align:right; font-size:12px; line-height:1.6; }
  .title-meta strong { font-size:13px; }

  .content { padding: 22px 26px; }

  /* Party box */
  .party { background: #FFF7FB; border: 1px solid #FFC2DD; border-left: 4px solid #FF7FB0; border-radius: 10px; padding: 12px 16px; margin-bottom: 18px; font-size: 13px; line-height: 1.6; }
  .party .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color:#B06A8C; font-weight:600; }
  .party strong { color: #6E3B5C; font-size: 15px; }

  /* Items table */
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 13px; border:1px solid #FBE4EF; border-radius:10px; overflow:hidden; }
  th { background: #FF7FB0; color: #FFFFFF; padding: 10px 12px; text-align: left; font-weight:600; }
  th:nth-child(2), th:nth-child(3), th:last-child, td:nth-child(2), td:nth-child(3), td:last-child { text-align: right; }
  td { padding: 10px 12px; border-bottom: 1px solid #FBE4EF; }
  tr:nth-child(even) td { background:#FFFAFC; }
  tr:last-child td { border-bottom: none; }

  /* Totals */
  .totals-wrap { display:flex; justify-content:flex-end; }
  .totals { width: 320px; border:1px solid #FFC2DD; border-radius:12px; overflow:hidden; font-size: 14px; }
  .totals div { display: flex; justify-content: space-between; padding: 8px 16px; }
  .totals div:nth-child(odd) { background:#FFF7FB; }
  .totals .grand { background:#FF7FB0; color:#fff; font-weight: bold; font-size: 16px; }
  .totals .rest-row span:last-child { color:#fff; }
  .totals .rest-pos { background: linear-gradient(135deg,#FF7AA0,#E5446F) !important; color:#fff; font-weight:bold; }

  /* Footer */
  .footer { margin-top: 22px; padding-top: 16px; border-top: 2px dashed #FFC2DD; text-align:center; }
  .social { display:inline-flex; align-items:center; gap:6px; background:#FFF4FA; border:1px solid #FFC2DD; border-radius:999px; padding:6px 16px; font-size:13px; color:#6E3B5C; font-weight:600; }
  .thanks { margin-top:12px; font-size:13px; color:#B06A8C; font-style: italic; }
  .signatures { display: flex; justify-content: space-between; margin-top: 36px; font-size: 13px; }
  .sig-box { text-align: center; width: 45%; }
  .sig-line { border-top: 1px solid #6E3B5C; margin-top: 38px; padding-top: 6px; color:#8A4A6B; }
`;

function logoHtml(store: StoreSettings, big = true): string {
  const size = big ? '' : 'style="width:54px;height:54px;"';
  if (store.logo) {
    return `<div class="logo-box" ${size}><img src="${store.logo}" alt="logo"/></div>`;
  }
  return `<div class="logo-box" ${size}><span class="logo-fallback">🥐</span></div>`;
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
          @page { size: A4; margin: 10mm; }
          body { margin: 0; padding: 0; font-family: Arial, sans-serif; background: #fff; color: #000; }
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

