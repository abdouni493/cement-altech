-- ============================================================================
--  ALTECH PRODUCTION — MISE A JOUR
--  « RELEVE : VOIR ET MODIFIER CHAQUE LIGNE DU COMPTE RENDU »
-- ----------------------------------------------------------------------------
--  A EXECUTER EN UNE SEULE FOIS dans Supabase -> SQL Editor.
--  Le script est IDEMPOTENT : il peut etre relance sans risque.
--
--  PREREQUIS — toutes les mises a jour precedentes, et en dernier :
--    · altech_production_update_noms_produits_titres.sql
--
--  Chaque ligne du releve (compte rendu client / fournisseur, bon de livraison
--  de periode, rapport general) peut maintenant etre modifiee depuis le releve
--  lui-meme. Les ventes, bons de livraison, achats, anciennes dettes et
--  versements avaient deja leur fonction de modification ; il manquait :
--
--   1. update_sale_lines()       — les LIGNES d'une vente de caisse
--                                  (designation, quantite, prix unitaire),
--                                  avec correction du stock / du comptoir,
--                                  puis recalcul complet de la facture.
--   2. update_command_payment()  — un reglement de commande (montant, date).
--   3. update_party_refund()     — un excedent rendu / recupere.
--
--  Tous les totaux derives (reste, dette du tiers, acompte, caisse) sont
--  recalcules par les fonctions existantes appelees en fin de traitement.
-- ============================================================================


-- ============================================================================
-- 01. LIGNES D'UNE VENTE DE CAISSE
-- ----------------------------------------------------------------------------
--  p_lines   : [{ "id": uuid, "product_name": text, "quantity": num,
--                 "selling_price": num }]   — quantite 0 = ligne supprimee
--  p_header  : meme contenu que update_sale() (date, reduction, paid_amount,
--              tva_enabled, tva_rate, note)
--
--  L'ecart de quantite d'une vente NORMALE (pas « ancienne ») est repercute :
--    · article du comptoir -> comptoir_items.quantity
--    · produit du stock    -> stock (sortie ou retour, trace dans stock_movements)
--    · fiche technique     -> matieres premieres de sa recette
--  Une facture issue d'un bon de livraison se modifie par son BON : refusee ici.
-- ============================================================================

