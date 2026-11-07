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

\ir ../supabase/migrations/20261107045100_batas_fungsi_anon.sql
\ir ../supabase/migrations/20261107025632_pesanan_pembayaran_sandbox.sql
\ir ../supabase/migrations/20261107045200_batas_pesanan.sql

select id as produk_a from public.products where name = 'Produk A' \gset
select id as produk_b from public.products where name = 'Produk B' \gset
select set_config('uji.produk_a', :'produk_a', false);
select set_config('uji.produk_b', :'produk_b', false);

do $$
begin
  begin
    perform public.internal_buat_pesanan(
      '22222222-2222-4222-8222-222222222222',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      jsonb_build_array(jsonb_build_object('product_id', current_setting('uji.produk_b'), 'quantity', 1, 'price', 1)),
      null,
      null
    );
    raise exception 'UJI GAGAL: produk menunggu bisa dipesan';
  exception
    when others then
      if sqlerrm not like '%tidak dapat dipesan%' then raise; end if;
  end;
end $$;

select public.internal_buat_pesanan(
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  jsonb_build_array(jsonb_build_object('product_id', current_setting('uji.produk_a'), 'quantity', 2, 'price', 1)),
  null,
  'Jalan Uji'
);

select public.uji(
  (select payment_blocked_reason = 'ongkir_belum_dikonfigurasi' and total is null and subtotal = 176000 from public.orders where idempotency_key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  'harga dihitung server dan ongkir kosong memblokir pembayaran'
);

select public.uji((select (public.internal_buat_pesanan(
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  jsonb_build_array(jsonb_build_object('product_id', current_setting('uji.produk_a'), 'quantity', 2, 'price', 1)),
  null,
  'Jalan Uji'
)->>'repeated')::boolean), 'checkout berulang mengembalikan pesanan yang sama');

reset role;
insert into public.shipping_rates (label, amount_idr, active, sandbox_only)
values ('Uji sandbox', 10000, true, true);
select id as tarif from public.shipping_rates limit 1 \gset
select set_config('uji.tarif', :'tarif', false);

select public.uji((select (public.internal_buat_pesanan(
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  jsonb_build_array(jsonb_build_object('product_id', current_setting('uji.produk_a'), 'quantity', 1)),
  current_setting('uji.tarif')::uuid,
  null
)->>'total')::integer = 98000), 'total sandbox memuat tarif yang tersimpan');

select public.internal_catat_pembayaran((select gateway_order_id from public.orders where idempotency_key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'), 1, 'IDR', 'settlement', 'accept', 'tx-salah', true);
select public.uji((select payment_status = 'menunggu_pembayaran' from public.orders where idempotency_key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'), 'jumlah tidak cocok tidak menandai lunas');

select public.internal_catat_pembayaran((select gateway_order_id from public.orders where idempotency_key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'), 98000, 'IDR', 'settlement', 'accept', 'tx-1', false);
select public.uji((select payment_status = 'menunggu_pembayaran' from public.orders where idempotency_key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'), 'tanda tangan palsu tidak menandai lunas');

select public.internal_catat_pembayaran((select gateway_order_id from public.orders where idempotency_key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'), 98000, 'IDR', 'settlement', 'accept', 'tx-1', true);
select public.uji((select payment_status = 'dibayar' from public.orders where idempotency_key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'), 'notifikasi sah menandai lunas');
select public.internal_catat_pembayaran((select gateway_order_id from public.orders where idempotency_key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'), 98000, 'IDR', 'settlement', 'accept', 'tx-1', true);
select public.internal_catat_pembayaran((select gateway_order_id from public.orders where idempotency_key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'), 98000, 'IDR', 'expire', 'accept', 'tx-2', true);
select public.uji((select payment_status = 'dibayar' from public.orders where idempotency_key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'), 'kedaluwarsa setelah lunas diabaikan');

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
select public.uji((select count(*) = 0 from public.baris_pesanan_penjual), 'penjual lain tidak melihat baris ini');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
select public.uji((select count(*) = 2 from public.baris_pesanan_penjual), 'penjual hanya melihat barisnya');
select public.uji((select bool_or(buyer_name is not null) from public.baris_pesanan_penjual), 'nama pembeli terlihat setelah lunas');
update public.order_items
set fulfillment_status = 'dikemas'
where seller_id = auth.uid()
  and id in (select id from public.baris_pesanan_penjual where payment_status = 'dibayar');
select public.uji((select count(*) = 1 from public.order_items where seller_id = '11111111-1111-4111-8111-111111111111' and fulfillment_status = 'dikemas'), 'penjual memperbarui pemenuhan');

do $$
begin
  begin
    update public.orders set payment_status = 'gagal';
    raise exception 'UJI GAGAL: klien mengubah status bayar';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%permission%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
  end;
end $$;

reset role;
set role anon;
do $$
begin
  begin
    perform 1 from public.orders;
    raise exception 'UJI GAGAL: anonim membaca pesanan';
  exception
    when insufficient_privilege then null;
  end;
end $$;
reset role;

select public.uji((select count(*) >= 1 from public.admin_notifications where read_at is null), 'admin mendapat catatan status');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
do $$
begin
  perform public.internal_buat_pesanan(null, null, '[]'::jsonb, null, null);
  raise exception 'UJI GAGAL: klien memanggil pesanan';
exception
  when insufficient_privilege then null;
  when others then
    if sqlerrm not like '%tidak tersedia%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
end $$;
reset role;
set role service_role;
do $$
begin
  perform public.internal_buat_pesanan(null, null, '[]'::jsonb, null, null);
  raise exception 'UJI GAGAL: service role ditolak sebelum validasi';
exception
  when insufficient_privilege then
    raise exception 'UJI GAGAL: service role tidak dapat memanggil RPC pesanan';
  when others then
    if sqlerrm not like '%tidak lengkap%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
end $$;
reset role;

\ir lintas-penjual.sql
