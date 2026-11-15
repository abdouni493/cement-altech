-- Disposable fixture database only. Rolled back, including users and documents.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000001','summary-admin@local.invalid','{"role":"admin"}'),
 ('10000000-0000-0000-0000-000000000002','summary-worker@local.invalid','{"role":"worker"}');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);

insert into public.commands(id,reference,client_name,created_at,total_amount,advance_paid,paid_amount,is_historical) values
 ('20000000-0000-0000-0000-000000000001','SUMMARY-001','Summary Fixture','2025-01-02T12:00:00Z',100,100,100,false),
 ('20000000-0000-0000-0000-000000000002','SUMMARY-002','Summary Fixture','2025-01-02T12:00:00Z',200,50,50,false),
 ('20000000-0000-0000-0000-000000000003','SUMMARY-003','Summary Fixture','2025-01-01T12:00:00Z',300,0,0,false),
 ('20000000-0000-0000-0000-000000000004','SUMMARY-004','Summary Fixture','2025-01-03T12:00:00Z',400,0,0,true);
insert into public.command_items(command_id,product_name,quantity,delivered_quantity,cancelled_quantity,unit_price,total_price,position) values
 ('20000000-0000-0000-0000-000000000001','Duplicated',10,10,0,10,100,0),
 ('20000000-0000-0000-0000-000000000002','Duplicated',10,3,2,10,100,0),
 ('20000000-0000-0000-0000-000000000002','Duplicated',10,0,0,10,100,1),
 ('20000000-0000-0000-0000-000000000003','Duplicated',30,0,0,10,300,0),
 ('20000000-0000-0000-0000-000000000004','Historical',40,0,0,10,400,0);

set local role authenticated;
do $test$
declare r jsonb; r2 jsonb;
begin
  r := public.list_command_summaries('Summary Fixture','real','all',null,null,1,0);
  if (r->>'total_count')::int <> 3 or jsonb_array_length(r->'rows') <> 1 then
    raise exception 'Pagination must bound rows and count all filtered orders: %',r;
  end if;
  if r->'rows'->0->>'id' <> '20000000-0000-0000-0000-000000000002' then
    raise exception 'Stable ID tie-breaker failed';
  end if;
  r2 := public.list_command_summaries('Summary Fixture','real','all',null,null,1,1);
  if r2->'rows'->0->>'id' <> '20000000-0000-0000-0000-000000000001' then
    raise exception 'Second page ordering failed';
  end if;
  if r->'stats' is distinct from r2->'stats' or
    (r->'stats'->>'totalValue')::numeric <> 600 or
    (r->'stats'->>'totalPaid')::numeric <> 150 or
    (r->'stats'->>'totalRest')::numeric <> 450 then
    raise exception 'Stats must include all filtered pages: %',r;
  end if;
  if r->'counts' <> '{"paid":1,"debt":2,"undelivered":1,"partial":1,"delivered":1}'::jsonb then
    raise exception 'Incorrect status counts: %',r->'counts';
  end if;
  if (r->'rows'->0->>'delivered_quantity')::numeric <> 3 or
     (r->'rows'->0->>'ordered_quantity')::numeric <> 20 then
    raise exception 'Duplicate product lines must remain separate in aggregates';
  end if;
  r := public.list_command_summaries('Summary Fixture','real','debt',null,null,50,0);
  if (r->>'total_count')::int <> 2 or (r->'stats'->>'totalValue')::numeric <> 500 then
    raise exception 'Status filter failed: %',r;
  end if;
  r := public.list_command_summaries('Summary Fixture','historical','all',null,null,50,0);
  if (r->>'total_count')::int <> 1 then raise exception 'Historical scope failed'; end if;
  r := public.list_command_summaries('Summary Fixture','real','all','2025-01-02T00:00:00Z','2025-01-02T23:59:59Z',50,0);
  if (r->>'total_count')::int <> 2 then raise exception 'Date filter failed'; end if;
  r := public.list_command_summaries('%','all','all',null,null,50,0);
  if (r->>'total_count')::int <> 0 then raise exception 'Search must use literal text'; end if;
end;
$test$;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $test$
begin
  begin
    perform public.list_command_summaries();
    raise exception 'Worker without clients.view should be rejected';
  exception when insufficient_privilege then null;
  end;
end;
$test$;
reset role;
update public.profiles set permissions='{"clients":{"view":true}}' where id='10000000-0000-0000-0000-000000000002';
set local role authenticated;
do $test$
begin
  if (public.list_command_summaries('Summary Fixture')->>'total_count')::int <> 3 then
    raise exception 'Worker clients.view must retain access through RLS';
  end if;
end;
$test$;
rollback;
