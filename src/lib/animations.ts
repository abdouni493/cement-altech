import type { Variants } from 'framer-motion';

export const pageTransition = {
  initial: { opacity: 0, y: 20, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -10, scale: 0.98, transition: { duration: 0.25 } },
};

export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { delay: i * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  }),
  hover: { y: -4, scale: 1.02, transition: { duration: 0.2 } },
};

export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.85, y: 30 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, scale: 0.9, y: 20, transition: { duration: 0.2 } },
};

export const sidebarItemVariants: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: (i: number = 0) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.05, duration: 0.3 },
  }),
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 60 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, x: 60, transition: { duration: 0.2 } },
};

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -60 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, x: -60, transition: { duration: 0.2 } },
};

export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.3 } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2 } },
};

export const shakeVariants: Variants = {
  shake: {
    x: [0, -10, 10, -10, 10, -6, 6, 0],
    transition: { duration: 0.5 },
  },
};
