/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from './supabase';
import type {
  Product, Marque, Category, Unit, Supplier, Client, ClientDebt, Sale, Purchase,
  Production, ComptoirItem, Destruction, Worker, Role, Expense, CaisseTransaction,
  CaisseReport, StoreSettings, PartyPayment, CommandDelivery, WorkerOvertime,
  PurchaseOrder,
} from '@/types';
import type { Command } from '@/store/commandStore';
import type { FicheTechnic } from '@/store/ficheTechnicStore';

/**
 * Data access layer for the Supabase project.
 * Mirrors `altech_production_supabase.sql`:
 *  - `db.<entity>.list()`  reads a screen
 *  - `db.<entity>.create/update/remove()` are the CRUD buttons
 *  - `rpc.*` are the business buttons (payer, envoyer au comptoir, détruire, …)
 */

// ---------------------------------------------------------------- helpers ----
async function select<T>(table: string, columns = '*', order?: string): Promise<T[]> {
  let q = supabase.from(table).select(columns);
  if (order) q = q.order(order, { ascending: false });
  const { data, error } = await q;
  if (error) throw new Error(`[${table}] ${error.message}`);
  return (data ?? []) as T[];
}

/** True when the error means "this table/column does not exist yet". */
function isMissingSchema(message: string): boolean {
  return /Could not find the table|does not exist|schema cache|PGRST205|PGRST200|42P01|42703/i.test(message);
}

/**
 * Same as `select()` but returns an empty list when the table has not been
 * created yet — the screens introduced by the 2026 update stay usable before
 * `altech_production_update_2026.sql` has been executed.
 */
async function selectOptional<T>(table: string, columns = '*', order?: string): Promise<T[]> {
  try {
    return await select<T>(table, columns, order);
  } catch (e) {
    const msg = (e as Error).message;
    if (isMissingSchema(msg)) {
      console.warn(`[db] ${table} absente — exécutez altech_production_update_2026.sql`);
      return [];
    }
    throw e;
  }
}

async function insert<T>(table: string, row: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw new Error(`[${table}] ${error.message}`);
  return data as T;
}

async function update<T>(table: string, id: string, row: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.from(table).update(row).eq('id', id).select().single();
  if (error) throw new Error(`[${table}] ${error.message}`);
  return data as T;
}

async function remove(table: string, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw new Error(`[${table}] ${error.message}`);
}

async function call<T>(fn: string, args: Record<string, any> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`[rpc:${fn}] ${error.message}`);
  return data as T;
}

const num = (v: any, d = 0) => (v === null || v === undefined ? d : Number(v));

// ---------------------------------------------------------------- mappers ----
const toProduct = (r: any): Product => ({
  id: r.id,
  name: r.name,
  description: r.description ?? '',
  barcode: r.barcode ?? '',
  marqueId: r.marque_id ?? '',
  categoryId: r.category_id ?? '',
  principalQuantity: num(r.principal_quantity),
  currentQuantity: num(r.current_quantity),
  minAlertQuantity: num(r.min_alert_quantity),
  purchasePrice: num(r.purchase_price),
  unitEnabled: r.unit_enabled ?? false,
  unit: r.unit ?? undefined,
  expirationEnabled: r.expiration_enabled ?? false,
  expirationDate: r.expiration_date ?? null,
  createdAt: (r.created_at ?? '').slice(0, 10),
  createdBy: r.created_by ?? undefined,
});

/** Only the keys actually present are sent, so a partial edit never wipes a column. */
const fromProduct = (p: Partial<Product>) => {
  const row: Record<string, any> = {};
  if (p.name !== undefined) row.name = p.name;
  if (p.description !== undefined) row.description = p.description;
  if (p.barcode !== undefined) row.barcode = p.barcode || null;
  if (p.marqueId !== undefined) row.marque_id = p.marqueId || null;
  if (p.categoryId !== undefined) row.category_id = p.categoryId || null;
  if (p.principalQuantity !== undefined) row.principal_quantity = Number(p.principalQuantity) || 0;
  if (p.currentQuantity !== undefined) row.current_quantity = Number(p.currentQuantity) || 0;
  if (p.minAlertQuantity !== undefined) row.min_alert_quantity = Number(p.minAlertQuantity) || 0;
  if (p.purchasePrice !== undefined) row.purchase_price = Number(p.purchasePrice) || 0;
  if (p.unitEnabled !== undefined) row.unit_enabled = p.unitEnabled ?? true;
  if (p.unit !== undefined) row.unit = p.unit || null;
  if (p.expirationEnabled !== undefined) row.expiration_enabled = p.expirationEnabled ?? false;
  if (p.expirationDate !== undefined) row.expiration_date = p.expirationDate || null;
  return row;
};

