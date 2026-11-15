import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  reads: [] as { table: string; filters: { key: string; values: unknown[] }[] }[],
  fail: false,
}));
vi.mock('@/lib/db', () => ({
  toSale: (row: Record<string, unknown>) => ({ id: row.id, reference: row.reference }),
  toProduction: (row: Record<string, unknown>) => ({ id: row.id, usedProducts: row.production_used_products ?? [] }),
  toProduct: (row: Record<string, unknown>) => row,
  toComptoirItem: (row: Record<string, unknown>) => row,
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from(table: string) {
  const filters: { key: string; values: unknown[] }[] = [];
  const result = () => {
    fixture.reads.push({ table, filters: [...filters] });
    return fixture.rows[table]?.filter((row) => filters.every((filter) => filter.values.includes(row[filter.key]))) ?? [];
  };
  const query = {
    select: () => query, order: () => query,
    eq: (key: string, value: unknown) => { filters.push({ key, values: [value] }); return query; },
    in: (key: string, values: unknown[]) => { filters.push({ key, values }); return query; },
    single: async () => ({ data: result()[0], error: fixture.fail ? { message: 'read unavailable' } : null }),
    range: async (from: number, to: number) => ({ data: result().slice(from, to + 1), error: null }),
  };
  return query;
} } }));
import { readPosCommitted } from '../src/lib/posQueries';

beforeEach(() => {
  fixture.fail = false; fixture.reads = [];
  fixture.rows = {
    sales: [{ id: 'sale-new', reference: 'VNT-2026-1000', sale_lines: [{ product_id: 'raw-a' }, { comptoir_id: 'lot-a' }] }, { id: 'other-sale' }],
    productions: [{ id: 'production-new', sale_id: 'sale-new', production_used_products: [{ productId: 'raw-b', sourceType: 'stock' }] }, { id: 'old-production', sale_id: 'other-sale' }],
    products: [{ id: 'raw-a', current_quantity: 8 }, { id: 'raw-b', current_quantity: 12 }, { id: 'unrelated' }],
    comptoir_items: [{ id: 'lot-a', quantity: 5 }, { id: 'old-lot' }],
  };
});
it('reads only the new sale, its productions and affected catalog IDs', async () => {
  const result = await readPosCommitted('sale-new');
  expect(result.sale.reference).toBe('VNT-2026-1000');
  expect(result.productions.map((row) => row.id)).toEqual(['production-new']);
  expect(result.products.map((row) => row.id)).toEqual(['raw-a', 'raw-b']);
  expect(result.comptoir.map((row) => row.id)).toEqual(['lot-a']);
  expect(fixture.reads).toHaveLength(4);
  for (const read of fixture.reads) expect(read.filters).not.toHaveLength(0);
});
it('includes legacy fallback productions by ID without duplicates or a history scan', async () => {
  fixture.rows.productions.push({ id: 'fallback-batch', sale_id: null, production_used_products: [{ productId: 'raw-a', sourceType: 'stock' }] });
  const result = await readPosCommitted('sale-new', ['production-new', 'fallback-batch']);
  expect(result.productions.map((row) => row.id)).toEqual(['production-new', 'fallback-batch']);
  expect(result.productIds).toEqual(['raw-a', 'raw-b']);
  for (const read of fixture.reads) expect(read.filters).not.toHaveLength(0);
});
it('does not fetch history when committed-sale readback fails', async () => {
  fixture.fail = true;
  await expect(readPosCommitted('sale-new')).rejects.toThrow('[pos.readback] read unavailable');
  expect(fixture.reads).toHaveLength(1);
});
it('bounds large submitted-ID lists in chunks without truncating results', async () => {
  fixture.rows.sales[0].sale_lines = Array.from({ length: 205 }, (_, i) => ({ product_id: `raw-${i}` }));
  fixture.rows.products = Array.from({ length: 205 }, (_, i) => ({ id: `raw-${i}` }));
  fixture.rows.productions = [];
  const result = await readPosCommitted('sale-new');
  expect(result.products).toHaveLength(205);
  const queries = fixture.reads.filter((read) => read.table === 'products');
  expect(queries).toHaveLength(3);
  expect(queries.every((read) => read.filters[0].values.length <= 100)).toBe(true);
});
