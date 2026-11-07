\set ON_ERROR_STOP on

do $$ begin
  create role service_role nologin;
exception when duplicate_object then null;
end $$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '');
$$;

grant execute on function auth.role() to anon, authenticated, service_role;

\ir ../supabase/migrations/20261107025632_pesanan_pembayaran_sandbox.sql
\ir ../supabase/migrations/20261107030520_admin_produk_stok.sql

select id as produk_a from public.products where name = 'Produk A' \gset
select set_config('uji.produk_a', :'produk_a', false);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
set role authenticated;
do $$
begin
  begin
    perform public.sesuaikan_stok_admin(current_setting('uji.produk_a')::uuid, 5, 'coba penjual', 0, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', null);
    raise exception 'UJI GAGAL: penjual menyesuaikan stok';
  exception
    when others then
      if sqlerrm not like '%admin%' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', false);
set role authenticated;
do $$
begin
  begin
    update public.products set stock = 9 where name = 'Produk A';
    raise exception 'UJI GAGAL: ubah stok langsung';
  exception
    when others then
      if sqlerrm not like '%tercatat%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
  end;
end $$;
select public.sesuaikan_stok_admin(current_setting('uji.produk_a')::uuid, 5, 'stok awal uji', 0, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 2);
select public.uji((select stock = 5 and low_stock_threshold = 2 and stock_version = 1 from public.products where name = 'Produk A'), 'penyesuaian pertama');
select public.sesuaikan_stok_admin(current_setting('uji.produk_a')::uuid, 9, 'ulang', 1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', null);
select public.uji((select stock = 5 and (select count(*) from public.inventory_movements) = 1 from public.products where name = 'Produk A'), 'idempotensi tidak menggandakan stok');
do $$
begin
  begin
    perform public.sesuaikan_stok_admin(current_setting('uji.produk_a')::uuid, 4, 'versi basi', 0, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', null);
    raise exception 'UJI GAGAL: versi basi diterima';
  exception
    when others then
      if sqlerrm not like '%muat ulang%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
  end;
end $$;
do $$
begin
  begin
    perform public.sesuaikan_stok_admin(current_setting('uji.produk_a')::uuid, -1, 'negatif', 1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', null);
    raise exception 'UJI GAGAL: stok negatif';
  exception
    when others then
      if sqlerrm not like '%tidak valid%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
  end;
end $$;
reset role;

insert into public.shipping_rates (label, amount_idr, active, sandbox_only) values ('Uji stok', 1000, true, true);
select id as tarif from public.shipping_rates limit 1 \gset
select set_config('uji.tarif', :'tarif', false);

select public.internal_buat_pesanan(
  '22222222-2222-4222-8222-222222222222',
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  jsonb_build_array(jsonb_build_object('product_id', current_setting('uji.produk_a'), 'quantity', 3)),
  current_setting('uji.tarif')::uuid,
  null
);
select public.uji((select stock = 5 from public.products where name = 'Produk A'), 'reservasi tidak mengurangi fisik');
select public.uji((select reserved = 3 and available = 2 from public.posisi_stok where name = 'Produk A'), 'tersedia sama dengan fisik kurang cadangan');
do $$
begin
  begin
    perform public.internal_buat_pesanan(
      '22222222-2222-4222-8222-222222222222',
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      jsonb_build_array(jsonb_build_object('product_id', current_setting('uji.produk_a'), 'quantity', 3)),
      current_setting('uji.tarif')::uuid,
      null
    );
    raise exception 'UJI GAGAL: cadangan terlewati';
  exception
    when others then
      if sqlerrm not like '%Stok tidak cukup%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.internal_catat_pembayaran((select gateway_order_id from public.orders where idempotency_key = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'), (select total from public.orders where idempotency_key = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 'IDR', 'settlement', 'accept', 'tx-stok', true);
select public.uji((select stock = 2 and stock_reserved = false from public.products p join public.orders o on true where p.name = 'Produk A' and o.idempotency_key = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 'pembayaran mengurangi fisik satu kali');
select public.internal_catat_pembayaran((select gateway_order_id from public.orders where idempotency_key = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'), (select total from public.orders where idempotency_key = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'), 'IDR', 'settlement', 'accept', 'tx-stok', true);
select public.uji((select stock = 2 from public.products where name = 'Produk A'), 'webhook ulang tidak mengurangi lagi');

select public.internal_buat_pesanan(
  '22222222-2222-4222-8222-222222222222',
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
  jsonb_build_array(jsonb_build_object('product_id', current_setting('uji.produk_a'), 'quantity', 2)),
  current_setting('uji.tarif')::uuid,
  null
);
select public.internal_catat_pembayaran((select gateway_order_id from public.orders where idempotency_key = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'), (select total from public.orders where idempotency_key = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'), 'IDR', 'expire', 'accept', 'tx-expire', true);
select public.internal_catat_pembayaran((select gateway_order_id from public.orders where idempotency_key = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'), (select total from public.orders where idempotency_key = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'), 'IDR', 'expire', 'accept', 'tx-expire-2', true);
select public.uji((select on_hand = 2 and reserved = 0 and low_stock_threshold = 2 and available <= low_stock_threshold from public.posisi_stok where name = 'Produk A'), 'kedaluwarsa melepas cadangan dan batas menipis tetap');
select public.uji((select count(*) = 1 from public.inventory_movements where reason = 'lepas cadangan'), 'lepas cadangan tercatat sekali');
select public.uji((select count(*) = 1 from public.inventory_movements where reason = 'penjualan sandbox'), 'penjualan tercatat sekali');

select public.internal_buat_pesanan(
  '22222222-2222-4222-8222-222222222222',
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
  jsonb_build_array(jsonb_build_object('product_id', current_setting('uji.produk_a'), 'quantity', 1)),
  current_setting('uji.tarif')::uuid,
  null
);
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', false);
set role authenticated;
do $$
begin
  begin
    perform public.sesuaikan_stok_admin(current_setting('uji.produk_a')::uuid, 0, 'turun di bawah cadangan', (select stock_version from public.products where name = 'Produk A'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9', null);
    raise exception 'UJI GAGAL: fisik di bawah cadangan';
  exception
    when others then
      if sqlerrm not like '%cadangan%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
  end;
end $$;
select public.uji((select count(*) >= 1 from public.admin_audit where action = 'ubah_stok'), 'audit penyesuaian ada');
select public.uji((select count(*) = 0 from public.products where contoh and stock is not null), 'produk contoh tidak diberi stok migrasi');
do $$
begin
  begin
    perform public.sesuaikan_stok_admin(current_setting('uji.produk_a')::uuid, 2, 'ambang negatif', (select stock_version from public.products where name = 'Produk A'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5', -1);
    raise exception 'UJI GAGAL: ambang negatif';
  exception
    when others then
      if sqlerrm not like '%tidak valid%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
  end;
  begin
    perform public.kelola_produk_admin('ubah_stok', current_setting('uji.produk_a')::uuid, null, null, 3, null, null, null, null, null);
    raise exception 'UJI GAGAL: kelola menulis stok';
  exception
    when others then
      if sqlerrm not like '%sesuaikan_stok_admin%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
set role authenticated;
select public.uji((select count(*) = 0 from public.inventory_movements), 'penjual lain tidak melihat gerakan stok');
do $$
begin
  update public.inventory_movements set reason = 'diubah klien';
  raise exception 'UJI GAGAL: klien mengubah riwayat';
exception
  when insufficient_privilege then null;
  when others then
    if sqlerrm like '%UJI GAGAL%' then raise; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
set role authenticated;
select public.uji((select count(*) >= 1 from public.inventory_movements), 'penjual pemilik melihat gerakan produknya');
do $$
begin
  delete from public.inventory_movements;
  raise exception 'UJI GAGAL: klien menghapus riwayat';
exception
  when insufficient_privilege then null;
  when others then
    if sqlerrm like '%UJI GAGAL%' then raise; end if;
end $$;
reset role;
