import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), getPurchase: vi.fn(), list: vi.fn(),
  create: vi.fn(), pay: vi.fn(), warning: vi.fn(), invalidate: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock('@/lib/db', () => ({
  toPurchase: (row: Record<string, unknown>) => ({ id: row.id, products: [], payments: [] }),
  db: { purchases: { list: mocks.list } },
  rpc: { createPurchase: mocks.create, paySupplierDebt: mocks.pay },
}));
vi.mock('@/lib/persist', () => ({ save: (_label: string, run: () => Promise<unknown>) => run() }));
vi.mock('@/components/ui/Toast', () => ({ toast: { warning: mocks.warning, error: vi.fn() } }));
vi.mock('@/lib/background', () => ({ inBackground: mocks.invalidate }));
vi.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: 'local-admin' } }) } }));
vi.mock('@/store/stockStore', () => ({ useStockStore: { getState: () => ({ load: vi.fn() }) } }));
vi.mock('@/store/caisseStore', () => ({ useCaisseStore: { getState: () => ({ load: vi.fn() }) } }));
// Keep the query adapter real in the first suite, then spy its detail API in the store suite.
import * as queries from '../src/lib/purchaseQueries';
import { usePurchaseStore } from '../src/store/purchaseStore';

beforeEach(() => {
  vi.clearAllMocks();
  usePurchaseStore.setState({ purchases: [], revision: 0 });
});

describe('bounded purchase query API', () => {
  it('passes all filters, caps page size and preserves totals over all results', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: {
      rows: [{ id: 'purchase', line_count: '2', units: ['kg', 'm3'] }], total_count: '5000',
      stats: { totalPurchases: '10000', totalPaid: '6500', totalDebt: '3500' },
    } });
    const result = await queries.listPurchaseSummaries({
      search: 'Driver', unit: 'kg', from: '2025-01-01', to: '2025-12-31', limit: 1000, offset: 100,
      delivererIds: ['73000000-0000-0000-0000-000000000001', 'invalid-local-id'],
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_purchase_summaries', {
      p_search: 'Driver', p_unit: 'kg', p_from: '2025-01-01', p_to: '2025-12-31', p_limit: 100, p_offset: 100,
      p_deliverer_ids: ['73000000-0000-0000-0000-000000000001'],
    });
    expect(result.totalCount).toBe(5000);
    expect(result.stats.totalDebt).toBe(3500);
    expect(result.rows[0]).toMatchObject({ isSummary: true, lineCount: 2, units: ['kg', 'm3'] });
  });
  it('fails visibly on missing SQL instead of reading unfiltered history', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'Missing list_purchase_summaries' }, data: null });
    await expect(queries.listPurchaseSummaries({})).rejects.toThrow('Missing list_purchase_summaries');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('purchase save/readback isolation', () => {
  const fixture = { id: 'confirmed', reference: 'ACH-2026-1000', date: '2026-11-15', supplierId: 'supplier',
    products: [], payments: [], totalAmount: 100, paidAmount: 20, restAmount: 80, isHistorical: true };
  it('reads only the confirmed ID and an older full read cannot overwrite it', async () => {
    let finish!: (rows: unknown[]) => void;
    mocks.list.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const detail = vi.spyOn(queries, 'getPurchase').mockResolvedValue(fixture);
    mocks.create.mockResolvedValue({ id: fixture.id, reference: fixture.reference });
    const oldRead = usePurchaseStore.getState().load();
    await expect(usePurchaseStore.getState().addPurchase(fixture)).resolves.toMatchObject({ id: fixture.id });
    expect(detail).toHaveBeenCalledExactlyOnceWith(fixture.id);
    expect(mocks.list).toHaveBeenCalledTimes(1); // Only the deliberately pre-existing report read.
    finish([]); await oldRead;
    expect(usePurchaseStore.getState().purchases.map((p) => p.id)).toEqual([fixture.id]);
    detail.mockRestore();
  });
  it('does not replay a confirmed create when its targeted readback fails', async () => {
    const detail = vi.spyOn(queries, 'getPurchase').mockRejectedValue(new Error('network lost after commit'));
    mocks.create.mockResolvedValue({ id: fixture.id, reference: fixture.reference });
    await expect(usePurchaseStore.getState().addPurchase(fixture)).resolves.toMatchObject({ id: fixture.id });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('Achat enregistré'));
    detail.mockRestore();
  });
});
