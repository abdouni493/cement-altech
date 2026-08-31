import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, FileText, Printer, Wallet, ShoppingCart, Banknote, Package,
  Receipt, AlertTriangle, Flame, HardHat, Truck, Users, FlaskConical, Beaker,
  ArrowDownLeft, ArrowUpRight, Scale, ChevronRight, Coins, Trophy, TrendingDown,
  ChevronDown, ChevronUp, Tag, Clock, History, Percent
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useLanguage } from '@/hooks/useLanguage';
import { useSalesStore } from '@/store/salesStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useExpenseStore } from '@/store/expenseStore';
import { useProductionStore } from '@/store/productionStore';
import { useComptoirStore } from '@/store/comptoirStore';
import { useStockStore } from '@/store/stockStore';
import { useClientStore } from '@/store/clientStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useWorkerStore } from '@/store/workerStore';
import { useCaisseStore } from '@/store/caisseStore';
import { useCaisseReportStore } from '@/store/caisseReportStore';
import { useSettingsStore } from '@/store/settingsStore';
import { formatCurrency, formatDate, formatDateTime, isWithinRange } from '@/lib/utils';
import { printDetailedReport, type ReportDoc, type PrintTableSection, type PrintRow } from '@/lib/reportPrint';
import { computeReportCalc } from '@/pages/Caisse/CaisseReports';
import type { Expense, CaisseTransaction } from '@/types';

type Row = { title: string; sub?: string; value: number; danger?: boolean };

const ACCENTS: Record<string, string> = {
  gold: 'from-[#FF9CC0] to-[#F0568A]',
  rose: 'from-[#FFB0CB] to-[#F2547D]',
  pistachio: 'from-[#A6E9CE] to-[#3FB591]',
  caramel: 'from-[#FFD08A] to-[#F2944A]',
  lavender: 'from-[#CDB0F5] to-[#9B7ED8]',
};
const ACCENT_TEXT: Record<string, string> = {
  gold: 'text-gold-dark', rose: 'text-rose-deep', pistachio: 'text-pistachio', caramel: 'text-gold-dark', lavender: 'text-[#7B5BB8]',
};

