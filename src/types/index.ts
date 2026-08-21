// ============================================================
// Core domain types for the Produits Chimiques management application
// ============================================================

export type Lang = 'fr' | 'ar';

// ---------- Reference data ----------
export interface Marque {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
}

// A measurement unit used for "purchase/sell with detail" (g, kg, litre, m, …)
export interface Unit {
  id: string;
  name: string;
}

export interface Role {
  id: string;
  name: string;
}

// ---------- Products / Stock ----------
export interface Product {
  id: string;
  name: string;
  description: string;
  /** Legacy fields — no longer asked for when creating a product. */
  barcode?: string;
  marqueId?: string;
  categoryId?: string;
  principalQuantity: number;
  currentQuantity: number;
  minAlertQuantity: number;
  purchasePrice: number;
  // "Achat au détail" — when enabled, quantities are expressed in `unit`
  // (g / kg / litre / m / custom) and purchasePrice is the price for ONE unit.
  unitEnabled?: boolean;
  unit?: string;
  expirationEnabled: boolean;
  expirationDate: string | null;
  createdAt: string;
  createdBy?: string;
}

// ---------- Suppliers ----------
export interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
}

// ---------- Purchases ----------
export interface PurchaseLine {
  productId: string;
  productName?: string;
  quantity: number;
  minAlertQuantity?: number;
  purchasePrice: number;
  // Detail (unit) purchasing: quantity is in `unit`, purchasePrice is per unit.
  unitEnabled?: boolean;
  unit?: string;
  expirationEnabled?: boolean;
  expirationDate: string | null;
}

export interface Payment {
  id?: string;
  date: string;
  amount: number;
  description?: string;
}

export interface Purchase {
  id: string;
  reference: string;
  supplierId: string;
  date: string;
  products: PurchaseLine[];
  totalAmount: number;
  paidAmount: number;
  restAmount: number;
  payments: Payment[];
  createdBy?: string;
}

// ---------- Clients & Client Debts ----------
export interface Client {
  id: string;
  name: string;
  phone: string;
  address?: string;
  note?: string;
}

export interface ClientDebtVersement {
  id: string;
  debtId: string;
  clientId: string;
  clientName: string;
  amount: number;
  date: string; // YYYY-MM-DD
  createdAt: string; // ISO date time string with date and hour
  createdBy?: string;
  notes?: string;
}

export interface ClientDebt {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone?: string;
  totalDebt: number;
  totalPaid: number;
  restAmount: number;
  date: string; // YYYY-MM-DD
  createdAt: string;
  description: string;
  versements: ClientDebtVersement[];
  createdBy?: string;
}

// ---------- Sales ----------
export interface SaleLine {
  productId: string;
  productName?: string;
  quantity: number;
  sellingPrice: number;
  /** Catalogue price of the comptoir item at the moment of the sale. Lets the
   *  sale detail show "prix catalogue" vs "prix appliqué" when the cashier
   *  overrode the unit price. */
  basePrice?: number;
  // When the production product is sold by unit (g / kg / …)
  sellByUnit?: boolean;
  unit?: string;
}

export type SaleStatus = 'paid' | 'debt';

export interface Sale {
  id: string;
  reference: string;
  clientId: string | null;
  date: string;
  products: SaleLine[];
  totalAmount: number;
  reduction: number;
  finalAmount: number;
  paidAmount: number;
  restAmount: number;
  status: SaleStatus;
  payments: Payment[];
  createdBy?: string;
}

// ---------- Production ----------
export interface UsedProduct {
  productId: string;
  productName: string;
  quantityUsed: number;
  // Where this ingredient comes from:
  //  - 'stock' (default): a raw product taken from stock inventory
  //  - 'fiche': a semi-finished product made from another fiche technique
  //    (e.g. a cream used inside a cake). productId then refers to a FicheTechnic.
  sourceType?: 'stock' | 'fiche';
  // Cost tracking — captured at production time
  unit?: string;       // ingredient unit when it is a detail/unit product
  unitCost?: number;   // ingredient purchase price (per unit/piece)
  lineCost?: number;   // quantityUsed * unitCost
}

export interface Production {
  id: string;
  name: string;
  description: string;
  date: string;
  hour: string;
  // Production category (independent list, managed in Production)
  categoryId?: string;
  categoryName?: string;
  usedProducts: UsedProduct[];
  totalCost?: number;      // sum of used product costs
  outputQuantity: number;
  unitPrice: number;
  totalValue: number;      // outputQuantity * unitPrice (potential revenue)
  // When the produced item is sellable by unit (g / kg / …)
  sellByUnit?: boolean;
  sellUnit?: string;
  createdBy?: string;
  sentToComptoir?: number; // quantity of this production sent to the comptoir
  // ---------- Perte (production loss) ----------
  // When enabled, the fiche technique predicts `expectedQuantity` but the batch
  // only yielded `outputQuantity` (the real quantity). The difference is a loss.
  hasLoss?: boolean;
  expectedQuantity?: number; // theoretical output before the loss (from the recipe)
  lossQuantity?: number;     // expectedQuantity - outputQuantity
  lossDescription?: string;  // why the loss happened
  lossValue?: number;        // money value of the lost quantity (raw-material cost)
}

// ---------- Comptoir ----------
export interface ComptoirItem {
  id: string;
  productionId: string;
  productName: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  date: string;
  categoryId?: string;
  categoryName?: string;
  // Sold by unit (g / kg / …) — quantity is then expressed in `unit`
  sellByUnit?: boolean;
  unit?: string;
  createdBy?: string;
}