const toSupplier = (r: any): Supplier => ({
  id: r.id, name: r.name, phone: r.phone ?? '', address: r.address ?? '',
});

const toClient = (r: any): Client => ({
  id: r.id, name: r.name, phone: r.phone ?? '', address: r.address ?? '', note: r.note ?? '',
});

const toWorker = (r: any): Worker => ({
  id: r.id,
  fullName: r.full_name,
  birthday: r.birthday ?? '',
  idCardNumber: r.id_card_number ?? '',
  phone: r.phone ?? '',
  roleId: r.role_id ?? '',
  paymentEnabled: r.payment_enabled ?? true,
  paymentType: r.payment_type ?? 'monthly',
  paymentAmount: num(r.payment_amount),
  hasAccount: r.has_account ?? false,
  email: r.email ?? '',
  username: r.username ?? '',
  startDate: r.start_date ?? '',
  permissions: r.permissions ?? {},
  acomptes: (r.worker_acomptes ?? []).map((a: any) => ({
    id: a.id, date: a.date, amount: num(a.amount), description: a.description ?? '',
  })),
  absences: (r.worker_absences ?? []).map((a: any) => ({
    id: a.id, date: a.date, description: a.description ?? '', cost: num(a.cost),
  })),
  payments: (r.worker_payments ?? []).map((a: any) => ({
    id: a.id, date: a.date, period: a.period ?? '', amount: num(a.amount),
    description: a.description ?? '', kind: a.kind ?? 'salary',
  })),
  overtimes: (r.worker_overtimes ?? []).map(toOvertime),
});

const toOvertime = (r: any): WorkerOvertime => ({
  id: r.id,
  workerId: r.worker_id,
  date: r.date,
  workEndHour: Number(r.work_end_hour ?? 0),
  workEndMinute: Number(r.work_end_minute ?? 0),
  overtimeEndHour: Number(r.overtime_end_hour ?? 0),
  overtimeEndMinute: Number(r.overtime_end_minute ?? 0),
  hours: num(r.hours),
  hourlyRate: num(r.hourly_rate),
  amount: num(r.amount),
  description: r.description ?? '',
  isPaid: r.is_paid ?? false,
  paidAt: r.paid_at ?? null,
  paymentId: r.payment_id ?? null,
  createdBy: r.created_by ?? undefined,
});

const toPartyPayment = (idKey: string, nameKey: string) => (r: any): PartyPayment => ({
  id: r.id,
  partyId: r[idKey] ?? '',
  partyName: r[nameKey] ?? undefined,
  amount: num(r.amount),
  date: r.date,
  paidAt: r.paid_at ?? r.created_at,
  notes: r.notes ?? '',
  createdAt: r.created_at,
  createdBy: r.created_by ?? undefined,
});

const toCommandDelivery = (r: any): CommandDelivery => ({
  id: r.id,
  commandId: r.command_id,
  reference: r.reference,
  date: r.date,
  deliveredAt: r.delivered_at ?? r.created_at,
  notes: r.notes ?? '',
  createdBy: r.created_by ?? undefined,
  items: (r.command_delivery_items ?? []).map((i: any) => ({
    commandItemId: i.command_item_id ?? undefined,
    productName: i.product_name,
    quantity: num(i.quantity),
    sellUnit: i.sell_unit ?? undefined,
  })),
});

const toPurchaseOrder = (r: any): PurchaseOrder => ({
  id: r.id,
  reference: r.reference,
  date: r.date,
  supplierName: r.supplier_name ?? '',
  notes: r.notes ?? '',
  createdAt: r.created_at,
  createdBy: r.created_by ?? undefined,
  items: (r.purchase_order_items ?? []).map((i: any) => ({
    productName: i.product_name,
    description: i.description ?? '',
    quantity: num(i.quantity),
    unit: i.unit ?? undefined,
  })),
});

const fromWorker = (w: Partial<Worker>) => ({
  full_name: w.fullName,
  birthday: w.birthday || null,
  id_card_number: w.idCardNumber || null,
  phone: w.phone || null,
  role_id: w.roleId || null,
  payment_enabled: w.paymentEnabled,
  payment_type: w.paymentType,
  payment_amount: w.paymentAmount,
  start_date: w.startDate || null,
  has_account: w.hasAccount ?? false,
  email: w.email || null,
  username: w.username || null,
  permissions: w.permissions ?? {},
});

