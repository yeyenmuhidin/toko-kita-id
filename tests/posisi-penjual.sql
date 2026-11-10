\set ON_ERROR_STOP on

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

insert into auth.users (id, email, raw_user_meta_data) values
  ('abababab-abab-4aba-8aba-abababababa1', 'posisi-a@example.test', '{"display_name":"Penjual Posisi A"}'),
  ('abababab-abab-4aba-8aba-abababababa2', 'posisi-b@example.test', '{"display_name":"Penjual Posisi B"}'),
  ('abababab-abab-4aba-8aba-abababababa3', 'posisi-beli@example.test', '{"display_name":"Pembeli Posisi"}'),
  ('abababab-abab-4aba-8aba-abababababa4', 'posisi-admin@example.test', '{"display_name":"Admin Posisi"}');

update public.profiles set role = 'admin' where id = 'abababab-abab-4aba-8aba-abababababa4';

select set_config('request.jwt.claim.sub', 'abababab-abab-4aba-8aba-abababababa1', false);
select set_config('request.jwt.claims', '{"sub":"abababab-abab-4aba-8aba-abababababa1","role":"authenticated"}', false);
set role authenticated;
update public.profiles set role = 'penjual', shop_name = 'Toko Posisi A' where id = auth.uid();
insert into public.products (seller_id, name, price, description, category)
values ('abababab-abab-4aba-8aba-abababababa1', 'Posisi A', 10000, 'Produk uji posisi milik A.', 'Uji');
reset role;

select set_config('request.jwt.claim.sub', 'abababab-abab-4aba-8aba-abababababa2', false);
select set_config('request.jwt.claims', '{"sub":"abababab-abab-4aba-8aba-abababababa2","role":"authenticated"}', false);
set role authenticated;
update public.profiles set role = 'penjual', shop_name = 'Toko Posisi B' where id = auth.uid();
insert into public.products (seller_id, name, price, description, category)
values ('abababab-abab-4aba-8aba-abababababa2', 'Posisi B', 20000, 'Produk uji posisi milik B.', 'Uji');
reset role;

