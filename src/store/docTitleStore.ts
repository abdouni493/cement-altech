import { create } from 'zustand';
import { db } from '@/lib/db';
import { save } from '@/lib/persist';

/* ============================================================================
 *  TITRES PERSONNALISES DES IMPRESSIONS
 * ----------------------------------------------------------------------------
 *  L'operateur peut creer ses propres titres (« SITUATION DU CLIENT »,
 *  « RELEVE DE COMPTE »...) au moment d'imprimer. Ils sont partages par tous
 *  les postes via la table `document_titles`
 *  (altech_production_update_noms_produits_titres.sql). Tant que ce script
 *  n'a pas ete execute, ils sont gardes sur ce poste seulement.
 * ========================================================================== */

export type DocTitleScope = 'statement' | 'delivery' | 'report' | 'list';

export interface DocTitle {
  id: string;
  title: string;
  scope: DocTitleScope;
}

const LOCAL_KEY = 'altech.documentTitles';

function readLocal(): DocTitle[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocal(list: DocTitle[]) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { /* mode prive */ }
}

interface DocTitleState {
  titles: DocTitle[];
  /** false tant que la table `document_titles` n'existe pas dans la base. */
  shared: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  addTitle: (title: string, scope: DocTitleScope) => Promise<DocTitle>;
  removeTitle: (id: string) => Promise<void>;
}

export const useDocTitleStore = create<DocTitleState>()((set, get) => ({
  titles: [],
  shared: true,
  loaded: false,

  load: async () => {
    try {
      const rows = await db.documentTitles.list();
      set({ titles: rows as DocTitle[], shared: true, loaded: true });
    } catch (e) {
      console.warn('[titres] table document_titles indisponible — titres gardes sur ce poste', e);
      set({ titles: readLocal(), shared: false, loaded: true });
    }
  },

  addTitle: async (raw, scope) => {
    const title = raw.trim().toUpperCase();
    // un titre sert a tous les documents : pas de doublon, quelle que soit la famille
    const existing = get().titles.find((t) => t.title.toUpperCase() === title);
    if (existing) return existing;
    if (get().shared) {
      const row = (await save('documentTitles.create', () => db.documentTitles.create(title, scope))) as DocTitle;
      set({ titles: [row, ...get().titles] });
      return row;
    }
    const row: DocTitle = { id: `local-${Date.now()}`, title, scope };
    const titles = [row, ...get().titles];
    writeLocal(titles);
    set({ titles });
    return row;
  },

  removeTitle: async (id) => {
    if (get().shared && !id.startsWith('local-')) {
      await save('documentTitles.delete', () => db.documentTitles.remove(id));
    }
    const titles = get().titles.filter((t) => t.id !== id);
    if (!get().shared) writeLocal(titles);
    set({ titles });
  },
}));
