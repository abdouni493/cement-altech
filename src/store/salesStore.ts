import { create } from 'zustand';
import type { Sale, SaleLine, UsedProduct } from '@/types';
import { db, rpc } from '@/lib/db';
import { save, trySave } from '@/lib/persist';
import { useComptoirStore } from './comptoirStore';
import { useProductionStore } from './productionStore';
import { useStockStore } from './stockStore';

export type AddSaleInput = Omit<
  Sale,
  'id' | 'reference' | 'date' | 'totalAmount' | 'finalAmount' | 'restAmount' | 'status' | 'payments'
> & {
  date?: string;
  totalAmount?: number;
  finalAmount?: number;
  restAmount?: number;
  status?: Sale['status'];
  payments?: Sale['payments'];
};

/**
 * A cart line the cashier built from a fiche technique: the batch does not
 * exist yet, it is produced at the very moment the sale is validated.
 */
export interface PosProductionInput {
  /** Ties this batch to its sale line (`SaleLine.lineKey`). */
  lineKey: string;
  ficheTechnicId: string;
  name: string;
  description?: string;
  categoryId?: string;
  categoryName?: string;
  /** Quantity the batch will yield — edited by the cashier. */
  outputQuantity: number;
  unitPrice: number;
  sellByUnit?: boolean;
  sellUnit?: string;
  usedProducts: UsedProduct[];
}

export type PosSaleLine = SaleLine & { lineKey?: string };

export interface AddPosSaleInput {
  clientId: string | null;
  date?: string;
  /** N° de bon de commande saisi manuellement (facultatif). */
  bonNumber?: string;
  reduction?: number;
  paidAmount: number;
  products: PosSaleLine[];
  productions: PosProductionInput[];
}

export interface UpdateSaleInput {
  date?: string;
  reduction?: number;
  paidAmount?: number;
  note?: string;
}

interface SalesState {
  sales: Sale[];
  load: () => Promise<void>;
  addSale: (s: AddSaleInput) => Promise<Sale>;
  /** POS: launches the productions of the cart, then writes the sale. */
  addPosSale: (s: AddPosSaleInput) => Promise<Sale>;
  updateSale: (id: string, data: UpdateSaleInput) => Promise<void>;
  payDebt: (saleId: string, amount: number, date?: string) => Promise<void>;
  deleteSale: (id: string) => Promise<void>;
}

const usedProductPayload = (u: UsedProduct) => ({
  product_id: u.productId || null,
  product_name: u.productName,
  quantity_used: u.quantityUsed,
  source_type: u.sourceType ?? 'stock',
  unit: u.unit ?? null,
  unit_cost: u.unitCost ?? 0,
  line_cost: u.lineCost ?? 0,
});

/** True when the database has not received the POS/production update yet. */
function isMissingFunction(message: string): boolean {
  return /PGRST202|Could not find the function|does not exist|schema cache/i.test(message);
}

