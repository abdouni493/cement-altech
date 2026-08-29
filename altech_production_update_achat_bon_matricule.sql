-- ============================================================================
--  ALTECH PRODUCTION — CIMENT BLIDA
--  MISE À JOUR — ACHATS : n° de bon de livraison + matricule du chauffeur
-- ----------------------------------------------------------------------------
--  À exécuter APRÈS `altech_production_supabase.sql`
--  (Supabase Studio > SQL Editor > coller TOUT le fichier > Run)
--  Le script est idempotent : il peut être relancé sans risque.
-- ----------------------------------------------------------------------------
--  CONTENU
--   01. Colonnes bon_number / driver_plate sur public.purchases
--   02. RPC create_purchase() : enregistre les deux nouveaux champs
--   03. Vue de contrôle des bons d'achat (optionnelle)
-- ============================================================================


-- ============================================================================
-- 01. NOUVELLES COLONNES SUR LES FACTURES D'ACHAT
-- ============================================================================

alter table public.purchases
  add column if not exists bon_number  text,
  add column if not exists driver_plate text;

comment on column public.purchases.bon_number   is 'N° du bon de livraison remis par le fournisseur';
comment on column public.purchases.driver_plate is 'Immatriculation du camion / chauffeur ayant livré';

-- Recherche rapide par n° de bon ou par matricule (/purchase > barre de recherche)
create index if not exists purchases_bon_number_idx
  on public.purchases (lower(bon_number));
create index if not exists purchases_driver_plate_idx
  on public.purchases (lower(driver_plate));


-- ============================================================================
-- 02. RPC create_purchase() — prise en compte du bon et du matricule
-- ----------------------------------------------------------------------------
--  Bouton « Créer la facture & mettre à jour le stock » (CreatePurchase)
--  Crée la facture, ses lignes, son premier paiement et met à jour le stock
--  dans une seule transaction.
-- ============================================================================

create or replace function public.create_purchase(p_payload jsonb)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.purchases;
  v_ref      text;
  v_line     jsonb;
  v_total    numeric := 0;
  v_paid     numeric := coalesce((p_payload ->> 'paid_amount')::numeric, 0);
  v_date     date    := coalesce((p_payload ->> 'date')::date, current_date);
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

  insert into public.purchases (reference, supplier_id, date, bon_number, driver_plate,
                                total_amount, paid_amount, rest_amount, note, created_by)
  values (v_ref,
          nullif(p_payload ->> 'supplier_id', '')::uuid,
          v_date,
          nullif(btrim(coalesce(p_payload ->> 'bon_number', '')), ''),
          nullif(upper(btrim(coalesce(p_payload ->> 'driver_plate', ''))), ''),
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
    values (v_purchase.id, v_date, v_paid, 'Acompte achat');
  end if;

  perform public.log_activity('purchase', 'create', 'purchases', v_purchase.id, p_payload);
  select * into v_purchase from public.purchases where id = v_purchase.id;
  return v_purchase;
end;
$$;

grant execute on function public.create_purchase(jsonb) to authenticated, service_role;


-- ============================================================================
-- 03. VUE DE CONTRÔLE — bons d'achat par fournisseur / camion
-- ============================================================================

create or replace view public.v_purchase_bons as
select p.id,
       p.reference,
       p.date,
       p.bon_number,
       p.driver_plate,
       s.name as supplier_name,
       p.total_amount,
       p.paid_amount,
       p.rest_amount
  from public.purchases p
  left join public.suppliers s on s.id = p.supplier_id
 order by p.date desc, p.reference desc;

-- comme toutes les vues du projet : les droits RLS de l'utilisateur s'appliquent
alter view public.v_purchase_bons set (security_invoker = true);
grant select on public.v_purchase_bons to authenticated, service_role;

-- ============================================================================
--  FIN DE LA MISE À JOUR
-- ============================================================================
