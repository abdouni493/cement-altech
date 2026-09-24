import { create } from 'zustand';
import type {
  CommandDelivery, CommandDeliveryItem, CommandAdjustment, CommandAdjustmentLine, CommandPayment,
} from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';
import { useStockStore } from './stockStore';
import { useSalesStore } from './salesStore';

export interface CommandItem {
  /** database id of the line — needed to attribute a delivery to it */
  id?: string;
  /** Rang de la ligne dans la commande — distingue deux lignes du MEME produit. */
  position?: number;
  /** Quantite annulee sur cette ligne (le client a renonce au reste). */
  cancelledQuantity?: number;
  productId?: string;
  productName: string;
  quantity: number;
  /** quantity already delivered across every "Livraison" of the command */
  deliveredQuantity?: number;
  unitPrice: number;
  totalPrice: number;
  sellByUnit?: boolean;
  sellUnit?: string;
  ficheTechnicId?: string;
}

export type CommandLine = CommandItem;

export interface Command {
  id: string;
  reference: string;
  /** N° de bon de commande saisi manuellement (repère client, recherche). */
  bonNumber?: string;
  createdAt: string;
  receiveDate: string;
  receiveHour: string;
  receiveMinute: string;
  clientId: string;
  clientName: string;
  clientPhone?: string;
  /** Adresse de livraison — saisie obligatoirement à chaque commande. */
  clientAddress?: string;
  /** Chauffeur prévu pour emmener la commande. */
  driverName?: string;
  /** Immatriculation du camion — facultative. */
  driverPlate?: string;
  items: CommandItem[];
  /** Total HORS TAXES des lignes de la commande. */
  totalAmount: number;
  /** TVA activee sur la commande — reprise par defaut sur chaque livraison. */
  tvaEnabled?: boolean;
  /** Taux applique en pourcentage (19 % par defaut). */
  tvaRate?: number;
  /** Montant de TVA = total HT x taux / 100. */
  tvaAmount?: number;
  /** Net a payer : total HT + TVA. C'est lui qui determine le reste du. */
  totalTtc?: number;
  advancePaid: number;
  /** Reglements encaisses depuis l'ecran « Commandes » (hors acompte). */
  extraPaid?: number;
  /** Detail date de ces reglements (table command_payments). */
  payments?: CommandPayment[];
  /** Acompte du client (avance) utilise comme acompte de la commande. */
  creditApplied?: number;
  paidAmount: number;
  restAmount: number;
  status: 'pending' | 'finalised' | 'cancelled';
  /**
   * « Ancienne commande » : commande antérieure saisie a posteriori pour
   * reconstituer l'historique d'un client. Rien n'est déduit du stock, aucune
   * production n'est lancée et aucune écriture de caisse n'est générée — seule
   * la statistique commerciale (client, dette, rapports) est alimentée.
   */
  isHistorical?: boolean;
  notes?: string;
  createdBy: string;
}

export type AddCommandInput = Omit<
  Command,
  'id' | 'reference' | 'createdAt' | 'paidAmount' | 'restAmount' | 'status' | 'createdBy' | 'advancePaid'
  | 'totalTtc' | 'tvaAmount' | 'extraPaid' | 'payments' | 'creditApplied'
> & {
  createdBy?: string;
  advancePaid?: number;
  paidAmount?: number;
  /** Optional manual creation date (ISO) — lets the POS back-date a command. */
  createdAt?: string;
};

/** Ordered vs delivered summary of a command — drives the card alert. */
export function deliveryStatus(cmd: Command) {
  const ordered = cmd.items.reduce((s, i) => s + i.quantity, 0);
  const delivered = cmd.items.reduce((s, i) => s + (i.deliveredQuantity ?? 0), 0);
  // Le solde auquel le client a RENONCE ne doit plus etre attendu : une
  // commande de 100 livree a 70 puis annulee pour 30 est « livree ».
  const cancelled = cmd.items.reduce((s, i) => s + (i.cancelledQuantity ?? 0), 0);
  const expected = Math.max(0, ordered - cancelled);
  const remaining = Math.max(0, expected - delivered);
  return {
    ordered,
    delivered,
    cancelled,
    expected,
    remaining,
    // Une commande dont TOUT le reste a ete annule n'attend plus rien : elle
    // est « livree », meme si la quantite attendue est tombee a zero.
    isFull: remaining <= 0.0001,
    isPartial: delivered > 0 && remaining > 0.0001,
    percent: expected > 0 ? Math.min(100, (delivered / expected) * 100) : 0,
  };
}

/** Ligne saisie dans « Annuler le reste » / « Augmenter la commande ». */
export interface AdjustmentInput {
  commandItemId?: string;
  productName: string;
  quantity: number;
  unitPrice?: number;
  unit?: string;
}

