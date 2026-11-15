import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const oldMigrations = [
  'sql_nouveau_projet/01_schema_de_base.sql',
  ...Array.from({ length: 7 }, (_, i) => `sql_nouveau_projet/02_mises_a_jour_partie_0${i + 1}_sur_07.sql`),
  'sql_nouveau_projet/03_finalisation.sql',
];
export const newMigrations = [
  'sql_nouveau_projet/04_atomic_reference_allocator.sql',
  'sql_nouveau_projet/05_atomic_command_operations.sql',
  'sql_nouveau_projet/06_command_summaries.sql',
  'sql_nouveau_projet/07_purchase_summaries.sql',
];
export function shell(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${args.slice(0, 4).join(' ')} failed:\n${result.stderr || result.stdout || result.error}`);
  return result.stdout;
}
// This harness never accepts a connection string. Writes are confined to a new,
// disposable Docker container, with no exposed network port or retained volume.
export async function database() {
  const name = `cement-test-${randomUUID().slice(0, 8)}`;
  shell(['run', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=local-fixtures-only', '-d', 'postgres:15']);
  const sql = (query, db = 'postgres') => shell(['exec', '-i', name, 'psql', '-X', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], { input: query });
  const file = (path, db) => sql(readFileSync(path, 'utf8'), db);
  try {
    for (let attempt = 0; ; attempt++) {
      const ready = spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
      if (ready.status === 0) break;
      if (attempt >= 60) throw new Error('Local PostgreSQL did not become ready');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    file('tests/sql/bootstrap.sql');
    for (const path of oldMigrations) file(path);
    return { name, sql, file, close: () => shell(['rm', '-f', name]) };
  } catch (error) {
    shell(['rm', '-f', name]);
    throw error;
  }
}
