-- =============================================================================
--  ALTECH PRODUCTION — NOUVEAU PROJET SUPABASE : FINALISATION (ETAPE 3/3)
-- -----------------------------------------------------------------------------
--  Ordre d'execution dans Supabase › SQL Editor du NOUVEAU projet :
--    1. altech_production_supabase.sql
--    2. altech_production_toutes_mises_a_jour.sql
--    3. CE FICHIER (performance + delais)
--  Idempotent : peut etre relance sans risque. Ne modifie aucune donnee.
-- =============================================================================

-- 0. DELAIS : une restauration complete ou un gros enregistrement ne doit pas
--    etre coupe au bout de 8 s (delai par defaut des utilisateurs connectes).
alter role authenticated set statement_timeout = '60s';
alter role anon          set statement_timeout = '15s';

-- Recherche du prochain numero (CMD-AAAA-%, ACH-AAAA-%) par prefixe
create index if not exists commands_reference_like_idx  on public.commands  (reference text_pattern_ops);
create index if not exists purchases_reference_like_idx on public.purchases (reference text_pattern_ops);
create index if not exists sales_reference_like_idx     on public.sales     (reference text_pattern_ops);

notify pgrst, 'reload config';

-- ---------------------------------------------------------------------------
--  PERFORMANCE (contenu de altech_production_update_performance.sql)
-- ---------------------------------------------------------------------------
-- 1. RLS : has_perm() / is_admin() / auth.uid() calcules une fois par requete
do $$
declare
  p      record;
  v_qual text;
  v_chk  text;
  v_sql  text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') ~ '(has_perm|is_admin|auth\.uid)\('
            or coalesce(with_check, '') ~ '(has_perm|is_admin|auth\.uid)\(')
  loop
    -- deja optimisee (relance du script) : on n'emballe pas deux fois
    continue when coalesce(p.qual, '') ilike '%select%' or coalesce(p.with_check, '') ilike '%select%';

    v_qual := p.qual;
    v_chk  := p.with_check;

    v_qual := regexp_replace(v_qual, '(public\.)?has_perm\((''[^'']*''::text), (''[^'']*''::text)\)',
                             '(select public.has_perm(\2, \3))', 'g');
    v_qual := regexp_replace(v_qual, '(public\.)?is_admin\(\)', '(select public.is_admin())', 'g');
    v_qual := regexp_replace(v_qual, 'auth\.uid\(\)', '(select auth.uid())', 'g');

    v_chk := regexp_replace(v_chk, '(public\.)?has_perm\((''[^'']*''::text), (''[^'']*''::text)\)',
                            '(select public.has_perm(\2, \3))', 'g');
    v_chk := regexp_replace(v_chk, '(public\.)?is_admin\(\)', '(select public.is_admin())', 'g');
    v_chk := regexp_replace(v_chk, 'auth\.uid\(\)', '(select auth.uid())', 'g');

    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_chk  is not null then v_sql := v_sql || format(' with check (%s)', v_chk); end if;
    execute v_sql;
  end loop;
end $$;

-- 2. Index sur chaque cle etrangere qui n'en a pas encore
do $$
declare
  fk     record;
  v_name text;
begin
  for fk in
    select c.relname as tbl, a.attname as col
      from pg_constraint k
      join pg_class c     on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f'
       and n.nspname = 'public'
       and array_length(k.conkey, 1) = 1
       and not exists (
         select 1 from pg_index i
          where i.indrelid = k.conrelid and i.indkey[0] = k.conkey[1])
  loop
    v_name := left(fk.tbl || '_' || fk.col || '_fkidx', 63);
    execute format('create index if not exists %I on public.%I (%I)', v_name, fk.tbl, fk.col);
  end loop;
end $$;

-- Recherches frequentes des ecrans (historique client / fournisseur, caisse)
create index if not exists sales_client_date_idx        on public.sales (client_id, date desc);
create index if not exists purchases_supplier_date_idx  on public.purchases (supplier_id, date desc);
create index if not exists commands_client_created_idx  on public.commands (client_id, created_at desc);
create index if not exists caisse_tx_created_idx        on public.caisse_transactions (created_at desc);
create index if not exists sale_payments_date_idx       on public.sale_payments (date desc);
create index if not exists client_debts_description_idx on public.client_debts (description);

-- 3. Statistiques
analyze;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
--  PARAMETRES › MON COMPTE (contenu de altech_production_update_mon_compte.sql)
-- ---------------------------------------------------------------------------
create or replace function public.update_my_account(
  p_name         text,
  p_username     text,
  p_email        text,
  p_old_password text default null,
  p_new_password text default null
) returns public.profiles
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text := lower(trim(coalesce(p_email, '')));
  v_username text := nullif(lower(trim(coalesce(p_username, ''))), '');
  v_name     text := trim(coalesce(p_name, ''));
  v_old      auth.users%rowtype;
  v_profile  public.profiles;
begin
  if v_uid is null then
    raise exception 'Session expirée : reconnectez-vous';
  end if;

  select * into v_old from auth.users where id = v_uid;
  if not found then
    raise exception 'Compte introuvable';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse e-mail invalide';
  end if;

  if exists (select 1 from auth.users where lower(email) = v_email and id <> v_uid)
     or exists (select 1 from public.profiles where lower(email) = v_email and id <> v_uid) then
    raise exception 'Cet e-mail est déjà utilisé par un autre compte';
  end if;

  if v_username is not null and exists (
       select 1 from public.profiles where lower(username) = v_username and id <> v_uid) then
    raise exception 'Ce nom d''utilisateur est déjà utilisé';
  end if;

  -- changement de mot de passe : l'ancien mot de passe est obligatoire
  if coalesce(p_new_password, '') <> '' then
    if length(p_new_password) < 6 then
      raise exception 'Le nouveau mot de passe doit contenir au moins 6 caractères';
    end if;
    if coalesce(p_old_password, '') = ''
       or v_old.encrypted_password is null
       or v_old.encrypted_password <> extensions.crypt(p_old_password, v_old.encrypted_password) then
      raise exception 'Ancien mot de passe incorrect';
    end if;
  end if;

  update auth.users
     set email              = v_email,
         email_confirmed_at = case when lower(v_old.email) = v_email
                                   then email_confirmed_at else now() end,
         email_change       = '',
         email_change_token_new = '',
         email_change_token_current = '',
         encrypted_password = case when coalesce(p_new_password, '') <> ''
                                   then extensions.crypt(p_new_password, extensions.gen_salt('bf'))
                                   else encrypted_password end,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('full_name', v_name,
                                                    'username', coalesce(v_username, split_part(v_email, '@', 1))),
         updated_at         = now()
   where id = v_uid;

  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb)
                         || jsonb_build_object('email', v_email, 'email_verified', true),
         updated_at    = now()
   where user_id = v_uid and provider = 'email';

  update public.profiles
     set full_name  = coalesce(nullif(v_name, ''), full_name),
         username   = coalesce(v_username, username),
         email      = v_email,
         updated_at = now()
   where id = v_uid
  returning * into v_profile;

  update public.workers
     set email    = v_email,
         username = coalesce(v_username, username)
   where user_id = v_uid;

  return v_profile;
end;
$$;

revoke execute on function public.update_my_account(text, text, text, text, text) from anon, public;
grant  execute on function public.update_my_account(text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
