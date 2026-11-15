import { supabase } from '@/lib/supabase';
import { toPurchase } from '@/lib/db';
import type { Purchase } from '@/types';

export interface PurchaseSummary extends Purchase {
  isSummary: true;
  lineCount: number;
  units: string[];
}
export interface PurchaseSummaryPage {
  rows: PurchaseSummary[];
  totalCount: number;
  stats: { totalPurchases: number; totalPaid: number; totalDebt: number };
}
export function isPurchaseSummary(value: Purchase): value is PurchaseSummary {
  return 'isSummary' in value && value.isSummary === true;
}

/** Read one invoice after a confirmed write or before a detail/print action. */
export async function getPurchase(id: string): Promise<Purchase> {
  const { data, error } = await supabase.from('purchases')
    .select('*, purchase_lines(*), purchase_payments(*)').eq('id', id).single();
  if (error) throw new Error(`[purchases.get] ${error.message}`);
  return toPurchase(data);
}

export async function listPurchaseSummaries(filters: {
  search?: string; unit?: string; from?: string | null; to?: string | null;
  delivererIds?: string[]; limit?: number; offset?: number;
}): Promise<PurchaseSummaryPage> {
  const { data, error } = await supabase.rpc('list_purchase_summaries', {
    p_search: filters.search ?? '', p_unit: filters.unit ?? '',
    p_from: filters.from ?? null, p_to: filters.to ?? null,
    // Deliverer assignments live only in this browser; send matching IDs, not personal data.
    p_deliverer_ids: (filters.delivererIds ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
    p_limit: Math.min(100,Math.max(1,filters.limit ?? 50)), p_offset: Math.max(0,filters.offset ?? 0),
  });
  if (error) throw new Error(`[purchases.summary] ${error.message}`);
  const num = (v: unknown) => Number(v) || 0;
  return {
    rows: (data.rows ?? []).map((r: Record<string, unknown>) => ({
      ...toPurchase(r), isSummary: true, lineCount: num(r.line_count),
      units: Array.isArray(r.units) ? r.units.filter((u): u is string => typeof u === 'string') : [],
    })),
    totalCount: num(data.total_count),
    stats: { totalPurchases: num(data.stats?.totalPurchases),
      totalPaid: num(data.stats?.totalPaid), totalDebt: num(data.stats?.totalDebt) },
  };
}
