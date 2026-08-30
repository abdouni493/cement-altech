-- ============================================================================
--  ALTECH PRODUCTION — CIMENT BLIDA
--  Full PostgreSQL / Supabase database schema
-- ----------------------------------------------------------------------------
--  Project : https://mkzgwfagkhtfytkvlzwb.supabase.co
--  Engine  : PostgreSQL 15 (Supabase)
--  Usage   : paste the WHOLE file in Supabase Studio > SQL Editor > Run.
--            The script is idempotent: it can be executed several times.
-- ----------------------------------------------------------------------------
--  CONTENT
--   00. Extensions & enums
--   01. Helper functions (updated_at, current user, permissions)
--   02. Identity      : roles, workers, profiles  (linked to auth.users)
--   03. Reference data: marques, categories, units
--   04. Stock         : products
--   05. Suppliers     : suppliers, purchases, purchase_lines, purchase_payments
--   06. Clients       : clients, client_debts, client_debt_versements
--   07. Sales / POS   : sales, sale_lines, sale_payments
--   08. Commands      : commands, command_items
--   09. Production    : fiche_technics, productions, used products
--   10. Comptoir      : comptoir_items, destructions
--   11. Workers HR    : acomptes, absences, salary payments
--   12. Expenses      : expenses
--   13. Caisse        : caisse_transactions, caisse_reports, caisse_settings
--   14. Settings      : store_settings, activity_log
--   15. BUTTON ACTIONS: every RPC behind a button of the application
--   16. TRIGGERS      : automatic stock / caisse propagation
--   17. VIEWS         : dashboard, statistics & reports screens
--   18. RLS           : row level security mapped on the app permission modules
--   19. INITIAL CONFIG: empty database — only the two singleton config rows
--   20. GRANTS / REALTIME
-- ----------------------------------------------------------------------------
--  INTERFACE  ->  TABLE / VIEW  MAP
--   /login                 profiles, auth.users, resolve_login_email(),
--                          admin_account_exists(), create_admin_account()
--   /dashboard             v_dashboard_kpis, v_stock_alerts, v_sales_daily
--   /stock                 products, marques, categories, units
--   /purchase              purchases, purchase_lines, purchase_payments
--   /production            productions, production_used_products, fiche_technics
--   /comptoir              comptoir_items, destructions
--   /pos                   sales, sale_lines, sale_payments, comptoir_items
--   /sales                 sales (+ v_sales_summary)
--   /clients               clients
--   /clients/commands      commands, command_items
--   /suppliers             suppliers (+ v_supplier_balances)
--   /workers               workers, worker_acomptes, worker_absences,
--                          worker_payments, worker permissions (jsonb)
--   /expenses              expenses, expense_categories
--   /expenses/debts        client_debts, client_debt_versements
--   /caisse                caisse_transactions, caisse_categories
--   /caisse/reports        caisse_reports (+ v_caisse_report_detail)
--   /caisse/statistics     v_comptoir_stats
--   /reports               v_reports_monthly, v_profit_and_loss
--   /settings              store_settings, profiles
-- ============================================================================


-- ============================================================================
-- 00. EXTENSIONS & ENUMS
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'worker');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_type') then
    create type public.payment_type as enum ('monthly', 'daily');
  end if;
  if not exists (select 1 from pg_type where typname = 'sale_status') then
    create type public.sale_status as enum ('paid', 'debt');
  end if;
  if not exists (select 1 from pg_type where typname = 'command_status') then
    create type public.command_status as enum ('pending', 'finalised', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'caisse_tx_type') then
    create type public.caisse_tx_type as enum ('deposit', 'withdrawal');
  end if;
  if not exists (select 1 from pg_type where typname = 'caisse_report_type') then
    create type public.caisse_report_type as enum ('day', 'period');
  end if;
  if not exists (select 1 from pg_type where typname = 'used_source_type') then
    create type public.used_source_type as enum ('stock', 'fiche');
  end if;
end
$$;


-- ============================================================================
-- 01. HELPER FUNCTIONS
-- ============================================================================

-- keeps updated_at fresh on every UPDATE
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- NOTE: the three helpers below read `public.profiles`, which is created later
-- in the script. They are written in PL/pgSQL on purpose: a LANGUAGE SQL body is
-- resolved against the catalog at CREATE time and would fail here, while a
-- PL/pgSQL body is only resolved when it actually runs.

-- username stamped on every "created_by" column (mirrors getCurrentUsername())
create or replace function public.current_username()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_name text;
begin
  if auth.uid() is null then
    return 'system';
  end if;
  select coalesce(username, full_name, 'system') into v_name
    from public.profiles where id = auth.uid();
  return coalesce(v_name, 'system');
end;
$$;

create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_is_admin boolean;
begin
  if auth.uid() is null then
    return false;
  end if;
  select (role = 'admin') into v_is_admin from public.profiles where id = auth.uid();
  return coalesce(v_is_admin, false);
end;
$$;

-- Maps the application permission matrix (module -> {view,create,edit,delete,pay})
-- onto the database. Admins always pass.
create or replace function public.has_perm(p_module text, p_action text default 'view')
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role  public.user_role;
  v_perms jsonb;
begin
  if auth.uid() is null then
    return false;
  end if;

  select role, permissions into v_role, v_perms
  from public.profiles
  where id = auth.uid();

  if v_role is null then
    return false;
  end if;

  if v_role = 'admin' then
    return true;
  end if;

  return coalesce((v_perms -> p_module ->> p_action)::boolean, false);
end;
$$;

-- Login page: allows signing in with a USERNAME instead of an e-mail.
-- The client calls this with the typed identifier, then signs in with the e-mail.
create or replace function public.resolve_login_email(p_identifier text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_email text;
begin
  select p.email into v_email
    from public.profiles p
   where p.is_active
     and (lower(p.username) = lower(trim(p_identifier))
       or lower(p.email)    = lower(trim(p_identifier)))
   order by (lower(p.email) = lower(trim(p_identifier))) desc
   limit 1;
  return v_email;
end;
$$;


-- ============================================================================
-- 02. IDENTITY : roles / workers / profiles
-- ============================================================================

create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.workers (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  birthday        date,
  id_card_number  text,
  phone           text,
  role_id         uuid references public.roles(id) on delete set null,
  -- salary
  payment_enabled boolean not null default true,
  payment_type    public.payment_type not null default 'monthly',
  payment_amount  numeric(14,2) not null default 0,
  start_date      date not null default current_date,
  -- login account
  has_account     boolean not null default false,
  email           text,
  username        text,
  user_id         uuid references auth.users(id) on delete set null,
  permissions     jsonb not null default '{}'::jsonb,
  is_active       boolean not null default true,
  created_by      text default public.current_username(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists workers_username_key on public.workers (lower(username)) where username is not null;
create index if not exists workers_role_idx on public.workers (role_id);

-- Application user profile. One row per auth.users row.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null default '',
  username     text,
  email        text not null,
  role         public.user_role not null default 'worker',
  permissions  jsonb not null default '{}'::jsonb,   -- '{}' for admin = full access
  worker_id    uuid references public.workers(id) on delete set null,
  language     text not null default 'fr',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists profiles_username_key on public.profiles (lower(username)) where username is not null;
create unique index if not exists profiles_email_key    on public.profiles (lower(email));

-- Any new auth.users row automatically gets its profile.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  -- An account only becomes an administrator when it is explicitly created as
  -- one (create_admin_account / seed). Anything else defaults to a worker with
  -- no permission at all.
  v_role := coalesce(nullif(new.raw_user_meta_data ->> 'role', '')::public.user_role, 'worker');

  insert into public.profiles (id, email, full_name, username, role, permissions, worker_id)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name',
             split_part(new.email, '@', 1)),
    lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))),
    v_role,
    coalesce(new.raw_user_meta_data -> 'permissions', '{}'::jsonb),
    nullif(new.raw_user_meta_data ->> 'worker_id', '')::uuid
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = excluded.full_name,
        username   = excluded.username,
        role       = excluded.role,
        updated_at = now();

  -- keep the worker row in sync when the account belongs to a worker
  if (new.raw_user_meta_data ->> 'worker_id') is not null then
    update public.workers
       set user_id = new.id, has_account = true, email = lower(new.email)
     where id = (new.raw_user_meta_data ->> 'worker_id')::uuid;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Worker permissions edited in /workers > "Permissions" are pushed to the profile
create or replace function public.sync_worker_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    update public.profiles
       set permissions = new.permissions,
           full_name   = new.full_name,
           username    = lower(coalesce(new.username, username)),
           is_active   = new.is_active and new.has_account,
           worker_id   = new.id,
           role        = 'worker',
           updated_at  = now()
     where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_worker_permissions on public.workers;
create trigger trg_sync_worker_permissions
  after update of permissions, full_name, username, is_active, has_account on public.workers
  for each row execute function public.sync_worker_permissions();


