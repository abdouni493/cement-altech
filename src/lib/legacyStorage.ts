/**
 * One-time clean-up of the previous local storage.
 *
 * Older versions of the application shipped with demo data (produits, clients,
 * ventes, comptes de démonstration…) persisted under the `labochimie-*` keys.
 * The store now starts empty and reads its real data from Supabase, so those
 * entries are removed: they are never read again and would only keep the demo
 * rows alive in the browsers where the application was already opened.
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
];

export function purgeLegacyStorage(): void {
  try {
    LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* private browsing / storage disabled — nothing to clean */
  }
}
