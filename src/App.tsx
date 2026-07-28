import { useEffect, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { AppLayout } from '@/components/layout/AppLayout';
import { ToastViewport } from '@/components/ui/Toast';

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
import ClientDebtsPage from '@/pages/Expenses/ClientDebts';
import Caisse from '@/pages/Caisse';
import CaisseReports from '@/pages/Caisse/CaisseReports';
import ComptoirStats from '@/pages/Caisse/ComptoirStats';
import Reports from '@/pages/Reports';
import SettingsPage from '@/pages/Settings';

import { useThemeStore, applyTheme } from '@/store/themeStore';

function PrivateRoute({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  const language = useAuthStore((s) => s.language);
  const theme = useThemeStore((s) => s.theme);

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
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/purchase" element={<Purchase />} />
          <Route path="/production" element={<Production />} />
          <Route path="/comptoir" element={<Comptoir />} />
          <Route path="/pos" element={<POS />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/commands" element={<Commands />} />
          <Route path="/clients/commands" element={<Commands />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/workers" element={<Workers />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/expenses/debts" element={<ClientDebtsPage />} />
          <Route path="/debts-clients" element={<ClientDebtsPage />} />
          <Route path="/caisse" element={<Caisse />} />
          <Route path="/caisse/reports" element={<CaisseReports />} />
          <Route path="/caisse/statistics" element={<ComptoirStats />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}
