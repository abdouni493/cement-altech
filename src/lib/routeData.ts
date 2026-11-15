/** Data needed by each screen. History screens explicitly retain all-history reads. */
export const ALL_DATA_MODULES = [
  'stock', 'suppliers', 'deliverers', 'clients', 'clientLedger', 'clientDebts',
  'purchases', 'sales', 'commands', 'productions', 'fiches', 'comptoir',
  'workers', 'expenses', 'caisse', 'caisseReports', 'settings',
] as const;
export type DataModule = typeof ALL_DATA_MODULES[number];

const overview: DataModule[] = [
  'stock', 'suppliers', 'clientLedger', 'purchases', 'sales', 'commands',
  'productions', 'fiches', 'comptoir', 'workers', 'expenses', 'caisse',
];

export function modulesForRoute(path: string): DataModule[] {
  // Commands fetch their paged summaries and selected details themselves.
  if (path === '/commands' || path === '/clients/commands') return ['clients', 'fiches', 'stock', 'settings'];
  if (path === '/pos') return ['comptoir', 'stock', 'fiches', 'clients', 'settings'];
  if (path === '/stock') return ['stock', 'fiches', 'settings'];
  if (path === '/purchase') return ['suppliers', 'deliverers', 'stock', 'settings'];
  if (path === '/production') return ['productions', 'fiches', 'stock', 'settings'];
  if (path === '/comptoir') return ['comptoir', 'settings'];
  if (path === '/sales') return ['sales', 'commands', 'clients', 'stock', 'fiches', 'settings'];
  if (path === '/clients') return ['clientLedger', 'clientDebts', 'sales', 'commands', 'purchases', 'suppliers', 'stock', 'fiches', 'settings'];
  if (path === '/suppliers') return ['suppliers', 'purchases', 'sales', 'commands', 'clientLedger', 'stock', 'fiches', 'settings'];
  if (path === '/deliverers') return ['deliverers', 'settings'];
  if (path === '/workers') return ['workers', 'settings'];
  if (path === '/expenses') return ['expenses', 'settings'];
  if (path === '/caisse/statistics') return ['productions', 'sales', 'comptoir', 'settings'];
  if (path === '/caisse/reports') return [...overview, 'caisseReports', 'settings'];
  if (path === '/caisse' || path === '/dashboard') return [...overview, 'settings'];
  if (path === '/reports') return ALL_DATA_MODULES.filter((key) => key !== 'clients');
  if (path === '/settings') return ['settings'];
  return [];
}

/** Permission checked before scheduling route dependencies; SQL/RLS remains authoritative. */
export function permissionForRoute(path: string): string | undefined {
  if (path === '/commands' || path === '/clients/commands') return 'clients';
  if (path === '/deliverers') return 'suppliers';
  const module = path.split('/')[1];
  return ['dashboard', 'stock', 'purchase', 'production', 'comptoir', 'pos', 'sales',
    'clients', 'suppliers', 'workers', 'expenses', 'caisse', 'reports', 'settings'].includes(module) ? module : undefined;
}
