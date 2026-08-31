-- ============================================================================
--  ALTECH PRODUCTION — MISE À JOUR
--  « Anciens achats · Anciennes ventes (caisse rétroactive) · Option TVA »
-- ----------------------------------------------------------------------------
--  À exécuter EN UNE SEULE FOIS dans Supabase → SQL Editor.
--  Le script est idempotent : il peut être relancé sans risque.
--
--  Contenu :
--    01. purchases.is_historical      — « ancien achat » (saisie rétroactive)
--    02. sales.is_historical + TVA    — « ancienne vente » et option TVA
--    03. trg_purchase_line_to_stock() — un ancien achat n'alimente PAS le stock
--    04. trg_purchase_payment_to_caisse() — ni la caisse
--    05. trg_sale_payment_to_caisse()     — idem pour une ancienne vente
--    06. RPC create_purchase()        — enregistre le drapeau « ancien achat »
--    07. RPC create_sale()            — drapeau « ancienne vente » + TVA, et
--        surtout : AUCUN décrément du comptoir ni du stock en mode rétroactif
--    08. RPC create_sale_with_productions() — relaie les nouveaux champs
--    09. RPC update_sale()            — la TVA est conservée à la modification
--    10. Vues de contrôle             — saisies rétroactives et TVA collectée
--    11. Cohérence des ventes déjà enregistrées
--
--  RÈGLE MÉTIER (les deux modes rétroactifs) :
--    · le document est enregistré à SA DATE D'ORIGINE ;
--    · il alimente l'historique du fournisseur / du client, les dettes et les
--      rapports généraux ;
--    · il ne touche NI au stock actuel, NI au comptoir, NI à la caisse.
--
--  RÈGLE TVA :
--      base HT = total des lignes − réduction
--      TVA     = base HT × taux / 100      (19 % par défaut, taux modifiable)
--      TTC     = base HT + TVA             → c'est `sales.final_amount`
--    Le montant payé et le reste dû portent donc toujours sur le TTC.
-- ============================================================================

begin;

-- ============================================================================
-- 01. ACHATS — drapeau « ancien achat »
-- ----------------------------------------------------------------------------
--  Bouton « Ancien achat » de l'écran /purchase : même formulaire que l'achat
--  normal, mais les quantités ne rejoignent pas le stock actuel.
-- ============================================================================

alter table public.purchases
  add column if not exists is_historical boolean not null default false;

comment on column public.purchases.is_historical is
  'Ancien achat saisi a posteriori : la facture alimente l''historique du fournisseur et les rapports, mais n''ajoute rien au stock actuel et ne genere aucune ecriture de caisse.';

create index if not exists purchases_historical_idx
  on public.purchases (is_historical) where is_historical;


-- ============================================================================
-- 02. VENTES — drapeau « ancienne vente » + option TVA
-- ----------------------------------------------------------------------------
--  Bouton « Ancienne vente » du point de vente, et interrupteur TVA présent
--  sur la caisse normale COMME sur la caisse rétroactive.
-- ============================================================================

alter table public.sales
  add column if not exists is_historical boolean       not null default false,
  add column if not exists tva_enabled   boolean       not null default false,
  add column if not exists tva_rate      numeric(6,2)  not null default 0,
  add column if not exists tva_amount    numeric(14,2) not null default 0;

comment on column public.sales.is_historical is
  'Ancienne vente saisie a posteriori : elle alimente l''historique du client et les rapports, mais ne deduit rien du comptoir ni du stock et ne genere aucune ecriture de caisse.';
comment on column public.sales.tva_enabled is
  'TVA activee sur cette vente (option de la caisse).';
comment on column public.sales.tva_rate is
  'Taux de TVA applique, en pourcentage — 19 par defaut, modifiable.';
comment on column public.sales.tva_amount is
  'Montant de TVA = (total_amount - reduction) * tva_rate / 100. final_amount contient le NET A PAYER TTC.';

create index if not exists sales_historical_idx
  on public.sales (is_historical) where is_historical;


-- ============================================================================
-- 03. STOCK — un ancien achat n'alimente jamais le stock actuel
-- ----------------------------------------------------------------------------
--  Le déclencheur reste identique pour un achat normal ; il sort simplement
--  sans rien faire lorsque la facture parente est marquée « ancien achat ».
-- ============================================================================

