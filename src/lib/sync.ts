import { useStockStore } from '@/store/stockStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useDelivererStore } from '@/store/delivererStore';
import { useClientStore, loadClientCatalog } from '@/store/clientStore';
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
import { useClientDebtStore } from '@/store/clientDebtStore';
import { useAuthStore } from '@/store/authStore';
import { modulesForRoute, permissionForRoute, type DataModule } from '@/lib/routeData';
import { invalidateModules, isModuleInvalidated, markModuleFresh, resetInvalidations } from '@/lib/background';
import { isWriteBusy } from '@/lib/persist';


type HydrationResult = { ok: boolean; failed: string[] };
const emptyResult = (): HydrationResult => ({ ok: true, failed: [] });
const lastRun = new Map<DataModule, number>();
const pending = new Map<string, Promise<HydrationResult>>();
let queue: Promise<unknown> = Promise.resolve();
let activeAccount: string | null = null;
let latestRoute = '';

const loaders: Record<DataModule, () => Promise<unknown>> = {
  stock: () => useStockStore.getState().load(),
  suppliers: () => useSupplierStore.getState().load(),
  deliverers: () => useDelivererStore.getState().load(),
  // Command/POS forms need current credit and address, not every ledger row.
  clients: loadClientCatalog,
  clientLedger: () => useClientStore.getState().load(),
  clientDebts: () => useClientDebtStore.getState().load(),
  purchases: () => usePurchaseStore.getState().load(),
  sales: () => useSalesStore.getState().load(),
  commands: () => useCommandStore.getState().load(),
  productions: () => useProductionStore.getState().load(),
  fiches: () => useFicheTechnicStore.getState().load(),
  comptoir: () => useComptoirStore.getState().load(),
  workers: () => useWorkerStore.getState().load(),
  expenses: () => useExpenseStore.getState().load(),
  caisse: () => useCaisseStore.getState().load(),
  caisseReports: () => useCaisseReportStore.getState().load(),
  settings: () => useSettingsStore.getState().load(),
};

function resetStores(): void {
  const stores: { getInitialState: () => unknown; setState: (state: never, replace: true) => void }[] = [useStockStore, useSupplierStore, useDelivererStore, useClientStore,
    useClientDebtStore, usePurchaseStore, useSalesStore, useCommandStore,
    useProductionStore, useFicheTechnicStore, useComptoirStore, useWorkerStore,
    useExpenseStore, useCaisseStore, useCaisseReportStore, useSettingsStore];
  stores.forEach((store) => store.setState(store.getInitialState() as never, true));
  lastRun.clear();
  resetInvalidations();
}

/** Prevent the next account from inheriting data or freshness from its predecessor. */
export function clearHydratedData(): void {
  latestRoute = '';
  activeAccount = null;
  resetStores();
  // A previous account's read may still be finishing; drain it before clearing
  // once more. Subsequent hydration is queued behind this barrier.
  queue = queue.then(() => { resetStores(); });
}

/**
 * Load only the current screen. Full-history pages retain their explicit
 * dependencies; command summaries/details are fetched by the command page.
 * Navigation and account switches serialize behind old reads, so one account's
 * late response cannot overwrite another account's freshly loaded data.
 */
export function hydrateFromSupabase(options: { force?: boolean; pathname?: string } = {}): Promise<HydrationResult> {
  const { force = true } = options;
  const user = useAuthStore.getState().user;
  const account = user?.id;
  const pathname = options.pathname ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  latestRoute = pathname;
  const permission = permissionForRoute(pathname);
  if (user && user.role !== 'admin' && user.permissions !== 'all' && permission &&
      !user.permissions[permission as keyof typeof user.permissions]?.view) return Promise.resolve(emptyResult());
  if (!account || modulesForRoute(pathname).length === 0) return Promise.resolve(emptyResult());
  if (!force && (isWriteBusy() || (typeof document !== 'undefined' && document.visibilityState === 'hidden'))) {
    return Promise.resolve(emptyResult());
  }
  const requestKey = `${account}:${pathname}`;
  const existing = pending.get(requestKey);
  if (existing) return existing;
  const run = queue.then(async () => {
    if (useAuthStore.getState().user?.id !== account || latestRoute !== pathname) return emptyResult();
    if (activeAccount !== account) {
      resetStores();
      activeAccount = account;
    }
    const failed: string[] = [];
    // Two reads at a time leaves capacity for an operator's transaction.
    const tasks = modulesForRoute(pathname).filter((key) => force || isModuleInvalidated(key) || Date.now() - (lastRun.get(key) ?? 0) >= 60_000);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, tasks.length) }, async () => {
      while (next < tasks.length) {
        if (useAuthStore.getState().user?.id !== account || latestRoute !== pathname) return;
        // A focus refresh must yield to writes, even if a write starts after it.
        if (!force && isWriteBusy()) return;
        const key = tasks[next++];
        try {
          await loaders[key]();
          markModuleFresh(key);
          lastRun.set(key, Date.now());
        } catch (error) {
          failed.push(key);
          console.warn(`[sync] ${key}:`, (error as Error).message);
        }
      }
    }));
    return { ok: failed.length === 0, failed };
  });
  queue = run.catch(() => undefined);
  pending.set(requestKey, run);
  void run.finally(() => { if (pending.get(requestKey) === run) pending.delete(requestKey); });
  return run;
}

/** A money write invalidates other screens; route entry performs their reads. */
export async function refreshMoney(): Promise<void> {
  invalidateModules('caisse', 'sales', 'purchases');
}
