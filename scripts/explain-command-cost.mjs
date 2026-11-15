import { readFileSync, writeFileSync } from 'node:fs';
import { database, newMigrations } from '../tests/support/database.mjs';

const db = await database();
const target = '00000000-0000-0000-0000-000000000001';
try {
  db.sql(`insert into commands(id,reference,client_name,total_amount,advance_paid)
    values('${target}','CMD-2026-001','Selected cost fixture',1001,1001);
    insert into commands(reference,client_name)
    select 'CMD-2026-'||(n+1),'Unrelated fixture' from generate_series(1,2000)n;
    insert into command_items(command_id,position,product_name,quantity,unit_price,total_price)
    select id,0,'Duplicate product',1000,1,1000 from commands;
    insert into command_items(command_id,position,product_name,quantity,unit_price,total_price)
    values('${target}',1,'Duplicate product',1000,2,2000);
    insert into command_deliveries(command_id,reference,total_ttc,advance_applied,cash_paid,paid_amount,rest_amount,delivered_at,updated_at)
    select c.id,'BL-'||c.reference||'-'||n,1,case when c.id='${target}' then 1 else 0 end,
      case when c.id='${target}' then 0 else 1 end,1,0,'2026-01-01'::timestamptz+n*interval '1 minute','2026-01-01'
    from commands c cross join lateral generate_series(1,case when c.id='${target}' then 500 else 5 end)n;
    insert into command_delivery_items(delivery_id,command_item_id,product_name,quantity)
    select d.id,ci.id,'Duplicate product',1 from command_deliveries d join command_items ci on ci.command_id=d.command_id and ci.position=0;
    insert into sales(reference,date,delivery_id,command_id,total_amount,final_amount,paid_amount)
    select 'VNT-2026-'||row_number()over(order by d.id),'2026-01-01',d.id,d.command_id,1,1,1 from command_deliveries d;
    update command_deliveries d set sale_id=s.id,updated_at='2026-01-01' from sales s where s.delivery_id=d.id;
    analyze;`);
  const query=readFileSync('diagnostics/command_cost.sql','utf8');
  const counts=db.sql(`select jsonb_build_object('commands',(select count(*) from commands),'command_items',(select count(*) from command_items),'command_deliveries',(select count(*) from command_deliveries),'delivery_items',(select count(*) from command_delivery_items),'sales',(select count(*) from sales),'selected_BLs',(select count(*) from command_deliveries where command_id='${target}'));`).trim();
  const output=[`Local PostgreSQL actual query plans captured ${new Date().toISOString()}`,
    `Fixture: ${counts}`, 'Role: local postgres (superuser); SELECT query shape only, not RLS/Auth overhead.',
    'All writes used a disposable container; no production connection. Default planner settings; ANALYZE run before each capture.',
    'Selected order contains two distinct line IDs with identical product names, and 500 linked BLs/invoices.',
    'Reproduce: node scripts/explain-command-cost.mjs', '\n===== BEFORE (base+parts1-7+03) =====\n',
    db.sql(`\\set command_id '${target}'\n${query}`)];
  for(const path of newMigrations) db.file(path);
  db.sql('analyze;');
  output.push('\n===== AFTER (04+05+06+07) =====\n',db.sql(`\\set command_id '${target}'\n${query}`));
  writeFileSync('tests/command-cost-plans.txt',output.join('\n'));
  console.log('Captured before/after actual query plans in tests/command-cost-plans.txt');
} finally {db.close();}