create or replace function public.trg_purchase_line_to_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_left numeric;
  v_hist boolean;
begin
  if new.product_id is null then
    return new;
  end if;

  -- « Ancien achat » : la marchandise a été reçue et consommée dans le passé,
  -- le stock d'aujourd'hui ne doit surtout pas être gonflé.
  select coalesce(is_historical, false) into v_hist
    from public.purchases where id = new.purchase_id;
  if coalesce(v_hist, false) then
    return new;
  end if;

  update public.products
     set current_quantity   = current_quantity + new.quantity,
         principal_quantity = principal_quantity + new.quantity,
         min_alert_quantity = coalesce(new.min_alert_quantity, min_alert_quantity),
         purchase_price     = case when new.purchase_price > 0 then new.purchase_price else purchase_price end,
         expiration_date    = coalesce(new.expiration_date, expiration_date),
         expiration_enabled = case when new.expiration_date is not null then true else expiration_enabled end,
         unit_enabled       = case when new.unit_enabled then true else unit_enabled end,
         unit               = case when new.unit_enabled then coalesce(new.unit, unit) else unit end,
         updated_at         = now()
   where id = new.product_id
  returning current_quantity into v_left;

  insert into public.stock_movements (product_id, quantity, reason, ref_table, ref_id, balance_after)
  values (new.product_id, new.quantity, 'purchase', 'purchase_lines', new.id, v_left);

  return new;
end;
$fn$;

drop trigger if exists trg_purchase_line_stock on public.purchase_lines;
create trigger trg_purchase_line_stock
  after insert on public.purchase_lines
  for each row execute function public.trg_purchase_line_to_stock();


-- ============================================================================
-- 04. CAISSE — un règlement d'ancien achat n'est pas un décaissement du jour
-- ============================================================================

create or replace function public.trg_purchase_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref  text;
  v_hist boolean;