export const useSalesStore = create<SalesState>()((set, get) => ({
  sales: [],

  load: async () => set({ sales: await db.sales.list() }),

  addSale: async (s) => {
    const total = s.totalAmount ?? s.products.reduce((acc, p) => acc + p.quantity * p.sellingPrice, 0);
    const red = s.reduction || 0;
    const final = s.finalAmount ?? Math.max(0, total - red);
    const paid = s.paidAmount || 0;
    const saleDate = s.date || new Date().toISOString();

    const comptoirItems = useComptoirStore.getState().items;

    // create_sale() writes the sale, its lines and its payment, decrements the
    // comptoir/stock and books the caisse deposit — all in one transaction.
    const row = await save('sales.create', () =>
      rpc.createSale({
        client_id: s.clientId,
        date: saleDate.slice(0, 10),
        bon_number: s.bonNumber ?? null,
        reduction: red,
        total_amount: total,
        final_amount: final,
        paid_amount: paid,
        products: s.products.map((p) => {
          const comptoir = comptoirItems.find((it) => it.id === p.productId);
          return {
            product_id: comptoir ? null : p.productId,
            comptoir_id: comptoir ? p.productId : null,
            product_name: p.productName,
            quantity: p.quantity,
            selling_price: p.sellingPrice,
            // the catalogue price, so the sale detail can show a price override
            base_price: p.basePrice ?? comptoir?.unitPrice ?? null,
            sell_by_unit: p.sellByUnit ?? false,
            unit: p.unit ?? null,
          };
        }),
      })
    );

    // a sale may have consumed comptoir items AND raw stock products
    const [sales] = await Promise.all([
      db.sales.list(),
      useComptoirStore.getState().load(),
      useStockStore.getState().load(),
    ]);
    set({ sales });

    return (
      sales.find((x) => x.id === row.id) ?? {
        ...(s as unknown as Sale),
        id: row.id,
        reference: row.reference,
        date: saleDate,
        totalAmount: total,
        reduction: red,
        finalAmount: final,
        paidAmount: paid,
        restAmount: Math.max(0, final - paid),
        status: final - paid <= 0 ? 'paid' : 'debt',
        payments: [],
      }
    );
  },

  addPosSale: async (input) => {
    const { productions } = input;
    const total = input.products.reduce((acc, p) => acc + p.quantity * p.sellingPrice, 0);
    const red = input.reduction || 0;
    const final = Math.max(0, total - red);
    const paid = input.paidAmount || 0;
    const saleDate = (input.date || new Date().toISOString()).slice(0, 10);

    // No fiche technique in the cart → the plain comptoir sale is enough.
    if (productions.length === 0) {
      return get().addSale({
        clientId: input.clientId,
        date: input.date,
        bonNumber: input.bonNumber,
        products: input.products,
        reduction: red,
        paidAmount: paid,
      } as AddSaleInput);
    }

    const comptoirItems = useComptoirStore.getState().items;
    const saleLinePayload = (p: PosSaleLine) => {
      const comptoir = comptoirItems.find((it) => it.id === p.productId);
      return {
        line_key: p.lineKey ?? null,
        product_id: p.lineKey ? null : comptoir ? null : p.productId,
        comptoir_id: p.lineKey ? null : comptoir ? p.productId : null,
        product_name: p.productName,
        quantity: p.quantity,
        selling_price: p.sellingPrice,
        base_price: p.basePrice ?? comptoir?.unitPrice ?? null,
        sell_by_unit: p.sellByUnit ?? false,
        unit: p.unit ?? null,
      };
    };

    const payload = {
      client_id: input.clientId,
      date: saleDate,
      bon_number: input.bonNumber ?? null,
      reduction: red,
      total_amount: total,
      final_amount: final,
      paid_amount: paid,
      products: input.products.map(saleLinePayload),
      productions: productions.map((pr) => ({
        line_key: pr.lineKey,
        fiche_technic_id: pr.ficheTechnicId,
        name: pr.name,
        description: pr.description ?? '',
        category_id: pr.categoryId || null,
        category_name: pr.categoryName || null,
        output_quantity: pr.outputQuantity,
        unit_price: pr.unitPrice,
        sell_by_unit: pr.sellByUnit ?? false,
        sell_unit: pr.sellUnit ?? null,
        used_products: pr.usedProducts.map(usedProductPayload),
      })),
    };

    const row = await save<{ id: string; reference: string }>('sales.createWithProductions', async () => {
      try {
        return await rpc.createSaleWithProductions(payload);
      } catch (e) {
        // A real business error (insufficient stock, …) must reach the cashier.
        if (!isMissingFunction((e as Error)?.message ?? '')) throw e;

        // The database has not received the POS update yet: replay the very
        // same steps one RPC at a time so the point of sale keeps working.
        const made: Record<string, { comptoirId: string; productionId: string }> = {};
        for (const pr of productions) {
          const prod = await rpc.createProduction({
            name: pr.name,
            description: pr.description ?? '',
            date: saleDate,
            hour: new Date().toTimeString().slice(0, 5),
            category_id: pr.categoryId || null,
            category_name: pr.categoryName || null,
            fiche_technic_id: pr.ficheTechnicId || null,
            output_quantity: pr.outputQuantity,
            unit_price: pr.unitPrice,
            sell_by_unit: pr.sellByUnit ?? false,
            sell_unit: pr.sellUnit ?? null,
            used_products: pr.usedProducts.map(usedProductPayload),
          });
          // output_quantity is stored as numeric(14,3): transfer what the row
          // really holds so the batch ceiling is never exceeded.
          const item = await rpc.transferToComptoir(prod.id, Number(prod.output_quantity));
          made[pr.lineKey] = { comptoirId: item.id, productionId: prod.id };
        }

        const sale = await rpc.createSale({
          client_id: input.clientId,
          date: saleDate,
          bon_number: input.bonNumber ?? null,
          reduction: red,
          total_amount: total,
          final_amount: final,
          paid_amount: paid,
          products: input.products.map((p) => {
            const line = saleLinePayload(p);
            const batch = p.lineKey ? made[p.lineKey] : undefined;
            return batch ? { ...line, comptoir_id: batch.comptoirId, product_id: null } : line;
          }),
        });

        // best effort — needs the columns added by the POS update
        for (const pr of productions) {
          const batch = made[pr.lineKey];
          if (!batch) continue;
          await trySave('productions.markPosOrigin', () =>
            db.productions.update(batch.productionId, {
              origin: 'pos', sale_id: sale.id, sale_reference: sale.reference,
            })
          );
        }
        return sale;
      }
    });

    // productions consumed stock, the comptoir was fed then sold: reload all
    const [sales] = await Promise.all([
      db.sales.list(),
      useComptoirStore.getState().load(),
      useProductionStore.getState().load(),
      useStockStore.getState().load(),
    ]);
    set({ sales });

    return (
      sales.find((x) => x.id === row.id) ?? {
        id: row.id,
        reference: row.reference,
        clientId: input.clientId,
        date: saleDate,
        bonNumber: input.bonNumber,
        products: input.products,
        totalAmount: total,
        reduction: red,
        finalAmount: final,
        paidAmount: paid,
        restAmount: Math.max(0, final - paid),
        status: final - paid <= 0 ? 'paid' : 'debt',
        payments: [],
      }
    );
  },

  updateSale: async (id, data) => {
    await save('sales.update', () =>
      rpc.updateSale(id, {
        date: data.date ?? null,
        reduction: data.reduction ?? null,
        paid_amount: data.paidAmount ?? null,
        note: data.note ?? null,
      })
    );
    set({ sales: await db.sales.list() });
  },

  payDebt: async (saleId, amount, date) => {
    await save('sales.payDebt', () => rpc.paySaleDebt(saleId, amount, date));
    set({ sales: await db.sales.list() });
  },

  deleteSale: async (id) => {
    await save('sales.delete', () => db.sales.remove(id));
    set({ sales: get().sales.filter((s) => s.id !== id) });
  },
}));
