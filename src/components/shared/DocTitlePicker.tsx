import { useEffect, useState } from 'react';
import { Heading, Plus, X, CalendarRange, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useDocTitleStore, type DocTitleScope } from '@/store/docTitleStore';

/* ============================================================================
 *  CHOIX DU TITRE D'UN DOCUMENT IMPRIME
 * ----------------------------------------------------------------------------
 *  Avant chaque impression l'operateur choisit :
 *   1. le TITRE du document (en-tete) : le titre par defaut, un titre deja
 *      cree, ou un nouveau titre cree sur place (memorise pour la suite) ;
 *   2. le texte place DEVANT LES DATES de la periode
 *      (« COMPTE RENDU » DU 01/09/2026 AU 25/09/2026) : identique au titre
 *      choisi, ou un texte different. Les dates, elles, ne changent jamais.
 * ========================================================================== */

export interface DocTitleChoice {
  title: string;
  periodMode: 'same' | 'custom';
  periodText: string;
}

export function initialDocTitleChoice(defaultTitle: string, defaultPeriodPrefix?: string): DocTitleChoice {
  return { title: defaultTitle, periodMode: 'custom', periodText: defaultPeriodPrefix ?? defaultTitle };
}

/** Titre imprime dans l'en-tete. */
export function resolvedDocTitle(c: DocTitleChoice, fallback: string): string {
  return (c.title.trim() || fallback).toUpperCase();
}

/** Texte imprime devant les dates de la periode. */
export function resolvedPeriodPrefix(c: DocTitleChoice, fallback: string): string {
  const raw = c.periodMode === 'same' ? c.title : c.periodText;
  return (raw.trim() || fallback).toUpperCase();
}

export function DocTitlePicker({
  value, onChange, defaultTitle, defaultPeriodPrefix, periodSuffix, scope,
}: {
  value: DocTitleChoice;
  onChange: (next: DocTitleChoice) => void;
  defaultTitle: string;
  /** Texte d'origine devant les dates — ex. « COMPTE RENDU ». */
  defaultPeriodPrefix?: string;
  /** Ce qui suit le texte : « DU 01/09/2026 AU 25/09/2026 ». Absent = pas de ligne de periode. */
  periodSuffix?: string;
  scope: DocTitleScope;
}) {
  const { titles, loaded, shared, load, addTitle, removeTitle } = useDocTitleStore();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const isDefault = (t: string) => t.toUpperCase() === defaultTitle.toUpperCase();

  const select = (title: string) => {
    onChange(
      isDefault(title)
        ? { title, periodMode: 'custom', periodText: defaultPeriodPrefix ?? title }
        : { ...value, title, periodMode: 'same' }
    );
  };

  const create = async () => {
    const t = draft.trim();
    if (!t) return;
    setBusy(true);
    try {
      const row = await addTitle(t, scope);
      setDraft('');
      select(row.title);
    } catch {
      /* le toast d'erreur est deja affiche */
    } finally {
      setBusy(false);
    }
  };

  const others = titles.filter((t) => !isDefault(t.title));
  const current = value.title.toUpperCase();
  const fallbackPrefix = defaultPeriodPrefix ?? defaultTitle;

  const chip = (label: string, onClick: () => void, active: boolean, extra?: JSX.Element, tag?: string) => (
    <span
      key={label}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border pl-3 pr-1.5 py-1 text-[12px] font-semibold transition-colors',
        active ? 'border-gold/60 bg-gold/15 text-gold-dark' : 'border-gold/20 bg-vanilla/40 text-text-secondary hover:bg-gold/5'
      )}
    >
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1">
        {active && <Check size={13} />}
        {label}
        {tag && <span className="ml-1 text-[10px] font-normal text-text-muted">({tag})</span>}
      </button>
      {extra}
    </span>
  );

  return (
    <section className="space-y-2.5">
      <h4 className="flex items-center gap-2 text-sm font-bold text-gold-dark">
        <Heading size={16} /> Titre du document
      </h4>
      <div className="space-y-3 rounded-2xl border border-gold/25 bg-vanilla/40 p-3">
        <div className="flex flex-wrap gap-1.5">
          {chip(defaultTitle.toUpperCase(), () => select(defaultTitle), current === defaultTitle.toUpperCase(), undefined, 'par défaut')}
          {others.map((t) =>
            chip(
              t.title,
              () => select(t.title),
              current === t.title.toUpperCase(),
              <button
                type="button"
                title="Supprimer ce titre"
                onClick={() => {
                  void removeTitle(t.id);
                  if (current === t.title.toUpperCase()) select(defaultTitle);
                }}
                className="rounded-full p-0.5 text-text-muted hover:bg-rose-500/15 hover:text-rose-600"
              >
                <X size={12} />
              </button>
            )
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void create(); }
            }}
            placeholder="Nouveau titre (ex. RELEVÉ DE COMPTE)"
            className="h-9 min-w-0 flex-1 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-3 text-sm font-semibold uppercase text-text-primary focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
          />
          <Button size="sm" variant="outline" className="h-9" disabled={!draft.trim() || busy} onClick={() => void create()}>
            <Plus size={14} /> Créer
          </Button>
        </div>
        {!shared && (
          <p className="text-[11px] text-text-muted">
            Titres gardés sur ce poste : exécutez altech_production_update_noms_produits_titres.sql pour les partager.
          </p>
        )}

        {periodSuffix !== undefined && (
          <div className="space-y-2 border-t border-gold/15 pt-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
              <CalendarRange size={14} /> Texte devant les dates de la période
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={value.periodMode === 'same' ? 'gold' : 'secondary'}
                onClick={() => onChange({ ...value, periodMode: 'same' })}
              >
                Identique au titre
              </Button>
              <Button
                size="sm"
                variant={value.periodMode === 'custom' ? 'gold' : 'secondary'}
                onClick={() => onChange({ ...value, periodMode: 'custom' })}
              >
                Texte différent
              </Button>
              {value.periodMode === 'custom' && (
                <input
                  value={value.periodText}
                  onChange={(e) => onChange({ ...value, periodText: e.target.value })}
                  placeholder={fallbackPrefix}
                  className="h-9 min-w-[12rem] flex-1 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-3 text-sm font-semibold uppercase text-text-primary focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
                />
              )}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-dashed border-gold/30 bg-vanilla/60 px-3 py-2 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Aperçu</p>
          <p className="text-sm font-extrabold tracking-wide text-text-primary">{resolvedDocTitle(value, defaultTitle)}</p>
          {periodSuffix !== undefined && (
            <p className="text-[12px] font-semibold text-text-secondary">
              {resolvedPeriodPrefix(value, fallbackPrefix)} {periodSuffix}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
