-- Cuentas de Gathering Market en Supabase: nombre + contraseña (sin correo) y tus datos guardados en la nube.
-- Pégalo entero en Supabase → SQL Editor → Run. Se puede ejecutar varias veces sin romper nada.
-- No toca tus otras tablas ni el inicio de sesión de Supabase (auth): todo vive en gm_users.
--
-- Seguridad:
--  * La tabla tiene RLS activado y ninguna política: nadie puede leerla ni escribirla directamente
--    (ni con la clave pública de la app).
--  * Solo se accede con las tres funciones de abajo, que comprueban la contraseña.
--  * La app no envía tu contraseña tal cual: envía una clave derivada (PBKDF2), y aquí se guarda
--    cifrada con bcrypt. Si alguien viera la tabla, no vería ni tu contraseña ni esa clave.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.gm_users (
  username   text primary key check (username ~ '^[a-z0-9_.-]{3,30}$'),
  pass_hash  text not null,
  data       jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.gm_users enable row level security;
revoke all on public.gm_users from anon, authenticated;

-- Crear cuenta. Devuelve la hora de creación; error USER_TAKEN si el nombre ya existe.
create or replace function public.gm_signup(p_user text, p_pass text) returns timestamptz
language plpgsql security definer set search_path = public, extensions as $$
declare t timestamptz;
begin
  if p_pass is null or length(p_pass) < 32 then raise exception 'BAD_PASSWORD'; end if;
  insert into gm_users (username, pass_hash) values (lower(p_user), crypt(p_pass, gen_salt('bf', 10)))
  returning updated_at into t;
  return t;
exception when unique_violation then
  raise exception 'USER_TAKEN';
end $$;

-- Entrar: devuelve tus datos (o nada si el nombre o la contraseña no son correctos).
create or replace function public.gm_load(p_user text, p_pass text)
returns table (data jsonb, updated_at timestamptz)
language sql security definer set search_path = public, extensions as $$
  select u.data, u.updated_at from gm_users u
  where u.username = lower(p_user) and u.pass_hash = crypt(p_pass, u.pass_hash);
$$;

-- Guardar tus datos (máximo ~5 MB). Error BAD_LOGIN si la contraseña no es correcta.
create or replace function public.gm_save(p_user text, p_pass text, p_data jsonb) returns timestamptz
language plpgsql security definer set search_path = public, extensions as $$
declare t timestamptz;
begin
  if pg_column_size(p_data) > 5000000 then raise exception 'TOO_BIG'; end if;
  update gm_users set data = p_data, updated_at = now()
  where username = lower(p_user) and pass_hash = crypt(p_pass, pass_hash)
  returning updated_at into t;
  if t is null then raise exception 'BAD_LOGIN'; end if;
  return t;
end $$;

revoke all on function public.gm_signup(text, text) from public;
revoke all on function public.gm_load(text, text) from public;
revoke all on function public.gm_save(text, text, jsonb) from public;
grant execute on function public.gm_signup(text, text) to anon, authenticated;
grant execute on function public.gm_load(text, text) to anon, authenticated;
grant execute on function public.gm_save(text, text, jsonb) to anon, authenticated;
