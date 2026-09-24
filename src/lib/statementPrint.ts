import type { StoreSettings } from '@/types';
import { formatCurrency, formatDate, todayISO } from './utils';
import {
  printOfficialDocument,
  type DocColumn, type DocRow, type DocTable, type DocTotal,
} from './officialDoc';
import type { ClientFiscal } from './documents';
import type { LedgerSlice, LedgerCredit, LedgerDebit } from './ledger';

/* ============================================================================
 *  IMPRESSIONS « A LA CARTE » — TOUJOURS SUR LE PAPIER DU BON DE LIVRAISON
 * ----------------------------------------------------------------------------
 *  L'entreprise n'a QU'UN SEUL modele imprime : celui du bon de livraison
 *  (`officialDoc.ts`). Ce module rend, sur ce meme papier :
 *
 *   1. `printPartyStatement()` — le COMPTE RENDU d'un client / fournisseur et
 *      le BON DE LIVRAISON d'une periode, sur le modele demande :
 *
 *        · UN SEUL tableau des operations, de la plus ANCIENNE a la plus
 *          RECENTE — nouvelles ET anciennes livraisons (ou achats) melees ;
 *        · au pied de ce tableau, AU-DESSUS du total : les anciennes dettes
 *          (chacune avec sa date) et, si l'operateur l'accepte, la dette
 *          anterieure a la periode ;
 *        · puis TOTAL, TOTAL VERSEMENTS et RESTE ;
 *        · les versements ne forment plus un tableau : ils sont LISTES a la fin
 *          du document, chacun avec sa date ;
 *        · le tableau des marchandises n'apparait que si l'operateur le coche.
 *
 *   2. `printListDocument()` — n'importe quelle LISTE (une partie d'un
 *      historique, une partie du rapport general) avec ses totaux.
 * ========================================================================== */

export type StatementTvaMode = 'documents' | 'none' | 'forced';

export interface StatementPrintOptions {
  kind: 'client' | 'supplier';
  /** Compte rendu, ou bon de livraison d'une periode (livraisons seules). */
  mode: 'statement' | 'deliveries';
  party: ClientFiscal;
  /** Releve deja filtre sur les types d'operations choisis. */
  slice: LedgerSlice;
  /** Lignes « ancienne dette » de la periode, au-dessus du total. */
  includeOldDebts: boolean;
  /** Ligne « dette anterieure a la periode », au-dessus du total. */
  includePrior: boolean;
  /** TOTAL VERSEMENTS / RESTE et liste des versements en fin de document. */
  includeVersements: boolean;
  /** Tableau recapitulatif des marchandises. */
  includeProducts: boolean;
  tvaMode: StatementTvaMode;
  tvaRate: number;
  /** Tableaux d'information (commandes en cours, annulations...). */
  extraTables?: DocTable[];
  /** Titre choisi a l'impression (sinon le titre par defaut). */
  docTitle?: string;
  /** Texte choisi devant les dates de la periode (sinon celui par defaut). */
  periodPrefix?: string;
  /** Texte libre imprime a la fin du document. */
  endText?: string;
}

/** Titre par defaut d'un compte rendu / bon de livraison de periode. */
export function defaultStatementTitle(kind: 'client' | 'supplier', mode: 'statement' | 'deliveries'): string {
  if (mode === 'deliveries') return 'BON DE LIVRAISON';
  return kind === 'client' ? 'COMPTE RENDU CLIENT' : 'COMPTE RENDU FOURNISSEUR';
}

/** Texte par defaut devant les dates : « COMPTE RENDU » DU ... AU ... */
export function defaultStatementPeriodPrefix(mode: 'statement' | 'deliveries'): string {
  return mode === 'deliveries' ? 'LIVRAISON' : 'COMPTE RENDU';
}

/** « DU 01/09/2026 AU 25/09/2026 » */
export function periodSuffix(from: string, to: string): string {
  return `DU ${formatDate(from)} AU ${formatDate(to)}`;
}

const qty = (n: number): string => {
  const v = Math.round((n || 0) * 1000) / 1000;
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
};
const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

function fiscalLines(c: ClientFiscal): string[] {
  return [
    c.address ? `ADRESSE : ${c.address}` : '',
    c.rc ? `R.C N : ${c.rc}` : '',
    c.nif ? `NIF : ${c.nif}` : '',
    c.nis ? `NIS : ${c.nis}` : '',
    c.article ? `N ARTICLE : ${c.article}` : '',
    c.phone ? `TEL : ${c.phone}` : '',
  ].filter(Boolean);
}

