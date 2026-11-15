import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const user: { id: string; role: string; permissions: 'all' | Record<string, { view?: boolean }> } = { id: 'cashier-a', role: 'admin', permissions: 'all' };
  const makeStore = () => {
    const initial = { load: vi.fn(async () => undefined), records: [] as string[] };
    let value = { ...initial };
    return { getState: () => value, getInitialState: () => initial,
      setState: vi.fn((next: typeof initial) => { value = { ...next }; }) };
  };
  const stores = Object.fromEntries(['stock', 'suppliers', 'deliverers', 'clients', 'debts', 'purchases', 'sales', 'commands', 'productions', 'fiches', 'comptoir', 'workers', 'expenses', 'caisse', 'caisseReports', 'settings'].map((key) => [key, makeStore()]));
  return { user, stores, catalog: vi.fn(async () => undefined), busy: false };
});
vi.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => ({ user: state.user }) } }));
vi.mock('@/store/stockStore', () => ({ useStockStore: state.stores.stock }));
vi.mock('@/store/supplierStore', () => ({ useSupplierStore: state.stores.suppliers }));
vi.mock('@/store/delivererStore', () => ({ useDelivererStore: state.stores.deliverers }));
vi.mock('@/store/clientStore', () => ({ useClientStore: state.stores.clients, loadClientCatalog: state.catalog }));
vi.mock('@/store/clientDebtStore', () => ({ useClientDebtStore: state.stores.debts }));
vi.mock('@/store/purchaseStore', () => ({ usePurchaseStore: state.stores.purchases }));
vi.mock('@/store/salesStore', () => ({ useSalesStore: state.stores.sales }));
vi.mock('@/store/commandStore', () => ({ useCommandStore: state.stores.commands }));
vi.mock('@/store/productionStore', () => ({ useProductionStore: state.stores.productions }));
vi.mock('@/store/ficheTechnicStore', () => ({ useFicheTechnicStore: state.stores.fiches }));
vi.mock('@/store/comptoirStore', () => ({ useComptoirStore: state.stores.comptoir }));
vi.mock('@/store/workerStore', () => ({ useWorkerStore: state.stores.workers }));
vi.mock('@/store/expenseStore', () => ({ useExpenseStore: state.stores.expenses }));
vi.mock('@/store/caisseStore', () => ({ useCaisseStore: state.stores.caisse }));
vi.mock('@/store/caisseReportStore', () => ({ useCaisseReportStore: state.stores.caisseReports }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: state.stores.settings }));
vi.mock('@/lib/persist', () => ({ isWriteBusy: () => state.busy }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.user.id = 'cashier-a'; state.user.role = 'admin'; state.user.permissions = 'all'; state.busy = false;
  state.catalog.mockImplementation(async () => undefined);
  for (const store of Object.values(state.stores)) store.getInitialState().load.mockImplementation(async () => undefined);
});

describe('route hydration scheduler', () => {
  it('hydrates direct commands navigation without reading any transaction history', async () => {
    const { hydrateFromSupabase } = await import('../src/lib/sync');
    const first = hydrateFromSupabase({ pathname: '/commands' });
    const same = hydrateFromSupabase({ pathname: '/commands' });
    expect(same).toBe(first);
    expect(await first).toEqual({ ok: true, failed: [] });
    expect(state.catalog).toHaveBeenCalledTimes(1);
    expect(state.stores.fiches.getState().load).toHaveBeenCalledTimes(1);
    for (const key of ['commands', 'sales', 'purchases', 'caisse', 'clients']) {
      expect(state.stores[key].getState().load).not.toHaveBeenCalled();
    }
  });
  it('focus refresh yields to an operator write and denies forbidden routes', async () => {
    const { hydrateFromSupabase } = await import('../src/lib/sync');
    state.busy = true;
    await hydrateFromSupabase({ pathname: '/reports', force: false });
    expect(state.stores.commands.getState().load).not.toHaveBeenCalled();
    state.busy = false; state.user.role = 'worker'; state.user.permissions = { pos: { view: true } };
    await hydrateFromSupabase({ pathname: '/reports' });
    expect(state.stores.commands.getState().load).not.toHaveBeenCalled();
  });
  it('drains the previous account before loading the new one', async () => {
    let finishOld!: () => void;
    const oldRead = new Promise<void>((resolve) => { finishOld = resolve; });
    const events: string[] = [];
    state.catalog.mockImplementationOnce(async () => {
      events.push('old-start'); await oldRead; events.push('old-finish');
    }).mockImplementationOnce(async () => { events.push('new-start'); });
    const { hydrateFromSupabase } = await import('../src/lib/sync');
    const old = hydrateFromSupabase({ pathname: '/commands' });
    await vi.waitFor(() => expect(events).toEqual(['old-start']));
    state.user.id = 'cashier-b';
    const next = hydrateFromSupabase({ pathname: '/commands' });
    expect(events).toEqual(['old-start']);
    finishOld(); await Promise.all([old, next]);
    expect(events).toEqual(['old-start', 'old-finish', 'new-start']);
    expect(state.stores.clients.setState).toHaveBeenCalledTimes(2);
  });
  it('refreshes only active dependencies for cross-terminal freshness', async () => {
    const { hydrateFromSupabase } = await import('../src/lib/sync');
    await hydrateFromSupabase({ pathname: '/pos' });
    await hydrateFromSupabase({ pathname: '/pos', force: false });
    expect(state.catalog).toHaveBeenCalledTimes(1);
    expect(state.stores.sales.getState().load).not.toHaveBeenCalled();
    expect(state.stores.commands.getState().load).not.toHaveBeenCalled();
  });
});
