\set ON_ERROR_STOP on

select id as produk_a from public.products where name = 'Produk A' \gset
select id as tarif from public.shipping_rates where label = 'Uji campuran' limit 1 \gset

set role service_role;
select public.internal_buat_pesanan(
  '44444444-4444-4444-8444-444444444444',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  jsonb_build_array(jsonb_build_object('product_id', :'produk_a', 'quantity', 1)),
  :'tarif'::uuid,
  null
);
select public.internal_buat_pesanan(
  '44444444-4444-4444-8444-444444444444',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
  jsonb_build_array(jsonb_build_object('product_id', :'produk_a', 'quantity', 1)),
  :'tarif'::uuid,
  null
);
select public.internal_buat_pesanan(
  '44444444-4444-4444-8444-444444444444',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
  jsonb_build_array(jsonb_build_object('product_id', :'produk_a', 'quantity', 1)),
  :'tarif'::uuid,
  null
);
reset role;
