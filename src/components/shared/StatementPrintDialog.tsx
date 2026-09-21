import { useEffect, useMemo, useState } from 'react';
import { Printer, Percent, ListChecks, Package, CheckSquare, Square } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatCurrency, computeTva, DEFAULT_TVA_RATE } from '@/lib/utils';
import { cn } from '@/lib/utils';

/* ============================================================================
 *  AVANT D'IMPRIMER UN COMPTE RENDU — QUE FAUT-IL METTRE DESSUS ?
 * ----------------------------------------------------------------------------
 *  L'ancienne fenetre ne posait qu'une question : « TVA ou pas ? ». Elle en
 *  pose maintenant trois, dans l'ordre ou l'operateur les pose lui-meme :
 *
 *   1. QUELLES PARTIES imprimer  — ventes, commandes, livraisons, versements,
 *      anciennes ecritures... presentees en LISTE A COCHER ;
 *   2. QUELS PRODUITS faire figurer — le detail des marchandises vendues et
 *      commandees, produit par produit, chacun cochable ;
 *   3. AVEC OU SANS TVA, et a quel taux.
 *
 *  Un apercu des totaux (H.T / T.V.A / T.T.C) se met a jour en direct : ce qui
 *  est affiche ici est EXACTEMENT ce qui sortira sur le papier.
 * ========================================================================== */

export interface PrintablePart {
  key: string;
  label: string;
  /** Nombre de lignes de la partie — « (0) » aide a ne pas cocher du vide. */
  count: number;
  /** Total de la partie, affiche a droite de la case a cocher. */
  total?: string;
  /** Partie cochee a l'ouverture. */
  defaultChecked?: boolean;
}

export interface PrintableProduct {
  key: string;
  label: string;
  /** « 74,5 m3 · 8 700,00 DA » */
  detail: string;
  amount: number;
}

export interface StatementPrintChoice {
  parts: string[];
  products: string[];
  includeProducts: boolean;
  applyTva: boolean;
  tvaRate: number;
}

