-- Local/staging disposable fixtures only. All changes rolled back.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('70000000-0000-0000-0000-000000000001','purchase-admin@local.invalid','{"role":"admin"}'),
 ('70000000-0000-0000-0000-000000000002','purchase-worker@local.invalid','{"role":"worker"}');
select set_config('request.jwt.claim.sub','70000000-0000-0000-0000-000000000001',true);
insert into public.suppliers(id,name) values ('71000000-0000-0000-0000-000000000001','Purchase Summary Supplier');
insert into public.products(id,name,unit) values ('72000000-0000-0000-0000-000000000001','Summary Material','kg');
insert into public.purchases(id,reference,supplier_id,date,total_amount,paid_amount,is_historical,bon_number,driver_plate) values
 ('73000000-0000-0000-0000-000000000001','PURCHASE-SUMMARY-001','71000000-0000-0000-0000-000000000001','2025-02-02',100,100,true,'BON-A','PLATE-A'),
 ('73000000-0000-0000-0000-000000000002','PURCHASE-SUMMARY-002','71000000-0000-0000-0000-000000000001','2025-02-02',200,50,true,'BON-B','PLATE-B'),
 ('73000000-0000-0000-0000-000000000003','PURCHASE-SUMMARY-003','71000000-0000-0000-0000-000000000001','2025-02-01',300,0,true,'BON-C','PLATE-C');
insert into public.purchase_lines(purchase_id,product_id,product_name,quantity,purchase_price,unit) values
 ('73000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','Summary Material',10,10,'kg'),
 ('73000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000001','Summary Material',10,10,null),
 ('73000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000001','Summary Material',10,10,'m3'),
 ('73000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000001','Summary Material',30,10,'m3');
set local role authenticated;
do $test$
declare r jsonb; r2 jsonb;
begin
  r := public.list_purchase_summaries('Purchase Summary Supplier','','2025-02-01','2025-02-02','{}',1,0);
  r2 := public.list_purchase_summaries('Purchase Summary Supplier','','2025-02-01','2025-02-02','{}',1,1);
  if (r->>'total_count')::int <> 3 or jsonb_array_length(r->'rows') <> 1 then
    raise exception 'Purchase paging failed: %',r;
  end if;
  if r->'rows'->0->>'id' <> '73000000-0000-0000-0000-000000000002' or
     r2->'rows'->0->>'id' <> '73000000-0000-0000-0000-000000000001' then
    raise exception 'Stable date/ID pagination failed';
  end if;
  if r->'stats' is distinct from r2->'stats' or
     (r->'stats'->>'totalPurchases')::numeric <> 600 or
     (r->'stats'->>'totalPaid')::numeric <> 150 or
     (r->'stats'->>'totalDebt')::numeric <> 450 then
    raise exception 'Totals must include all filtered results: %',r;
  end if;
  if (r->'rows'->0->>'line_count')::int <> 2 or not (r->'rows'->0->'units' @> '["kg","m3"]'::jsonb) then
    raise exception 'Line count and fallback product units failed: %',r;
  end if;
  r := public.list_purchase_summaries('','kg',null,null,'{}',50,0);
  if (r->>'total_count')::int <> 2 or (r->'stats'->>'totalPurchases')::numeric <> 300 then
    raise exception 'Unit filter must include line units and product fallback: %',r;
  end if;
  r := public.list_purchase_summaries('PLATE-B');
  if (r->>'total_count')::int <> 1 then raise exception 'Driver filter failed'; end if;
  r := public.list_purchase_summaries('BON-C');
  if (r->>'total_count')::int <> 1 then raise exception 'Bon filter failed'; end if;
  r := public.list_purchase_summaries('Local Deliverer','',null,null,'{73000000-0000-0000-0000-000000000001}');
  if (r->>'total_count')::int <> 1 then raise exception 'Browser-only deliverer ID filter failed'; end if;
  r := public.list_purchase_summaries('%');
  if (r->>'total_count')::int <> 0 then raise exception 'Search must be literal'; end if;
end;
$test$;
select set_config('request.jwt.claim.sub','70000000-0000-0000-0000-000000000002',true);
do $test$
begin
  begin
    perform public.list_purchase_summaries();
    raise exception 'Worker without purchase.view should be rejected';
  exception when insufficient_privilege then null;
  end;
end;
$test$;
reset role;
update public.profiles set permissions='{"purchase":{"view":true},"suppliers":{"view":true},"stock":{"view":true}}' where id='70000000-0000-0000-0000-000000000002';
set local role authenticated;
do $test$
begin
  if (public.list_purchase_summaries('Purchase Summary Supplier')->>'total_count')::int <> 3 then
    raise exception 'Worker purchase.view must retain access through RLS';
  end if;
end;
$test$;
rollback;