select set_config('request.jwt.claim.sub', 'abababab-abab-4aba-8aba-abababababa4', false);
select set_config('request.jwt.claims', '{"sub":"abababab-abab-4aba-8aba-abababababa4","role":"authenticated"}', false);
select set_config('app.kelola_admin', '1', false);
set role authenticated;
update public.products set status = 'disetujui' where name in ('Posisi A', 'Posisi B');
select public.sesuaikan_stok_admin((select id from public.products where name = 'Posisi A'), 10, 'stok posisi A', 0, 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcd01', null);
select public.sesuaikan_stok_admin((select id from public.products where name = 'Posisi B'), 10, 'stok posisi B', 0, 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcd02', null);
reset role;

insert into public.shipping_rates (label, amount_idr, active, sandbox_only) values ('Uji posisi', 500, true, true);
select set_config('uji.produk_a', (select id::text from public.products where name = 'Posisi A'), false);
select set_config('uji.produk_b', (select id::text from public.products where name = 'Posisi B'), false);
select set_config('uji.tarif', (select id::text from public.shipping_rates where label = 'Uji posisi'), false);

set role service_role;
select public.internal_buat_pesanan(
  'abababab-abab-4aba-8aba-abababababa3',
  'efefefef-efef-4efe-8efe-efefefefefe1',
  jsonb_build_array(
    jsonb_build_object('product_id', current_setting('uji.produk_a'), 'quantity', 2),
    jsonb_build_object('product_id', current_setting('uji.produk_b'), 'quantity', 3)
  ),
  current_setting('uji.tarif')::uuid,
  'Catatan pembeli posisi'
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', 'abababab-abab-4aba-8aba-abababababa1', false);
select set_config('request.jwt.claims', '{"sub":"abababab-abab-4aba-8aba-abababababa1","role":"authenticated"}', false);
select public.uji((select on_hand = 10 and reserved = 2 and available = 8 from public.posisi_stok where name = 'Posisi A'), 'penjual A melihat cadangan sendiri sebelum lunas');
select public.uji((select on_hand is null and reserved is null and available is null from public.posisi_stok where name = 'Posisi B'), 'penjual A tidak melihat angka stok B');
select public.uji((select count(*) = 0 from public.orders), 'penjual A tidak membaca pesanan induk');
select public.uji((select count(*) = 0 from public.order_items where product_name = 'Posisi B'), 'penjual A tidak membaca baris B');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', 'abababab-abab-4aba-8aba-abababababa2', false);
select set_config('request.jwt.claims', '{"sub":"abababab-abab-4aba-8aba-abababababa2","role":"authenticated"}', false);
select public.uji((select on_hand = 10 and reserved = 3 and available = 7 from public.posisi_stok where name = 'Posisi B'), 'penjual B melihat cadangan sendiri sebelum lunas');
select public.uji((select count(*) = 0 from public.order_items where product_name = 'Posisi A'), 'penjual B tidak membaca baris A');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', 'abababab-abab-4aba-8aba-abababababa4', false);
select set_config('request.jwt.claims', '{"sub":"abababab-abab-4aba-8aba-abababababa4","role":"authenticated"}', false);
select public.uji((select reserved = 2 and available = 8 from public.posisi_stok where name = 'Posisi A'), 'admin melihat cadangan A');
select public.uji((select reserved = 3 and available = 7 from public.posisi_stok where name = 'Posisi B'), 'admin melihat cadangan B');
reset role;

set role anon;
do $$
begin
  perform 1 from public.posisi_stok;
  raise exception 'UJI GAGAL: anon membaca posisi stok';
exception
  when insufficient_privilege then null;
  when others then
    if sqlerrm like '%UJI GAGAL%' then raise; end if;
end $$;
reset role;

select set_config('uji.gateway', (select gateway_order_id from public.orders where idempotency_key = 'efefefef-efef-4efe-8efe-efefefefefe1'), false);
select set_config('uji.total', (select total::text from public.orders where idempotency_key = 'efefefef-efef-4efe-8efe-efefefefefe1'), false);
set role service_role;
select public.internal_catat_pembayaran(current_setting('uji.gateway'), current_setting('uji.total')::numeric, 'IDR', 'expire', 'accept', 'tx-posisi-expire', true);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', 'abababab-abab-4aba-8aba-abababababa1', false);
select set_config('request.jwt.claims', '{"sub":"abababab-abab-4aba-8aba-abababababa1","role":"authenticated"}', false);
select public.uji((select on_hand = 10 and reserved = 0 and available = 10 from public.posisi_stok where name = 'Posisi A'), 'kedaluwarsa mengosongkan cadangan tanpa mengurangi fisik');
reset role;

set role service_role;
select public.internal_buat_pesanan(
  'abababab-abab-4aba-8aba-abababababa3',
  'efefefef-efef-4efe-8efe-efefefefefe2',
  jsonb_build_array(jsonb_build_object('product_id', current_setting('uji.produk_a'), 'quantity', 4)),
  current_setting('uji.tarif')::uuid,
  null
);
reset role;
select set_config('uji.gateway2', (select gateway_order_id from public.orders where idempotency_key = 'efefefef-efef-4efe-8efe-efefefefefe2'), false);
select set_config('uji.total2', (select total::text from public.orders where idempotency_key = 'efefefef-efef-4efe-8efe-efefefefefe2'), false);
set role service_role;
select public.internal_catat_pembayaran(current_setting('uji.gateway2'), current_setting('uji.total2')::numeric, 'IDR', 'settlement', 'accept', 'tx-posisi-bayar', true);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', 'abababab-abab-4aba-8aba-abababababa1', false);
select set_config('request.jwt.claims', '{"sub":"abababab-abab-4aba-8aba-abababababa1","role":"authenticated"}', false);
select public.uji((select on_hand = 6 and reserved = 0 and available = 6 from public.posisi_stok where name = 'Posisi A'), 'pelunasan mengurangi fisik dan melepas cadangan');
reset role;

set role service_role;
select public.internal_buat_pesanan(
  'abababab-abab-4aba-8aba-abababababa3',
  'efefefef-efef-4efe-8efe-efefefefefe3',
  jsonb_build_array(jsonb_build_object('product_id', current_setting('uji.produk_b'), 'quantity', 1)),
  current_setting('uji.tarif')::uuid,
  null
);
reset role;
select set_config('uji.gateway3', (select gateway_order_id from public.orders where idempotency_key = 'efefefef-efef-4efe-8efe-efefefefefe3'), false);
select set_config('uji.total3', (select total::text from public.orders where idempotency_key = 'efefefef-efef-4efe-8efe-efefefefefe3'), false);
set role service_role;
select public.internal_catat_pembayaran(current_setting('uji.gateway3'), current_setting('uji.total3')::numeric, 'IDR', 'cancel', 'accept', 'tx-posisi-batal', true);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', 'abababab-abab-4aba-8aba-abababababa2', false);
select set_config('request.jwt.claims', '{"sub":"abababab-abab-4aba-8aba-abababababa2","role":"authenticated"}', false);
select public.uji((select on_hand = 10 and reserved = 0 and available = 10 from public.posisi_stok where name = 'Posisi B'), 'pembatalan tidak mengurangi fisik B');
reset role;
