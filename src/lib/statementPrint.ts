import type { StoreSettings } from '@/types';
import { formatCurrency, formatDate } from './utils';
import {
  printOfficialDocument, versementLine,
  type DocColumn, type DocRow, type DocTable, type DocTotal,
} from './officialDoc';
import type { ClientFiscal } from './documents';

/* ============================================================================
 *  IMPRESSIONS « A LA CARTE » — TOUJOURS SUR LE PAPIER DU BON DE LIVRAISON
 * ----------------------------------------------------------------------------
 *  L'entreprise n'a QU'UN SEUL modele imprime : celui du bon de livraison
 *  (`officialDoc.ts`). En-tete de la societe a gauche, raison sociale au
 *  centre, logo a droite, « <VILLE> LE jj/mm/aaaa », titre souligne, bloc
 *  « DOIT : <tiers> » a gauche et references a droite, tableaux encadres,
 *  totaux accroches aux deux dernieres colonnes, « LE CLIENT » et
 *  « SIGNATURE » en pied.
 *
 *  Ce module rend, sur ce meme papier :
 *
 *   1. `printPartyStatement()` — le COMPTE RENDU d'un client / fournisseur,
 *      dont l'operateur choisit les parties a imprimer (ventes, commandes,
 *      livraisons, versements, anciennes ecritures...) et s'il veut ou non
 *      le detail des PRODUITS, avec ou sans TVA ;
 *
 *   2. `printListDocument()` — n'importe quelle LISTE (une partie d'un
 *      historique, une partie du rapport general) avec sa colonne DATE, sa
 *      colonne DESIGNATION et ses totaux.
 * ========================================================================== */

/** Ligne « marchandise » du compte rendu : designation, quantite, prix, total. */
export interface StatementProductLine {
  designation: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount: number;
}

/** Une partie imprimee du compte rendu (ventes, commandes, versements...). */
export interface StatementSection {
  title?: string;
  columns: DocColumn[];
  rows: DocRow[];
  totals?: DocTotal[];
  emptyLabel?: string;
  note?: string;
}

export interface PartyStatementData {
  kind: 'client' | 'supplier';
  party: ClientFiscal;
  from: string;
  to: string;
  /** Tableau des marchandises — imprime seulement si l'operateur le demande. */
  productLines?: StatementProductLine[];
  productTitle?: string;
  /** Parties cochees dans la liste avant impression. */
  sections?: StatementSection[];
  applyTva?: boolean;
  tvaRate?: number;
  tvaAmount?: number;
  /** VERSEMENT et LE REST du bloc de totaux. */
  paidAmount?: number;
  restAmount?: number;
  /** Detail de chaque versement, repris en bas a gauche du document. */
  versements?: { amount: number; date: string; label?: string }[];
}

const qty = (n: number): string => {
  const v = Math.round((n || 0) * 1000) / 1000;
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
};

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

/**
 * COMPTE RENDU D'UN TIERS — modele du bon de livraison.
 *
 * Le TOTAL est toujours presente HORS TAXES d'abord ; la TVA choisie au moment
 * de l'impression vient ensuite et donne le TOTAL T.T.C. Le bloc de totaux
 * s'accroche aux deux dernieres colonnes du tableau des marchandises, comme sur
 * le bon de livraison ; chaque versement est repris en bas a gauche avec sa
 * date (« VERSEMENT DE 600 000,00 DA LE 09/06/2026 »).
 */
export function printPartyStatement(data: PartyStatementData, store: StoreSettings) {
  const isClient = data.kind === 'client';
  const lines = data.productLines ?? [];
  const ht = lines.reduce((s, l) => s + l.amount, 0);
  const rate = data.tvaRate ?? 19;
  const tva = data.applyTva ? (data.tvaAmount ?? Math.round(ht * rate) / 100) : 0;
  const ttc = ht + tva;
  const paid = data.paidAmount ?? 0;
  const rest = data.restAmount ?? Math.max(0, ttc - paid);

  const totals: DocTotal[] = [{ label: 'Total H.T', value: formatCurrency(ht) }];
  if (data.applyTva) {
    totals.push({ label: `T.V.A ${rate} %`, value: formatCurrency(tva) });
    totals.push({ label: 'Total T.T.C', value: formatCurrency(ttc), strong: true });
  } else {
    totals.push({ label: 'Total', value: formatCurrency(ttc), strong: true });
  }
  totals.push({ label: 'Versement', value: formatCurrency(paid) });
  totals.push({ label: 'Le rest', value: formatCurrency(rest), strong: true });

  const tables: DocTable[] = [];

  if (lines.length > 0) {
    tables.push({
      title: data.productTitle,
      columns: [
        { label: 'Designation', align: 'left' },
        { label: 'Quantite', align: 'center', width: '16%' },
        { label: 'Prix U', align: 'right', width: '20%' },
        { label: 'P.T H.T', align: 'right', width: '22%' },
      ],
      rows: lines.map((l): DocRow => ({
        cells: [
          l.designation.toUpperCase(),
          `${qty(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`,
          formatCurrency(l.unitPrice),
          formatCurrency(l.amount),
        ],
      })),
      totals,
      emptyLabel: 'Aucune marchandise sur la periode',
    });
  }

  (data.sections ?? []).forEach((sec) =>
    tables.push({
      title: sec.title,
      columns: sec.columns,
      rows: sec.rows,
      totals: sec.totals,
      emptyLabel: sec.emptyLabel ?? 'Aucune ecriture sur la periode',
      note: sec.note,
    })
  );

  // Aucune partie cochee : on imprime au moins le bloc de totaux.
  if (tables.length === 0) {
    tables.push({
      columns: [
        { label: 'Designation', align: 'left' },
        { label: 'Quantite', align: 'center', width: '16%' },
        { label: 'Prix U', align: 'right', width: '20%' },
        { label: 'P.T H.T', align: 'right', width: '22%' },
      ],
      rows: [],
      totals,
      emptyLabel: 'Aucune marchandise sur la periode',
    });
  }

  printOfficialDocument(
    {
      title: isClient ? 'COMPTE RENDU CLIENT' : 'COMPTE RENDU FOURNISSEUR',
      docDate: data.to,
      doitLabel: isClient ? 'DOIT' : 'FOURNISSEUR',
      doitName: data.party.name,
      doitLines: fiscalLines(data.party),
      metaLines: [`COMPTE RENDU DU ${formatDate(data.from)} AU ${formatDate(data.to)}`],
      tables,
      footNotes: (data.versements ?? []).map((v) =>
        v.label
          ? `${v.label.toUpperCase()} : ${formatCurrency(v.amount)} LE ${formatDate(v.date)}`
          : versementLine(v.amount, v.date)
      ),
      signatures: [isClient ? 'Le client' : 'Le fournisseur', 'Signature'],
      fileName: `Compte_Rendu_${data.party.name.replace(/\s+/g, '_')}`,
    },
    store
  );
}

/* -------------------------------------------------------------------------- */

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
      docDate: data.docDate || new Date().toISOString().slice(0, 10),
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
