-- Apply AFTER 04_atomic_reference_allocator.sql and 05_atomic_command_operations.sql.
-- Read-only, RLS-preserving summary API; history reports keep their explicit full reads.
begin;

create index if not exists commands_scope_created_id_idx
  on public.commands (is_historical, created_at desc, id desc);
create index if not exists sales_command_delivery_idx
  on public.sales (command_id) where delivery_id is not null;

create or replace function public.list_command_summaries(
  p_search text default '', p_scope text default 'real', p_status text default 'all',
  p_from timestamptz default null, p_to timestamptz default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker set search_path = public
as $fn$
declare v_result jsonb;
begin
  if not public.has_perm('clients', 'view') then
    raise exception 'Vous n''avez pas la permission de consulter les commandes' using errcode = '42501';
  end if;
  if p_scope not in ('real', 'historical', 'all') or
     p_status not in ('all', 'paid', 'debt', 'undelivered', 'partial', 'delivered') then
    raise exception 'Filtre de commandes invalide';
  end if;

  with base as materialized (
    select c.*, coalesce(q.ordered_quantity, 0) ordered_quantity,
      coalesce(q.delivered_quantity, 0) delivered_quantity,
      coalesce(q.cancelled_quantity, 0) cancelled_quantity,
      greatest(0, coalesce(q.ordered_quantity, 0) - coalesce(q.cancelled_quantity, 0)) expected_quantity
    from public.commands c
    left join lateral (
      select sum(i.quantity) ordered_quantity, sum(i.delivered_quantity) delivered_quantity,
        sum(i.cancelled_quantity) cancelled_quantity
      from public.command_items i where i.command_id = c.id
    ) q on true
    where (p_scope = 'all' or coalesce(c.is_historical, false) = (p_scope = 'historical'))
      and (p_from is null or c.created_at >= p_from)
      and (p_to is null or c.created_at <= p_to)
      and (coalesce(p_search, '') = '' or
        position(lower(p_search) in lower(concat_ws(' ', c.reference, c.client_name,
          c.bon_number, c.client_address, c.client_phone))) > 0)
  ), filtered as materialized (
    select * from base b where
      p_status = 'all'
      or (p_status = 'paid' and b.rest_amount <= 0)
      or (p_status = 'debt' and b.rest_amount > 0)
      or (p_status = 'undelivered' and b.delivered_quantity <= 0)
      or (p_status = 'partial' and b.delivered_quantity > 0 and b.expected_quantity - b.delivered_quantity > 0.0001)
      or (p_status = 'delivered' and b.expected_quantity - b.delivered_quantity <= 0.0001)
  ), page as (
    select * from filtered order by created_at desc, id desc
    limit greatest(1, least(coalesce(p_limit, 50), 100)) offset greatest(0, coalesce(p_offset, 0))
  ), invoices as (
    select coalesce(sum(s.final_amount), 0) amount, coalesce(sum(s.rest_amount), 0) rest
    from public.sales s join filtered c on c.id = s.command_id where s.delivery_id is not null
  )
  select jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc), '[]'::jsonb) from page p),
    'total_count', (select count(*) from filtered),
    'stats', (select jsonb_build_object(
      'totalPaid', coalesce(sum(paid_amount), 0), 'totalRest', coalesce(sum(rest_amount), 0),
      'totalValue', coalesce(sum(total_ttc), 0),
      'pendingDelivery', count(*) filter (where expected_quantity - delivered_quantity > 0.0001),
      'invoiced', (select amount from invoices), 'invoicedRest', (select rest from invoices)
    ) from filtered),
    'counts', (select jsonb_build_object(
      'paid', count(*) filter (where rest_amount <= 0),
      'debt', count(*) filter (where rest_amount > 0),
      'undelivered', count(*) filter (where delivered_quantity <= 0),
      'partial', count(*) filter (where delivered_quantity > 0 and expected_quantity - delivered_quantity > 0.0001),
      'delivered', count(*) filter (where expected_quantity - delivered_quantity <= 0.0001)
    ) from base)
  ) into v_result;
  return v_result;
end;
$fn$;

revoke all on function public.list_command_summaries(text,text,text,timestamptz,timestamptz,integer,integer) from public, anon;
grant execute on function public.list_command_summaries(text,text,text,timestamptz,timestamptz,integer,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
