-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « NOM DES PRODUITS TOUJOURS A JOUR + TITRES PERSONNALISES DES IMPRESSIONS »
-- ----------------------------------------------------------------------------
--  A EXECUTER EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est IDEMPOTENT : il peut etre relance sans risque.
--
--  PREREQUIS — toutes les mises a jour precedentes, et en dernier :
--    · altech_production_update_acomptes_comptes_rendus.sql
--
--  LE BUG CORRIGE
--  --------------
--  Le nom d'un produit (fiche technique ou produit de stock) est RECOPIE dans
--  chaque ligne de commande, de livraison, de vente, d'achat, de production...
--  Renommer « BETON 380KG/M3 adjuvant » en « BETON 380KG/M3 » ne changeait
--  donc que la fiche : le compte rendu, le bon de livraison, l'historique et le
--  rapport general continuaient d'imprimer l'ANCIEN nom — et chaque nouvelle
--  livraison d'une commande deja passee le recopiait encore.
--
--   1. Un declencheur sur `fiche_technics` et un sur `products` repercutent
--      desormais tout changement de nom dans TOUTES les tables liees.
--   2. Un rattrapage aligne une fois pour toutes les lignes existantes sur le
--      nom actuel de leur fiche / produit.
--   3. Le recalcul des totaux d'un achat ne se declenche plus quand seul le
--      nom d'une ligne change (il ne reagit qu'aux quantites et aux prix).
--
--  NOUVEAUTE
--  ---------
--   4. Table `document_titles` : les titres personnalises choisis a
--      l'impression (compte rendu, bon de livraison, rapport general...),
--      partages par tous les postes.
-- ============================================================================


-- ============================================================================
-- 01. LES TOTAUX D'UN ACHAT NE BOUGENT PLUS QUAND SEUL UN NOM CHANGE
-- ============================================================================

drop trigger if exists trg_purchase_lines_totals on public.purchase_lines;
create trigger trg_purchase_lines_totals
  after insert or delete or update of purchase_id, quantity, purchase_price on public.purchase_lines
  for each row execute function public.trg_recalc_purchase_totals();


-- ============================================================================
-- 02. RENOMMER UNE FICHE TECHNIQUE
-- ----------------------------------------------------------------------------
--  Une ligne appartient a la fiche quand son `fiche_technic_id` la designe ;
--  les anciennes ventes du point de vente portaient l'identifiant de la fiche
--  dans `product_id` : elles sont reconnues aussi.
-- ============================================================================

