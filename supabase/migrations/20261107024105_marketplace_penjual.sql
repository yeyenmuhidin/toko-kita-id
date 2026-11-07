-- Marketplace multi-penjual Toko Kita ID.
-- Peran admin tidak bisa dipilih pengguna. Tidak ada data rahasia atau kata sandi di berkas ini.

create schema if not exists private;

create type public.account_role as enum ('pembeli', 'penjual', 'admin');
create type public.product_status as enum ('menunggu', 'disetujui', 'ditolak', 'disembunyikan');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.account_role not null default 'pembeli',
  display_name text not null,
  shop_name text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_check check (char_length(display_name) between 2 and 80 and display_name !~ '[<>]'),
  constraint profiles_shop_name_check check (shop_name is null or (char_length(shop_name) between 2 and 80 and shop_name !~ '[<>]')),
  constraint profiles_bio_check check (bio is null or (char_length(bio) <= 500 and bio !~ '[<>]'))
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  price integer not null,
  description text not null,
  category text not null,
  image_path text,
  status public.product_status not null default 'menunggu',
  contoh boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_check check (char_length(name) between 2 and 80 and name !~ '[<>]'),
  constraint products_price_check check (price >= 0 and price <= 999999999),
  constraint products_description_check check (char_length(description) between 10 and 500 and description !~ '[<>]'),
  constraint products_category_check check (char_length(category) between 2 and 40 and category !~ '[<>]'),
  constraint products_image_path_check check (
    image_path is null
    or image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$'
  )
);

create index products_seller_id_idx on public.products (seller_id);
create index products_status_idx on public.products (status);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function private.is_admin() from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.jaga_profil()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Identitas profil tidak dapat diubah';
  end if;
  if new.role is distinct from old.role then
    if new.role = 'admin' then
      if current_user not in ('postgres', 'supabase_admin') then
        raise exception 'Peran admin tidak dapat ditetapkan dari aplikasi';
      end if;
    elsif not (
      old.role = 'pembeli'
      and new.role = 'penjual'
      and old.id = auth.uid()
      and new.shop_name is not null
      and char_length(btrim(new.shop_name)) >= 2
    ) then
      raise exception 'Perubahan peran tidak diizinkan';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.jaga_produk()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  admin_berlaku boolean := private.is_admin();
begin
  if tg_op = 'INSERT' then
    if new.seller_id is null then
      new.seller_id := auth.uid();
    end if;
    if auth.uid() is not null and new.seller_id is distinct from auth.uid() and not admin_berlaku then
      raise exception 'Produk hanya dapat dibuat untuk akun sendiri';
    end if;
    if not admin_berlaku then
      new.status := 'menunggu';
      new.contoh := false;
    end if;
  else
    if new.seller_id is distinct from old.seller_id then
      raise exception 'Pemilik produk tidak dapat diubah';
    end if;
    if new.contoh is distinct from old.contoh and not admin_berlaku then
      raise exception 'Tanda contoh tidak dapat diubah';
    end if;
    if not admin_berlaku then
      if new.status is distinct from old.status and new.status in ('disetujui', 'ditolak') then
        raise exception 'Status persetujuan hanya dapat diubah admin';
      end if;
      if new.name is distinct from old.name
        or new.price is distinct from old.price
        or new.description is distinct from old.description
        or new.category is distinct from old.category
        or new.image_path is distinct from old.image_path then
        new.status := 'menunggu';
      end if;
    end if;
  end if;
  if new.image_path is not null and new.image_path !~ ('^' || new.seller_id::text || '/[A-Za-z0-9._-]{1,80}$') then
    raise exception 'Jalur gambar tidak valid';
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
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

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.jaga_profil() from public, anon, authenticated;
revoke all on function public.jaga_produk() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger profiles_jaga
before update on public.profiles
for each row execute function public.jaga_profil();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger products_jaga
before insert or update on public.products
for each row execute function public.jaga_produk();

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.products enable row level security;

create policy profil_baca
on public.profiles
for select
to anon, authenticated
using (
  id = (select auth.uid())
  or role = 'penjual'
  or private.is_admin()
);

create policy profil_ubah_sendiri
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy produk_baca_disetujui
on public.products
for select
to anon, authenticated
using (status = 'disetujui');

create policy produk_baca_pemilik
on public.products
for select
to authenticated
using (seller_id = (select auth.uid()) or private.is_admin());

create policy produk_tambah
on public.products
for insert
to authenticated
with check (seller_id = (select auth.uid()) or private.is_admin());

create policy produk_ubah
on public.products
for update
to authenticated
using (seller_id = (select auth.uid()) or private.is_admin())
with check (seller_id = (select auth.uid()) or private.is_admin());

create policy produk_hapus
on public.products
for delete
to authenticated
using (seller_id = (select auth.uid()) or private.is_admin());

create view public.etalase
with (security_invoker = true) as
select
  p.id,
  p.name,
  p.price,
  p.description,
  p.category,
  p.image_path,
  p.contoh,
  pr.display_name as seller_name,
  pr.shop_name
from public.products p
left join public.profiles pr
  on pr.id = p.seller_id
 and pr.role = 'penjual'
where p.status = 'disetujui';

grant usage on schema public to anon, authenticated;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.profiles to anon, authenticated;
grant update (display_name, shop_name, bio, role) on public.profiles to authenticated;
grant select on public.etalase to anon, authenticated;
grant usage on schema storage to anon, authenticated;
grant select on storage.objects to anon, authenticated;
grant insert, update, delete on storage.objects to authenticated;

revoke all on schema private from public;
grant usage on schema private to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produk', 'produk', false, 350000, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy produk_unggah
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'produk'
  and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);

create policy produk_ubah_berkas
on storage.objects
for update
to authenticated
using (
  bucket_id = 'produk'
  and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
)
with check (
  bucket_id = 'produk'
  and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);

create policy produk_hapus_berkas
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'produk'
  and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);

create policy produk_baca_pemilik_berkas
on storage.objects
for select
to authenticated
using (
  bucket_id = 'produk'
  and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);

create policy produk_baca_admin_berkas
on storage.objects
for select
to authenticated
using (bucket_id = 'produk' and private.is_admin());

create policy produk_baca_disetujui_berkas
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'produk'
  and storage.allow_any_operation(array['object.get_authenticated_info', 'object.get_authenticated'])
  and exists (
    select 1
    from public.products p
    where p.image_path = storage.objects.name
      and p.status = 'disetujui'
  )
);
