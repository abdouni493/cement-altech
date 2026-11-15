/**
 * Cross-screen invalidations are deferred until the affected screen is entered
 * or refreshed. A committed write must not launch history reloads that compete
 * with its confirmation/printing. The active action merges its confirmed rows.
 */
const dirty = new Set<string>();

export function invalidateModules(...keys: string[]): void {
  keys.forEach((key) => {
    dirty.add(key);
    if (key === 'clients') dirty.add('clientLedger');
  });
}

/** Kept compatible with existing stores; loading belongs to route hydration. */
export function inBackground(key: string, _load: () => Promise<unknown>): Promise<void> {
  invalidateModules(key);
  return Promise.resolve();
}

export function isModuleInvalidated(key: string): boolean {
  return dirty.has(key) || (key === 'clientLedger' && dirty.has('clients'));
}

export function markModuleFresh(key: string): void {
  dirty.delete(key);
  if (key === 'clientLedger') dirty.delete('clients');
}

export function resetInvalidations(): void {
  dirty.clear();
}
