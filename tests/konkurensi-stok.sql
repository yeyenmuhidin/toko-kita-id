\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'penjual-kunci@example.test', '{"display_name":"Penjual Kunci"}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'pembeli-kunci@example.test', '{"display_name":"Pembeli Kunci"}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'admin-kunci@example.test', '{"display_name":"Admin Kunci"}');

update public.profiles set role = 'admin' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', false);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}', false);
set role authenticated;
update public.profiles set role = 'penjual', shop_name = 'Toko Kunci' where id = auth.uid();
insert into public.products (seller_id, name, price, description, category)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Kunci Cukup', 10000, 'Produk uji kunci stok cukup.', 'Uji'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Kunci Tipis', 10000, 'Produk uji kunci stok satu.', 'Uji');
reset role;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', false);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3","role":"authenticated"}', false);
select set_config('app.kelola_admin', '1', false);
set role authenticated;
update public.products set status = 'disetujui' where name in ('Kunci Cukup', 'Kunci Tipis');
select public.sesuaikan_stok_admin((select id from public.products where name = 'Kunci Cukup'), 5, 'stok uji kunci', 0, 'cccccccc-cccc-4ccc-8ccc-cccccccccc10', null);
select public.sesuaikan_stok_admin((select id from public.products where name = 'Kunci Tipis'), 1, 'stok uji kunci', 0, 'cccccccc-cccc-4ccc-8ccc-cccccccccc11', null);
reset role;

insert into public.shipping_rates (label, amount_idr, active, sandbox_only)
values ('Uji kunci', 500, true, true);
