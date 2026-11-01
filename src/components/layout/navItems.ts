import {
  LayoutDashboard, Boxes, Construction, PackagePlus, ReceiptText, ScanBarcode,
  UsersRound, ClipboardCheck, Container, UserCog, HandCoins, Vault, ChartColumnBig, Settings2,
} from 'lucide-react';
import type { PermissionModule } from '@/types';
import type { TranslationKey } from '@/lib/i18n';

export interface NavItem {
  to: string;
  key: TranslationKey;
  module: PermissionModule;
  icon: typeof LayoutDashboard;
}

/**
 * The application menu — shared by the sidebar and by the router so a worker
 * always lands on a screen he is allowed to open.
 * « Dettes Clients » is gone: it now lives inside the Clients interface.
 */
export const navItems: NavItem[] = [
  { to: '/dashboard', key: 'dashboard', module: 'dashboard', icon: LayoutDashboard },
  { to: '/stock', key: 'stock', module: 'stock', icon: Boxes },
  { to: '/production', key: 'production', module: 'production', icon: Construction },
  { to: '/purchase', key: 'purchase', module: 'purchase', icon: PackagePlus },
  { to: '/sales', key: 'sales', module: 'sales', icon: ReceiptText },
  { to: '/pos', key: 'pos', module: 'pos', icon: ScanBarcode },
  { to: '/clients', key: 'clients', module: 'clients', icon: UsersRound },
  { to: '/commands', key: 'commands', module: 'clients', icon: ClipboardCheck },
  { to: '/suppliers', key: 'suppliers', module: 'suppliers', icon: Container },
  { to: '/workers', key: 'workers', module: 'workers', icon: UserCog },
  { to: '/expenses', key: 'expenses', module: 'expenses', icon: HandCoins },
  { to: '/caisse', key: 'caisse', module: 'caisse', icon: Vault },
  { to: '/reports', key: 'reports', module: 'reports', icon: ChartColumnBig },
  { to: '/settings', key: 'settings', module: 'settings', icon: Settings2 },
];
