/** Metadata only: backup contents, account names and tokens must never enter telemetry. */
export interface RestoreTiming {
  bytes: number;
  readMs?: number;
  parseMs?: number;
  requestMs?: number;
  reloadMs?: number;
  reloadStartedAt?: number;
}

const KEY = 'altech-restore-timing';
export function recordRestoreTiming(value: RestoreTiming): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode */ }
  console.info('[restore timing]', value);
}

export function completeRestoreReloadTiming(): void {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    const value: RestoreTiming = JSON.parse(raw);
    if (!value.reloadStartedAt) return;
    value.reloadMs = Math.max(0, Date.now() - value.reloadStartedAt);
    delete value.reloadStartedAt;
    recordRestoreTiming(value);
  } catch { /* unavailable storage must not prevent startup */ }
}
