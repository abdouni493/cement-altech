import { db } from './db';
import { useStockStore } from '@/store/stockStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useClientStore } from '@/store/clientStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useSalesStore } from '@/store/salesStore';
import { useCommandStore } from '@/store/commandStore';
import { useProductionStore } from '@/store/productionStore';
import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { useComptoirStore } from '@/store/comptoirStore';
import { useWorkerStore } from '@/store/workerStore';
import { useExpenseStore } from '@/store/expenseStore';
import { useClientDebtStore } from '@/store/clientDebtStore';
import { useCaisseStore } from '@/store/caisseStore';
import { useCaisseReportStore } from '@/store/caisseReportStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Loads every screen's data from Supabase into the local stores.
 *
 * Each block is independent: when a worker has no permission on a module its
 * RLS policy simply returns nothing and the other modules still load.
 */
export async function hydrateFromSupabase(): Promise<{ ok: boolean; failed: string[] }> {
  const failed: string[] = [];

  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      failed.push(label);
      console.warn(`[sync] ${label}:`, (e as Error).message);
    }
  };

  await Promise.all([
    // ---------------------------------------------------------- /stock ----
    step('stock', async () => {
      const [products, marques, categories, units] = await Promise.all([
        db.products.list(), db.marques.list(), db.categories.list(), db.units.list(),
      ]);
      useStockStore.setState((s) => ({
        products: products.length ? products : s.products,
        marques: marques.length ? marques : s.marques,
        categories: categories.length ? categories : s.categories,
        units: units.length ? units : s.units,
      }));
    }),

    // ------------------------------------------------------ /suppliers ----
    step('suppliers', async () => {
      const suppliers = await db.suppliers.list();
      if (suppliers.length) useSupplierStore.setState({ suppliers });
    }),

    // -------------------------------------------------------- /clients ----
    step('clients', async () => {
      const clients = await db.clients.list();
      if (clients.length) useClientStore.setState({ clients });
    }),

    // ------------------------------------------------------- /purchase ----
    step('purchases', async () => {
      usePurchaseStore.setState({ purchases: await db.purchases.list() });
    }),

    // ---------------------------------------------------------- /sales ----
    step('sales', async () => {
      useSalesStore.setState({ sales: await db.sales.list() });
    }),

    // ------------------------------------------------------- /commands ----
    step('commands', async () => {
      useCommandStore.setState({ commands: await db.commands.list() });
    }),

    // ----------------------------------------------------- /production ----
    step('productions', async () => {
      const [productions, categories] = await Promise.all([
        db.productions.list(), db.productionCategories.list(),
      ]);
      useProductionStore.setState((s) => ({
        productions,
        categories: categories.length ? categories : s.categories,
      }));
    }),

    step('fiches techniques', async () => {
      const ficheTechnics = await db.ficheTechnics.list();
      if (ficheTechnics.length) useFicheTechnicStore.setState({ ficheTechnics });
    }),

    // ------------------------------------------------------- /comptoir ----
    step('comptoir', async () => {
      const [items, destructions] = await Promise.all([
        db.comptoir.list(), db.comptoir.destructions(),
      ]);
      useComptoirStore.setState({ items, destructions });
    }),

    // -------------------------------------------------------- /workers ----
    step('workers', async () => {
      const [workers, roles] = await Promise.all([db.workers.list(), db.roles.list()]);
      useWorkerStore.setState((s) => ({
        workers: workers.length ? workers : s.workers,
        roles: roles.length ? roles : s.roles,
      }));
    }),

    // ------------------------------------------------------- /expenses ----
    step('expenses', async () => {
      const [expenses, categories] = await Promise.all([
        db.expenses.list(), db.expenseCategories.list(),
      ]);
      useExpenseStore.setState((s) => ({
        expenses,
        categories: categories.length ? categories : s.categories,
      }));
    }),

    step('dettes clients', async () => {
      useClientDebtStore.setState({ debts: await db.clientDebts.list() });
    }),

    // --------------------------------------------------------- /caisse ----
    step('caisse', async () => {
      const [transactions, categories, initialBalance] = await Promise.all([
        db.caisse.list(), db.caisseCategories.list(), db.caisse.initialBalance(),
      ]);
      useCaisseStore.setState((s) => ({
        transactions,
        categories: categories.length ? categories : s.categories,
        initialBalance,
      }));
    }),

    step('rapports de caisse', async () => {
      useCaisseReportStore.setState({ reports: await db.caisseReports.list() });
    }),

    // ------------------------------------------------------- /settings ----
    step('paramètres', async () => {
      const settings = await db.settings.get();
      if (settings) useSettingsStore.setState({ settings });
    }),
  ]);

  return { ok: failed.length === 0, failed };
}