begin
  select reference, coalesce(is_historical, false)
    into v_ref, v_hist
    from public.purchases where id = new.purchase_id;

  -- l'argent est sorti de la caisse dans le passé, hors du logiciel
  if coalesce(v_hist, false) then
    return new;
  end if;

  insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('withdrawal', new.amount, new.date,
          coalesce(new.description, 'Règlement fournisseur') || ' ' || coalesce(v_ref, ''),
          'Achat', 'purchase_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists trg_purchase_payment_caisse on public.purchase_payments;
create trigger trg_purchase_payment_caisse
  after insert on public.purchase_payments
  for each row execute function public.trg_purchase_payment_to_caisse();


-- ============================================================================
-- 05. CAISSE — un encaissement d'ancienne vente n'entre pas dans le tiroir
-- ============================================================================

create or replace function public.trg_sale_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref  text;
  v_hist boolean;
begin
  select reference, coalesce(is_historical, false)
    into v_ref, v_hist
    from public.sales where id = new.sale_id;

  -- l'argent a été encaissé dans le passé, hors du logiciel
  if coalesce(v_hist, false) then
    return new;
  end if;

  insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('deposit', new.amount, new.date,
          coalesce(new.description, 'Paiement vente') || ' ' || coalesce(v_ref, ''),
          'Vente', 'sale_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists trg_sale_payment_caisse on public.sale_payments;
create trigger trg_sale_payment_caisse
  after insert on public.sale_payments
  for each row execute function public.trg_sale_payment_to_caisse();


-- ============================================================================
-- 06. RPC create_purchase() — enregistre le drapeau « ancien achat »
-- ----------------------------------------------------------------------------
--  Corps identique à la version précédente (bon de livraison + matricule),
--  avec la seule colonne `is_historical` en plus.
-- ============================================================================

create or replace function public.create_purchase(p_payload jsonb)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_purchase public.purchases;
  v_ref      text;
  v_line     jsonb;
  v_total    numeric := 0;
  v_paid     numeric := coalesce((p_payload ->> 'paid_amount')::numeric, 0);
  v_date     date    := coalesce((p_payload ->> 'date')::date, current_date);
  v_hist     boolean := coalesce((p_payload ->> 'is_historical')::boolean, false);
  v_seq      int;
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.purchases;
  v_ref := 'ACH-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.purchases where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'ACH-' || to_char(v_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_line ->> 'quantity')::numeric, 0)
                       * coalesce((v_line ->> 'purchase_price')::numeric, 0);
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  -- la facture est écrite AVANT ses lignes : le déclencheur de stock peut donc
  -- lire `is_historical` et se désactiver pour un ancien achat.
  insert into public.purchases (reference, supplier_id, date, bon_number, driver_plate,
                                is_historical, total_amount, paid_amount, rest_amount,
                                note, created_by)
  values (v_ref,
          nullif(p_payload ->> 'supplier_id', '')::uuid,
          v_date,
          nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), ''),
          nullif(upper(btrim(coalesce(p_payload ->> 'driver_plate', ''))), ''),
          v_hist,
          v_total, v_paid, greatest(0, v_total - v_paid),
          p_payload ->> 'note',
          public.current_username())
  returning * into v_purchase;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'products', '[]'::jsonb)) loop
    insert into public.purchase_lines (
      purchase_id, product_id, product_name, quantity, purchase_price,
      min_alert_quantity, unit_enabled, unit, expiration_enabled, expiration_date)
    values (
      v_purchase.id,
      nullif(v_line ->> 'product_id', '')::uuid,
      coalesce(v_line ->> 'product_name', 'Produit'),
      coalesce((v_line ->> 'quantity')::numeric, 0),
      coalesce((v_line ->> 'purchase_price')::numeric, 0),
      nullif(v_line ->> 'min_alert_quantity', '')::numeric,
      coalesce((v_line ->> 'unit_enabled')::boolean, false),
      v_line ->> 'unit',
      coalesce((v_line ->> 'expiration_enabled')::boolean, false),
      nullif(v_line ->> 'expiration_date', '')::date
    );
  end loop;

  if v_paid > 0 then
    insert into public.purchase_payments (purchase_id, date, amount, description)
    values (v_purchase.id, v_date, v_paid,
            case when v_hist then 'Acompte ancien achat' else 'Acompte achat' end);
  end if;

  perform public.log_activity('purchase', 'create', 'purchases', v_purchase.id, p_payload);
  select * into v_purchase from public.purchases where id = v_purchase.id;
  return v_purchase;
end;
$fn$;

grant execute on function public.create_purchase(jsonb) to authenticated, service_role;


