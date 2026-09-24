import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FileBarChart, Printer, ShoppingBag, Coins, ClipboardList, RotateCcw, Package,
  PiggyBank, Truck, ScissorsSquare, LayoutGrid, BookOpenText,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PeriodPicker, firstDayOfMonth } from './PeriodReport';
import {
  StatementPrintDialog, type StatementPrintChoice, type StatementPrintPart,
} from './StatementPrintDialog';
import { PriorDebtDialog } from './PriorDebtDialog';
import { useSalesStore } from '@/store/salesStore';
import { useClientStore } from '@/store/clientStore';
import { useCommandStore, deliveryStatus } from '@/store/commandStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { commandTtc } from '@/lib/commandBilling';
import { clientAccountOf } from '@/lib/accounts';
import { withinPeriod } from '@/lib/partyHistory';
import {
  buildClientLedger, sliceLedger, ledgerRows, type DebitKind, type LedgerSlice,
} from '@/lib/ledger';
import {
  printPartyStatement, statementTotals, dayBefore,
  defaultStatementTitle, defaultStatementPeriodPrefix, periodSuffix,
} from '@/lib/statementPrint';
import type { DocTable } from '@/lib/officialDoc';
import { panelVariants, EASE } from '@/lib/animations';
import { cn } from '@/lib/utils';
import type { Client } from '@/types';

/* ============================================================================
 *  COMPTE RENDU D'UN CLIENT SUR UNE PERIODE
 * ----------------------------------------------------------------------------
 *  Tout part du RELEVE du client (`buildClientLedger`) : chaque livraison,
 *  vente et ancienne dette a sa date, chaque encaissement aussi. Le compte
 *  rendu affiche et le compte rendu imprime tombent donc toujours juste :
 *
 *      TOTAL − TOTAL VERSEMENTS = RESTE   (+ dette anterieure si demandee)
 *
 *  · les livraisons NOUVELLES et ANCIENNES forment un seul tableau ;
 *  · tout est range de la plus ANCIENNE a la plus RECENTE date ;
 *  · les versements sont listes en fin de document, pas en tableau ;
 *  · le tableau des marchandises est facultatif ;
 *  · une dette anterieure a la periode est signalee avant l'impression.
 *
 *  Le bouton « Bon de livraisons (periode) » imprime exactement le meme
 *  modele, limite aux bons de livraison de la periode.
 * ========================================================================== */

type PartKey = 'releve' | 'deliveries' | 'sales' | 'versements' | 'commands' | 'oldDebts' | 'adjustments' | 'products';
type PrintMode = 'statement' | 'deliveries';

const creditKindLabel: Record<string, string> = {
  payment: 'Versement direct',
  docPayment: 'Encaissement facture',
  advance: 'Acompte commande',
  commandPayment: 'Reglement commande',
  refund: 'Excedent rendu',
};

