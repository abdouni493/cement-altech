-- 04: run AFTER 03_finalisation.sql (upgrade and fresh installations).
-- No document is renumbered. Width is a minimum (999 -> 1000, 99 -> 100).
-- Normal allocation is one primary-key UPSERT, independent of history size.
-- Apply in a maintenance window: this transaction briefly blocks document writes.
begin;
lock table public.commands, public.command_deliveries, public.sales,
  public.purchases, public.purchase_orders in share row exclusive mode;

create table if not exists public.document_reference_counters (
  prefix text primary key,
  last_value numeric not null check (last_value >= 0 and scale(last_value) = 0)
);
alter table public.document_reference_counters enable row level security;
revoke all on table public.document_reference_counters from public, anon, authenticated;

-- Private helper shared by migrations, imports and the insert/update triggers.
create or replace function public.observe_document_reference(p_reference text, p_family text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $allocator$
declare v_match text[];
begin
  if p_family = 'BL' then
    v_match := regexp_match(p_reference, '^(BL-.+-)([0-9]+)$');
  elsif p_family in ('CMD', 'VNT', 'ACH', 'BC') then
    v_match := regexp_match(p_reference, '^(' || p_family || '-[0-9]{4}-)([0-9]+)$');
  else
    raise exception 'Unknown document reference family: %', p_family;
  end if;
  -- Nonstandard legacy references stay untouched, and occupy no generated suffix.
  if v_match is null then return; end if;
  insert into public.document_reference_counters(prefix, last_value)
  values (v_match[1], v_match[2]::numeric)
  on conflict (prefix) do update
  set last_value = greatest(document_reference_counters.last_value, excluded.last_value);
end;
$allocator$;

create or replace function public.next_document_reference(p_prefix text, p_min_width integer)
returns text language plpgsql security definer set search_path = public, pg_catalog as $allocator$
declare v_suffix text;
begin
  if p_prefix !~ '^((CMD|VNT|ACH|BC)-[0-9]{4}-|BL-.+-)$'
     or p_min_width not between 1 and 20 then
    raise exception 'Invalid document reference namespace or minimum width';
  end if;
  insert into public.document_reference_counters(prefix, last_value)
  values (p_prefix, 1)
  on conflict (prefix) do update
    set last_value = document_reference_counters.last_value + 1
  returning last_value::text into v_suffix;
  return p_prefix || lpad(v_suffix, greatest(p_min_width, length(v_suffix)), '0');
end;
$allocator$;

create or replace function public.sync_document_reference_counters()
returns void language plpgsql security definer set search_path = public, pg_catalog as $allocator$
begin
  -- Only migration/restore uses this history scan. Never called on normal saves.
  -- Keep the existing high-water mark even after deletions or restoring an older backup.
  insert into public.document_reference_counters(prefix, last_value)
  select m[1], max(m[2]::numeric)
  from (
    select regexp_match(reference, '^(CMD-[0-9]{4}-)([0-9]+)$') m from public.commands
    union all select regexp_match(reference, '^(VNT-[0-9]{4}-)([0-9]+)$') from public.sales
    union all select regexp_match(reference, '^(ACH-[0-9]{4}-)([0-9]+)$') from public.purchases
    union all select regexp_match(reference, '^(BC-[0-9]{4}-)([0-9]+)$') from public.purchase_orders
    union all select regexp_match(reference, '^(BL-.+-)([0-9]+)$') from public.command_deliveries
  ) refs where m is not null group by m[1]
  on conflict (prefix) do update
    set last_value = greatest(document_reference_counters.last_value, excluded.last_value);
end;
$allocator$;

create or replace function public.trg_observe_document_reference()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $allocator$
begin
  perform public.observe_document_reference(new.reference, TG_ARGV[0]);
  return new;
end;
$allocator$;

-- Legacy direct inserts and explicit imported references also lock/advance the
-- same namespace. Exact reference uniqueness continues to use existing UNIQUE
-- constraints. A competing legacy client can get 23505 and must retry its write;
-- all normal RPCs allocate atomically before inserting.
drop trigger if exists document_reference_counter on public.commands;
create trigger document_reference_counter before insert or update of reference on public.commands
for each row execute function public.trg_observe_document_reference('CMD');
drop trigger if exists document_reference_counter on public.sales;
create trigger document_reference_counter before insert or update of reference on public.sales
for each row execute function public.trg_observe_document_reference('VNT');
drop trigger if exists document_reference_counter on public.purchases;
create trigger document_reference_counter before insert or update of reference on public.purchases
for each row execute function public.trg_observe_document_reference('ACH');
drop trigger if exists document_reference_counter on public.purchase_orders;
create trigger document_reference_counter before insert or update of reference on public.purchase_orders
for each row execute function public.trg_observe_document_reference('BC');
drop trigger if exists document_reference_counter on public.command_deliveries;
create trigger document_reference_counter before insert or update of reference on public.command_deliveries
for each row execute function public.trg_observe_document_reference('BL');

-- Existing duplicated BL references are reported by diagnostics. Do not renumber
-- issued documents automatically: resolve duplicates explicitly before retrying.
create unique index if not exists command_deliveries_reference_uidx
  on public.command_deliveries(reference);

select public.sync_document_reference_counters();

-- Replace ONLY the reviewed numbering blocks, preserving the installed business
-- logic, security attributes and grants. A divergent installation fails closed
-- and rolls back instead of silently overwriting business fixes. Reapplicable.
do $patch$
declare v_patch record; v_def text; v_signature regprocedure;
begin
  for v_patch in select * from (values
    ('public.create_command(jsonb)', $old$select coalesce(count(*), 0) + 1 into v_seq from public.commands;
  v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.commands where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  end loop;$old$, $new$v_ref := public.next_document_reference('CMD-' || v_year || '-', 3);$new$),
    ('public.create_command_delivery(jsonb)', $old$select count(*) + 1 into v_seq from public.command_deliveries where command_id = v_cmd.id;
  v_ref := 'BL-' || v_cmd.reference || '-' || lpad(v_seq::text, 2, '0');
  while exists (select 1 from public.command_deliveries where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'BL-' || v_cmd.reference || '-' || lpad(v_seq::text, 2, '0');
  end loop;$old$, $new$v_ref := public.next_document_reference('BL-' || v_cmd.reference || '-', 2);$new$),
    ('public.apply_delivery_sale(uuid)', $old$select coalesce(count(*), 0) + 1 into v_seq from public.sales;
    v_ref := 'VNT-' || v_year || '-' || lpad(v_seq::text, 3, '0');
    while exists (select 1 from public.sales where reference = v_ref) loop
      v_seq := v_seq + 1;
      v_ref := 'VNT-' || v_year || '-' || lpad(v_seq::text, 3, '0');
    end loop;$old$, $new$v_ref := public.next_document_reference('VNT-' || v_year || '-', 3);$new$),
    ('public.create_sale(jsonb)', $old$select coalesce(count(*), 0) + 1 into v_seq from public.sales;
  v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.sales where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;$old$, $new$v_ref := public.next_document_reference('VNT-' || to_char(v_date, 'YYYY') || '-', 3);$new$),
    ('public.create_purchase(jsonb)', $old$select coalesce(count(*), 0) + 1 into v_seq from public.purchases;
  v_ref := 'ACH-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.purchases where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'ACH-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;$old$, $new$v_ref := public.next_document_reference('ACH-' || to_char(v_date, 'YYYY') || '-', 3);$new$),
    ('public.create_purchase_order(jsonb)', $old$select count(*) + 1 into v_seq from public.purchase_orders;
  v_ref := 'BC-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.purchase_orders where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'BC-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;$old$, $new$v_ref := public.next_document_reference('BC-' || to_char(v_date, 'YYYY') || '-', 3);$new$)
  ) as patches(signature, old_block, new_block)
  loop
    v_signature := v_patch.signature::regprocedure;
    -- 05 wraps this RPC while retaining its numbered accounting implementation.
    if v_patch.signature = 'public.create_command_delivery(jsonb)'
       and to_regprocedure('public.create_command_delivery_accounting_v1(jsonb)') is not null then
      v_signature := 'public.create_command_delivery_accounting_v1(jsonb)'::regprocedure;
    end if;
    v_def := pg_get_functiondef(v_signature);
    if strpos(v_def, v_patch.new_block) > 0 then continue; end if;
    if strpos(v_def, v_patch.old_block) = 0 then
      raise exception 'Unrecognized numbering definition: %. Inspect diagnostic output before adapting migration.', v_patch.signature;
    end if;
    execute replace(v_def, v_patch.old_block, v_patch.new_block);
  end loop;

  -- backup_restore intentionally disables triggers and truncates ALL public
  -- tables, including these counters. Preserve current high-water marks, merge
  -- imported marks, then scan restored documents once, all in its transaction.
  -- External imports disabling triggers must also sync before committing.
  v_def := pg_get_functiondef('public.backup_restore(jsonb)'::regprocedure);
  if strpos(v_def, 'v_reference_counters jsonb') = 0 then
    if strpos(v_def, 'v_replica  boolean := true;') = 0 then
      raise exception 'Unrecognized backup_restore declaration; migration rolled back';
    end if;
    v_def := replace(v_def, 'v_replica  boolean := true;',
      'v_replica  boolean := true;' || chr(10) ||
      '  v_reference_counters jsonb := (select coalesce(jsonb_agg(to_jsonb(c)), ''[]''::jsonb) from public.document_reference_counters c);');
    -- An earlier application of this migration may already contain the sync.
    v_def := replace(v_def, 'perform public.sync_document_reference_counters();', '');
    if strpos(v_def, 'return jsonb_build_object(''ok'', true, ''tables'', v_restored,') = 0 then
      raise exception 'Unrecognized backup_restore return; migration rolled back';
    end if;
    v_def := replace(v_def,
      'return jsonb_build_object(''ok'', true, ''tables'', v_restored,',
      $merge$insert into public.document_reference_counters(prefix, last_value)
    select prefix, last_value from jsonb_to_recordset(v_reference_counters) as c(prefix text, last_value numeric)
    on conflict (prefix) do update set last_value = greatest(document_reference_counters.last_value, excluded.last_value);
  perform public.sync_document_reference_counters();
  return jsonb_build_object('ok', true, 'tables', v_restored,$merge$);
    execute v_def;
  end if;
end;
$patch$;

revoke all on function public.observe_document_reference(text, text) from public, anon, authenticated;
revoke all on function public.next_document_reference(text, integer) from public, anon, authenticated;
revoke all on function public.sync_document_reference_counters() from public, anon, authenticated;
revoke all on function public.trg_observe_document_reference() from public, anon, authenticated;
commit;
