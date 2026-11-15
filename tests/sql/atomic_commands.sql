-- Disposable local/staging DB only, AFTER migrations 04 and 05. Fixtures roll back.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('aa000000-0000-0000-0000-000000000001','atomic-admin@example.test','{"full_name":"Atomic Admin"}'),
 ('aa000000-0000-0000-0000-000000000002','atomic-worker@example.test','{"full_name":"Atomic Worker"}');
update public.profiles set role='admin',username='atomic-admin'
 where id='aa000000-0000-0000-0000-000000000001';
update public.profiles set role='worker',username='atomic-worker',permissions='{}'
 where id='aa000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000001',true);

do $test$
declare
  client uuid:=gen_random_uuid(); product uuid:=gen_random_uuid();
  op uuid:=gen_random_uuid(); delivery_op uuid:=gen_random_uuid();
  req jsonb; receipt jsonb; replay jsonb; del jsonb; edited jsonb; second jsonb;
  cmd uuid; line1 uuid; line2 uuid; delivery uuid; sale uuid;
  original_stock numeric; n integer; failed boolean;
  hist jsonb; histcmd uuid; histline uuid; historical_del jsonb;
begin
  insert into public.clients(id,name,credit_amount) values(client,'Atomic fixture',50);
  insert into public.products(id,name,current_quantity,purchase_price) values(product,'Atomic ciment',100,3);
  req:=jsonb_build_object('client_id',client,'client_name','Atomic fixture',
    'client_address','Atomic address','created_at','2026-01-03T10:00:00Z',
    'total_amount',100,'advance_paid',10,'requested_credit',20,'bon_number','MANUAL-ATOMIC',
    'items',jsonb_build_array(
      jsonb_build_object('position',0,'product_id',product,'product_name','Atomic ciment','quantity',4,'unit_price',10,'total_price',40),
      jsonb_build_object('position',1,'product_id',product,'product_name','Atomic ciment','quantity',6,'unit_price',10,'total_price',60)));
  receipt:=public.create_command_v2(op,req);
  cmd:=(receipt#>>'{command,id}')::uuid;
  line1:=(receipt#>>'{command,items,0,id}')::uuid;
  line2:=(receipt#>>'{command,items,1,id}')::uuid;
  assert (receipt->>'credit_applied')::numeric=20, 'creation actual credit';
  assert (receipt#>>'{client,credit_amount}')::numeric=30, 'creation confirmed credit balance';
  assert (receipt#>>'{command,paid_amount}')::numeric=30, 'command paid = cash advance + credit';
  assert (select address='Atomic address' from public.clients where id=client), 'address updated atomically';
  assert (select count(*)=1 and sum(amount)=10 from public.caisse_transactions where ref_table='commands' and ref_id=cmd), 'only cash enters caisse';
  replay:=public.create_command_v2(op,req);
  assert replay->>'replayed'='true' and replay#>>'{command,id}'=cmd::text, 'lost response/double click returns original';
  assert (select credit_amount=30 from public.clients where id=client), 'replay does not consume credit twice';
  failed:=false;
  begin perform public.create_command_v2(op,req||'{"total_amount":999}'::jsonb);
  exception when sqlstate '22023' then failed:=true; end;
  assert failed,'conflicting operation ID rejected';

  req:=jsonb_build_object('command_id',cmd,'delivered_at','2026-01-03T11:00:00Z',
    'driver_name','Test driver','driver_plate','AT-01','location','Chantier fixture',
    'tva_enabled',true,'tva_rate',19,'advance_applied',30,'cash_paid',7.6,'requested_credit',10,
    'items',jsonb_build_array(jsonb_build_object('command_item_id',line1,'product_name','Atomic ciment','quantity',4)));
  del:=public.create_command_delivery_v2(delivery_op,req);
  delivery:=(del#>>'{delivery,id}')::uuid; sale:=(del#>>'{delivery,sale_id}')::uuid;
  assert (del#>>'{delivery,total_ttc}')::numeric=47.60,'TVA and rounding';
  assert (del#>>'{delivery,paid_amount}')::numeric=47.60,'cash + advance + credit fully paid';
  assert (del->>'credit_applied')::numeric=10,'delivery actual credit';
  assert (del#>>'{client,credit_amount}')::numeric=20,'delivery confirmed balance';
  assert (select current_quantity=96 from public.products where id=product),'stock deducted exactly once';
  assert (select allocated_amount=10 and rest_amount=0 and delivery_id=delivery from public.sales where id=sale),'invoice links and allocation';
  assert (select delivered_quantity=4 from public.command_items where id=line1),'first duplicate product line delivered';
  assert (select delivered_quantity=0 from public.command_items where id=line2),'second duplicate product line untouched';
  assert (select count(*)=1 and sum(quantity)=-4 from public.stock_movements where ref_id=delivery),'stock movements';
  assert (select count(*)>0 from public.activity_log where ref_id=delivery),'audit log';
  assert del#>>'{delivery,sale_reference}' is not null and jsonb_array_length(del#>'{delivery,items}')=1,'immediate print data complete';
  replay:=public.create_command_delivery_v2(delivery_op,req);
  assert replay#>>'{delivery,id}'=delivery::text and replay->>'replayed'='true','delivery lost-response replay';
  assert (select current_quantity=96 from public.products where id=product),'delivery replay no duplicate stock';

  -- Price editing and delivery editing are one transaction; invoice identity,
  -- line IDs and stock reversals survive a quantity correction.
  edited:=public.create_command_delivery_v2(gen_random_uuid(),req||jsonb_build_object(
    'delivery_id',delivery,'requested_credit',0,'cash_paid',0,'advance_applied',0,
    'price_overrides',jsonb_build_array(jsonb_build_object('command_item_id',line1,'unit_price',12)),
    'items',jsonb_build_array(jsonb_build_object('command_item_id',line1,'product_name','Atomic ciment','quantity',3))));
  assert edited#>>'{delivery,id}'=delivery::text and edited#>>'{delivery,sale_id}'=sale::text,'edit preserves document links';
  assert (select current_quantity=97 from public.products where id=product),'edit returns prior stock then deducts actual';
  assert (select unit_price=12 and delivered_quantity=3 from public.command_items where id=line1),'price and quantities committed';
  assert (select position=0 from public.command_items where id=line1),'line identity and position preserved';

  -- Repricing rolls back if the requested delivery is invalid; no partial order
  -- price update, stock change, or durable operation receipt may survive.
  failed:=false;
  begin perform public.create_command_delivery_v2(gen_random_uuid(),req||jsonb_build_object(
    'price_overrides',jsonb_build_array(jsonb_build_object('command_item_id',line2,'unit_price',99)),
    'items',jsonb_build_array(jsonb_build_object('command_item_id',line2,'product_name','Atomic ciment','quantity',7))));
  exception when others then
    if sqlerrm not like 'Quantite restante insuffisante%' then raise; end if;
    failed:=true; end;
  assert failed,'remaining quantity enforced';
  assert (select unit_price=10 from public.command_items where id=line2),'price rollback after failed delivery';
  assert (select current_quantity=97 from public.products where id=product),'stock rollback after failed delivery';
  update public.products set current_quantity=0 where id=product;
  -- A shortage never blocks a delivery: stock is clamped to zero.
  declare shortage jsonb; begin
    shortage:=public.create_command_delivery_v2(gen_random_uuid(),jsonb_build_object('command_id',cmd,
      'items',jsonb_build_array(jsonb_build_object('command_item_id',line2,'product_name','Atomic ciment','quantity',1))));
    assert (select current_quantity=0 from public.products where id=product),'shortage clamps stock to zero';
    perform public.delete_command_delivery((shortage#>>'{delivery,id}')::uuid);
  end;
  update public.products set current_quantity=97 where id=product;

  -- Customer credit must not be overspent even when the requested value is stale.
  second:=public.create_command_delivery_v2(gen_random_uuid(),jsonb_build_object(
    'command_id',cmd,'advance_applied',0,'cash_paid',0,'requested_credit',999,
    'items',jsonb_build_array(jsonb_build_object('command_item_id',line2,'product_name','Atomic ciment','quantity',6))));
  assert (second->>'credit_applied')::numeric<=20,'credit clamped to authoritative availability';
  assert (second#>>'{client,credit_amount}')::numeric>=0,'no negative credit';
  assert (select current_quantity=91 from public.products where id=product),'second line actual stock';

  -- Historical mode creates its linked invoice but never changes present stock
  -- or the present cash register, even with a historical cash advance.
  hist:=public.create_command_v2(gen_random_uuid(),jsonb_build_object('client_id',client,
    'client_name','Atomic fixture','total_amount',10,'advance_paid',10,'is_historical',true,
    'created_at','2020-01-01T12:00:00Z','items',jsonb_build_array(jsonb_build_object(
      'product_id',product,'product_name','Atomic ciment','quantity',1,'unit_price',10,'total_price',10))));
  histcmd:=(hist#>>'{command,id}')::uuid; histline:=(hist#>>'{command,items,0,id}')::uuid;
  historical_del:=public.create_command_delivery_v2(gen_random_uuid(),jsonb_build_object('command_id',histcmd,
    'delivered_at','2020-01-01T12:01:00Z','items',jsonb_build_array(jsonb_build_object(
      'command_item_id',histline,'product_name','Atomic ciment','quantity',1))));
  assert historical_del#>>'{delivery,is_historical}'='true','historical delivery';
  assert historical_del#>>'{delivery,sale_reference}' like 'VNT-2020-%','historical date namespace';
  assert (select current_quantity=91 from public.products where id=product),'historical stock unchanged';
  assert not exists(select 1 from public.caisse_transactions where ref_id=histcmd),'historical advance no current cash';

  -- No clients permission means no new operation, even though SECURITY DEFINER
  -- legitimately returns data to a worker having create but no broad view.
  perform set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000002',true);
  failed:=false;
  begin perform public.create_command_v2(gen_random_uuid(),req);
  exception when others then failed:=true; end;
  assert failed,'worker denied without create';
  update public.profiles set permissions='{"clients":{"create":true}}' where id=auth.uid();
  hist:=public.create_command_v2(gen_random_uuid(),jsonb_build_object('client_id',client,
    'client_name','Atomic fixture','total_amount',10,'items',jsonb_build_array(jsonb_build_object(
      'product_name','Worker fixture','quantity',1,'unit_price',10,'total_price',10))));
  assert hist#>>'{command,id}' is not null,'create-only worker receives own confirmed result';
  failed:=false;
  begin
    perform public.create_command_delivery_v2(gen_random_uuid(),jsonb_build_object(
      'command_id',hist#>>'{command,id}',
      'price_overrides',jsonb_build_array(jsonb_build_object('command_item_id',hist#>>'{command,items,0,id}','unit_price',99)),
      'items',jsonb_build_array(jsonb_build_object('command_item_id',hist#>>'{command,items,0,id}','product_name','Worker fixture','quantity',1))));
  exception when others then
    if sqlerrm not like '%permission de modifier le prix%' then raise; end if;
    failed:=true;
  end;
  assert failed,'create-only worker cannot change existing prices';
end;
$test$;

-- Partially delivered then cancelled quantities are never deliverable again.
do $test$
declare c jsonb; d jsonb; cid uuid; lid uuid; failed boolean:=false;
begin
  perform set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000001',true);
  c:=public.create_command_v2(gen_random_uuid(),jsonb_build_object(
    'client_name','Cancelled fixture','total_amount',100,'is_historical',true,
    'items',jsonb_build_array(jsonb_build_object('product_name','Fixture','quantity',10,'unit_price',10,'total_price',100))));
  cid:=(c#>>'{command,id}')::uuid; lid:=(c#>>'{command,items,0,id}')::uuid;
  d:=public.create_command_delivery_v2(gen_random_uuid(),jsonb_build_object('command_id',cid,
    'items',jsonb_build_array(jsonb_build_object('command_item_id',lid,'product_name','Fixture','quantity',4))));
  perform public.cancel_command_remainder(jsonb_build_object('command_id',cid,'reason','Fixture cancellation',
    'lines',jsonb_build_array(jsonb_build_object('command_item_id',lid,'quantity',6))));
  assert (select delivered_quantity=4 and cancelled_quantity=6 from public.command_items where id=lid),'partial/cancelled quantities';
  assert (select status='finalised' and total_amount=40 from public.commands where id=cid),'cancelled remainder removes undelivered value';
  begin
    perform public.create_command_delivery_v2(gen_random_uuid(),jsonb_build_object('command_id',cid,
      'items',jsonb_build_array(jsonb_build_object('command_item_id',lid,'product_name','Fixture','quantity',1))));
  exception when others then
    if sqlerrm not like 'Quantite restante insuffisante%' then raise; end if;
    failed:=true;
  end;
  assert failed,'cancelled quantity cannot be delivered';
  assert (select count(*)=1 from public.command_deliveries where command_id=cid),'no BL for rejected cancelled remainder';
end;
$test$;

-- Force a failure AFTER stock has been deducted to prove transaction rollback
-- covers invoice/payment writes, movement rows and idempotency receipts.
create function pg_temp.reject_fixture_payment() returns trigger language plpgsql as $$
begin raise exception 'fixture payment failure'; end;
$$;
create trigger atomic_fixture_payment_failure before insert on public.sale_payments
for each row execute function pg_temp.reject_fixture_payment();
do $test$
declare p uuid:=gen_random_uuid(); c public.commands; i uuid; op uuid:=gen_random_uuid(); failed boolean:=false;
begin
  perform set_config('request.jwt.claim.sub','aa000000-0000-0000-0000-000000000001',true);
  insert into public.products(id,name,current_quantity) values(p,'Rollback fixture',10);
  c:=public.create_command(jsonb_build_object('client_name','Rollback fixture','total_amount',10,
    'items',jsonb_build_array(jsonb_build_object('product_id',p,'product_name','Rollback fixture','quantity',1,'unit_price',10,'total_price',10))));
  select id into i from public.command_items where command_id=c.id;
  begin
    perform public.create_command_delivery_v2(op,jsonb_build_object('command_id',c.id,'cash_paid',10,
      'items',jsonb_build_array(jsonb_build_object('command_item_id',i,'product_name','Rollback fixture','quantity',1))));
  exception when others then
    if sqlerrm <> 'fixture payment failure' then raise; end if;
    failed:=true; end;
  assert failed,'injected payment failure reached';
  assert (select current_quantity=10 from public.products where id=p),'stock rolls back on payment failure';
  assert not exists(select 1 from public.command_deliveries where command_id=c.id),'no partial BL';
  assert not exists(select 1 from public.sales where command_id=c.id),'no partial linked sale';
  assert not exists(select 1 from public.stock_movements where product_id=p),'no partial movements';
  assert not exists(select 1 from public.command_operations where operation_id=op),'no failed operation receipt';
end;
$test$;
rollback;
\echo 'PASS atomic commands: replay/conflict, address, credit/cash/advance/TVA, duplicate lines, print receipt, edit reversal, rollback, historical, worker permissions'
