/* ============================================================================
 *  VERROU DE DEFILEMENT DE LA PAGE — UN SEUL, PARTAGE
 * ----------------------------------------------------------------------------
 *  Les fenêtres modales ET l'écran « Historique » plein écran écrivaient
 *  chacun `document.body.style.overflow` de leur côté, sans se connaître :
 *  l'un pouvait rendre le défilement pendant que l'autre était encore ouvert,
 *  ou le laisser bloqué après sa fermeture — « je ne peux plus défiler ».
 *
 *  Chaque écran qui recouvre la page demande désormais un verrou et le rend
 *  en se fermant ; la page ne redevient défilable qu'au DERNIER verrou rendu.
 * ========================================================================== */

let count = 0;
let saved = '';

function apply() {
  if (typeof document === 'undefined') return;
  const body = document.body;
  if (count > 0) {
    body.style.overflow = 'hidden';
  } else {
    body.style.overflow = saved;
    body.style.removeProperty('pointer-events');
  }
}

/** Bloque le défilement de la page ; appeler la fonction renvoyée pour le rendre. */
export function lockScroll(): () => void {
  if (count === 0 && typeof document !== 'undefined') {
    saved = document.body.style.overflow === 'hidden' ? '' : document.body.style.overflow;
  }
  count += 1;
  apply();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    apply();
  };
}

/**
 * Filet de sécurité appelé à chaque changement d'écran : aucune fenêtre ne
 * survit à la navigation, la page doit donc redevenir défilable et cliquable.
 */
export function resetScrollLock(): void {
  count = 0;
  apply();
}

/** Nombre de fenêtres qui bloquent actuellement le défilement. */
export function scrollLockCount(): number {
  return count;
}
