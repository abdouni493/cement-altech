import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Purchase } from '@/types';
import { uid } from '@/lib/utils';
import { getCurrentUsername } from './authStore';
import { db, rpc } from '@/lib/db';
import { push } from '@/lib/persist';

export type AddPurchaseInput = Omit<Purchase, 'id' | 'reference' | 'date' | 'totalAmount' | 'restAmount' | 'payments'> & {
  date?: string;
  totalAmount?: number;
  restAmount?: number;
  payments?: Purchase['payments'];
};

interface PurchaseState {
  purchases: Purchase[];
  addPurchase: (p: AddPurchaseInput) => Purchase;
  paySupplierDebt: (purchaseId: string, amount: number, date?: string) => void;
  payDebt: (purchaseId: string, amount: number, date?: string) => void;
  deletePurchase: (id: string) => void;
}

export const usePurchaseStore = create<PurchaseState>()(
  persist(
    (set, get) => {
      const payFn = (purchaseId: string, amount: number, date?: string) => {
        push('purchases.payDebt', () => rpc.paySupplierDebt(purchaseId, amount, date));
        set({
          purchases: get().purchases.map((pur) => {
            if (pur.id !== purchaseId) return pur;
            const newPaid = Math.min(pur.totalAmount, pur.paidAmount + amount);
            const newRest = Math.max(0, pur.totalAmount - newPaid);
            const payDate = date || new Date().toISOString().slice(0, 10);
            return {
              ...pur,
              paidAmount: newPaid,
              restAmount: newRest,
              payments: [...(pur.payments || []), { date: payDate, amount, description: 'Règlement fournisseur' }],
            };
          }),
        });
      };

      return {
        purchases: [],
        addPurchase: (p) => {
          const count = get().purchases.length + 1;
          const ref = `ACH-${new Date().getFullYear()}-${String(count).padStart(3, '0')}`;
          const total = p.totalAmount ?? p.products.reduce((acc, pr) => acc + pr.quantity * pr.purchasePrice, 0);
          const paid = p.paidAmount || 0;
          const rest = p.restAmount ?? Math.max(0, total - paid);
          const purDate = p.date || new Date().toISOString().slice(0, 10);

          const purchase: Purchase = {
            ...p,
            id: uid('pur'),
            reference: ref,
            date: purDate,
            totalAmount: total,
            paidAmount: paid,
            restAmount: rest,
            payments: p.payments || (paid > 0 ? [{ date: purDate, amount: paid, description: 'Acompte achat' }] : []),
            createdBy: p.createdBy || getCurrentUsername(),
          };
          set({ purchases: [purchase, ...get().purchases] });

          // create_purchase() inserts the purchase + its lines, feeds the stock
          // (trg_purchase_line_stock) and books the caisse withdrawal.
          push(
            'purchases.create',
            () =>
              rpc.createPurchase({
                supplier_id: purchase.supplierId,
                date: purchase.date,
                total_amount: purchase.totalAmount,
                paid_amount: purchase.paidAmount,
                products: purchase.products.map((l) => ({
                  product_id: l.productId,
                  product_name: l.productName,
                  quantity: l.quantity,
                  purchase_price: l.purchasePrice,
                  min_alert_quantity: l.minAlertQuantity ?? null,
                  unit_enabled: l.unitEnabled ?? false,
                  unit: l.unit ?? null,
                  expiration_enabled: l.expirationEnabled ?? false,
                  expiration_date: l.expirationDate,
                })),
              }),
            (row: { id: string; reference: string }) =>
              set({
                purchases: get().purchases.map((p) =>
                  p.id === purchase.id
                    ? { ...p, id: row.id, reference: row.reference || p.reference }
                    : p
                ),
              })
          );
          return purchase;
        },
        paySupplierDebt: payFn,
        payDebt: payFn,
        deletePurchase: (id) => {
          set({ purchases: get().purchases.filter((p) => p.id !== id) });
          push('purchases.delete', () => db.purchases.remove(id));
        },
      };
    },
    { name: 'altech-purchases' }
  )
);