const toPurchase = (r: any): Purchase => ({
  id: r.id,
  reference: r.reference,
  supplierId: r.supplier_id ?? '',
  date: r.date,
  driverPlate: r.driver_plate ?? '',
  bonNumber: r.bon_number ?? '',
  totalAmount: num(r.total_amount),
  paidAmount: num(r.paid_amount),
  restAmount: num(r.rest_amount),
  createdBy: r.created_by ?? undefined,
  products: (r.purchase_lines ?? []).map((l: any) => ({
    productId: l.product_id ?? '',
    productName: l.product_name,
    quantity: num(l.quantity),
    purchasePrice: num(l.purchase_price),
    minAlertQuantity: num(l.min_alert_quantity),
    unitEnabled: l.unit_enabled ?? false,
    unit: l.unit ?? undefined,
    expirationEnabled: l.expiration_enabled ?? false,
    expirationDate: l.expiration_date ?? null,
  })),
  payments: (r.purchase_payments ?? []).map((p: any) => ({
    id: p.id, date: p.date, amount: num(p.amount), description: p.description ?? '',
  })),
});

const toSale = (r: any): Sale => ({
  id: r.id,
  reference: r.reference,
  clientId: r.client_id ?? null,
  date: r.date,
  totalAmount: num(r.total_amount),
  reduction: num(r.reduction),
  finalAmount: num(r.final_amount),
  paidAmount: num(r.paid_amount),
  restAmount: num(r.rest_amount),
  status: r.status,
  createdBy: r.created_by ?? undefined,
  products: (r.sale_lines ?? []).map((l: any) => ({
    productId: l.product_id ?? l.comptoir_id ?? '',
    productName: l.product_name,
    quantity: num(l.quantity),
    sellingPrice: num(l.selling_price),
    basePrice: l.base_price === null || l.base_price === undefined ? undefined : num(l.base_price),
    sellByUnit: l.sell_by_unit ?? false,
    unit: l.unit ?? undefined,
  })),
  payments: (r.sale_payments ?? []).map((p: any) => ({
    id: p.id, date: p.date, amount: num(p.amount), description: p.description ?? '',
  })),
});

const toProduction = (r: any): Production => ({
  id: r.id,
  name: r.name,
  description: r.description ?? '',
  date: r.date,
  hour: r.hour ?? '',
  categoryId: r.category_id ?? undefined,
  categoryName: r.category_name ?? undefined,
  totalCost: num(r.total_cost),
  outputQuantity: num(r.output_quantity),
  unitPrice: num(r.unit_price),
  totalValue: num(r.total_value),
  sellByUnit: r.sell_by_unit ?? false,
  sellUnit: r.sell_unit ?? undefined,
  sentToComptoir: num(r.sent_to_comptoir),
  hasLoss: r.has_loss ?? false,
  expectedQuantity: r.expected_quantity === null ? undefined : num(r.expected_quantity),
  lossQuantity: num(r.loss_quantity),
  lossDescription: r.loss_description ?? undefined,
  lossValue: num(r.loss_value),
  createdBy: r.created_by ?? undefined,
  usedProducts: (r.production_used_products ?? []).map((u: any) => ({
    productId: u.product_id ?? '',
    productName: u.product_name,
    quantityUsed: num(u.quantity_used),
    sourceType: u.source_type ?? 'stock',
    unit: u.unit ?? undefined,
    unitCost: num(u.unit_cost),
    lineCost: num(u.line_cost),
  })),
});

const toComptoirItem = (r: any): ComptoirItem => ({
  id: r.id,
  productionId: r.production_id ?? '',
  productName: r.product_name,
  description: r.description ?? undefined,
  quantity: num(r.quantity),
  unitPrice: num(r.unit_price),
  date: r.date,
  categoryId: r.category_id ?? undefined,
  categoryName: r.category_name ?? undefined,
  sellByUnit: r.sell_by_unit ?? false,
  unit: r.unit ?? undefined,
  createdBy: r.created_by ?? undefined,
});

const toDestruction = (r: any): Destruction => ({
  id: r.id,
  comptoirId: r.comptoir_id ?? '',
  productName: r.product_name,
  quantity: num(r.quantity),
  value: num(r.value),
  reason: r.reason ?? '',
  date: r.date,
  unit: r.unit ?? undefined,
  createdBy: r.created_by ?? undefined,
});

const toClientDebt = (r: any): ClientDebt => ({
  id: r.id,
  clientId: r.client_id ?? '',
  clientName: r.client_name,
  clientPhone: r.client_phone ?? undefined,
  totalDebt: num(r.total_debt),
  totalPaid: num(r.total_paid),
  restAmount: num(r.rest_amount),
  date: r.date,
  createdAt: r.created_at,
  description: r.description ?? '',
  createdBy: r.created_by ?? undefined,
  versements: (r.client_debt_versements ?? []).map((v: any) => ({
    id: v.id,
    debtId: v.debt_id,
    clientId: v.client_id ?? '',
    clientName: v.client_name,
    amount: num(v.amount),
    date: v.date,
    createdAt: v.created_at,
    createdBy: v.created_by ?? undefined,
    notes: v.notes ?? undefined,
  })),
});

