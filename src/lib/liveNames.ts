import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { useStockStore } from '@/store/stockStore';
import { useCommandStore } from '@/store/commandStore';
import { useSalesStore } from '@/store/salesStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useProductionStore } from '@/store/productionStore';

/* ============================================================================
 *  NOMS DE PRODUITS TOUJOURS A JOUR
 * ----------------------------------------------------------------------------
 *  Le nom d'une fiche technique / d'un produit de stock est recopie dans
 *  chaque ligne (commande, livraison, vente, achat, production). Apres un
 *  renommage, les ecrans et TOUTES les impressions (compte rendu, bon de
 *  livraison, historique, rapport general) doivent afficher le NOUVEAU nom.
 *
 *  La base le fait via les declencheurs de
 *  `altech_production_update_noms_produits_titres.sql` ; ce module applique la
 *  meme regle aux donnees deja chargees, a chaque changement d'un magasin :
 *  l'effet est immediat, sans recharger la page.
 * ========================================================================== */

type Names = { fiche: Map<string, string>; product: Map<string, string> };

/** Nom actuel d'une ligne rattachee a une fiche technique ou a un produit. */
function lineName(n: Names, cur: string, ficheId?: string, productId?: string): string {
  if (ficheId) return n.fiche.get(ficheId) ?? cur;
  if (productId) return n.fiche.get(productId) ?? n.product.get(productId) ?? cur;
  return cur;
}

/** Remplace les elements modifies seulement — sinon renvoie la meme liste. */
function mapList<T>(list: T[], fn: (x: T) => T): T[] {
  let changed = false;
  const out = list.map((x) => {
    const y = fn(x);
    if (y !== x) changed = true;
    return y;
  });
  return changed ? out : list;
}

function applyLiveNames() {
  const fiches = useFicheTechnicStore.getState().ficheTechnics;
  const products = useStockStore.getState().products;
  const n: Names = {
    fiche: new Map(fiches.map((f) => [f.id, f.name])),
    product: new Map(products.map((p) => [p.id, p.name])),
  };
  if (!n.fiche.size && !n.product.size) return;

  const usedName = <U extends { productId: string; productName: string; sourceType?: string }>(u: U): U => {
    const name = u.sourceType === 'fiche' ? n.fiche.get(u.productId) : n.product.get(u.productId);
    return name && name !== u.productName ? { ...u, productName: name } : u;
  };

  /* ---- commandes, livraisons, annulations -------------------------------- */
  const cmdState = useCommandStore.getState();
  const itemNames = new Map<string, string>();
  const commands = mapList(cmdState.commands, (c) => {
    const items = mapList(c.items, (it) => {
      const name = lineName(n, it.productName, it.ficheTechnicId, it.productId);
      if (it.id) itemNames.set(it.id, name);
      return name !== it.productName ? { ...it, productName: name } : it;
    });
    return items !== c.items ? { ...c, items } : c;
  });
  const deliveries = mapList(cmdState.deliveries, (d) => {
    const items = mapList(d.items, (l) => {
      const name = l.commandItemId ? itemNames.get(l.commandItemId) : undefined;
      return name && name !== l.productName ? { ...l, productName: name } : l;
    });
    const consumptions = mapList(d.consumptions ?? [], (c) => {
      const name = c.productId ? n.product.get(c.productId) : undefined;
      return name && name !== c.productName ? { ...c, productName: name } : c;
    });
    return items !== d.items || consumptions !== (d.consumptions ?? [])
      ? { ...d, items, consumptions }
      : d;
  });
  const adjustments = mapList(cmdState.adjustments, (a) => {
    const lines = mapList(a.lines, (l) => {
      const name = l.commandItemId ? itemNames.get(l.commandItemId) : undefined;
      return name && name !== l.productName ? { ...l, productName: name } : l;
    });
    return lines !== a.lines ? { ...a, lines } : a;
  });
  if (commands !== cmdState.commands || deliveries !== cmdState.deliveries || adjustments !== cmdState.adjustments) {
    useCommandStore.setState({ commands, deliveries, adjustments });
  }

  /* ---- ventes ------------------------------------------------------------ */
  const sales = useSalesStore.getState().sales;
  const nextSales = mapList(sales, (s) => {
    const lines = mapList(s.products, (l) => {
      const name = lineName(n, l.productName ?? '', l.ficheTechnicId, l.productId);
      return name && name !== l.productName ? { ...l, productName: name } : l;
    });
    return lines !== s.products ? { ...s, products: lines } : s;
  });
  if (nextSales !== sales) useSalesStore.setState({ sales: nextSales });

  /* ---- achats ------------------------------------------------------------ */
  const purchases = usePurchaseStore.getState().purchases;
  const nextPurchases = mapList(purchases, (p) => {
    const lines = mapList(p.products, (l) => {
      const name = l.productId ? n.product.get(l.productId) : undefined;
      return name && name !== l.productName ? { ...l, productName: name } : l;
    });
    return lines !== p.products ? { ...p, products: lines } : p;
  });
  if (nextPurchases !== purchases) usePurchaseStore.setState({ purchases: nextPurchases });

  /* ---- productions et recettes ------------------------------------------- */
  const productions = useProductionStore.getState().productions;
  const nextProductions = mapList(productions, (pr) => {
    const used = mapList(pr.usedProducts, usedName);
    return used !== pr.usedProducts ? { ...pr, usedProducts: used } : pr;
  });
  if (nextProductions !== productions) useProductionStore.setState({ productions: nextProductions });

  const nextFiches = mapList(fiches, (f) => {
    const used = mapList(f.usedProducts, usedName);
    return used !== f.usedProducts ? { ...f, usedProducts: used } : f;
  });
  if (nextFiches !== fiches) useFicheTechnicStore.setState({ ficheTechnics: nextFiches });
}

let installed = false;

/**
 * Branche la mise a jour des noms sur les magasins concernes. A appeler une
 * seule fois au demarrage de l'application.
 */
export function installLiveNames() {
  if (installed) return;
  installed = true;
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    try {
      applyLiveNames();
    } catch (e) {
      console.warn('[noms] mise a jour impossible', e);
    } finally {
      running = false;
    }
  };
  // Chaque magasin ne declenche le recalcul que si SES listes ont change.
  useFicheTechnicStore.subscribe((s, p) => { if (s.ficheTechnics !== p.ficheTechnics) run(); });
  useStockStore.subscribe((s, p) => { if (s.products !== p.products) run(); });
  useCommandStore.subscribe((s, p) => {
    if (s.commands !== p.commands || s.deliveries !== p.deliveries || s.adjustments !== p.adjustments) run();
  });
  useSalesStore.subscribe((s, p) => { if (s.sales !== p.sales) run(); });
  usePurchaseStore.subscribe((s, p) => { if (s.purchases !== p.purchases) run(); });
  useProductionStore.subscribe((s, p) => { if (s.productions !== p.productions) run(); });
  run();
}
