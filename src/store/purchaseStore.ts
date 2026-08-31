import { create } from 'zustand';
import type { Purchase } from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';
import { toast } from '@/components/ui/Toast';
import { useStockStore } from './stockStore';

export type AddPurchaseInput = Omit<
  Purchase,
  'id' | 'reference' | 'date' | 'totalAmount' | 'restAmount' | 'payments'
> & {
  date?: string;
  totalAmount?: number;
  restAmount?: number;
  payments?: Purchase['payments'];
};

export interface UpdatePurchaseInput {
  date?: string;
  bonNumber?: string;
  driverPlate?: string;
  paidAmount?: number;
  note?: string;
}

interface PurchaseState {
  purchases: Purchase[];
  load: () => Promise<void>;
  addPurchase: (p: AddPurchaseInput) => Promise<Purchase>;
  /** Edits the commercial header of an invoice (date, bon, matricule, paid). */
  updatePurchase: (id: string, data: UpdatePurchaseInput) => Promise<void>;
  paySupplierDebt: (purchaseId: string, amount: number, date?: string) => Promise<void>;
  payDebt: (purchaseId: string, amount: number, date?: string) => Promise<void>;
  deletePurchase: (id: string) => Promise<void>;
}

export const usePurchaseStore = create<PurchaseState>()((set, get) => {
  const payFn = async (purchaseId: string, amount: number, date?: string) => {
    await save('purchases.payDebt', () => rpc.paySupplierDebt(purchaseId, amount, date));
    set({ purchases: await db.purchases.list() });
  };

  return {
    purchases: [],

    load: async () => set({ purchases: await db.purchases.list() }),

    addPurchase: async (p) => {
      const total =
        p.totalAmount ?? p.products.reduce((acc, pr) => acc + pr.quantity * pr.purchasePrice, 0);
      const paid = p.paidAmount || 0;
      const purDate = p.date || new Date().toISOString().slice(0, 10);

      // create_purchase() writes the invoice + its lines, feeds the stock
      // (trg_purchase_line_stock) and books the caisse withdrawal.
      // « Ancien achat » (is_historical) : la facture est enregistrée à sa date
      // d'origine mais ni le stock ni la caisse ne bougent.
      const row = await save('purchases.create', () =>
        rpc.createPurchase({
          supplier_id: p.supplierId,
          date: purDate,
          driver_plate: p.driverPlate?.trim() || null,
          bon_number: p.bonNumber?.trim() || null,
          is_historical: p.isHistorical ?? false,
          total_amount: total,
          paid_amount: paid,
          products: p.products.map((l) => ({
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
        })
      );

      // The purchase changed the stock: reload both lists from the database so
      // the /stock screen immediately shows the new quantities.
      const [purchases] = await Promise.all([db.purchases.list(), useStockStore.getState().load()]);
      set({ purchases });

      // Filet de sécurité : « ancien achat » n'existe que si
      // altech_production_update_anciens_achats_ventes_tva.sql a été exécuté.
      const saved = purchases.find((x) => x.id === row.id);
      if (p.isHistorical && saved && !saved.isHistorical) {
        toast.error(
          "Base de données non mise à jour : la facture a été enregistrée normalement " +
          "(stock alimenté). Exécutez altech_production_update_anciens_achats_ventes_tva.sql."
        );
      }

      return (
        purchases.find((x) => x.id === row.id) ?? {
          ...(p as unknown as Purchase),
          id: row.id,
          reference: row.reference,
          date: purDate,
          isHistorical: p.isHistorical ?? false,
          totalAmount: total,
          paidAmount: paid,
          restAmount: Math.max(0, total - paid),
          payments: [],
        }
      );
    },

    updatePurchase: async (id, data) => {
      await save('purchases.update', () =>
        rpc.updatePurchase(id, {
          date: data.date ?? null,
          bon_number: data.bonNumber ?? null,
          driver_plate: data.driverPlate ?? null,
          paid_amount: data.paidAmount ?? null,
          note: data.note ?? null,
        })
      );
      set({ purchases: await db.purchases.list() });
    },

    paySupplierDebt: payFn,
    payDebt: payFn,

    deletePurchase: async (id) => {
      await save('purchases.delete', () => db.purchases.remove(id));
      set({ purchases: get().purchases.filter((p) => p.id !== id) });
    },
  };
});
