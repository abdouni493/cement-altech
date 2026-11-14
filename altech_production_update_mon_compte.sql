-- =============================================================================
--  ALTECH PRODUCTION — PARAMETRES › MON COMPTE : enregistrement complet
-- -----------------------------------------------------------------------------
--  Corrige : les modifications du compte (surtout l'e-mail et le mot de passe)
--  n'etaient pas appliquees. Cette fonction met a jour en une seule operation :
--    - auth.users       (e-mail de connexion + mot de passe)
--    - auth.identities  (e-mail du fournisseur "email")
--    - public.profiles  (nom, nom d'utilisateur, e-mail)
--    - public.workers   (si le compte appartient a un employe)
--  A executer dans Supabase › SQL Editor. Idempotent.
-- =============================================================================

create or replace function public.update_my_account(
  p_name         text,
  p_username     text,
  p_email        text,
  p_old_password text default null,
  p_new_password text default null
) returns public.profiles
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text := lower(trim(coalesce(p_email, '')));
  v_username text := nullif(lower(trim(coalesce(p_username, ''))), '');
  v_name     text := trim(coalesce(p_name, ''));
  v_old      auth.users%rowtype;
  v_profile  public.profiles;
begin
  if v_uid is null then
    raise exception 'Session expirée : reconnectez-vous';
  end if;

  select * into v_old from auth.users where id = v_uid;
  if not found then
    raise exception 'Compte introuvable';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse e-mail invalide';
  end if;

  if exists (select 1 from auth.users where lower(email) = v_email and id <> v_uid)
     or exists (select 1 from public.profiles where lower(email) = v_email and id <> v_uid) then
    raise exception 'Cet e-mail est déjà utilisé par un autre compte';
  end if;

  if v_username is not null and exists (
       select 1 from public.profiles where lower(username) = v_username and id <> v_uid) then
    raise exception 'Ce nom d''utilisateur est déjà utilisé';
  end if;

  -- changement de mot de passe : l'ancien mot de passe est obligatoire
  if coalesce(p_new_password, '') <> '' then
    if length(p_new_password) < 6 then
      raise exception 'Le nouveau mot de passe doit contenir au moins 6 caractères';
    end if;
    if coalesce(p_old_password, '') = ''
       or v_old.encrypted_password is null
       or v_old.encrypted_password <> extensions.crypt(p_old_password, v_old.encrypted_password) then
      raise exception 'Ancien mot de passe incorrect';
    end if;
  end if;

  update auth.users
     set email              = v_email,
         email_confirmed_at = case when lower(v_old.email) = v_email
                                   then email_confirmed_at else now() end,
         email_change       = '',
         email_change_token_new = '',
         email_change_token_current = '',
         encrypted_password = case when coalesce(p_new_password, '') <> ''
                                   then extensions.crypt(p_new_password, extensions.gen_salt('bf'))
                                   else encrypted_password end,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('full_name', v_name,
                                                    'username', coalesce(v_username, split_part(v_email, '@', 1))),
         updated_at         = now()
   where id = v_uid;

  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb)
                         || jsonb_build_object('email', v_email, 'email_verified', true),
         updated_at    = now()
   where user_id = v_uid and provider = 'email';

  update public.profiles
     set full_name  = coalesce(nullif(v_name, ''), full_name),
         username   = coalesce(v_username, username),
         email      = v_email,
         updated_at = now()
   where id = v_uid
  returning * into v_profile;

  update public.workers
     set email    = v_email,
         username = coalesce(v_username, username)
   where user_id = v_uid;

  return v_profile;
end;
$$;

revoke execute on function public.update_my_account(text, text, text, text, text) from anon, public;
grant  execute on function public.update_my_account(text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
