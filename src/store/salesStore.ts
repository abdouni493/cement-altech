import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Sale } from '@/types';
import { uid } from '@/lib/utils';
import { getCurrentUsername } from './authStore';
import { db, rpc } from '@/lib/db';
import { push } from '@/lib/persist';
import { useComptoirStore } from './comptoirStore';

export type AddSaleInput = Omit<Sale, 'id' | 'reference' | 'date' | 'totalAmount' | 'finalAmount' | 'restAmount' | 'status' | 'payments'> & {
  date?: string;
  totalAmount?: number;
  finalAmount?: number;
  restAmount?: number;
  status?: Sale['status'];
  payments?: Sale['payments'];
};

interface SalesState {
  sales: Sale[];
  addSale: (s: AddSaleInput) => Sale;
  payDebt: (saleId: string, amount: number, date?: string) => void;
  deleteSale: (id: string) => void;
}

export const useSalesStore = create<SalesState>()(
  persist(
    (set, get) => ({
      sales: [],
      addSale: (s) => {
        const count = get().sales.length + 1;
        const ref = `VNT-${new Date().getFullYear()}-${String(count).padStart(3, '0')}`;
        const total = s.totalAmount ?? s.products.reduce((acc, p) => acc + p.quantity * p.sellingPrice, 0);
        const red = s.reduction || 0;
        const final = s.finalAmount ?? Math.max(0, total - red);
        const paid = s.paidAmount || 0;
        const rest = s.restAmount ?? Math.max(0, final - paid);
        const status = s.status ?? (rest === 0 ? 'paid' : 'debt');
        const saleDate = s.date || new Date().toISOString().slice(0, 10);

        const sale: Sale = {
          ...s,
          id: uid('sal'),
          reference: ref,
          date: saleDate,
          totalAmount: total,
          reduction: red,
          finalAmount: final,
          paidAmount: paid,
          restAmount: rest,
          status,
          payments: s.payments || (paid > 0 ? [{ date: saleDate, amount: paid, description: 'Paiement vente' }] : []),
          createdBy: s.createdBy || getCurrentUsername(),
        };
        set({ sales: [sale, ...get().sales] });

        // Replayed on Supabase: create_sale() writes the sale, its lines and its
        // payment, decrements the stock/comptoir and books the caisse deposit.
        push(
          'sales.create',
          () =>
            rpc.createSale({
              client_id: sale.clientId,
              date: sale.date,
              reduction: sale.reduction,
              total_amount: sale.totalAmount,
              final_amount: sale.finalAmount,
              paid_amount: sale.paidAmount,
              // The POS sells comptoir items while /sales can sell raw stock
              // products: each line is routed to the right column so the SQL
              // side decrements the correct inventory.
              products: sale.products.map((p) => {
                const isComptoir = useComptoirStore
                  .getState()
                  .items.some((it) => it.id === p.productId);
                return {
                  product_id: isComptoir ? null : p.productId,
                  comptoir_id: isComptoir ? p.productId : null,
                  product_name: p.productName,
                  quantity: p.quantity,
                  selling_price: p.sellingPrice,
                  sell_by_unit: p.sellByUnit ?? false,
                  unit: p.unit ?? null,
                };
              }),
            }),
          (row: { id: string; reference: string }) =>
            set({
              sales: get().sales.map((s) =>
                s.id === sale.id ? { ...s, id: row.id, reference: row.reference || s.reference } : s
              ),
            })
        );
        return sale;
      },
      payDebt: (saleId, amount, date) => {
        push('sales.payDebt', () => rpc.paySaleDebt(saleId, amount, date));
        set({
          sales: get().sales.map((sale) => {
            if (sale.id !== saleId) return sale;
            const newPaid = Math.min(sale.finalAmount, sale.paidAmount + amount);
            const newRest = Math.max(0, sale.finalAmount - newPaid);
            const newStatus = newRest === 0 ? 'paid' : 'debt';
            const payDate = date || new Date().toISOString().slice(0, 10);
            return {
              ...sale,
              paidAmount: newPaid,
              restAmount: newRest,
              status: newStatus,
              payments: [...(sale.payments || []), { date: payDate, amount, description: 'Règlement dette' }],
            };
          }),
        });
      },
      deleteSale: (id) => {
        set({ sales: get().sales.filter((s) => s.id !== id) });
        push('sales.delete', () => db.sales.remove(id));
      },
    }),
    { name: 'altech-sales' }
  )
);
