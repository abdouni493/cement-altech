-- ============================================================================
--  ALTECH PRODUCTION — CIMENT BLIDA
--  MISE À JOUR — POS : commandes depuis le point de vente
--                      + n° de bon de commande manuel (ventes & commandes)
--                      + date de création éditable des commandes
-- ----------------------------------------------------------------------------
--  À exécuter APRÈS `altech_production_supabase.sql`
--  (Supabase Studio > SQL Editor > coller TOUT le fichier > Run)
--  Le script est idempotent : il peut être relancé sans risque.
-- ----------------------------------------------------------------------------
--  CONTENU
--   01. Colonne bon_number sur public.sales et public.commands
--   02. RPC create_command()  : bon_number + date de création + acompte daté
--   03. RPC create_sale()      : bon_number
--   04. RPC create_sale_with_productions() : transmet le bon_number
-- ============================================================================


-- ============================================================================
-- 01. NOUVELLE COLONNE « N° BON DE COMMANDE »
-- ----------------------------------------------------------------------------
--  Numéro de bon de commande saisi manuellement par l'opérateur (indépendant
--  de la référence automatique VNT-/CMD-). Sert de repère client et permet la
--  recherche dans /sales et /clients/commands.
-- ============================================================================

alter table public.sales
  add column if not exists bon_number text;

alter table public.commands
  add column if not exists bon_number text;

comment on column public.sales.bon_number    is 'N° bon de commande saisi manuellement (repère client)';
comment on column public.commands.bon_number is 'N° bon de commande saisi manuellement (repère client)';

-- Recherche rapide par n° de bon
create index if not exists sales_bon_number_idx    on public.sales    (lower(bon_number));
create index if not exists commands_bon_number_idx on public.commands (lower(bon_number));


-- ============================================================================
-- 02. RPC create_command() — bon de commande manuel + date de création éditable
-- ----------------------------------------------------------------------------
--  Bouton « Enregistrer la commande » (Commandes clients ET point de vente).
--   - `bon_number` : numéro saisi à la main (facultatif)
--   - `created_at` : date/heure de création choisie par l'opérateur (facultatif)
--     → la référence CMD-AAAA-NNN et la date de l'acompte suivent cette date.
-- ============================================================================

create or replace function public.create_command(p_payload jsonb)
returns public.commands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cmd     public.commands;
  v_ref     text;
  v_item    jsonb;
  v_total   numeric := 0;
  v_advance numeric := coalesce((p_payload ->> 'advance_paid')::numeric, 0);
  v_seq     int;
  v_created timestamptz := coalesce(nullif(p_payload ->> 'created_at', '')::timestamptz, now());
  v_bon     text := nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '');
  v_year    text := to_char(v_created, 'YYYY');
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.commands;
  v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.commands where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'CMD-' || v_year || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_item ->> 'total_price')::numeric,
                 coalesce((v_item ->> 'quantity')::numeric, 0) * coalesce((v_item ->> 'unit_price')::numeric, 0));
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  insert into public.commands (reference, client_id, client_name, client_phone, receive_date,
                               receive_hour, receive_minute, total_amount, advance_paid,
                               paid_amount, rest_amount, status, notes, bon_number,
                               created_at, updated_at, created_by)
  values (v_ref,
          nullif(p_payload ->> 'client_id', '')::uuid,
          coalesce(p_payload ->> 'client_name', 'Client'),
          p_payload ->> 'client_phone',
          nullif(p_payload ->> 'receive_date', '')::date,
          p_payload ->> 'receive_hour',
          p_payload ->> 'receive_minute',
          v_total, v_advance, v_advance, greatest(0, v_total - v_advance),
          'pending', p_payload ->> 'notes', v_bon,
          v_created, v_created, public.current_username())
  returning * into v_cmd;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    insert into public.command_items (command_id, product_id, fiche_technic_id, product_name,
                                      quantity, unit_price, total_price, sell_by_unit, sell_unit)
    values (v_cmd.id,
            nullif(v_item ->> 'product_id', '')::uuid,
            nullif(v_item ->> 'fiche_technic_id', '')::uuid,
            coalesce(v_item ->> 'product_name', 'Produit'),
            coalesce((v_item ->> 'quantity')::numeric, 0),
            coalesce((v_item ->> 'unit_price')::numeric, 0),
            coalesce((v_item ->> 'total_price')::numeric, 0),
            coalesce((v_item ->> 'sell_by_unit')::boolean, false),
            v_item ->> 'sell_unit');
  end loop;

  if v_advance > 0 then
    insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id)
    values ('deposit', v_advance, v_created::date,
            'Acompte commande ' || v_ref, 'Commande', 'commands', v_cmd.id);
  end if;

  return v_cmd;
