import { writeFileSync } from 'node:fs';
import { database } from '../tests/support/database.mjs';

// Destructive fixtures run ONLY in a newly created disposable local container.
const db = await database();
const actor = '00000000-0000-0000-0000-000000000001';
const auth = `select set_config('request.jwt.claim.sub','${actor}',false);`;
const results = [];
const percentile = (values, quantile) => {
  const ordered = [...values].sort((a,b)=>a-b);
  const offset = (ordered.length-1)*quantile;
  const lo = Math.floor(offset), hi = Math.ceil(offset);
  return Number((ordered[lo]+(ordered[hi]-ordered[lo])*(offset-lo)).toFixed(3));
};
try {
  db.sql(`insert into auth.users(id,email,raw_user_meta_data) values('${actor}','fixture@example.test','{"role":"admin","username":"fixture"}');`);
  for (const kind of ['CMD','VNT','BL']) {
    const name = `numbering_${kind.toLowerCase()}`;
    db.sql(`create database ${name} template postgres;`);
    const parent = '00000000-0000-0000-0000-000000000010';
    const line = '00000000-0000-0000-0000-000000000011';
    if (kind === 'CMD') {
      db.sql(`insert into commands(reference,client_name) select 'CMD-9876-'||lpad(n::text,3,'0'),'History' from generate_series(1,999) n;`,name);
    } else {
      db.sql(`insert into commands(id,reference,client_name,is_historical) values('${parent}','CMD-9876-001','Fixture',true);
        insert into command_items(id,command_id,product_name,quantity,unit_price,total_price) values('${line}','${parent}','Historical fixture',1000,10,10000);`, name);
      if (kind === 'VNT') db.sql(`insert into sales(reference,date) select 'VNT-9876-'||lpad(n::text,3,'0'),'9876-01-01' from generate_series(1,999) n;`, name);
      else db.sql(`insert into command_deliveries(command_id,reference,delivered_at) select '${parent}','BL-CMD-9876-001-'||lpad(n::text,2,'0'),'9876-01-01'::timestamptz from generate_series(1,99) n;`,name);
    }
    const payload = kind === 'CMD'
      ? { client_name:'Measured',created_at:'9876-01-01',items:[] }
      : { command_id:parent,delivered_at:'9876-01-02',items:[{command_item_id:line,product_name:'Historical fixture',quantity:1}] };
    db.sql(`create function public.fixture_numbering_measure(p_kind text,p_payload jsonb)
      returns jsonb language plpgsql as $$
      declare t timestamptz := clock_timestamp(); elapsed numeric; outcome text := 'completed';
      begin
        begin
          if p_kind = 'CMD' then perform public.create_command(p_payload);
          else perform public.create_command_delivery(p_payload); end if;
          elapsed := extract(epoch from clock_timestamp()-t)*1000;
          raise exception using errcode='ZX001',message='fixture rollback';
        exception
          when sqlstate 'ZX001' then null;
          when query_canceled then outcome := 'statement_timeout'; elapsed := extract(epoch from clock_timestamp()-t)*1000;
        end;
        return jsonb_build_object('status',outcome,'ms',elapsed);
      end; $$;`,name);
    for (const version of ['before','after']) {
      if (version==='after') db.file('sql_nouveau_projet/04_atomic_reference_allocator.sql',name);
      const samples=[];
      for (let i=0;i<5;i++) {
        const output=db.sql(`${auth}set statement_timeout='500ms';select fixture_numbering_measure('${kind}','${JSON.stringify(payload)}'::jsonb);`,name).trim().split('\n').at(-1);
        samples.push(JSON.parse(output));
      }
      results.push({namespace:kind,version,commands:kind==='CMD'?999:1,sales:kind==='VNT'?999:0,BLs_on_order:kind==='BL'?99:0,runs:samples.length,completed:samples.filter(x=>x.status==='completed').length,statement_timeouts:samples.filter(x=>x.status==='statement_timeout').length,median_ms:percentile(samples.map(x=>Number(x.ms)),.5),p95_ms:percentile(samples.map(x=>Number(x.ms)),.95),samples});
    }
  }
  const report={baseline_commit:'d8ae668',engine:db.sql('select version()').trim(),account_role:'admin via local auth.uid fixture',network:'local Docker PostgreSQL; SQL execution only; no Vercel/Supabase latency',statement_timeout_ms:500,notes:['Before timeouts are lower bounds, not completed operation times.','Each successful call is rolled back in a subtransaction; identical starting state per sample.','VNT/BL use historical order fixtures to exercise identical numbering without consuming live stock.','No hosted or production writes.'],results};
  writeFileSync('tests/numbering-benchmark-results.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {db.close();}
