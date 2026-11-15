import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from } }));
import { rpc as businessRpc } from '../src/lib/db';

beforeEach(() => vi.clearAllMocks());

describe('purchase writes use only the transactional shared-numbering RPC', () => {
  it('returns the confirmed SQL receipt without reference history reads or direct inserts', async () => {
    const receipt = { id: 'purchase', reference: 'ACH-2026-1000' };
    rpc.mockResolvedValue({ data: receipt, error: null });
    await expect(businessRpc.createPurchase({ date: '2026-11-15', products: [] })).resolves.toEqual(receipt);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('create_purchase', { p_payload: { date: '2026-11-15', products: [] } });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'PGRST202', message: 'Could not find the function public.create_purchase' },
    { code: '57014', message: 'canceling statement due to statement timeout' },
    { code: '', message: 'Failed to fetch: response lost after commit' },
  ])('fails closed on $code/$message without a second write', async (error) => {
    rpc.mockResolvedValue({ data: null, error });
    await expect(businessRpc.createPurchase({ products: [] })).rejects.toThrow(`[rpc:create_purchase] ${error.message}`);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });
});