export function ClientStatementModal({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { language } = useLanguage();
  const sales = useSalesStore((s) => s.sales);
  const payments = useClientStore((s) => s.payments);
  const clientRows = useClientStore((s) => s.clients);
  const oldDebts = useClientStore((s) => s.oldDebts);
  const refunds = useClientStore((s) => s.refunds);
  const commands = useCommandStore((s) => s.commands);
  const deliveries = useCommandStore((s) => s.deliveries);
  const adjustments = useCommandStore((s) => s.adjustments);
  const settings = useSettingsStore((s) => s.settings);

  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(todayISO());
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [part, setPart] = useState<PartKey>('releve');
  const [printMode, setPrintMode] = useState<PrintMode | null>(null);
  const [priorAsk, setPriorAsk] = useState<
    { mode: PrintMode; choice: StatementPrintChoice; slice: LedgerSlice } | null
  >(null);

  useEffect(() => {
    if (!client) return;
    setFrom(firstDayOfMonth());
    setTo(todayISO());
    setPeriod(null);
    setPart('releve');
    setPrintMode(null);
    setPriorAsk(null);
  }, [client?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------------------- donnees -- */
  const data = useMemo(() => {
    if (!client || !period) return null;
    const { from: f, to: t } = period;
    const ledger = buildClientLedger({
      clientId: client.id, sales, commands, deliveries, payments, refunds, oldDebts,
    });
    const all = sliceLedger(ledger, f, t, { debitKinds: ['delivery', 'sale', 'oldDebt'], includeCommandMoney: true });

    const deliveriesList = all.debits.filter((d) => d.kind === 'delivery');
    const salesList = all.debits.filter((d) => d.kind === 'sale');
    const oldDebtsList = all.debits.filter((d) => d.kind === 'oldDebt');

    const myCommands = commands.filter((c) => c.clientId === client.id);
    const commandsList = myCommands
      .filter((c) => withinPeriod(c.createdAt, f, t) || withinPeriod(c.receiveDate, f, t))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const cmdIds = new Set(myCommands.map((c) => c.id));
    const adjustmentsList = adjustments
      .filter((a) => cmdIds.has(a.commandId) && withinPeriod(a.date, f, t))
      .sort((a, b) => a.date.localeCompare(b.date));

    // commandes qui attendent encore une livraison (information)
    const pendingLines = myCommands
      .filter((c) => c.status !== 'cancelled' && c.createdAt.slice(0, 10) <= t)
      .flatMap((c) =>
        c.items
          .map((it) => ({
            cmd: c, it,
            left: Math.max(0, it.quantity - (it.deliveredQuantity ?? 0) - (it.cancelledQuantity ?? 0)),
          }))
          .filter((x) => x.left > 0.0001)
      )
      .sort((a, b) => a.cmd.createdAt.localeCompare(b.cmd.createdAt));

    // marchandises livrees / vendues sur la periode
    const grouped = new Map<string, { key: string; name: string; unit?: string; quantity: number; unitPrice: number; amount: number }>();
    [...deliveriesList, ...salesList].forEach((d) =>
      d.lines.forEach((l) => {
        const key = `${l.designation.toLowerCase()}|${l.unit ?? ''}|${l.unitPrice}`;
        const cur = grouped.get(key) ?? { key, name: l.designation, unit: l.unit, quantity: 0, unitPrice: l.unitPrice, amount: 0 };
        cur.quantity += l.quantity;
        cur.amount += l.amount;
        grouped.set(key, cur);
      })
    );
    const products = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    const account = clientAccountOf(client.id, { clients: clientRows, sales, commands, deliveries, oldDebts });
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

    return {
      ledger, all, deliveriesList, salesList, oldDebtsList, commandsList, adjustmentsList,
      pendingLines, products, account,
      rows: ledgerRows(all, all.priorBalance),
      deliveriesTotal: sum(deliveriesList.map((d) => d.amount)),
      salesTotal: sum(salesList.map((d) => d.amount)),
      oldDebtsTotal: sum(oldDebtsList.map((d) => d.amount)),
    };
  }, [client, period, sales, commands, deliveries, payments, oldDebts, refunds, clientRows, adjustments]);

  const periodLabel = period
    ? `Du ${formatDate(period.from, language)} au ${formatDate(period.to, language)}`
    : '';

  /* ------------------------------------------------------- l'impression -- */
  const kindsOf = (mode: PrintMode, c: StatementPrintChoice): DebitKind[] => {
    const kinds: DebitKind[] = [];
    if (mode === 'deliveries' || c.deliveries) kinds.push('delivery');
    if (mode === 'statement' && c.sales) kinds.push('sale');
    if (c.oldDebts) kinds.push('oldDebt');
    return kinds;
  };

  const sliceFor = (mode: PrintMode, c: StatementPrintChoice): LedgerSlice | null => {
    if (!data || !period) return null;
    const kinds = kindsOf(mode, c);
    return sliceLedger(data.ledger, period.from, period.to, {
      debitKinds: kinds,
      includeCommandMoney: kinds.includes('delivery'),
    });
  };

  const extraTables = (c: StatementPrintChoice): DocTable[] => {
    if (!data) return [];
    const tables: DocTable[] = [];
    if (c.pendingCommands && data.pendingLines.length) {
      tables.push({
        title: 'Commandes en cours (reste a livrer)',
        columns: [
          { label: 'Date', align: 'center', width: '12%' },
          { label: 'Designation', align: 'left' },
          { label: 'Commande', align: 'center', width: '12%' },
          { label: 'Livre', align: 'center', width: '10%' },
          { label: 'Reste', align: 'center', width: '10%' },
          { label: 'Valeur restante', align: 'right', width: '18%' },
        ],
        rows: data.pendingLines.map(({ cmd, it, left }) => ({
          cells: [
            formatDate(cmd.createdAt.slice(0, 10)),
            `${it.productName.toUpperCase()} — ${cmd.reference}`,
            it.quantity, it.deliveredQuantity ?? 0, left,
            formatCurrency(left * it.unitPrice),
          ],
        })),
        emptyLabel: 'Aucune commande en attente',
      });
    }
    if (c.adjustments && data.adjustmentsList.length) {
      tables.push({
        title: 'Annulations et augmentations de commande',
        columns: [
          { label: 'Date', align: 'center', width: '12%' },
          { label: 'Designation', align: 'left' },
          { label: 'Operation', align: 'center', width: '16%' },
          { label: 'Quantite', align: 'center', width: '11%' },
          { label: 'Valeur H.T', align: 'right', width: '18%' },
        ],
        rows: data.adjustmentsList.map((a) => ({
          cells: [
            formatDate(a.date),
            `${a.commandReference ?? 'COMMANDE'} — ${a.lines.map((l) => l.productName).join(', ').toUpperCase()}`,
            a.type === 'cancel' ? 'ANNULATION' : 'AUGMENTATION',
            `${a.type === 'cancel' ? '-' : '+'}${a.totalQuantity}`,
            `${a.type === 'cancel' ? '-' : '+'}${formatCurrency(a.totalAmount)}`,
          ],
        })),
      });
    }
    return tables;
  };

  const runPrint = (mode: PrintMode, c: StatementPrintChoice, slice: LedgerSlice, includePrior: boolean) => {
    if (!client) return;
    printPartyStatement(
      {
        kind: 'client',
        mode,
        party: {
          name: client.name, phone: client.phone, address: client.address,
          rc: client.rc, nif: client.nif, nis: client.nis, article: client.article,
        },
        slice,
        includeOldDebts: c.oldDebts,
        includePrior,
        includeVersements: c.versements,
        includeProducts: c.products,
        tvaMode: c.tvaMode,
        tvaRate: c.tvaRate,
        extraTables: extraTables(c),
        docTitle: c.docTitle,
        periodPrefix: c.periodPrefix,
      },
      settings
    );
  };

  const onPrintChoice = (c: StatementPrintChoice) => {
    const mode = printMode ?? 'statement';
    setPrintMode(null);
    const slice = sliceFor(mode, c);
    if (!slice) return;
    // Une dette anterieure a la periode ? On demande avant d'imprimer.
    if (c.oldDebts && Math.abs(slice.priorBalance) > 0.004) {
      setPriorAsk({ mode, choice: c, slice });
      return;
    }
    runPrint(mode, c, slice, false);
  };

  const previewOf = (mode: PrintMode) => (c: StatementPrintChoice) => {
    const slice = sliceFor(mode, c);
    if (!slice) return { ht: 0, tva: 0, total: 0, versements: 0, rest: 0 };
    const t = statementTotals({
      slice, includeOldDebts: c.oldDebts, includePrior: false,
      includeVersements: c.versements, tvaMode: c.tvaMode, tvaRate: c.tvaRate,
    });
    return { ht: t.ht, tva: t.tva, total: t.total, versements: t.versements, rest: t.rest };
  };

  const printParts = (mode: PrintMode): StatementPrintPart[] => {
    if (!data) return [];
    const priorNote = Math.abs(data.all.priorBalance) > 0.004
      ? ` Dette antérieure au ${formatDate(dayBefore(data.all.from))} : ${formatCurrency(data.all.priorBalance)} (proposée avant l'impression).`
      : '';
    const list: StatementPrintPart[] = [
      {
        key: 'deliveries', group: 'table', label: 'Bons de livraison', locked: mode === 'deliveries',
        hint: 'Nouveaux et anciens, dans le même tableau',
        count: data.deliveriesList.length, total: formatCurrency(data.deliveriesTotal),
      },
    ];
    if (mode === 'statement') {
      list.push({
        key: 'sales', group: 'table', label: 'Ventes de caisse', hint: 'Anciennes ventes comprises',
        count: data.salesList.length, total: formatCurrency(data.salesTotal),
      });
    }
    list.push(
      {
        key: 'oldDebts', group: 'foot', label: 'Anciennes dettes / dette antérieure',
        hint: `Au-dessus du total, avec leur date.${priorNote}`,
        count: data.oldDebtsList.length + (Math.abs(data.all.priorBalance) > 0.004 ? 1 : 0),
        total: data.oldDebtsList.length ? formatCurrency(data.oldDebtsTotal) : undefined,
        defaultChecked: data.oldDebtsList.length > 0 || Math.abs(data.all.priorBalance) > 0.004,
      },
      {
        key: 'versements', group: 'foot', label: 'Versements',
        hint: 'Total versements, reste, et liste datée en fin de document',
        count: data.all.credits.length, total: formatCurrency(data.all.totalCredits),
        defaultChecked: true,
      },
      {
        key: 'products', group: 'extra', label: 'Tableau des marchandises',
        hint: 'Récapitulatif par produit et par prix',
        count: data.products.length, defaultChecked: false,
      },
      {
        key: 'pendingCommands', group: 'extra', label: 'Commandes en cours',
        hint: 'Reste à livrer (information, pas une dette)',
        count: data.pendingLines.length, defaultChecked: false,
      },
      {
        key: 'adjustments', group: 'extra', label: 'Annulations / augmentations',
        count: data.adjustmentsList.length, defaultChecked: false,
      },
    );
    return list;
  };

  /* ------------------------------------------------------------ rendu ---- */
  const parts: { key: PartKey; label: string; icon: JSX.Element; count: number }[] = data
    ? [
        { key: 'releve', label: 'Relevé', icon: <BookOpenText size={14} />, count: data.rows.length },
        { key: 'deliveries', label: 'Livraisons', icon: <Truck size={14} />, count: data.deliveriesList.length },
        { key: 'sales', label: 'Ventes caisse', icon: <ShoppingBag size={14} />, count: data.salesList.length },
        { key: 'versements', label: 'Versements', icon: <Coins size={14} />, count: data.all.credits.length },
        { key: 'commands', label: 'Commandes', icon: <ClipboardList size={14} />, count: data.commandsList.length },
        { key: 'oldDebts', label: 'Anciennes dettes', icon: <PiggyBank size={14} />, count: data.oldDebtsList.length },
        { key: 'adjustments', label: 'Annulations / augm.', icon: <ScissorsSquare size={14} />, count: data.adjustmentsList.length },
        { key: 'products', label: 'Produits', icon: <Package size={14} />, count: data.products.length },
      ]
    : [];

  const money = formatCurrency;

  return (
    <Modal open={!!client} onClose={onClose} title={`Compte rendu — ${client?.name ?? ''}`} size="xl">
      {client && (
        <div className="space-y-5">
          <PeriodPicker
            from={from}
            to={to}
            onChange={(f, t) => { setFrom(f); setTo(t); setPeriod(null); }}
            onGenerate={() => setPeriod({ from, to })}
          />

          {!data ? (
            <div className="rounded-2xl border border-dashed border-gold/25 bg-vanilla/20 py-10 text-center">
              <FileBarChart size={34} className="mx-auto mb-3 text-gold opacity-60" />
              <p className="text-sm text-text-muted">
                Choisissez une date de début et une date de fin, puis générez le compte rendu.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* ---------------------------------------------- en-tete ---- */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-display text-base font-semibold text-text-primary">{client.name}</p>
                  <p className="text-xs text-text-muted">{periodLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPeriod(null)}>
                    <RotateCcw size={14} /> Changer la période
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setPrintMode('deliveries')}>
                    <Truck size={14} /> Bon de livraisons (période)
                  </Button>
                  <Button size="sm" variant="gold" onClick={() => setPrintMode('statement')}>
                    <Printer size={14} /> Imprimer le compte rendu
                  </Button>
                </div>
              </div>

              {(data.account.credit + data.account.advance) > 0.004 && (
                <div className="flex items-start gap-3 rounded-2xl border border-pistachio/40 bg-pistachio/10 px-4 py-3">
                  <PiggyBank size={20} className="mt-0.5 shrink-0 text-pistachio" />
                  <div>
                    <p className="text-sm font-bold text-pistachio">
                      Acompte disponible : {money(data.account.credit + data.account.advance)}
                      {data.account.hasCredit && ` · solde en faveur du client : + ${money(data.account.creditToReturn)}`}
                    </p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {client.name} a versé plus que sa dette : cet acompte paiera ses prochaines commandes, ventes et
                      livraisons (il est proposé à leur création).
                    </p>
                  </div>
                </div>
              )}

              {/* ------------------------------------------- synthèse ------ */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                <Kpi
                  label={`Dette antérieure au ${formatDate(dayBefore(data.all.from), language)}`}
                  value={money(data.all.priorBalance)}
                  tone={data.all.priorBalance > 0 ? 'neg' : 'pos'}
                />
                <Kpi label="Opérations (période)" value={money(data.all.totalDebits)} tone="accent" />
                <Kpi label="Versements (période)" value={money(data.all.totalCredits)} tone="pos" />
                <Kpi label="Reste (période)" value={money(data.all.rest)} tone={data.all.rest > 0 ? 'neg' : 'pos'} />
                <Kpi
                  label={`Solde au ${formatDate(data.all.to, language)}`}
                  value={money(data.all.closingBalance)}
                  tone={data.all.closingBalance > 0 ? 'neg' : 'pos'}
                />
                <Kpi label="Commandes non livrées" value={money(data.account.pendingCommands)} />
              </div>

              {/* --------------------------------------- barre des parties -- */}
              <div className="flex gap-1 overflow-x-auto rounded-2xl border border-gold/15 bg-vanilla/30 p-1.5">
                {parts.map((p) => {
                  const on = p.key === part;
                  return (
                    <button
                      key={p.key}
                      onClick={() => setPart(p.key)}
                      className={cn(
                        'relative flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-colors',
                        on ? 'text-white' : 'text-text-secondary hover:bg-gold/10 hover:text-text-primary'
                      )}
                    >
                      {on && (
                        <motion.span
                          layoutId="statement-part"
                          transition={{ duration: 0.18, ease: EASE }}
                          className="absolute inset-0 rounded-xl bg-gradient-button shadow-gold"
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-1.5">
                        {p.icon}{p.label}
                        <span className={cn(
                          'rounded-full px-1.5 text-[10px] font-bold tabular',
                          on ? 'bg-white/25 text-white' : 'bg-gold/15 text-gold-dark'
                        )}>
                          {p.count}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* ------------------------------------------- la partie ----- */}
              <AnimatePresence mode="wait">
                <motion.div key={part} variants={panelVariants} initial="hidden" animate="visible" exit="exit">
                  {part === 'releve' && (
                    <Section
                      title="Relevé du compte (de la plus ancienne à la plus récente opération)"
                      note="Chaque livraison, vente et ancienne dette augmente le solde ; chaque versement le diminue. Le dernier solde est celui du compte à la fin de la période."
                      head={['Date', 'Opération', 'Détail', 'Débit', 'Crédit', 'Solde']}
                      lead={[
                        formatDate(data.all.from, language), 'Solde antérieur', '—', '', '',
                        <span key="s" className="font-bold">{money(data.all.priorBalance)}</span>,
                      ]}
                      rows={data.rows.map((r) => [
                        formatDate(r.date, language),
                        <span key="l" className="font-semibold">{r.label}</span>,
                        <span key="d" className="text-text-muted">{r.detail || '—'}</span>,
                        r.debit ? <span key="db" className="text-rose-deep">{money(r.debit)}</span> : '',
                        r.credit ? <span key="cr" className="text-pistachio">{money(r.credit)}</span> : '',
                        <span key="b" className={r.balance > 0 ? 'font-bold text-rose-deep' : 'font-bold text-pistachio'}>
                          {money(r.balance)}
                        </span>,
                      ])}
                      foot={[
                        'Totaux de la période', '', '',
                        money(data.all.totalDebits), money(data.all.totalCredits), money(data.all.closingBalance),
                      ]}
                      empty="Aucune opération sur cette période"
                    />
                  )}

                  {part === 'deliveries' && (
                    <Section
                      title="Bons de livraison de la période (nouveaux et anciens)"
                      head={['Date', 'N° BL', 'Désignation', 'Adresse', 'Quantité', 'H.T', 'T.T.C', 'Reste aujourd’hui']}
                      rows={data.deliveriesList.map((d) => [
                        formatDate(d.date, language),
                        <span key="r" className="font-semibold">
                          {d.reference}
                          {d.historical && <Badge variant="warning" className="ml-1 text-[9px]">Ancienne</Badge>}
                        </span>,
                        d.lines.map((l) => l.designation).join(', ') || '—',
                        d.location || '—',
                        d.lines.reduce((s, l) => s + l.quantity, 0),
                        money(d.ht),
                        money(d.amount),
                        <span key="x" className={d.restNow > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>{money(d.restNow)}</span>,
                      ])}
                      total={money(data.deliveriesTotal)}
                      empty="Aucune livraison sur cette période"
                    />
                  )}

                  {part === 'sales' && (
                    <Section
                      title="Ventes de caisse de la période"
                      head={['Date', 'N° facture', 'Désignation', 'Quantité', 'TVA', 'Total', 'Reste aujourd’hui']}
                      rows={data.salesList.map((d) => [
                        formatDate(d.date, language),
                        <span key="r" className="font-semibold">
                          {d.reference}
                          {d.historical && <Badge variant="warning" className="ml-1 text-[9px]">Ancienne</Badge>}
                        </span>,
                        d.lines.map((l) => l.designation).join(', ') || '—',
                        d.lines.reduce((s, l) => s + l.quantity, 0),
                        d.tva ? money(d.tva) : '—',
                        money(d.amount),
                        <span key="x" className={d.restNow > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>{money(d.restNow)}</span>,
                      ])}
                      total={money(data.salesTotal)}
                      empty="Aucune vente de caisse sur cette période"
                    />
                  )}

                  {part === 'versements' && (
                    <Section
                      title="Argent reçu sur la période"
                      note="Versements saisis sur la carte, argent encaissé à la remise d'un bon ou sur une facture, acomptes et règlements de commande — c'est exactement le « total versements » du compte rendu. L'imputation d'un acompte n'est pas comptée : l'argent l'a été à sa date."
                      head={['Date', 'Type', 'Libellé', 'Mode', 'Montant']}
                      rows={data.all.credits.map((c) => [
                        formatDate(c.date, language),
                        <Badge key="t" variant={c.kind === 'payment' ? 'success' : c.kind === 'refund' ? 'danger' : 'info'} className="text-[10px]">
                          {creditKindLabel[c.kind] ?? c.kind}
                        </Badge>,
                        c.label,
                        c.method || '—',
                        <span key="a" className={c.amount < 0 ? 'font-bold text-rose-deep' : 'font-bold text-pistachio'}>
                          {c.amount < 0 ? `− ${money(-c.amount)}` : money(c.amount)}
                        </span>,
                      ])}
                      total={money(data.all.totalCredits)}
                      empty="Aucun versement sur cette période"
                    />
                  )}

                  {part === 'commands' && (
                    <Section
                      title="Commandes de la période"
                      note="Une commande n'est pas une dette : seules ses livraisons sont facturées."
                      head={['Créée le', 'N° commande', 'État', 'Commandé', 'Livré', 'Annulé', 'Total TTC', 'Acompte']}
                      rows={data.commandsList.map((c) => {
                        const st = deliveryStatus(c);
                        return [
                          formatDate(c.createdAt.slice(0, 10), language),
                          <span key="r" className="font-semibold">
                            {c.reference}
                            {c.isHistorical && <Badge variant="warning" className="ml-1 text-[9px]">Ancienne</Badge>}
                          </span>,
                          <Badge key="d" variant={st.isFull ? 'success' : st.isPartial ? 'warning' : 'danger'} className="text-[10px]">
                            {st.isFull ? 'Livrée' : st.isPartial ? `${st.percent.toFixed(0)} %` : 'Non livrée'}
                          </Badge>,
                          st.ordered, st.delivered, st.cancelled,
                          money(commandTtc(c)),
                          money((c.advancePaid ?? 0) + (c.extraPaid ?? 0) + (c.creditApplied ?? 0)),
                        ];
                      })}
                      empty="Aucune commande sur cette période"
                    />
                  )}

                  {part === 'oldDebts' && (
                    <Section
                      title="Anciennes dettes de la période"
                      note="Imprimées au-dessus du total du compte rendu, chacune avec sa date."
                      head={['Date', 'Description', 'Montant', 'Reste aujourd’hui']}
                      rows={data.oldDebtsList.map((d) => [
                        formatDate(d.date, language), d.description || '—',
                        money(d.amount),
                        <span key="r" className={d.restNow > 0 ? 'font-bold text-rose-deep' : 'text-pistachio'}>{money(d.restNow)}</span>,
                      ])}
                      total={money(data.oldDebtsTotal)}
                      empty="Aucune ancienne dette sur cette période"
                    />
                  )}

                  {part === 'adjustments' && (
                    <Section
                      title="Annulations et augmentations de commande"
                      head={['Date', 'Commande', 'Opération', 'Produits', 'Quantité', 'Valeur H.T', 'Motif']}
                      rows={data.adjustmentsList.map((a) => [
                        formatDate(a.date, language),
                        a.commandReference ?? '—',
                        <Badge key="t" variant={a.type === 'cancel' ? 'danger' : 'success'} className="text-[10px]">
                          {a.type === 'cancel' ? 'Annulation' : 'Augmentation'}
                        </Badge>,
                        a.lines.map((l) => l.productName).join(' · '),
                        `${a.type === 'cancel' ? '−' : '+'}${a.totalQuantity}`,
                        <span key="v" className={a.type === 'cancel' ? 'font-bold text-rose-deep' : 'font-bold text-pistachio'}>
                          {a.type === 'cancel' ? '−' : '+'}{money(a.totalAmount)}
                        </span>,
                        a.reason || '—',
                      ])}
                      empty="Aucune annulation ni augmentation sur cette période"
                    />
                  )}

                  {part === 'products' && (
                    <Section
                      title="Marchandises livrées et vendues sur la période"
                      note="Une ligne par produit ET par prix — c'est le tableau « marchandises » facultatif du document imprimé."
                      head={['Produit', 'Quantité', 'Prix U', 'Montant H.T']}
                      rows={data.products.map((p) => [
                        p.name, `${Math.round(p.quantity * 1000) / 1000}${p.unit ? ` ${p.unit}` : ''}`,
                        money(p.unitPrice),
                        <span key="a" className="font-bold text-gold-dark">{money(p.amount)}</span>,
                      ])}
                      total={money(data.products.reduce((s, p) => s + p.amount, 0))}
                      empty="Aucun produit sur cette période"
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          )}

          {data && (
            <StatementPrintDialog
              open={!!printMode}
              onClose={() => setPrintMode(null)}
              onPrint={onPrintChoice}
              kind="client"
              parts={printParts(printMode ?? 'statement')}
              preview={previewOf(printMode ?? 'statement')}
              title={printMode === 'deliveries'
                ? `Bon de livraisons de la période — ${client.name}`
                : `Imprimer le compte rendu — ${client.name}`}
              printLabel={printMode === 'deliveries' ? 'Imprimer le bon de livraisons' : 'Imprimer le compte rendu'}
              defaultDocTitle={defaultStatementTitle('client', printMode ?? 'statement')}
              defaultPeriodPrefix={defaultStatementPeriodPrefix(printMode ?? 'statement')}
              periodSuffix={period ? periodSuffix(period.from, period.to) : undefined}
              note={printMode === 'deliveries' && data.salesList.length
                ? 'Les ventes de caisse ne figurent pas sur le bon de livraisons : si des versements du client les ont réglées, le reste imprimé peut différer du solde du compte.'
                : undefined}
            />
          )}

          <PriorDebtDialog
            open={!!priorAsk}
            onClose={() => setPriorAsk(null)}
            onDecide={(include) => {
              const ask = priorAsk;
              setPriorAsk(null);
              if (ask) runPrint(ask.mode, ask.choice, ask.slice, include);
            }}
            partyName={client.name}
            slice={priorAsk?.slice ?? null}
            kind="client"
          />
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' | 'accent' }) {
  const color = tone === 'pos' ? 'text-pistachio' : tone === 'neg' ? 'text-rose-deep'
    : tone === 'accent' ? 'text-gold-dark' : 'text-text-primary';
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2.5">
      <p className="text-[10px] uppercase leading-tight tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular ${color}`}>{value}</p>
    </div>
  );
}

export function Section({
  title, note, head, rows, total, empty, lead, foot,
}: {
  title: string;
  note?: string;
  head: string[];
  rows: React.ReactNode[][];
  total?: string;
  empty: string;
  /** Ligne d'ouverture (solde antérieur du relevé). */
  lead?: React.ReactNode[];
  /** Ligne de totaux en pied de tableau. */
  foot?: React.ReactNode[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-xl border-l-4 border-gold bg-gold/8 px-3 py-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-gold-dark">
          <LayoutGrid size={14} />{title}
        </h4>
        {total && <span className="text-sm font-bold tabular text-gold-dark">{total}</span>}
      </div>
      {note && <p className="px-1 text-[11px] italic text-text-muted">{note}</p>}
      {rows.length === 0 && !lead ? (
        <p className="rounded-xl border border-dashed border-gold/25 bg-vanilla/20 py-6 text-center text-xs italic text-text-muted">
          {empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gold/15">
          <table className="w-full text-sm">
            <thead className="bg-vanilla/60 text-text-secondary">
              <tr>
                {head.map((h, i) => (
                  <th key={`${h}-${i}`} className={`whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase ${i === 0 ? 'text-left' : 'text-right'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lead && (
                <tr className="border-t border-gold/10 bg-gold/5">
                  {lead.map((cell, j) => (
                    <td key={j} className={`px-3 py-2 text-xs italic ${j === 0 ? 'text-left' : 'text-right tabular'}`}>{cell}</td>
                  ))}
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gold/10 hover:bg-gold/5">
                  {r.map((cell, j) => (
                    <td key={j} className={`px-3 py-2 text-xs ${j === 0 ? 'text-left' : 'text-right tabular'}`}>{cell}</td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr className="border-t border-gold/10">
                  <td colSpan={head.length} className="px-3 py-4 text-center text-xs italic text-text-muted">{empty}</td>
                </tr>
              )}
              {foot && (
                <tr className="border-t-2 border-gold/30 bg-vanilla/60 font-bold">
                  {foot.map((cell, j) => (
                    <td key={j} className={`px-3 py-2 text-xs ${j === 0 ? 'text-left' : 'text-right tabular'}`}>{cell}</td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