create or replace function public.update_sale_lines(
  p_sale_id uuid, p_lines jsonb, p_header jsonb default '{}'::jsonb
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale  public.sales;
  v_item  jsonb;
  v_line  public.sale_lines;
  v_qty   numeric;
  v_price numeric;
  v_name  text;
  v_delta numeric;
  v_req   record;
  v_left  numeric;
  v_kept  int;
begin
  if not public.has_perm('clients', 'edit') and not public.has_perm('sales', 'edit') then
    raise exception 'Vous n''avez pas la permission de modifier une vente';
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if v_sale.id is null then
    raise exception 'Vente introuvable (%)', p_sale_id;
  end if;
  if v_sale.delivery_id is not null then
    raise exception 'Cette facture vient d''un bon de livraison : modifiez le bon lui-meme.';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into v_line
      from public.sale_lines
     where id = nullif(v_item ->> 'id', '')::uuid and sale_id = p_sale_id;
    if v_line.id is null then
      continue;
    end if;

    v_qty   := greatest(0, coalesce((v_item ->> 'quantity')::numeric, v_line.quantity));
    v_price := greatest(0, coalesce((v_item ->> 'selling_price')::numeric, v_line.selling_price));
    v_name  := coalesce(nullif(btrim(v_item ->> 'product_name'), ''), v_line.product_name);
    v_delta := v_qty - v_line.quantity;

    -- ---- le stock suit l'ecart de quantite (jamais pour une ancienne vente)
    if abs(v_delta) > 0.0005 and not coalesce(v_sale.is_historical, false) then
      if v_line.comptoir_id is not null then
        update public.comptoir_items
           set quantity = greatest(0, quantity - v_delta), updated_at = now()
         where id = v_line.comptoir_id;

      elsif v_line.fiche_technic_id is not null then
        for v_req in
          select r.product_id, r.product_name, sum(r.quantity) as quantity
            from public.fiche_stock_requirements(v_line.fiche_technic_id, abs(v_delta)) r
           group by r.product_id, r.product_name
        loop
          if v_delta > 0 then
            perform public.consume_stock(v_req.product_id, v_req.quantity, 'sale_edit',
                                         'sales', p_sale_id, v_req.product_name);
          else
            update public.products
               set current_quantity = current_quantity + v_req.quantity, updated_at = now()
             where id = public.resolve_stock_product(v_req.product_id, v_req.product_name)
            returning current_quantity into v_left;
            if v_left is not null then
              insert into public.stock_movements (product_id, quantity, reason, ref_table, ref_id, balance_after)
              values (public.resolve_stock_product(v_req.product_id, v_req.product_name),
                      v_req.quantity, 'sale_edit', 'sales', p_sale_id, v_left);
            end if;
          end if;
        end loop;

      elsif v_line.product_id is not null
            and exists (select 1 from public.products where id = v_line.product_id) then
        if v_delta > 0 then
          perform public.consume_stock(v_line.product_id, v_delta, 'sale_edit',
                                       'sales', p_sale_id, v_line.product_name);
        else
          update public.products
             set current_quantity = current_quantity - v_delta, updated_at = now()
           where id = v_line.product_id
          returning current_quantity into v_left;
          insert into public.stock_movements (product_id, quantity, reason, ref_table, ref_id, balance_after)
          values (v_line.product_id, -v_delta, 'sale_edit', 'sales', p_sale_id, v_left);
        end if;
      end if;
    end if;

    if v_qty <= 0 then
      delete from public.sale_lines where id = v_line.id;
    else
      update public.sale_lines
         set quantity      = v_qty,
             selling_price = v_price,
             product_name  = v_name
       where id = v_line.id;
    end if;
  end loop;

  select count(*) into v_kept from public.sale_lines where sale_id = p_sale_id;
  if v_kept = 0 then
    raise exception 'Une vente doit garder au moins une ligne — supprimez plutot la vente.';
  end if;

  -- total, TVA, paye, reste, dette client et caisse : update_sale() recalcule tout
  select * into v_sale from public.update_sale(p_sale_id, coalesce(p_header, '{}'::jsonb));

  perform public.log_activity('sales', 'update', 'sale_lines', p_sale_id, p_lines);
  return v_sale;
end;
$fn$;


-- ============================================================================
-- 02. REGLEMENT D'UNE COMMANDE
-- ----------------------------------------------------------------------------
--  Le cumul `commands.extra_paid` suit l'ecart ; la caisse suit via le
--  declencheur trg_command_payment_caisse ; le paye / reste de la commande
--  est recalcule par recompute_command_payments().
-- ============================================================================

create or replace function public.update_command_payment(
  p_id uuid, p_amount numeric, p_date date default null, p_notes text default null
)
returns public.command_payments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old public.command_payments;
  v_new public.command_payments;
begin
  if not public.has_perm('clients', 'edit') then
    raise exception 'Vous n''avez pas la permission de modifier un reglement';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  select * into v_old from public.command_payments where id = p_id;
  if v_old.id is null then
    raise exception 'Reglement introuvable (%)', p_id;
  end if;

  update public.command_payments
     set amount = p_amount,
         date   = coalesce(p_date, date),
         notes  = coalesce(p_notes, notes)
   where id = p_id
  returning * into v_new;

  update public.commands
     set extra_paid = greatest(0, coalesce(extra_paid, 0) + (p_amount - v_old.amount)),
         updated_at = now()
   where id = v_old.command_id;

  perform public.recompute_command_payments(v_old.command_id);
  perform public.log_activity('clients', 'update', 'command_payments', p_id,
    jsonb_build_object('amount', p_amount, 'old_amount', v_old.amount, 'date', v_new.date));
  return v_new;
end;
$fn$;


-- ============================================================================
-- 03. EXCEDENT RENDU AU CLIENT / RECUPERE DU FOURNISSEUR
-- ----------------------------------------------------------------------------
--  L'acompte du tiers est corrige de l'ecart (il ne peut pas devenir
--  negatif) ; la caisse suit via le declencheur trg_party_refund_caisse.
-- ============================================================================

create or replace function public.update_party_refund(
  p_id              uuid,
  p_amount          numeric,
  p_refunded_at     timestamptz default null,
  p_notes           text default null,
  p_method          text default null,
  p_cheque_number   text default null,
  p_virement_number text default null,
  p_bank_name       text default null
)
returns public.party_credit_refunds
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old    public.party_credit_refunds;
  v_row    public.party_credit_refunds;
  v_module text;
  v_credit numeric := 0;
  v_method text;
begin
  select * into v_old from public.party_credit_refunds where id = p_id;
  if v_old.id is null then
    raise exception 'Remboursement introuvable (%)', p_id;
  end if;

  v_module := case when v_old.party_type = 'supplier' then 'suppliers' else 'clients' end;
  if not public.has_perm(v_module, 'edit') and not public.has_perm(v_module, 'pay') then
    raise exception 'Vous n''avez pas la permission de modifier ce remboursement';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  v_method := lower(coalesce(nullif(btrim(p_method), ''), v_old.method, 'especes'));
  if v_method not in ('especes', 'cheque', 'virement') then
    raise exception 'Mode de reglement inconnu : %', p_method;
  end if;

  if v_old.party_type = 'client' then
    select coalesce(credit_amount, 0) into v_credit from public.clients where id = v_old.party_id;
  else
    select coalesce(credit_amount, 0) into v_credit from public.suppliers where id = v_old.party_id;
  end if;

  -- l'ancien montant revient d'abord au tiers, puis le nouveau en sort
  if p_amount > v_credit + v_old.amount + 0.005 then
    raise exception 'Excedent disponible insuffisant : % DA',
      to_char(v_credit + v_old.amount, 'FM999999999.00');
  end if;

  if v_old.party_type = 'client' then
    update public.clients
       set credit_amount = greatest(0, coalesce(credit_amount, 0) + v_old.amount - p_amount), updated_at = now()
     where id = v_old.party_id;
  else
    update public.suppliers
       set credit_amount = greatest(0, coalesce(credit_amount, 0) + v_old.amount - p_amount), updated_at = now()
     where id = v_old.party_id;
  end if;

  update public.party_credit_refunds
     set amount          = p_amount,
         refunded_at     = coalesce(p_refunded_at, refunded_at),
         date            = coalesce(p_refunded_at, refunded_at)::date,
         notes           = coalesce(p_notes, notes),
         method          = v_method,
         cheque_number   = case when v_method = 'cheque'   then nullif(btrim(coalesce(p_cheque_number, cheque_number)), '') end,
         virement_number = case when v_method = 'virement' then nullif(btrim(coalesce(p_virement_number, virement_number)), '') end,
         bank_name       = case when v_method <> 'especes' then nullif(btrim(coalesce(p_bank_name, bank_name)), '') end,
         updated_at      = now()
   where id = p_id
  returning * into v_row;

  perform public.log_activity(v_module, 'update', 'party_credit_refunds', p_id,
    jsonb_build_object('amount', p_amount, 'old_amount', v_old.amount));
  return v_row;
end;
$fn$;


-- ============================================================================
-- 04. DROITS
-- ============================================================================

grant execute on function public.update_sale_lines(uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.update_command_payment(uuid, numeric, date, text) to authenticated, service_role;
grant execute on function public.update_party_refund(uuid, numeric, timestamptz, text, text, text, text, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
