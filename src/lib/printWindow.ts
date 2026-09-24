import { lockScroll } from './scrollLock';

/* ============================================================================
 *  APERÇU D'IMPRESSION DANS L'APPLICATION
 * ----------------------------------------------------------------------------
 *  Chaque impression ouvrait une petite FENÊTRE (`window.open`) qui lançait
 *  aussitôt `window.print()`. Cette fenêtre partage le processus de
 *  l'application : tant que sa boîte d'impression reste ouverte, l'application
 *  entière est GELÉE — plus aucun clic, plus aucun défilement. Il suffisait de
 *  revenir sur l'application (la fenêtre d'impression passait alors derrière)
 *  pour tomber sur une interface bloquée, sans rien voir qui l'explique.
 *
 *  Le document s'affiche désormais PAR-DESSUS l'application, avec les mêmes
 *  boutons « Imprimer » / « Fermer » : la boîte d'impression apparaît toujours
 *  devant l'opérateur, et « Fermer » (ou Échap) rend la main immédiatement.
 *  Plus de fenêtre perdue derrière l'écran, plus de bloqueur de fenêtres
 *  surgissantes qui empêchait l'impression sans prévenir.
 * ========================================================================== */

const ROOT_ID = 'altech-print-preview';

/** Dans l'aperçu, la barre « Imprimer / Fermer » reste visible en haut. */
const PREVIEW_CSS = `
  .toolbar { position: sticky; top: 0; z-index: 50; padding: 10px 0; }
  @media print { .toolbar { display: none !important; } }
`;

type PreviewRoot = HTMLDivElement & { __close?: () => void };

/** Ferme l'aperçu d'impression ouvert, s'il y en a un. */
export function closePrintPreview(): void {
  (document.getElementById(ROOT_ID) as PreviewRoot | null)?.__close?.();
}

/**
 * Affiche un document HTML complet dans l'aperçu d'impression. Le script du
 * document (impression automatique à l'ouverture, boutons de la barre) s'y
 * exécute comme dans l'ancienne fenêtre.
 */
export function openPrintPreview(html: string, title = 'Impression'): void {
  closePrintPreview();

  const root = document.createElement('div') as PreviewRoot;
  root.id = ROOT_ID;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', title);
  // Les écrans ouverts dessous (historique…) ignorent Échap tant qu'une
  // fenêtre est ouverte par-dessus : c'est l'aperçu qui se ferme.
  root.setAttribute('data-modal-open', 'true');
  root.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;display:flex;background:rgba(15,23,42,.45);';

  const frame = document.createElement('iframe');
  frame.title = title;
  frame.style.cssText = 'flex:1;width:100%;height:100%;border:0;background:#f8fafc;';
  root.appendChild(frame);

  const release = lockScroll();
  let closed = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    root.remove();
    release();
  }
  root.__close = close;

  frame.addEventListener('load', () => {
    const win = frame.contentWindow;
    if (!win || closed) return;
    try {
      // « Fermer » appelait window.close() sur la fenêtre d'impression.
      (win as Window & { close: () => void }).close = close;
      win.document.addEventListener('keydown', onKey, true);
      win.document.head?.insertAdjacentHTML('beforeend', `<style>${PREVIEW_CSS}</style>`);
      win.focus();
    } catch {
      /* document d'une autre origine : impossible ici (srcdoc) */
    }
  });

  window.addEventListener('keydown', onKey, true);
  // Le document est donné AVANT l'insertion : le cadre charge directement le
  // document à imprimer, sans passer par une page vide.
  frame.srcdoc = html;
  document.body.appendChild(root);
}
