-- Local/staging fixture database ONLY. All assertions/fixture writes roll back.
-- psql -v ON_ERROR_STOP=1 -f tests/sql/reference_allocator.sql "$DATABASE_URL"
begin;
set local statement_timeout = '15s';
do $test$
declare v text; v_id uuid; v_delivery uuid; v_name text; v_signature regprocedure; v_actor uuid; v_backup jsonb; v_result jsonb;
begin
  -- Use future namespaces reserved for this rolled-back fixture.
  delete from public.document_reference_counters where prefix like '%9876%';
  perform public.observe_document_reference('CMD-9876-999','CMD');
  v := public.next_document_reference('CMD-9876-',3);
  assert v = 'CMD-9876-1000', 'CMD 999 -> 1000 must not truncate';
  perform public.observe_document_reference('VNT-9876-999','VNT');
  assert public.next_document_reference('VNT-9876-',3) = 'VNT-9876-1000';
  perform public.observe_document_reference('BL-CMD-9876-1000-99','BL');
  assert public.next_document_reference('BL-CMD-9876-1000-',2) = 'BL-CMD-9876-1000-100';
  assert public.next_document_reference('BL-CMD-9876-1001-',2) = 'BL-CMD-9876-1001-01', 'BL scope is per order';
  assert public.next_document_reference('CMD-9875-',3) like 'CMD-9875-%', 'Date/year namespace preserved';

  insert into public.commands(reference,client_name,bon_number,is_historical)
  values ('CMD-9876-900007','Numbering fixture','MANUAL-KEEP',true) returning id into v_id;
  assert public.next_document_reference('CMD-9876-',3) = 'CMD-9876-900008', 'Imported high suffix and gaps';
  assert (select reference = 'CMD-9876-900007' and bon_number = 'MANUAL-KEEP' and is_historical from public.commands where id=v_id);
  insert into public.command_deliveries(command_id,reference)
  values(v_id,'BL-CMD-9876-900007-900') returning id into v_delivery;
  assert public.next_document_reference('BL-CMD-9876-900007-',2) = 'BL-CMD-9876-900007-901';
  begin
    insert into public.command_deliveries(command_id,reference) values(v_id,'BL-CMD-9876-900007-900');
    raise exception 'Duplicate BL was accepted';
  exception when unique_violation then null;
  end;
  -- Legacy nonstandard references remain issued as-is, without numeric collision.
  perform public.observe_document_reference('CMD-9876-legacy-manual','CMD');
  assert public.next_document_reference('CMD-9876-',3) = 'CMD-9876-900009';
  -- Deleted/restored old documents do not lower an already-issued high-water mark.
  perform public.observe_document_reference('CMD-9876-002','CMD');
  perform public.sync_document_reference_counters();
  assert public.next_document_reference('CMD-9876-',3) = 'CMD-9876-900010';
  -- Simulate backup_restore's trigger-disabled path then its explicit reconciliation.
  alter table public.commands disable trigger user;
  insert into public.commands(reference,client_name) values ('CMD-9876-990000','Restore fixture');
  alter table public.commands enable trigger user;
  perform public.sync_document_reference_counters();
  assert public.next_document_reference('CMD-9876-',3) = 'CMD-9876-990001';
  assert strpos(pg_get_functiondef('public.backup_restore(jsonb)'::regprocedure), 'perform public.sync_document_reference_counters();') > 0;
  foreach v_name in array array['create_command(jsonb)','create_command_delivery(jsonb)',
    'apply_delivery_sale(uuid)','create_sale(jsonb)','create_purchase(jsonb)','create_purchase_order(jsonb)'] loop
    v_signature := ('public.'||v_name)::regprocedure;
    if v_name = 'create_command_delivery(jsonb)' and to_regprocedure('public.create_command_delivery_accounting_v1(jsonb)') is not null then
      v_signature := 'public.create_command_delivery_accounting_v1(jsonb)'::regprocedure;
    end if;
    assert strpos(pg_get_functiondef(v_signature),'next_document_reference(')>0, 'Writer missing allocator';
    assert strpos(pg_get_functiondef(v_signature),'while exists (select 1 from public.')=0, 'History loop retained';
  end loop;
  assert not has_function_privilege('authenticated','public.next_document_reference(text,integer)','execute');
  assert not has_table_privilege('authenticated','public.document_reference_counters','update');
  -- Exercise the real trigger-disabled, truncate-all backup path, not only its helper.
  v_actor := gen_random_uuid();
  insert into auth.users(id,email,raw_user_meta_data) values
    (v_actor, v_actor::text || '@numbering.example.test', jsonb_build_object('role','admin','username',v_actor::text));
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  perform public.observe_document_reference('CMD-9877-2000','CMD');
  v_backup := public.backup_export();
  perform public.observe_document_reference('CMD-9877-9000','CMD');
  v_result := public.backup_restore(v_backup);
  assert v_result->>'ok' = 'true';
  assert public.next_document_reference('CMD-9877-',3) = 'CMD-9877-9001', 'Real restore lost the current high-water mark';
  raise notice 'PASS: widths, namespaces, high imports/gaps, legacy references, uniqueness, real restore, writer coverage and private permissions';
end;
$test$;
rollback;
