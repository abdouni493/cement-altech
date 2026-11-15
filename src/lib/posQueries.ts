import { supabase } from '@/lib/supabase';
import { toSale, toProduction, toProduct, toComptoirItem } from '@/lib/db';
import type { Sale, Production, Product, ComptoirItem } from '@/types';

type DatabaseRow = Record<string, unknown>;

/** Paging remains constrained to this sale or the submitted IDs, never history. */
type RowQuery = { range: (from: number, to: number) => PromiseLike<{ data: DatabaseRow[] | null; error: { message: string } | null }> };
async function affectedRows(build: () => RowQuery): Promise<DatabaseRow[]> {
  const rows: DatabaseRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build().range(offset, offset + 999);
    if (error) throw new Error(`[pos.readback] ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function rowsByIds(table: string, ids: string[]): Promise<DatabaseRow[]> {
  const rows: DatabaseRow[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const chunk = unique.slice(offset, offset + 100);
    rows.push(...await affectedRows(() => supabase.from(table).select('*').in('id', chunk).order('id')));
  }
  return rows;
}

export interface PosCommittedResult {
  sale: Sale;
  productions: Production[];
  products: Product[];
  comptoir: ComptoirItem[];
  productIds: string[];
  comptoirIds: string[];
}

/** Fetch only records needed to confirm and print the committed POS operation. */
export async function readPosCommitted(saleId: string, fallbackProductionIds: string[] = []): Promise<PosCommittedResult> {
  const { data: row, error } = await supabase.from('sales')
    .select('*, sale_lines(*), sale_payments(*)').eq('id', saleId).single();
  if (error) throw new Error(`[pos.readback] ${error.message}`);
  const batches = await affectedRows(() => supabase.from('productions')
    .select('*, production_used_products(*)').eq('sale_id', saleId).order('id'));
  if (fallbackProductionIds.length) {
    for (let offset = 0; offset < fallbackProductionIds.length; offset += 100) {
      batches.push(...await affectedRows(() => supabase.from('productions')
        .select('*, production_used_products(*)').in('id', fallbackProductionIds.slice(offset, offset + 100)).order('id')));
    }
  }
  const productions = [...new Map(batches.map((batch) => [batch.id, toProduction(batch)])).values()];
  const saleLines: DatabaseRow[] = row.sale_lines ?? [];
  const comptoirIds = [...new Set(saleLines.map((line) => String(line.comptoir_id ?? '')).filter(Boolean))];
  const productIds = [...new Set([
    ...saleLines.map((line) => String(line.product_id ?? '')).filter(Boolean),
    ...productions.flatMap((batch) => batch.usedProducts.filter((line) => line.sourceType !== 'fiche').map((line) => line.productId)).filter(Boolean),
  ])];
  const [products, comptoir] = await Promise.all([
    rowsByIds('products', productIds), rowsByIds('comptoir_items', comptoirIds),
  ]);
  return { sale: toSale(row), productions, productIds, comptoirIds,
    products: products.map(toProduct), comptoir: comptoir.map(toComptoirItem) };
}
