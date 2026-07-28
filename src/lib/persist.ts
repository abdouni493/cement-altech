/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Write-through helper used by the zustand stores.
 *
 * The application stays instant (optimistic local update) while the same
 * operation is replayed on Supabase in the background. When the database
 * returns the persisted row, `onRow` lets the store swap its temporary local
 * id for the real uuid so later updates/deletes target the right row.
 *
 * Any failure (offline machine, missing permission) is logged and ignored:
 * the app keeps working on its local copy.
 */
export function push<T>(
  label: string,
  run: () => Promise<T>,
  onRow?: (row: T) => void
): void {
  // avoid firing requests while nobody is logged in
  if (typeof window === 'undefined') return;

  run()
    .then((row) => {
      if (row && onRow) onRow(row);
    })
    .catch((e: any) => {
      console.warn(`[db] ${label} non synchronisé:`, e?.message ?? e);
    });
}

/** Replaces the temporary id of an item inside a list. */
export function swapId<T extends { id: string }>(list: T[], oldId: string, newId: string): T[] {
  if (!newId || oldId === newId) return list;
  return list.map((item) => (item.id === oldId ? { ...item, id: newId } : item));
}