interface CommandState {
  commands: Command[];
  deliveries: CommandDelivery[];
  /** Annulations du reste et augmentations enregistrees sur les commandes. */
  adjustments: CommandAdjustment[];
  load: () => Promise<void>;
  addCommand: (c: AddCommandInput) => Promise<Command>;
  /** Returns false when the product lines were kept because a delivery exists. */
  updateCommand: (id: string, data: Partial<Command>) => Promise<boolean>;
  /** Annule le reste NON LIVRE : plus de dette ni de quantite en attente. */
  cancelRemainder: (
    commandId: string, lines: AdjustmentInput[], reason: string, date?: string
  ) => Promise<CommandAdjustment | undefined>;
  /** Augmente les quantites commandees d'une commande deja passee. */
  increaseCommand: (
    commandId: string, lines: AdjustmentInput[], reason: string, date?: string
  ) => Promise<CommandAdjustment | undefined>;
  /** Supprime un ajustement — la commande revient a l'etat precedent. */
  deleteAdjustment: (id: string) => Promise<void>;
  payDebt: (commandId: string, amount: number, date?: string) => Promise<void>;
  updateStatus: (commandId: string, status: Command['status']) => Promise<void>;
  deleteCommand: (id: string) => Promise<void>;
  // ---- livraisons ----
  addDelivery: (
    commandId: string,
    items: CommandDeliveryItem[],
    deliveredAt: string,
    notes?: string,
    driver?: DeliveryDriver,
    payment?: DeliveryPayment
  ) => Promise<CommandDelivery>;
  updateDelivery: (
    id: string,
    items: CommandDeliveryItem[],
    deliveredAt: string,
    notes?: string,
    driver?: DeliveryDriver,
    payment?: DeliveryPayment
  ) => Promise<void>;
  deleteDelivery: (id: string) => Promise<void>;
}

/** Chauffeur et lieu d'une livraison — repris de la commande ou saisis à la volée. */
export interface DeliveryPayment {
  /** TVA appliquee a ce bon (par defaut celle de la commande). */
  tvaEnabled?: boolean;
  tvaRate?: number;
  /** Argent reellement encaisse au moment de la remise (entre en caisse). */
  cashPaid?: number;
  /** Part de l'acompte de la commande imputee ici (n'entre pas en caisse). */
  advanceApplied?: number;
  /**
   * Acompte du CLIENT (verse en trop auparavant) a utiliser sur ce bon — impute
   * apres la creation de la facture, sans ecriture de caisse.
   */
  creditUsed?: number;
}

export interface DeliveryDriver {
  driverName?: string;
  driverPlate?: string;
  /** Lieu réellement livré pour ce bon (défaut : adresse de la commande). */
  location?: string;
}

/**
 * `position` fige l'ORDRE DE SAISIE des lignes. Une commande peut porter
 * plusieurs fois le MEME produit avec des quantites et des prix differents :
 * sans ce reperage, les lignes se confondraient d'un rechargement a l'autre.
 */
const itemPayload = (i: CommandItem, index = 0) => ({
  // `id` permet a `update_command()` de RETROUVER la ligne existante : sans
  // lui, une modification supprimerait puis recreerait les lignes et les
  // quantites deja livrees seraient orphelines.
  id: i.id ?? null,
  position: i.position ?? index,
  product_id: i.productId ?? null,
  fiche_technic_id: i.ficheTechnicId ?? null,
  product_name: i.productName,
  quantity: i.quantity,
  unit_price: i.unitPrice,
  total_price: i.totalPrice,
  sell_by_unit: i.sellByUnit ?? false,
  sell_unit: i.sellUnit ?? null,
});

const adjustmentPayload = (l: AdjustmentInput) => ({
  command_item_id: l.commandItemId ?? null,
  product_name: l.productName,
  quantity: l.quantity,
  unit_price: l.unitPrice ?? null,
  unit: l.unit ?? null,
});

const deliveryItemPayload = (i: CommandDeliveryItem) => ({
  command_item_id: i.commandItemId ?? null,
  product_name: i.productName,
  quantity: i.quantity,
  sell_unit: i.sellUnit ?? null,
});

/** Recharge « Gestion de stock » après un mouvement déclenché par une livraison. */
const reloadStock = () =>
  useStockStore.getState().load().catch(() => undefined);

/** Option TVA envoyee a la base — omise quand l'appelant ne la precise pas. */
const tvaPayload = (p?: DeliveryPayment) =>
  p?.tvaEnabled === undefined
    ? {}
    : { tva_enabled: p.tvaEnabled, tva_rate: p.tvaEnabled ? (p.tvaRate ?? 19) : 0 };

/**
 * Une livraison EST une vente : la facture qu'elle genere doit apparaitre
 * immediatement dans « Ventes », dans la caisse et sur la fiche du client.
 */
