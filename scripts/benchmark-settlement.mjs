import {writeFileSync} from 'node:fs';
import {database,newMigrations} from '../tests/support/database.mjs';
const db=await database();
const results=[];
try {
  db.sql(`insert into commands(id,reference,client_name,total_amount,advance_paid) values('00000000-0000-0000-0000-000000000001','CMD-2026-001','Settlement fixture',1001,1001);
  insert into command_deliveries(command_id,reference,total_ttc,advance_applied,cash_paid,paid_amount,rest_amount,delivered_at)
  select '00000000-0000-0000-0000-000000000001','BL-CMD-2026-001-'||n,1,1,0,1,0,'2026-01-01'::timestamptz+n*interval '1 minute' from generate_series(1,500)n;`);
  for(const version of ['before','after']) {
    if(version==='after') for(const path of newMigrations) db.file(path);
    const value=db.sql(`create temporary table measurement(result jsonb);
    do $$ declare samples numeric[]:='{}'; t timestamptz; elapsed numeric; i int; begin
      for i in 1..15 loop begin
        t:=clock_timestamp(); perform settle_command_deliveries('00000000-0000-0000-0000-000000000001');
        elapsed:=extract(epoch from clock_timestamp()-t)*1000;
        raise exception using errcode='ZX001',message='fixture rollback';
      exception when sqlstate 'ZX001' then null; end;
      samples:=array_append(samples,elapsed); end loop;
      insert into measurement select jsonb_build_object('runs',15,'median_ms',percentile_cont(.5) within group(order by x),'p95_ms',percentile_cont(.95) within group(order by x),'samples_ms',samples) from unnest(samples)x;
    end $$; select result from measurement;`).trim().split('\n').at(-1);
    results.push({version,...JSON.parse(value)});
  }
  const result={generated_at:new Date().toISOString(),fixture:'500 fully funded BLs on one order, advance_paid1001, 501 remains available; no linked invoices',role:'superuser local fixture (helper has no UI permission gate)',network:'local PostgreSQL15 Docker; SQL helper execution only',notes:['Seed uses direct inserts to isolate settlement cost; baseline numbering would stall at100thBL.','Fully funded documents remain unchanged; repeated command_advance_available scans are removed.','Linked-invoice updates and genuinely changed allocations still scale with affected documents.'],results};
  writeFileSync('tests/settlement-benchmark-results.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
} finally {db.close();}