/** La veille d'une date `YYYY-MM-DD`. */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Operations du tableau principal (hors anciennes dettes). */
export function mainDebits(slice: LedgerSlice): LedgerDebit[] {
  return slice.debits.filter((d) => d.kind !== 'oldDebt');
}

/** Totaux du document — partages par l'apercu de la fenetre et l'impression. */
export function statementTotals(o: Pick<StatementPrintOptions,
  'slice' | 'includeOldDebts' | 'includePrior' | 'includeVersements' | 'tvaMode' | 'tvaRate'>) {
  const main = mainDebits(o.slice);
  const ht = r2(main.reduce((s, d) => s + d.ht, 0));
  const docTva = r2(main.reduce((s, d) => s + d.tva, 0));
  const tva = o.tvaMode === 'none' ? 0 : o.tvaMode === 'forced' ? r2((ht * (o.tvaRate || 0)) / 100) : docTva;
  const ttc = r2(ht + tva);
  const oldDebts = o.includeOldDebts ? o.slice.debits.filter((d) => d.kind === 'oldDebt') : [];
  const oldDebtsTotal = r2(oldDebts.reduce((s, d) => s + d.amount, 0));
  const prior = o.includePrior ? o.slice.priorBalance : 0;
  const total = r2(ttc + oldDebtsTotal + prior);
  const versements = o.includeVersements ? o.slice.totalCredits : 0;
  const rest = r2(total - versements);
  const rates = [...new Set(main.filter((d) => d.tvaEnabled && d.tva > 0).map((d) => d.tvaRate ?? 0))];
  return { ht, tva, ttc, oldDebts, oldDebtsTotal, prior, total, versements, rest, rates };
}

/** Liste imprimee en fin de document : les versements directs uniquement. */
export function versementsOnly(credits: LedgerCredit[]): LedgerCredit[] {
  return credits.filter((c) => c.kind === 'payment');
}

/** « VERSEMENT DE 600 000,00 DA LE 09/06/2026 » et variantes. */
export function creditLine(c: LedgerCredit): string {
  const when = formatDate(c.date);
  if (c.kind === 'payment') {
    const mode = c.method && c.method !== 'Espèces' ? ` (${c.method.toUpperCase()})` : '';
    return `VERSEMENT DE ${formatCurrency(c.amount)} LE ${when}${mode}`;
  }
  if (c.kind === 'refund') {
    return `${c.label.toUpperCase()} : − ${formatCurrency(-c.amount)} LE ${when}`;
  }
  return `${c.label.toUpperCase()} : ${formatCurrency(c.amount)} LE ${when}`;
}

/**
 * COMPTE RENDU D'UN TIERS / BON DE LIVRAISON D'UNE PERIODE.
 */
