-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « Caisse -> Fiche technique : la production est REELLEMENT lancee et les
--    matieres premieres sont REELLEMENT deduites du stock »
-- ----------------------------------------------------------------------------
--  A executer EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est idempotent : il peut etre relance sans risque.
--
--  PROBLEME CORRIGE
--  ----------------
--  Quand le caissier vendait une FICHE TECHNIQUE depuis la caisse (sans passer
--  par « Lancer la production » de l'ecran Production) :
--    · la vente etait bien enregistree,
--    · MAIS aucune production n'apparaissait dans l'ecran Production,
--    · ET les quantites des matieres premieres n'etaient pas retirees du stock.
--
--  Trois causes, toutes traitees ici :
--    1. `create_sale_with_productions()` estampillait `origin = 'pos'` par un
--       UPDATE effectue APRES l'insertion. Si la colonne manquait (base pas a
--       jour), l'appel entier echouait et l'application basculait sur un
--       chemin de secours ou la production n'etait plus rattachee a la vente.
--    2. Quand la production n'etait pas lancee, la ligne de vente partait avec
--       l'identifiant de la FICHE TECHNIQUE dans `product_id`. `consume_stock()`
--       ne trouvait aucun produit portant cet identifiant et ne decrementait
--       donc rien — silencieusement.
--    3. Rien ne permettait de savoir, apres coup, qu'une ligne de vente venait
--       d'une fiche technique : impossible de rattraper les ventes deja
--       enregistrees.
--
--  CONTENU
--  -------
--    01. Tracabilite : colonnes sur `sale_lines` et `productions`
--    02. consume_stock()                  — deduction garantie ou erreur claire
--    03. create_production()              — `origin` / vente d'origine au INSERT
--    04. transfer_production_to_comptoir()— tolerance d'arrondi
--    05. create_sale()                    — une ligne « fiche » ne casse plus le stock
--    06. create_sale_with_productions()   — chaine complete et VERIFIEE
--    07. repair_pos_sale_productions()    — rattrapage d'une vente deja saisie
--    08. Vues de controle + reclassement des lignes existantes
--    09. Droits
--
--  REGLE METIER — VENTE D'UNE FICHE TECHNIQUE A LA CAISSE
--  ------------------------------------------------------
--    a) une PRODUCTION est creee (origin = 'pos', rattachee a la vente) ;
--    b) chaque matiere « stock » de la fiche est DEDUITE de `products`
--       (quantite actuelle de l'ecran Gestion de stock) et tracee dans
--       `stock_movements` ;
--    c) le lot produit passe au comptoir puis est immediatement vendu ;
--    d) la vente apparait dans l'historique des ventes et dans celui du client.
--  Une « ancienne vente » (is_historical) ne declenche rien de tout cela.
-- ============================================================================

begin;

-- ============================================================================
-- 01. TRACABILITE — colonnes manquantes
-- ----------------------------------------------------------------------------
--  `sale_lines.fiche_technic_id` est la piece maitresse : c'est elle qui dit
--  qu'une ligne de vente vient d'une fiche technique. Sans elle, impossible de
--  distinguer une ligne « matiere premiere » d'une ligne « fiche » et donc
--  impossible de rattraper les ventes deja enregistrees.
-- ============================================================================

