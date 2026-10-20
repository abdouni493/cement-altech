-- =============================================================================
-- Altech Production — Sauvegarde complète / Vérification / Restauration
-- =============================================================================
-- Paramètres › Base de données :
--   « Télécharger la sauvegarde »  -> public.backup_export()
--   « Vérifier une sauvegarde »    -> public.backup_verify(jsonb)
--   « Restaurer »                  -> public.backup_restore(jsonb)
--
-- La sauvegarde contient TOUTES les tables du schéma public (clients,
-- fournisseurs, stock, achats, ventes, commandes, productions, employés,
-- caisse, dépenses, paramètres, corbeille, journal…) ligne par ligne, ainsi
-- que les comptes de connexion (auth.users + auth.identities, mots de passe
-- chiffrés compris) : après restauration on se connecte avec les mêmes
-- identifiants qu'avant.
--
-- Migration vers un nouveau projet Supabase :
--   1. ancien projet : exécuter ce fichier, puis Paramètres › Télécharger
--   2. nouveau projet : exécuter altech_production_supabase.sql puis tous les
--      altech_production_update_*.sql (dont celui-ci)
--   3. créer un compte administrateur temporaire, se connecter,
--      Paramètres › Restaurer › choisir le fichier
--   4. se reconnecter avec les identifiants d'origine, puis
--      Paramètres › Vérifier une sauvegarde -> tout doit être « identique »
--
-- Idempotent : peut être ré-exécuté sans risque.
-- =============================================================================

-- Tables sauvegardées : toutes les tables ordinaires du schéma public.
create or replace function public._backup_tables()
returns setof text
language sql stable
set search_path = public, pg_catalog
as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  order by c.relname;
$$;

-- Colonnes insérables (les colonnes générées sont recalculées par Postgres).
create or replace function public._backup_columns(p_schema text, p_table text)
returns text[]
language sql stable
set search_path = public, pg_catalog
as $$
  select coalesce(array_agg(a.attname::text order by a.attnum), '{}')
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = p_schema and c.relname = p_table
    and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
$$;

-- Empreinte d'une table : nombre de lignes + md5 des lignes triées.
-- Les lignes sont comparées sous leur forme typée (record::text), ce qui
-- neutralise les différences de format JSON (1.5 / 1.50, ordre des clés…).
create or replace function public._backup_live_fingerprint(p_schema text, p_table text)
returns jsonb
language plpgsql stable
set search_path = public, pg_catalog
as $$
declare
  v_count bigint;
  v_md5   text;
begin
  execute format(
    'select count(*), md5(coalesce(string_agg(t::text, E''\n'' order by t::text), '''')) from %I.%I t',
    p_schema, p_table) into v_count, v_md5;
  return jsonb_build_object('rows', v_count, 'md5', v_md5);
end;
$$;

create or replace function public._backup_file_fingerprint(p_schema text, p_table text, p_rows jsonb)
returns jsonb
language plpgsql stable
set search_path = public, pg_catalog
as $$
declare
  v_count bigint;
  v_md5   text;
begin
  execute format(
    'select count(*), md5(coalesce(string_agg(t::text, E''\n'' order by t::text), ''''))
       from jsonb_populate_recordset(null::%I.%I, $1) t',
    p_schema, p_table) using coalesce(p_rows, '[]'::jsonb) into v_count, v_md5;
  return jsonb_build_object('rows', v_count, 'md5', v_md5);
end;
$$;