const reloadSales = () =>
  useSalesStore.getState().load().catch(() => undefined);

export const useCommandStore = create<CommandState>()((set, get) => ({
  commands: [],
  deliveries: [],
  adjustments: [],

  load: async () => {
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
    ]);
    set({ commands, deliveries, adjustments });
  },

  addCommand: async (data) => {
    const advance = data.advancePaid ?? data.paidAmount ?? 0;
    const row = await save('commands.create', () =>
      rpc.createCommand({
        client_id: data.clientId,
        client_name: data.clientName,
        client_phone: data.clientPhone ?? null,
        client_address: data.clientAddress ?? null,
        driver_name: data.driverName ?? null,
        driver_plate: data.driverPlate ?? null,
        receive_date: data.receiveDate || null,
        receive_hour: data.receiveHour,
        receive_minute: data.receiveMinute,
        total_amount: data.totalAmount,
        tva_enabled: data.tvaEnabled ?? false,
        tva_rate: data.tvaEnabled ? (data.tvaRate ?? 19) : 0,
        advance_paid: advance,
        notes: data.notes ?? null,
        bon_number: data.bonNumber ?? null,
        is_historical: data.isHistorical ?? false,
        created_at: data.createdAt ?? null,
        items: data.items.map(itemPayload),
      })
    );
    const commands = await db.commands.list();
    set({ commands });
    return commands.find((c) => c.id === row.id) as Command;
  },

  /**
   * MODIFIER UNE COMMANDE — EN ENTIER.
   *
   * L'ancienne version n'ecrivait que quelques colonnes de l'en-tete : la TVA,
   * l'acompte, le n de bon, l'adresse, le chauffeur et surtout les LIGNES
   * repartaient a l'identique — « je modifie et rien ne change ».
   *
   * Tout passe desormais par `update_command()` cote base, qui :
   *   - reecrit l'en-tete (client, dates, TVA, acompte, n de bon, notes) ;
   *   - remplace les lignes EN CONSERVANT ce qui a deja ete livre (une ligne
   *     deja servie ne peut pas descendre sous la quantite remise) ;
   *   - recalcule total H.T / TVA / T.T.C, l'acompte, le reste du et
   *     l'ecriture de caisse de l'acompte ;
   *   - reconstruit les factures de vente des bons de livraison, donc la
   *     dette du client, la caisse et les rapports.
   */
  updateCommand: async (id, data) => {
    const hasDeliveries = get().deliveries.some((d) => d.commandId === id);
    const payload: Record<string, unknown> = {
      client_id: data.clientId,
      client_name: data.clientName,
      client_phone: data.clientPhone ?? null,
      receive_date: data.receiveDate || null,
      receive_hour: data.receiveHour,
      receive_minute: data.receiveMinute,
      total_amount: data.totalAmount,
      notes: data.notes ?? null,
      ...(data.tvaEnabled !== undefined
        ? { tva_enabled: data.tvaEnabled, tva_rate: data.tvaEnabled ? (data.tvaRate ?? 19) : 0 }
        : {}),
      ...(data.advancePaid !== undefined ? { advance_paid: data.advancePaid } : {}),
      ...(data.clientAddress !== undefined ? { client_address: data.clientAddress || null } : {}),
      ...(data.driverName !== undefined ? { driver_name: data.driverName || null } : {}),
      ...(data.driverPlate !== undefined ? { driver_plate: data.driverPlate || null } : {}),
      ...(data.bonNumber !== undefined ? { bon_number: data.bonNumber || null } : {}),
      ...(data.isHistorical !== undefined ? { is_historical: data.isHistorical } : {}),
      ...(data.createdAt ? { created_at: data.createdAt } : {}),
      ...(data.items ? { items: data.items.map(itemPayload) } : {}),
    };

    let linesKept = true;
    try {
      const row = await save<{ lines_replaced?: boolean }>('commands.update', () =>
        rpc.updateCommand(id, payload)
      );
      linesKept = row?.lines_replaced !== false;
    } catch (e) {
      // Base pas encore a jour : on retombe sur l'ancienne ecriture directe.
      const msg = (e as Error).message;
      if (!/PGRST202|Could not find the function|does not exist|schema cache/i.test(msg)) throw e;
      await save('commands.update.legacy', () => db.commands.update(id, payload));
      if (data.items && !hasDeliveries) {
        await save('commands.updateItems', () =>
          db.commands.replaceItems(id, data.items!.map(itemPayload))
        );
      }
      linesKept = !hasDeliveries;
    }

    // L'acompte et la TVA ont bouge : les factures des bons, la caisse et la
    // fiche du client doivent repartir des valeurs recalculees par la base.
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadSales(), reloadStock(),
    ]);
    set({ commands, deliveries, adjustments });
    return linesKept;
  },

  payDebt: async (commandId, amount, date) => {
    await save('commands.pay', () => rpc.payCommand(commandId, amount, date));
    set({ commands: await db.commands.list() });
  },

  updateStatus: async (commandId, status) => {
    await save('commands.status', () => rpc.setCommandStatus(commandId, status));
    set({ commands: await db.commands.list() });
  },

  /**
   * ANNULER LE RESTE NON LIVRE.
   * Le client s'arrete a 70 unites sur 100 et renonce au solde : chaque ligne
   * est ramenee a ce qui a ete reellement remis. Le reste du disparait de sa
   * fiche, la commande passe en « livree » et l'ecart est archive.
   */
  cancelRemainder: async (commandId, lines, reason, date) => {
    const row = await save<{ id: string }>('commands.cancelRemainder', () =>
      rpc.cancelCommandRemainder({
        command_id: commandId,
        reason,
        date: date ?? null,
        lines: lines.filter((l) => l.quantity > 0).map(adjustmentPayload),
      })
    );
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadSales(), reloadStock(),
    ]);
    set({ commands, deliveries, adjustments });
    return adjustments.find((a) => a.id === row?.id);
  },

  /**
   * AUGMENTER LA COMMANDE.
   * Le client en redemande : la quantite de chaque ligne choisie augmente, le
   * total et le reste du suivent, et le supplement est archive pour le rapport.
   */
  increaseCommand: async (commandId, lines, reason, date) => {
    const row = await save<{ id: string }>('commands.increase', () =>
      rpc.increaseCommand({
        command_id: commandId,
        reason,
        date: date ?? null,
        lines: lines.filter((l) => l.quantity > 0).map(adjustmentPayload),
      })
    );
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadSales(), reloadStock(),
    ]);
    set({ commands, deliveries, adjustments });
    return adjustments.find((a) => a.id === row?.id);
  },

  deleteAdjustment: async (id) => {
    await save('commands.adjustment.delete', () => rpc.deleteCommandAdjustment(id));
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadSales(), reloadStock(),
    ]);
    set({ commands, deliveries, adjustments });
  },

  deleteCommand: async (id) => {
    const hadDeliveries = get().deliveries.some((d) => d.commandId === id);
    await save('commands.delete', () => db.commands.remove(id));
    // Tout ce qui pendait a cette commande disparait avec elle : ses bons de
    // livraison (donc leurs factures de vente), ses annulations et ses
    // augmentations — plus rien ne doit la faire réapparaître dans un rapport.
    set({
      commands: get().commands.filter((c) => c.id !== id),
      deliveries: get().deliveries.filter((d) => d.commandId !== id),
      adjustments: get().adjustments.filter((a) => a.commandId !== id),
    });
    // ses livraisons partent en cascade : leurs matières reviennent au stock
    if (hadDeliveries) await Promise.all([reloadStock(), reloadSales()]);
  },

  addDelivery: async (commandId, items, deliveredAt, notes = '', driver, payment) => {
    const row = await save('commands.deliver', () =>
      rpc.createCommandDelivery({
        command_id: commandId,
        delivered_at: deliveredAt,
        notes,
        driver_name: driver?.driverName ?? null,
        driver_plate: driver?.driverPlate ?? null,
        location: driver?.location ?? null,
        ...tvaPayload(payment),
        cash_paid: payment?.cashPaid ?? 0,
        advance_applied: payment?.advanceApplied ?? 0,
        items: items.map(deliveryItemPayload),
      })
    );
    // La livraison a retiré les matières premières du stock : « Gestion de
    // stock » doit repartir des quantités réelles de la base.
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadStock(), reloadSales(),
    ]);
    set({ commands, deliveries, adjustments });
    return deliveries.find((d) => d.id === row.id) as CommandDelivery;
  },

  updateDelivery: async (id, items, deliveredAt, notes = '', driver, payment) => {
    await save('commands.delivery.update', () =>
      rpc.updateCommandDelivery(id, {
        delivered_at: deliveredAt,
        notes,
        driver_name: driver?.driverName ?? null,
        driver_plate: driver?.driverPlate ?? null,
        location: driver?.location ?? null,
        ...tvaPayload(payment),
        cash_paid: payment?.cashPaid ?? 0,
        advance_applied: payment?.advanceApplied ?? 0,
        items: items.map(deliveryItemPayload),
      })
    );
    // les quantités déduites ont été recalculées côté serveur
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadStock(), reloadSales(),
    ]);
    set({ commands, deliveries, adjustments });
  },

  deleteDelivery: async (id) => {
    await save('commands.delivery.delete', () => rpc.deleteCommandDelivery(id));
    // supprimer une livraison remet les matières en stock
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadStock(), reloadSales(),
    ]);
    set({ commands, deliveries, adjustments });
  },
}));
