import { supabase } from '@/lib/supabase';
import { toCommand } from '@/lib/db';
import type { Command } from '@/store/commandStore';

export type CommandStatusFilter = 'all' | 'paid' | 'debt' | 'undelivered' | 'partial' | 'delivered';
export interface CommandSummaryFilters {
  search?: string;
  scope?: 'real' | 'historical' | 'all';
  status?: CommandStatusFilter;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}
export interface CommandSummary extends Command {
  /** Aggregate quantities are for list rendering only. Load the order by ID before acting. */
  isSummary: true;
  orderedQuantity: number;
  deliveredQuantity: number;
  cancelledQuantity: number;
}
export interface CommandSummaryPage {
  rows: CommandSummary[];
  totalCount: number;
  stats: {
    totalPaid: number; totalRest: number; totalValue: number;
    pendingDelivery: number; invoiced: number; invoicedRest: number;
  };
  counts: Record<Exclude<CommandStatusFilter, 'all'>, number>;
}

/** One bounded page and aggregate totals over the complete filtered result. */
export async function listCommandSummaries(filters: CommandSummaryFilters = {}): Promise<CommandSummaryPage> {
  const { data, error } = await supabase.rpc('list_command_summaries', {
    p_search: filters.search ?? '', p_scope: filters.scope ?? 'real',
    p_status: filters.status ?? 'all', p_from: filters.from ?? null,
    p_to: filters.to ?? null, p_limit: Math.min(100, Math.max(1, filters.limit ?? 50)),
    p_offset: Math.max(0, filters.offset ?? 0),
  });
  // Do not silently fall back to fetching history on an old deployment.
  if (error) throw new Error(`[commands.summary] ${error.message}`);
  const number = (value: unknown): number => Number(value) || 0;
  return {
    rows: (data.rows ?? []).map((row: Record<string, unknown>): CommandSummary => {
      const ordered = number(row.ordered_quantity);
      const delivered = number(row.delivered_quantity);
      const cancelled = number(row.cancelled_quantity);
      return {
        ...toCommand(row), isSummary: true,
        orderedQuantity: ordered, deliveredQuantity: delivered, cancelledQuantity: cancelled,
        items: [{ productName: '', quantity: ordered, deliveredQuantity: delivered,
          cancelledQuantity: cancelled, unitPrice: 0, totalPrice: number(row.total_amount) }],
      };
    }),
    totalCount: number(data.total_count),
    stats: {
      totalPaid: number(data.stats?.totalPaid), totalRest: number(data.stats?.totalRest),
      totalValue: number(data.stats?.totalValue), pendingDelivery: number(data.stats?.pendingDelivery),
      invoiced: number(data.stats?.invoiced), invoicedRest: number(data.stats?.invoicedRest),
    },
    counts: {
      paid: number(data.counts?.paid), debt: number(data.counts?.debt),
      undelivered: number(data.counts?.undelivered), partial: number(data.counts?.partial),
      delivered: number(data.counts?.delivered),
    },
  };
}
