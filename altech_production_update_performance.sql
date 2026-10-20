-- =============================================================================
--  ALTECH PRODUCTION — MISE A JOUR : PERFORMANCE DE LA BASE DE DONNEES
-- -----------------------------------------------------------------------------
--  A executer UNE fois dans Supabase › SQL Editor, APRES toutes les autres
--  mises a jour. Idempotent : peut etre relance sans risque. Ne modifie
--  AUCUNE donnee.
--
--  1. REGLES DE SECURITE (RLS) EVALUEES UNE SEULE FOIS PAR REQUETE
--     Chaque regle appelait has_perm() / is_admin() / auth.uid() POUR CHAQUE
--     LIGNE lue : sur 10 000 ventes, 10 000 lectures de la table profiles.
--     Entourees d'un « (select ...) », Postgres les calcule une seule fois
--     par requete. Le resultat (qui a le droit de voir quoi) est identique.
--
--  2. INDEX SUR TOUTES LES CLES ETRANGERES
--     Les jointures (vente -> client, ligne -> commande, ...) et les
--     suppressions en cascade parcouraient des tables entieres.
--
--  3. STATISTIQUES A JOUR (ANALYZE) pour que Postgres choisisse les index.
-- =============================================================================

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
