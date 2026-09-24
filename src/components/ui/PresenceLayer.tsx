import { motion, useIsPresent, type HTMLMotionProps } from 'framer-motion';

/**
 * Calque plein écran animé (voile d'une fenêtre, écran « Historique »…), à
 * placer directement dans un `<AnimatePresence>`.
 *
 * Dès que sa fermeture COMMENCE, il devient transparent aux clics — au rendu
 * React lui-même, sans attendre la première image de l'animation. Une fenêtre
 * qui s'efface ne peut donc jamais intercepter un clic, même sur un poste lent
 * ou quand le navigateur ralentit les animations.
 */
export function PresenceLayer({ style, ...props }: HTMLMotionProps<'div'>) {
  const isPresent = useIsPresent();
  return <motion.div {...props} style={{ ...style, pointerEvents: isPresent ? 'auto' : 'none' }} />;
}