const toCommand = (r: any): Command => ({
  id: r.id,
  reference: r.reference,
  createdAt: r.created_at,
  receiveDate: r.receive_date ?? '',
  receiveHour: r.receive_hour ?? '',
  receiveMinute: r.receive_minute ?? '',
  clientId: r.client_id ?? '',
  clientName: r.client_name,
  clientPhone: r.client_phone ?? undefined,
  totalAmount: num(r.total_amount),
  advancePaid: num(r.advance_paid),
  paidAmount: num(r.paid_amount),
  restAmount: num(r.rest_amount),
  status: r.status,
  notes: r.notes ?? undefined,
  createdBy: r.created_by ?? '',
  items: (r.command_items ?? []).map((i: any) => ({
    id: i.id,
    deliveredQuantity: num(i.delivered_quantity),
    productId: i.product_id ?? undefined,
    ficheTechnicId: i.fiche_technic_id ?? undefined,
    productName: i.product_name,
    quantity: num(i.quantity),
    unitPrice: num(i.unit_price),
    totalPrice: num(i.total_price),
    sellByUnit: i.sell_by_unit ?? false,
    sellUnit: i.sell_unit ?? undefined,
  })),
});

const toExpense = (r: any): Expense => ({
  id: r.id,
  name: r.name,
  description: r.description ?? '',
  amount: num(r.amount),
  date: r.date,
  categoryId: r.category_id ?? undefined,
  categoryName: r.category_name ?? undefined,
  createdBy: r.created_by ?? undefined,
});

const toCaisseTx = (r: any): CaisseTransaction => ({
  id: r.id,
  type: r.type,
  amount: num(r.amount),
  date: r.date,
  description: r.description ?? '',
  categoryId: r.category_id ?? undefined,
  categoryName: r.category_name ?? undefined,
  createdAt: r.created_at,
  createdBy: r.created_by ?? undefined,
});

const toCaisseReport = (r: any): CaisseReport => ({
  id: r.id,
  reportType: r.report_type,
  date: r.date,
  endDate: r.end_date ?? undefined,
  hour: r.hour ?? '',
  description: r.description ?? '',
  declaredAmount: num(r.declared_amount),
  createdAt: r.created_at,
  createdBy: r.created_by ?? undefined,
});

const toFiche = (r: any): FicheTechnic => ({
  id: r.id,
  name: r.name,
  categoryId: r.category_id ?? '',
  categoryName: r.category_name ?? '',
  description: r.description ?? '',
  sellByUnit: r.sell_by_unit ?? false,
  sellUnit: r.sell_unit ?? undefined,
  usableInProduction: r.usable_in_production ?? false,
  productUnit: r.product_unit ?? undefined,
  outputQuantity: num(r.output_quantity),
  unitPrice: num(r.unit_price),
  totalCost: num(r.total_cost),
  costPerUnit: num(r.cost_per_unit),
  totalValue: num(r.total_value),
  gainsPerUnit: num(r.gains_per_unit),
  totalGains: num(r.total_gains),
  createdAt: (r.created_at ?? '').slice(0, 10),
  usedProducts: (r.fiche_technic_lines ?? []).map((l: any) => ({
    productId: l.product_id ?? '',
    productName: l.product_name,
    quantityUsed: num(l.quantity_used),
    sourceType: l.source_type ?? 'stock',
    unit: l.unit ?? undefined,
    unitCost: num(l.unit_cost),
    lineCost: num(l.line_cost),
  })),
});

const toSettings = (r: any): StoreSettings => ({
  logo: r.logo ?? null,
  name: r.name ?? 'Altech Production',
  description: r.description ?? '',
  email: r.email ?? '',
  phone: r.phone ?? '',
  address: r.address ?? '',
  socialMedia: r.social_media ?? '',
  nif: r.nif ?? '',
  nis: r.nis ?? '',
  article: r.article ?? '',
  rc: r.rc ?? '',
});

const simpleName = (r: any) => ({ id: r.id, name: r.name });