end;
$$;

grant execute on function public.create_command(jsonb) to authenticated, service_role;


-- ============================================================================
-- 03. RPC create_sale() — n° bon de commande manuel
-- ----------------------------------------------------------------------------
--  Bouton « Valider la vente » (point de vente) et ventes internes.
--  La date de la vente (`date`) est déjà éditable ; on ajoute `bon_number`.
-- ============================================================================

create or replace function public.create_sale(p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale   public.sales;
  v_ref    text;
  v_line   jsonb;
  v_total  numeric := 0;
  v_red    numeric := coalesce((p_payload ->> 'reduction')::numeric, 0);
  v_final  numeric;
  v_paid   numeric := coalesce((p_payload ->> 'paid_amount')::numeric, 0);
  v_rest   numeric;
  v_date   date    := coalesce((p_payload ->> 'date')::date, current_date);
  v_status public.sale_status;
  v_seq    int;
  v_pid    uuid;
  v_cid    uuid;
  v_qty    numeric;
  v_bon    text := nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), '');
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
  v_total  := coalesce((p_payload ->> 'total_amount')::numeric, v_total);
  v_final  := coalesce((p_payload ->> 'final_amount')::numeric, greatest(0, v_total - v_red));
  v_rest   := greatest(0, v_final - v_paid);
  v_status := case when v_rest = 0 then 'paid'::public.sale_status else 'debt'::public.sale_status end;

  insert into public.sales (reference, client_id, date, total_amount, reduction, final_amount,
                            paid_amount, rest_amount, status, note, bon_number, created_by)
  values (v_ref, nullif(p_payload ->> 'client_id', '')::uuid, v_date,
          v_total, v_red, v_final, v_paid, v_rest, v_status,
          p_payload ->> 'note', v_bon, public.current_username())
  returning * into v_sale;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_pid := nullif(v_line ->> 'product_id', '')::uuid;
    v_cid := nullif(v_line ->> 'comptoir_id', '')::uuid;
    v_qty := coalesce((v_line ->> 'quantity')::numeric, 0);

    insert into public.sale_lines (sale_id, product_id, comptoir_id, product_name, quantity,
                                   selling_price, sell_by_unit, unit)
    values (v_sale.id, v_pid, v_cid,
            coalesce(v_line ->> 'product_name', 'Produit'), v_qty,
            coalesce((v_line ->> 'selling_price')::numeric, 0),
            coalesce((v_line ->> 'sell_by_unit')::boolean, false),
            v_line ->> 'unit');

    -- stock / comptoir decrement
    if v_cid is not null then
      update public.comptoir_items
         set quantity = greatest(0, quantity - v_qty), updated_at = now()
       where id = v_cid;
    elsif v_pid is not null then
      perform public.consume_stock(v_pid, v_qty, 'sale', 'sales', v_sale.id);
    end if;
  end loop;

  if v_paid > 0 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (v_sale.id, v_date, v_paid, 'Paiement vente');
  end if;

  -- unpaid rest becomes a tracked client debt
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
$$;

grant execute on function public.create_sale(jsonb) to authenticated, service_role;


