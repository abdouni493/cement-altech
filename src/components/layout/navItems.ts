import {
  Building2, Warehouse, Factory, ShoppingCart, Receipt, Calculator,
  Users, ClipboardList, Truck, HardHat, Banknote, Wallet, TrendingUp, Settings,
} from 'lucide-react';
import type { PermissionModule } from '@/types';
import type { TranslationKey } from '@/lib/i18n';

export interface NavItem {
  to: string;
  key: TranslationKey;
  module: PermissionModule;
  icon: typeof Building2;
}

/**
 * The application menu — shared by the sidebar and by the router so a worker
 * always lands on a screen he is allowed to open.
 * « Dettes Clients » is gone: it now lives inside the Clients interface.
 */
export const navItems: NavItem[] = [
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
  { to: '/caisse', key: 'caisse', module: 'caisse', icon: Wallet },
  { to: '/reports', key: 'reports', module: 'reports', icon: TrendingUp },
  { to: '/settings', key: 'settings', module: 'settings', icon: Settings },
];
