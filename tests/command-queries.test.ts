import { beforeEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('@/lib/db', () => ({ toCommand: (row: Record<string, unknown>) => ({ id: row.id, items: [] }) }));
import { listCommandSummaries } from '../src/lib/commandQueries';

beforeEach(() => { vi.clearAllMocks(); });
it('fetches one bounded filtered summary page with complete aggregate totals', async () => {
  rpc.mockResolvedValue({ error: null, data: {
    rows: [{ id: 'cmd-duplicate-product-lines', ordered_quantity: '125', delivered_quantity: '50', cancelled_quantity: '25', total_amount: '7500' }],
    total_count: '4000', stats: { totalPaid: '100000', totalRest: '25000', totalValue: '125000', pendingDelivery: '1234', invoiced: '87000', invoicedRest: '22000' },
    counts: { paid: '3000', debt: '1000', undelivered: '1200', partial: '34', delivered: '2766' },
  } });
  const page = await listCommandSummaries({ search: 'CMD-2026', status: 'partial', scope: 'historical', from: '2026-01-01T00:00:00Z', offset: 100, limit: 500 });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('list_command_summaries', {
    p_search: 'CMD-2026', p_scope: 'historical', p_status: 'partial', p_from: '2026-01-01T00:00:00Z', p_to: null, p_limit: 100, p_offset: 100,
  });
  expect(page.totalCount).toBe(4000);
  expect(page.stats.totalRest).toBe(25000);
  expect(page.counts.partial).toBe(34);
  expect(page.rows[0]).toMatchObject({ isSummary: true, orderedQuantity: 125, deliveredQuantity: 50, cancelledQuantity: 25,
    items: [{ productName: '', quantity: 125, deliveredQuantity: 50, cancelledQuantity: 25, unitPrice: 0, totalPrice: 7500 }] });
});
it('does not replace a missing migration with unfiltered history reads', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'function list_command_summaries not found' } });
  await expect(listCommandSummaries()).rejects.toThrow('[commands.summary] function list_command_summaries not found');
  expect(rpc).toHaveBeenCalledTimes(1);
});
