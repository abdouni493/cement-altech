/**
 * Clean-up of every local data cache.
 *
 * The application used to mirror its business data in localStorage, which is
 * exactly what made a page refresh display outdated rows. Every screen now
 * reads from Supabase only, so these keys are deleted on each start: nothing
 * stale can survive an update.
 *
 * Only two keys are kept on purpose: `altech-auth` (session + language) and
 * `altech-theme` (light/dark choice).
 */
const LEGACY_KEYS = [
  'labochimie-auth',
  'labochimie-settings',
  'labochimie-stock',
  'labochimie-suppliers',
  'labochimie-clients',
  'labochimie-client-debts',
  'labochimie-purchases',
  'labochimie-sales',
  'labochimie-commands',
  'labochimie-productions',
  'labochimie-fiche-technics',
  'labochimie-comptoir',
  'labochimie-workers',
  'labochimie-expenses',
  'labochimie-caisse',
  'labochimie-caisse-reports',
  'cement-settings',
  'cement-client-debts',
  'cement-theme-store',
  // v1 caches: the business data used to be mirrored in localStorage, which is
  // what made a refresh show outdated rows. Everything now comes from Supabase.
  'altech-stock',
  'altech-suppliers',
  'altech-clients',
  'altech-purchases',
  'altech-sales',
  'altech-commands',
  'altech-productions',
  'altech-fiche-technics',
  'altech-comptoir',
  'altech-workers',
  'altech-expenses',
  'altech-client-debts',
  'altech-caisse',
  'altech-caisse-reports',
  'altech-settings',
];

export function purgeLegacyStorage(): void {
  try {
    LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* private browsing / storage disabled — nothing to clean */
  }
}