export function printPartyStatement(o: StatementPrintOptions, store: StoreSettings) {
  const isClient = o.kind === 'client';
  const { slice } = o;
  const t = statementTotals(o);
  const main = mainDebits(slice);

  /* ---- le tableau des operations --------------------------------------- */
  let columns: DocColumn[];
  const rows: DocRow[] = [];

  if (isClient) {
    columns = [
      { label: 'Date', align: 'center', width: '12%' },
      { label: 'Designation', align: 'left' },
      { label: 'Adresse de livraison', align: 'left', width: '20%' },
      { label: 'Quantite', align: 'center', width: '11%' },
      { label: 'Prix U', align: 'right', width: '15%' },
      { label: 'P.T H.T', align: 'right', width: '17%' },
    ];
    main.forEach((d) => {
      const where = (d.location || (d.kind === 'sale' ? 'VENTE COMPTOIR' : '') || '/').toUpperCase();
      if (!d.lines.length) {
        rows.push({ cells: [formatDate(d.date), d.label.toUpperCase(), where, '', '', formatCurrency(d.ht)] });
        return;
      }
      d.lines.forEach((l) =>
        rows.push({
          cells: [
            formatDate(d.date),
            `${l.designation.toUpperCase()}${d.historical ? ' (ANCIENNE)' : ''}`,
            where,
            `${qty(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`,
            formatCurrency(l.unitPrice),
            formatCurrency(l.amount),
          ],
        })
      );
    });
  } else {
    // Fournisseur : colonnes « N de bon » et « Matricule » demandees.
    columns = [
      { label: 'Date', align: 'center', width: '11%' },
      { label: 'N de bon', align: 'center', width: '12%' },
      { label: 'Matricule', align: 'center', width: '13%' },
      { label: 'Designation', align: 'left' },
      { label: 'Quantite', align: 'center', width: '10%' },
      { label: 'Prix U', align: 'right', width: '13%' },
      { label: 'Montant', align: 'right', width: '15%' },
    ];
    main.forEach((d) => {
      const bon = (d.bonNumber || '/').toUpperCase();
      const plate = (d.driverPlate || '/').toUpperCase();
      if (!d.lines.length) {
        rows.push({ cells: [formatDate(d.date), bon, plate, d.label.toUpperCase(), '', '', formatCurrency(d.ht)] });
        return;
      }
      d.lines.forEach((l) =>
        rows.push({
          cells: [
            formatDate(d.date), bon, plate,
            `${l.designation.toUpperCase()}${d.historical ? ' (ANCIEN ACHAT)' : ''}`,
            `${qty(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`,
            formatCurrency(l.unitPrice),
            formatCurrency(l.amount),
          ],
        })
      );
    });
  }

  /* ---- le bloc de totaux (accroche aux deux dernieres colonnes) --------- */
  const totals: DocTotal[] = [];
  const showTva = t.tva > 0.004;
  if (showTva) {
    const rateLabel = o.tvaMode === 'forced'
      ? ` ${o.tvaRate} %`
      : t.rates.length === 1 ? ` ${t.rates[0]} %` : '';
    totals.push({ label: 'Total H.T', value: formatCurrency(t.ht) });
    totals.push({ label: `T.V.A${rateLabel}`, value: formatCurrency(t.tva) });
    totals.push({ label: 'Total T.T.C', value: formatCurrency(t.ttc) });
  } else if (t.oldDebts.length || (o.includePrior && Math.abs(t.prior) > 0.004)) {
    totals.push({ label: isClient ? 'Total des operations' : 'Total des achats', value: formatCurrency(t.ttc) });
  }
  // Anciennes dettes : AU-DESSUS du total, chacune avec sa date.
  t.oldDebts.forEach((d) =>
    totals.push({
      label: `Ancienne dette du ${formatDate(d.date)}${d.description ? ` — ${d.description}` : ''}`,
      value: formatCurrency(d.amount),
    })
  );
  // Dette (ou acompte) anterieure a la periode.
  if (o.includePrior && Math.abs(t.prior) > 0.004) {
    const until = formatDate(dayBefore(slice.from));
    totals.push(
      t.prior > 0
        ? { label: `Dette anterieure au ${until}`, value: formatCurrency(t.prior) }
        : { label: `Acompte anterieur au ${until}`, value: `− ${formatCurrency(-t.prior)}` }
    );
  }
  const hasExtraRows = showTva || t.oldDebts.length > 0 || (o.includePrior && Math.abs(t.prior) > 0.004);
  totals.push({ label: hasExtraRows ? 'Total general' : 'Total', value: formatCurrency(t.total), strong: true });
  if (o.includeVersements) {
    totals.push({ label: 'Total versements', value: formatCurrency(t.versements) });
    totals.push(
      t.rest >= -0.004
        ? { label: 'Reste a payer', value: formatCurrency(Math.max(0, t.rest)), strong: true }
        : {
            label: isClient ? 'Solde en faveur du client' : 'Trop-verse au fournisseur',
            value: formatCurrency(-t.rest),
            strong: true,
          }
    );
  }

  const tables: DocTable[] = [
    {
      title: o.mode === 'deliveries'
        ? undefined
        : isClient ? 'Operations de la periode' : 'Achats de la periode',
      columns,
      rows,
      totals,
      totalsLabelSpan: 3,
      emptyLabel: isClient ? 'Aucune livraison ni vente sur la periode' : 'Aucun achat sur la periode',
    },
  ];

  /* ---- marchandises (optionnel) ----------------------------------------- */
  if (o.includeProducts) {
    const grouped = new Map<string, { name: string; unit?: string; qty: number; price: number; amount: number }>();
    main.forEach((d) =>
      d.lines.forEach((l) => {
        const key = `${l.designation.toLowerCase()}|${l.unit ?? ''}|${l.unitPrice}`;
        const cur = grouped.get(key) ?? { name: l.designation, unit: l.unit, qty: 0, price: l.unitPrice, amount: 0 };
        cur.qty += l.quantity;
        cur.amount += l.amount;
        grouped.set(key, cur);
      })
    );
    const list = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    tables.push({
      title: isClient ? 'Marchandises de la periode' : 'Marchandises recues sur la periode',
      columns: [
        { label: 'Designation', align: 'left' },
        { label: 'Quantite', align: 'center', width: '16%' },
        { label: 'Prix U', align: 'right', width: '20%' },
        { label: 'P.T H.T', align: 'right', width: '22%' },
      ],
      rows: list.map((p) => ({
        cells: [
          p.name.toUpperCase(),
          `${qty(p.qty)}${p.unit ? ` ${p.unit}` : ''}`,
          formatCurrency(p.price),
          formatCurrency(r2(p.amount)),
        ],
      })),
      totals: [{ label: 'Total marchandises', value: formatCurrency(r2(list.reduce((s, p) => s + p.amount, 0))), strong: true }],
      emptyLabel: 'Aucune marchandise sur la periode',
    });
  }

  (o.extraTables ?? []).forEach((x) => tables.push(x));

  const docTitle = (o.docTitle?.trim() || defaultStatementTitle(o.kind, o.mode)).toUpperCase();
  const prefix = (o.periodPrefix?.trim() || defaultStatementPeriodPrefix(o.mode)).toUpperCase();
  printOfficialDocument(
    {
      title: docTitle,
      docDate: slice.to,
      doitLabel: isClient ? 'DOIT' : 'FOURNISSEUR',
      doitName: o.party.name,
      doitLines: fiscalLines(o.party),
      metaLines: [`${prefix} ${periodSuffix(slice.from, slice.to)}`],
      tables,
      // Les versements ne forment plus un tableau : ils sont LISTES en fin de
      // document, chacun avec sa date. Seuls les VERSEMENTS du tiers y
      // figurent — les reglements de commande / de facture n'y sont plus
      // detailles (ils restent compris dans « Total versements »).
      footNotes: o.includeVersements
        ? versementsOnly(slice.credits)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(creditLine)
        : [],
      endText: o.endText,
      signatures: [isClient ? 'Le client' : 'Le fournisseur', 'Signature'],
      fileName: `${o.mode === 'deliveries' ? 'Livraisons' : 'Compte_Rendu'}_${o.party.name.replace(/\s+/g, '_')}`,
    },
    store
  );
}

