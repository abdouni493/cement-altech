import type { Sale, CommandDelivery } from '@/types';
import type { Command } from '@/store/commandStore';

/* ============================================================================
 *  COMMANDE vs LIVRAISON — NE JAMAIS COMPTER DEUX FOIS LE MÊME ARGENT
 * ----------------------------------------------------------------------------
 *  Depuis la mise à jour « la livraison est une vente », chaque bon de
 *  livraison génère une FACTURE DE VENTE dans l'historique des ventes. La
 *  commande, elle, reste l'engagement pris par le client.
 *
 *  Une commande entièrement livrée est donc déjà entièrement facturée par ses
 *  ventes : la reprendre telle quelle dans les totaux gonflerait le chiffre
 *  d'affaires et la dette du client du double.
 *
 *  Règle appliquée partout (fiche client, compte rendu, caisse, rapports) :
 *
 *      part encore « commande » = commande TTC − ventes de ses livraisons
 *
 *  · commande non livrée      → elle compte pour son TTC (rien n'est facturé)
 *  · commande partiellement livrée → la part livrée compte comme VENTE, le
 *    solde reste une commande en attente
 *  · commande soldée par ses livraisons → elle ne compte plus, seules ses
 *    ventes comptent
 * ========================================================================== */

export interface CommandNet {
  /** Reste à facturer sur la commande (hors ce qui est déjà devenu vente). */
  billed: number;
  /** Versements du client encore rattachés à la commande (acompte non imputé). */
  paid: number;
  /** Reste dû au titre de la commande seule. */
  rest: number;
}

const ZERO: CommandNet = { billed: 0, paid: 0, rest: 0 };

/** Total TTC d'une commande — retombe sur le HT si la base n'a pas la colonne. */
export function commandTtc(cmd: Command): number {
  return cmd.totalTtc && cmd.totalTtc > 0 ? cmd.totalTtc : cmd.totalAmount;
}

/** Les ventes engendrées par les livraisons d'une commande. */
export function deliverySalesOf(commandId: string, sales: Sale[]): Sale[] {
  return sales.filter((s) => !!s.deliveryId && s.commandId === commandId);
}

/** Une vente issue d'un bon de livraison (badge « Livraison » dans /ventes). */
export const isDeliverySale = (s: Sale) => !!s.deliveryId;

/**
 * Part d'une commande qui n'a PAS encore été transformée en facture de vente.
 * C'est elle — et elle seule — qui doit s'ajouter aux ventes dans les totaux.
 */
export function netCommand(cmd: Command, sales: Sale[]): CommandNet {
  const linked = deliverySalesOf(cmd.id, sales);
  const invoiced = linked.reduce((s, x) => s + x.finalAmount, 0);
  const invoicedPaid = linked.reduce((s, x) => s + x.paidAmount, 0);
  const billed = Math.max(0, commandTtc(cmd) - invoiced);
  const paid = Math.max(0, cmd.paidAmount - invoicedPaid);
  return { billed, paid, rest: Math.max(0, billed - paid) };
}

/** Cumul de `netCommand()` sur une liste de commandes. */
export function netCommandTotals(commands: Command[], sales: Sale[]): CommandNet {
  return commands.reduce<CommandNet>((acc, cmd) => {
    const n = netCommand(cmd, sales);
    return { billed: acc.billed + n.billed, paid: acc.paid + n.paid, rest: acc.rest + n.rest };
  }, { ...ZERO });
}

/* ============================================================================
 *  L'ARGENT D'UNE COMMANDE
 * ----------------------------------------------------------------------------
 *  argent de la commande = acompte versé à la création
 *                        + règlements saisis sur la commande
 *                        + acompte du client (avance) utilisé dessus
 *  disponible            = cet argent − ce qui est déjà imputé sur ses bons
 *
 *  Le disponible est un ACOMPTE du client : il vient en déduction de sa dette
 *  et paiera automatiquement ses prochaines livraisons.
 * ========================================================================== */

/** Tout l'argent reçu au titre de la commande elle-même. */
export function commandMoney(cmd: Command): number {
  return (cmd.advancePaid ?? 0) + (cmd.extraPaid ?? 0) + (cmd.creditApplied ?? 0);
}

/** Argent de la commande pas encore imputé sur un bon de livraison. */
export function commandAdvanceAvailable(cmd: Command, deliveries: CommandDelivery[]): number {
  const used = deliveries
    .filter((d) => d.commandId === cmd.id)
    .reduce((s, d) => s + (d.advanceApplied ?? 0), 0);
  return Math.max(0, Math.round((commandMoney(cmd) - used) * 100) / 100);
}

export interface ClientCommandSummary {
  /** Argent des commandes pas encore imputé (acompte sur commandes). */
  advance: number;
  /** Valeur TTC commandée et pas encore livrée (information, pas une dette). */
  pending: number;
  /** Nombre de commandes qui attendent encore une livraison. */
  pendingCount: number;
}

/** Acompte et valeur non livrée d'une liste de commandes (celles d'un client). */
export function clientCommandSummary(
  commands: Command[], sales: Sale[], deliveries: CommandDelivery[]
): ClientCommandSummary {
  let advance = 0;
  let pending = 0;
  let pendingCount = 0;
  commands.forEach((cmd) => {
    if (cmd.status === 'cancelled') return;
    advance += commandAdvanceAvailable(cmd, deliveries);
    const left = netCommand(cmd, sales).billed;
    if (left > 0.005) {
      pending += left;
      pendingCount += 1;
    }
  });
  return { advance: Math.round(advance * 100) / 100, pending: Math.round(pending * 100) / 100, pendingCount };
}