alter table public.sale_lines
  add column if not exists fiche_technic_id uuid,
  add column if not exists production_id    uuid,
  add column if not exists line_key         text,
  add column if not exists base_price       numeric(14,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sale_lines_fiche_technic_id_fkey') then
    alter table public.sale_lines
      add constraint sale_lines_fiche_technic_id_fkey
      foreign key (fiche_technic_id) references public.fiche_technics(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sale_lines_production_id_fkey') then
    alter table public.sale_lines
      add constraint sale_lines_production_id_fkey
      foreign key (production_id) references public.productions(id) on delete set null;
  end if;
end $$;

create index if not exists sale_lines_fiche_idx      on public.sale_lines (fiche_technic_id);
create index if not exists sale_lines_production_idx on public.sale_lines (production_id);

comment on column public.sale_lines.fiche_technic_id is
  'Fiche technique vendue sur cette ligne (vente caisse) — la production associee consomme le stock';
comment on column public.sale_lines.production_id is
  'Production (lot) lancee pour honorer cette ligne de vente';
comment on column public.sale_lines.line_key is
  'Cle de la ligne du panier de la caisse — relie la ligne de vente a sa production';

-- rappel des colonnes de la mise a jour « POS / rapports » (au cas ou elle
-- n'aurait pas ete executee : ce script doit pouvoir tourner seul)
alter table public.productions
  add column if not exists origin         text default 'manual',
  add column if not exists sale_id        uuid,
  add column if not exists sale_reference text;

update public.productions set origin = 'manual' where origin is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'productions_origin_check') then
    alter table public.productions
      add constraint productions_origin_check check (origin in ('manual', 'pos'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'productions_sale_id_fkey') then
    alter table public.productions
      add constraint productions_sale_id_fkey
      foreign key (sale_id) references public.sales(id) on delete set null;
  end if;
end $$;

create index if not exists productions_origin_idx  on public.productions (origin);
create index if not exists productions_sale_id_idx on public.productions (sale_id);

-- rappel des colonnes des mises a jour « n° de bon » et « anciennes ventes /
-- TVA » : create_sale() les ecrit, ce script doit donc pouvoir tourner seul
alter table public.sales
  add column if not exists bon_number    text,
  add column if not exists is_historical boolean       not null default false,
  add column if not exists tva_enabled   boolean       not null default false,
  add column if not exists tva_rate      numeric(6,2)  not null default 0,
  add column if not exists tva_amount    numeric(14,2) not null default 0;

create index if not exists sales_bon_number_idx on public.sales (lower(bon_number));


-- ============================================================================
-- 02. consume_stock() — la deduction est garantie, ou une erreur est levee
-- ----------------------------------------------------------------------------
--  Recherche la matiere par identifiant, puis par NOM (rattrape une fiche dont
--  l'identifiant est perime), et refuse de continuer en silence.
--  Renvoie l'identifiant du produit REELLEMENT decremente.
-- ============================================================================

drop function if exists public.consume_stock(uuid, numeric, text, text, uuid);

create or replace function public.consume_stock(
  p_product_id   uuid,
  p_quantity     numeric,
  p_reason       text,
  p_ref_table    text default null,
  p_ref_id       uuid default null,
  p_product_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pid  uuid;
  v_left numeric;
begin
  if coalesce(p_quantity, 0) <= 0 then
    return null;
  end if;

  -- 1) par identifiant, uniquement s'il designe encore un produit du stock
  if p_product_id is not null then
    select id into v_pid from public.products where id = p_product_id;
  end if;

  -- 2) sinon par nom — rattrape les fiches dont l'identifiant est perime
  if v_pid is null and coalesce(btrim(p_product_name), '') <> '' then
    select id into v_pid
      from public.products
     where lower(btrim(name)) = lower(btrim(p_product_name))
     order by is_active desc, current_quantity desc, created_at asc
     limit 1;
  end if;

  if v_pid is null then
    raise exception
      'Matiere introuvable dans le stock : % — impossible de deduire la quantite (%).',
      coalesce(nullif(btrim(p_product_name), ''), p_product_id::text, 'produit inconnu'),
      p_reason;
  end if;

  update public.products
     set current_quantity = greatest(0, current_quantity - p_quantity),
         updated_at = now()
   where id = v_pid
  returning current_quantity into v_left;

  insert into public.stock_movements (product_id, quantity, reason, ref_table, ref_id, balance_after)
  values (v_pid, -p_quantity, p_reason, p_ref_table, p_ref_id, v_left);

  return v_pid;
end;
$fn$;


-- ============================================================================
-- 03. create_production() — l'origine est ecrite DES l'insertion
-- ----------------------------------------------------------------------------
--  Nouveautes du payload (toutes facultatives) :
--     "origin"         : 'manual' (defaut) ou 'pos'
--     "sale_id"        : vente qui declenche le lot
--     "sale_reference" : sa reference lisible
--  Ecrire l'origine au moment de l'INSERT supprime l'UPDATE de rattrapage qui
--  faisait echouer tout l'appel quand la colonne manquait.
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
  v_origin   text := lower(coalesce(nullif(btrim(p_payload ->> 'origin'), ''), 'manual'));
  v_lineid   uuid;
  v_used     uuid;
  v_qty      numeric;
  v_name     text;
  v_src      text;
begin
  if v_origin not in ('manual', 'pos') then
    v_origin := 'manual';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'used_products', '[]'::jsonb)) loop
    v_cost := v_cost + coalesce((v_line ->> 'line_cost')::numeric,
                coalesce((v_line ->> 'quantity_used')::numeric, 0)
              * coalesce((v_line ->> 'unit_cost')::numeric, 0));
  end loop;

  -- la categorie recue peut venir d'une fiche technique : elle est traduite en
  -- categorie de production, sinon la cle etrangere refuse l'insertion
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
                                  loss_value, origin, sale_id, sale_reference, created_by)
  values (coalesce(nullif(btrim(p_payload ->> 'name'), ''), 'Production'),
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
          v_origin,
          nullif(p_payload ->> 'sale_id', '')::uuid,
          nullif(btrim(coalesce(p_payload ->> 'sale_reference', '')), ''),
          public.current_username())
  returning * into v_prod;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'used_products', '[]'::jsonb)) loop
    v_qty  := coalesce((v_line ->> 'quantity_used')::numeric, 0);
    v_name := coalesce(nullif(btrim(v_line ->> 'product_name'), ''), 'Ingredient');
    v_src  := coalesce(nullif(btrim(v_line ->> 'source_type'), ''), 'stock');

    insert into public.production_used_products (production_id, product_id, product_name,
                                                 quantity_used, source_type, unit, unit_cost, line_cost)
    values (v_prod.id,
            nullif(v_line ->> 'product_id', '')::uuid,
            v_name,
            v_qty,
            coalesce(v_src::public.used_source_type, 'stock'),
            v_line ->> 'unit',
            coalesce((v_line ->> 'unit_cost')::numeric, 0),
            coalesce((v_line ->> 'line_cost')::numeric, 0))
    returning id into v_lineid;

    -- seules les matieres prises sur le STOCK sont decrementees ; une source
    -- 'fiche' est un semi-fini deja produit (son propre lot a deja consomme).
    if v_src = 'stock' and v_qty > 0 then
      v_used := public.consume_stock(
                  nullif(v_line ->> 'product_id', '')::uuid,
                  v_qty,
                  'production', 'productions', v_prod.id,
                  v_name);

      -- on garde l'identifiant du produit REELLEMENT decremente
      if v_used is not null then
        update public.production_used_products
           set product_id = v_used
         where id = v_lineid and product_id is distinct from v_used;
      end if;
    end if;
  end loop;

  perform public.log_activity('production', 'create', 'productions', v_prod.id, p_payload);
  return v_prod;
