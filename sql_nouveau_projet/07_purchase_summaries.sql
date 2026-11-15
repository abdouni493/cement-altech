-- Apply after 06_command_summaries.sql. Bounded purchase list; RLS unchanged.
begin;
create index if not exists purchases_date_id_idx on public.purchases (date desc, id desc);

create or replace function public.list_purchase_summaries(
  p_search text default '', p_unit text default '', p_from date default null,
  p_to date default null, p_deliverer_ids uuid[] default '{}',
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path = public
as $fn$
declare v_result jsonb;
begin
  if not public.has_perm('purchase', 'view') then
    raise exception 'Vous n''avez pas la permission de consulter les achats' using errcode='42501';
  end if;
  with filtered as materialized (
    select p.* from public.purchases p
    left join public.suppliers s on s.id=p.supplier_id
    where (p_from is null or p.date>=p_from) and (p_to is null or p.date<=p_to)
      and (coalesce(p_search,'')='' or
        position(lower(p_search) in lower(concat_ws(' ',s.name,p.reference,p.bon_number,p.driver_plate)))>0
        or p.id=any(coalesce(p_deliverer_ids,'{}'::uuid[])))
      and (coalesce(p_unit,'')='' or exists (
        select 1 from public.purchase_lines l left join public.products pr on pr.id=l.product_id
        where l.purchase_id=p.id and coalesce(nullif(l.unit,''),pr.unit)=p_unit
      ))
  ), page as (
    select * from filtered order by date desc,id desc
    limit greatest(1,least(coalesce(p_limit,50),100)) offset greatest(0,coalesce(p_offset,0))
  ), rows as (
    select p.*, q.line_count, q.units from page p left join lateral (
      select count(*) line_count,
        coalesce(jsonb_agg(distinct coalesce(nullif(l.unit,''),pr.unit))
          filter(where coalesce(nullif(l.unit,''),pr.unit) is not null),'[]'::jsonb) units
      from public.purchase_lines l left join public.products pr on pr.id=l.product_id where l.purchase_id=p.id
    ) q on true
  )
  select jsonb_build_object(
    'rows',(select coalesce(jsonb_agg(to_jsonb(r) order by r.date desc,r.id desc),'[]'::jsonb) from rows r),
    'total_count',(select count(*) from filtered),
    'stats',(select jsonb_build_object('totalPurchases',coalesce(sum(total_amount),0),
      'totalPaid',coalesce(sum(paid_amount),0),'totalDebt',coalesce(sum(rest_amount),0)) from filtered)
  ) into v_result;
  return v_result;
end;
$fn$;
revoke all on function public.list_purchase_summaries(text,text,date,date,uuid[],integer,integer) from public,anon;
grant execute on function public.list_purchase_summaries(text,text,date,date,uuid[],integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
