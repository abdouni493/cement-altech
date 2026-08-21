import { useEffect, useState, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { usePermissions } from '@/hooks/usePermissions';
import { AppLayout } from '@/components/layout/AppLayout';
import { ToastViewport } from '@/components/ui/Toast';
import type { PermissionModule } from '@/types';

import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Stock from '@/pages/Stock';
import Purchase from '@/pages/Purchase';
import Production from '@/pages/Production';
import Comptoir from '@/pages/Comptoir';
import POS from '@/pages/POS';
import Sales from '@/pages/Sales';
import Clients from '@/pages/Clients';
import Commands from '@/pages/Clients/Commands';
import Suppliers from '@/pages/Suppliers';
import Workers from '@/pages/Workers';
import Expenses from '@/pages/Expenses';
import Caisse from '@/pages/Caisse';
import CaisseReports from '@/pages/Caisse/CaisseReports';
import ComptoirStats from '@/pages/Caisse/ComptoirStats';
import Reports from '@/pages/Reports';
import SettingsPage from '@/pages/Settings';

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
  return <>{children}</>;
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
