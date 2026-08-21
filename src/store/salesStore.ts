import { create } from 'zustand';
import type { Sale } from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';
import { useComptoirStore } from './comptoirStore';

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

interface SalesState {
  sales: Sale[];
  load: () => Promise<void>;
  addSale: (s: AddSaleInput) => Promise<Sale>;
  payDebt: (saleId: string, amount: number, date?: string) => Promise<void>;
  deleteSale: (id: string) => Promise<void>;
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

    const [sales] = await Promise.all([db.sales.list(), useComptoirStore.getState().load()]);
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

  payDebt: async (saleId, amount, date) => {
    await save('sales.payDebt', () => rpc.paySaleDebt(saleId, amount, date));
    set({ sales: await db.sales.list() });
  },

  deleteSale: async (id) => {
    await save('sales.delete', () => db.sales.remove(id));
    set({ sales: get().sales.filter((s) => s.id !== id) });
  },
}));
