-- ============================================================================
--  MISE A JOUR — LIVREURS (deliverors)
-- ----------------------------------------------------------------------------
--  Nouvelle interface « Livreurs » : meme principe que les fournisseurs.
--
--   * delivery_persons        — la fiche du livreur (nom, telephone, adresse).
--   * deliverer_payments      — bouton « Payer la dette » d'une carte livreur
--                               (sort de la caisse, comme un reglement
--                               fournisseur).
--   * purchases.deliverer_*   — a la creation d'un achat on peut affecter un
--                               livreur, lui fixer un cout de transport pour
--                               cette facture et indiquer combien lui a deja
--                               ete paye. Ces informations s'affichent sur le
--                               detail de l'achat et alimentent l'historique du
--                               livreur.
--
--  La dette d'un livreur = somme des couts qui lui sont affectes sur les achats
--  − (ce qui lui a ete paye sur ces achats + ses reglements directs).
--
--  A executer APRES altech_production_toutes_mises_a_jour.sql.
--  Idempotent : peut etre rejoue sans risque.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 01. FICHE DU LIVREUR
-- ----------------------------------------------------------------------------
create table if not exists public.delivery_persons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  address    text,
  note       text,
  is_active  boolean not null default true,
  created_by text default public.current_username(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 02. COLONNES LIVREUR SUR LES ACHATS
-- ----------------------------------------------------------------------------
alter table public.purchases
  add column if not exists deliverer_id    uuid references public.delivery_persons(id) on delete set null,
  add column if not exists deliverer_name  text,
  add column if not exists deliverer_cost  numeric(14,2) not null default 0,
  add column if not exists deliverer_paid  numeric(14,2) not null default 0;

create index if not exists purchases_deliverer_idx on public.purchases (deliverer_id);

comment on column public.purchases.deliverer_id is
  'Livreur (facultatif) affecte a cette facture d''achat.';
comment on column public.purchases.deliverer_cost is
  'Cout de transport fixe au livreur pour cette facture.';
comment on column public.purchases.deliverer_paid is
  'Montant deja paye au livreur au moment de l''achat.';


-- ----------------------------------------------------------------------------
-- 03. REGLEMENTS DIRECTS AU LIVREUR  (bouton « Payer la dette »)
-- ----------------------------------------------------------------------------
create table if not exists public.deliverer_payments (
  id              uuid primary key default gen_random_uuid(),
  deliverer_id    uuid not null references public.delivery_persons(id) on delete cascade,
  deliverer_name  text,
  amount          numeric(14,2) not null default 0,
  date            date not null default current_date,
  paid_at         timestamptz not null default now(),
  notes           text default '',
  method          text not null default 'especes',
  cheque_number   text,
  virement_number text,
  bank_name       text,
  created_by      text default public.current_username(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists deliverer_payments_deliverer_idx
  on public.deliverer_payments (deliverer_id, paid_at desc);

alter table public.deliverer_payments drop constraint if exists deliverer_payments_method_chk;
alter table public.deliverer_payments
  add constraint deliverer_payments_method_chk
  check (method in ('especes', 'cheque', 'virement'));


-- ----------------------------------------------------------------------------
-- 04. CAISSE — le reglement au livreur SORT de la caisse
-- ----------------------------------------------------------------------------
create or replace function public.trg_deliverer_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.caisse_transactions
    (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('withdrawal', new.amount, new.date,
          'Reglement livreur: ' || coalesce(new.deliverer_name, '')
            || ' (' || public.payment_method_label(
                 new.method, new.cheque_number, new.virement_number, new.bank_name) || ')',
          'Livreurs', 'deliverer_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do update
     set amount = excluded.amount, date = excluded.date,
         description = excluded.description, updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_deliverer_payment_caisse on public.deliverer_payments;
create trigger trg_deliverer_payment_caisse
  after insert or update of amount, date, method, cheque_number, virement_number, bank_name
  on public.deliverer_payments
  for each row execute function public.trg_deliverer_payment_to_caisse();

drop trigger if exists trg_deliverer_payment_caisse_del on public.deliverer_payments;
create trigger trg_deliverer_payment_caisse_del
  before delete on public.deliverer_payments
  for each row execute function public.trg_delete_linked_caisse();


-- ----------------------------------------------------------------------------
-- 05. BOUTON « PAYER LA DETTE » D'UNE CARTE LIVREUR
-- ----------------------------------------------------------------------------
create or replace function public.pay_deliverer(
  p_deliverer_id uuid,
  p_amount numeric,
  p_paid_at timestamptz default now(),
  p_notes text default '',
  p_method text default 'especes',
  p_cheque_number text default null,
  p_virement_number text default null,
  p_bank_name text default null
) returns public.deliverer_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.deliverer_payments;
  v_name   text;
  v_method text := lower(coalesce(nullif(btrim(p_method), ''), 'especes'));
begin
  if not public.has_perm('suppliers', 'pay') and not public.has_perm('suppliers', 'edit') then
    raise exception 'Vous n''avez pas la permission de regler un livreur';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;
  if v_method not in ('especes', 'cheque', 'virement') then
    raise exception 'Mode de reglement inconnu : %', p_method;
  end if;

  select name into v_name from public.delivery_persons where id = p_deliverer_id;

  insert into public.deliverer_payments (
    deliverer_id, deliverer_name, amount, date, paid_at, notes,
    method, cheque_number, virement_number, bank_name
  )
  values (
    p_deliverer_id, v_name, p_amount,
    coalesce(p_paid_at, now())::date, coalesce(p_paid_at, now()), coalesce(p_notes, ''),
    v_method,
    case when v_method = 'cheque'   then nullif(btrim(p_cheque_number), '')   end,
    case when v_method = 'virement' then nullif(btrim(p_virement_number), '') end,
    case when v_method <> 'especes' then nullif(btrim(p_bank_name), '')       end
  )
  returning * into v_row;

  perform public.log_activity('suppliers', 'pay', 'deliverer_payments', v_row.id,
    jsonb_build_object('amount', p_amount, 'method', v_method));
  return v_row;
end;
$$;


-- ----------------------------------------------------------------------------
-- 06. MODIFIER / SUPPRIMER UN REGLEMENT LIVREUR
-- ----------------------------------------------------------------------------
create or replace function public.update_deliverer_payment(
  p_id uuid,
  p_amount numeric,
  p_paid_at timestamptz default null,
  p_notes text default null,
  p_method text default null,
  p_cheque_number text default null,
  p_virement_number text default null,
  p_bank_name text default null
) returns public.deliverer_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    public.deliverer_payments;
  v_row    public.deliverer_payments;
  v_method text;
begin
  select * into v_old from public.deliverer_payments where id = p_id;
  if v_old.id is null then raise exception 'Reglement introuvable'; end if;

  v_method := lower(coalesce(nullif(btrim(p_method), ''), v_old.method, 'especes'));
  if v_method not in ('especes', 'cheque', 'virement') then
    raise exception 'Mode de reglement inconnu : %', p_method;
  end if;

  update public.deliverer_payments
     set amount          = coalesce(p_amount, amount),
         paid_at         = coalesce(p_paid_at, paid_at),
         date            = coalesce(p_paid_at, paid_at)::date,
         notes           = coalesce(p_notes, notes),
         method          = v_method,
         cheque_number   = case when v_method = 'cheque'   then nullif(btrim(coalesce(p_cheque_number, cheque_number)), '') end,
         virement_number = case when v_method = 'virement' then nullif(btrim(coalesce(p_virement_number, virement_number)), '') end,
         bank_name       = case when v_method <> 'especes' then nullif(btrim(coalesce(p_bank_name, bank_name)), '') end,
         updated_at      = now()
   where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.delete_deliverer_payment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.deliverer_payments where id = p_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- 07. AFFECTER UN LIVREUR A UNE FACTURE D'ACHAT
-- ----------------------------------------------------------------------------
--  Appele apres create_purchase / update_purchase pour poser le livreur, son
--  cout et ce qui lui a ete paye. Le montant paye au livreur SORT de la caisse
--  (ecriture dediee, nettoyee si l'achat est supprime ou le livreur retire).
create or replace function public.set_purchase_deliverer(
  p_purchase_id uuid,
  p_deliverer_id uuid default null,
  p_cost numeric default 0,
  p_paid numeric default 0
) returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.purchases;
  v_name     text;
  v_cost     numeric := greatest(0, coalesce(p_cost, 0));
  v_paid     numeric := greatest(0, coalesce(p_paid, 0));
begin
  select * into v_purchase from public.purchases where id = p_purchase_id;
  if v_purchase.id is null then raise exception 'Facture introuvable'; end if;

  if p_deliverer_id is not null then
    select name into v_name from public.delivery_persons where id = p_deliverer_id;
  end if;

  update public.purchases
     set deliverer_id   = p_deliverer_id,
         deliverer_name = v_name,
         deliverer_cost = case when p_deliverer_id is null then 0 else v_cost end,
         deliverer_paid = case when p_deliverer_id is null then 0 else v_paid end,
         updated_at     = now()
   where id = p_purchase_id
  returning * into v_purchase;

  -- Ce qui a ete paye au livreur a la creation de l'achat = sortie de caisse.
  if p_deliverer_id is not null and v_paid > 0 then
    insert into public.caisse_transactions
      (type, amount, date, description, category_name, ref_table, ref_id, created_by)
    values ('withdrawal', v_paid, v_purchase.date,
            'Paye au livreur: ' || coalesce(v_name, '') || ' — achat ' || v_purchase.reference,
            'Livreurs', 'purchase_deliverer', v_purchase.id, public.current_username())
    on conflict (ref_table, ref_id) do update
       set amount = excluded.amount, date = excluded.date,
           description = excluded.description, updated_at = now();
  else
    delete from public.caisse_transactions
     where ref_table = 'purchase_deliverer' and ref_id = v_purchase.id;
  end if;

  perform public.log_activity('purchase', 'deliverer', 'purchases', v_purchase.id,
    jsonb_build_object('deliverer_id', p_deliverer_id, 'cost', v_cost, 'paid', v_paid));
  return v_purchase;
end;
$$;

-- Nettoie l'ecriture de caisse « paye au livreur » quand l'achat est supprime.
create or replace function public.trg_purchase_deliverer_caisse_del()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.caisse_transactions
   where ref_table = 'purchase_deliverer' and ref_id = old.id;
  return old;
end;
$$;
drop trigger if exists trg_purchase_deliverer_caisse_del on public.purchases;
create trigger trg_purchase_deliverer_caisse_del
  before delete on public.purchases
  for each row execute function public.trg_purchase_deliverer_caisse_del();


-- ----------------------------------------------------------------------------
-- 08. SECURITE (RLS) — alignee sur le module « suppliers »
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('delivery_persons',   'suppliers'),
      ('deliverer_payments', 'suppliers')
    ) as t(tbl, module)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);

    execute format('drop policy if exists %I on public.%I', r.tbl || '_sel', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_ins', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_upd', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_del', r.tbl);

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_perm(%L, ''view''))',
      r.tbl || '_sel', r.tbl, r.module);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_perm(%L, ''create''))',
      r.tbl || '_ins', r.tbl, r.module);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_perm(%L, ''edit'')) with check (public.has_perm(%L, ''edit''))',
      r.tbl || '_upd', r.tbl, r.module, r.module);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_perm(%L, ''delete''))',
      r.tbl || '_del', r.tbl, r.module);
  end loop;
end
$$;


-- ----------------------------------------------------------------------------
-- 09. DROITS D'EXECUTION
-- ----------------------------------------------------------------------------
grant execute on function public.pay_deliverer(uuid, numeric, timestamptz, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.update_deliverer_payment(uuid, numeric, timestamptz, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.delete_deliverer_payment(uuid) to authenticated, service_role;
grant execute on function public.set_purchase_deliverer(uuid, uuid, numeric, numeric) to authenticated, service_role;

-- FIN DE LA MISE A JOUR LIVREURS