-- ============================================================================
-- 04. RPC create_sale_with_productions() — transmet le n° de bon de commande
-- ----------------------------------------------------------------------------
--  Point de vente avec fiches techniques : on relaie simplement `bon_number`
--  à create_sale(). (Corps identique à la version précédente, une seule ligne
--  ajoutée dans l'appel à create_sale.)
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
  v_map       jsonb := '{}'::jsonb;   -- line_key -> { comptoir_id, production_id }
  v_out       jsonb := '[]'::jsonb;
  v_line      jsonb;
  v_key       text;
  v_cid       text;
  v_qty       numeric;
begin
  -- a/b) une production par ligne « fiche technique » du panier
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
        'date',             coalesce(p_payload ->> 'date', to_char(current_date, 'YYYY-MM-DD')),
        'hour',             to_char(now(), 'HH24:MI'),
        'category_id',      v_prod_line ->> 'category_id',
        'category_name',    v_prod_line ->> 'category_name',
        'fiche_technic_id', v_prod_line ->> 'fiche_technic_id',
        'output_quantity',  v_qty,
        'unit_price',       coalesce((v_prod_line ->> 'unit_price')::numeric, 0),
        'sell_by_unit',     coalesce((v_prod_line ->> 'sell_by_unit')::boolean, false),
        'sell_unit',        v_prod_line ->> 'sell_unit',
        'used_products',    coalesce(v_prod_line -> 'used_products', '[]'::jsonb)
      )
    );

    update public.productions
       set origin = 'pos', updated_at = now()
     where id = v_prod.id;

    -- output_quantity est stocke en numeric(14,3) : on transfere la valeur
    -- reellement enregistree pour ne jamais depasser le lot produit.
    v_item := public.transfer_production_to_comptoir(v_prod.id, v_prod.output_quantity);

    v_key := coalesce(v_prod_line ->> 'line_key', v_prod_line ->> 'fiche_technic_id');
    v_map := v_map || jsonb_build_object(
      v_key, jsonb_build_object('comptoir_id', v_item.id, 'production_id', v_prod.id)
    );
  end loop;

  -- c) les lignes de vente reçoivent l'article de comptoir qui vient d'être créé
  for v_line in
    select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb))
  loop
    v_key := v_line ->> 'line_key';
    if v_key is not null and v_map ? v_key then
      v_cid  := v_map -> v_key ->> 'comptoir_id';
      v_line := v_line || jsonb_build_object('comptoir_id', v_cid, 'product_id', null);
    end if;
    v_out := v_out || jsonb_build_array(v_line);
  end loop;

  v_sale := public.create_sale(
    jsonb_build_object(
      'client_id',    p_payload ->> 'client_id',
      'date',         p_payload ->> 'date',
      'reduction',    coalesce((p_payload ->> 'reduction')::numeric, 0),
      'total_amount', (p_payload ->> 'total_amount')::numeric,
      'final_amount', (p_payload ->> 'final_amount')::numeric,
      'paid_amount',  coalesce((p_payload ->> 'paid_amount')::numeric, 0),
      'note',         p_payload ->> 'note',
      'bon_number',   p_payload ->> 'bon_number',
      'products',     v_out
    )
  );

  -- rattache les productions créées à la vente (affichage dans /production)
  for v_prod_line in
    select * from jsonb_array_elements(coalesce(p_payload -> 'productions', '[]'::jsonb))
  loop
    v_key := coalesce(v_prod_line ->> 'line_key', v_prod_line ->> 'fiche_technic_id');
    if v_map ? v_key then
      update public.productions
         set sale_id        = v_sale.id,
             sale_reference = v_sale.reference,
             updated_at     = now()
       where id = (v_map -> v_key ->> 'production_id')::uuid;
    end if;
  end loop;

  perform public.log_activity('pos', 'create', 'sales', v_sale.id, p_payload);
  return v_sale;
end;
$fn$;

grant execute on function public.create_sale_with_productions(jsonb) to authenticated, service_role;

-- ============================================================================
--  FIN DE LA MISE À JOUR
-- ============================================================================
