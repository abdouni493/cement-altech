import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ErrorBoundary } from './ErrorBoundary';
import { FAST } from '@/lib/animations';
import { resetScrollLock } from '@/lib/scrollLock';

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // CHANGER D'ECRAN REND TOUJOURS LA PAGE UTILISABLE.
  // Aucune fenetre ne survit a la navigation (bouton retour du navigateur,
  // menu lateral...) : le defilement et les clics sont rendus, le menu mobile
  // se replie et la nouvelle page s'ouvre en haut.
  useEffect(() => {
    resetScrollLock();
    setSidebarOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-cream">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 lg:p-6 overflow-x-hidden">
          {/*
            Keying the wrapper by pathname remounts it on every navigation, so the
            entrance animation replays per page WITHOUT relying on AnimatePresence's
            "wait" mode — which could deadlock at opacity:0 if an exit was interrupted
            and leave pages blank until a refresh.
          */}
          {/* L'entree d'un ecran dure 0,16 s et n'anime QUE `opacity` et `y`
              (composes par le GPU) : la navigation parait instantanee au lieu
              de faire attendre un tiers de seconde a chaque changement de page. */}
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={FAST}
          >
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