-- ============================================================================
-- 07. RPC create_sale() — « ancienne vente » + TVA
-- ----------------------------------------------------------------------------
--  · is_historical = true → ni le comptoir ni le stock ne sont décrémentés.
--  · tva_enabled   = true → le montant de TVA est recalculé côté serveur pour
--    rester cohérent, et `final_amount` devient le NET À PAYER TTC.
--  Le reste du corps est identique à la version précédente (n° de bon de
--  commande, consume_stock par nom, dette client).
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

  -- ---- TVA : base HT → montant → net TTC ---------------------------------
  if not v_tva_on then
    v_tva_rate := 0;
  end if;
  v_red   := least(greatest(0, v_red), v_total);
  v_base  := greatest(0, v_total - v_red);
  v_tva   := case when v_tva_on then round(v_base * v_tva_rate / 100, 2) else 0 end;
  v_final := v_base + v_tva;

  v_rest   := greatest(0, v_final - v_paid);
  v_status := case when v_rest = 0 then 'paid'::public.sale_status else 'debt'::public.sale_status end;

  -- la vente est écrite AVANT ses lignes et son paiement : les déclencheurs
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

    -- Décrément comptoir / stock — SAUTÉ pour une ancienne vente : la
    -- marchandise est sortie du magasin dans le passé, hors du logiciel.
    if not v_hist then
      if v_cid is not null then
        update public.comptoir_items
           set quantity = greatest(0, quantity - v_qty), updated_at = now()
         where id = v_cid;
      elsif v_pid is not null then
        perform public.consume_stock(v_pid, v_qty, 'sale', 'sales', v_sale.id,
                                     v_line ->> 'product_name');
      end if;
    end if;
  end loop;

  if v_paid > 0 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (v_sale.id, v_date, v_paid,
            case when v_hist then 'Paiement ancienne vente' else 'Paiement vente' end);
  end if;

  -- le reste impayé devient une dette client suivie (y compris en rétroactif :
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

grant execute on function public.create_sale(jsonb) to authenticated, service_role;


-- ============================================================================
-- 08. RPC create_sale_with_productions() — relaie les nouveaux champs
-- ----------------------------------------------------------------------------
--  Corps identique à la version précédente ; seules les lignes
--  `is_historical` / `tva_*` sont ajoutées à l'appel de create_sale().
--  (En pratique le point de vente n'envoie jamais de production pour une
--   ancienne vente ; le relais est conservé par sécurité.)
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
      'client_id',     p_payload ->> 'client_id',
      'date',          p_payload ->> 'date',
      'reduction',     coalesce((p_payload ->> 'reduction')::numeric, 0),
      'total_amount',  (p_payload ->> 'total_amount')::numeric,
      'paid_amount',   coalesce((p_payload ->> 'paid_amount')::numeric, 0),
      'note',          p_payload ->> 'note',
      'bon_number',    p_payload ->> 'bon_number',
      'is_historical', coalesce((p_payload ->> 'is_historical')::boolean, false),
      'tva_enabled',   coalesce((p_payload ->> 'tva_enabled')::boolean, false),
      'tva_rate',      coalesce((p_payload ->> 'tva_rate')::numeric, 0),
      'products',      v_out
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
-- 09. RPC update_sale() — la TVA survit à la modification d'une facture
-- ----------------------------------------------------------------------------
--  Sans ce correctif, modifier la date ou le montant payé d'une vente TTC
--  recalculait `final_amount = total − réduction` et effaçait la TVA.
--  Le payload peut aussi changer l'option (`tva_enabled`) et le taux.
-- ============================================================================

create or replace function public.update_sale(p_id uuid, p_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale     public.sales;
  v_total    numeric;
  v_red      numeric;
  v_base     numeric;
  v_tva_on   boolean;
  v_tva_rate numeric;
  v_tva      numeric;
  v_final    numeric;
  v_paid     numeric;
  v_rest     numeric;
  v_date     date;
  v_status   public.sale_status;
begin
  select * into v_sale from public.sales where id = p_id;
  if v_sale.id is null then
    raise exception 'Vente introuvable (%)', p_id;
  end if;

  v_date  := coalesce(nullif(p_payload ->> 'date', '')::date, v_sale.date);
  v_red   := greatest(0, coalesce((p_payload ->> 'reduction')::numeric, v_sale.reduction));
  v_total := coalesce(
    (select sum(quantity * selling_price) from public.sale_lines where sale_id = p_id),
    v_sale.total_amount);
  v_red   := least(v_red, v_total);
  v_base  := greatest(0, v_total - v_red);

  v_tva_on   := coalesce((p_payload ->> 'tva_enabled')::boolean, coalesce(v_sale.tva_enabled, false));
  v_tva_rate := coalesce((p_payload ->> 'tva_rate')::numeric, coalesce(v_sale.tva_rate, 0));
  if not v_tva_on then
    v_tva_rate := 0;
  end if;
  v_tva   := case when v_tva_on then round(v_base * v_tva_rate / 100, 2) else 0 end;
  v_final := v_base + v_tva;

  v_paid  := least(greatest(0, coalesce((p_payload ->> 'paid_amount')::numeric, v_sale.paid_amount)), v_final);
  v_rest  := greatest(0, v_final - v_paid);
  v_status := case when v_rest = 0 then 'paid'::public.sale_status else 'debt'::public.sale_status end;

  -- le trigger de suppression retire aussi les écritures de caisse liées
  delete from public.sale_payments where sale_id = p_id;
  if v_paid > 0 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (p_id, v_date, v_paid, 'Paiement vente (modifie)');
  end if;

  update public.sales
     set date         = v_date,
         total_amount = v_total,
         reduction    = v_red,
         tva_enabled  = v_tva_on,
         tva_rate     = v_tva_rate,
         tva_amount   = v_tva,
         final_amount = v_final,
         paid_amount  = v_paid,
         rest_amount  = v_rest,
         status       = v_status,
         note         = coalesce(p_payload ->> 'note', note),
         updated_at   = now()
   where id = p_id
  returning * into v_sale;

  -- la dette client générée par cette vente suit le nouveau reste
  delete from public.client_debts
   where description = 'Reste vente ' || v_sale.reference
     and coalesce(total_paid, 0) = 0;
  if v_rest > 0 and v_sale.client_id is not null then
    insert into public.client_debts (client_id, client_name, client_phone, total_debt, rest_amount,
                                     date, description, created_by)
    select v_sale.client_id, c.name, c.phone, v_rest, v_rest, v_date,
           'Reste vente ' || v_sale.reference, public.current_username()
      from public.clients c where c.id = v_sale.client_id;
  end if;

  perform public.log_activity('sales', 'update', 'sales', p_id, p_payload);
  return v_sale;
end;
$fn$;

grant execute on function public.update_sale(uuid, jsonb) to authenticated, service_role;


-- ============================================================================
-- 10. VUES DE CONTRÔLE — saisies rétroactives & TVA collectée
-- ----------------------------------------------------------------------------
--  Utiles pour vérifier depuis Supabase ce que l'écran « Rapports » affiche.
-- ============================================================================

drop view if exists public.v_saisies_retroactives;
create view public.v_saisies_retroactives as
select 'Ancienne vente'::text                    as type_document,
       s.reference,
       s.date,
       coalesce(c.name, 'Client de passage')     as tiers,
       s.final_amount                            as total_amount,
       s.paid_amount,
       s.rest_amount,
       s.created_by
  from public.sales s
  left join public.clients c on c.id = s.client_id
 where coalesce(s.is_historical, false)
union all
select 'Ancien achat'::text,
       p.reference,
       p.date,
       coalesce(f.name, '—'),
       p.total_amount,
       p.paid_amount,
       p.rest_amount,
       p.created_by
  from public.purchases p
  left join public.suppliers f on f.id = p.supplier_id
 where coalesce(p.is_historical, false);

alter view public.v_saisies_retroactives set (security_invoker = true);
grant select on public.v_saisies_retroactives to authenticated, service_role;

comment on view public.v_saisies_retroactives is
  'Anciens achats et anciennes ventes : documents saisis a posteriori qui alimentent l''historique des tiers et les rapports sans avoir touche au stock actuel ni a la caisse.';


drop view if exists public.v_tva_ventes;
create view public.v_tva_ventes as
select s.id,
       s.reference,
       s.date,
       coalesce(c.name, 'Client de passage')     as client_name,
       s.is_historical,
       s.total_amount                            as total_brut,
       s.reduction,
       greatest(0, s.total_amount - s.reduction) as base_ht,
       s.tva_rate,
       s.tva_amount,
       s.final_amount                            as net_ttc
  from public.sales s
  left join public.clients c on c.id = s.client_id
 where coalesce(s.tva_enabled, false);

alter view public.v_tva_ventes set (security_invoker = true);
grant select on public.v_tva_ventes to authenticated, service_role;

comment on view public.v_tva_ventes is
  'Ventes soumises a la TVA : base imposable, taux applique, montant collecte et net a payer TTC.';


-- ============================================================================
-- 11. COHÉRENCE DES VENTES DÉJÀ ENREGISTRÉES
-- ----------------------------------------------------------------------------
--  Toutes les ventes antérieures à cette mise à jour ont été établies sans TVA
--  et en temps réel : les valeurs par défaut sont déjà correctes, on se
--  contente de neutraliser d'éventuelles valeurs incohérentes.
-- ============================================================================

update public.sales
   set tva_rate   = 0,
       tva_amount = 0
 where coalesce(tva_enabled, false) = false
   and (coalesce(tva_rate, 0) <> 0 or coalesce(tva_amount, 0) <> 0);

commit;

-- ============================================================================
--  FIN DE LA MISE À JOUR
--  Vérifications rapides :
--    select * from public.v_saisies_retroactives;
--    select * from public.v_tva_ventes;
--    select reference, date, is_historical from public.purchases order by date desc limit 10;
--    select reference, date, is_historical, tva_enabled, tva_rate, tva_amount,
--           total_amount, reduction, final_amount
--      from public.sales order by date desc limit 10;
-- ============================================================================
