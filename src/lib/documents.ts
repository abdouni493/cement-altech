import type { StoreSettings } from '@/types';
import { formatCurrency, formatDate, formatDateTime } from './utils';
import { printDocument } from './print';

/* ============================================================================
 *  Documents imprimables — reçus de règlement, bons de livraison,
 *  bons de commande et fiches de production.
 *  Tous partagent le même en-tête (logo + coordonnées du magasin).
 * ========================================================================== */

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, 'Segoe UI', sans-serif; color: #111; background: #fff; }
  .sheet { max-width: 780px; margin: 0 auto; border: 2px solid #111; border-radius: 10px; overflow: hidden; }
  .head { display: flex; justify-content: space-between; gap: 20px; padding: 18px 22px; border-bottom: 2px solid #111; }
  .brand-name { font-size: 20px; font-weight: bold; }
  .brand-tag { font-size: 11px; font-style: italic; color: #555; margin-top: 2px; }
  .brand-meta { font-size: 11px; color: #333; margin-top: 8px; line-height: 1.6; }
  .doc-title { font-size: 17px; font-weight: bold; background: #111; color: #fff; padding: 6px 14px; border-radius: 4px; display: inline-block; letter-spacing: 1px; }
  .doc-meta { text-align: right; font-size: 12px; line-height: 1.7; margin-top: 8px; }
  .logo { width: 74px; height: 74px; border: 2px solid #111; border-radius: 10px; object-fit: cover; }
  .content { padding: 20px 22px; }
  .party { border: 1px solid #ccc; border-left: 4px solid #111; border-radius: 6px; padding: 10px 14px; margin-bottom: 18px; font-size: 13px; line-height: 1.7; background: #fafafa; }
  .party .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 18px; }
  th { background: #efefef; padding: 9px 10px; text-align: left; border: 1px solid #ccc; font-weight: bold; }
  td { padding: 9px 10px; border: 1px solid #ddd; }
  .right { text-align: right; } .center { text-align: center; }
  .totals { width: 320px; margin-left: auto; border: 1px solid #111; border-radius: 6px; overflow: hidden; font-size: 13px; }
  .totals div { display: flex; justify-content: space-between; padding: 8px 13px; border-bottom: 1px solid #ddd; }
  .totals div:last-child { border-bottom: 0; }
  .totals .grand { background: #111; color: #fff; font-weight: bold; font-size: 14px; }
  .totals .ok { background: #e9f7ef; font-weight: bold; }
  .totals .due { background: #fdecef; font-weight: bold; }
  .note { border: 1px dashed #999; border-radius: 6px; padding: 10px 14px; font-size: 12px; margin-bottom: 18px; background: #fcfcfc; }
  .signs { display: flex; justify-content: space-between; gap: 20px; margin-top: 34px; font-size: 12px; text-align: center; }
  .sign { width: 46%; border: 1px solid #111; border-radius: 6px; padding: 12px; height: 92px; font-weight: bold; }
  .foot { margin-top: 22px; padding-top: 12px; border-top: 1px dashed #999; text-align: center; font-size: 11px; color: #666; }
  .stamp { display: inline-block; border: 2px solid #0a7d43; color: #0a7d43; border-radius: 6px; padding: 4px 12px; font-weight: bold; transform: rotate(-4deg); font-size: 13px; }
  .stamp.warn { border-color: #b45309; color: #b45309; }
`;

function header(store: StoreSettings, title: string, metaLines: string[]): string {
  const logo = store.logo
    ? `<img class="logo" src="${store.logo}" alt="logo"/>`
    : `<div class="logo" style="display:flex;align-items:center;justify-content:center;font-size:26px;">🏗️</div>`;
  return `
    <div class="head">
      <div style="display:flex;gap:14px;align-items:flex-start;">
        ${logo}
        <div>
          <div class="brand-name">${esc(store.name || 'ALTECH PRODUCTION')}</div>
          ${store.description ? `<div class="brand-tag">${esc(store.description)}</div>` : ''}
          <div class="brand-meta">
            ${store.address ? `📍 ${esc(store.address)}<br/>` : ''}
            ${store.phone ? `📞 ${esc(store.phone)}` : ''}${store.email ? ` · ✉️ ${esc(store.email)}` : ''}
            ${store.nif || store.nis || store.rc
              ? `<br/>${store.nif ? `NIF: ${esc(store.nif)} ` : ''}${store.nis ? `| NIS: ${esc(store.nis)} ` : ''}${store.rc ? `| RC: ${esc(store.rc)}` : ''}`
              : ''}
          </div>
        </div>
      </div>
      <div style="text-align:right;">
        <div class="doc-title">${esc(title)}</div>
        <div class="doc-meta">${metaLines.join('<br/>')}</div>
      </div>
    </div>`;
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)
  );
}

function wrap(inner: string): string {
  return `<style>${BASE_CSS}</style><div class="sheet">${inner}</div>`;
}

/* -------------------------------------------------------- reçu de règlement */

export interface PaymentReceiptData {
  kind: 'client' | 'supplier';
  receiptNumber: string;
  partyName: string;
  partyPhone?: string;
  amount: number;
  paidAt: string;          // ISO datetime
  notes?: string;
  totalDebt: number;
  totalPaid: number;
  restAmount: number;
}

export function printPaymentReceipt(data: PaymentReceiptData, store: StoreSettings) {
  const isClient = data.kind === 'client';
  const title = isClient ? 'REÇU DE PAIEMENT CLIENT' : 'REÇU DE RÈGLEMENT FOURNISSEUR';
  const partyLabel = isClient ? 'Client' : 'Fournisseur';
  const wording = isClient
    ? 'Reçu de la part de'
    : 'Versé à';

  const html = wrap(`
    ${header(store, title, [
      `<strong>N° ${esc(data.receiptNumber)}</strong>`,
      `Date : ${esc(formatDateTime(data.paidAt))}`,
    ])}
    <div class="content">
      <div class="party">
        <div class="lbl">${partyLabel}</div>
        <strong style="font-size:15px;">${esc(data.partyName)}</strong>
        ${data.partyPhone ? `<br/>📞 ${esc(data.partyPhone)}` : ''}
      </div>

      <p style="font-size:13px;margin-bottom:14px;">
        ${wording} <strong>${esc(data.partyName)}</strong> la somme de
        <strong style="font-size:16px;">${formatCurrency(data.amount)}</strong>
        le ${esc(formatDateTime(data.paidAt))}.
      </p>

      ${data.notes ? `<div class="note"><strong>Note :</strong> ${esc(data.notes)}</div>` : ''}

      <div class="totals">
        <div><span>Dette totale</span><strong>${formatCurrency(data.totalDebt)}</strong></div>
        <div><span>Montant réglé ce jour</span><strong>${formatCurrency(data.amount)}</strong></div>
        <div class="ok"><span>Total payé</span><strong>${formatCurrency(data.totalPaid)}</strong></div>
        <div class="${data.restAmount > 0 ? 'due' : 'grand'}">
          <span>Reste à payer</span><strong>${formatCurrency(data.restAmount)}</strong>
        </div>
      </div>

      <div style="margin-top:18px;">
        <span class="stamp ${data.restAmount > 0 ? 'warn' : ''}">
          ${data.restAmount > 0 ? 'PAIEMENT PARTIEL' : 'DETTE SOLDÉE'}
        </span>
      </div>

      <div class="signs">
        <div class="sign">Signature ${partyLabel}</div>
        <div class="sign">Cachet &amp; Signature Entreprise</div>
      </div>
      <div class="foot">${esc(store.socialMedia || '')} — Merci de votre confiance.</div>
    </div>`);

  printDocument(html, `Recu_${data.receiptNumber}`);
}

/* ---------------------------------------------------------- bon de livraison */

export interface DeliveryNoteData {
  reference: string;
  commandReference: string;
  clientName: string;
  clientPhone?: string;
  deliveredAt: string;
  notes?: string;
  lines: {
    productName: string;
    ordered: number;
    deliveredNow: number;
    deliveredTotal: number;
    unit?: string;
  }[];
}

export function printDeliveryNote(data: DeliveryNoteData, store: StoreSettings) {
  const rows = data.lines
    .map((l) => {
      const u = l.unit ? ` ${esc(l.unit)}` : '';
      const remaining = Math.max(0, l.ordered - l.deliveredTotal);
      return `<tr>
        <td><strong>${esc(l.productName)}</strong></td>
        <td class="center">${l.ordered}${u}</td>
        <td class="center"><strong>${l.deliveredNow}${u}</strong></td>
        <td class="center">${l.deliveredTotal}${u}</td>
        <td class="center" style="color:${remaining > 0 ? '#b91c1c' : '#0a7d43'};font-weight:bold;">
          ${remaining > 0 ? `${remaining}${u}` : 'Complet ✔'}
        </td>
      </tr>`;
    })
    .join('');

  const totalRemaining = data.lines.reduce((s, l) => s + Math.max(0, l.ordered - l.deliveredTotal), 0);

  const html = wrap(`
    ${header(store, 'BON DE LIVRAISON', [
      `<strong>N° ${esc(data.reference)}</strong>`,
      `Commande : ${esc(data.commandReference)}`,
      `Livré le : ${esc(formatDateTime(data.deliveredAt))}`,
    ])}
    <div class="content">
      <div class="party">
        <div class="lbl">Destinataire</div>
        <strong style="font-size:15px;">${esc(data.clientName)}</strong>
        ${data.clientPhone ? `<br/>📞 ${esc(data.clientPhone)}` : ''}
      </div>

      <table>
        <thead>
          <tr>
            <th>Désignation</th>
            <th class="center">Commandé</th>
            <th class="center">Livré maintenant</th>
            <th class="center">Livré au total</th>
            <th class="center">Reste à livrer</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      ${data.notes ? `<div class="note"><strong>Observations :</strong> ${esc(data.notes)}</div>` : ''}

      <div style="margin-bottom:14px;">
        <span class="stamp ${totalRemaining > 0 ? 'warn' : ''}">
          ${totalRemaining > 0 ? 'LIVRAISON PARTIELLE' : 'COMMANDE ENTIÈREMENT LIVRÉE'}
        </span>
      </div>

      <div class="note">
        Le client reconnaît avoir reçu les marchandises listées ci-dessus en bon état.
      </div>

      <div class="signs">
        <div class="sign">Signature &amp; bon pour réception (Client)</div>
        <div class="sign">Cachet &amp; Signature Expéditeur</div>
      </div>
    </div>`);

  printDocument(html, `Bon_Livraison_${data.reference}`);
}

/* ---------------------------------------------------------- bon de commande */

export interface PurchaseOrderData {
  reference: string;
  date: string;
  supplierName?: string;
  notes?: string;
  items: { productName: string; description: string; quantity: number; unit?: string }[];
}

export function printPurchaseOrder(data: PurchaseOrderData, store: StoreSettings) {
  const rows = data.items
    .map(
      (i, idx) => `<tr>
        <td class="center">${idx + 1}</td>
        <td><strong>${esc(i.productName)}</strong></td>
        <td>${esc(i.description || '—')}</td>
        <td class="center"><strong>${i.quantity}${i.unit ? ` ${esc(i.unit)}` : ''}</strong></td>
      </tr>`
    )
    .join('');

  const html = wrap(`
    ${header(store, 'BON DE COMMANDE', [
      `<strong>N° ${esc(data.reference)}</strong>`,
      `Date : ${esc(formatDate(data.date))}`,
    ])}
    <div class="content">
      ${data.supplierName
        ? `<div class="party"><div class="lbl">Fournisseur</div><strong style="font-size:15px;">${esc(data.supplierName)}</strong></div>`
        : ''}

      <table>
        <thead>
          <tr><th class="center" style="width:40px;">#</th><th>Produit</th><th>Description</th><th class="center">Quantité</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      ${data.notes ? `<div class="note"><strong>Observations :</strong> ${esc(data.notes)}</div>` : ''}

      <div class="signs">
        <div class="sign">Signature Demandeur</div>
        <div class="sign">Cachet &amp; Signature Entreprise</div>
      </div>
      <div class="foot">Document interne — bon de commande fournisseur.</div>
    </div>`);

  printDocument(html, `Bon_Commande_${data.reference}`);
}

/* --------------------------------------------------------- fiche production */

export interface ProductionSheetData {
  name: string;
  date: string;
  hour: string;
  categoryName?: string;
  description?: string;
  createdBy?: string;
  outputQuantity: number;
  sellUnit?: string;
  unitPrice: number;
  totalValue: number;
  totalCost: number;
  sentToComptoir: number;
  hasLoss?: boolean;
  expectedQuantity?: number;
  lossQuantity?: number;
  lossValue?: number;
  lossDescription?: string;
  ingredients: { productName: string; quantityUsed: number; unit?: string; unitCost: number; lineCost: number }[];
}

export function printProductionSheet(data: ProductionSheetData, store: StoreSettings) {
  const u = data.sellUnit ? ` ${esc(data.sellUnit)}` : '';
  const rows = data.ingredients
    .map(
      (i) => `<tr>
        <td><strong>${esc(i.productName)}</strong></td>
        <td class="center">${i.quantityUsed}${i.unit ? ` ${esc(i.unit)}` : ''}</td>
        <td class="right">${formatCurrency(i.unitCost)}</td>
        <td class="right">${formatCurrency(i.lineCost)}</td>
      </tr>`
    )
    .join('');

  const gains = data.totalValue - data.totalCost;

  const html = wrap(`
    ${header(store, 'FICHE DE PRODUCTION', [
      `<strong>${esc(data.name)}</strong>`,
      `Date : ${esc(formatDate(data.date))} à ${esc(data.hour)}`,
      data.categoryName ? `Catégorie : ${esc(data.categoryName)}` : '',
    ].filter(Boolean))}
    <div class="content">
      ${data.description ? `<div class="note"><em>${esc(data.description)}</em></div>` : ''}

      <h3 style="font-size:13px;margin-bottom:8px;">Matières premières consommées</h3>
      <table>
        <thead>
          <tr><th>Ingrédient</th><th class="center">Quantité</th><th class="right">Coût unitaire</th><th class="right">Coût ligne</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><th colspan="3" class="right">Coût total des matières</th><th class="right">${formatCurrency(data.totalCost)}</th></tr>
        </tfoot>
      </table>

      <h3 style="font-size:13px;margin-bottom:8px;">Résultat de la production</h3>
      <table>
        <tbody>
          <tr><td>Quantité produite</td><td class="right"><strong>${data.outputQuantity}${u}</strong></td></tr>
          <tr><td>Envoyée au comptoir</td><td class="right">${data.sentToComptoir}${u}</td></tr>
          <tr><td>Reste en stock production</td><td class="right">${data.outputQuantity - data.sentToComptoir}${u}</td></tr>
          <tr><td>Prix de vente unitaire</td><td class="right">${formatCurrency(data.unitPrice)}${data.sellUnit ? ` / ${esc(data.sellUnit)}` : ''}</td></tr>
          ${data.hasLoss
            ? `<tr><td>Quantité prévue</td><td class="right">${data.expectedQuantity ?? 0}${u}</td></tr>
               <tr><td style="color:#b91c1c;">Perte constatée</td><td class="right" style="color:#b91c1c;font-weight:bold;">
                 ${data.lossQuantity ?? 0}${u} (${formatCurrency(data.lossValue ?? 0)})</td></tr>
               ${data.lossDescription ? `<tr><td>Motif de la perte</td><td class="right">${esc(data.lossDescription)}</td></tr>` : ''}`
            : ''}
        </tbody>
      </table>

      <div class="totals">
        <div><span>Coût de production</span><strong>${formatCurrency(data.totalCost)}</strong></div>
        <div><span>Valeur de vente estimée</span><strong>${formatCurrency(data.totalValue)}</strong></div>
        <div class="${gains >= 0 ? 'ok' : 'due'}"><span>Gain net estimé</span><strong>${formatCurrency(gains)}</strong></div>
      </div>

      <div class="signs">
        <div class="sign">Responsable production</div>
        <div class="sign">Cachet &amp; Signature Entreprise</div>
      </div>
      <div class="foot">${data.createdBy ? `Enregistré par ${esc(data.createdBy)}` : ''}</div>
    </div>`);

  printDocument(html, `Production_${data.name.replace(/\s+/g, '_')}`);
}

/* ------------------------------------------------ reçu heures supplémentaires */

export interface OvertimeReceiptData {
  workerName: string;
  role?: string;
  paidAt: string;
  amount: number;
  lines: { date: string; from: string; to: string; hours: number; rate: number; amount: number; description?: string }[];
}

export function printOvertimeReceipt(data: OvertimeReceiptData, store: StoreSettings) {
  const rows = data.lines
    .map(
      (l) => `<tr>
        <td class="center">${esc(formatDate(l.date))}</td>
        <td class="center">${esc(l.from)} → ${esc(l.to)}</td>
        <td class="center">${l.hours.toFixed(2)} h</td>
        <td class="right">${formatCurrency(l.rate)}</td>
        <td class="right"><strong>${formatCurrency(l.amount)}</strong></td>
      </tr>`
    )
    .join('');
  const totalHours = data.lines.reduce((s, l) => s + l.hours, 0);

  const html = wrap(`
    ${header(store, 'REÇU HEURES SUPPLÉMENTAIRES', [
      `<strong>${esc(data.workerName)}</strong>`,
      data.role ? `Poste : ${esc(data.role)}` : '',
      `Payé le : ${esc(formatDateTime(data.paidAt))}`,
    ].filter(Boolean))}
    <div class="content">
      <table>
        <thead>
          <tr><th class="center">Date</th><th class="center">Horaire</th><th class="center">Durée</th><th class="right">Taux horaire</th><th class="right">Montant</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><th colspan="2" class="right">Total</th><th class="center">${totalHours.toFixed(2)} h</th><th></th><th class="right">${formatCurrency(data.amount)}</th></tr>
        </tfoot>
      </table>

      <div class="totals">
        <div class="grand"><span>Montant versé</span><strong>${formatCurrency(data.amount)}</strong></div>
      </div>

      <div class="signs">
        <div class="sign">Signature Employé</div>
        <div class="sign">Cachet &amp; Signature Entreprise</div>
      </div>
    </div>`);

  printDocument(html, `Heures_Sup_${data.workerName.replace(/\s+/g, '_')}`);
}
