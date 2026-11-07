\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data)
values ('44444444-4444-4444-8444-444444444444', 'pembeli-campuran@example.test', '{"display_name":"Pembeli Campuran","role":"admin"}')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', false);
select set_config('app.kelola_admin', '1', false);
set role authenticated;
update public.products set status = 'disetujui' where name = 'Produk B';
reset role;

insert into public.shipping_rates (label, amount_idr, active, sandbox_only)
select 'Uji campuran', 1000, true, true
where not exists (select 1 from public.shipping_rates where label = 'Uji campuran');

select set_config('uji.tarif_campuran', (select id::text from public.shipping_rates where label = 'Uji campuran' limit 1), false);
select set_config('uji.produk_a', (select id::text from public.products where name = 'Produk A'), false);
select set_config('uji.produk_b', (select id::text from public.products where name = 'Produk B'), false);
do $$
begin
  if to_regprocedure('public.sesuaikan_stok_admin(uuid, integer, text, integer, uuid, integer)') is not null then
    perform public.sesuaikan_stok_admin(current_setting('uji.produk_a')::uuid, 5, 'stok campuran', (select stock_version from public.products where name = 'Produk A'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb10', null);
    perform public.sesuaikan_stok_admin(current_setting('uji.produk_b')::uuid, 5, 'stok campuran', (select stock_version from public.products where name = 'Produk B'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11', null);
  end if;
end $$;
set role service_role;
select public.internal_buat_pesanan(
  '44444444-4444-4444-8444-444444444444',
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  jsonb_build_array(
    jsonb_build_object('product_id', current_setting('uji.produk_a'), 'quantity', 1),
    jsonb_build_object('product_id', current_setting('uji.produk_b'), 'quantity', 1)
  ),
  current_setting('uji.tarif_campuran')::uuid,
  'Catatan rahasia pembeli'
);
reset role;

select set_config('uji.order_campuran', (select id::text from public.orders where idempotency_key = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'), false);
select set_config('uji.gateway_campuran', (select gateway_order_id from public.orders where idempotency_key = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'), false);
select set_config('uji.total_campuran', (select total::text from public.orders where idempotency_key = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'), false);
select public.uji((
  select count(*) = 2 and sum(line_total) = (select subtotal from public.orders where idempotency_key = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1')
  from public.order_items
  where order_id = current_setting('uji.order_campuran')::uuid
), 'pesanan campuran punya dua baris');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
select public.uji((select count(*) = 0 from public.orders), 'penjual A tidak membaca induk pesanan pembeli');
select public.uji((select count(*) = 0 from public.order_items where seller_id <> auth.uid()), 'penjual A tidak membaca baris penjual B');
select public.uji((select count(*) = 1 from public.order_items where order_id = current_setting('uji.order_campuran')::uuid), 'penjual A membaca barisnya sendiri');
select public.uji((select buyer_name is null and shipping_note is null from public.baris_pesanan_penjual where order_id = current_setting('uji.order_campuran')::uuid), 'nama dan catatan tersembunyi sebelum lunas');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
select public.uji((select count(*) = 0 from public.order_items where order_id = current_setting('uji.order_campuran')::uuid and product_name = 'Produk A'), 'penjual B tidak membaca baris Produk A pada pesanan yang sama');
select public.uji((select count(*) = 1 from public.order_items where order_id = current_setting('uji.order_campuran')::uuid and product_name = 'Produk B'), 'penjual B membaca barisnya sendiri');
reset role;

set role service_role;
select public.internal_catat_pembayaran(
  current_setting('uji.gateway_campuran'),
  current_setting('uji.total_campuran')::numeric,
  'IDR', 'settlement', 'accept', 'tx-campuran', true
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
select public.uji((
  select buyer_name = 'Pembeli Campuran' and shipping_note = 'Catatan rahasia pembeli'
  from public.baris_pesanan_penjual
  where order_id = current_setting('uji.order_campuran')::uuid
), 'setelah lunas penjual hanya melihat nama dan catatan');
select public.uji((select count(*) = 0 from public.profiles where id = '44444444-4444-4444-8444-444444444444'), 'penjual tidak membaca profil pembeli lewat tabel');
select public.uji((select count(*) = 0 from public.orders), 'penjual tetap tidak membaca total pesanan');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', false);
select public.uji((select count(*) = 2 from public.order_items where order_id = (select id from public.orders where idempotency_key = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1')), 'pembeli membaca kedua baris');
select public.uji((select total is not null from public.orders where idempotency_key = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'), 'pembeli membaca total pesanan sendiri');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', false);
select public.uji((select count(*) >= 2 from public.order_items where order_id = (select id from public.orders where idempotency_key = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1')), 'admin membaca seluruh pesanan');
reset role;
