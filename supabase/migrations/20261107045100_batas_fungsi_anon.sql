-- Perbaikan batas peran. Skema private tidak masuk API. Tidak ada SECURITY DEFINER di public.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function private.is_admin() from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nama text := left(btrim(coalesce(new.raw_user_meta_data->>'display_name', '')), 80);
begin
  if nama !~ '^[^<>]{2,80}$' then
    nama := 'Pengguna';
  end if;
  insert into public.profiles (id, display_name, role)
  values (new.id, nama, 'pembeli');
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

drop function if exists public.handle_new_user();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
    grant execute on function private.handle_new_user() to supabase_auth_admin;
  end if;
end $$;

drop policy if exists profil_baca on public.profiles;

create policy profil_baca_anon
on public.profiles
for select
to anon
using (role = 'penjual');

create policy profil_baca_masuk
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or role = 'penjual'
  or (select private.is_admin())
);
