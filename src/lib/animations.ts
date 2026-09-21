import type { Transition, Variants } from 'framer-motion';

/* ============================================================================
 *  MOTION DE L'APPLICATION — RAPIDE, FLUIDE, SANS SACCADE
 * ----------------------------------------------------------------------------
 *  Règles appliquées partout (cf. skill « framer-emotion ») :
 *   · on n'anime QUE `transform` (x / y / scale) et `opacity` — composés par le
 *     GPU, jamais de recalcul de mise en page ;
 *   · durées courtes (0,12 s → 0,22 s) : une interface de caisse doit répondre,
 *     pas se donner en spectacle ;
 *   · le décalage en cascade (`stagger`) est plafonné : au-delà de quelques
 *     lignes, TOUT s'affiche en même temps — c'est ce qui rendait les écrans de
 *     50 cartes si lents à apparaître ;
 *   · `prefers-reduced-motion` est respecté via `motionSafe()`.
 * ========================================================================== */

/** L'utilisateur a demandé « moins d'animations » dans son système. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Courbe standard : départ franc, arrivée douce. */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const FAST: Transition = { duration: 0.16, ease: EASE };
export const SNAP: Transition = { duration: 0.12, ease: EASE };
export const SMOOTH: Transition = { duration: 0.22, ease: EASE };

/**
 * Décalage d'apparition d'une liste, PLAFONNÉ.
 * 12 cartes maximum sont décalées ; au-delà le délai reste constant, sinon la
 * 60ᵉ carte d'un écran n'apparaîtrait qu'au bout de 3 secondes.
 */
export const stepDelay = (index = 0, step = 0.022, max = 12): number =>
  Math.min(index, max) * step;

export const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: FAST },
  exit: { opacity: 0, y: -6, transition: SNAP },
};

export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: stepDelay(i), duration: 0.18, ease: EASE },
  }),
  hover: { y: -3, transition: SNAP },
};

/** Lignes d'un tableau — encore plus discret et plus rapide que les cartes. */
export const rowVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: stepDelay(i, 0.012, 16), duration: 0.14, ease: EASE },
  }),
};

export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.18, ease: EASE } },
  exit: { opacity: 0, scale: 0.98, y: 6, transition: SNAP },
};

/** Menu « trois points » : ouverture instantanée, ancrée en haut. */
export const menuVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: -4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.12, ease: EASE } },
  exit: { opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.1 } },
};

export const sidebarItemVariants: Variants = {
  hidden: { opacity: 0, x: -10 },
  visible: (i: number = 0) => ({
    opacity: 1,
    x: 0,
    transition: { delay: stepDelay(i, 0.018, 10), duration: 0.16, ease: EASE },
  }),
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.02, delayChildren: 0.02 } },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: FAST },
  exit: { opacity: 0, x: 24, transition: SNAP },
};

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -24 },
  visible: { opacity: 1, x: 0, transition: FAST },
  exit: { opacity: 0, x: -24, transition: SNAP },
};

export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: FAST },
  exit: { opacity: 0, scale: 0.98, transition: SNAP },
};

/** Apparition d'un panneau (onglet d'historique, section de rapport). */
export const panelVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: FAST },
  exit: { opacity: 0, y: -6, transition: SNAP },
};

export const shakeVariants: Variants = {
  shake: { x: [0, -8, 8, -8, 8, -4, 4, 0], transition: { duration: 0.35 } },
};
