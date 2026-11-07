\set ON_ERROR_STOP on

drop schema if exists private cascade;
drop schema if exists storage cascade;
drop schema if exists auth cascade;
drop role if exists anon;
drop role if exists authenticated;

create role anon nologin;
create role authenticated nologin;
grant anon to postgres;
grant authenticated to postgres;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner_id text
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(object_name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(object_name, '/');
$$;

create or replace function storage.allow_any_operation(ops text[])
returns boolean
language sql
stable
as $$
  select current_setting('request.storage.operation', true) = any (ops);
$$;

grant usage on schema storage to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
grant execute on function storage.allow_any_operation(text[]) to anon, authenticated;

\ir ../supabase/migrations/20261107024105_marketplace_penjual.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'penjual-a@example.test', '{"display_name":"Penjual A","role":"admin"}'),
  ('22222222-2222-4222-8222-222222222222', 'penjual-b@example.test', '{"display_name":"Penjual B"}'),
  ('33333333-3333-4333-8333-333333333333', 'calon-admin@example.test', '{"display_name":"Calon Admin"}');

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

select public.uji((select role = 'pembeli' from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'metadata admin diabaikan saat daftar');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', false);
set role authenticated;
update public.profiles set role = 'penjual', shop_name = 'Toko A' where id = auth.uid();
reset role;
select public.uji((select role = 'penjual' from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'pembeli menjadi penjual');

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', false);
set role authenticated;
update public.profiles set role = 'penjual', shop_name = 'Toko B' where id = auth.uid();
insert into public.products (seller_id, name, price, description, category, image_path, status)
values (
  '22222222-2222-4222-8222-222222222222',
  'Produk B',
  50000,
  'Deskripsi produk milik penjual B saja.',
  'Rumah',
  '22222222-2222-4222-8222-222222222222/foto-b.jpg',
  'disetujui'
);
reset role;
select public.uji((select status = 'menunggu' from public.products where name = 'Produk B'), 'status awal dipaksa menunggu');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', false);
set role authenticated;
insert into public.products (seller_id, name, price, description, category, image_path)
values (
  '11111111-1111-4111-8111-111111111111',
  'Produk A',
  75000,
  'Deskripsi produk milik penjual A saja.',
  'Dapur',
  '11111111-1111-4111-8111-111111111111/foto-a.jpg'
);
do $$
begin
  update public.products
  set price = 1
  where seller_id = '22222222-2222-4222-8222-222222222222';
  if found then
    raise exception 'UJI GAGAL: penjual A mengubah produk B';
  end if;
end $$;
do $$
begin
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'UJI GAGAL: penjual dapat menjadi admin';
  exception
    when others then
      if sqlerrm not like '%admin%' then
        raise;
      end if;
  end;
end $$;
do $$
begin
  begin
    update public.products set status = 'disetujui' where name = 'Produk A';
    raise exception 'UJI GAGAL: penjual menyetujui produk sendiri';
  exception
    when others then
      if sqlerrm not like '%admin%' then
        raise;
      end if;
  end;
end $$;
do $$
begin
  begin
    insert into public.products (seller_id, name, price, description, category)
    values ('22222222-2222-4222-8222-222222222222', 'Curian', 1000, 'Deskripsi percobaan curian produk.', 'Lain');
    raise exception 'UJI GAGAL: penjual membuat produk atas nama orang lain';
  exception
    when others then
      if sqlerrm not like '%sendiri%' and sqlerrm not like '%row-level%' and sqlerrm not like '%policy%' then
        raise;
      end if;
  end;
end $$;
reset role;

select public.uji((select role = 'penjual' from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'peran tetap penjual');
select public.uji((select count(*) = 0 from public.products where status = 'disetujui'), 'belum ada produk disetujui');

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{}', false);
select public.uji((select count(*) = 0 from public.etalase), 'anonim tidak melihat produk menunggu');
select public.uji((select count(*) = 0 from public.products), 'anonim tidak membaca tabel produk menunggu');
reset role;

update public.profiles set role = 'admin' where id = '33333333-3333-4333-8333-333333333333';
select public.uji((select role = 'admin' from public.profiles where id = '33333333-3333-4333-8333-333333333333'), 'postgres dapat menetapkan admin');

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', false);
set role authenticated;
update public.products set status = 'disetujui' where name = 'Produk A';
reset role;
select public.uji((select status = 'disetujui' from public.products where name = 'Produk A'), 'admin menyetujui');

set role anon;
select public.uji((select count(*) = 1 from public.etalase where name = 'Produk A'), 'etalase hanya produk disetujui');
select public.uji((select count(*) = 0 from public.etalase where name = 'Produk B'), 'produk menunggu tidak tampil');
reset role;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', false);
set role authenticated;
update public.products set price = 88000 where name = 'Produk A';
reset role;
select public.uji((select status = 'menunggu' and price = 88000 from public.products where name = 'Produk A'), 'ubah harga kembali menunggu');

set role anon;
select public.uji((select count(*) = 0 from public.etalase), 'setelah diubah, produk hilang dari etalase');
reset role;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', false);
set role authenticated;
do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('produk', '22222222-2222-4222-8222-222222222222/milik-b.jpg');
    raise exception 'UJI GAGAL: unggah ke folder penjual lain';
  exception
    when others then
      if sqlerrm not like '%row-level%' and sqlerrm not like '%policy%' then
        raise;
      end if;
  end;
end $$;
insert into storage.objects (bucket_id, name)
values ('produk', '11111111-1111-4111-8111-111111111111/foto-a.jpg');
reset role;

set role anon;
select set_config('request.storage.operation', 'object.get_authenticated', false);
select public.uji((select count(*) = 0 from storage.objects), 'anonim tidak membaca foto yang belum disetujui');
select set_config('request.storage.operation', 'object.list', false);
select public.uji((select count(*) = 0 from storage.objects), 'anonim tidak mengindeks bucket');
reset role;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', false);
set role authenticated;
update public.products set status = 'disetujui' where name = 'Produk A';
reset role;

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{}', false);
select set_config('request.storage.operation', 'object.get_authenticated', false);
select public.uji((select count(*) = 1 from storage.objects where name like '%foto-a.jpg'), 'foto disetujui dapat dibaca');
select set_config('request.storage.operation', 'object.list', false);
select public.uji((select count(*) = 0 from storage.objects), 'daftar berkas tetap tertutup');
reset role;