export default function ReportsPage() {
  const { t, language } = useLanguage();
  const sales = useSalesStore((s) => s.sales);
  const purchases = usePurchaseStore((s) => s.purchases);
  const expenses = useExpenseStore((s) => s.expenses);
  const productions = useProductionStore((s) => s.productions);
  const destructions = useComptoirStore((s) => s.destructions);
  const comptoirItems = useComptoirStore((s) => s.items);
  const products = useStockStore((s) => s.products);
  const units = useStockStore((s) => s.units);
  const clients = useClientStore((s) => s.clients);
  const suppliers = useSupplierStore((s) => s.suppliers);
  const workers = useWorkerStore((s) => s.workers);
  const transactions = useCaisseStore((s) => s.transactions);
  const caisseReports = useCaisseReportStore((s) => s.reports);
  const settings = useSettingsStore((s) => s.settings);

  const [from, setFrom] = useState('2026-06-01');
  const [to, setTo] = useState('2026-06-30');
  const [generated, setGenerated] = useState(false);
  const [drill, setDrill] = useState<{ title: string; rows: Row[] } | null>(null);

  // Accordion toggle states
  const [expandedProdId, setExpandedProdId] = useState<string | null>(null);
  const [expandedCatName, setExpandedCatName] = useState<string | null>(null);

  const report = useMemo(() => {
    if (!generated) return null;
    const inRange = (d: string) => isWithinRange(d, from, to);
    const rSales = sales.filter((s) => inRange(s.date));
    const rPurchases = purchases.filter((p) => inRange(p.date));
    const rExpenses = expenses.filter((e) => inRange(e.date));
    const rProductions = productions.filter((p) => inRange(p.date));
    const rDestructions = destructions.filter((d) => inRange(d.date));
    const rTx = transactions.filter((x) => inRange(x.date));
    const rReports = caisseReports.filter((r) => inRange(r.date));

    const totalSales = rSales.reduce((s, x) => s + x.finalAmount, 0);
    const totalPurchases = rPurchases.reduce((s, x) => s + x.totalAmount, 0);
    const totalExpenses = rExpenses.reduce((s, x) => s + x.amount, 0);

    const workerPayments = workers.reduce((s, w) => s + w.payments.filter((p) => inRange(p.date)).reduce((a, p) => a + p.amount, 0), 0);
    const workerAcomptes = workers.reduce((s, w) => s + w.acomptes.filter((a) => inRange(a.date)).reduce((x, a) => x + a.amount, 0), 0);
    // Heures supplémentaires : payées sur la période, et dette restante
    const workerSalaries = workers.reduce(
      (s, w) => s + w.payments.filter((p) => inRange(p.date) && p.kind !== 'overtime').reduce((a, p) => a + p.amount, 0),
      0
    );
    const overtimePaid = workers.reduce(
      (s, w) => s + w.payments.filter((p) => inRange(p.date) && p.kind === 'overtime').reduce((a, p) => a + p.amount, 0),
      0
    );
    const rOvertimes = workers.flatMap((w) =>
      (w.overtimes ?? []).filter((o) => inRange(o.date)).map((o) => ({ ...o, workerName: w.fullName }))
    );
    const overtimeHours = rOvertimes.reduce((s, o) => s + o.hours, 0);
    const overtimeUnpaid = workers.reduce(
      (s, w) => s + (w.overtimes ?? []).filter((o) => !o.isPaid).reduce((a, o) => a + o.amount, 0),
      0
    );
    const destroyedValue = rDestructions.reduce((s, d) => s + d.value, 0);
    const netProfit = totalSales - totalPurchases - totalExpenses - workerPayments - destroyedValue;

    // ---- Saisies rétroactives & TVA ----------------------------------------
    // Anciennes ventes / anciens achats : enregistrés a posteriori, ils comptent
    // dans le chiffre d'affaires et les dettes de la période mais n'ont jamais
    // touché le stock actuel ni la caisse. On les isole pour pouvoir lire le
    // rapport « hors reprise d'historique ».
    const historicalSales = rSales.filter((x) => x.isHistorical);
    const historicalPurchases = rPurchases.filter((x) => x.isHistorical);
    const historicalSalesTotal = historicalSales.reduce((a, x) => a + x.finalAmount, 0);
    const historicalPurchasesTotal = historicalPurchases.reduce((a, x) => a + x.totalAmount, 0);
    const currentSalesTotal = totalSales - historicalSalesTotal;
    const currentPurchasesTotal = totalPurchases - historicalPurchasesTotal;

    const tvaSales = rSales.filter((x) => x.tvaEnabled);
    const tvaCollected = rSales.reduce((a, x) => a + (x.tvaAmount || 0), 0);
    const salesHT = rSales.reduce((a, x) => a + Math.max(0, x.totalAmount - x.reduction), 0);

    const clientDebts = rSales.filter((s) => s.restAmount > 0);
    const supplierDebts = rPurchases.filter((p) => p.restAmount > 0);
    const totalClientDebt = clientDebts.reduce((s, x) => s + x.restAmount, 0);
    const totalSupplierDebt = supplierDebts.reduce((s, x) => s + x.restAmount, 0);

    const stockValue = products.reduce((s, p) => s + p.currentQuantity * p.purchasePrice, 0);
    const lowStock = products.filter((p) => p.currentQuantity <= p.minAlertQuantity);
    const comptoirValue = comptoirItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

    const deposits = rTx.filter((x) => x.type === 'deposit');
    const withdrawals = rTx.filter((x) => x.type === 'withdrawal');
    const depositsTotal = deposits.reduce((s, x) => s + x.amount, 0);
    const withdrawalsTotal = withdrawals.reduce((s, x) => s + x.amount, 0);

    // Caisse report decalages
    const reportCalcs = rReports.map((r) => ({ report: r, calc: computeReportCalc(r, { sales, purchases, expenses, destructions, workers, transactions }) }));
    const totalDecalage = reportCalcs.reduce((s, x) => s + x.calc.decalage, 0);

    // Comptoir analysis (best / worst sellers within range)
    const salesMap = new Map<string, { name: string; units: number; revenue: number; unit?: string; sellByUnit?: boolean }>();
    rSales.forEach((s) => s.products.forEach((l) => {
      const key = l.productName || '—';
      const e = salesMap.get(key) || { name: key, units: 0, revenue: 0, unit: l.unit, sellByUnit: l.sellByUnit };
      e.units += l.quantity; e.revenue += l.quantity * l.sellingPrice;
      if (l.sellByUnit) { e.sellByUnit = true; e.unit = l.unit; }
      salesMap.set(key, e);
    }));
    const soldRanked = [...salesMap.values()].sort((a, b) => b.units - a.units);
    const productSalesRevenue = soldRanked.reduce((s, p) => s + p.revenue, 0);

    // Comptoir rest right now (per product) + total value
    const restItems = comptoirItems
      .filter((i) => i.quantity > 0)
      .map((i) => ({ name: i.productName, quantity: i.quantity, value: i.quantity * i.unitPrice, unit: i.sellByUnit ? i.unit : undefined }))
      .sort((a, b) => b.value - a.value);

    // ---- Group purchases by unit (sac / tonne / m³ …) ----
    const purchasesCatMap = new Map<string, { categoryName: string; totalAmount: number; products: { [name: string]: { name: string; quantity: number; unit?: string; totalCost: number } } }>();
    rPurchases.forEach(pur => {
      pur.products.forEach(line => {
        const prod = products.find(p => p.id === line.productId);
        const catName = line.unit || prod?.unit || 'Sans unité';
        
        if (!purchasesCatMap.has(catName)) {
          purchasesCatMap.set(catName, { categoryName: catName, totalAmount: 0, products: {} });
        }
        const catGroup = purchasesCatMap.get(catName)!;
        const lineTotal = line.quantity * line.purchasePrice;
        catGroup.totalAmount += lineTotal;

        const pName = line.productName || '—';
        if (!catGroup.products[pName]) {
          catGroup.products[pName] = { name: pName, quantity: 0, unit: line.unit, totalCost: 0 };
        }
        const pGroup = catGroup.products[pName];
        pGroup.quantity += line.quantity;
        pGroup.totalCost += lineTotal;
      });
    });
    const purchasesByCategory = [...purchasesCatMap.values()].map(cat => ({
      ...cat,
      productsList: Object.values(cat.products).sort((a, b) => b.totalCost - a.totalCost)
    })).sort((a, b) => b.totalAmount - a.totalAmount);

    // ---- Productions avec perte (loss) ----
    const lossProductions = rProductions.filter((p) => p.hasLoss && (p.lossQuantity ?? 0) > 0);
    const totalLossQty = lossProductions.reduce((s, p) => s + (p.lossQuantity ?? 0), 0);
    const totalLossValue = lossProductions.reduce((s, p) => s + (p.lossValue ?? 0), 0);

    // ---- Expenses grouped by category ----
    const expCatMap = new Map<string, { id: string; name: string; total: number; items: Expense[] }>();
    rExpenses.forEach((e) => {
      const id = e.categoryId || '__none__';
      const name = e.categoryName || t('noCategory');
      const g = expCatMap.get(id) || { id, name, total: 0, items: [] };
      g.total += e.amount;
      g.items.push(e);
      expCatMap.set(id, g);
    });
    const expensesByCategory = [...expCatMap.values()].sort((a, b) => b.total - a.total);

    // ---- Deposits / withdrawals grouped by category ----
    const groupTxByCat = (list: CaisseTransaction[]) => {
      const map = new Map<string, { id: string; name: string; total: number; items: CaisseTransaction[] }>();
      list.forEach((x) => {
        const id = x.categoryId || '__none__';
        const name = x.categoryName || t('noCategory');
        const g = map.get(id) || { id, name, total: 0, items: [] };
        g.total += x.amount;
        g.items.push(x);
        map.set(id, g);
      });
      return [...map.values()].sort((a, b) => b.total - a.total);
    };
    const depositsByCategory = groupTxByCat(deposits);
    const withdrawalsByCategory = groupTxByCat(withdrawals);

    return {
      rSales, rPurchases, rExpenses, rProductions, rDestructions, rTx,
      totalSales, totalPurchases, totalExpenses, workerPayments, workerAcomptes,
      workerSalaries, overtimePaid, overtimeUnpaid, overtimeHours, rOvertimes,
      destroyedValue, netProfit, clientDebts, supplierDebts, totalClientDebt, totalSupplierDebt,
      stockValue, lowStock, comptoirValue, deposits, withdrawals, depositsTotal, withdrawalsTotal,
      reportCalcs, totalDecalage, soldRanked, productSalesRevenue, restItems,
      purchasesByCategory,
      historicalSales, historicalPurchases, historicalSalesTotal, historicalPurchasesTotal,
      currentSalesTotal, currentPurchasesTotal,
      tvaSales, tvaCollected, salesHT,
      lossProductions, totalLossQty, totalLossValue,
      expensesByCategory, depositsByCategory, withdrawalsByCategory,
    };
  }, [generated, from, to, sales, purchases, expenses, productions, destructions, comptoirItems, products, units, clients, suppliers, workers, transactions, caisseReports, t]);

  const clientName = (id: string | null) => (id ? clients.find((c) => c.id === id)?.name || '—' : t('walkIn'));
  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name || '—';
  /** Products are now described by their unit, not by a marque/category. */
  const unitLabel = (unit?: string) => unit || '—';

  const handlePrint = () => {
    if (!report) return;
    const money = formatCurrency;
    const subtitle = `${formatDate(from, language)} → ${formatDate(to, language)}`;
    const totalRow = (label: string, value: string, tone: PrintRow['tone'] = 'accent'): PrintRow =>
      ({ cells: [label, value], span: true, variant: 'total', tone });
    const sections: PrintTableSection[] = [];

    // ---- 1. Synthèse générale ----
    sections.push({
      title: t('generalSummary'), icon: '📊',
      cols: [{ label: t('amount') }, { label: t('total'), align: 'right' }],
      rows: [
        { cells: [t('totalSales'), money(report.totalSales)], tone: 'pos' },
        { cells: ['dont ventes courantes (stock déduit)', money(report.currentSalesTotal)], tone: 'muted' },
        { cells: ['dont anciennes ventes (saisie rétroactive)', money(report.historicalSalesTotal)], tone: 'muted' },
        { cells: ['Ventes hors taxes (base imposable)', money(report.salesHT)], tone: 'muted' },
        { cells: ['TVA collectée sur les ventes', money(report.tvaCollected)], tone: 'accent' },
        { cells: [t('totalPurchasesAmount'), money(report.totalPurchases)], tone: 'neg' },
        { cells: ['dont achats courants (stock alimenté)', money(report.currentPurchasesTotal)], tone: 'muted' },
        { cells: ['dont anciens achats (saisie rétroactive)', money(report.historicalPurchasesTotal)], tone: 'muted' },
        { cells: [t('totalExpenses'), money(report.totalExpenses)], tone: 'neg' },
        { cells: [t('workerSalaries'), money(report.workerPayments)], tone: 'neg' },
        { cells: [t('acomptes'), money(report.workerAcomptes)], tone: 'neg' },
        { cells: [t('moneyWasted'), money(report.destroyedValue)], tone: 'neg' },
        { cells: [t('totalLossValue'), money(report.totalLossValue)], tone: 'neg' },
        { cells: [t('stockValue'), money(report.stockValue)], tone: 'accent' },
        { cells: [t('comptoirValue'), money(report.comptoirValue)], tone: 'accent' },
        { cells: [t('clientDebts'), money(report.totalClientDebt)], tone: 'neg' },
        { cells: [t('supplierDebts'), money(report.totalSupplierDebt)], tone: 'neg' },
        { cells: [t('totalDeposits'), money(report.depositsTotal)], tone: 'pos' },
        { cells: [t('totalWithdrawals'), money(report.withdrawalsTotal)], tone: 'neg' },
        { cells: [t('reportsDecalage'), money(report.totalDecalage)], tone: 'muted' },
        totalRow(t('netProfit'), money(report.netProfit), report.netProfit >= 0 ? 'pos' : 'neg'),
      ],
    });

    // ---- 2. État du stock ----
    const stockSorted = [...products]
      .map((p) => ({ p, value: p.currentQuantity * p.purchasePrice }))
      .sort((a, b) => b.value - a.value);
    sections.push({
      title: t('stockState'), icon: '📦', headerTotal: money(report.stockValue),
      cols: [
        { label: t('productName') }, { label: t('marque') }, { label: t('category') },
        { label: t('currentStock'), align: 'right' }, { label: t('minAlert'), align: 'right' },
        { label: t('purchasePrice'), align: 'right' }, { label: t('stockValue'), align: 'right' },
      ],
      rows: [
        ...stockSorted.map(({ p, value }): PrintRow => ({
          cells: [
            p.name, unitLabel(p.unit),
            `${p.currentQuantity}${p.unit ? ' ' + p.unit : ''}`,
            `${p.minAlertQuantity}${p.unit ? ' ' + p.unit : ''}`,
            money(p.purchasePrice), money(value),
          ],
          tone: p.currentQuantity <= p.minAlertQuantity ? 'neg' : 'accent',
        })),
        totalRow(t('stockValue'), money(report.stockValue)),
      ],
      emptyLabel: t('noData'),
    });

    // ---- 3. Alertes de stock ----
    sections.push({
      title: t('stockAlertsCount'), icon: '⚠️', headerTotal: String(report.lowStock.length),
      cols: [
        { label: t('productName') }, { label: t('category') },
        { label: t('currentStock'), align: 'right' }, { label: t('minAlert'), align: 'right' },
      ],
      rows: report.lowStock.map((p): PrintRow => ({
        cells: [p.name, unitLabel(p.unit), `${p.currentQuantity}${p.unit ? ' ' + p.unit : ''}`, `${p.minAlertQuantity}${p.unit ? ' ' + p.unit : ''}`],
        tone: 'neg',
      })),
      emptyLabel: t('noData'),
    });

    // ---- 4. Détail des achats par catégorie ----
    const purchaseRows: PrintRow[] = [];
    report.purchasesByCategory.forEach((cat) => {
      purchaseRows.push({ cells: [`📁 ${cat.categoryName}`, money(cat.totalAmount)], span: true, variant: 'category', tone: 'accent' });
      cat.productsList.forEach((p) => {
        const avg = p.quantity > 0 ? p.totalCost / p.quantity : 0;
        purchaseRows.push({ cells: [p.name, `${p.quantity}${p.unit ? ' ' + p.unit : ''}`, money(avg), money(p.totalCost)], variant: 'detail', tone: 'accent' });
      });
    });
    if (purchaseRows.length) purchaseRows.push(totalRow(t('grandTotal'), money(report.totalPurchases)));
    sections.push({
      title: t('purchasesDetail'), icon: '🛒', headerTotal: money(report.totalPurchases),
      cols: [{ label: t('productName') }, { label: t('quantity'), align: 'right' }, { label: t('purchasePrice'), align: 'right' }, { label: t('lineTotal'), align: 'right' }],
      rows: purchaseRows, emptyLabel: t('noData'),
    });

    // ---- 5. Détail des ventes ----
    const salesTotFinal = report.rSales.reduce((s, x) => s + x.finalAmount, 0);
    const salesTotPaid = report.rSales.reduce((s, x) => s + x.paidAmount, 0);
    const salesTotRest = report.rSales.reduce((s, x) => s + x.restAmount, 0);
    sections.push({
      title: t('salesDetail'), icon: '💳', headerTotal: money(salesTotFinal),
      cols: [
        { label: t('reference') }, { label: t('client') }, { label: t('date') },
        { label: t('total'), align: 'right' }, { label: t('paid'), align: 'right' }, { label: t('rest'), align: 'right' },
      ],
      rows: [
        ...report.rSales
          .slice()
          .sort((a, b) => (a.date < b.date ? 1 : -1))
          .map((s): PrintRow => ({
            cells: [s.reference, clientName(s.clientId), formatDateTime(s.date, language), money(s.finalAmount), money(s.paidAmount), money(s.restAmount)],
            tone: s.restAmount > 0 ? 'neg' : 'default',
          })),
        { cells: [t('total'), '', '', money(salesTotFinal), money(salesTotPaid), money(salesTotRest)], variant: 'total', tone: 'neg' },
      ],
      emptyLabel: t('noData'),
    });

    // ---- 5 bis. TVA collectée ----
    sections.push({
      title: 'TVA collectée sur les ventes', icon: '🧮', headerTotal: money(report.tvaCollected),
      cols: [
        { label: t('reference') }, { label: t('client') }, { label: t('date') },
        { label: 'Base HT', align: 'right' }, { label: 'Taux', align: 'right' },
        { label: 'TVA', align: 'right' }, { label: 'Net TTC', align: 'right' },
      ],
      rows: [
        ...report.tvaSales
          .slice()
          .sort((a, b) => (a.date < b.date ? 1 : -1))
          .map((x): PrintRow => ({
            cells: [
              x.reference, clientName(x.clientId), formatDate(x.date, language),
              money(Math.max(0, x.totalAmount - x.reduction)), `${x.tvaRate ?? 0} %`,
              money(x.tvaAmount || 0), money(x.finalAmount),
            ],
            tone: 'accent',
          })),
        ...(report.tvaSales.length
          ? [{
              cells: ['TOTAL TVA', '', '', money(report.salesHT), '', money(report.tvaCollected), money(salesTotFinal)],
              variant: 'total' as const, tone: 'accent' as const,
            }]
          : []),
      ],
      emptyLabel: 'Aucune vente soumise à la TVA sur la période',
    });

    // ---- 5 ter. Saisies rétroactives (anciennes ventes / anciens achats) ----
    sections.push({
      title: 'Saisies rétroactives — historique repris', icon: '🕘',
      headerTotal: money(report.historicalSalesTotal + report.historicalPurchasesTotal),
      cols: [
        { label: 'Type' }, { label: t('reference') }, { label: 'Tiers' }, { label: t('date') },
        { label: t('total'), align: 'right' }, { label: t('rest'), align: 'right' },
      ],
      rows: [
        ...report.historicalSales.map((x): PrintRow => ({
          cells: [
            'Ancienne vente', x.reference, clientName(x.clientId), formatDate(x.date, language),
            money(x.finalAmount), money(x.restAmount),
          ],
          tone: 'pos',
        })),
        ...report.historicalPurchases.map((x): PrintRow => ({
          cells: [
            'Ancien achat', x.reference, supplierName(x.supplierId), formatDate(x.date, language),
            money(x.totalAmount), money(x.restAmount),
          ],
          tone: 'neg',
        })),
        ...(report.historicalSales.length + report.historicalPurchases.length
          ? [{
              cells: [
                'TOTAL', '', '', '',
                money(report.historicalSalesTotal + report.historicalPurchasesTotal), '',
              ],
              variant: 'total' as const,
            }]
          : []),
      ],
      emptyLabel: 'Aucune saisie rétroactive sur la période',
    });

    // ---- 6. Ventes par produit ----
    sections.push({
      title: t('productSales'), icon: '🧾', headerTotal: money(report.productSalesRevenue),
      cols: [{ label: t('productName') }, { label: t('soldQty'), align: 'right' }, { label: t('revenue'), align: 'right' }],
      rows: [
        ...report.soldRanked.map((p): PrintRow => ({ cells: [p.name, `${p.units}${p.sellByUnit && p.unit ? ' ' + p.unit : ''}`, money(p.revenue)], tone: 'pos' })),
        totalRow(t('grandTotal'), money(report.productSalesRevenue), 'pos'),
      ],
      emptyLabel: t('noData'),
    });

    // ---- 7. Production — ingrédients consommés ----
    const prodRows: PrintRow[] = [];
    let prodCostTotal = 0;
    report.rProductions.forEach((p) => {
      const cost = p.usedProducts.reduce((sum, u) => sum + (u.lineCost ?? u.quantityUsed * (u.unitCost ?? 0)), 0);
      prodCostTotal += cost;
      const gains = p.totalValue - cost;
      prodRows.push({
        cells: [`🧪 ${p.name} — ${formatDate(p.date, language)} ${p.hour} · ${t('qtyReceived')}: ${p.outputQuantity} · ${t('expectedRevenue')}: ${money(p.totalValue)} · ${t('totalGains')}: ${money(gains)}`, money(cost)],
        span: true, variant: 'subheader', tone: gains >= 0 ? 'pos' : 'neg',
      });
      p.usedProducts.forEach((u) => {
        prodRows.push({
          cells: [u.productName, `${u.quantityUsed}${u.unit ? ' ' + u.unit : ''}`, money(u.unitCost ?? 0), money(u.lineCost ?? u.quantityUsed * (u.unitCost ?? 0))],
          variant: 'detail', tone: 'neg',
        });
      });
    });
    if (prodRows.length) prodRows.push(totalRow(t('productionCost'), money(prodCostTotal), 'neg'));
    sections.push({
      title: t('productionByCategory'), icon: '⚗️',
      cols: [{ label: t('ingredient') }, { label: t('quantity'), align: 'right' }, { label: t('unitCost'), align: 'right' }, { label: t('lineCost'), align: 'right' }],
      rows: prodRows, emptyLabel: t('noData'),
    });

    // ---- 7b. Productions avec perte ----
    const lossPrintRows: PrintRow[] = [];
    report.lossProductions.forEach((p) => {
      const su = p.sellByUnit && p.sellUnit ? ` ${p.sellUnit}` : '';
      lossPrintRows.push({
        cells: [p.name, formatDate(p.date, language), `${p.expectedQuantity ?? 0}${su}`, `${p.outputQuantity}${su}`, `${p.lossQuantity ?? 0}${su}`, money(p.lossValue ?? 0)],
        tone: 'neg',
      });
      if (p.lossDescription) lossPrintRows.push({ cells: [`📝 ${p.lossDescription}`, ''], span: true, variant: 'detail', tone: 'muted' });
    });
    if (lossPrintRows.length) lossPrintRows.push(totalRow(`${t('totalLoss')}: ${report.totalLossQty} · ${t('totalLossValue')}`, money(report.totalLossValue), 'neg'));
    sections.push({
      title: t('lossProductions'), icon: '📉', headerTotal: money(report.totalLossValue),
      cols: [
        { label: t('production') }, { label: t('date') },
        { label: t('expectedQty'), align: 'right' }, { label: t('realProducedQty'), align: 'right' },
        { label: t('lossQty'), align: 'right' }, { label: t('lossValueLabel'), align: 'right' },
      ],
      rows: lossPrintRows, emptyLabel: t('noLoss'),
    });

    // ---- 8. Dépenses par catégorie ----
    const expenseRows: PrintRow[] = [];
    report.expensesByCategory.forEach((cat) => {
      expenseRows.push({ cells: [`📁 ${cat.name} — ${cat.items.length}`, money(cat.total)], span: true, variant: 'category', tone: 'neg' });
      cat.items.forEach((e) => {
        expenseRows.push({ cells: [e.name, e.description || '—', formatDate(e.date, language), money(e.amount)], variant: 'detail', tone: 'neg' });
      });
    });
    if (expenseRows.length) expenseRows.push(totalRow(t('total'), money(report.totalExpenses), 'neg'));
    sections.push({
      title: t('expensesByCategory'), icon: '💸', headerTotal: money(report.totalExpenses),
      cols: [{ label: t('name') }, { label: t('description') }, { label: t('date') }, { label: t('amount'), align: 'right' }],
      rows: expenseRows, emptyLabel: t('noData'),
    });

    // ---- 9. Dettes clients ----
    sections.push({
      title: t('clientDebts'), icon: '🧍', headerTotal: money(report.totalClientDebt),
      cols: [
        { label: t('client') }, { label: t('reference') }, { label: t('date') },
        { label: t('total'), align: 'right' }, { label: t('paid'), align: 'right' }, { label: t('rest'), align: 'right' },
      ],
      rows: [
        ...report.clientDebts.map((s): PrintRow => ({ cells: [clientName(s.clientId), s.reference, formatDate(s.date, language), money(s.finalAmount), money(s.paidAmount), money(s.restAmount)], tone: 'neg' })),
        totalRow(t('total'), money(report.totalClientDebt), 'neg'),
      ],
      emptyLabel: t('noData'),
    });

    // ---- 10. Dettes fournisseurs ----
    sections.push({
      title: t('supplierDebts'), icon: '🚚', headerTotal: money(report.totalSupplierDebt),
      cols: [
        { label: t('supplier') }, { label: t('reference') }, { label: t('date') },
        { label: t('total'), align: 'right' }, { label: t('paid'), align: 'right' }, { label: t('rest'), align: 'right' },
      ],
      rows: [
        ...report.supplierDebts.map((p): PrintRow => ({ cells: [supplierName(p.supplierId), p.reference, formatDate(p.date, language), money(p.totalAmount), money(p.paidAmount), money(p.restAmount)], tone: 'neg' })),
        totalRow(t('total'), money(report.totalSupplierDebt), 'neg'),
      ],
      emptyLabel: t('noData'),
    });

    // ---- 11. Paiements employés (salaires + acomptes) ----
    const workerRows: PrintRow[] = [];
    workers.forEach((w) => {
      w.payments.filter((p) => isWithinRange(p.date, from, to)).forEach((p) => {
        workerRows.push({ cells: [w.fullName, t('workerSalaries'), p.period || p.description || '—', formatDate(p.date, language), money(p.amount)], tone: 'neg' });
      });
      w.acomptes.filter((a) => isWithinRange(a.date, from, to)).forEach((a) => {
        workerRows.push({ cells: [w.fullName, t('acomptes'), a.description || '—', formatDate(a.date, language), money(a.amount)], tone: 'neg' });
      });
    });
    if (workerRows.length) workerRows.push(totalRow(t('total'), money(report.workerPayments + report.workerAcomptes), 'neg'));

    // ---- 11 bis. Heures supplémentaires détaillées ----
    const overtimeRows: PrintRow[] = report.rOvertimes.map((o): PrintRow => ({
      cells: [
        o.workerName,
        formatDate(o.date, language),
        `${String(o.workEndHour).padStart(2, '0')}:${String(o.workEndMinute).padStart(2, '0')} → ${String(o.overtimeEndHour).padStart(2, '0')}:${String(o.overtimeEndMinute).padStart(2, '0')}`,
        `${o.hours.toFixed(2)} h`,
        money(o.hourlyRate),
        money(o.amount),
        o.isPaid ? 'Payée' : 'Non payée',
      ],
      tone: o.isPaid ? 'accent' : 'neg',
    }));
    if (overtimeRows.length) overtimeRows.push(totalRow(t('total'), money(report.rOvertimes.reduce((s, o) => s + o.amount, 0)), 'neg'));
    sections.push({
      title: t('workerPaymentsDetail'), icon: '👷', headerTotal: money(report.workerPayments + report.workerAcomptes),
      cols: [{ label: t('workers') }, { label: t('operationType') }, { label: t('description') }, { label: t('date') }, { label: t('amount'), align: 'right' }],
      rows: workerRows, emptyLabel: t('noData'),
    });

    sections.push({
      title: 'Heures supplémentaires', icon: '⏱️',
      headerTotal: `${report.overtimeHours.toFixed(2)} h · ${money(report.rOvertimes.reduce((s, o) => s + o.amount, 0))}`,
      cols: [
        { label: t('workers') }, { label: t('date') }, { label: 'Horaire' },
        { label: 'Durée', align: 'right' }, { label: 'Taux horaire', align: 'right' },
        { label: t('amount'), align: 'right' }, { label: t('status') },
      ],
      rows: overtimeRows, emptyLabel: t('noData'),
    });

    // ---- 12. Dépôts de caisse (par catégorie) ----
    const depositRows: PrintRow[] = [];
    report.depositsByCategory.forEach((cat) => {
      depositRows.push({ cells: [`📁 ${cat.name} — ${cat.items.length}`, money(cat.total)], span: true, variant: 'category', tone: 'pos' });
      cat.items.forEach((d) => depositRows.push({ cells: [formatDate(d.date, language), d.description || t('deposit'), d.createdBy || '—', money(d.amount)], variant: 'detail', tone: 'pos' }));
    });
    if (depositRows.length) depositRows.push(totalRow(t('total'), money(report.depositsTotal), 'pos'));
    sections.push({
      title: t('depositsByCategory'), icon: '⬇️', headerTotal: money(report.depositsTotal),
      cols: [{ label: t('date') }, { label: t('description') }, { label: t('createdBy') }, { label: t('amount'), align: 'right' }],
      rows: depositRows, emptyLabel: t('noData'),
    });

    // ---- 13. Retraits de caisse (par catégorie) ----
    const withdrawalRows: PrintRow[] = [];
    report.withdrawalsByCategory.forEach((cat) => {
      withdrawalRows.push({ cells: [`📁 ${cat.name} — ${cat.items.length}`, money(cat.total)], span: true, variant: 'category', tone: 'neg' });
      cat.items.forEach((d) => withdrawalRows.push({ cells: [formatDate(d.date, language), d.description || t('withdrawal'), d.createdBy || '—', money(d.amount)], variant: 'detail', tone: 'neg' }));
    });
    if (withdrawalRows.length) withdrawalRows.push(totalRow(t('total'), money(report.withdrawalsTotal), 'neg'));
    sections.push({
      title: t('withdrawalsByCategory'), icon: '⬆️', headerTotal: money(report.withdrawalsTotal),
      cols: [{ label: t('date') }, { label: t('description') }, { label: t('createdBy') }, { label: t('amount'), align: 'right' }],
      rows: withdrawalRows, emptyLabel: t('noData'),
    });

    // ---- 14. Destructions ----
    sections.push({
      title: t('dayDestructions'), icon: '🔥', headerTotal: money(report.destroyedValue),
      cols: [{ label: t('productName') }, { label: t('reason') }, { label: t('date') }, { label: t('quantity'), align: 'right' }, { label: t('moneyWasted'), align: 'right' }],
      rows: [
        ...report.rDestructions.map((d): PrintRow => ({ cells: [d.productName, d.reason, formatDate(d.date, language), `${d.quantity}${d.unit ? ' ' + d.unit : ''}`, money(d.value)], tone: 'neg' })),
        totalRow(t('total'), money(report.destroyedValue), 'neg'),
      ],
      emptyLabel: t('noData'),
    });

    // ---- 15. Reste au comptoir ----
    sections.push({
      title: t('restAtComptoir'), icon: '🧴', headerTotal: money(report.comptoirValue),
      cols: [{ label: t('productName') }, { label: t('available'), align: 'right' }, { label: t('restValue'), align: 'right' }],
      rows: [
        ...report.restItems.map((p): PrintRow => ({ cells: [p.name, `${p.quantity}${p.unit ? ' ' + p.unit : ''}`, money(p.value)], tone: 'accent' })),
        totalRow(t('grandTotal'), money(report.comptoirValue)),
      ],
      emptyLabel: t('noData'),
    });

    // ---- 16. Rapports de caisse & décalages ----
    sections.push({
      title: t('caisseReports'), icon: '⚖️', headerTotal: money(report.totalDecalage),
      cols: [
        { label: t('date') }, { label: t('hour') },
        { label: t('declaredAmount'), align: 'right' }, { label: t('theoreticalBalance'), align: 'right' }, { label: t('decalage'), align: 'right' },
      ],
      rows: [
        ...report.reportCalcs.map(({ report: r, calc }): PrintRow => ({
          cells: [formatDate(r.date, language), r.hour, money(r.declaredAmount), money(calc.theoretical), money(calc.decalage)],
          tone: Math.abs(calc.decalage) < 0.01 ? 'pos' : 'neg',
        })),
        { cells: [t('total'), '', '', '', money(report.totalDecalage)], variant: 'total', tone: 'neg' },
      ],
      emptyLabel: t('noData'),
    });

    const doc: ReportDoc = {
      docTitle: `${t('generalReport')} — ${subtitle}`,
      headTitle: t('generalReport'),
      subtitle,
      kpis: [
        { label: t('totalSales'), value: money(report.totalSales), tone: 'pos' },
        { label: t('totalPurchasesAmount'), value: money(report.totalPurchases), tone: 'neg' },
        { label: t('totalExpenses'), value: money(report.totalExpenses), tone: 'neg' },
        { label: t('totalLossValue'), value: money(report.totalLossValue), tone: 'neg' },
        { label: t('netProfit'), value: money(report.netProfit), tone: report.netProfit >= 0 ? 'pos' : 'neg' },
        { label: t('stockValue'), value: money(report.stockValue), tone: 'accent' },
        { label: t('clientDebts'), value: money(report.totalClientDebt), tone: 'neg' },
        { label: t('supplierDebts'), value: money(report.totalSupplierDebt), tone: 'neg' },
        { label: t('comptoirValue'), value: money(report.comptoirValue), tone: 'accent' },
      ],
      sections,
    };
    printDetailedReport(doc, settings, language);
  };

  return (
    <div>
      <PageHeader title={t('reports')} icon={<TrendingUp size={24} />}
        actions={report && <Button variant="gold" onClick={handlePrint}><Printer size={18} /> {t('printReport')}</Button>} />

      <Card index={0} className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <Input label={t('from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[180px]" />
          <Input label={t('to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[180px]" />
          <Button variant="gold" onClick={() => setGenerated(true)}><FileText size={18} /> {t('generateReport')}</Button>
        </div>
      </Card>

      {!report ? (
        <Card index={1} className="text-center py-12 text-text-muted">Sélectionnez une période et générez le rapport</Card>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {/* Financial overview */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <OverviewTile icon={<Wallet size={20} />} label={t('totalSales')} value={report.totalSales} accent="pistachio" />
            <OverviewTile icon={<ShoppingCart size={20} />} label={t('totalPurchasesAmount')} value={report.totalPurchases} accent="caramel" />
            <OverviewTile icon={<Banknote size={20} />} label={t('totalExpenses')} value={report.totalExpenses} accent="rose" />
            <OverviewTile icon={<TrendingUp size={20} />} label={t('netProfit')} value={report.netProfit} accent={report.netProfit >= 0 ? 'pistachio' : 'rose'} />
          </div>

          {/* ===== Sales & client debts ===== */}
          <SectionTitle icon={<Receipt size={18} />} title={t('salesReport')} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <DrillCard icon={<Receipt size={20} />} accent="pistachio" label={t('sales')} value={report.totalSales} count={report.rSales.length}
              onClick={() => setDrill({ title: t('sales'), rows: report.rSales.map((s) => ({ title: `${s.reference} — ${clientName(s.clientId)}`, sub: `${s.products.length} article(s) · ${formatDate(s.date, language)}`, value: s.finalAmount })) })} />
            <DrillCard icon={<AlertTriangle size={20} />} accent="rose" label={t('clientDebts')} value={report.totalClientDebt} count={report.clientDebts.length}
              onClick={() => setDrill({ title: t('clientDebts'), rows: report.clientDebts.map((s) => ({ title: `${clientName(s.clientId)} (${s.reference})`, sub: formatDate(s.date, language), value: s.restAmount, danger: true })) })} />
            <DrillCard icon={<Coins size={20} />} accent="caramel" label={t('totalPaid')} value={report.rSales.reduce((a, s) => a + s.paidAmount, 0)} count={report.rSales.length}
              onClick={() => setDrill({ title: t('totalPaid'), rows: report.rSales.map((s) => ({ title: `${s.reference} — ${clientName(s.clientId)}`, sub: formatDate(s.date, language), value: s.paidAmount })) })} />
            <DrillCard icon={<Users size={20} />} accent="lavender" label={t('clients')} value={clients.length} count={clients.length} isCount
              onClick={() => setDrill({ title: t('clients'), rows: clients.map((c) => ({ title: c.name, sub: c.phone, value: report.rSales.filter((s) => s.clientId === c.id).reduce((a, s) => a + s.finalAmount, 0) })) })} />
          </div>

          {/* ===== Purchases & supplier debts ===== */}
          <SectionTitle icon={<ShoppingCart size={18} />} title={t('purchaseReport')} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <DrillCard icon={<ShoppingCart size={20} />} accent="caramel" label={t('purchase')} value={report.totalPurchases} count={report.rPurchases.length}
              onClick={() => setDrill({ title: t('purchase'), rows: report.rPurchases.map((p) => ({ title: `${p.reference} — ${supplierName(p.supplierId)}`, sub: `${p.products.length} article(s) · ${formatDate(p.date, language)}`, value: p.totalAmount })) })} />
            <DrillCard icon={<AlertTriangle size={20} />} accent="rose" label={t('supplierDebts')} value={report.totalSupplierDebt} count={report.supplierDebts.length}
              onClick={() => setDrill({ title: t('supplierDebts'), rows: report.supplierDebts.map((p) => ({ title: `${supplierName(p.supplierId)} (${p.reference})`, sub: formatDate(p.date, language), value: p.restAmount, danger: true })) })} />
            <DrillCard icon={<Coins size={20} />} accent="pistachio" label={t('totalPaid')} value={report.rPurchases.reduce((a, p) => a + p.paidAmount, 0)} count={report.rPurchases.length}
              onClick={() => setDrill({ title: t('totalPaid'), rows: report.rPurchases.map((p) => ({ title: `${p.reference} — ${supplierName(p.supplierId)}`, sub: formatDate(p.date, language), value: p.paidAmount })) })} />
            <DrillCard icon={<Truck size={20} />} accent="lavender" label={t('suppliers')} value={suppliers.length} count={suppliers.length} isCount
              onClick={() => setDrill({ title: t('suppliers'), rows: suppliers.map((s) => ({ title: s.name, sub: s.phone, value: report.rPurchases.filter((p) => p.supplierId === s.id).reduce((a, p) => a + p.totalAmount, 0) })) })} />
          </div>

          {/* ===== TVA & saisies rétroactives ===== */}
          <SectionTitle icon={<Percent size={18} />} title="TVA & saisies rétroactives" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <DrillCard icon={<Percent size={20} />} accent="gold" label="TVA collectée" value={report.tvaCollected} count={report.tvaSales.length}
              onClick={() => setDrill({ title: 'TVA collectée', rows: report.tvaSales.map((x) => ({ title: `${x.reference} — ${clientName(x.clientId)}`, sub: `Base HT ${formatCurrency(Math.max(0, x.totalAmount - x.reduction))} · taux ${x.tvaRate ?? 0}% · ${formatDate(x.date, language)}`, value: x.tvaAmount || 0 })) })} />
            <DrillCard icon={<Receipt size={20} />} accent="pistachio" label="Ventes HT (base imposable)" value={report.salesHT} count={report.rSales.length}
              onClick={() => setDrill({ title: 'Ventes hors taxes', rows: report.rSales.map((x) => ({ title: `${x.reference} — ${clientName(x.clientId)}`, sub: `${x.tvaEnabled ? `TVA ${x.tvaRate}%` : 'Sans TVA'} · ${formatDate(x.date, language)}`, value: Math.max(0, x.totalAmount - x.reduction) })) })} />
            <DrillCard icon={<History size={20} />} accent="lavender" label="Anciennes ventes" value={report.historicalSalesTotal} count={report.historicalSales.length}
              onClick={() => setDrill({ title: 'Anciennes ventes (saisie rétroactive)', rows: report.historicalSales.map((x) => ({ title: `${x.reference} — ${clientName(x.clientId)}`, sub: `${x.products.length} article(s) · ${formatDate(x.date, language)} · stock non modifié`, value: x.finalAmount })) })} />
            <DrillCard icon={<History size={20} />} accent="caramel" label="Anciens achats" value={report.historicalPurchasesTotal} count={report.historicalPurchases.length}
              onClick={() => setDrill({ title: 'Anciens achats (saisie rétroactive)', rows: report.historicalPurchases.map((x) => ({ title: `${x.reference} — ${supplierName(x.supplierId)}`, sub: `${x.products.length} article(s) · ${formatDate(x.date, language)} · stock non modifié`, value: x.totalAmount })) })} />
          </div>
          {(report.historicalSales.length > 0 || report.historicalPurchases.length > 0) && (
            <p className="-mt-2 rounded-xl border border-caramel/30 bg-caramel/10 px-3.5 py-2 text-xs font-medium text-gold-dark">
              <History size={12} className="inline mr-1" />
              Les saisies rétroactives sont comptées dans le chiffre d'affaires, les dettes et les
              comptes rendus de la période, mais elles n'ont jamais modifié le stock actuel ni la caisse.
              Ventes courantes : <b>{formatCurrency(report.currentSalesTotal)}</b> · achats courants :{' '}
              <b>{formatCurrency(report.currentPurchasesTotal)}</b>.
            </p>
          )}

          {/* ===== Stock & alerts ===== */}
          <SectionTitle icon={<Package size={18} />} title={t('stockReport')} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <DrillCard icon={<Package size={20} />} accent="gold" label={t('stockValue')} value={report.stockValue} count={products.length}
              onClick={() => setDrill({ title: t('stock'), rows: products.map((p) => ({ title: p.name, sub: `${unitLabel(p.unit)} · Stock: ${p.currentQuantity}`, value: p.currentQuantity * p.purchasePrice })) })} />
            <DrillCard icon={<AlertTriangle size={20} />} accent="rose" label={t('stockAlertsCount')} value={report.lowStock.length} isCount count={report.lowStock.length}
              onClick={() => setDrill({ title: t('stockAlertsCount'), rows: report.lowStock.map((p) => ({ title: p.name, sub: `Stock: ${p.currentQuantity} / Min: ${p.minAlertQuantity}`, value: p.currentQuantity, danger: true })) })} />
            <DrillCard icon={<Beaker size={20} />} accent="pistachio" label={t('comptoirValue')} value={report.comptoirValue} count={comptoirItems.length}
              onClick={() => setDrill({ title: t('comptoir'), rows: comptoirItems.map((i) => ({ title: i.productName, sub: `${i.quantity} × ${formatCurrency(i.unitPrice)}`, value: i.quantity * i.unitPrice })) })} />
            <DrillCard icon={<FlaskConical size={20} />} accent="caramel" label={t('production')} value={report.rProductions.reduce((a, p) => a + p.totalValue, 0)} count={report.rProductions.length}
              onClick={() => setDrill({ title: t('production'), rows: report.rProductions.map((p) => ({ title: p.name, sub: `${p.outputQuantity} unités · ${formatDate(p.date, language)}`, value: p.totalValue })) })} />
          </div>

          {/* ===== Detailed Ingrédients par Production + Achats par Catégorie ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
            {/* Ingredients per Production Accordion */}
            <Card index={0} className="border border-gold/15">
              <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2">
                <FlaskConical size={18} className="text-gold-dark" /> Détails des Ingrédients par Production
              </h3>
              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {report.rProductions.map((p) => {
                  const isOpen = expandedProdId === p.id;
                  const prodCost = p.usedProducts.reduce((sum, u) => sum + (u.lineCost ?? (u.quantityUsed * (u.unitCost ?? 0))), 0);
                  return (
                    <div key={p.id} className="border border-gold/10 rounded-xl overflow-hidden bg-vanilla/10">
                      <button
                        onClick={() => setExpandedProdId(isOpen ? null : p.id)}
                        className="w-full flex items-center justify-between p-3 text-left hover:bg-gold/5 transition-colors"
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <p className="font-semibold text-sm text-text-primary truncate">{p.name}</p>
                          <p className="text-xs text-text-muted">{formatDate(p.date, language)} · {p.outputQuantity} unités</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs font-bold text-rose-deep">{formatCurrency(prodCost)}</span>
                          {isOpen ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
                        </div>
                      </button>
                      <AnimatePresence>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: 'auto' }}
                            exit={{ height: 0 }}
                            className="overflow-hidden border-t border-gold/10 bg-vanilla/50"
                          >
                            <div className="p-3">
                              <table className="w-full text-xs">
                                <thead className="bg-vanilla/60 text-text-secondary">
                                  <tr>
                                    <th className="text-left px-2 py-1.5 font-medium">{t('ingredient')}</th>
                                    <th className="text-right px-2 py-1.5 font-medium">Quantité</th>
                                    <th className="text-right px-2 py-1.5 font-medium">P.U Achat</th>
                                    <th className="text-right px-2 py-1.5 font-medium">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {p.usedProducts.map((u, ui) => (
                                    <tr key={ui} className="border-t border-gold/5">
                                      <td className="px-2 py-1.5 font-medium text-text-primary">{u.productName}</td>
                                      <td className="px-2 py-1.5 text-right tabular">{u.quantityUsed}{u.unit ? ` ${u.unit}` : ''}</td>
                                      <td className="px-2 py-1.5 text-right tabular">{formatCurrency(u.unitCost ?? 0)}</td>
                                      <td className="px-2 py-1.5 text-right tabular text-rose-deep font-semibold">{formatCurrency(u.lineCost ?? (u.quantityUsed * (u.unitCost ?? 0)))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
                {report.rProductions.length === 0 && <EmptyState message={t('noData')} />}
              </div>
            </Card>

            {/* Purchases by Category Accordion */}
            <Card index={1} className="border border-gold/15">
              <h3 className="font-display font-semibold text-text-primary mb-4 flex items-center gap-2">
                <ShoppingCart size={18} className="text-gold-dark" /> Achats groupés par Catégorie
              </h3>
              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {report.purchasesByCategory.map((cat) => {
                  const isOpen = expandedCatName === cat.categoryName;
                  return (
                    <div key={cat.categoryName} className="border border-gold/10 rounded-xl overflow-hidden bg-vanilla/10">
                      <button
                        onClick={() => setExpandedCatName(isOpen ? null : cat.categoryName)}
                        className="w-full flex items-center justify-between p-3 text-left hover:bg-gold/5 transition-colors"
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <p className="font-semibold text-sm text-text-primary truncate">{cat.categoryName}</p>
                          <p className="text-xs text-text-muted">{cat.productsList.length} articles achetés</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs font-bold text-gold-dark">{formatCurrency(cat.totalAmount)}</span>
                          {isOpen ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
                        </div>
                      </button>
                      <AnimatePresence>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: 'auto' }}
                            exit={{ height: 0 }}
                            className="overflow-hidden border-t border-gold/10 bg-vanilla/50"
                          >
                            <div className="p-3">
                              <table className="w-full text-xs">
                                <thead className="bg-vanilla/60 text-text-secondary">
                                  <tr>
                                    <th className="text-left px-2 py-1.5 font-medium">Produit</th>
                                    <th className="text-right px-2 py-1.5 font-medium">Quantité</th>
                                    <th className="text-right px-2 py-1.5 font-medium">P.U Moyen</th>
                                    <th className="text-right px-2 py-1.5 font-medium">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {cat.productsList.map((p, pi) => {
                                    const avgPrice = p.quantity > 0 ? p.totalCost / p.quantity : 0;
                                    return (
                                      <tr key={pi} className="border-t border-gold/5">
                                        <td className="px-2 py-1.5 font-medium text-text-primary">{p.name}</td>
                                        <td className="px-2 py-1.5 text-right tabular">{p.quantity}{p.unit ? ` ${p.unit}` : ''}</td>
                                        <td className="px-2 py-1.5 text-right tabular">{formatCurrency(avgPrice)}</td>
                                        <td className="px-2 py-1.5 text-right tabular text-gold-dark font-semibold">{formatCurrency(p.totalCost)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
                {report.purchasesByCategory.length === 0 && <EmptyState message={t('noData')} />}
              </div>
            </Card>
          </div>

          {/* ===== Productions avec perte (loss) ===== */}
          <SectionTitle icon={<AlertTriangle size={18} />} title={t('lossProductions')} />
          <Card index={0} className="border border-gold/15">
            {report.lossProductions.length === 0 ? (
              <EmptyState message={t('noLoss')} icon={<AlertTriangle size={28} />} />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-rose-deep/5 border border-rose-deep/20 rounded-xl p-3 text-center">
                    <p className="text-xs text-text-muted">{t('lossProductions')}</p>
                    <p className="text-xl font-bold text-rose-deep tabular">{report.lossProductions.length}</p>
                  </div>
                  <div className="bg-rose-deep/5 border border-rose-deep/20 rounded-xl p-3 text-center">
                    <p className="text-xs text-text-muted">{t('totalLoss')}</p>
                    <p className="text-xl font-bold text-rose-deep tabular">{report.totalLossQty}</p>
                  </div>
                  <div className="bg-rose-deep/5 border border-rose-deep/20 rounded-xl p-3 text-center">
                    <p className="text-xs text-text-muted">{t('totalLossValue')}</p>
                    <p className="text-xl font-bold text-rose-deep tabular">{formatCurrency(report.totalLossValue)}</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-vanilla/60 text-text-secondary"><tr>
                      <th className="text-left px-3 py-2">{t('production')}</th>
                      <th className="text-left px-3 py-2">{t('date')}</th>
                      <th className="text-right px-3 py-2">{t('expectedQty')}</th>
                      <th className="text-right px-3 py-2">{t('realProducedQty')}</th>
                      <th className="text-right px-3 py-2">{t('lossQty')}</th>
                      <th className="text-right px-3 py-2">{t('lossValueLabel')}</th>
                    </tr></thead>
                    <tbody>
                      {report.lossProductions.map((p) => {
                        const su = p.sellByUnit && p.sellUnit ? ` ${p.sellUnit}` : '';
                        return (
                          <tr key={p.id} className="border-t border-gold/10">
                            <td className="px-3 py-2 font-medium text-text-primary">
                              {p.name}
                              {p.categoryName && <span className="block text-xs text-text-muted font-normal">{p.categoryName}</span>}
                              {p.lossDescription && <span className="block text-xs text-text-muted italic font-normal">📝 {p.lossDescription}</span>}
                            </td>
                            <td className="px-3 py-2 text-text-muted whitespace-nowrap">{formatDate(p.date, language)} — {p.hour}</td>
                            <td className="px-3 py-2 text-right tabular">{p.expectedQuantity}{su}</td>
                            <td className="px-3 py-2 text-right tabular text-gold-dark font-semibold">{p.outputQuantity}{su}</td>
                            <td className="px-3 py-2 text-right tabular text-rose-deep font-bold">− {p.lossQuantity}{su}</td>
                            <td className="px-3 py-2 text-right tabular text-rose-deep font-bold">{formatCurrency(p.lossValue ?? 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gold/15 bg-vanilla/40 font-bold">
                        <td className="px-3 py-2" colSpan={4}>{t('total')}</td>
                        <td className="px-3 py-2 text-right tabular text-rose-deep">{report.totalLossQty}</td>
                        <td className="px-3 py-2 text-right tabular text-rose-deep">{formatCurrency(report.totalLossValue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </Card>

          {/* ===== Category breakdown: expenses / deposits / withdrawals ===== */}
          <SectionTitle icon={<Tag size={18} />} title={t('categoryBreakdown')} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <CategorySummaryCard title={t('expensesByCategory')} icon={<Banknote size={16} />} cats={report.expensesByCategory} total={report.totalExpenses} tone="rose" emptyLabel={t('noData')} />
            <CategorySummaryCard title={t('depositsByCategory')} icon={<ArrowDownLeft size={16} />} cats={report.depositsByCategory} total={report.depositsTotal} tone="pistachio" emptyLabel={t('noData')} />
            <CategorySummaryCard title={t('withdrawalsByCategory')} icon={<ArrowUpRight size={16} />} cats={report.withdrawalsByCategory} total={report.withdrawalsTotal} tone="caramel" emptyLabel={t('noData')} />
          </div>

          {/* ===== Comptoir & destructions ===== */}
          <SectionTitle icon={<Flame size={18} />} title={t('comptoirReport')} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <DrillCard icon={<Flame size={20} />} accent="rose" label={t('destruction')} value={report.destroyedValue} count={report.rDestructions.length}
              onClick={() => setDrill({ title: t('destructionHistory'), rows: report.rDestructions.map((d) => ({ title: d.productName, sub: `${d.quantity} unités · ${d.reason} · ${formatDate(d.date, language)}`, value: d.value, danger: true })) })} />
            <DrillCard icon={<Trophy size={20} />} accent="pistachio" label={t('bestSellers')} value={report.soldRanked[0]?.revenue || 0} count={Math.min(5, report.soldRanked.length)}
              onClick={() => setDrill({ title: t('bestSellers'), rows: report.soldRanked.slice(0, 5).map((p) => ({ title: p.name, sub: `${p.units} ${t('unitsSold')}`, value: p.revenue })) })} />
            <DrillCard icon={<TrendingDown size={20} />} accent="caramel" label={t('worstSellers')} value={0} count={Math.min(5, report.soldRanked.length)} hideValue
              onClick={() => setDrill({ title: t('worstSellers'), rows: report.soldRanked.slice().reverse().slice(0, 5).map((p) => ({ title: p.name, sub: `${p.units} ${t('unitsSold')}`, value: p.revenue })) })} />
            <DrillCard icon={<FlaskConical size={20} />} accent="lavender" label={t('productionProducts')} value={report.rProductions.reduce((a, p) => a + p.outputQuantity, 0)} isCount count={report.rProductions.length}
              onClick={() => setDrill({ title: t('productionProducts'), rows: report.rProductions.map((p) => ({ title: p.name, sub: `${p.usedProducts.length} ingrédient(s) · ${formatDate(p.date, language)}`, value: p.outputQuantity })) })} />
          </div>

          {/* ===== Per-product sales & comptoir rest ===== */}
          <SectionTitle icon={<Receipt size={18} />} title={t('productSales')} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <DrillCard icon={<Receipt size={20} />} accent="pistachio" label={t('productSales')} value={report.productSalesRevenue} count={report.soldRanked.length}
              onClick={() => setDrill({ title: t('productSales'), rows: report.soldRanked.map((p) => ({ title: p.name, sub: `${p.units}${p.sellByUnit && p.unit ? ' ' + p.unit : ''} ${t('unitsSold')}`, value: p.revenue })) })} />
            <DrillCard icon={<Coins size={20} />} accent="caramel" label={t('soldQty')} value={report.soldRanked.reduce((a, p) => a + p.units, 0)} isCount count={report.soldRanked.length}
              onClick={() => setDrill({ title: t('soldQty'), rows: report.soldRanked.map((p) => ({ title: p.name, sub: `${formatCurrency(p.revenue)}`, value: p.units })) })} />
            <DrillCard icon={<Beaker size={20} />} accent="gold" label={t('restAtComptoir')} value={report.comptoirValue} count={report.restItems.length}
              onClick={() => setDrill({ title: t('restAtComptoir'), rows: report.restItems.map((p) => ({ title: p.name, sub: `${p.quantity}${p.unit ? ' ' + p.unit : ' unités'}`, value: p.value })) })} />
            <DrillCard icon={<Package size={20} />} accent="lavender" label={t('restValue')} value={report.comptoirValue} count={report.restItems.length}
              onClick={() => setDrill({ title: t('restValue'), rows: report.restItems.map((p) => ({ title: p.name, sub: `${p.quantity}${p.unit ? ' ' + p.unit : ' unités'}`, value: p.value })) })} />
          </div>

          {/* ===== Expenses & workers ===== */}
          <SectionTitle icon={<Banknote size={18} />} title={`${t('expensesReport')} & ${t('workers')}`} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <DrillCard icon={<Banknote size={20} />} accent="rose" label={t('expenses')} value={report.totalExpenses} count={report.rExpenses.length}
              onClick={() => setDrill({ title: t('expenses'), rows: report.rExpenses.map((e) => ({ title: e.name, sub: `${e.description} · ${formatDate(e.date, language)}`, value: e.amount })) })} />
            <DrillCard icon={<HardHat size={20} />} accent="lavender" label={t('workerSalaries')} value={report.workerPayments} count={workers.length}
              onClick={() => setDrill({ title: t('workerSalaries'), rows: workers.flatMap((w) => w.payments.filter((p) => isWithinRange(p.date, from, to)).map((p) => ({ title: w.fullName, sub: `${p.period || ''} · ${formatDate(p.date, language)}`, value: p.amount }))) })} />
            <DrillCard icon={<Clock size={20} />} accent="caramel" label="Heures sup. payées" value={report.overtimePaid} count={report.rOvertimes.length}
              onClick={() => setDrill({ title: 'Heures supplémentaires payées', rows: report.rOvertimes.filter((o) => o.isPaid).map((o) => ({ title: o.workerName, sub: `${formatDate(o.date, language)} · ${o.hours.toFixed(2)} h`, value: o.amount })) })} />
            <DrillCard icon={<Clock size={20} />} accent="rose" label="Heures sup. à payer" value={report.overtimeUnpaid} count={report.rOvertimes.filter((o) => !o.isPaid).length}
              onClick={() => setDrill({ title: 'Heures supplémentaires non payées', rows: report.rOvertimes.filter((o) => !o.isPaid).map((o) => ({ title: o.workerName, sub: `${formatDate(o.date, language)} · ${o.hours.toFixed(2)} h`, value: o.amount, danger: true })) })} />
            <DrillCard icon={<Coins size={20} />} accent="caramel" label={t('acomptes')} value={report.workerAcomptes} count={workers.length}
              onClick={() => setDrill({ title: t('acomptes'), rows: workers.flatMap((w) => w.acomptes.filter((a) => isWithinRange(a.date, from, to)).map((a) => ({ title: w.fullName, sub: `${a.description || ''} · ${formatDate(a.date, language)}`, value: a.amount }))) })} />
            <DrillCard icon={<Users size={20} />} accent="pistachio" label={t('activeWorkers')} value={workers.length} isCount count={workers.length}
              onClick={() => setDrill({ title: t('workers'), rows: workers.map((w) => ({ title: w.fullName, sub: w.phone, value: w.paymentAmount })) })} />
          </div>

          {/* ===== Caisse operations & decalages ===== */}
          <SectionTitle icon={<Wallet size={18} />} title={t('caisseReport')} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <DrillCard icon={<ArrowDownLeft size={20} />} accent="pistachio" label={t('totalDeposits')} value={report.depositsTotal} count={report.deposits.length}
              onClick={() => setDrill({ title: t('totalDeposits'), rows: report.deposits.map((d) => ({ title: d.description || t('deposit'), sub: formatDate(d.date, language), value: d.amount })) })} />
            <DrillCard icon={<ArrowUpRight size={20} />} accent="rose" label={t('totalWithdrawals')} value={report.withdrawalsTotal} count={report.withdrawals.length}
              onClick={() => setDrill({ title: t('totalWithdrawals'), rows: report.withdrawals.map((d) => ({ title: d.description || t('withdrawal'), sub: formatDate(d.date, language), value: d.amount, danger: true })) })} />
            <DrillCard icon={<Scale size={20} />} accent={Math.abs(report.totalDecalage) < 0.01 ? 'pistachio' : 'rose'} label={t('reportsDecalage')} value={report.totalDecalage} count={report.reportCalcs.length} signed
              onClick={() => setDrill({ title: t('reportsDecalage'), rows: report.reportCalcs.map(({ report: r, calc }) => ({ title: `${formatDate(r.date, language)} — ${r.hour}`, sub: `${t('declaredAmount')}: ${formatCurrency(r.declaredAmount)} · ${t('theoreticalBalance')}: ${formatCurrency(calc.theoretical)}`, value: calc.decalage, danger: Math.abs(calc.decalage) >= 0.01 })) })} />
            <DrillCard icon={<FileText size={20} />} accent="lavender" label={t('caisseReports')} value={report.reportCalcs.length} isCount count={report.reportCalcs.length}
              onClick={() => setDrill({ title: t('caisseReports'), rows: report.reportCalcs.map(({ report: r }) => ({ title: `${formatDate(r.date, language)} — ${r.hour}`, sub: r.description, value: r.declaredAmount })) })} />
          </div>
        </motion.div>
      )}

      {/* Drill-down modal */}
      <Modal open={!!drill} onClose={() => setDrill(null)} title={drill?.title} size="md">
        {drill && <DrillList rows={drill.rows} emptyLabel={t('noData')} />}
      </Modal>
    </div>
  );
}

function CategorySummaryCard({ title, icon, cats, total, tone, emptyLabel }: {
  title: string; icon: React.ReactNode;
  cats: { id: string; name: string; total: number; items: unknown[] }[];
  total: number; tone: string; emptyLabel: string;
}) {
  const text = ACCENT_TEXT[tone] || 'text-gold-dark';
  const grad = ACCENTS[tone] || ACCENTS.gold;
  const max = Math.max(1, ...cats.map((c) => c.total));
  return (
    <Card index={0} className="border border-gold/15">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-text-primary flex items-center gap-2">
          <span className={`h-8 w-8 rounded-lg bg-gradient-to-br flex items-center justify-center text-white ${grad}`}>{icon}</span> {title}
        </h3>
        <span className={`text-sm font-bold tabular ${text}`}>{formatCurrency(total)}</span>
      </div>
      {cats.length === 0 ? (
        <EmptyState message={emptyLabel} icon={<Tag size={26} />} />
      ) : (
        <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
          {cats.map((cat) => (
            <div key={cat.id} className="rounded-xl border border-gold/10 bg-vanilla/40 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text-primary truncate flex items-center gap-1.5"><Tag size={12} className="text-gold-dark" /> {cat.name}</span>
                <span className={`text-sm font-bold tabular shrink-0 ${text}`}>{formatCurrency(cat.total)}</span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="h-1.5 flex-1 rounded-full bg-vanilla/50 overflow-hidden">
                  <div className={`h-full rounded-full bg-gradient-to-r ${grad}`} style={{ width: `${(cat.total / max) * 100}%` }} />
                </div>
                <span className="text-[10px] text-text-muted shrink-0">{cat.items.length}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function OverviewTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <Card index={0}>
      <div className={`${ACCENT_TEXT[accent]} mb-2`}>{icon}</div>
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`text-xl font-bold tabular ${ACCENT_TEXT[accent]}`}>{formatCurrency(value)}</p>
    </Card>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h3 className="font-display font-semibold text-text-primary flex items-center gap-2 pt-2">
      <span className="text-gold-dark">{icon}</span> {title}
    </h3>
  );
}

function DrillCard({ icon, label, value, accent, count, onClick, isCount, signed, hideValue }: {
  icon: React.ReactNode; label: string; value: number; accent: string; count: number;
  onClick: () => void; isCount?: boolean; signed?: boolean; hideValue?: boolean;
}) {
  const sign = signed && value > 0 ? '+ ' : signed && value < 0 ? '− ' : '';
  return (
    <motion.button whileHover={{ y: -3 }} whileTap={{ scale: 0.97 }} onClick={onClick}
      className="relative overflow-hidden rounded-2xl bg-gradient-card border border-gold/15 shadow-card p-5 text-left">
      <div className={`absolute -top-6 -right-6 h-20 w-20 rounded-full bg-gradient-to-br opacity-10 ${ACCENTS[accent]}`} />
      <div className="flex items-start justify-between mb-3">
        <div className={`h-11 w-11 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shadow-sm ${ACCENTS[accent]}`}>{icon}</div>
        <ChevronRight size={18} className="text-text-muted" />
      </div>
      <p className="text-sm text-text-muted mb-1">{label}</p>
      {!hideValue && (
        <p className={`text-xl font-bold tabular ${ACCENT_TEXT[accent]}`}>
          {isCount ? Math.round(value) : `${sign}${formatCurrency(Math.abs(value))}`}
        </p>
      )}
      <p className="text-xs text-text-muted mt-1">{count} {count > 1 ? 'éléments' : 'élément'} · 👆</p>
    </motion.button>
  );
}

function DrillList({ rows, emptyLabel }: { rows: Row[]; emptyLabel: string }) {
  if (rows.length === 0) return <EmptyState message={emptyLabel} />;
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
      <AnimatePresence initial={false}>
        {rows.map((r, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 p-3 rounded-xl bg-vanilla/40 border border-gold/10">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary truncate">{r.title}</p>
              {r.sub && <p className="text-xs text-text-muted truncate">{r.sub}</p>}
            </div>
            <p className={`text-sm font-bold tabular shrink-0 ${r.danger ? 'text-rose-deep' : 'text-gold-dark'}`}>{formatCurrency(r.value)}</p>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="flex justify-between border-t border-gold/15 pt-3 px-1 font-bold sticky bottom-0 bg-cream">
        <span className="text-text-primary">Total</span>
        <span className="tabular text-gold-dark">{formatCurrency(total)}</span>
      </div>
    </div>
  );
}
