import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { database, newMigrations } from '../tests/support/database.mjs';
const db = await database();
const actor = '00000000-0000-0000-0000-000000000001';
const results = [];
try {
  for (const path of newMigrations) db.file(path);
  db.sql(`insert into auth.users(id,email,raw_user_meta_data) values('${actor}','fixture@example.test','{"role":"admin","username":"fixture"}');`);
  for (const count of [10, 5000]) {
    const name = `restore_${count}`;
    db.sql(`create database ${name} template postgres;`);
    db.sql(`select set_config('request.jwt.claim.sub','${actor}',false);
      insert into commands(reference,client_name) select 'CMD-2026-'||n,'Fixture' from generate_series(1,${count}) n;`, name);
    const backup = db.sql(`select set_config('request.jwt.claim.sub','${actor}',false); select backup_export();`, name).trim().split('\n').at(-1);
    const parseSamples = Array.from({ length: 15 }, () => { const t = performance.now(); JSON.parse(backup); return performance.now()-t; }).sort((a,b)=>a-b);
    const measurement = db.sql(`select set_config('request.jwt.claim.sub','${actor}',false);
      create temporary table restore_measurement(result jsonb); do $$ declare b jsonb; t timestamptz; samples numeric[] := '{}'; elapsed numeric; i int; r jsonb;
      begin
        b:= backup_export();
        for i in 1..5 loop
          begin
            t:=clock_timestamp(); r:=backup_restore(b);
            elapsed:=extract(epoch from clock_timestamp()-t)*1000;
            assert (select count(*) from commands)=${count};
            assert r->>'ok'='true';
            raise exception using errcode='ZX001', message='restore fixture rollback';
          exception when sqlstate 'ZX001' then null; end;
          samples:=array_append(samples,elapsed);
        end loop;
        insert into restore_measurement select jsonb_build_object('runs',5,'median_ms',percentile_cont(.5) within group(order by x),'p95_ms',percentile_cont(.95) within group(order by x),'samples_ms',samples) from unnest(samples)x;
      end $$; select result from restore_measurement;`, name).trim().split('\n').at(-1);
    results.push({ commands: count, bytes: Buffer.byteLength(backup), parse: { engine:'Node.js JSON.parse (not browser)', runs:15, median_ms:parseSamples[7], p95_ms:parseSamples[14] }, database: JSON.parse(measurement) });
  }
  writeFileSync('tests/restore-benchmark-results.json', JSON.stringify({ generated_at:new Date().toISOString(), fixture:'disposable local PostgreSQL15, admin', upload:'unmeasured; no staging', app_reload:'unmeasured; no staging', results },null,2)+'\n');
} finally { db.close(); }
