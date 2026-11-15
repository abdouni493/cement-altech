import { writeFileSync } from 'node:fs';
import { database, newMigrations } from '../tests/support/database.mjs';

const db = await database();
const runs = Number(process.env.BENCHMARK_RUNS ?? 15);
if (!Number.isInteger(runs) || runs < 2 || runs > 100) throw new Error('BENCHMARK_RUNS must be 2..100');
const actor = '00000000-0000-0000-0000-000000000001';
const auth = `select set_config('request.jwt.claim.sub','${actor}',false);`;
const measurement = `
create or replace function public.fixture_measure(p_kind text, p_payload jsonb, p_v2 boolean, p_runs int)
returns jsonb language plpgsql as $$
declare t timestamptz; samples double precision[] := '{}'; elapsed double precision; i int;
begin
  for i in 1..p_runs loop
    begin
      t := clock_timestamp();
      if p_kind = 'command' then
        if p_v2 then perform public.create_command_v2(gen_random_uuid(), p_payload);
        else perform public.create_command(p_payload); end if;
      else
        if p_v2 then perform public.create_command_delivery_v2(gen_random_uuid(), p_payload);
        else perform public.create_command_delivery(p_payload); end if;
      end if;
      elapsed := extract(epoch from clock_timestamp()-t)*1000;
      -- Restore the identical document, stock, balances, and counter state per run.
      raise exception using errcode='ZX001', message='fixture rollback';
    exception when sqlstate 'ZX001' then null;
    end;
    samples := array_append(samples,elapsed);
  end loop;
  return (select jsonb_build_object('runs',p_runs,'median_ms',round((percentile_cont(.5) within group(order by x))::numeric,3),
    'p95_ms',round((percentile_cont(.95) within group(order by x))::numeric,3),'samples_ms',samples) from unnest(samples) x);
end; $$;`;
const results = [];
try {
  db.sql(`insert into auth.users(id,email,raw_user_meta_data) values('${actor}','fixture@example.test','{"role":"admin","username":"fixture"}');`);
  for (const [label, history, priorBL] of [['small', 10, 0], ['large', 800, 80]]) {
    const name = `fixture_${label}`;
    db.sql(`create database ${name} template postgres;`);
    db.sql(`${auth}
      insert into commands(reference,client_name) select 'CMD-2026-'||lpad(n::text,3,'0'),'History' from generate_series(1,${history}) n;
      insert into sales(reference,date) select 'VNT-2026-'||lpad(n::text,3,'0'),'2026-01-01' from generate_series(1,${history}) n;
      insert into products(id,name,current_quantity,purchase_price) values('00000000-0000-0000-0000-000000000010','Fixture cement',100000,2);
      select create_command('{"client_name":"Fixture","created_at":"2026-01-01","advance_paid":10000,"total_amount":10000,"items":[{"product_id":"00000000-0000-0000-0000-000000000010","product_name":"Fixture cement","quantity":1000,"unit_price":10,"total_price":10000}]}'::jsonb);
      do $$ declare c uuid; ci uuid; n int; begin
        select id into c from commands where client_name='Fixture'; select id into ci from command_items where command_id=c;
        for n in 1..${priorBL} loop
          perform create_command_delivery(jsonb_build_object('command_id',c,'delivered_at','2026-01-02','items',jsonb_build_array(jsonb_build_object('command_item_id',ci,'quantity',1,'product_name','Fixture cement'))));
        end loop;
      end $$;
    `, name);
    const commandPayload = { client_name: 'Measured', created_at: '2026-01-01', total_amount: 10, items: [{ product_name: 'Fixture', quantity: 1, unit_price: 10, total_price: 10 }] };
    const deliveryPayload = JSON.parse(db.sql(`select jsonb_build_object('command_id',c.id,'delivered_at','2026-01-02','items',jsonb_build_array(jsonb_build_object('command_item_id',ci.id,'quantity',1,'product_name','Fixture cement'))) from commands c join command_items ci on ci.command_id=c.id where c.client_name='Fixture';`, name).trim());
    for (const [version, v2] of [['before', false], ['after', true]]) {
      if (v2) for (const path of newMigrations) db.file(path, name);
      db.sql(measurement, name);
      const counts = JSON.parse(db.sql(`select jsonb_build_object('commands',(select count(*) from commands),'sales',(select count(*) from sales),'BLs_on_selected_order',(select count(*) from command_deliveries));`, name).trim());
      for (const [kind, payload] of [['command', commandPayload], ['delivery', deliveryPayload]]) {
        const output = db.sql(`${auth}select public.fixture_measure('${kind}','${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb,${v2},${runs});`, name).trim().split('\n').at(-1);
        results.push({ version, dataset: label, kind, counts, ...JSON.parse(output) });
      }
    }
  }
  const report = { generated_at: new Date().toISOString(), baseline_commit: 'd8ae668', engine: db.sql('select version()').trim(), account_role: 'admin (auth.uid fixture)', network: 'local PostgreSQL in Docker, no network latency; SQL execution only', notes: ['Each operation runs in a subtransaction rolled back after timing; identical starting state for each run.', 'These are server timings, not click-to-print or Vercel/Supabase network measurements.', 'Large fixture remains below the old numbering truncation boundary so baseline can finish.', 'Browser waterfall benchmark is separate; no production writes.'], results };
  writeFileSync('tests/benchmark-results.json', JSON.stringify(report, null, 2)+'\n');
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }
