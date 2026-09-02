// ============================================================================
//  Dépliage d'une fiche technique en matières premières du STOCK.
// ----------------------------------------------------------------------------
//  Miroir exact, côté application, de la fonction SQL
//  `public.fiche_stock_requirements()` livrée par
//  `altech_production_update_livraison_stock_historique.sql`.
//
//  Sert à MONTRER, avant de valider un bon de livraison, ce qui va réellement
//  être retiré de « Gestion de stock ». La déduction elle-même reste faite par
//  la base de données : cet utilitaire n'écrit rien.
//
//  RÈGLE — pour `quantity` unités livrées d'une fiche :
//        quantité déduite = quantité de la recette × quantité livrée
//                           ------------------------------------------
//                                 quantité produite par la fiche
//  Une ligne « fiche » (semi-fini) est dépliée récursivement dans sa propre
//  recette, sinon elle ne déduirait rien.
// ============================================================================
import type { Product } from '@/types';
import type { FicheTechnic } from '@/store/ficheTechnicStore';

export interface StockRequirement {
  /** Identifiant du produit de stock, quand il a pu être résolu. */
  productId?: string;
  productName: string;
  unit?: string;
  /** Quantité à retirer du stock. */
  quantity: number;
  unitCost: number;
  lineCost: number;
  /** Quantité actuellement disponible — `undefined` si le produit est introuvable. */
  available?: number;
  /** Vrai quand le stock ne couvre pas la quantité nécessaire. */
  shortage: boolean;
}

const MAX_DEPTH = 5;

type RawLine = { productId?: string; productName: string; unit?: string; quantity: number; unitCost: number };

function expand(
  ficheId: string | undefined,
  quantity: number,
  fiches: FicheTechnic[],
  depth: number,
  out: RawLine[]
): void {
  if (!ficheId || quantity <= 0 || depth > MAX_DEPTH) return;
  const fiche = fiches.find((f) => f.id === ficheId);
  if (!fiche) return;

  // rendement nul ou absent : la recette vaut pour une unité
  const output = Number(fiche.outputQuantity) > 0 ? Number(fiche.outputQuantity) : 1;
  const factor = quantity / output;

  (fiche.usedProducts ?? []).forEach((line) => {
    const used = (Number(line.quantityUsed) || 0) * factor;
    if (used <= 0) return;
    if (line.sourceType === 'fiche') {
      expand(line.productId, used, fiches, depth + 1, out);
      return;
    }
    out.push({
      productId: line.productId || undefined,
      productName: line.productName || 'Ingrédient',
      unit: line.unit,
      quantity: used,
      unitCost: Number(line.unitCost) || 0,
    });
  });
}

/** Résout un produit de stock par identifiant puis, à défaut, par son nom. */
function findProduct(products: Product[], productId?: string, name?: string): Product | undefined {
  if (productId) {
    const byId = products.find((p) => p.id === productId);
    if (byId) return byId;
  }
  const key = (name ?? '').trim().toLowerCase();
  if (!key) return undefined;
  return products.find((p) => p.name.trim().toLowerCase() === key);
}

/**
 * Matières premières à retirer du stock pour livrer `lines`.
 * Les lignes sans fiche technique sont traitées comme un produit de stock
 * vendu tel quel — exactement comme le fait la base de données.
 */
export function stockRequirementsForDelivery(
  lines: Array<{ ficheTechnicId?: string; productId?: string; productName: string; quantity: number }>,
  fiches: FicheTechnic[],
  products: Product[]
): StockRequirement[] {
  const raw: RawLine[] = [];

  lines.forEach((line) => {
    if (!line.quantity || line.quantity <= 0) return;
    if (line.ficheTechnicId) {
      expand(line.ficheTechnicId, line.quantity, fiches, 0, raw);
      return;
    }
    // pas de recette : la ligne consomme le produit de stock qu'elle désigne
    const direct = findProduct(products, line.productId, line.productName);
    if (!direct) return;
    raw.push({
      productId: direct.id,
      productName: direct.name,
      unit: direct.unit,
      quantity: line.quantity,
      unitCost: direct.purchasePrice || 0,
    });
  });

  // regroupement par matière — une même matière peut venir de plusieurs lignes
  const merged = new Map<string, StockRequirement>();
  raw.forEach((r) => {
    const product = findProduct(products, r.productId, r.productName);
    const key = product?.id ?? `name:${r.productName.trim().toLowerCase()}`;
    const cur = merged.get(key);
    const unitCost = r.unitCost || product?.purchasePrice || 0;
    if (cur) {
      cur.quantity += r.quantity;
      cur.lineCost = cur.quantity * cur.unitCost;
    } else {
      merged.set(key, {
        productId: product?.id,
        productName: product?.name ?? r.productName,
        unit: r.unit ?? product?.unit,
        quantity: r.quantity,
        unitCost,
        lineCost: r.quantity * unitCost,
        available: product?.currentQuantity,
        shortage: false,
      });
    }
  });

  const list = [...merged.values()];
  list.forEach((x) => {
    x.quantity = Math.round(x.quantity * 1000) / 1000;
    x.lineCost = Math.round(x.quantity * x.unitCost * 100) / 100;
    x.shortage = x.available !== undefined && x.available + 0.0001 < x.quantity;
  });
  return list.sort((a, b) => b.lineCost - a.lineCost);
}
