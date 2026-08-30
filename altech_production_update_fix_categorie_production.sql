-- ============================================================================
--  ALTECH PRODUCTION — CIMENT BLIDA
--  CORRECTIF — « Enregistrement impossible — un élément lié est introuvable »
--              (violates foreign key constraint "productions_category_id_fkey")
-- ----------------------------------------------------------------------------
--  À exécuter APRÈS :
--    1. altech_production_supabase.sql
--    2. altech_production_update_2026.sql
--    3. altech_production_update_achat_bon_matricule.sql
--    4. altech_production_update_pos_production_rapports.sql
--  (Supabase Studio > SQL Editor > coller TOUT le fichier > Run)
--  Le script est idempotent : il peut être relancé sans risque.
-- ----------------------------------------------------------------------------
--  LE PROBLÈME
--   `fiche_technics.category_id` pointe sur `fiche_categories`
--   `productions.category_id`    pointe sur `production_categories`
--   Le point de vente (et l'écran Production quand la production part d'une
--   fiche technique) recopiait la catégorie de la fiche dans la production :
--   l'identifiant n'existe pas dans `production_categories`, la clé étrangère
--   `productions_category_id_fkey` refuse l'insertion et la vente échoue (409).
--
--  LA CORRECTION
--   `resolve_production_category()` traduit l'identifiant reçu en catégorie de
--   production : la même par son nom si elle existe, sinon elle est créée à la
--   volée ; à défaut seul le libellé est conservé. `create_production()`
--   l'appelle systématiquement, donc les deux écrans (point de vente et
--   Production) sont réparés en une seule fois.
-- ----------------------------------------------------------------------------
--  CONTENU
--   01. Fonction resolve_production_category()
--   02. create_production() — catégorie traduite avant l'insertion
--   03. Rattrapage des productions déjà enregistrées sans catégorie liée
-- ============================================================================


-- ============================================================================
-- 01. RESOLVE_PRODUCTION_CATEGORY() — traduit une catégorie « étrangère »
-- ----------------------------------------------------------------------------
--  Renvoie toujours un id valide de `production_categories`, ou NULL quand
--  aucun nom exploitable n'est fourni (la production garde alors son libellé).
-- ============================================================================

create or replace function public.resolve_production_category(
  p_category_id uuid, p_category_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id   uuid;
  v_name text;
begin
  -- 1) l'id est déjà une catégorie de production : rien à faire
  if p_category_id is not null then
    select id into v_id from public.production_categories where id = p_category_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- 2) sinon on cherche un nom : celui transmis, sinon celui de la catégorie
  --    réellement désignée par l'id (fiche technique, puis stock)
  v_name := nullif(btrim(coalesce(p_category_name, '')), '');
  if v_name is null and p_category_id is not null then
    select name into v_name from public.fiche_categories where id = p_category_id;
  end if;
  if v_name is null and p_category_id is not null then
    select name into v_name from public.categories where id = p_category_id;
  end if;
  if v_name is null then
    return null;
  end if;

  -- 3) même nom côté production, créée à la volée si elle n'existe pas encore
  select id into v_id
    from public.production_categories
   where lower(btrim(name)) = lower(v_name)
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.production_categories (name)
  values (v_name)
  on conflict (name) do update set name = excluded.name
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.resolve_production_category(uuid, text) is
  'Traduit une categorie venant d un autre module (fiche technique, stock) en categorie de production valide';

grant execute on function public.resolve_production_category(uuid, text) to authenticated, service_role;


-- ============================================================================
-- 02. CREATE_PRODUCTION() — la catégorie est traduite avant l'insertion
-- ----------------------------------------------------------------------------
--  Identique à la version d'origine, aux lignes `v_cat` / `v_cat_name` près.
--  Corrige d'un coup « Lancer la production » (écran Production à partir d'une
--  fiche technique) et le point de vente, dont create_sale_with_productions()
--  appelle cette fonction pour chaque ligne « fiche technique » du panier.
-- ============================================================================

create or replace function public.create_production(p_payload jsonb)
returns public.productions
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prod     public.productions;
  v_line     jsonb;
  v_cost     numeric := 0;
  v_out      numeric := coalesce((p_payload ->> 'output_quantity')::numeric, 0);
  v_price    numeric := coalesce((p_payload ->> 'unit_price')::numeric, 0);
  v_cat      uuid;
  v_cat_name text;