end;
$fn$;


-- ============================================================================
-- 04. transfer_production_to_comptoir() — tolerance d'arrondi
-- ----------------------------------------------------------------------------
--  `output_quantity` est stockee en numeric(14,3). Transferer « tout le lot »
--  depuis l'application pouvait depasser le plafond d'un millieme et faire
--  echouer toute la vente. La quantite est desormais bornee au reste.
-- ============================================================================

create or replace function public.transfer_production_to_comptoir(
  p_production_id uuid, p_quantity numeric
) returns public.comptoir_items
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prod public.productions;
  v_item public.comptoir_items;
  v_left numeric;
  v_qty  numeric;
begin
  select * into v_prod from public.productions where id = p_production_id;
  if v_prod.id is null then
    raise exception 'Production introuvable (%)', p_production_id;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantite invalide';
  end if;

  v_left := v_prod.output_quantity - v_prod.sent_to_comptoir;
  v_qty  := p_quantity;

  -- ecart d'arrondi (<= 1 millieme) : on borne au reste au lieu d'echouer
  if v_qty > v_left and v_qty - v_left <= 0.001 then
    v_qty := v_left;
  end if;

  if v_qty > v_left then
    raise exception 'La quantite depasse la quantite produite (disponible: %)', v_left;
  end if;

  update public.productions
     set sent_to_comptoir = sent_to_comptoir + v_qty, updated_at = now()
   where id = p_production_id;

  select * into v_item from public.comptoir_items where production_id = p_production_id limit 1;

  if v_item.id is not null then
    update public.comptoir_items
       set quantity = quantity + v_qty, updated_at = now()
     where id = v_item.id
    returning * into v_item;
  else
    insert into public.comptoir_items (production_id, product_name, description, quantity, unit_price,
                                       date, category_id, category_name, sell_by_unit, unit, created_by)
    values (v_prod.id, v_prod.name, v_prod.description, v_qty, v_prod.unit_price,
            current_date, v_prod.category_id, v_prod.category_name,
            v_prod.sell_by_unit, case when v_prod.sell_by_unit then v_prod.sell_unit end,
            public.current_username())
    returning * into v_item;
  end if;

  perform public.log_activity('production', 'transfer', 'comptoir_items', v_item.id,
                              jsonb_build_object('quantity', v_qty));
  return v_item;
end;
$fn$;