export interface Destruction {
  id: string;
  comptoirId: string;
  productName: string;
  quantity: number;
  value: number;
  reason: string;
  date: string;
  unit?: string;
  createdBy?: string;
}

// ---------- Workers ----------
export type PaymentType = 'monthly' | 'daily';

export interface PermissionSet {
  view?: boolean;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  pay?: boolean;
}

export interface WorkerPermissions {
  [module: string]: PermissionSet;
}

export interface Acompte {
  id: string;
  date: string;
  amount: number;
  description: string;
}

export interface Absence {
  id: string;
  date: string;
  description: string;
  cost: number;
}

export interface WorkerPaymentRecord {
  id: string;
  date: string;
  period: string;
  amount: number;
  description: string;
  /** 'salary' (default) or 'overtime' — salaire ou heures supplémentaires */
  kind?: 'salary' | 'overtime';
}

export interface Worker {
  id: string;
  fullName: string;
  birthday: string;
  idCardNumber: string;
  phone: string;
  roleId: string;
  paymentEnabled: boolean;
  paymentType: PaymentType;
  paymentAmount: number;
  hasAccount: boolean;
  email: string;
  username: string;
  password?: string;
  startDate: string;
  permissions: WorkerPermissions;
  acomptes: Acompte[];
  absences: Absence[];
  payments: WorkerPaymentRecord[];
  overtimes?: WorkerOvertime[];
}

// ---------- Expenses ----------
export interface Expense {
  id: string;
  name: string;
  description: string;
  amount: number;
  date: string;
  // Expense category (independent list, managed in Expenses)
  categoryId?: string;
  categoryName?: string;
  createdBy?: string;
}

// ---------- Caisse (treasury / cash register) ----------
export type CaisseTransactionType = 'deposit' | 'withdrawal';

export interface CaisseTransaction {
  id: string;
  type: CaisseTransactionType;
  amount: number;
  date: string;
  description: string;
  // Transaction category (independent list, managed in Caisse)
  categoryId?: string;
  categoryName?: string;
  createdAt: string;
  createdBy?: string;
}

// A cash-count report: the user physically counts the cash drawer and records
// the declared amount; the app computes the theoretical balance and the gap
// (décalage) between the two. A report covers either a single day ('day') or a
// custom range ('period', from `date` to `endDate`).
export type CaisseReportType = 'day' | 'period';

export interface CaisseReport {
  id: string;
  reportType?: CaisseReportType; // 'day' (default) or 'period'
  date: string;        // YYYY-MM-DD — the day, or the period start date
  endDate?: string;    // YYYY-MM-DD — period end date (period mode only)
  hour: string;        // HH:mm — taken from the system at creation
  description: string; // optional note
  declaredAmount: number; // cash counted in the drawer by the user
  createdAt: string;
  createdBy?: string;
}

// ---------- Settings ----------
export interface StoreSettings {
  logo: string | null;
  name: string;
  description: string;
  email: string;
  phone: string;
  address: string;
  socialMedia: string;
  nif: string;
  nis: string;
  article: string;
  rc: string;
}

// ---------- Auth ----------
export type UserRole = 'admin' | 'worker';

export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  password?: string;
  role: UserRole;
  permissions: WorkerPermissions | 'all';
  workerId?: string;
}

export interface CreateAccountData {
  name: string;
  username: string;
  email: string;
  password: string;
}

// ---------- Permission module keys ----------
export const PERMISSION_MODULES = [
  'dashboard',
  'stock',
  'purchase',
  'production',
  'comptoir',
  'pos',
  'sales',
  'clients',
  'suppliers',
  'workers',
  'expenses',
  'caisse',
  'reports',
  'settings',
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

// ============================================================
//  MISE À JOUR 2026 — nouvelles entités
// ============================================================

// ---------- Règlement direct d'une dette fournisseur / client ----------
export interface PartyPayment {
  id: string;
  partyId: string;          // supplierId or clientId
  partyName?: string;
  amount: number;
  date: string;             // YYYY-MM-DD
  paidAt: string;           // ISO datetime — date AND hour of the payment
  notes?: string;
  createdAt?: string;
  createdBy?: string;
}

// ---------- Livraison partielle d'une commande ----------
export interface CommandDeliveryItem {
  commandItemId?: string;
  productName: string;
  quantity: number;
  sellUnit?: string;
}

export interface CommandDelivery {
  id: string;
  commandId: string;
  reference: string;
  date: string;
  deliveredAt: string;      // ISO datetime
  notes?: string;
  items: CommandDeliveryItem[];
  createdBy?: string;
}

// ---------- Heures supplémentaires d'un employé ----------
export interface WorkerOvertime {
  id: string;
  workerId: string;
  date: string;
  workEndHour: number;
  workEndMinute: number;
  overtimeEndHour: number;
  overtimeEndMinute: number;
  hours: number;            // decimal hours between the two times
  hourlyRate: number;
  amount: number;           // total to pay (auto-computed, editable)
  description?: string;
  isPaid: boolean;
  paidAt?: string | null;
  paymentId?: string | null;
  createdBy?: string;
}

// ---------- Bon de commande (interface Dépenses) ----------
export interface PurchaseOrderItem {
  productName: string;
  description: string;
  quantity: number;
  unit?: string;
}

export interface PurchaseOrder {
  id: string;
  reference: string;
  date: string;
  supplierName?: string;
  notes?: string;
  items: PurchaseOrderItem[];
  createdAt?: string;
  createdBy?: string;
}
