import { NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Building2, Warehouse, Factory, ShoppingCart, Receipt, Calculator,
  Users, ClipboardList, Truck, HardHat, Banknote, Coins, Wallet,
  TrendingUp, Settings, LogOut, X, PackageCheck
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { useSettingsStore } from '@/store/settingsStore';
import { LogoBadge } from '@/components/shared/LogoBadge';
import { sidebarItemVariants } from '@/lib/animations';
import type { PermissionModule } from '@/types';
import type { TranslationKey } from '@/lib/i18n';

interface NavItem {
  to: string;
  key: TranslationKey;
  module: PermissionModule;
  icon: typeof Building2;
}

const navItems: NavItem[] = [
  { to: '/dashboard', key: 'dashboard', module: 'dashboard', icon: Building2 },
  { to: '/stock', key: 'stock', module: 'stock', icon: Warehouse },
  { to: '/production', key: 'production', module: 'production', icon: Factory },
  { to: '/purchase', key: 'purchase', module: 'purchase', icon: ShoppingCart },
  { to: '/sales', key: 'sales', module: 'sales', icon: Receipt },
  { to: '/pos', key: 'pos', module: 'pos', icon: Calculator },
  { to: '/clients', key: 'clients', module: 'clients', icon: Users },
  { to: '/commands', key: 'commands', module: 'clients', icon: ClipboardList },
  { to: '/suppliers', key: 'suppliers', module: 'suppliers', icon: Truck },
  { to: '/workers', key: 'workers', module: 'workers', icon: HardHat },
  { to: '/expenses', key: 'expenses', module: 'expenses', icon: Banknote },
  { to: '/expenses/debts', key: 'debtsClients', module: 'expenses', icon: Coins },
  { to: '/caisse', key: 'caisse', module: 'caisse', icon: Wallet },
  { to: '/reports', key: 'reports', module: 'reports', icon: TrendingUp },
  { to: '/settings', key: 'settings', module: 'settings', icon: Settings },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const { t, isRTL } = useLanguage();
  const { canView } = usePermissions();
  const store = useSettingsStore((s) => s.settings);

  const visibleItems = navItems.filter((item) => canView(item.module));

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={onClose} />
      )}

      <motion.aside
        initial={false}
        className={`fixed lg:sticky top-0 z-40 h-screen w-[260px] bg-gradient-sidebar flex flex-col shrink-0 transition-transform duration-300 border-gold/20 ${
          isRTL ? 'right-0 border-l' : 'left-0 border-r'
        } ${open ? 'translate-x-0' : isRTL ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between gap-3 px-5 py-5">
          <div className="flex items-center gap-3">
            <LogoBadge size={44} icon={24} />
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-text-primary leading-tight truncate">
                {store.name || 'Altech Production'}
              </h2>
              <p className="text-[11px] text-text-secondary/80 truncate">
                {store.description || 'Vente & Fabrication de Ciment'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden text-text-secondary/70 hover:text-text-primary">
            <X size={20} />
          </button>
        </div>

        <div className="mx-5 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent mb-2" />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {visibleItems.map((item, i) => {
            const Icon = item.icon;
            return (
              <motion.div key={item.to} custom={i} variants={sidebarItemVariants} initial="hidden" animate="visible">
                <NavLink
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      isActive
                        ? 'btn-gold-animated text-black shadow-gold font-bold'
                        : 'text-text-secondary hover:bg-gold/10 hover:text-gold-light'
                    }`
                  }
                >
                  <Icon size={19} className="shrink-0" />
                  <span className="truncate">{t(item.key)}</span>
                </NavLink>
              </motion.div>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-gold/15">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3.5 py-2.5 rounded-xl text-sm font-medium text-text-secondary hover:bg-rose-deep/15 hover:text-rose-deep transition-all"
          >
            <LogOut size={19} />
            {t('logout')}
          </button>
        </div>
      </motion.aside>
    </>
  );
}
