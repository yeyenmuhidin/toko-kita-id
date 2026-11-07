\set ON_ERROR_STOP on

do $$ begin
  create role supabase_auth_admin nologin;
exception when duplicate_object then null;
end $$;
grant supabase_auth_admin to postgres;
grant usage on schema auth to supabase_auth_admin;
grant insert on auth.users to supabase_auth_admin;

create or replace function public.uji(kondisi boolean, pesan text)
returns void
language plpgsql
as $$
begin
  if not kondisi then
    raise exception 'UJI GAGAL: %', pesan;
  end if;
end;
$$;

select public.uji((
  select count(*) = 0
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname in ('public', 'graphql_public')
), 'tidak ada security definer di skema yang diekspos');

select public.uji((
  select count(*) = 0
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname in ('public', 'graphql_public')
    and (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
), 'anon dan pengguna masuk tidak mengeksekusi security definer yang diekspos');

select public.uji(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon tidak memakai skema private');
select public.uji(has_schema_privilege('authenticated', 'private', 'USAGE'), 'pengguna masuk memakai private hanya untuk kebijakan');
select public.uji(not has_function_privilege('anon', 'private.is_admin()', 'EXECUTE'), 'anon tidak mengeksekusi is_admin');

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{}', false);
select public.uji((select count(*) = 2 from public.profiles), 'anon hanya melihat profil penjual');
select public.uji((select count(*) = 0 from public.profiles where role <> 'penjual'), 'anon tidak melihat pembeli atau admin');
select public.uji((select count(*) = 1 from public.etalase where name = 'Produk A'), 'anon membaca etalase produk disetujui');
select public.uji((select seller_name = 'Penjual A' from public.etalase where name = 'Produk A'), 'nama toko tampil tanpa hak admin');
select set_config('request.storage.operation', 'object.get_authenticated', false);
select public.uji((select count(*) = 1 from storage.objects where name like '%foto-a.jpg'), 'anon membaca foto produk disetujui');
select set_config('request.storage.operation', 'object.list', false);
select public.uji((select count(*) = 0 from storage.objects), 'anon tidak mengindeks foto');
reset role;

set role supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data)
values ('44444444-4444-4444-8444-444444444444', 'pembeli-baru@example.test', '{"display_name":"Pembeli Baru","role":"admin"}');
reset role;
select public.uji((
  select role = 'pembeli' from public.profiles where id = '44444444-4444-4444-8444-444444444444'
), 'pemicu auth admin membuat pembeli, bukan admin');
