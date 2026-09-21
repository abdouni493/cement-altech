import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { usePermissions } from '@/hooks/usePermissions';
import { AppLayout } from '@/components/layout/AppLayout';
import { ToastViewport } from '@/components/ui/Toast';
import type { PermissionModule } from '@/types';

import Login from '@/pages/Login';

/* ============================================================================
 *  CHARGEMENT A LA DEMANDE DES ECRANS
 * ----------------------------------------------------------------------------
 *  L'application chargeait TOUS ses ecrans d'un bloc : plus d'un megaoctet de
 *  code avant d'afficher la premiere page, sur des postes qui ne sont pas des
 *  stations de travail. Chaque ecran est desormais un morceau separe, telecharge
 *  au moment ou l'operateur l'ouvre — le demarrage et la navigation deviennent
 *  immediats, et le navigateur garde en cache ce qu'il a deja charge.
 * ========================================================================== */
const Dashboard     = lazy(() => import('@/pages/Dashboard'));
const Stock         = lazy(() => import('@/pages/Stock'));
const Purchase      = lazy(() => import('@/pages/Purchase'));
const Production    = lazy(() => import('@/pages/Production'));
const Comptoir      = lazy(() => import('@/pages/Comptoir'));
const POS           = lazy(() => import('@/pages/POS'));
const Sales         = lazy(() => import('@/pages/Sales'));
const Clients       = lazy(() => import('@/pages/Clients'));
const Commands      = lazy(() => import('@/pages/Clients/Commands'));
const Suppliers     = lazy(() => import('@/pages/Suppliers'));
const Workers       = lazy(() => import('@/pages/Workers'));
const Expenses      = lazy(() => import('@/pages/Expenses'));
const Caisse        = lazy(() => import('@/pages/Caisse'));
const CaisseReports = lazy(() => import('@/pages/Caisse/CaisseReports'));
const ComptoirStats = lazy(() => import('@/pages/Caisse/ComptoirStats'));
const Reports       = lazy(() => import('@/pages/Reports'));
const SettingsPage  = lazy(() => import('@/pages/Settings'));

import { useThemeStore, applyTheme } from '@/store/themeStore';
import { hydrateFromSupabase } from '@/lib/sync';
import { navItems } from '@/components/layout/navItems';

function BootScreen({ label = 'Connexion à la base de données…' }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-hero">
      <div className="h-12 w-12 rounded-full border-4 border-gold/30 border-t-gold animate-spin" />
      <p className="text-sm text-text-muted">{label}</p>
    </div>
  );
}

function PrivateRoute({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);
  if (isBootstrapping) return <BootScreen />;
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

/**
 * Blocks a module a worker has no "view" permission on — typing the URL by hand
 * is not enough to reach a screen the administrator did not grant.
 */
function Guarded({ module, children }: { module: PermissionModule; children: ReactNode }) {
  const { canView } = usePermissions();
  if (!canView(module)) return <Navigate to="/" replace />;
  // Le morceau de code de l'ecran est telecharge ici, derriere un voyant
  // discret : l'interface reste reactive pendant le chargement.
  return <Suspense fallback={<ScreenLoader />}>{children}</Suspense>;
}

/** Voyant de chargement d'un ecran — volontairement leger et silencieux. */
function ScreenLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-gold/25 border-t-gold" />
    </div>
  );
}

/** Sends the user to the first screen he is actually allowed to open. */
function HomeRedirect() {
  const { canView } = usePermissions();
  const first = navItems.find((item) => canView(item.module));
  return <Navigate to={first ? first.to : '/no-access'} replace />;
}

function NoAccess() {
  const logout = useAuthStore((s) => s.logout);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-hero p-6 text-center">
      <h1 className="font-display text-2xl font-bold text-text-primary">Aucun accès</h1>
      <p className="text-sm text-text-muted max-w-md">
        Votre compte n'a encore aucune permission. Demandez à l'administrateur de vous
        attribuer les interfaces auxquelles vous devez accéder.
      </p>
      <button
        onClick={() => { void logout(); window.location.href = '/login'; }}
        className="mt-2 px-5 py-2.5 rounded-xl bg-gradient-button text-stone-950 font-bold shadow-gold"
      >
        Se déconnecter
      </button>
    </div>
  );
}

export default function App() {
  const language = useAuthStore((s) => s.language);
  const theme = useThemeStore((s) => s.theme);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [hydrating, setHydrating] = useState(false);

  // Restores the Supabase session then reloads every module FROM THE DATABASE.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await restoreSession();
      if (cancelled) return;
      if (useAuthStore.getState().isAuthenticated) {
        setHydrating(true);
        await hydrateFromSupabase();
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [restoreSession]);

  // A fresh login (or an account switch) reloads everything as well.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setHydrating(true);
      await hydrateFromSupabase();
      if (!cancelled) setHydrating(false);
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  // Coming back to the tab re-reads the data (and the permission matrix) so two
  // machines stay aligned and a worker picks up rights granted while he was in.
  useEffect(() => {
    const onFocus = () => {
      if (!useAuthStore.getState().isAuthenticated) return;
      void useAuthStore.getState().refreshProfile();
      void hydrateFromSupabase({ force: false });
    };
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(onFocus, 120_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', language);
  }, [language]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <>
      <ToastViewport />
      {hydrating && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-2 rounded-full border border-gold/25 bg-gradient-card px-4 py-1.5 text-xs font-medium text-text-secondary shadow-card">
          <span className="h-3 w-3 rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
          Synchronisation des données…
        </div>
      )}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/no-access" element={<PrivateRoute><NoAccess /></PrivateRoute>} />
        <Route
          element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          }
        >
          <Route path="/dashboard" element={<Guarded module="dashboard"><Dashboard /></Guarded>} />
          <Route path="/stock" element={<Guarded module="stock"><Stock /></Guarded>} />
          <Route path="/purchase" element={<Guarded module="purchase"><Purchase /></Guarded>} />
          <Route path="/production" element={<Guarded module="production"><Production /></Guarded>} />
          <Route path="/comptoir" element={<Guarded module="comptoir"><Comptoir /></Guarded>} />
          <Route path="/pos" element={<Guarded module="pos"><POS /></Guarded>} />
          <Route path="/sales" element={<Guarded module="sales"><Sales /></Guarded>} />
          <Route path="/clients" element={<Guarded module="clients"><Clients /></Guarded>} />
          <Route path="/commands" element={<Guarded module="clients"><Commands /></Guarded>} />
          <Route path="/clients/commands" element={<Guarded module="clients"><Commands /></Guarded>} />
          <Route path="/suppliers" element={<Guarded module="suppliers"><Suppliers /></Guarded>} />
          <Route path="/workers" element={<Guarded module="workers"><Workers /></Guarded>} />
          <Route path="/expenses" element={<Guarded module="expenses"><Expenses /></Guarded>} />
          {/* Les dettes clients sont désormais intégrées à l'interface Clients */}
          <Route path="/expenses/debts" element={<Navigate to="/clients" replace />} />
          <Route path="/debts-clients" element={<Navigate to="/clients" replace />} />
          <Route path="/caisse" element={<Guarded module="caisse"><Caisse /></Guarded>} />
          <Route path="/caisse/reports" element={<Guarded module="caisse"><CaisseReports /></Guarded>} />
          <Route path="/caisse/statistics" element={<Guarded module="caisse"><ComptoirStats /></Guarded>} />
          <Route path="/reports" element={<Guarded module="reports"><Reports /></Guarded>} />
          <Route path="/settings" element={<Guarded module="settings"><SettingsPage /></Guarded>} />
          <Route path="/" element={<HomeRedirect />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
