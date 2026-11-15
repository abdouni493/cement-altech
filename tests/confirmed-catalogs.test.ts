import { beforeEach, expect, it, vi } from 'vitest';
import type { Sale, Product, Production, ComptoirItem } from '../src/types';
const fixtures = vi.hoisted(() => ({
  db: {
    sales: { list: vi.fn() }, products: { list: vi.fn() }, productions: { list: vi.fn() }, comptoir: { list: vi.fn(), destructions: vi.fn(async () => []) },
    marques: { list: vi.fn(async () => []) }, categories: { list: vi.fn(async () => []) }, units: { list: vi.fn(async () => []) }, productionCategories: { list: vi.fn(async () => []) },
  },
  rpc: { createSale: vi.fn(), createSaleWithProductions: vi.fn(), createProduction: vi.fn(), transferToComptoir: vi.fn() },
  readPosCommitted: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: fixtures.db, rpc: fixtures.rpc }));
vi.mock('@/lib/posQueries', () => ({ readPosCommitted: fixtures.readPosCommitted }));
vi.mock('@/lib/persist', () => ({ save: async (_label: string, run: () => unknown) => run(), trySave: async (_label: string, run: () => unknown) => run() }));
vi.mock('@/components/ui/Toast', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
import { useSalesStore, applyConfirmedSales } from '../src/store/salesStore';
import { useStockStore, applyConfirmedStock } from '../src/store/stockStore';
import { useComptoirStore, applyConfirmedComptoir } from '../src/store/comptoirStore';
import { useProductionStore, applyConfirmedProductions } from '../src/store/productionStore';

beforeEach(() => {
  vi.clearAllMocks();
  useSalesStore.setState({ sales: [] }); useStockStore.setState({ products: [] });
  useComptoirStore.setState({ items: [] }); useProductionStore.setState({ productions: [] });
});
it('prevents old in-flight history/catalog reads from overwriting committed records', async () => {
  const cases = [
    { load: () => useSalesStore.getState().load(), deferred: fixtures.db.sales.list, apply: () => applyConfirmedSales([{ id: 'new' } as Sale]), records: () => useSalesStore.getState().sales },
    { load: () => useStockStore.getState().load(), deferred: fixtures.db.products.list, apply: () => applyConfirmedStock([{ id: 'new' } as Product]), records: () => useStockStore.getState().products },
    { load: () => useComptoirStore.getState().load(), deferred: fixtures.db.comptoir.list, apply: () => applyConfirmedComptoir([{ id: 'new' } as ComptoirItem]), records: () => useComptoirStore.getState().items },
    { load: () => useProductionStore.getState().load(), deferred: fixtures.db.productions.list, apply: () => applyConfirmedProductions([{ id: 'new' } as Production]), records: () => useProductionStore.getState().productions },
  ];
  for (const scenario of cases) {
    let resolve!: (value: { id: string }[]) => void;
    scenario.deferred.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const loading = scenario.load();
    scenario.apply();
    resolve([{ id: 'old' }]);
    await loading;
    expect(scenario.records().map((row) => row.id)).toEqual(['new']);
  }
});
it('confirms a plain POS sale from targeted records without unfiltered history calls', async () => {
  const sale = { id: 'sale-new', reference: 'VNT-2026-1000', isHistorical: false } as Sale;
  fixtures.rpc.createSale.mockResolvedValue({ id: sale.id, reference: sale.reference });
  fixtures.readPosCommitted.mockResolvedValue({ sale, productions: [], products: [], comptoir: [], productIds: [], comptoirIds: [] });
  const result = await useSalesStore.getState().addPosSale({ clientId: null, paidAmount: 10, products: [{ productId: 'lot-a', productName: 'Ciment', quantity: 1, sellingPrice: 10 }], productions: [] });
  expect(result.id).toBe(sale.id);
  expect(fixtures.readPosCommitted).toHaveBeenCalledExactlyOnceWith(sale.id, []);
  expect(fixtures.db.sales.list).not.toHaveBeenCalled();
  expect(fixtures.db.productions.list).not.toHaveBeenCalled();
  expect(fixtures.db.comptoir.list).not.toHaveBeenCalled();
  expect(fixtures.db.products.list).not.toHaveBeenCalled();
});
it('keeps a confirmed POS write successful when targeted readback fails', async () => {
  fixtures.rpc.createSale.mockResolvedValue({ id: 'confirmed', reference: 'VNT-2026-1001' });
  fixtures.readPosCommitted.mockRejectedValue(new Error('lost readback'));
  const result = await useSalesStore.getState().addPosSale({ clientId: null, paidAmount: 10, products: [{ productId: 'lot-a', productName: 'Ciment', quantity: 1, sellingPrice: 10 }], productions: [] });
  expect(result.id).toBe('confirmed');
  expect(useSalesStore.getState().sales[0].id).toBe('confirmed');
  expect(fixtures.rpc.createSale).toHaveBeenCalledTimes(1);
  expect(fixtures.db.sales.list).not.toHaveBeenCalled();
});

it('fails closed when atomic POS SQL is absent instead of issuing partial stock writes', async () => {
  fixtures.rpc.createSaleWithProductions.mockRejectedValue(new Error('PGRST202 Could not find the function'));
  await expect(useSalesStore.getState().addPosSale({
    clientId: null, paidAmount: 10,
    products: [{ lineKey: 'line-a', productId: 'fiche-a', productName: 'Ciment', quantity: 1, sellingPrice: 10 }],
    productions: [{ lineKey: 'line-a', ficheTechnicId: 'fiche-a', name: 'Ciment', outputQuantity: 1, unitPrice: 10, usedProducts: [] }],
  })).rejects.toThrow('PGRST202');
  expect(fixtures.rpc.createSaleWithProductions).toHaveBeenCalledTimes(1);
  expect(fixtures.rpc.createProduction).not.toHaveBeenCalled();
  expect(fixtures.rpc.transferToComptoir).not.toHaveBeenCalled();
  expect(fixtures.rpc.createSale).not.toHaveBeenCalled();
  expect(fixtures.readPosCommitted).not.toHaveBeenCalled();
});
