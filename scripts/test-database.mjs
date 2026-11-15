import { database, newMigrations } from '../tests/support/database.mjs';
import { testConcurrency } from '../tests/support/concurrency.mjs';
import { existsSync } from 'node:fs';

const db = await database();
try {
  for (const path of newMigrations) { db.file(path); console.log(`PASS migration ${path}`); }
  // Upgrades must be rerunnable without reallocating any issued reference.
  for (const path of newMigrations) db.file(path);
  console.log('PASS migration replay');
  for (const path of ['tests/sql/reference_allocator.sql', 'tests/sql/atomic_commands.sql', 'tests/sql/command_summaries.sql', 'tests/sql/purchase_summaries.sql']) {
    if (!existsSync(path)) throw new Error(`Required regression fixture is absent: ${path}`);
    console.log(db.file(path));
    console.log(`PASS ${path}`);
  }
  await testConcurrency(db);
} finally { db.close(); }