create or replace function public.propagate_fiche_name(
  p_fiche_id uuid, p_old_name text, p_new_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_fiche_id is null or coalesce(trim(p_new_name), '') = '' then
    return;
  end if;

  -- lignes de commande
  update public.command_items
     set product_name = p_new_name
   where (fiche_technic_id = p_fiche_id or (fiche_technic_id is null and product_id = p_fiche_id))
     and product_name is distinct from p_new_name;

  -- lignes des bons de livraison et des annulations / augmentations
  update public.command_delivery_items di
     set product_name = p_new_name
    from public.command_items ci
   where ci.id = di.command_item_id
     and (ci.fiche_technic_id = p_fiche_id or (ci.fiche_technic_id is null and ci.product_id = p_fiche_id))
     and di.product_name is distinct from p_new_name;

  update public.command_adjustment_lines al
     set product_name = p_new_name
    from public.command_items ci
   where ci.id = al.command_item_id
     and (ci.fiche_technic_id = p_fiche_id or (ci.fiche_technic_id is null and ci.product_id = p_fiche_id))
     and al.product_name is distinct from p_new_name;

  -- lignes de vente (point de vente et factures des bons de livraison)
  update public.sale_lines
     set product_name = p_new_name
   where (fiche_technic_id = p_fiche_id or (fiche_technic_id is null and product_id = p_fiche_id))
     and product_name is distinct from p_new_name;

  -- la fiche utilisee comme ingredient d'une autre fiche / d'une production
  update public.fiche_technic_lines
     set product_name = p_new_name
   where product_id = p_fiche_id
     and source_type::text = 'fiche'
     and product_name is distinct from p_new_name;

  update public.production_used_products
     set product_name = p_new_name
   where product_id = p_fiche_id
     and source_type::text = 'fiche'
     and product_name is distinct from p_new_name;

  -- productions lancees depuis la fiche, puis leur article comptoir et ses
  -- destructions — seulement celles qui portaient encore l'ancien nom
  update public.comptoir_items c
     set product_name = p_new_name
    from public.productions pr
   where pr.id = c.production_id
     and pr.fiche_technic_id = p_fiche_id
     and c.product_name = p_old_name;

  update public.destructions d
     set product_name = p_new_name
    from public.comptoir_items c, public.productions pr
   where c.id = d.comptoir_id
     and pr.id = c.production_id
     and pr.fiche_technic_id = p_fiche_id
     and d.product_name = p_old_name;

  update public.productions
     set name = p_new_name
   where fiche_technic_id = p_fiche_id
     and name = p_old_name;
end;
$fn$;

create or replace function public.trg_fiche_technic_renamed()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.name is distinct from old.name then
    perform public.propagate_fiche_name(new.id, old.name, new.name);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_fiche_technics_rename on public.fiche_technics;
create trigger trg_fiche_technics_rename
  after update of name on public.fiche_technics
  for each row execute function public.trg_fiche_technic_renamed();


-- ============================================================================
-- 03. RENOMMER UN PRODUIT DE STOCK
-- ============================================================================

create or replace function public.propagate_product_name(
  p_product_id uuid, p_new_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_product_id is null or coalesce(trim(p_new_name), '') = '' then
    return;
  end if;

  update public.purchase_lines
     set product_name = p_new_name
   where product_id = p_product_id
     and product_name is distinct from p_new_name;

  update public.sale_lines
     set product_name = p_new_name
   where product_id = p_product_id
     and fiche_technic_id is null
     and product_name is distinct from p_new_name;

  update public.command_items
     set product_name = p_new_name
   where product_id = p_product_id
     and fiche_technic_id is null
     and product_name is distinct from p_new_name;

  update public.command_delivery_items di
     set product_name = p_new_name
    from public.command_items ci
   where ci.id = di.command_item_id
     and ci.product_id = p_product_id
     and ci.fiche_technic_id is null
     and di.product_name is distinct from p_new_name;

  update public.command_adjustment_lines al
     set product_name = p_new_name
    from public.command_items ci
   where ci.id = al.command_item_id
     and ci.product_id = p_product_id
     and ci.fiche_technic_id is null
     and al.product_name is distinct from p_new_name;

  update public.command_delivery_consumptions
     set product_name = p_new_name
   where product_id = p_product_id
     and product_name is distinct from p_new_name;

  update public.fiche_technic_lines
     set product_name = p_new_name
   where product_id = p_product_id
     and source_type::text = 'stock'
     and product_name is distinct from p_new_name;

  update public.production_used_products
     set product_name = p_new_name
   where product_id = p_product_id
     and source_type::text = 'stock'
     and product_name is distinct from p_new_name;
end;
$fn$;

create or replace function public.trg_product_renamed()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.name is distinct from old.name then
    perform public.propagate_product_name(new.id, new.name);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_products_rename on public.products;
create trigger trg_products_rename
  after update of name on public.products
  for each row execute function public.trg_product_renamed();


-- ============================================================================
-- 04. RATTRAPAGE — toutes les lignes existantes prennent le nom actuel
-- ============================================================================

-- 4.1 fiches techniques
update public.command_items ci
   set product_name = ft.name
  from public.fiche_technics ft
 where ft.id = coalesce(ci.fiche_technic_id, ci.product_id)
   and ci.product_name is distinct from ft.name;

update public.sale_lines sl
   set product_name = ft.name
  from public.fiche_technics ft
 where ft.id = coalesce(sl.fiche_technic_id, sl.product_id)
   and sl.product_name is distinct from ft.name;

update public.fiche_technic_lines l
   set product_name = ft.name
  from public.fiche_technics ft
 where ft.id = l.product_id
   and l.source_type::text = 'fiche'
   and l.product_name is distinct from ft.name;

update public.production_used_products u
   set product_name = ft.name
  from public.fiche_technics ft
 where ft.id = u.product_id
   and u.source_type::text = 'fiche'
   and u.product_name is distinct from ft.name;

-- 4.2 produits de stock
update public.purchase_lines pl
   set product_name = p.name
  from public.products p
 where p.id = pl.product_id
   and pl.product_name is distinct from p.name;

update public.sale_lines sl
   set product_name = p.name
  from public.products p
 where p.id = sl.product_id
   and sl.fiche_technic_id is null
   and sl.product_name is distinct from p.name;

update public.command_items ci
   set product_name = p.name
  from public.products p
 where p.id = ci.product_id
   and ci.fiche_technic_id is null
   and ci.product_name is distinct from p.name;

update public.command_delivery_consumptions c
   set product_name = p.name
  from public.products p
 where p.id = c.product_id
   and c.product_name is distinct from p.name;

update public.fiche_technic_lines l
   set product_name = p.name
  from public.products p
 where p.id = l.product_id
   and l.source_type::text = 'stock'
   and l.product_name is distinct from p.name;

update public.production_used_products u
   set product_name = p.name
  from public.products p
 where p.id = u.product_id
   and u.source_type::text = 'stock'
   and u.product_name is distinct from p.name;

-- 4.3 livraisons et annulations : le nom de leur ligne de commande
update public.command_delivery_items di
   set product_name = ci.product_name
  from public.command_items ci
 where ci.id = di.command_item_id
   and di.product_name is distinct from ci.product_name;

update public.command_adjustment_lines al
   set product_name = ci.product_name
  from public.command_items ci
 where ci.id = al.command_item_id
   and al.product_name is distinct from ci.product_name;


-- ============================================================================
-- 05. TITRES PERSONNALISES DES IMPRESSIONS
-- ----------------------------------------------------------------------------
--  `scope` regroupe les titres par famille de document :
--    statement (compte rendu), delivery (bon de livraison), report (rapport
--    general), list (listes / historiques). Un titre peut servir partout.
-- ============================================================================

create table if not exists public.document_titles (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  scope      text not null default 'statement',
  created_by text default public.current_username(),
  created_at timestamptz not null default now()
);

create unique index if not exists document_titles_scope_title_key
  on public.document_titles (scope, upper(title));

alter table public.document_titles enable row level security;

drop policy if exists document_titles_sel on public.document_titles;
drop policy if exists document_titles_ins on public.document_titles;
drop policy if exists document_titles_upd on public.document_titles;
drop policy if exists document_titles_del on public.document_titles;

create policy document_titles_sel on public.document_titles
  for select to authenticated using (true);
create policy document_titles_ins on public.document_titles
  for insert to authenticated with check (true);
create policy document_titles_upd on public.document_titles
  for update to authenticated using (true) with check (true);
create policy document_titles_del on public.document_titles
  for delete to authenticated using (true);

grant select, insert, update, delete on public.document_titles to authenticated;

comment on table public.document_titles is
  'Titres personnalises proposes a l''impression (compte rendu, bon de livraison, rapport general, listes).';

notify pgrst, 'reload schema';
