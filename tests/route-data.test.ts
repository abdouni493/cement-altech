import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ALL_DATA_MODULES, modulesForRoute, permissionForRoute } from '../src/lib/routeData';
import { inBackground, isModuleInvalidated, markModuleFresh, resetInvalidations } from '../src/lib/background';

describe('route data and deferred invalidations', () => {
  beforeEach(resetInvalidations);
  it('does not hydrate order, sales, purchase or ledger history for command and POS actions', () => {
    for (const path of ['/commands', '/clients/commands', '/pos']) {
      const modules = modulesForRoute(path);
      expect(modules).not.toContain('commands');
      expect(modules).not.toContain('sales');
      expect(modules).not.toContain('purchases');
      expect(modules).not.toContain('clientLedger');
      expect(modules).toContain('clients');
      expect(modules).toContain('settings');
    }
  });
  it('retains complete data for all-history reports and direct client navigation', () => {
    expect(modulesForRoute('/reports')).toEqual(ALL_DATA_MODULES.filter((key) => key !== 'clients'));
    expect(modulesForRoute('/clients')).toEqual(expect.arrayContaining(['commands', 'sales', 'clientLedger', 'clientDebts']));
    expect(modulesForRoute('/login')).toEqual([]);
    expect(permissionForRoute('/clients/commands')).toBe('clients');
  });
  it('never launches background history reads during a committed save', async () => {
    const load = vi.fn(async () => undefined);
    await Promise.all(Array.from({ length: 20 }, () => inBackground('sales', load)));
    expect(load).not.toHaveBeenCalled();
    expect(isModuleInvalidated('sales')).toBe(true);
    markModuleFresh('sales');
    expect(isModuleInvalidated('sales')).toBe(false);
  });
  it('invalidates both the client selector and the full ledger', async () => {
    await inBackground('clients', vi.fn());
    expect(isModuleInvalidated('clientLedger')).toBe(true);
    markModuleFresh('clients');
    // A catalog refresh does not make debt/payment history authoritative.
    expect(isModuleInvalidated('clientLedger')).toBe(true);
  });
});