export function StatementPrintDialog({
  open, onClose, onPrint, parts, products, title = 'Impression du compte rendu',
}: {
  open: boolean;
  onClose: () => void;
  onPrint: (choice: StatementPrintChoice) => void;
  parts: PrintablePart[];
  products: PrintableProduct[];
  title?: string;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const [pickedProducts, setPickedProducts] = useState<string[]>([]);
  const [includeProducts, setIncludeProducts] = useState(true);
  const [tvaOn, setTvaOn] = useState(false);
  const [tvaRate, setTvaRate] = useState(DEFAULT_TVA_RATE);

  // Chaque impression repart de valeurs neuves : cocher une partie pour un
  // client ne doit pas la laisser cochee pour le suivant.
  useEffect(() => {
    if (!open) return;
    setChecked(parts.filter((p) => p.defaultChecked !== false).map((p) => p.key));
    setPickedProducts(products.map((p) => p.key));
    setIncludeProducts(products.length > 0);
    setTvaOn(false);
    setTvaRate(DEFAULT_TVA_RATE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (key: string) =>
    setChecked((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  const toggleProduct = (key: string) =>
    setPickedProducts((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));

  /** TOTAL H.T imprime : la somme des produits reellement coches. */
  const ht = useMemo(
    () =>
      includeProducts
        ? products.filter((p) => pickedProducts.includes(p.key)).reduce((s, p) => s + p.amount, 0)
        : 0,
    [includeProducts, products, pickedProducts]
  );
  const preview = computeTva(ht, 0, tvaOn, tvaRate);

  const submit = () =>
    onPrint({
      parts: checked,
      products: includeProducts ? pickedProducts : [],
      includeProducts,
      applyTva: tvaOn,
      tvaRate: tvaOn ? tvaRate : 0,
    });

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-5">
        {/* ------------------------------------------------ 1. LES PARTIES -- */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="flex items-center gap-2 text-sm font-bold text-gold-dark">
              <ListChecks size={16} /> Parties a imprimer
            </h4>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => setChecked(parts.map((p) => p.key))}>
                Tout cocher
              </Button>
              <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => setChecked([])}>
                Tout decocher
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {parts.map((p) => {
              const on = checked.includes(p.key);
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => toggle(p.key)}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                    on ? 'border-gold/50 bg-gold/10' : 'border-gold/15 bg-vanilla/30 hover:bg-gold/5'
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {on ? <CheckSquare size={16} className="shrink-0 text-gold-dark" />
                        : <Square size={16} className="shrink-0 text-text-muted" />}
                    <span className="truncate text-[13px] font-semibold text-text-primary">
                      {p.label}
                      <span className="ml-1 text-[11px] font-normal text-text-muted">({p.count})</span>
                    </span>
                  </span>
                  {p.total && <span className="shrink-0 text-[11px] font-bold tabular text-gold-dark">{p.total}</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* ------------------------------------------------ 2. LES PRODUITS -- */}
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 text-sm font-bold text-gold-dark">
              <Package size={16} /> Produits (ventes et commandes)
            </h4>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant={includeProducts ? 'gold' : 'secondary'}
                className="text-[11px]"
                onClick={() => setIncludeProducts((v) => !v)}
              >
                {includeProducts ? 'Tableau des produits inclus' : 'Sans tableau de produits'}
              </Button>
              {includeProducts && (
                <>
                  <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => setPickedProducts(products.map((p) => p.key))}>
                    Tout
                  </Button>
                  <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => setPickedProducts([])}>
                    Aucun
                  </Button>
                </>
              )}
            </div>
          </div>

          {products.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gold/25 bg-vanilla/20 py-3 text-center text-xs italic text-text-muted">
              Aucun produit sur cette periode
            </p>
          ) : (
            <div className={cn('max-h-[220px] space-y-1.5 overflow-y-auto pr-1', !includeProducts && 'opacity-40 pointer-events-none')}>
              {products.map((p) => {
                const on = pickedProducts.includes(p.key);
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => toggleProduct(p.key)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                      on ? 'border-gold/50 bg-gold/10' : 'border-gold/15 bg-vanilla/30 hover:bg-gold/5'
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {on ? <CheckSquare size={15} className="shrink-0 text-gold-dark" />
                          : <Square size={15} className="shrink-0 text-text-muted" />}
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-text-primary">{p.label}</span>
                        <span className="block truncate text-[11px] text-text-muted">{p.detail}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] font-bold tabular text-gold-dark">
                      {formatCurrency(p.amount)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ----------------------------------------------------- 3. LA TVA -- */}
        <section className="space-y-2.5">
          <h4 className="flex items-center gap-2 text-sm font-bold text-gold-dark">
            <Percent size={16} /> Total du document
          </h4>
          <div className="grid grid-cols-3 gap-2">
            <TotalTile label="Total H.T" value={formatCurrency(ht)} />
            <TotalTile
              label={tvaOn ? `T.V.A ${tvaRate} %` : 'T.V.A (desactivee)'}
              value={formatCurrency(preview.tvaAmount)}
              muted={!tvaOn}
            />
            <TotalTile label={tvaOn ? 'Total T.T.C' : 'Total imprime'} value={formatCurrency(preview.totalTTC)} />
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gold/25 bg-vanilla/40 p-3">
            <Button
              size="sm"
              variant={tvaOn ? 'secondary' : 'gold'}
              onClick={() => setTvaOn(false)}
            >
              Sans TVA
            </Button>
            <Button
              size="sm"
              variant={tvaOn ? 'gold' : 'secondary'}
              onClick={() => setTvaOn(true)}
            >
              <Percent size={14} /> Avec TVA
            </Button>
            {tvaOn && (
              <label className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
                Taux
                <input
                  type="number" step="any" min={0} max={100}
                  value={tvaRate}
                  onChange={(e) => setTvaRate(Math.max(0, Number(e.target.value)))}
                  className="h-9 w-20 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-center text-sm font-semibold tabular text-text-primary focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
                />
                %
              </label>
            )}
            <span className="text-[11px] text-text-muted">
              Le document affiche d&rsquo;abord le total <b>hors taxes</b>, puis la TVA choisie ici.
            </span>
          </div>
        </section>

        <div className="flex gap-2 border-t border-gold/15 pt-4">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Annuler</Button>
          <Button variant="gold" className="flex-1 font-bold" onClick={submit}>
            <Printer size={16} /> Imprimer le compte rendu
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TotalTile({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-xl border border-gold/20 bg-vanilla/50 px-2.5 py-2 text-center">
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{label}</p>
      <p className={cn('mt-0.5 text-sm font-bold tabular', muted ? 'text-text-muted' : 'text-gold-dark')}>
        {value}
      </p>
    </div>
  );
}