-- ============================================================================
-- 05. create_sale() — une ligne « fiche technique » ne casse plus le stock
-- ----------------------------------------------------------------------------
--  Ajouts par rapport a la version precedente (« ancienne vente » + TVA) :
--    · les lignes memorisent `fiche_technic_id`, `production_id` et `line_key` ;
--    · GARDE-FOU : un identifiant de FICHE TECHNIQUE arrive dans `product_id`
--      (ancien bug de la caisse) n'est plus traite comme une matiere premiere ;
--      il est reclasse en `fiche_technic_id` et ne declenche aucune deduction
--      de stock (c'est la production du lot qui consomme les matieres).
--    · `base_price` est ecrit explicitement.
-- ============================================================================

create or replace function public.create_sale(p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale     public.sales;
  v_ref      text;
  v_line     jsonb;
  v_total    numeric := 0;
  v_red      numeric := coalesce((p_payload ->> 'reduction')::numeric, 0);
  v_base     numeric;
  v_tva_on   boolean := coalesce((p_payload ->> 'tva_enabled')::boolean, false);
  v_tva_rate numeric := coalesce((p_payload ->> 'tva_rate')::numeric, 0);
  v_tva      numeric := 0;
  v_final    numeric;
  v_paid     numeric := coalesce((p_payload ->> 'paid_amount')::numeric, 0);
  v_rest     numeric;
  v_date     date    := coalesce((p_payload ->> 'date')::date, current_date);
  v_hist     boolean := coalesce((p_payload ->> 'is_historical')::boolean, false);
  v_status   public.sale_status;
  v_seq      int;
  v_pid      uuid;
  v_cid      uuid;
  v_fid      uuid;
  v_prid     uuid;
  v_qty      numeric;
  v_bon      text := nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '');
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.sales;
  v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.sales where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'VNT-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_line ->> 'quantity')::numeric, 0)
                       * coalesce((v_line ->> 'selling_price')::numeric, 0);
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  -- ---- TVA : base HT -> montant -> net TTC -------------------------------
  if not v_tva_on then
    v_tva_rate := 0;
  end if;
  v_red   := least(greatest(0, v_red), v_total);
  v_base  := greatest(0, v_total - v_red);
  v_tva   := case when v_tva_on then round(v_base * v_tva_rate / 100, 2) else 0 end;
  v_final := v_base + v_tva;

  v_rest   := greatest(0, v_final - v_paid);
  v_status := case when v_rest = 0 then 'paid'::public.sale_status else 'debt'::public.sale_status end;

  -- la vente est ecrite AVANT ses lignes et son paiement : les declencheurs
  -- de caisse peuvent donc lire `is_historical`.
  insert into public.sales (reference, client_id, date, total_amount, reduction, final_amount,
                            paid_amount, rest_amount, status, note, bon_number,
                            is_historical, tva_enabled, tva_rate, tva_amount, created_by)
  values (v_ref, nullif(p_payload ->> 'client_id', '')::uuid, v_date,
          v_total, v_red, v_final, v_paid, v_rest, v_status,
          p_payload ->> 'note', v_bon,
          v_hist, v_tva_on, v_tva_rate, v_tva, public.current_username())
  returning * into v_sale;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_pid  := nullif(v_line ->> 'product_id', '')::uuid;
    v_cid  := nullif(v_line ->> 'comptoir_id', '')::uuid;
    v_fid  := nullif(v_line ->> 'fiche_technic_id', '')::uuid;
    v_prid := nullif(v_line ->> 'production_id', '')::uuid;
    v_qty  := coalesce((v_line ->> 'quantity')::numeric, 0);

    -- GARDE-FOU : `product_id` qui n'est pas un produit du stock mais une
    -- fiche technique -> on le reclasse. Sans cela la vente tenterait de
    -- deduire une « matiere » inexistante et ne deduirait donc RIEN.
    if v_pid is not null
       and not exists (select 1 from public.products where id = v_pid)
       and exists (select 1 from public.fiche_technics where id = v_pid) then
      v_fid := coalesce(v_fid, v_pid);
      v_pid := null;
    end if;

    insert into public.sale_lines (sale_id, product_id, comptoir_id, fiche_technic_id, production_id,
                                   line_key, product_name, quantity, selling_price, base_price,
                                   sell_by_unit, unit)
    values (v_sale.id, v_pid, v_cid, v_fid, v_prid,
            nullif(btrim(coalesce(v_line ->> 'line_key', '')), ''),
            coalesce(nullif(btrim(v_line ->> 'product_name'), ''), 'Produit'), v_qty,
            coalesce((v_line ->> 'selling_price')::numeric, 0),
            nullif(v_line ->> 'base_price', '')::numeric,
            coalesce((v_line ->> 'sell_by_unit')::boolean, false),
            v_line ->> 'unit');

    -- Decrement comptoir / stock — SAUTE pour une ancienne vente : la
    -- marchandise est sortie du magasin dans le passe, hors du logiciel.
    if not v_hist then
      if v_cid is not null then
        update public.comptoir_items
           set quantity = greatest(0, quantity - v_qty), updated_at = now()
         where id = v_cid;
      elsif v_pid is not null then
        perform public.consume_stock(v_pid, v_qty, 'sale', 'sales', v_sale.id,
                                     v_line ->> 'product_name');
      end if;
      -- une ligne « fiche technique » sans article de comptoir ne consomme
      -- rien ici : ce sont les matieres de SA production qui sont deduites.
    end if;
  end loop;

  if v_paid > 0 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (v_sale.id, v_date, v_paid,
            case when v_hist then 'Paiement ancienne vente' else 'Paiement vente' end);
  end if;

  -- le reste impaye devient une dette client suivie (y compris en retroactif :
  -- c'est justement ce qui permet de reconstituer l'ardoise d'un client)
  if v_rest > 0 and v_sale.client_id is not null then
    insert into public.client_debts (client_id, client_name, client_phone, total_debt, rest_amount,
                                     date, description, created_by)
    select v_sale.client_id, c.name, c.phone, v_rest, v_rest, v_date,
           'Reste vente ' || v_ref, public.current_username()
      from public.clients c where c.id = v_sale.client_id;
  end if;

  perform public.log_activity('pos', 'create', 'sales', v_sale.id, p_payload);
  return v_sale;
end;
$fn$;


-- ============================================================================
-- 06. create_sale_with_productions() — chaine complete et VERIFIEE
-- ----------------------------------------------------------------------------
--  Point d'entree de la caisse des qu'une FICHE TECHNIQUE est au panier.
--  Pour CHAQUE ligne « fiche technique » :
--    a) create_production()               -> le lot est cree (origin = 'pos')
--                                            ET les matieres sont deduites du
--                                            stock (gestion de stock a jour)
--    b) transfer_production_to_comptoir() -> le lot passe au comptoir
--    c) la ligne de vente recoit cet article de comptoir
--  Puis create_sale() ecrit la vente (qui vide l'article du comptoir), et les
--  productions sont rattachees a la vente dans les DEUX sens.
--
--  VERIFICATION FINALE : si une production demandee n'a pas ete creee ou n'a
--  pas ete rattachee, la transaction ECHOUE. Plus jamais de vente « fantome »
--  sans production et sans deduction de stock.
-- ============================================================================

create or replace function public.create_sale_with_productions(p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prod_line jsonb;
  v_prod      public.productions;
  v_item      public.comptoir_items;
  v_sale      public.sales;
  v_map       jsonb := '{}'::jsonb;   -- line_key -> { comptoir_id, production_id, fiche_technic_id }
  v_out       jsonb := '[]'::jsonb;
  v_line      jsonb;
  v_key       text;
  v_qty       numeric;
  v_date      date    := coalesce((p_payload ->> 'date')::date, current_date);
  v_hist      boolean := coalesce((p_payload ->> 'is_historical')::boolean, false);
  v_asked     int     := jsonb_array_length(coalesce(p_payload -> 'productions', '[]'::jsonb));
  v_made      int;
begin
  -- Une ancienne vente ne lance jamais de production : elle consommerait le
  -- stock d'aujourd'hui pour une marchandise sortie il y a des mois.
  if v_hist then
    v_asked := 0;
  end if;

  -- a/b) une production par ligne « fiche technique » du panier
  if not v_hist then
    for v_prod_line in
      select * from jsonb_array_elements(coalesce(p_payload -> 'productions', '[]'::jsonb))
    loop
      v_qty := coalesce((v_prod_line ->> 'output_quantity')::numeric, 0);
      if v_qty <= 0 then
        raise exception 'Quantite de production invalide pour %',
          coalesce(v_prod_line ->> 'name', 'la production');
      end if;

      v_prod := public.create_production(
        jsonb_build_object(
          'name',             coalesce(v_prod_line ->> 'name', 'Production'),
          'description',      coalesce(v_prod_line ->> 'description', ''),
          'date',             to_char(v_date, 'YYYY-MM-DD'),
          'hour',             coalesce(v_prod_line ->> 'hour', to_char(now(), 'HH24:MI')),
          'category_id',      v_prod_line ->> 'category_id',
          'category_name',    v_prod_line ->> 'category_name',
          'fiche_technic_id', v_prod_line ->> 'fiche_technic_id',
          'output_quantity',  v_qty,
          'unit_price',       coalesce((v_prod_line ->> 'unit_price')::numeric, 0),
          'sell_by_unit',     coalesce((v_prod_line ->> 'sell_by_unit')::boolean, false),
          'sell_unit',        v_prod_line ->> 'sell_unit',
          'origin',           'pos',
          'used_products',    coalesce(v_prod_line -> 'used_products', '[]'::jsonb)
        )
      );

      -- output_quantity est stockee en numeric(14,3) : on transfere la valeur
      -- reellement enregistree pour ne jamais depasser le lot produit.
      v_item := public.transfer_production_to_comptoir(v_prod.id, v_prod.output_quantity);

      -- jsonb_build_object refuse une cle NULL : on retombe sur l'identifiant
      -- du lot, qui est toujours renseigne.
      v_key := coalesce(v_prod_line ->> 'line_key',
                        v_prod_line ->> 'fiche_technic_id',
                        v_prod.id::text);
      v_map := v_map || jsonb_build_object(
        v_key, jsonb_build_object(
          'comptoir_id',      v_item.id,
          'production_id',    v_prod.id,
          'fiche_technic_id', v_prod.fiche_technic_id
        )
      );
    end loop;
  end if;

  -- c) les lignes de vente recoivent l'article de comptoir qui vient d'etre cree
  for v_line in
    select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb))
  loop
    v_key := v_line ->> 'line_key';
    if v_key is not null and v_map ? v_key then
      v_line := v_line || jsonb_build_object(
        'comptoir_id',      v_map -> v_key ->> 'comptoir_id',
        'production_id',    v_map -> v_key ->> 'production_id',
        'fiche_technic_id', coalesce(v_map -> v_key ->> 'fiche_technic_id',
                                     v_line ->> 'fiche_technic_id'),
        'product_id',       null::text
      );
    elsif v_key is not null then
      -- ligne « fiche » sans lot (ancienne vente) : surtout pas de product_id,
      -- sinon la vente essaierait de deduire une matiere inexistante.
      v_line := v_line || jsonb_build_object(
        'fiche_technic_id', coalesce(v_line ->> 'fiche_technic_id', v_line ->> 'product_id'),
        'product_id',       null::text
      );
    end if;
    v_out := v_out || jsonb_build_array(v_line);
  end loop;

  v_sale := public.create_sale(
    jsonb_build_object(
      'client_id',     p_payload ->> 'client_id',
      'date',          to_char(v_date, 'YYYY-MM-DD'),
      'reduction',     coalesce((p_payload ->> 'reduction')::numeric, 0),
      'total_amount',  (p_payload ->> 'total_amount')::numeric,
      'paid_amount',   coalesce((p_payload ->> 'paid_amount')::numeric, 0),
      'note',          p_payload ->> 'note',
      'bon_number',    p_payload ->> 'bon_number',
      'is_historical', v_hist,
      'tva_enabled',   coalesce((p_payload ->> 'tva_enabled')::boolean, false),
      'tva_rate',      coalesce((p_payload ->> 'tva_rate')::numeric, 0),
      'products',      v_out
    )
  );

  -- rattache les productions creees a la vente (affichage dans /production).
  -- On parcourt la CARTE des lots reellement crees, pas le payload : la cle
  -- reste ainsi coherente meme si la caisse n'a pas envoye de `line_key`.
  for v_line in select value from jsonb_each(v_map) loop
    update public.productions
       set origin         = 'pos',
           sale_id        = v_sale.id,
           sale_reference = v_sale.reference,
           updated_at     = now()
     where id = (v_line ->> 'production_id')::uuid;
  end loop;

  -- ---- VERIFICATION : autant de lots crees que demandes -------------------
  select count(*) into v_made
    from public.productions
   where sale_id = v_sale.id and origin = 'pos';

  if v_made <> v_asked then
    raise exception
      'Incoherence caisse/production : % production(s) demandee(s), % creee(s) pour la vente %.',
      v_asked, v_made, v_sale.reference;
  end if;

  perform public.log_activity('pos', 'create', 'sales', v_sale.id, p_payload);
  return v_sale;
