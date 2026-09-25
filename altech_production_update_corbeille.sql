-- =============================================================================
--  ALTECH PRODUCTION — MISE A JOUR : CORBEILLE (restauration des suppressions)
-- -----------------------------------------------------------------------------
--  Toute ligne supprimée (bouton « Supprimer » de n'importe quelle interface,
--  suppression faite par une fonction RPC, suppression en cascade) est copiée
--  dans public.recycle_bin avant de disparaître. L'écran
--  Paramètres › Corbeille liste ces suppressions et permet de les restaurer.
--
--  A exécuter UNE fois dans Supabase › SQL Editor (ré-exécutable sans risque).
-- =============================================================================

-- 1) Table de la corbeille ------------------------------------------------------
create table if not exists public.recycle_bin (
  id           bigserial primary key,
  tx_id        bigint      not null default txid_current(),
  table_name   text        not null,
  row_id       text,
  data         jsonb       not null,
  deleted_at   timestamptz not null default now(),
  deleted_by   uuid        default auth.uid(),
  user_marked  boolean     not null default false,   -- suppression demandée par un bouton
  reinserted   boolean     not null default false    -- la même transaction a ré-inséré dans la table (= modification)
);
create index if not exists recycle_bin_tx_idx on public.recycle_bin (tx_id);
create index if not exists recycle_bin_date_idx on public.recycle_bin (deleted_at desc);

alter table public.recycle_bin enable row level security;
drop policy if exists recycle_bin_sel on public.recycle_bin;
create policy recycle_bin_sel on public.recycle_bin for select to authenticated using (true);

-- 2) Déclencheurs ---------------------------------------------------------------
create or replace function public.recycle_capture()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.recycle_bin (table_name, row_id, data, user_marked)
  values (
    tg_table_name,
    to_jsonb(old) ->> 'id',
    to_jsonb(old),
    coalesce(current_setting('app.recycle_user', true), '') = 'on'
  );
  perform set_config('app.recycle_tx', 'on', true);
  return old;
end $$;

-- Une insertion dans la même table pendant la même transaction = une
-- modification (supprimer puis recréer les lignes) : elle n'est pas affichée.
create or replace function public.recycle_mark_reinsert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.recycle_tx', true), '') = 'on' then
    update public.recycle_bin
       set reinserted = true
     where tx_id = txid_current() and table_name = tg_table_name and not reinserted;
  end if;
  return null;
end $$;

do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname not in ('recycle_bin', 'profiles', 'store_settings', 'caisse_settings', 'activity_log')
       and c.relname not like 'repair\_%'
  loop
    execute format('drop trigger if exists zz_recycle_capture on public.%I', r.relname);
    execute format('create trigger zz_recycle_capture before delete on public.%I
                    for each row execute function public.recycle_capture()', r.relname);
    execute format('drop trigger if exists zz_recycle_reinsert on public.%I', r.relname);
    execute format('create trigger zz_recycle_reinsert after insert on public.%I
                    for each statement execute function public.recycle_mark_reinsert()', r.relname);
  end loop;
end $$;

-- 3) Suppression depuis un bouton (marque la suppression comme « utilisateur ») --
-- security invoker : les droits (RLS) de l'utilisateur s'appliquent toujours.
create or replace function public.recycle_delete(p_table text, p_id text)
returns void language plpgsql security invoker set search_path = public as $$
declare v_count int;
begin
  perform set_config('app.recycle_user', 'on', true);
  execute format('delete from public.%I where id::text = $1', p_table) using p_id;
  get diagnostics v_count = row_count;
  perform set_config('app.recycle_user', '', true);
end $$;
grant execute on function public.recycle_delete(text, text) to authenticated;

-- 4) Liste des suppressions affichées dans Paramètres › Corbeille ----------------
create or replace function public.recycle_bin_list()
returns table (
  id bigint, tx_id bigint, table_name text, row_id text, data jsonb,
  deleted_at timestamptz, deleted_by_name text
) language plpgsql security definer set search_path = public as $$
declare
  v_detail text[] := array[
    'command_items','sale_lines','purchase_lines','purchase_order_items','fiche_technic_lines',
    'command_delivery_items','command_delivery_consumptions','command_adjustment_lines',
    'production_used_products','stock_movements','caisse_transactions'];
begin
  -- ménage : les traces internes (modifications) de plus de 7 jours
  delete from public.recycle_bin b
   where b.deleted_at < now() - interval '7 days'
     and not exists (
       select 1 from public.recycle_bin x
        where x.tx_id = b.tx_id
          and (x.user_marked or (not x.reinserted and not (x.table_name = any (v_detail)))));

  return query
    select b.id, b.tx_id, b.table_name, b.row_id, b.data, b.deleted_at,
           coalesce(nullif(p.full_name, ''), p.username, p.email, '')::text
      from public.recycle_bin b
      left join public.profiles p on p.id = b.deleted_by
     where exists (
       select 1 from public.recycle_bin x
        where x.tx_id = b.tx_id
          and (x.user_marked or (not x.reinserted and not (x.table_name = any (v_detail)))))
     order by b.deleted_at desc, b.id;
end $$;
grant execute on function public.recycle_bin_list() to authenticated;

-- 5) Restauration d'une suppression (toutes les lignes de la même opération) ----
create or replace function public.recycle_restore(p_tx_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_cols text;
  v_pending bigint[];
  v_done int := 0;
  v_progress boolean := true;
  v_last_error text;
begin
  if not (public.is_admin() or public.has_perm('settings', 'edit')) then
    raise exception 'Accès refusé';
  end if;

  select array_agg(b.id order by b.id) into v_pending from public.recycle_bin b where b.tx_id = p_tx_id;
  if v_pending is null then raise exception 'Élément introuvable dans la corbeille'; end if;

  -- plusieurs passes : les lignes parentes doivent exister avant leurs lignes filles
  while v_progress and array_length(v_pending, 1) > 0 loop
    v_progress := false;
    for r in select b.* from public.recycle_bin b where b.id = any (v_pending) order by b.id loop
      select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position) into v_cols
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = r.table_name
         and c.is_generated = 'NEVER' and coalesce(c.identity_generation, '') <> 'ALWAYS'
         and r.data ? c.column_name;
      begin
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
                       r.table_name, v_cols, v_cols, r.table_name) using r.data;
        v_done := v_done + 1;
        v_pending := array_remove(v_pending, r.id);
        v_progress := true;
      exception
        when unique_violation then          -- la ligne existe déjà : rien à restaurer
          v_pending := array_remove(v_pending, r.id);
          v_progress := true;
        when others then
          v_last_error := sqlerrm;          -- réessayée à la passe suivante
      end;
    end loop;
  end loop;

  if array_length(v_pending, 1) > 0 then
    raise exception 'Restauration impossible : %', coalesce(v_last_error, 'dépendance manquante');
  end if;

  delete from public.recycle_bin where tx_id = p_tx_id;
  return v_done;
end $$;
grant execute on function public.recycle_restore(bigint) to authenticated;

notify pgrst, 'reload schema';
