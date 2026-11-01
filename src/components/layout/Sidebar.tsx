import { NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LogOut, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { useSettingsStore } from '@/store/settingsStore';
import { LogoBadge } from '@/components/shared/LogoBadge';
import { sidebarItemVariants } from '@/lib/animations';
import { navItems } from './navItems';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const { t, isRTL } = useLanguage();
  const { canView, isAdmin } = usePermissions();
  const store = useSettingsStore((s) => s.settings);

  // Only the interfaces the administrator granted are displayed.
  const visibleItems = navItems.filter((item) => canView(item.module));

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initials = (user?.name ?? '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <>
      {/* Mobile overlay */}
      {open && <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-30 lg:hidden" onClick={onClose} />}

      <motion.aside
        initial={false}
        className={`fixed lg:sticky top-0 z-40 h-screen w-[264px] bg-gradient-sidebar flex flex-col shrink-0 transition-transform duration-300 border-[--sidebar-border] ${
          isRTL ? 'right-0 border-l' : 'left-0 border-r'
        } ${open ? 'translate-x-0' : isRTL ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Filet dore en tete */}
        <div className="h-[3px] w-full bg-gradient-button" />

        {/* Logo */}
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <LogoBadge size={42} icon={22} />
            <div className="min-w-0">
              <h2 className="font-display text-[15px] font-bold leading-tight truncate text-[--sidebar-text-strong]">
                {store.name || 'Altech Production'}
              </h2>
              <p className="text-[10.5px] uppercase tracking-[0.12em] truncate text-gold/80">
                {store.description || 'Vente & Fabrication de Ciment'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden rounded-lg p-1.5 text-[--sidebar-text] hover:bg-white/5 hover:text-[--sidebar-text-strong]"
            aria-label="Fermer le menu"
          >
            <X size={18} />
          </button>
        </div>

        <p className="px-6 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[--sidebar-muted]">Navigation</p>

        {/* Nav */}
        <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 pb-3 space-y-0.5">
          {visibleItems.map((item, i) => {
            const Icon = item.icon;
            return (
              <motion.div key={item.to} custom={i} variants={sidebarItemVariants} initial="hidden" animate="visible">
                <NavLink
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                      isActive
                        ? 'bg-gold/[0.13] font-semibold text-[#f4dc8f]'
                        : 'font-medium text-[--sidebar-text] hover:bg-white/[0.04] hover:text-[--sidebar-text-strong]'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`absolute top-1.5 bottom-1.5 w-[3px] rounded-full bg-gold transition-opacity ${
                          isRTL ? '-right-3' : '-left-3'
                        } ${isActive ? 'opacity-100' : 'opacity-0'}`}
                      />
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
                          isActive
                            ? 'border-gold/50 bg-gradient-button text-[--btn-on-gold]'
                            : 'border-white/[0.06] bg-white/[0.03] text-gold/80 group-hover:border-gold/30 group-hover:text-gold'
                        }`}
                      >
                        <Icon size={16} strokeWidth={isActive ? 2.25 : 1.9} />
                      </span>
                      <span className="truncate">{t(item.key)}</span>
                    </>
                  )}
                </NavLink>
              </motion.div>
            );
          })}
          {visibleItems.length === 0 && (
            <p className="px-3 py-4 text-xs text-[--sidebar-muted]">
              Aucune interface autorisée pour ce compte.
            </p>
          )}
        </nav>

        {/* Account + logout */}
        <div className="border-t border-[--sidebar-border] p-3 space-y-2">
          {user && (
            <div className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-button text-[11px] font-bold text-[--btn-on-gold]">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate text-[--sidebar-text-strong]">{user.name}</p>
                <p className="text-[10px] truncate text-[--sidebar-muted]">
                  {isAdmin ? 'Administrateur' : `Employé · ${visibleItems.length} interface(s)`}
                </p>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 w-full rounded-lg border border-white/[0.08] px-3 py-2 text-[13px] font-semibold text-[--sidebar-text] transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut size={16} />
            {t('logout')}
          </button>
        </div>
      </motion.aside>
    </>
  );
}