// ------------------------------------------------------------------- API ----
export const db = {
  // /stock
  products: {
    list: async (): Promise<Product[]> => (await select<any>('products', '*')).map(toProduct),
    create: async (p: Omit<Product, 'id' | 'createdAt'>) => toProduct(await insert('products', fromProduct(p))),
    update: async (id: string, p: Partial<Product>) => toProduct(await update('products', id, fromProduct(p))),
    remove: (id: string) => remove('products', id),
  },
  marques: {
    list: async (): Promise<Marque[]> => (await select<any>('marques')).map(simpleName),
    create: async (name: string) => simpleName(await insert('marques', { name })),
    remove: (id: string) => remove('marques', id),
  },
  categories: {
    list: async (): Promise<Category[]> => (await select<any>('categories')).map(simpleName),
    create: async (name: string) => simpleName(await insert('categories', { name })),
    remove: (id: string) => remove('categories', id),
  },
  units: {
    list: async (): Promise<Unit[]> => (await select<any>('units')).map(simpleName),
    create: async (name: string) => simpleName(await insert('units', { name })),
    remove: (id: string) => remove('units', id),
  },

  // /suppliers
  suppliers: {
    list: async (): Promise<Supplier[]> => (await select<any>('suppliers')).map(toSupplier),
    create: async (s: Omit<Supplier, 'id'>) =>
      toSupplier(await insert('suppliers', { name: s.name, phone: s.phone, address: s.address })),
    update: async (id: string, s: Partial<Supplier>) =>
      toSupplier(await update('suppliers', id, { name: s.name, phone: s.phone, address: s.address })),
    remove: (id: string) => remove('suppliers', id),
  },

  // /clients
  clients: {
    list: async (): Promise<Client[]> => (await select<any>('clients')).map(toClient),
    create: async (c: Omit<Client, 'id'>) =>
      toClient(await insert('clients', { name: c.name, phone: c.phone, address: c.address, note: c.note })),
    update: async (id: string, c: Partial<Client>) =>
      toClient(await update('clients', id, { name: c.name, phone: c.phone, address: c.address, note: c.note })),
    remove: (id: string) => remove('clients', id),
    passager: async (): Promise<Client> => toClient(await call('get_or_create_passager', {})),
  },

  // /purchase
  purchases: {
    list: async (): Promise<Purchase[]> =>
      (await select<any>('purchases', '*, purchase_lines(*), purchase_payments(*)', 'date')).map(toPurchase),
    remove: (id: string) => remove('purchases', id),
  },

  // /pos & /sales
  sales: {
    list: async (): Promise<Sale[]> =>
      (await select<any>('sales', '*, sale_lines(*), sale_payments(*)', 'date')).map(toSale),
    remove: (id: string) => remove('sales', id),
  },

  // /clients/commands
  commands: {
    list: async (): Promise<Command[]> =>
      (await select<any>('commands', '*, command_items(*)', 'created_at')).map(toCommand),
    update: (id: string, row: Record<string, any>) => update('commands', id, row),
    /** Replaces every line of a command (edit screen). */
    replaceItems: async (commandId: string, items: Record<string, any>[]) => {
      const { error: delErr } = await supabase.from('command_items').delete().eq('command_id', commandId);
      if (delErr) throw new Error(`[command_items] ${delErr.message}`);
      if (!items.length) return;
      const { error } = await supabase
        .from('command_items')
        .insert(items.map((i) => ({ ...i, command_id: commandId })));
      if (error) throw new Error(`[command_items] ${error.message}`);
    },
    remove: (id: string) => remove('commands', id),
  },

  // /production
  productions: {
    list: async (): Promise<Production[]> =>
      (await select<any>('productions', '*, production_used_products(*)', 'date')).map(toProduction),
    update: (id: string, data: Record<string, any>) => update('productions', id, data),
    remove: (id: string) => remove('productions', id),
  },
  productionCategories: {
    list: async (): Promise<Category[]> => (await select<any>('production_categories')).map(simpleName),
    create: async (name: string) => simpleName(await insert('production_categories', { name })),
    remove: (id: string) => remove('production_categories', id),
  },
  ficheTechnics: {
    list: async (): Promise<FicheTechnic[]> =>
      (await select<any>('fiche_technics', '*, fiche_technic_lines(*)', 'created_at')).map(toFiche),
    create: async (payload: Record<string, any>) =>
      toFiche(await call<any>('create_fiche_technic', { p_payload: payload })),
    update: async (id: string, payload: Record<string, any>) =>
      toFiche(await call<any>('update_fiche_technic', { p_id: id, p_payload: payload })),
    remove: (id: string) => remove('fiche_technics', id),
  },
  ficheCategories: {
    list: async (): Promise<Category[]> => (await selectOptional<any>('fiche_categories')).map(simpleName),
    create: async (name: string) => simpleName(await call<any>('upsert_fiche_category', { p_name: name })),
    remove: (id: string) => remove('fiche_categories', id),
  },

  // /suppliers — règlements de dette
  supplierPayments: {
    list: async (): Promise<PartyPayment[]> =>
      (await selectOptional<any>('supplier_payments', '*', 'paid_at')).map(toPartyPayment('supplier_id', 'supplier_name')),
  },

  // /clients — règlements de dette
  clientPayments: {
    list: async (): Promise<PartyPayment[]> =>
      (await selectOptional<any>('client_payments', '*', 'paid_at')).map(toPartyPayment('client_id', 'client_name')),
  },

  // /commands — livraisons
  commandDeliveries: {
    list: async (): Promise<CommandDelivery[]> =>
      (await selectOptional<any>('command_deliveries', '*, command_delivery_items(*)', 'delivered_at')).map(toCommandDelivery),
  },

  // /workers — heures supplémentaires
  overtimes: {
    list: async (): Promise<WorkerOvertime[]> =>
      (await selectOptional<any>('worker_overtimes', '*', 'date')).map(toOvertime),
  },

  // /expenses — bons de commande
  purchaseOrders: {
    list: async (): Promise<PurchaseOrder[]> =>
      (await selectOptional<any>('purchase_orders', '*, purchase_order_items(*)', 'date')).map(toPurchaseOrder),
    remove: (id: string) => remove('purchase_orders', id),
  },

  // /comptoir
  comptoir: {
    list: async (): Promise<ComptoirItem[]> => (await select<any>('comptoir_items', '*', 'date')).map(toComptoirItem),
    destructions: async (): Promise<Destruction[]> =>
      (await select<any>('destructions', '*', 'date')).map(toDestruction),
  },

  // /workers
  workers: {
    list: async (): Promise<Worker[]> => {
      const full = '*, worker_acomptes(*), worker_absences(*), worker_payments(*), worker_overtimes(*)';
      try {
        return (await select<any>('workers', full)).map(toWorker);
      } catch (e) {
        if (!isMissingSchema((e as Error).message)) throw e;
        // overtime table not deployed yet — load the employees without it
        return (await select<any>('workers', '*, worker_acomptes(*), worker_absences(*), worker_payments(*)')).map(toWorker);
      }
    },
    create: async (w: Partial<Worker>) => toWorker(await insert('workers', fromWorker(w))),
    update: async (id: string, w: Partial<Worker>) => toWorker(await update('workers', id, fromWorker(w))),
    remove: (id: string) => remove('workers', id),
  },
  roles: {
    list: async (): Promise<Role[]> => (await select<any>('roles')).map(simpleName),
    create: async (name: string) => simpleName(await insert('roles', { name })),
    remove: (id: string) => remove('roles', id),
  },

  // /expenses
  expenses: {
    list: async (): Promise<Expense[]> => (await select<any>('expenses', '*', 'date')).map(toExpense),
    create: async (e: Partial<Expense>) =>
      toExpense(await insert('expenses', {
        name: e.name, description: e.description, amount: e.amount, date: e.date,
        category_id: e.categoryId || null, category_name: e.categoryName || null,
      })),
    update: async (id: string, e: Partial<Expense>) =>
      toExpense(await update('expenses', id, {
        name: e.name, description: e.description, amount: e.amount, date: e.date,
        category_id: e.categoryId || null, category_name: e.categoryName || null,
      })),
    remove: (id: string) => remove('expenses', id),
  },
  expenseCategories: {
    list: async (): Promise<Category[]> => (await select<any>('expense_categories')).map(simpleName),
    create: async (name: string) => simpleName(await insert('expense_categories', { name })),
    remove: (id: string) => remove('expense_categories', id),
  },

  // /expenses/debts
  clientDebts: {
    list: async (): Promise<ClientDebt[]> =>
      (await select<any>('client_debts', '*, client_debt_versements(*)', 'date')).map(toClientDebt),
    update: (id: string, data: Record<string, any>) => update('client_debts', id, data),
    remove: (id: string) => remove('client_debts', id),
  },

  // /caisse
  caisse: {
    list: async (): Promise<CaisseTransaction[]> =>
      (await select<any>('caisse_transactions', '*', 'date')).map(toCaisseTx),
    update: async (id: string, t: Partial<CaisseTransaction>) =>
      toCaisseTx(await update('caisse_transactions', id, {
        type: t.type, amount: t.amount, date: t.date, description: t.description,
        category_id: t.categoryId || null, category_name: t.categoryName || null,
      })),
    remove: (id: string) => remove('caisse_transactions', id),
    initialBalance: async (): Promise<number> => {
      const { data } = await supabase.from('caisse_settings').select('initial_balance').maybeSingle();
      return num(data?.initial_balance, 0);
    },
    setInitialBalance: async (value: number) => {
      await supabase.from('caisse_settings').upsert({ id: true, initial_balance: value });
    },
    balance: () => call<number>('caisse_balance', {}),
  },
  caisseCategories: {
    list: async (): Promise<Category[]> => (await select<any>('caisse_categories')).map(simpleName),
    create: async (name: string) => simpleName(await insert('caisse_categories', { name })),
    remove: (id: string) => remove('caisse_categories', id),
  },
  caisseReports: {
    list: async (): Promise<CaisseReport[]> => (await select<any>('caisse_reports', '*', 'date')).map(toCaisseReport),
    remove: (id: string) => remove('caisse_reports', id),
  },

  // /settings
  settings: {
    get: async (): Promise<StoreSettings | null> => {
      const { data } = await supabase.from('store_settings').select('*').maybeSingle();
      return data ? toSettings(data) : null;
    },
    save: async (s: Partial<StoreSettings>) => {
      await supabase.from('store_settings').upsert({
        id: true,
        logo: s.logo, name: s.name, description: s.description, email: s.email,
        phone: s.phone, address: s.address, social_media: s.socialMedia,
        nif: s.nif, nis: s.nis, article: s.article, rc: s.rc,
      });
    },
  },

  // /dashboard & /reports
  dashboard: {
    kpis: async () => (await supabase.from('v_dashboard_kpis').select('*').maybeSingle()).data,
    stockAlerts: () => select<any>('v_stock_alerts'),
    salesDaily: () => select<any>('v_sales_daily'),
    monthlyReport: () => select<any>('v_reports_monthly'),
    clientBalances: () => select<any>('v_client_balances'),
    supplierBalances: () => select<any>('v_supplier_balances'),
    workerBalances: () => select<any>('v_worker_balances'),
    comptoirStats: () => select<any>('v_comptoir_stats'),
    productionProfitability: () => select<any>('v_production_profitability'),
  },
};

