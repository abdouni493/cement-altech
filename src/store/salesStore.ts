import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Sale } from '@/types';
import { uid } from '@/lib/utils';
import { getCurrentUsername } from './authStore';

export const INITIAL_SALES: Sale[] = [
  {
    id: 'sal-1',
    reference: 'VNT-2026-001',
    date: '2026-07-20',
    clientId: 'cli-1',
    products: [
      { productId: 'prod-1', productName: 'Ciment Portland CPJ 42.5 (Sac 50kg)', quantity: 50, sellingPrice: 850 },
      { productId: 'prod-4', productName: 'Sable de Dune Lavé 0/2 (m³)', quantity: 10, sellingPrice: 2400 },
    ],
    totalAmount: 66500,
    reduction: 1500,
    finalAmount: 65000,
    paidAmount: 50000,
    restAmount: 15000,
    status: 'debt',
    payments: [{ date: '2026-07-20', amount: 50000, description: 'Acompte comptoir' }],
    createdBy: 'admin',
  },
  {
    id: 'sal-2',
    reference: 'VNT-2026-002',
    date: '2026-07-22',
    clientId: 'cli-2',
    products: [
      { productId: 'prod-3', productName: 'Béton Prêt à l\'Emploi B25 (m³)', quantity: 15, sellingPrice: 9800 },
    ],
    totalAmount: 147000,
    reduction: 2000,
    finalAmount: 145000,
    paidAmount: 145000,
    restAmount: 0,
    status: 'paid',
    payments: [{ date: '2026-07-22', amount: 145000, description: 'Paiement comptant' }],
    createdBy: 'admin',
  },
  {
    id: 'sal-3',
    reference: 'VNT-2026-003',
    date: '2026-07-25',
    clientId: 'cli-3',
    products: [
      { productId: 'prod-6', productName: 'Rond à Béton FeE500 12mm (Tonne)', quantity: 2, sellingPrice: 128000 },
    ],
    totalAmount: 256000,
    reduction: 6000,
    finalAmount: 250000,
    paidAmount: 150000,
    restAmount: 100000,
    status: 'debt',
    payments: [{ date: '2026-07-25', amount: 150000, description: 'Acompte par versement' }],
    createdBy: 'admin',
  },
];

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
      sales: INITIAL_SALES,
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
        return sale;
      },
      payDebt: (saleId, amount, date) =>
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
        }),
      deleteSale: (id) => set({ sales: get().sales.filter((s) => s.id !== id) }),
    }),
    {
      name: 'labochimie-sales',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SalesState>;
        return {
          ...current,
          ...p,
          sales: p.sales && p.sales.length ? p.sales : INITIAL_SALES,
        };
      },
    }
  )
);