begin
  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'used_products', '[]'::jsonb)) loop
    v_cost := v_cost + coalesce((v_line ->> 'line_cost')::numeric,
                coalesce((v_line ->> 'quantity_used')::numeric, 0) * coalesce((v_line ->> 'unit_cost')::numeric, 0));
  end loop;

  -- la categorie recue peut venir d une fiche technique : elle est traduite en
  -- categorie de production, sinon la cle etrangere refuse l insertion
  v_cat := public.resolve_production_category(
             nullif(p_payload ->> 'category_id', '')::uuid,
             p_payload ->> 'category_name');
  v_cat_name := coalesce(
    nullif(btrim(coalesce(p_payload ->> 'category_name', '')), ''),
    (select name from public.production_categories where id = v_cat));

  insert into public.productions (name, description, date, hour, category_id, category_name,
                                  fiche_technic_id, total_cost, output_quantity, unit_price,
                                  total_value, sell_by_unit, sell_unit, sent_to_comptoir,
                                  has_loss, expected_quantity, loss_quantity, loss_description,
                                  loss_value, created_by)
  values (coalesce(p_payload ->> 'name', 'Production'),
          coalesce(p_payload ->> 'description', ''),
          coalesce((p_payload ->> 'date')::date, current_date),
          coalesce(p_payload ->> 'hour', to_char(now(), 'HH24:MI')),
          v_cat,
          v_cat_name,
          nullif(p_payload ->> 'fiche_technic_id', '')::uuid,
          v_cost, v_out, v_price, v_out * v_price,
          coalesce((p_payload ->> 'sell_by_unit')::boolean, false),
          p_payload ->> 'sell_unit',
          0,
          coalesce((p_payload ->> 'has_loss')::boolean, false),
          nullif(p_payload ->> 'expected_quantity', '')::numeric,
          coalesce((p_payload ->> 'loss_quantity')::numeric, 0),
          p_payload ->> 'loss_description',
          coalesce((p_payload ->> 'loss_value')::numeric, 0),
          public.current_username())
  returning * into v_prod;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'used_products', '[]'::jsonb)) loop
    insert into public.production_used_products (production_id, product_id, product_name,
                                                 quantity_used, source_type, unit, unit_cost, line_cost)
    values (v_prod.id,
            nullif(v_line ->> 'product_id', '')::uuid,
            coalesce(v_line ->> 'product_name', 'Ingrédient'),
            coalesce((v_line ->> 'quantity_used')::numeric, 0),
            coalesce((v_line ->> 'source_type')::public.used_source_type, 'stock'),
            v_line ->> 'unit',
            coalesce((v_line ->> 'unit_cost')::numeric, 0),
            coalesce((v_line ->> 'line_cost')::numeric, 0));

    -- seuls les ingredients pris sur le stock sont decrementes
    -- (une source 'fiche' est un semi-fini deja produit)
    if coalesce(v_line ->> 'source_type', 'stock') = 'stock'
       and nullif(v_line ->> 'product_id', '') is not null then
      perform public.consume_stock((v_line ->> 'product_id')::uuid,
                                   coalesce((v_line ->> 'quantity_used')::numeric, 0),
                                   'production', 'productions', v_prod.id);
    end if;
  end loop;

  perform public.log_activity('production', 'create', 'productions', v_prod.id, p_payload);
  return v_prod;
end;
$fn$;

grant execute on function public.create_production(jsonb) to authenticated, service_role;


-- ============================================================================
-- 03. RATTRAPAGE — productions enregistrées avec un libellé mais sans catégorie
-- ----------------------------------------------------------------------------
--  Les productions déjà saisies dont le nom de catégorie correspond à une
--  catégorie de production existante retrouvent leur lien (filtres, rapports).
-- ============================================================================

update public.productions p
   set category_id = pc.id,
       updated_at  = now()
  from public.production_categories pc
 where p.category_id is null
   and p.category_name is not null
   and lower(btrim(p.category_name)) = lower(btrim(pc.name));

-- Les articles de comptoir issus de ces productions suivent le même lien
update public.comptoir_items ci
   set category_id = p.category_id,
       updated_at  = now()
  from public.productions p
 where ci.production_id = p.id
   and p.category_id is not null
   and ci.category_id is distinct from p.category_id;


-- ============================================================================
--  FIN DU CORRECTIF
-- ============================================================================