/** Business buttons — one entry per action RPC declared in the SQL file. */
export const rpc = {
  // /purchase
  createPurchase: (payload: Record<string, any>) => call<any>('create_purchase', { p_payload: payload }),
  paySupplierDebt: (purchaseId: string, amount: number, date?: string) =>
    call<any>('pay_supplier_debt', { p_purchase_id: purchaseId, p_amount: amount, p_date: date ?? null }),

  // /pos & /sales
  createSale: (payload: Record<string, any>) => call<any>('create_sale', { p_payload: payload }),
  paySaleDebt: (saleId: string, amount: number, date?: string) =>
    call<any>('pay_sale_debt', { p_sale_id: saleId, p_amount: amount, p_date: date ?? null }),

  // /clients/commands
  createCommand: (payload: Record<string, any>) => call<any>('create_command', { p_payload: payload }),
  payCommand: (commandId: string, amount: number, date?: string) =>
    call<any>('pay_command', { p_command_id: commandId, p_amount: amount, p_date: date ?? null }),
  setCommandStatus: (commandId: string, status: 'pending' | 'finalised' | 'cancelled') =>
    call<any>('set_command_status', { p_command_id: commandId, p_status: status }),

  // /expenses/debts
  addClientDebt: (clientId: string, total: number, date: string, description: string) =>
    call<any>('add_client_debt', {
      p_client_id: clientId, p_total_debt: total, p_date: date, p_description: description,
    }),
  addClientDebtVersement: (debtId: string, amount: number, date: string, notes?: string) =>
    call<any>('add_client_debt_versement', {
      p_debt_id: debtId, p_amount: amount, p_date: date, p_notes: notes ?? null,
    }),
  deleteClientDebtVersement: (versementId: string) =>
    call<void>('delete_client_debt_versement', { p_versement_id: versementId }),

  // /production
  createProduction: (payload: Record<string, any>) => call<any>('create_production', { p_payload: payload }),
  transferToComptoir: (productionId: string, quantity: number) =>
    call<any>('transfer_production_to_comptoir', { p_production_id: productionId, p_quantity: quantity }),

  // /comptoir
  destroyComptoirItem: (comptoirId: string, quantity: number, reason: string) =>
    call<any>('destroy_comptoir_item', { p_comptoir_id: comptoirId, p_quantity: quantity, p_reason: reason }),
  recoverDestruction: (id: string) => call<void>('recover_destruction', { p_destruction_id: id }),
  recoverDestructions: (ids: string[]) => call<void>('recover_destructions', { p_ids: ids }),
  deleteDestructions: (ids: string[]) => call<void>('delete_destructions', { p_ids: ids }),

  // /stock
  adjustStock: (productId: string, quantity: number, reason = 'manual') =>
    call<any>('adjust_stock', { p_product_id: productId, p_quantity: quantity, p_reason: reason }),

  // /workers
  createWorkerAccount: (workerId: string, email: string, password: string, username?: string) =>
    call<string>('admin_create_worker_account', {
      p_worker_id: workerId, p_email: email, p_password: password, p_username: username ?? null,
    }),
  setWorkerPermissions: (workerId: string, permissions: Record<string, any>) =>
    call<any>('set_worker_permissions', { p_worker_id: workerId, p_permissions: permissions }),
  payWorkerSalary: (workerId: string, amount: number, period?: string, date?: string, description = '') =>
    call<any>('pay_worker_salary', {
      p_worker_id: workerId, p_amount: amount, p_period: period ?? null,
      p_date: date ?? null, p_description: description,
    }),
  addWorkerAcompte: (workerId: string, amount: number, date?: string, description = '') =>
    call<any>('add_worker_acompte', {
      p_worker_id: workerId, p_amount: amount, p_date: date ?? null, p_description: description,
    }),

  // /login & /settings
  createAdminAccount: (name: string, username: string, email: string, password: string) =>
    call<string>('create_admin_account', {
      p_name: name, p_username: username, p_email: email, p_password: password,
    }),

  // /suppliers — payer la dette d'un fournisseur
  paySupplier: (supplierId: string, amount: number, paidAt: string, notes = '') =>
    call<any>('pay_supplier', {
      p_supplier_id: supplierId, p_amount: amount, p_paid_at: paidAt, p_notes: notes,
    }),
  updateSupplierPayment: (id: string, amount: number, paidAt?: string, notes?: string) =>
    call<any>('update_supplier_payment', {
      p_id: id, p_amount: amount, p_paid_at: paidAt ?? null, p_notes: notes ?? null,
    }),
  deleteSupplierPayment: (id: string) => call<void>('delete_supplier_payment', { p_id: id }),

  // /clients — payer la dette d'un client
  payClient: (clientId: string, amount: number, paidAt: string, notes = '') =>
    call<any>('pay_client', {
      p_client_id: clientId, p_amount: amount, p_paid_at: paidAt, p_notes: notes,
    }),
  updateClientPayment: (id: string, amount: number, paidAt?: string, notes?: string) =>
    call<any>('update_client_payment', {
      p_id: id, p_amount: amount, p_paid_at: paidAt ?? null, p_notes: notes ?? null,
    }),
  deleteClientPayment: (id: string) => call<void>('delete_client_payment', { p_id: id }),

  // /commands — livraisons partielles
  createCommandDelivery: (payload: Record<string, any>) =>
    call<any>('create_command_delivery', { p_payload: payload }),
  updateCommandDelivery: (id: string, payload: Record<string, any>) =>
    call<any>('update_command_delivery', { p_id: id, p_payload: payload }),
  deleteCommandDelivery: (id: string) => call<void>('delete_command_delivery', { p_id: id }),

  // /workers — heures supplémentaires
  addWorkerOvertime: (payload: Record<string, any>) =>
    call<any>('add_worker_overtime', { p_payload: payload }),
  updateWorkerOvertime: (id: string, payload: Record<string, any>) =>
    call<any>('update_worker_overtime', { p_id: id, p_payload: payload }),
  deleteWorkerOvertime: (id: string) => call<void>('delete_worker_overtime', { p_id: id }),
  payWorkerOvertimes: (workerId: string, ids: string[], date?: string, description = '') =>
    call<any>('pay_worker_overtimes', {
      p_worker_id: workerId, p_ids: ids, p_date: date ?? null, p_description: description,
    }),

  // /expenses — bons de commande
  createPurchaseOrder: (payload: Record<string, any>) =>
    call<any>('create_purchase_order', { p_payload: payload }),
  updatePurchaseOrder: (id: string, payload: Record<string, any>) =>
    call<any>('update_purchase_order', { p_id: id, p_payload: payload }),

  // /caisse
  addCaisseTransaction: (
    type: 'deposit' | 'withdrawal', amount: number, description: string,
    date?: string, categoryId?: string, categoryName?: string
  ) =>
    call<any>('add_caisse_transaction', {
      p_type: type, p_amount: amount, p_description: description, p_date: date ?? null,
      p_category_id: categoryId ?? null, p_category_name: categoryName ?? null,
    }),
  createCaisseReport: (
    declaredAmount: number, description: string,
    reportType: 'day' | 'period' = 'day', date?: string, endDate?: string
  ) =>
    call<any>('create_caisse_report', {
      p_declared_amount: declaredAmount, p_description: description,
      p_report_type: reportType, p_date: date ?? null, p_end_date: endDate ?? null,
    }),
};
