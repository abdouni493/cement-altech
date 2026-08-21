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
import { useCaisseStore } from '@/store/caisseStore';
import { useCaisseReportStore } from '@/store/caisseReportStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Loads every screen from Supabase.
 *
 * Nothing is cached in localStorage any more: this is the ONLY source of the
 * data displayed by the application, so a refresh always shows the real rows.
 * Each block is independent — when a worker has no permission on a module its
 * RLS policy simply returns nothing and the other modules still load.
 */
let inFlight: Promise<{ ok: boolean; failed: string[] }> | null = null;
let lastRun = 0;

/**
 * Reloads everything, but never twice at the same time: two screens (or the
 * boot sequence and the login effect) asking together share the same request.
 * `force: false` also skips a reload that happened less than 15 s ago.
 */
export function hydrateFromSupabase(options: { force?: boolean } = {}) {
  const { force = true } = options;
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastRun < 15_000) {
    return Promise.resolve({ ok: true, failed: [] as string[] });
  }
  inFlight = runHydration().finally(() => {
    inFlight = null;
    lastRun = Date.now();
  });
  return inFlight;
}

async function runHydration(): Promise<{ ok: boolean; failed: string[] }> {
  const failed: string[] = [];

  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      failed.push(label);
      console.warn(`[sync] ${label}:`, (e as Error).message);
    }
  };

  await Promise.all([
    step('stock', () => useStockStore.getState().load()),
    step('fournisseurs', () => useSupplierStore.getState().load()),
    step('clients', () => useClientStore.getState().load()),
    step('achats', () => usePurchaseStore.getState().load()),
    step('ventes', () => useSalesStore.getState().load()),
    step('commandes', () => useCommandStore.getState().load()),
    step('productions', () => useProductionStore.getState().load()),
    step('fiches techniques', () => useFicheTechnicStore.getState().load()),
    step('comptoir', () => useComptoirStore.getState().load()),
    step('employés', () => useWorkerStore.getState().load()),
    step('dépenses', () => useExpenseStore.getState().load()),
    step('caisse', () => useCaisseStore.getState().load()),
    step('rapports de caisse', () => useCaisseReportStore.getState().load()),
    step('paramètres', () => useSettingsStore.getState().load()),
  ]);

  return { ok: failed.length === 0, failed };
}

/** Re-reads only the modules impacted by a cross-screen operation. */
export async function refreshMoney(): Promise<void> {
  await Promise.all([
    useCaisseStore.getState().load(),
    useSalesStore.getState().load(),
    usePurchaseStore.getState().load(),
  ]).catch(() => undefined);
}
