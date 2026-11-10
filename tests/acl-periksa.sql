\set ON_ERROR_STOP on

create or replace function public.uji(kondisi boolean, pesan text)
returns void
language plpgsql
as $$
begin
  if kondisi is not true then
    raise exception 'UJI GAGAL: %', pesan;
  end if;
end;
$$;

select public.uji(not has_table_privilege('anon', 'public.admin_audit', 'SELECT'), 'anon tidak membaca audit');
select public.uji(not has_table_privilege('anon', 'public.admin_notifications', 'SELECT'), 'anon tidak membaca notifikasi admin');
select public.uji(not has_table_privilege('anon', 'public.orders', 'SELECT'), 'anon tidak membaca pesanan');
select public.uji(not has_table_privilege('anon', 'public.posisi_stok', 'SELECT'), 'anon tidak membaca posisi stok');
select public.uji(has_table_privilege('anon', 'public.etalase', 'SELECT'), 'anon membaca etalase');
select public.uji(has_table_privilege('anon', 'public.products', 'SELECT'), 'anon membaca produk');
select public.uji(not has_table_privilege('anon', 'public.products', 'INSERT'), 'anon tidak menambah produk');
select public.uji(not has_table_privilege('anon', 'public.products', 'TRUNCATE'), 'anon tidak mengosongkan produk');
select public.uji(not has_table_privilege('authenticated', 'public.products', 'TRUNCATE'), 'pengguna tidak mengosongkan produk');
select public.uji(not has_table_privilege('service_role', 'public.products', 'TRUNCATE'), 'service role tidak mengosongkan produk');
select public.uji(not has_table_privilege('authenticated', 'public.orders', 'TRUNCATE'), 'pengguna tidak mengosongkan pesanan');
select public.uji(not has_table_privilege('authenticated', 'public.orders', 'TRIGGER'), 'pengguna tidak punya trigger pesanan');
select public.uji(not has_table_privilege('authenticated', 'public.orders', 'REFERENCES'), 'pengguna tidak punya references pesanan');
select public.uji(not has_table_privilege('anon', 'public.profiles', 'TRIGGER'), 'anon tidak punya trigger profil');
select public.uji(not has_table_privilege('service_role', 'public.orders', 'REFERENCES'), 'service role tidak punya references pesanan');
select public.uji(not has_table_privilege('service_role', 'public.orders', 'TRIGGER'), 'service role tidak punya trigger pesanan');
select public.uji(not has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'), 'id profil tidak dapat diubah');
select public.uji(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE'), 'nama tampilan dapat diubah');
select public.uji(not has_column_privilege('authenticated', 'public.order_items', 'id', 'UPDATE'), 'id baris tidak dapat diubah');
select public.uji(has_column_privilege('authenticated', 'public.order_items', 'fulfillment_status', 'UPDATE'), 'pemenuhan dapat diubah');
select public.uji(not has_column_privilege('authenticated', 'public.admin_notifications', 'id', 'UPDATE'), 'id notifikasi tidak dapat diubah');
select public.uji(has_column_privilege('authenticated', 'public.admin_notifications', 'read_at', 'UPDATE'), 'status baca notifikasi dapat diubah');
select public.uji(not has_column_privilege('authenticated', 'public.products', 'id', 'UPDATE'), 'id produk tidak dapat diubah');
select public.uji(not has_column_privilege('authenticated', 'public.products', 'stock', 'UPDATE'), 'stok fisik tidak diubah langsung');
select public.uji(not has_column_privilege('authenticated', 'public.products', 'stock_version', 'UPDATE'), 'versi stok tidak diubah langsung');
select public.uji(not has_column_privilege('authenticated', 'public.products', 'low_stock_threshold', 'UPDATE'), 'ambang tidak diubah langsung');
select public.uji(has_column_privilege('authenticated', 'public.products', 'name', 'UPDATE'), 'nama produk dapat diubah');
select public.uji(not has_function_privilege('anon', 'public.internal_buat_pesanan(uuid,uuid,jsonb,uuid,text)', 'EXECUTE'), 'anon tidak menjalankan buat pesanan');
select public.uji(not has_function_privilege('authenticated', 'public.internal_buat_pesanan(uuid,uuid,jsonb,uuid,text)', 'EXECUTE'), 'pengguna tidak menjalankan buat pesanan');
select public.uji(not has_function_privilege('authenticated', 'public.internal_catat_pembayaran(text,numeric,text,text,text,text,boolean)', 'EXECUTE'), 'pengguna tidak menjalankan catat pembayaran');
select public.uji(has_function_privilege('service_role', 'public.internal_buat_pesanan(uuid,uuid,jsonb,uuid,text)', 'EXECUTE'), 'service role menjalankan buat pesanan');
select public.uji(has_function_privilege('service_role', 'public.internal_catat_pembayaran(text,numeric,text,text,text,text,boolean)', 'EXECUTE'), 'service role menjalankan catat pembayaran');
select public.uji(not has_function_privilege('anon', 'private.angka_stok(uuid)', 'EXECUTE'), 'anon tidak menjalankan angka stok');
select public.uji(not has_function_privilege('authenticated', 'private.internal_buat_pesanan(uuid,uuid,jsonb,uuid,text)', 'EXECUTE'), 'pengguna tidak menjalankan fungsi private pesanan');
select public.uji(has_function_privilege('service_role', 'private.internal_catat_pembayaran(text,numeric,text,text,text,text,boolean)', 'EXECUTE'), 'service role menjalankan fungsi private pembayaran');
select public.uji(has_function_privilege('authenticated', 'private.is_admin()', 'EXECUTE'), 'pengguna boleh memakai penanda admin');
select public.uji(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon tidak memakai skema private');

insert into auth.users (id, email, raw_user_meta_data)
values ('acacacac-acac-4aca-8aca-acacacacaca1', 'acl-penjual@example.test', '{"display_name":"Penjual Acl"}');
select set_config('request.jwt.claim.sub', 'acacacac-acac-4aca-8aca-acacacacaca1', false);
select set_config('request.jwt.claims', '{"sub":"acacacac-acac-4aca-8aca-acacacacaca1","role":"authenticated"}', false);
set role authenticated;
update public.profiles set role = 'penjual', shop_name = 'Toko Acl' where id = auth.uid();
insert into public.products (seller_id, name, price, description, category)
values (auth.uid(), 'Produk Acl', 10000, 'Produk uji hak akses kolom.', 'Uji');
do $$
begin
  update public.products set stock_version = 9 where name = 'Produk Acl';
  raise exception 'UJI GAGAL: penjual mengubah versi stok';
exception
  when insufficient_privilege then null;
  when others then
    if sqlerrm like '%UJI GAGAL%' then raise; end if;
end $$;
do $$
begin
  update public.products set low_stock_threshold = 1 where name = 'Produk Acl';
  raise exception 'UJI GAGAL: penjual mengubah ambang';
exception
  when insufficient_privilege then null;
  when others then
    if sqlerrm like '%UJI GAGAL%' then raise; end if;
end $$;
do $$
begin
  update public.products set stock = 3 where name = 'Produk Acl';
  raise exception 'UJI GAGAL: penjual mengubah stok langsung';
exception
  when insufficient_privilege then null;
  when others then
    if sqlerrm like '%UJI GAGAL%' then raise; end if;
end $$;
do $$
begin
  update public.profiles set id = gen_random_uuid() where id = auth.uid();
  raise exception 'UJI GAGAL: penjual mengubah id profil';
exception
  when insufficient_privilege then null;
  when others then
    if sqlerrm like '%UJI GAGAL%' then raise; end if;
end $$;
do $$
begin
  update public.order_items set id = gen_random_uuid();
  raise exception 'UJI GAGAL: penjual mengubah id baris';
exception
  when insufficient_privilege then null;
  when others then
    if sqlerrm like '%UJI GAGAL%' then raise; end if;
end $$;
reset role;

do $$
begin
  update public.products set stock_version = 9 where name = 'Produk Acl';
  raise exception 'UJI GAGAL: pemilik tabel mengubah versi stok';
exception
  when others then
    if sqlerrm not like '%Versi stok%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
end $$;
do $$
begin
  update public.products set id = gen_random_uuid() where name = 'Produk Acl';
  raise exception 'UJI GAGAL: pemilik tabel mengubah id produk';
exception
  when others then
    if sqlerrm not like '%Identitas produk%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
end $$;
insert into public.orders (buyer_id, idempotency_key, payload_hash, subtotal, gateway_order_id)
values ('acacacac-acac-4aca-8aca-acacacacaca1', 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcb1', 'hash', 10000, 'tkiacl1');
insert into public.order_items (order_id, seller_id, product_id, product_name, unit_price, quantity, line_total)
select id, 'acacacac-acac-4aca-8aca-acacacacaca1', (select id from public.products where name = 'Produk Acl'), 'Produk Acl', 10000, 1, 10000
from public.orders where idempotency_key = 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcb1';
do $$
begin
  update public.order_items set id = gen_random_uuid() where product_name = 'Produk Acl';
  raise exception 'UJI GAGAL: pemilik tabel mengubah id baris';
exception
  when others then
    if sqlerrm not like '%Rincian pesanan%' and sqlerrm not like '%UJI GAGAL%' then raise; end if;
end $$;
set role anon;
do $$
begin
  perform 1 from public.admin_audit;
  raise exception 'UJI GAGAL: anon membaca audit';
exception
  when insufficient_privilege then null;
  when others then
    if sqlerrm like '%UJI GAGAL%' then raise; end if;
end $$;
do $$
begin
  perform 1 from public.admin_notifications;
  raise exception 'UJI GAGAL: anon membaca notifikasi admin';
exception
  when insufficient_privilege then null;
  when others then
    if sqlerrm like '%UJI GAGAL%' then raise; end if;
end $$;
reset role;