-- -----------------------------------------------------------------------------
-- Export
-- -----------------------------------------------------------------------------
create or replace function public.backup_export()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_table  text;
  v_rows   jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_users  jsonb;
  v_ids    jsonb;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur';
  end if;

  for v_table in select public._backup_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', v_table)
      into v_rows;
    v_tables := v_tables || jsonb_build_object(v_table, v_rows);
    v_counts := v_counts || jsonb_build_object(v_table, jsonb_array_length(v_rows));
  end loop;

  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_users from auth.users u;
  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) into v_ids from auth.identities i;

  return jsonb_build_object(
    'format',     'altech-production-backup',
    'version',    2,
    'created_at', now(),
    'tables',     v_tables,
    'counts',     v_counts,
    'auth',       jsonb_build_object('users', v_users, 'identities', v_ids)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Vérification : compare le fichier à la base actuelle, table par table.
-- -----------------------------------------------------------------------------
create or replace function public.backup_verify(p_backup jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_table  text;
  v_file   jsonb;
  v_live   jsonb;
  v_result jsonb := '[]'::jsonb;
  v_ok     boolean := true;
  v_same   boolean;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur';
  end if;
  if p_backup->>'format' is distinct from 'altech-production-backup' then
    raise exception 'Ce fichier n''est pas une sauvegarde Altech Production';
  end if;

  -- tables de la base et/ou du fichier
  for v_table in
    select name from (
      select public._backup_tables() as name
      union
      select jsonb_object_keys(p_backup->'tables')
    ) s order by name
  loop
    if not exists (select 1 from public._backup_tables() t where t = v_table) then
      v_result := v_result || jsonb_build_object('table', v_table, 'status', 'absente de la base',
        'file_rows', jsonb_array_length(p_backup->'tables'->v_table), 'db_rows', null);
      v_ok := false;
      continue;
    end if;

    v_live := public._backup_live_fingerprint('public', v_table);
    if not (p_backup->'tables' ? v_table) then
      v_result := v_result || jsonb_build_object('table', v_table, 'status', 'absente du fichier',
        'file_rows', null, 'db_rows', v_live->'rows');
      if (v_live->>'rows')::bigint > 0 then v_ok := false; end if;
      continue;
    end if;

    v_file := public._backup_file_fingerprint('public', v_table, p_backup->'tables'->v_table);
    v_same := v_file = v_live;
    if not v_same then v_ok := false; end if;
    v_result := v_result || jsonb_build_object('table', v_table,
      'status', case when v_same then 'identique' else 'différente' end,
      'file_rows', v_file->'rows', 'db_rows', v_live->'rows');
  end loop;

  -- comptes de connexion
  v_live := public._backup_live_fingerprint('auth', 'users');
  v_file := public._backup_file_fingerprint('auth', 'users', p_backup->'auth'->'users');
  v_same := v_file = v_live;
  if not v_same then v_ok := false; end if;
  v_result := v_result || jsonb_build_object('table', 'comptes (auth.users)',
    'status', case when v_same then 'identique' else 'différente' end,
    'file_rows', v_file->'rows', 'db_rows', v_live->'rows');

  return jsonb_build_object('ok', v_ok, 'created_at', p_backup->'created_at', 'tables', v_result);
end;
$$;

-- -----------------------------------------------------------------------------
-- Restauration : remplace toutes les données par celles du fichier.
-- Tout se fait dans une seule transaction : en cas d'erreur rien n'est modifié.
-- Les déclencheurs (mouvements de stock, soldes, journal…) sont désactivés
-- pendant l'import pour que les données soient reprises telles quelles,
-- sans double comptage.
-- -----------------------------------------------------------------------------
create or replace function public._backup_insert(p_schema text, p_table text, p_rows jsonb)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_cols text;
begin
  if p_rows is null or jsonb_array_length(p_rows) = 0 then return; end if;
  -- uniquement les colonnes présentes à la fois dans la table et dans le fichier
  select string_agg(quote_ident(c), ', ') into v_cols
  from unnest(public._backup_columns(p_schema, p_table)) c
  where exists (select 1 from jsonb_array_elements(p_rows) r where r ? c);
  if v_cols is null then return; end if;
  execute format(
    'insert into %I.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::%I.%I, $1)',
    p_schema, p_table, v_cols, v_cols, p_schema, p_table) using p_rows;
end;
$$;

create or replace function public.backup_restore(p_backup jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_table    text;
  v_list     text;
  v_seq      record;
  v_restored jsonb := '{}'::jsonb;
  v_replica  boolean := true;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur';
  end if;
  if p_backup->>'format' is distinct from 'altech-production-backup' then
    raise exception 'Ce fichier n''est pas une sauvegarde Altech Production';
  end if;

  begin
    set local session_replication_role = replica;
  exception when others then
    v_replica := false;
  end;

  select string_agg(format('public.%I', t), ', ') into v_list from public._backup_tables() t;
  if not v_replica then
    for v_table in select public._backup_tables() loop
      execute format('alter table public.%I disable trigger user', v_table);
    end loop;
  end if;

  -- 1. comptes de connexion
  if p_backup->'auth' ? 'users' then
    execute 'truncate table ' || v_list || ' cascade';
    delete from auth.identities;
    delete from auth.users;
    perform public._backup_insert('auth', 'users', p_backup->'auth'->'users');
    perform public._backup_insert('auth', 'identities', p_backup->'auth'->'identities');
  end if;

  -- 2. données de l'application
  execute 'truncate table ' || v_list || ' cascade';
  if v_replica then
    for v_table in select public._backup_tables() loop
      if p_backup->'tables' ? v_table then
        perform public._backup_insert('public', v_table, p_backup->'tables'->v_table);
        v_restored := v_restored || jsonb_build_object(v_table, jsonb_array_length(p_backup->'tables'->v_table));
      end if;
    end loop;
  else
    -- sans mode replica : clés étrangères vérifiées, on insère dans l'ordre des dépendances
    declare
      v_done    text[] := '{}';
      v_pending text[];
      v_progress boolean;
    begin
      select array_agg(t) into v_pending from public._backup_tables() t;
      loop
        v_progress := false;
        foreach v_table in array v_pending loop
          if not exists (
            select 1 from pg_constraint k
            join pg_class c on c.oid = k.conrelid
            join pg_class r on r.oid = k.confrelid
            join pg_namespace rn on rn.oid = r.relnamespace
            where k.contype = 'f' and c.relname = v_table
              and c.relnamespace = 'public'::regnamespace
              and rn.nspname = 'public' and r.relname <> v_table
              and not (r.relname = any(v_done))
          ) then
            if p_backup->'tables' ? v_table then
              perform public._backup_insert('public', v_table, p_backup->'tables'->v_table);
              v_restored := v_restored || jsonb_build_object(v_table, jsonb_array_length(p_backup->'tables'->v_table));
            end if;
            v_done := v_done || v_table;
            v_pending := array_remove(v_pending, v_table);
            v_progress := true;
          end if;
        end loop;
        exit when coalesce(array_length(v_pending, 1), 0) = 0;
        if not v_progress then
          raise exception 'Dépendances circulaires entre tables : %', v_pending;
        end if;
      end loop;
    end;
    for v_table in select public._backup_tables() loop
      execute format('alter table public.%I enable trigger user', v_table);
    end loop;
  end if;

  -- 3. compteurs (bigserial / identity) repositionnés après les lignes importées
  for v_seq in
    select n.nspname as sch, c.relname as tbl, a.attname as col,
           pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) as seq
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  loop
    if v_seq.seq is not null then
      execute format('select setval(%L, coalesce((select max(%I) from %I.%I), 0) + 1, false)',
        v_seq.seq, v_seq.col, v_seq.sch, v_seq.tbl);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'tables', v_restored,
    'users', jsonb_array_length(coalesce(p_backup->'auth'->'users', '[]'::jsonb)));
end;
$$;

revoke all on function public.backup_export()        from public, anon;
revoke all on function public.backup_verify(jsonb)   from public, anon;
revoke all on function public.backup_restore(jsonb)  from public, anon;
grant execute on function public.backup_export()       to authenticated;
grant execute on function public.backup_verify(jsonb)  to authenticated;
grant execute on function public.backup_restore(jsonb) to authenticated;

revoke all on function public._backup_tables()                          from public, anon, authenticated;
revoke all on function public._backup_columns(text, text)               from public, anon, authenticated;
revoke all on function public._backup_live_fingerprint(text, text)      from public, anon, authenticated;
revoke all on function public._backup_file_fingerprint(text, text, jsonb) from public, anon, authenticated;
revoke all on function public._backup_insert(text, text, jsonb)         from public, anon, authenticated;
