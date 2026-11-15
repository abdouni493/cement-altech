import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export async function testConcurrency(db) {
  const actors = [randomUUID(), randomUUID()];
  db.sql(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${actors[0]}','cashier1@example.test','{"role":"admin","username":"cashier1"}'),
    ('${actors[1]}','cashier2@example.test','{"role":"admin","username":"cashier2"}');`);
  const run = (actor, query) => new Promise(resolve => {
    const child = spawn('docker', ['exec', '-i', db.name, 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({status, stdout:stdout.trim().split('\n').at(-1), stderr}));
    child.stdin.end(`select set_config('request.jwt.claim.sub','${actor}',false); ${query}`);
  });
  const payload = {client_name:'Concurrent fixture',created_at:'2026-01-01',items:[{product_name:'Fixture',quantity:1,unit_price:10,total_price:10}]};
  const create = operation => `select create_command_v2('${operation}','${JSON.stringify(payload)}'::jsonb);`;
  const results = await Promise.all(actors.map(actor => run(actor,create(randomUUID()))));
  assert(results.every(r=>r.status===0), JSON.stringify(results));
  assert.equal(new Set(results.map(r=>JSON.parse(r.stdout).command.reference)).size,2);
  const duplicateId=randomUUID();
  const duplicates=await Promise.all([run(actors[0],create(duplicateId)),run(actors[0],create(duplicateId))]);
  assert(duplicates.every(r=>r.status===0),JSON.stringify(duplicates));
  assert.equal(new Set(duplicates.map(r=>JSON.parse(r.stdout).command.id)).size,1);
  assert.equal(db.sql(`select count(*) from command_operations where operation_id='${duplicateId}';`).trim(),'1');

  const product=randomUUID();
  db.sql(`insert into products(id,name,current_quantity,purchase_price) values('${product}','Last stock fixture',1,2);`);
  const orderPayload={client_name:'Last quantity fixture',items:[{product_id:product,product_name:'Last stock fixture',quantity:1,unit_price:10,total_price:10}]};
  const order=await run(actors[0],`select create_command_v2('${randomUUID()}','${JSON.stringify(orderPayload)}'::jsonb);`);
  assert.equal(order.status,0,order.stderr);
  const receipt=JSON.parse(order.stdout);
  const command=receipt.command.id;
  const line=receipt.command.items[0].id;
  const delivery={command_id:command,items:[{command_item_id:line,product_name:'Last stock fixture',quantity:1}],cash_paid:10};
  const deliveries=await Promise.all(actors.map(actor=>run(actor,`select create_command_delivery_v2('${randomUUID()}','${JSON.stringify(delivery)}'::jsonb);`)));
  assert.equal(deliveries.filter(r=>r.status===0).length,1,JSON.stringify(deliveries));
  assert.match(deliveries.find(r=>r.status!==0).stderr,/Quantite restante insuffisante/);
  assert.equal(db.sql(`select current_quantity from products where id='${product}';`).trim(),'0.000');
  assert.equal(db.sql(`select delivered_quantity from command_items where id='${line}';`).trim(),'1.000');
  assert.equal(db.sql(`select count(*) from command_deliveries where command_id='${command}';`).trim(),'1');
  assert.equal(db.sql(`select count(*) from sales where command_id='${command}';`).trim(),'1');
  assert.equal(db.sql(`select count(*) from stock_movements where product_id='${product}' and ref_table='command_deliveries';`).trim(),'1');
  const client=randomUUID();
  db.sql(`insert into clients(id,name,credit_amount) values('${client}','Concurrent credit fixture',10);`);
  const creditOrders=await Promise.all(actors.map(actor=>run(actor,`select create_command_v2('${randomUUID()}','${JSON.stringify({client_id:client,client_name:'Concurrent credit fixture',total_amount:10,requested_credit:10,items:[{product_name:'Credit fixture',quantity:1,unit_price:10,total_price:10}]})}'::jsonb);`)));
  assert(creditOrders.every(r=>r.status===0),JSON.stringify(creditOrders));
  assert.equal(creditOrders.reduce((sum,r)=>sum+Number(JSON.parse(r.stdout).credit_applied),0),10);
  assert.equal(db.sql(`select credit_amount from clients where id='${client}';`).trim(),'0.00');
  console.log('PASS real concurrent cashiers: unique orders, duplicate operation replay, final quantity single winner, stock/invoice/movement counts, shared credit single spend');
}