/* -------------------------------------------------------------------------- */

/** Une partie imprimee d'une liste (historique, rapport general). */
export interface StatementSection {
  title?: string;
  columns: DocColumn[];
  rows: DocRow[];
  totals?: DocTotal[];
  emptyLabel?: string;
  note?: string;
}

export interface ListDocumentData {
  title: string;
  docDate?: string;
  partyLabel?: string;
  partyName?: string;
  partyLines?: string[];
  metaLines?: string[];
  tables: StatementSection[];
  footNotes?: string[];
  signatures?: string[];
  fileName: string;
  /** Texte libre imprime a la fin du document. */
  endText?: string;
}

/**
 * Impression d'UNE LISTE sur le papier du bon de livraison.
 * Sert aux boutons « Imprimer la liste » de l'historique d'un tiers et aux
 * boutons « Imprimer cette partie » du rapport general.
 */
export function printListDocument(data: ListDocumentData, store: StoreSettings) {
  printOfficialDocument(
    {
      title: data.title.toUpperCase(),
      docDate: data.docDate || todayISO(),
      doitLabel: data.partyLabel,
      doitName: data.partyName,
      doitLines: data.partyLines,
      metaLines: data.metaLines,
      tables: data.tables.map((t): DocTable => ({
        title: t.title,
        columns: t.columns,
        rows: t.rows,
        totals: t.totals,
        emptyLabel: t.emptyLabel ?? 'Aucune ligne sur la periode',
        note: t.note,
      })),
      footNotes: data.footNotes,
      endText: data.endText,
      signatures: data.signatures ?? ['Le responsable', 'Signature'],
      fileName: data.fileName,
    },
    store
  );
}

/** Ligne de total d'un tableau imprime : libelle a gauche, montant a droite. */
export function totalDocRow(label: string, value: string): DocRow {
  return { cells: [label.toUpperCase(), value], span: true, variant: 'subtotal' };
}
