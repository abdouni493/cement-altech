/* eslint-disable @typescript-eslint/no-explicit-any */
import { toast } from '@/components/ui/Toast';

/**
 * Database-first write helper.
 *
 * Every create / update / delete of the application goes through `save()`:
 * the operation is executed on Supabase FIRST and the local store is only
 * updated with what the database actually returned. Nothing is kept in
 * localStorage any more, so a refresh always shows the real rows.
 *
 * When the write fails the user is told (French toast) and the error is
 * rethrown so the calling screen can abort instead of showing a phantom row.
 */
export async function save<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e: any) {
    const raw = e?.message ?? String(e);
    console.error(`[db] ${label}:`, raw);
    toast.error(`Enregistrement impossible — ${humanize(raw)}`);
    throw e;
  }
}

/** Same as `save()` but never throws — for optional/secondary writes. */
export async function trySave<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (e: any) {
    console.warn(`[db] ${label}:`, e?.message ?? e);
    return null;
  }
}

/** Turns a raw PostgREST / PostgreSQL error into something readable. */
function humanize(message: string): string {
  const m = message.replace(/^\[[^\]]+\]\s*/, '');
  if (/duplicate key|already exists/i.test(m)) return 'cet enregistrement existe déjà';
  if (/violates foreign key/i.test(m)) return 'un élément lié est introuvable';
  if (/row-level security|permission denied/i.test(m)) return "vous n'avez pas la permission";
  if (/JWT|not authenticated/i.test(m)) return 'session expirée, reconnectez-vous';
  if (/fetch|network/i.test(m)) return 'base de données injoignable';
  return m;
}

/** Replaces the temporary id of an item inside a list. */
export function swapId<T extends { id: string }>(list: T[], oldId: string, newId: string): T[] {
  if (!newId || oldId === newId) return list;
  return list.map((item) => (item.id === oldId ? { ...item, id: newId } : item));
}

/**
 * Legacy fire-and-forget helper kept for the few background writes that must
 * not block the UI (never used for user data any more).
 */
export function push<T>(label: string, run: () => Promise<T>, onRow?: (row: T) => void): void {
  run()
    .then((row) => { if (row && onRow) onRow(row); })
    .catch((e: any) => console.warn(`[db] ${label}:`, e?.message ?? e));
}
