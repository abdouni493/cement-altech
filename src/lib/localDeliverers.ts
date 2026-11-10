import type { Deliverer, DelivererPayment, PurchaseDelivererAssignment } from '@/types';

/**
 * STOCKAGE LOCAL DES LIVREURS
 * ---------------------------------------------------------------------------
 * L'interface « Livreurs » fonctionne SANS modification de la base de données
 * (aucun script SQL à exécuter). Les fiches livreurs, leurs règlements et leur
 * affectation aux factures d'achat sont conservés dans le navigateur
 * (localStorage). Les mouvements d'argent (règlement d'une dette, montant payé
 * au livreur) restent, eux, enregistrés dans la vraie caisse via la fonction
 * existante `add_caisse_transaction` — ils apparaissent donc dans la caisse et
 * les rapports comme n'importe quelle sortie.
 *
 * Limite assumée : ces données sont propres au navigateur de ce poste ; elles
 * ne sont pas synchronisées entre plusieurs machines.
 */

const KEY = 'altech-deliverers-v1';

export interface DelivererData {
  deliverers: Deliverer[];
  payments: DelivererPayment[];
  assignments: Record<string, PurchaseDelivererAssignment>;
}

const EMPTY: DelivererData = { deliverers: [], payments: [], assignments: {} };

export function loadDelivererData(): DelivererData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<DelivererData>;
    return {
      deliverers: Array.isArray(parsed.deliverers) ? parsed.deliverers : [],
      payments: Array.isArray(parsed.payments) ? parsed.payments : [],
      assignments: parsed.assignments && typeof parsed.assignments === 'object' ? parsed.assignments : {},
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveDelivererData(data: DelivererData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* quota dépassé ou stockage indisponible — on ignore silencieusement */
  }
}

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch { /* ignore */ }
  return `dlv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