-- ============================================================================
-- 03. REFERENCE DATA  (/stock selects, /production, /expenses, /caisse)
-- ============================================================================

create table if not exists public.marques (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (           -- stock categories
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.units (                -- m3, Tonne, Sac, kg, litre...
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.production_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.fiche_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.caisse_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);


-- ============================================================================
-- 04. STOCK  (/stock)
-- ============================================================================

create table if not exists public.products (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text default '',
  barcode             text,
  marque_id           uuid references public.marques(id)    on delete set null,
  category_id         uuid references public.categories(id) on delete set null,
  principal_quantity  numeric(14,3) not null default 0,   -- total ever entered
  current_quantity    numeric(14,3) not null default 0,   -- live stock
  min_alert_quantity  numeric(14,3) not null default 0,
  purchase_price      numeric(14,2) not null default 0,
  unit_enabled        boolean not null default false,     -- "achat au détail"
  unit                text,
  expiration_enabled  boolean not null default false,
  expiration_date     date,
  is_active           boolean not null default true,
  created_by          text default public.current_username(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint products_qty_positive check (current_quantity >= 0)
);
create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_marque_idx   on public.products (marque_id);
create unique index if not exists products_barcode_key on public.products (barcode) where barcode is not null and barcode <> '';

-- Every stock movement is journalised (entry / exit / production / sale / loss)
create table if not exists public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  quantity    numeric(14,3) not null,           -- >0 entry, <0 exit
  reason      text not null,                    -- purchase | sale | production | manual | destruction
  ref_table   text,
  ref_id      uuid,
  balance_after numeric(14,3),
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id, created_at desc);


-- ============================================================================
-- 05. SUPPLIERS & PURCHASES  (/suppliers, /purchase)
-- ============================================================================

create table if not exists public.suppliers (
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

create table if not exists public.purchases (
  id           uuid primary key default gen_random_uuid(),
  reference    text not null unique,
  supplier_id  uuid references public.suppliers(id) on delete set null,
  date         date not null default current_date,
  total_amount numeric(14,2) not null default 0,
  paid_amount  numeric(14,2) not null default 0,
  rest_amount  numeric(14,2) not null default 0,
  note         text,
  created_by   text default public.current_username(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists purchases_supplier_idx on public.purchases (supplier_id);
create index if not exists purchases_date_idx     on public.purchases (date desc);

create table if not exists public.purchase_lines (
  id                 uuid primary key default gen_random_uuid(),
  purchase_id        uuid not null references public.purchases(id) on delete cascade,
  product_id         uuid references public.products(id) on delete set null,
  product_name       text not null,
  quantity           numeric(14,3) not null default 0,
  purchase_price     numeric(14,2) not null default 0,
  min_alert_quantity numeric(14,3),
  unit_enabled       boolean not null default false,
  unit               text,
  expiration_enabled boolean not null default false,
  expiration_date    date,
  line_total         numeric(14,2) generated always as (quantity * purchase_price) stored,
  created_at         timestamptz not null default now()
);
create index if not exists purchase_lines_purchase_idx on public.purchase_lines (purchase_id);

create table if not exists public.purchase_payments (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  date        date not null default current_date,
  amount      numeric(14,2) not null,
  description text default 'Règlement fournisseur',
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now()
);
create index if not exists purchase_payments_purchase_idx on public.purchase_payments (purchase_id);


-- ============================================================================
-- 06. CLIENTS & CLIENT DEBTS  (/clients, /expenses/debts)
-- ============================================================================

create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  address     text,
  note        text,
  is_passager boolean not null default false,   -- shared walk-in client
  is_active   boolean not null default true,
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists clients_passager_key on public.clients (is_passager) where is_passager;

create table if not exists public.client_debts (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.clients(id) on delete set null,
  client_name  text not null,
  client_phone text,
  total_debt   numeric(14,2) not null default 0,
  total_paid   numeric(14,2) not null default 0,
  rest_amount  numeric(14,2) not null default 0,
  date         date not null default current_date,
  description  text default '',
  created_by   text default public.current_username(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists client_debts_client_idx on public.client_debts (client_id);

create table if not exists public.client_debt_versements (
  id          uuid primary key default gen_random_uuid(),
  debt_id     uuid not null references public.client_debts(id) on delete cascade,
  client_id   uuid references public.clients(id) on delete set null,
  client_name text not null,
  amount      numeric(14,2) not null,
  date        date not null default current_date,
  notes       text,
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now()
);
create index if not exists client_debt_versements_debt_idx on public.client_debt_versements (debt_id);


-- ============================================================================
-- 07. SALES / POS  (/pos, /sales)
-- ============================================================================

create table if not exists public.sales (
  id           uuid primary key default gen_random_uuid(),
  reference    text not null unique,
  client_id    uuid references public.clients(id) on delete set null,
  date         date not null default current_date,
  total_amount numeric(14,2) not null default 0,
  reduction    numeric(14,2) not null default 0,
  final_amount numeric(14,2) not null default 0,
  paid_amount  numeric(14,2) not null default 0,
  rest_amount  numeric(14,2) not null default 0,
  status       public.sale_status not null default 'paid',
  note         text,
  created_by   text default public.current_username(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists sales_client_idx on public.sales (client_id);
create index if not exists sales_date_idx   on public.sales (date desc);
create index if not exists sales_status_idx on public.sales (status);

create table if not exists public.sale_lines (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references public.sales(id) on delete cascade,
  product_id    uuid,                       -- product OR comptoir item
  comptoir_id   uuid,
  product_name  text not null,
  quantity      numeric(14,3) not null default 0,
  selling_price numeric(14,2) not null default 0,
  sell_by_unit  boolean not null default false,
  unit          text,
  line_total    numeric(14,2) generated always as (quantity * selling_price) stored,
  created_at    timestamptz not null default now()
);
create index if not exists sale_lines_sale_idx on public.sale_lines (sale_id);

create table if not exists public.sale_payments (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references public.sales(id) on delete cascade,
  date        date not null default current_date,
  amount      numeric(14,2) not null,
  description text default 'Paiement vente',
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now()
);
create index if not exists sale_payments_sale_idx on public.sale_payments (sale_id);


-- ============================================================================
-- 08. COMMANDS  (/clients/commands)
-- ============================================================================

create table if not exists public.commands (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique,
  client_id      uuid references public.clients(id) on delete set null,
  client_name    text not null,
  client_phone   text,
  receive_date   date,
  receive_hour   text,
  receive_minute text,
  total_amount   numeric(14,2) not null default 0,
  advance_paid   numeric(14,2) not null default 0,
  paid_amount    numeric(14,2) not null default 0,
  rest_amount    numeric(14,2) not null default 0,
  status         public.command_status not null default 'pending',
  notes          text,
  created_by     text default public.current_username(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists commands_client_idx on public.commands (client_id);
create index if not exists commands_status_idx on public.commands (status);

create table if not exists public.command_items (
  id              uuid primary key default gen_random_uuid(),
  command_id      uuid not null references public.commands(id) on delete cascade,
  product_id      uuid,
  fiche_technic_id uuid,
  product_name    text not null,
  quantity        numeric(14,3) not null default 0,
  unit_price      numeric(14,2) not null default 0,
  total_price     numeric(14,2) not null default 0,
  sell_by_unit    boolean not null default false,
  sell_unit       text,
  created_at      timestamptz not null default now()
);
create index if not exists command_items_command_idx on public.command_items (command_id);


-- ============================================================================
-- 09. PRODUCTION & FICHES TECHNIQUES  (/production)
-- ============================================================================

create table if not exists public.fiche_technics (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  category_id         uuid references public.fiche_categories(id) on delete set null,
  category_name       text,
  description         text default '',
  sell_by_unit        boolean not null default false,
  sell_unit           text,
  usable_in_production boolean not null default false,
  product_unit        text,
  output_quantity     numeric(14,3) not null default 1,
  unit_price          numeric(14,2) not null default 0,
  total_cost          numeric(14,2) not null default 0,
  cost_per_unit       numeric(14,2) not null default 0,
  total_value         numeric(14,2) not null default 0,
  gains_per_unit      numeric(14,2) not null default 0,
  total_gains         numeric(14,2) not null default 0,
  created_by          text default public.current_username(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.fiche_technic_lines (
  id               uuid primary key default gen_random_uuid(),
  fiche_technic_id uuid not null references public.fiche_technics(id) on delete cascade,
  product_id       uuid,
  product_name     text not null,
  quantity_used    numeric(14,3) not null default 0,
  source_type      public.used_source_type not null default 'stock',
  unit             text,
  unit_cost        numeric(14,2) not null default 0,
  line_cost        numeric(14,2) not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists fiche_lines_fiche_idx on public.fiche_technic_lines (fiche_technic_id);

create table if not exists public.productions (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text default '',
  date              date not null default current_date,
  hour              text,
  category_id       uuid references public.production_categories(id) on delete set null,
  category_name     text,
  fiche_technic_id  uuid references public.fiche_technics(id) on delete set null,
  total_cost        numeric(14,2) not null default 0,
  output_quantity   numeric(14,3) not null default 0,
  unit_price        numeric(14,2) not null default 0,
  total_value       numeric(14,2) not null default 0,
  sell_by_unit      boolean not null default false,
  sell_unit         text,
  sent_to_comptoir  numeric(14,3) not null default 0,
  -- production loss ("perte")
  has_loss          boolean not null default false,
  expected_quantity numeric(14,3),
  loss_quantity     numeric(14,3) default 0,
  loss_description  text,
  loss_value        numeric(14,2) default 0,
  created_by        text default public.current_username(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint productions_sent_lte_output check (sent_to_comptoir <= output_quantity)
);
create index if not exists productions_date_idx on public.productions (date desc);

create table if not exists public.production_used_products (
  id            uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  product_id    uuid,
  product_name  text not null,
  quantity_used numeric(14,3) not null default 0,
  source_type   public.used_source_type not null default 'stock',
  unit          text,
  unit_cost     numeric(14,2) not null default 0,
  line_cost     numeric(14,2) not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists production_used_idx on public.production_used_products (production_id);


-- ============================================================================
-- 10. COMPTOIR  (/comptoir)
-- ============================================================================

create table if not exists public.comptoir_items (
  id            uuid primary key default gen_random_uuid(),
  production_id uuid references public.productions(id) on delete set null,
  product_name  text not null,
  description   text,
  quantity      numeric(14,3) not null default 0,
  unit_price    numeric(14,2) not null default 0,
  date          date not null default current_date,
  category_id   uuid,
  category_name text,
  sell_by_unit  boolean not null default false,
  unit          text,
  created_by    text default public.current_username(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint comptoir_qty_positive check (quantity >= 0)
);

create table if not exists public.destructions (
  id           uuid primary key default gen_random_uuid(),
  comptoir_id  uuid references public.comptoir_items(id) on delete set null,
  product_name text not null,
  quantity     numeric(14,3) not null default 0,
  value        numeric(14,2) not null default 0,
  reason       text default '',
  date         date not null default current_date,
  unit         text,
  created_by   text default public.current_username(),
  created_at   timestamptz not null default now()
);


-- ============================================================================
-- 11. WORKERS HR  (/workers)
-- ============================================================================

create table if not exists public.worker_acomptes (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.workers(id) on delete cascade,
  date        date not null default current_date,
  amount      numeric(14,2) not null default 0,
  description text default '',
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now()
);
create index if not exists worker_acomptes_worker_idx on public.worker_acomptes (worker_id);

create table if not exists public.worker_absences (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.workers(id) on delete cascade,
  date        date not null default current_date,
  description text default '',
  cost        numeric(14,2) not null default 0,
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now()
);
create index if not exists worker_absences_worker_idx on public.worker_absences (worker_id);

create table if not exists public.worker_payments (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.workers(id) on delete cascade,
  date        date not null default current_date,
  period      text,                       -- "2026-07" / "Juillet 2026"
  amount      numeric(14,2) not null default 0,
  description text default '',
  created_by  text default public.current_username(),
  created_at  timestamptz not null default now()
);
create index if not exists worker_payments_worker_idx on public.worker_payments (worker_id);


-- ============================================================================
-- 12. EXPENSES  (/expenses)
-- ============================================================================

create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text default '',
  amount        numeric(14,2) not null default 0,
  date          date not null default current_date,
  category_id   uuid references public.expense_categories(id) on delete set null,
  category_name text,
  created_by    text default public.current_username(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (date desc);


-- ============================================================================
-- 13. CAISSE  (/caisse, /caisse/reports)
-- ============================================================================

create table if not exists public.caisse_transactions (
  id            uuid primary key default gen_random_uuid(),
  type          public.caisse_tx_type not null,
  amount        numeric(14,2) not null,
  date          date not null default current_date,
  description   text default '',
  category_id   uuid references public.caisse_categories(id) on delete set null,
  category_name text,
  ref_table     text,        -- sale_payments | purchase_payments | expenses | ...
  ref_id        uuid,        -- source row, used to avoid double counting
  created_by    text default public.current_username(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists caisse_tx_date_idx on public.caisse_transactions (date desc);
-- Guarantees one caisse line per source row. NULLs are distinct in PostgreSQL,
-- so manual transactions (no ref) are not constrained. Kept non-partial so the
-- triggers can use `on conflict (ref_table, ref_id)`.
create unique index if not exists caisse_tx_ref_key on public.caisse_transactions (ref_table, ref_id);

create table if not exists public.caisse_reports (
  id              uuid primary key default gen_random_uuid(),
  report_type     public.caisse_report_type not null default 'day',
  date            date not null default current_date,
  end_date        date,
  hour            text,
  description     text default '',
  declared_amount numeric(14,2) not null default 0,
  theoretical_amount numeric(14,2) not null default 0,
  gap_amount      numeric(14,2) not null default 0,   -- décalage
  created_by      text default public.current_username(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- single-row configuration (caisse opening balance)
create table if not exists public.caisse_settings (
  id              boolean primary key default true,
  initial_balance numeric(14,2) not null default 0,
  updated_at      timestamptz not null default now(),
  constraint caisse_settings_singleton check (id)
);


-- ============================================================================
-- 14. STORE SETTINGS & AUDIT  (/settings)
-- ============================================================================

create table if not exists public.store_settings (
  id           boolean primary key default true,
  logo         text,
  name         text not null default 'Altech Production',
  description  text default 'Vente & Fabrication de Ciment',
  email        text default '',
  phone        text default '',
  address      text default '',
  social_media text default '',
  nif          text default '',
  nis          text default '',
  article      text default '',
  rc           text default '',
  currency     text default 'DA',
  updated_at   timestamptz not null default now(),
  constraint store_settings_singleton check (id)
);

create table if not exists public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  username   text,
  module     text,
  action     text,
  ref_table  text,
  ref_id     uuid,
  details    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_created_idx on public.activity_log (created_at desc);

create or replace function public.log_activity(
  p_module text, p_action text, p_ref_table text default null,
  p_ref_id uuid default null, p_details jsonb default null
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.activity_log (user_id, username, module, action, ref_table, ref_id, details)
  values (auth.uid(), public.current_username(), p_module, p_action, p_ref_table, p_ref_id, p_details);
$$;


-- ============================================================================
-- 15. BUTTON ACTIONS  —  one RPC per action button of the application
-- ============================================================================

-- ---------------------------------------------------------------- /stock ----
-- Button "Ajouter au stock" / manual adjustment
create or replace function public.adjust_stock(
  p_product_id uuid, p_quantity numeric, p_reason text default 'manual'
) returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare v_product public.products;
begin
  update public.products
     set current_quantity   = greatest(0, current_quantity + p_quantity),
         principal_quantity = case when p_quantity > 0
                                   then principal_quantity + p_quantity
                                   else principal_quantity end,
         updated_at = now()
   where id = p_product_id
  returning * into v_product;

  if v_product.id is null then
    raise exception 'Produit introuvable (%)', p_product_id;
  end if;

  insert into public.stock_movements (product_id, quantity, reason, balance_after)
  values (p_product_id, p_quantity, p_reason, v_product.current_quantity);

  return v_product;
end;
$$;

-- Internal: consume stock (used by production & sales)
create or replace function public.consume_stock(
  p_product_id uuid, p_quantity numeric, p_reason text,
  p_ref_table text default null, p_ref_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_left numeric;
begin
  update public.products
     set current_quantity = greatest(0, current_quantity - p_quantity),
         updated_at = now()
   where id = p_product_id
  returning current_quantity into v_left;

  if v_left is not null then
    insert into public.stock_movements (product_id, quantity, reason, ref_table, ref_id, balance_after)
    values (p_product_id, -p_quantity, p_reason, p_ref_table, p_ref_id, v_left);
  end if;
end;
$$;

-- ------------------------------------------------------------- /purchase ----
-- Button "Enregistrer l'achat" (CreatePurchase) — creates the purchase,
-- its lines, its first payment and updates the stock in one transaction.
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

  insert into public.purchases (reference, supplier_id, date, total_amount, paid_amount, rest_amount, note, created_by)
  values (v_ref,
          nullif(p_payload ->> 'supplier_id', '')::uuid,
          v_date, v_total, v_paid, greatest(0, v_total - v_paid),
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

-- Button "Payer" on a supplier debt  (PayDebtModal)
create or replace function public.pay_supplier_debt(
  p_purchase_id uuid, p_amount numeric, p_date date default current_date,
  p_description text default 'Règlement fournisseur'
) returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare v_purchase public.purchases;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  insert into public.purchase_payments (purchase_id, date, amount, description)
  values (p_purchase_id, coalesce(p_date, current_date), p_amount, p_description);

  update public.purchases
     set paid_amount = least(total_amount, paid_amount + p_amount),
         rest_amount = greatest(0, total_amount - least(total_amount, paid_amount + p_amount)),
         updated_at  = now()
   where id = p_purchase_id
  returning * into v_purchase;

  perform public.log_activity('purchase', 'pay', 'purchases', p_purchase_id,
                              jsonb_build_object('amount', p_amount));
  return v_purchase;
end;
$$;

-- ------------------------------------------------------------ /pos /sales ----
-- Button "Valider la vente" (POS) — sale + lines + payment + stock + caisse
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
                            paid_amount, rest_amount, status, note, created_by)
  values (v_ref, nullif(p_payload ->> 'client_id', '')::uuid, v_date,
          v_total, v_red, v_final, v_paid, v_rest, v_status,
          p_payload ->> 'note', public.current_username())
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

-- Button "Payer la dette" on a sale (/sales, PayDebtModal)
create or replace function public.pay_sale_debt(
  p_sale_id uuid, p_amount numeric, p_date date default current_date,
  p_description text default 'Règlement dette'
) returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare v_sale public.sales;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  insert into public.sale_payments (sale_id, date, amount, description)
  values (p_sale_id, coalesce(p_date, current_date), p_amount, p_description);

  update public.sales
     set paid_amount = least(final_amount, paid_amount + p_amount),
         rest_amount = greatest(0, final_amount - least(final_amount, paid_amount + p_amount)),
         status      = case when greatest(0, final_amount - least(final_amount, paid_amount + p_amount)) = 0
                            then 'paid'::public.sale_status else 'debt'::public.sale_status end,
         updated_at  = now()
   where id = p_sale_id
  returning * into v_sale;

  perform public.log_activity('sales', 'pay', 'sales', p_sale_id, jsonb_build_object('amount', p_amount));
  return v_sale;
end;
$$;

-- --------------------------------------------------------------- /clients ----
-- Button "Nouvelle dette client"
create or replace function public.add_client_debt(
  p_client_id uuid, p_total_debt numeric,
  p_date date default current_date, p_description text default ''
) returns public.client_debts
language plpgsql
security definer
set search_path = public
as $$
declare v_debt public.client_debts;
begin
  insert into public.client_debts (client_id, client_name, client_phone, total_debt, total_paid,
                                   rest_amount, date, description, created_by)
  select p_client_id, c.name, c.phone, p_total_debt, 0, p_total_debt,
         coalesce(p_date, current_date), p_description, public.current_username()
    from public.clients c where c.id = p_client_id
  returning * into v_debt;

  if v_debt.id is null then
    raise exception 'Client introuvable (%)', p_client_id;
  end if;
  return v_debt;
end;
$$;

-- Button "Ajouter un versement" — also registers a caisse deposit
create or replace function public.add_client_debt_versement(
  p_debt_id uuid, p_amount numeric,
  p_date date default current_date, p_notes text default null
) returns public.client_debt_versements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debt public.client_debts;
  v_vers public.client_debt_versements;
begin
  select * into v_debt from public.client_debts where id = p_debt_id;
  if v_debt.id is null then
    raise exception 'Dette introuvable (%)', p_debt_id;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  insert into public.client_debt_versements (debt_id, client_id, client_name, amount, date, notes, created_by)
  values (p_debt_id, v_debt.client_id, v_debt.client_name, p_amount,
          coalesce(p_date, current_date), p_notes, public.current_username())
  returning * into v_vers;

  update public.client_debts
     set total_paid  = total_paid + p_amount,
         rest_amount = greatest(0, total_debt - (total_paid + p_amount)),
         updated_at  = now()
   where id = p_debt_id;

  insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id)
  values ('deposit', p_amount, coalesce(p_date, current_date),
          'Versement dette client: ' || v_debt.client_name || coalesce(' (' || p_notes || ')', ''),
          'Dettes Clients', 'client_debt_versements', v_vers.id);

  return v_vers;
end;
$$;

-- Button "Supprimer le versement"
create or replace function public.delete_client_debt_versement(p_versement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_vers public.client_debt_versements;
begin
  select * into v_vers from public.client_debt_versements where id = p_versement_id;
  if v_vers.id is null then return; end if;

  update public.client_debts
     set total_paid  = greatest(0, total_paid - v_vers.amount),
         rest_amount = greatest(0, total_debt - greatest(0, total_paid - v_vers.amount)),
         updated_at  = now()
   where id = v_vers.debt_id;

  delete from public.caisse_transactions
   where ref_table = 'client_debt_versements' and ref_id = p_versement_id;
  delete from public.client_debt_versements where id = p_versement_id;
end;
$$;

-- Returns (and creates once) the shared walk-in client used by the POS
create or replace function public.get_or_create_passager(p_name text default 'Client Passager')
returns public.clients
language plpgsql
security definer
set search_path = public
as $$
declare v_client public.clients;
begin
  select * into v_client from public.clients where is_passager limit 1;
  if v_client.id is not null then
    return v_client;
  end if;
  insert into public.clients (name, phone, is_passager)
  values (p_name, '', true)
  returning * into v_client;
  return v_client;
end;
$$;

-- -------------------------------------------------------------- /commands ----
-- Button "Créer la commande"
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
begin
  select coalesce(count(*), 0) + 1 into v_seq from public.commands;
  v_ref := 'CMD-' || to_char(current_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  while exists (select 1 from public.commands where reference = v_ref) loop
    v_seq := v_seq + 1;
    v_ref := 'CMD-' || to_char(current_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_item ->> 'total_price')::numeric,
                 coalesce((v_item ->> 'quantity')::numeric, 0) * coalesce((v_item ->> 'unit_price')::numeric, 0));
  end loop;
  v_total := coalesce((p_payload ->> 'total_amount')::numeric, v_total);

  insert into public.commands (reference, client_id, client_name, client_phone, receive_date,
                               receive_hour, receive_minute, total_amount, advance_paid,
                               paid_amount, rest_amount, status, notes, created_by)
  values (v_ref,
          nullif(p_payload ->> 'client_id', '')::uuid,
          coalesce(p_payload ->> 'client_name', 'Client'),
          p_payload ->> 'client_phone',
          nullif(p_payload ->> 'receive_date', '')::date,
          p_payload ->> 'receive_hour',
          p_payload ->> 'receive_minute',
          v_total, v_advance, v_advance, greatest(0, v_total - v_advance),
          'pending', p_payload ->> 'notes', public.current_username())
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
    values ('deposit', v_advance, current_date,
            'Acompte commande ' || v_ref, 'Commande', 'commands', v_cmd.id);
  end if;

  return v_cmd;
end;
$$;

-- Button "Encaisser" on a command
create or replace function public.pay_command(
  p_command_id uuid, p_amount numeric, p_date date default current_date
) returns public.commands
language plpgsql
security definer
set search_path = public
as $$
declare v_cmd public.commands;
begin
  update public.commands
     set paid_amount = least(total_amount, paid_amount + p_amount),
         rest_amount = greatest(0, total_amount - least(total_amount, paid_amount + p_amount)),
         updated_at  = now()
   where id = p_command_id
  returning * into v_cmd;

  if v_cmd.id is null then
    raise exception 'Commande introuvable (%)', p_command_id;
  end if;

  insert into public.caisse_transactions (type, amount, date, description, category_name)
  values ('deposit', p_amount, coalesce(p_date, current_date),
          'Règlement commande ' || v_cmd.reference, 'Commande');

  return v_cmd;
end;
$$;

-- Buttons "Finaliser" / "Annuler" on a command
create or replace function public.set_command_status(p_command_id uuid, p_status public.command_status)
returns public.commands
language plpgsql
security definer
set search_path = public
as $$
declare v_cmd public.commands;
begin
  update public.commands set status = p_status, updated_at = now()
   where id = p_command_id
  returning * into v_cmd;
  return v_cmd;
end;
$$;

-- ------------------------------------------------------------ /production ----
-- `fiche_technics.category_id` references `fiche_categories` while
-- `productions.category_id` references `production_categories`: a production
-- started from a fiche technique (Production screen or point of sale) carries
-- the wrong id. It is translated here — same name reused, created on the fly
-- when missing — otherwise only the label is kept.
create or replace function public.resolve_production_category(
  p_category_id uuid, p_category_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_name text;
begin
  if p_category_id is not null then
    select id into v_id from public.production_categories where id = p_category_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

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
$$;

-- Button "Lancer la production" — consumes ingredients from the stock
create or replace function public.create_production(p_payload jsonb)
returns public.productions
language plpgsql
security definer
set search_path = public
as $$
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

    -- only raw stock ingredients are deducted (a 'fiche' source is semi-finished)
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
$$;

-- Button "Envoyer au comptoir"
create or replace function public.transfer_production_to_comptoir(
  p_production_id uuid, p_quantity numeric
) returns public.comptoir_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.productions;
  v_item public.comptoir_items;
begin
  select * into v_prod from public.productions where id = p_production_id;
  if v_prod.id is null then
    raise exception 'Production introuvable (%)', p_production_id;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantité invalide';
  end if;
  if v_prod.sent_to_comptoir + p_quantity > v_prod.output_quantity then
    raise exception 'La quantité dépasse la quantité produite (disponible: %)',
      v_prod.output_quantity - v_prod.sent_to_comptoir;
  end if;

  update public.productions
     set sent_to_comptoir = sent_to_comptoir + p_quantity, updated_at = now()
   where id = p_production_id;

  select * into v_item from public.comptoir_items where production_id = p_production_id limit 1;

  if v_item.id is not null then
    update public.comptoir_items
       set quantity = quantity + p_quantity, updated_at = now()
     where id = v_item.id
    returning * into v_item;
  else
    insert into public.comptoir_items (production_id, product_name, description, quantity, unit_price,
                                       date, category_id, category_name, sell_by_unit, unit, created_by)
    values (v_prod.id, v_prod.name, v_prod.description, p_quantity, v_prod.unit_price,
            current_date, v_prod.category_id, v_prod.category_name,
            v_prod.sell_by_unit, case when v_prod.sell_by_unit then v_prod.sell_unit end,
            public.current_username())
    returning * into v_item;
  end if;

  perform public.log_activity('production', 'transfer', 'comptoir_items', v_item.id,
                              jsonb_build_object('quantity', p_quantity));
  return v_item;
end;
$$;

-- -------------------------------------------------------------- /comptoir ----
-- Button "Détruire" (perte comptoir)
create or replace function public.destroy_comptoir_item(
  p_comptoir_id uuid, p_quantity numeric, p_reason text default ''
) returns public.destructions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.comptoir_items;
  v_dest public.destructions;
begin
  select * into v_item from public.comptoir_items where id = p_comptoir_id;
  if v_item.id is null then
    raise exception 'Article comptoir introuvable (%)', p_comptoir_id;
  end if;
  if p_quantity > v_item.quantity then
    raise exception 'Quantité supérieure au stock comptoir (%).', v_item.quantity;
  end if;

  insert into public.destructions (comptoir_id, product_name, quantity, value, reason, date, unit, created_by)
  values (p_comptoir_id, v_item.product_name, p_quantity, p_quantity * v_item.unit_price,
          p_reason, current_date,
          case when v_item.sell_by_unit then v_item.unit end,
          public.current_username())
  returning * into v_dest;

  update public.comptoir_items
     set quantity = greatest(0, quantity - p_quantity), updated_at = now()
   where id = p_comptoir_id;

  return v_dest;
end;
$$;

-- Button "Récupérer" on a destruction
create or replace function public.recover_destruction(p_destruction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_dest public.destructions;
begin
  select * into v_dest from public.destructions where id = p_destruction_id;
  if v_dest.id is null then return; end if;

  if v_dest.comptoir_id is not null
     and exists (select 1 from public.comptoir_items where id = v_dest.comptoir_id) then
    update public.comptoir_items
       set quantity = quantity + v_dest.quantity, updated_at = now()
     where id = v_dest.comptoir_id;
  else
    insert into public.comptoir_items (product_name, quantity, unit_price, date, unit)
    values (v_dest.product_name, v_dest.quantity,
            case when v_dest.quantity > 0 then v_dest.value / v_dest.quantity else 0 end,
            v_dest.date, v_dest.unit);
  end if;

  delete from public.destructions where id = p_destruction_id;
end;
$$;

-- Bulk buttons on the destructions table
create or replace function public.recover_destructions(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  foreach v_id in array p_ids loop
    perform public.recover_destruction(v_id);
  end loop;
end;
$$;

create or replace function public.delete_destructions(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.destructions where id = any(p_ids);
$$;

-- --------------------------------------------------------------- /workers ----
-- Button "Créer le compte" of a worker  -> real row in auth.users
-- (SECURITY DEFINER so the admin session is NOT replaced by the new user)
create or replace function public.create_auth_account(
  p_email text, p_password text, p_meta jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id         uuid;
  v_has_provider_id boolean;
  v_identity_data   jsonb;
begin
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'E-mail requis pour créer un compte';
  end if;
  if p_password is null or length(p_password) < 4 then
    raise exception 'Mot de passe trop court';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(trim(p_email));

  if v_user_id is not null then
    -- account already exists: refresh password & metadata
    update auth.users
       set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
           raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || p_meta,
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at         = now()
     where id = v_user_id;

    update public.profiles
       set full_name  = coalesce(p_meta ->> 'full_name', full_name),
           username   = lower(coalesce(p_meta ->> 'username', username)),
           role       = coalesce((p_meta ->> 'role')::public.user_role, role),
           permissions= coalesce(p_meta -> 'permissions', permissions),
           worker_id  = coalesce(nullif(p_meta ->> 'worker_id', '')::uuid, worker_id),
           is_active  = true,
           updated_at = now()
     where id = v_user_id;

    return v_user_id;
  end if;

  v_user_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    lower(trim(p_email)),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    coalesce(p_meta, '{}'::jsonb),
    now(), now(), '', '', '', ''
  );

  v_identity_data := jsonb_build_object(
    'sub', v_user_id::text,
    'email', lower(trim(p_email)),
    'email_verified', true,
    'phone_verified', false
  );

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) into v_has_provider_id;

  if v_has_provider_id then
    insert into auth.identities (id, provider_id, user_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_user_id::text, v_user_id, v_identity_data, 'email', now(), now(), now());
  else
    execute 'insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
             values ($1, $2, $3, $4, now(), now(), now())'
      using gen_random_uuid(), v_user_id, v_identity_data, 'email';
  end if;

  return v_user_id;
end;
$$;
-- NOTE: this raw helper stays private — it is locked down in section 21,
-- after the bulk GRANTs. Only the two wrappers below are exposed to the app.

-- Admin-only wrapper exposed to the app (Workers > "Compte de connexion")
create or replace function public.admin_create_worker_account(
  p_worker_id uuid, p_email text, p_password text, p_username text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker  public.workers;
  v_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Seul un administrateur peut créer un compte employé';
  end if;

  select * into v_worker from public.workers where id = p_worker_id;
  if v_worker.id is null then
    raise exception 'Employé introuvable (%)', p_worker_id;
  end if;

  v_user_id := public.create_auth_account(
    p_email, p_password,
    jsonb_build_object(
      'role', 'worker',
      'full_name', v_worker.full_name,
      'username', lower(coalesce(p_username, v_worker.username, split_part(p_email, '@', 1))),
      'worker_id', p_worker_id::text,
      'permissions', v_worker.permissions
    )
  );

  update public.workers
     set user_id     = v_user_id,
         has_account = true,
         email       = lower(p_email),
         username    = lower(coalesce(p_username, username, split_part(p_email, '@', 1))),
         updated_at  = now()
   where id = p_worker_id;

  update public.profiles
     set role = 'worker', worker_id = p_worker_id, permissions = v_worker.permissions,
         full_name = v_worker.full_name, updated_at = now()
   where id = v_user_id;

  perform public.log_activity('workers', 'create-account', 'workers', p_worker_id, null);
  return v_user_id;
end;
$$;
grant execute on function public.admin_create_worker_account(uuid, text, text, text) to authenticated;

-- Login page: tells the client whether the store already has an administrator.
-- While it returns false the "Créer un compte Administrateur" button is shown;
-- as soon as the first admin exists the button disappears.
create or replace function public.admin_account_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where role = 'admin' and is_active);
$$;
grant execute on function public.admin_account_exists() to anon, authenticated;

-- Button "Créer un compte Administrateur" (login page / settings).
-- The very first administrator may be created by anyone (fresh installation);
-- afterwards only a logged-in administrator can create another one.
create or replace function public.create_admin_account(
  p_name text, p_username text, p_email text, p_password text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_user_id uuid;
begin
  if public.admin_account_exists() and not public.is_admin() then
    raise exception 'Un compte administrateur existe déjà';
  end if;

  if exists (select 1 from public.profiles where lower(username) = lower(p_username)
                                              and lower(email) <> lower(p_email)) then
    raise exception 'Cet utilisateur existe déjà';
  end if;

  v_user_id := public.create_auth_account(
    p_email, p_password,
    jsonb_build_object('role', 'admin', 'full_name', p_name, 'username', lower(p_username))
  );
  return v_user_id;
end;
$$;
grant execute on function public.create_admin_account(text, text, text, text) to anon, authenticated;

-- Button "Permissions" — saves the permission matrix of a worker
create or replace function public.set_worker_permissions(p_worker_id uuid, p_permissions jsonb)
returns public.workers
language plpgsql
security definer
set search_path = public
as $$
declare v_worker public.workers;
begin
  if not public.is_admin() then
    raise exception 'Action réservée à l''administrateur';
  end if;

  update public.workers
     set permissions = coalesce(p_permissions, '{}'::jsonb), updated_at = now()
   where id = p_worker_id
  returning * into v_worker;

  if v_worker.user_id is not null then
    update public.profiles set permissions = v_worker.permissions, updated_at = now()
     where id = v_worker.user_id;
    update auth.users
       set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('permissions', v_worker.permissions)
     where id = v_worker.user_id;
  end if;

  return v_worker;
end;
$$;
grant execute on function public.set_worker_permissions(uuid, jsonb) to authenticated;

-- Button "Payer le salaire" — money leaves the caisse
create or replace function public.pay_worker_salary(
  p_worker_id uuid, p_amount numeric, p_period text default null,
  p_date date default current_date, p_description text default ''
) returns public.worker_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay    public.worker_payments;
  v_worker public.workers;
begin
  select * into v_worker from public.workers where id = p_worker_id;
  if v_worker.id is null then
    raise exception 'Employé introuvable (%)', p_worker_id;
  end if;

  insert into public.worker_payments (worker_id, date, period, amount, description, created_by)
  values (p_worker_id, coalesce(p_date, current_date), p_period, p_amount, p_description,
          public.current_username())
  returning * into v_pay;

  return v_pay;
end;
$$;

-- Button "Acompte" — advance on salary, money leaves the caisse
create or replace function public.add_worker_acompte(
  p_worker_id uuid, p_amount numeric,
  p_date date default current_date, p_description text default ''
) returns public.worker_acomptes
language plpgsql
security definer
set search_path = public
as $$
declare v_acompte public.worker_acomptes;
begin
  insert into public.worker_acomptes (worker_id, date, amount, description, created_by)
  values (p_worker_id, coalesce(p_date, current_date), p_amount, p_description,
          public.current_username())
  returning * into v_acompte;
  return v_acompte;
end;
$$;

-- ---------------------------------------------------------------- /caisse ----
-- Theoretical balance shown on the caisse screen and used by the reports
create or replace function public.caisse_balance(p_as_of date default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select initial_balance from public.caisse_settings where id), 0)
       + coalesce((
           select sum(case when type = 'deposit' then amount else -amount end)
             from public.caisse_transactions
            where p_as_of is null or date <= p_as_of
         ), 0);
$$;

-- Button "Nouveau rapport de caisse" — computes the theoretical amount & the gap
create or replace function public.create_caisse_report(
  p_declared_amount numeric,
  p_description text default '',
  p_report_type public.caisse_report_type default 'day',
  p_date date default current_date,
  p_end_date date default null
) returns public.caisse_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report      public.caisse_reports;
  v_theoretical numeric;
begin
  if p_report_type = 'period' then
    v_theoretical := coalesce((
      select sum(case when type = 'deposit' then amount else -amount end)
        from public.caisse_transactions
       where date between p_date and coalesce(p_end_date, p_date)), 0);
  else
    v_theoretical := coalesce((
      select sum(case when type = 'deposit' then amount else -amount end)
        from public.caisse_transactions
       where date = p_date), 0);
  end if;

  insert into public.caisse_reports (report_type, date, end_date, hour, description,
                                     declared_amount, theoretical_amount, gap_amount, created_by)
  values (p_report_type, p_date,
          case when p_report_type = 'period' then coalesce(p_end_date, p_date) end,
          to_char(now(), 'HH24:MI'), p_description,
          p_declared_amount, v_theoretical, p_declared_amount - v_theoretical,
          public.current_username())
  returning * into v_report;

  return v_report;
end;
$$;

-- Buttons "Entrée" / "Sortie" of the caisse screen
create or replace function public.add_caisse_transaction(
  p_type public.caisse_tx_type, p_amount numeric,
  p_description text default '', p_date date default current_date,
  p_category_id uuid default null, p_category_name text default null
) returns public.caisse_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx       public.caisse_transactions;
  v_category uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  -- an id coming from another module (or created offline) must not break the
  -- foreign key: it is only kept when it really is a caisse category
  select id into v_category from public.caisse_categories where id = p_category_id;

  insert into public.caisse_transactions (type, amount, date, description, category_id, category_name, created_by)
  values (p_type, p_amount, coalesce(p_date, current_date), p_description,
          v_category, p_category_name, public.current_username())
  returning * into v_tx;
  return v_tx;
end;
$$;


-- ============================================================================
-- 16. TRIGGERS — automatic propagation between modules
-- ============================================================================

-- updated_at on every table that has the column
do $$
declare r record;
begin
  for r in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'updated_at'
       and c.table_name in (select table_name from information_schema.tables
                             where table_schema = 'public' and table_type = 'BASE TABLE')
  loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', r.table_name);
    execute format(
      'create trigger trg_%1$s_updated_at before update on public.%1$I
       for each row execute function public.set_updated_at()', r.table_name);
  end loop;
end
$$;

-- A purchase line automatically feeds the stock  (/purchase "Enregistrer")
create or replace function public.trg_purchase_line_to_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_left numeric;
begin
  if new.product_id is null then
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
$$;
drop trigger if exists trg_purchase_line_stock on public.purchase_lines;
create trigger trg_purchase_line_stock
  after insert on public.purchase_lines
  for each row execute function public.trg_purchase_line_to_stock();

-- A payment received on a sale is a caisse DEPOSIT
create or replace function public.trg_sale_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_ref text;
begin
  select reference into v_ref from public.sales where id = new.sale_id;
  insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('deposit', new.amount, new.date,
          coalesce(new.description, 'Paiement vente') || ' ' || coalesce(v_ref, ''),
          'Vente', 'sale_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_sale_payment_caisse on public.sale_payments;
create trigger trg_sale_payment_caisse
  after insert on public.sale_payments
  for each row execute function public.trg_sale_payment_to_caisse();

-- A payment made to a supplier is a caisse WITHDRAWAL
create or replace function public.trg_purchase_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_ref text;
begin
  select reference into v_ref from public.purchases where id = new.purchase_id;
  insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('withdrawal', new.amount, new.date,
          coalesce(new.description, 'Règlement fournisseur') || ' ' || coalesce(v_ref, ''),
          'Achat', 'purchase_payments', new.id, new.created_by)
  on conflict (ref_table, ref_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_purchase_payment_caisse on public.purchase_payments;
create trigger trg_purchase_payment_caisse
  after insert on public.purchase_payments
  for each row execute function public.trg_purchase_payment_to_caisse();

-- An expense is a caisse WITHDRAWAL
create or replace function public.trg_expense_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_caisse_category uuid;
begin
  -- `expenses.category_id` references `expense_categories` while
  -- `caisse_transactions.category_id` references `caisse_categories`: copying
  -- the id across violates the foreign key. Only a caisse category carrying the
  -- same name is linked, otherwise the label alone is kept.
  select id into v_caisse_category
    from public.caisse_categories
   where name = coalesce(new.category_name, 'Dépense')
   limit 1;

  insert into public.caisse_transactions (type, amount, date, description, category_id, category_name, ref_table, ref_id, created_by)
  values ('withdrawal', new.amount, new.date,
          'Dépense: ' || new.name, v_caisse_category, coalesce(new.category_name, 'Dépense'),
          'expenses', new.id, new.created_by)
  on conflict (ref_table, ref_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_expense_caisse on public.expenses;
create trigger trg_expense_caisse
  after insert on public.expenses
  for each row execute function public.trg_expense_to_caisse();

create or replace function public.trg_expense_delete_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.caisse_transactions where ref_table = 'expenses' and ref_id = old.id;
  return old;
end;
$$;
drop trigger if exists trg_expense_caisse_del on public.expenses;
create trigger trg_expense_caisse_del
  before delete on public.expenses
  for each row execute function public.trg_expense_delete_caisse();

-- A salary payment / an acompte is a caisse WITHDRAWAL
create or replace function public.trg_worker_payment_to_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text;
  v_period text;
  v_label  text;
begin
  select full_name into v_name from public.workers where id = new.worker_id;

  -- `period` only exists on worker_payments: read it through jsonb so the very
  -- same function can also serve worker_acomptes.
  v_period := to_jsonb(new) ->> 'period';

  if tg_table_name = 'worker_payments' then
    v_label := 'Salaire: ' || coalesce(v_name, '') || coalesce(' (' || v_period || ')', '');
  else
    v_label := 'Acompte: ' || coalesce(v_name, '');
  end if;

  insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id, created_by)
  values ('withdrawal', new.amount, new.date, v_label, 'Salaires', tg_table_name, new.id, new.created_by)
  on conflict (ref_table, ref_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_worker_payment_caisse on public.worker_payments;
create trigger trg_worker_payment_caisse
  after insert on public.worker_payments
  for each row execute function public.trg_worker_payment_to_caisse();

drop trigger if exists trg_worker_acompte_caisse on public.worker_acomptes;
create trigger trg_worker_acompte_caisse
  after insert on public.worker_acomptes
  for each row execute function public.trg_worker_payment_to_caisse();

-- Deleting a payment removes its caisse counterpart
create or replace function public.trg_delete_linked_caisse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.caisse_transactions where ref_table = tg_table_name and ref_id = old.id;
  return old;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['sale_payments','purchase_payments','worker_payments','worker_acomptes'] loop
    execute format('drop trigger if exists trg_%1$s_caisse_del on public.%1$I', t);
    execute format('create trigger trg_%1$s_caisse_del before delete on public.%1$I
                    for each row execute function public.trg_delete_linked_caisse()', t);
  end loop;
end
$$;

-- Keep sale / purchase totals consistent when lines are edited manually
create or replace function public.trg_recalc_purchase_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_pid uuid;
begin
  v_pid := coalesce(new.purchase_id, old.purchase_id);
  update public.purchases p
     set total_amount = coalesce((select sum(line_total) from public.purchase_lines where purchase_id = v_pid), 0),
         rest_amount  = greatest(0, coalesce((select sum(line_total) from public.purchase_lines where purchase_id = v_pid), 0) - p.paid_amount),
         updated_at   = now()
   where p.id = v_pid;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_purchase_lines_totals on public.purchase_lines;
create trigger trg_purchase_lines_totals
  after insert or update or delete on public.purchase_lines
  for each row execute function public.trg_recalc_purchase_totals();


-- ============================================================================
-- 17. VIEWS — screens /dashboard, /reports, /caisse/statistics
-- ============================================================================

-- /stock — products with their alert status
create or replace view public.v_stock_alerts as
select p.id, p.name, p.barcode, p.current_quantity, p.min_alert_quantity, p.unit,
       p.purchase_price, p.expiration_date,
       m.name as marque_name, c.name as category_name,
       (p.current_quantity <= p.min_alert_quantity)                        as is_low_stock,
       (p.current_quantity = 0)                                           as is_out_of_stock,
       (p.expiration_enabled and p.expiration_date is not null
        and p.expiration_date <= current_date + 30)                        as is_expiring,
       p.current_quantity * p.purchase_price                               as stock_value
  from public.products p
  left join public.marques    m on m.id = p.marque_id
  left join public.categories c on c.id = p.category_id
 where p.is_active;

-- /suppliers — what is still owed to each supplier
create or replace view public.v_supplier_balances as
select s.id, s.name, s.phone, s.address,
       count(pu.id)                       as purchases_count,
       coalesce(sum(pu.total_amount), 0)  as total_purchased,
       coalesce(sum(pu.paid_amount), 0)   as total_paid,
       coalesce(sum(pu.rest_amount), 0)   as total_due
  from public.suppliers s
  left join public.purchases pu on pu.supplier_id = s.id
 group by s.id, s.name, s.phone, s.address;

-- /clients — turnover and outstanding balance per client
create or replace view public.v_client_balances as
select c.id, c.name, c.phone, c.address,
       coalesce(sv.sales_count, 0)   as sales_count,
       coalesce(sv.total_sales, 0)   as total_sales,
       coalesce(sv.total_rest, 0)    as sales_due,
       coalesce(dv.total_debt, 0)    as debts_total,
       coalesce(dv.total_paid, 0)    as debts_paid,
       coalesce(dv.rest_amount, 0)   as debts_due,
       coalesce(sv.total_rest, 0) + coalesce(dv.rest_amount, 0) as total_due
  from public.clients c
  left join (
    select client_id, count(*) sales_count, sum(final_amount) total_sales, sum(rest_amount) total_rest
      from public.sales group by client_id
  ) sv on sv.client_id = c.id
  left join (
    select client_id, sum(total_debt) total_debt, sum(total_paid) total_paid, sum(rest_amount) rest_amount
      from public.client_debts group by client_id
  ) dv on dv.client_id = c.id;

-- /sales — daily aggregation used by the charts
create or replace view public.v_sales_daily as
select s.date,
       count(*)                     as sales_count,
       sum(s.total_amount)          as total_amount,
       sum(s.reduction)             as total_reduction,
       sum(s.final_amount)          as final_amount,
       sum(s.paid_amount)           as paid_amount,
       sum(s.rest_amount)           as rest_amount
  from public.sales s
 group by s.date;

-- /purchase — daily aggregation
create or replace view public.v_purchases_daily as
select p.date,
       count(*)                as purchases_count,
       sum(p.total_amount)     as total_amount,
       sum(p.paid_amount)      as paid_amount,
       sum(p.rest_amount)      as rest_amount
  from public.purchases p
 group by p.date;

-- /caisse — full ledger (opening balance + every movement, running balance)
create or replace view public.v_caisse_ledger as
select t.id, t.date, t.created_at, t.type, t.amount, t.description,
       t.category_name, t.ref_table, t.ref_id, t.created_by,
       sum(case when t.type = 'deposit' then t.amount else -t.amount end)
         over (order by t.date, t.created_at, t.id
               rows between unbounded preceding and current row)
       + coalesce((select initial_balance from public.caisse_settings where id), 0) as running_balance
  from public.caisse_transactions t;

create or replace view public.v_caisse_summary as
select coalesce((select initial_balance from public.caisse_settings where id), 0) as initial_balance,
       coalesce(sum(case when type = 'deposit'    then amount end), 0)            as total_in,
       coalesce(sum(case when type = 'withdrawal' then amount end), 0)            as total_out,
       coalesce((select initial_balance from public.caisse_settings where id), 0)
       + coalesce(sum(case when type = 'deposit' then amount else -amount end), 0) as balance
  from public.caisse_transactions;

-- /caisse/reports — declared vs theoretical (décalage)
create or replace view public.v_caisse_report_detail as
select r.*,
       case when r.report_type = 'period'
            then coalesce((select sum(case when t.type = 'deposit' then t.amount else -t.amount end)
                             from public.caisse_transactions t
                            where t.date between r.date and coalesce(r.end_date, r.date)), 0)
            else coalesce((select sum(case when t.type = 'deposit' then t.amount else -t.amount end)
                             from public.caisse_transactions t
                            where t.date = r.date), 0)
       end as live_theoretical_amount
  from public.caisse_reports r;

-- /workers — salary balance (salary - acomptes - absences + payments made)
create or replace view public.v_worker_balances as
select w.id, w.full_name, w.phone, r.name as role_name,
       w.payment_type, w.payment_amount, w.payment_enabled, w.has_account, w.start_date,
       coalesce(a.total_acomptes, 0)  as total_acomptes,
       coalesce(ab.total_absences, 0) as total_absence_cost,
       coalesce(ab.absence_count, 0)  as absence_count,
       coalesce(p.total_paid, 0)      as total_paid,
       w.payment_amount - coalesce(a.total_acomptes, 0) - coalesce(ab.total_absences, 0) as net_to_pay
  from public.workers w
  left join public.roles r on r.id = w.role_id
  left join (select worker_id, sum(amount) total_acomptes from public.worker_acomptes group by worker_id) a  on a.worker_id  = w.id
  left join (select worker_id, sum(cost) total_absences, count(*) absence_count from public.worker_absences group by worker_id) ab on ab.worker_id = w.id
  left join (select worker_id, sum(amount) total_paid from public.worker_payments group by worker_id) p on p.worker_id = w.id
 where w.is_active;

-- /production — profitability of each batch
create or replace view public.v_production_profitability as
select pr.id, pr.name, pr.date, pr.category_name,
       pr.output_quantity, pr.unit_price, pr.total_value, pr.total_cost,
       pr.total_value - pr.total_cost                                   as gross_gain,
       case when pr.total_value > 0
            then round(((pr.total_value - pr.total_cost) / pr.total_value) * 100, 2)
            else 0 end                                                  as margin_percent,
       pr.sent_to_comptoir,
       pr.output_quantity - pr.sent_to_comptoir                          as remaining_quantity,
       pr.has_loss, pr.loss_quantity, pr.loss_value
  from public.productions pr;

-- /caisse/statistics — comptoir stock & losses
create or replace view public.v_comptoir_stats as
select ci.id, ci.product_name, ci.category_name, ci.quantity, ci.unit, ci.unit_price,
       ci.quantity * ci.unit_price                       as stock_value,
       coalesce(d.destroyed_quantity, 0)                 as destroyed_quantity,
       coalesce(d.destroyed_value, 0)                    as destroyed_value,
       coalesce(sl.sold_quantity, 0)                     as sold_quantity,
       coalesce(sl.sold_value, 0)                        as sold_value
  from public.comptoir_items ci
  left join (select comptoir_id, sum(quantity) destroyed_quantity, sum(value) destroyed_value
               from public.destructions group by comptoir_id) d on d.comptoir_id = ci.id
  left join (select comptoir_id, sum(quantity) sold_quantity, sum(line_total) sold_value
               from public.sale_lines where comptoir_id is not null group by comptoir_id) sl on sl.comptoir_id = ci.id;

-- /reports — month by month P&L
create or replace view public.v_reports_monthly as
with months as (
  select to_char(date, 'YYYY-MM') as period, sum(final_amount) revenue, sum(paid_amount) cashed
    from public.sales group by 1
),
buys as (
  select to_char(date, 'YYYY-MM') as period, sum(total_amount) purchases
    from public.purchases group by 1
),
exp as (
  select to_char(date, 'YYYY-MM') as period, sum(amount) expenses
    from public.expenses group by 1
),
sal as (
  select to_char(date, 'YYYY-MM') as period, sum(amount) salaries
    from public.worker_payments group by 1
),
prod as (
  select to_char(date, 'YYYY-MM') as period, sum(total_cost) production_cost, sum(loss_value) loss_value
    from public.productions group by 1
)
select coalesce(m.period, b.period, e.period, s.period, p.period)      as period,
       coalesce(m.revenue, 0)                                          as revenue,
       coalesce(m.cashed, 0)                                           as cashed,
       coalesce(b.purchases, 0)                                        as purchases,
       coalesce(e.expenses, 0)                                         as expenses,
       coalesce(s.salaries, 0)                                         as salaries,
       coalesce(p.production_cost, 0)                                  as production_cost,
       coalesce(p.loss_value, 0)                                       as loss_value,
       coalesce(m.revenue, 0) - coalesce(b.purchases, 0)
         - coalesce(e.expenses, 0) - coalesce(s.salaries, 0)           as net_profit
  from months m
  full join buys b on b.period = m.period
  full join exp  e on e.period = coalesce(m.period, b.period)
  full join sal  s on s.period = coalesce(m.period, b.period, e.period)
  full join prod p on p.period = coalesce(m.period, b.period, e.period, s.period);

-- /dashboard — the KPI cards
create or replace view public.v_dashboard_kpis as
select
  (select count(*) from public.products where is_active)                                as products_count,
  (select count(*) from public.v_stock_alerts where is_low_stock)                       as low_stock_count,
  (select coalesce(sum(current_quantity * purchase_price), 0) from public.products)     as stock_value,
  (select count(*) from public.clients where is_active)                                 as clients_count,
  (select count(*) from public.suppliers where is_active)                               as suppliers_count,
  (select count(*) from public.workers where is_active)                                 as workers_count,
  (select count(*) from public.sales)                                                   as sales_count,
  (select coalesce(sum(final_amount), 0) from public.sales)                             as sales_total,
  (select coalesce(sum(final_amount), 0) from public.sales where date = current_date)   as sales_today,
  (select coalesce(sum(rest_amount), 0) from public.sales)                              as clients_due,
  (select coalesce(sum(rest_amount), 0) from public.purchases)                          as suppliers_due,
  (select coalesce(sum(amount), 0) from public.expenses)                                as expenses_total,
  (select coalesce(sum(amount), 0) from public.expenses
    where date_trunc('month', date) = date_trunc('month', current_date))                as expenses_month,
  (select count(*) from public.commands where status = 'pending')                       as pending_commands,
  (select coalesce(sum(total_value - total_cost), 0) from public.productions)           as production_gain,
  (select balance from public.v_caisse_summary)                                         as caisse_balance;

-- A view normally runs with the rights of its owner, which would let a worker
-- read a module he has no permission on. `security_invoker` makes every view
-- obey the RLS policies of the user querying it. (PostgreSQL 15+)
do $$
declare v record;
begin
  for v in select table_name from information_schema.views where table_schema = 'public'
  loop
    begin
      execute format('alter view public.%I set (security_invoker = true)', v.table_name);
    exception when others then
      raise notice 'security_invoker non supporté pour la vue % (PostgreSQL < 15)', v.table_name;
    end;
  end loop;
end
$$;


-- ============================================================================
-- 18. ROW LEVEL SECURITY — mapped on the application permission modules
-- ============================================================================

-- profiles: everybody reads its own profile, admins read/manage everything
alter table public.profiles enable row level security;
drop policy if exists profiles_select_self  on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_update_self  on public.profiles;
drop policy if exists profiles_admin_all    on public.profiles;

create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
create policy profiles_admin_all on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- every business table is protected by its module permission
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('roles',                   'workers'),
      ('workers',                 'workers'),
      ('worker_acomptes',         'workers'),
      ('worker_absences',         'workers'),
      ('worker_payments',         'workers'),
      ('marques',                 'stock'),
      ('categories',              'stock'),
      ('units',                   'stock'),
      ('products',                'stock'),
      ('stock_movements',         'stock'),
      ('suppliers',               'suppliers'),
      ('purchases',               'purchase'),
      ('purchase_lines',          'purchase'),
      ('purchase_payments',       'purchase'),
      ('clients',                 'clients'),
      ('client_debts',            'clients'),
      ('client_debt_versements',  'clients'),
      ('sales',                   'sales'),
      ('sale_lines',              'sales'),
      ('sale_payments',           'sales'),
      ('commands',                'clients'),
      ('command_items',           'clients'),
      ('fiche_categories',        'production'),
      ('fiche_technics',          'production'),
      ('fiche_technic_lines',     'production'),
      ('production_categories',   'production'),
      ('productions',             'production'),
      ('production_used_products','production'),
      ('comptoir_items',          'comptoir'),
      ('destructions',            'comptoir'),
      ('expense_categories',      'expenses'),
      ('expenses',                'expenses'),
      ('caisse_categories',       'caisse'),
      ('caisse_transactions',     'caisse'),
      ('caisse_reports',          'caisse'),
      ('caisse_settings',         'caisse'),
      ('store_settings',          'settings'),
      ('activity_log',            'settings')
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

-- The store settings & reference lists must stay readable by every logged-in
-- user (logo / company name are displayed on the invoices and the header).
drop policy if exists store_settings_read_all on public.store_settings;
create policy store_settings_read_all on public.store_settings
  for select to authenticated using (true);

drop policy if exists units_read_all on public.units;
create policy units_read_all on public.units for select to authenticated using (true);

drop policy if exists categories_read_all on public.categories;
create policy categories_read_all on public.categories for select to authenticated using (true);

drop policy if exists marques_read_all on public.marques;
create policy marques_read_all on public.marques for select to authenticated using (true);


-- ============================================================================
-- 19. INITIAL CONFIGURATION
-- ----------------------------------------------------------------------------
--  The database is delivered EMPTY: no demo account, no demo product, no demo
--  client, sale, purchase, production or expense. Only the two single-row
--  configuration tables are created so the application has somewhere to write
--  its settings.
--
--  FIRST LAUNCH
--   1. open the application on /login,
--   2. click "Créer un compte Administrateur" and fill the form,
--   3. the account is created in auth.users and the button disappears:
--      from that point on only an administrator can create other accounts
--      (workers are created from /workers > "Compte de connexion").
--
--  Every list of the application (unités, marques, catégories, catégories de
--  dépense, catégories de caisse, rôles) starts empty and is filled from the
--  interface with the real data of the store.
-- ============================================================================

insert into public.store_settings (id) values (true)
on conflict (id) do nothing;

insert into public.caisse_settings (id, initial_balance) values (true, 0)
on conflict (id) do nothing;


-- ============================================================================
-- 20. GRANTS & REALTIME
-- ============================================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables    in schema public to authenticated;
grant select                        on all tables    in schema public to service_role;
grant all                           on all tables    in schema public to service_role;
grant usage, select                 on all sequences in schema public to authenticated, service_role;
grant execute                       on all functions in schema public to authenticated, service_role;

-- login helpers must be reachable before authentication
grant execute on function public.resolve_login_email(text)                       to anon, authenticated;
grant execute on function public.admin_account_exists()                          to anon, authenticated;
grant execute on function public.create_admin_account(text, text, text, text)    to anon, authenticated;

-- the raw auth-user writer must NEVER be callable from the browser: accounts can
-- only be created through create_admin_account() / admin_create_worker_account()
revoke execute on function public.create_auth_account(text, text, jsonb) from anon, authenticated, public;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- live refresh of the screens (optional, enable what you need)
do $$
declare t text;
begin
  for t in select unnest(array[
      'products','sales','sale_lines','purchases','purchase_lines','comptoir_items',
      'caisse_transactions','commands','productions','clients','client_debts','expenses'])
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
              when undefined_object then null;
    end;
  end loop;
end
$$;


-- ============================================================================
--  END — Altech Production / Ciment Blida
--
--  The database contains NO account and NO data: create the first
--  administrator from the /login page ("Créer un compte Administrateur").
--  Once it exists the button disappears and further accounts can only be
--  created by an administrator.
-- ============================================================================