end;
$fn$;


-- ============================================================================
-- 07. repair_pos_sale_productions() — rattrapage d'une vente deja enregistree
-- ----------------------------------------------------------------------------
--  Filet de securite appele par la caisse quand, apres l'enregistrement, elle
--  constate qu'aucune production n'a ete rattachee a la vente (base ancienne,
--  vente saisie avant cette mise a jour, incident reseau...).
--
--  Pour chaque production manquante :
--    · le lot est cree (origin = 'pos', rattache a la vente)  -> ecran Production
--    · ses matieres sont deduites du stock                    -> gestion de stock
--    · le lot passe au comptoir puis la quantite vendue en est retiree
--      (la marchandise est deja partie avec la vente)
--    · la ligne de vente est reliee au lot
--
--  Payload : { "sale_id": uuid, "productions": [ ... meme format que la caisse ] }
--  Renvoie le nombre de productions effectivement creees.
--  Idempotent : une production deja rattachee a cette vente n'est jamais
--  recreee, donc le stock ne peut pas etre deduit deux fois.
-- ============================================================================

create or replace function public.repair_pos_sale_productions(p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale      public.sales;
  v_prod_line jsonb;
  v_prod      public.productions;
  v_item      public.comptoir_items;
  v_sale_id   uuid := nullif(p_payload ->> 'sale_id', '')::uuid;
  v_key       text;
  v_qty       numeric;
  v_sold      numeric;
  v_made      int := 0;
begin
  select * into v_sale from public.sales where id = v_sale_id;
  if v_sale.id is null then
    raise exception 'Vente introuvable (%)', v_sale_id;
  end if;
  if coalesce(v_sale.is_historical, false) then
    -- une ancienne vente ne doit jamais consommer le stock d'aujourd'hui
    return 0;
  end if;

  for v_prod_line in
    select * from jsonb_array_elements(coalesce(p_payload -> 'productions', '[]'::jsonb))
  loop
    -- '' est une sentinelle : create_sale() n'enregistre jamais une line_key
    -- vide, donc `is not distinct from ''` ne peut pas matcher par accident.
    v_key := coalesce(v_prod_line ->> 'line_key', v_prod_line ->> 'fiche_technic_id', '');
    v_qty := coalesce((v_prod_line ->> 'output_quantity')::numeric, 0);
    if v_qty <= 0 then
      continue;
    end if;

    -- deja rattachee ? on ne refait rien (idempotence) — meme predicat que la
    -- mise a jour finale, sinon un second passage creerait un lot en double
    -- et deduirait le stock deux fois.
    if exists (
      select 1 from public.sale_lines sl
       where sl.sale_id = v_sale.id
         and sl.production_id is not null
         and (sl.line_key is not distinct from v_key
              or (sl.line_key is null
                  and lower(btrim(sl.product_name))
                      = lower(btrim(coalesce(v_prod_line ->> 'name', '')))))
    ) then
      continue;
    end if;

    v_prod := public.create_production(
      jsonb_build_object(
        'name',             coalesce(v_prod_line ->> 'name', 'Production'),
        'description',      coalesce(v_prod_line ->> 'description', ''),
        'date',             to_char(v_sale.date, 'YYYY-MM-DD'),
        'hour',             coalesce(v_prod_line ->> 'hour', to_char(now(), 'HH24:MI')),
        'category_id',      v_prod_line ->> 'category_id',
        'category_name',    v_prod_line ->> 'category_name',
        'fiche_technic_id', v_prod_line ->> 'fiche_technic_id',
        'output_quantity',  v_qty,
        'unit_price',       coalesce((v_prod_line ->> 'unit_price')::numeric, 0),
        'sell_by_unit',     coalesce((v_prod_line ->> 'sell_by_unit')::boolean, false),
        'sell_unit',        v_prod_line ->> 'sell_unit',
        'origin',           'pos',
        'sale_id',          v_sale.id::text,
        'sale_reference',   v_sale.reference,
        'used_products',    coalesce(v_prod_line -> 'used_products', '[]'::jsonb)
      )
    );

    v_item := public.transfer_production_to_comptoir(v_prod.id, v_prod.output_quantity);

    -- la marchandise est deja partie avec la vente : on retire du comptoir la
    -- quantite reellement vendue sur cette ligne
    select coalesce(sum(sl.quantity), 0) into v_sold
      from public.sale_lines sl
     where sl.sale_id = v_sale.id
       and (sl.line_key is not distinct from v_key
            or (sl.line_key is null and lower(btrim(sl.product_name)) = lower(btrim(v_prod.name))));

    if v_sold > 0 then
      update public.comptoir_items
         set quantity = greatest(0, quantity - v_sold), updated_at = now()
       where id = v_item.id;
    end if;

    -- la ligne de vente pointe desormais vers son lot
    update public.sale_lines sl
       set production_id    = v_prod.id,
           fiche_technic_id = coalesce(sl.fiche_technic_id, v_prod.fiche_technic_id),
           comptoir_id      = coalesce(sl.comptoir_id, v_item.id),
           product_id       = case
                                when sl.product_id is not null
                                 and not exists (select 1 from public.products p where p.id = sl.product_id)
                                then null else sl.product_id end
     where sl.sale_id = v_sale.id
       and sl.production_id is null
       and (sl.line_key is not distinct from v_key
            or (sl.line_key is null and lower(btrim(sl.product_name)) = lower(btrim(v_prod.name))));

    v_made := v_made + 1;
  end loop;

  if v_made > 0 then
    perform public.log_activity('pos', 'repair', 'sales', v_sale.id, p_payload);
  end if;
  return v_made;
end;
$fn$;


-- ============================================================================
-- 08. VUES DE CONTROLE
-- ============================================================================

-- Productions lancees par la caisse, avec leur vente et leur cout
drop view if exists public.v_pos_productions;
create view public.v_pos_productions as
select p.id,
       p.date,
       p.hour,
       p.name,
       p.category_name,
       p.origin,
       p.sale_id,
       p.sale_reference,
       s.client_id,
       c.name as client_name,
       p.output_quantity,
       p.unit_price,
       p.total_value,
       p.total_cost,
       p.total_value - p.total_cost as gains,
       p.created_by,
       p.created_at
  from public.productions p
  left join public.sales   s on s.id = p.sale_id
  left join public.clients c on c.id = s.client_id
 where p.origin = 'pos'
 order by p.date desc, p.created_at desc;

alter view public.v_pos_productions set (security_invoker = true);

-- Matieres reellement consommees par les productions de la caisse
drop view if exists public.v_pos_production_matieres;
create view public.v_pos_production_matieres as
select p.id            as production_id,
       p.date,
       p.name          as production_name,
       p.sale_reference,
       u.product_id,
       u.product_name,
       u.source_type,
       u.quantity_used,
       u.unit,
       u.unit_cost,
       u.line_cost,
       pr.current_quantity as stock_restant
  from public.productions p
  join public.production_used_products u on u.production_id = p.id
  left join public.products pr on pr.id = u.product_id
 where p.origin = 'pos'
 order by p.date desc;

alter view public.v_pos_production_matieres set (security_invoker = true);

-- Ventes de fiche technique dont le lot n'a PAS ete cree (a rattraper)
drop view if exists public.v_ventes_fiche_sans_production;
create view public.v_ventes_fiche_sans_production as
select s.id            as sale_id,
       s.reference,
       s.date,
       s.client_id,
       c.name          as client_name,
       sl.id           as sale_line_id,
       sl.product_name,
       sl.quantity,
       sl.selling_price,
       sl.fiche_technic_id
  from public.sale_lines sl
  join public.sales   s on s.id = sl.sale_id
  left join public.clients c on c.id = s.client_id
 where coalesce(s.is_historical, false) = false
   and sl.production_id is null
   and (
        sl.fiche_technic_id is not null
        or (sl.product_id is not null
            and not exists (select 1 from public.products p where p.id = sl.product_id)
            and exists (select 1 from public.fiche_technics f where f.id = sl.product_id))
       );

alter view public.v_ventes_fiche_sans_production set (security_invoker = true);


-- ============================================================================
-- 08 bis. RECLASSEMENT DES LIGNES DEJA ENREGISTREES
-- ----------------------------------------------------------------------------
--  Les ventes passees ou l'identifiant de la fiche technique avait atterri
--  dans `product_id` sont corrigees : la ligne devient explicitement une ligne
--  « fiche technique ». Aucun stock n'est touche ici — c'est
--  `repair_pos_sale_productions()` qui lance les lots manquants.
-- ============================================================================

update public.sale_lines sl
   set fiche_technic_id = sl.product_id,
       product_id       = null
 where sl.fiche_technic_id is null
   and sl.product_id is not null
   and not exists (select 1 from public.products p where p.id = sl.product_id)
   and exists (select 1 from public.fiche_technics f where f.id = sl.product_id);

-- Les productions deja rattachees a une vente sont marquees comme venant de
-- la caisse (certaines bases ont pu garder origin = 'manual').
update public.productions
   set origin = 'pos'
 where sale_id is not null and coalesce(origin, 'manual') <> 'pos';


-- ============================================================================
-- 09. DROITS
-- ============================================================================

grant execute on function public.consume_stock(uuid, numeric, text, text, uuid, text)
  to authenticated, service_role;
grant execute on function public.create_production(jsonb)             to authenticated, service_role;
grant execute on function public.transfer_production_to_comptoir(uuid, numeric)
  to authenticated, service_role;
grant execute on function public.create_sale(jsonb)                   to authenticated, service_role;
grant execute on function public.create_sale_with_productions(jsonb)  to authenticated, service_role;
grant execute on function public.repair_pos_sale_productions(jsonb)   to authenticated, service_role;

grant select on public.v_pos_productions              to authenticated, service_role;
grant select on public.v_pos_production_matieres      to authenticated, service_role;
grant select on public.v_ventes_fiche_sans_production to authenticated, service_role;

commit;

-- ============================================================================
--  VERIFICATION APRES EXECUTION
-- ----------------------------------------------------------------------------
--  1) Les ventes de fiche technique sans lot (doit rester vide) :
--       select * from public.v_ventes_fiche_sans_production;
--
--  2) Les productions lancees par la caisse :
--       select * from public.v_pos_productions order by created_at desc limit 20;
--
--  3) Les matieres deduites par ces productions :
--       select * from public.v_pos_production_matieres order by date desc limit 50;
--
--  4) Les mouvements de stock correspondants :
--       select * from public.stock_movements
--        where reason = 'production' order by created_at desc limit 50;
-- ============================================================================
