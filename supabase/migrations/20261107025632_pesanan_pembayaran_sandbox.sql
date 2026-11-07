-- Pesanan dan pembayaran sandbox Midtrans. Produksi tidak diizinkan.
-- Tidak ada kunci, rekening, atau tarif ongkir di berkas ini.

create extension if not exists pgcrypto;

create table public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  amount_idr integer not null,
  active boolean not null default false,
  sandbox_only boolean not null default true,
  created_at timestamptz not null default now(),
  constraint shipping_rates_label_check check (char_length(label) between 2 and 80 and label !~ '[<>]'),
  constraint shipping_rates_amount_check check (amount_idr >= 0 and amount_idr <= 999999999),
  constraint shipping_rates_sandbox_check check (sandbox_only)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles (id),
  idempotency_key uuid not null,
  payload_hash text not null,
  payment_status text not null default 'menunggu_pembayaran',
  currency text not null default 'IDR',
  subtotal integer not null,
  shipping_rate_id uuid references public.shipping_rates (id),
  shipping_amount integer,
  total integer,
  payment_blocked_reason text,
  payment_environment text,
  gateway_order_id text not null unique,
  shipping_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_status_check check (payment_status in ('menunggu_pembayaran', 'dibayar', 'gagal', 'kedaluwarsa', 'dibatalkan')),
  constraint orders_currency_check check (currency = 'IDR'),
  constraint orders_environment_check check (payment_environment is null or payment_environment = 'sandbox'),
  constraint orders_money_check check (
    subtotal >= 0
    and (shipping_amount is null or shipping_amount >= 0)
    and (total is null or total = subtotal + shipping_amount)
  ),
  constraint orders_note_check check (shipping_note is null or (char_length(shipping_note) <= 300 and shipping_note !~ '[<>]')),
  constraint orders_buyer_idempotency unique (buyer_id, idempotency_key)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  seller_id uuid not null references public.profiles (id),
  product_id uuid not null references public.products (id),
  product_name text not null,
  unit_price integer not null,
  quantity integer not null,
  line_total integer not null,
  fulfillment_status text not null default 'belum_diproses',
  constraint order_items_qty_check check (quantity between 1 and 99),
  constraint order_items_price_check check (unit_price >= 0 and line_total = unit_price * quantity),
  constraint order_items_fulfillment_check check (fulfillment_status in ('belum_diproses', 'dikemas', 'dikirim', 'selesai'))
);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  transaction_id text,
  transaction_status text,
  accepted boolean not null,
  note text not null,
  created_at timestamptz not null default now()
);

create unique index order_events_idempotent
on public.order_events (order_id, transaction_id, transaction_status)
where transaction_id is not null and transaction_status is not null;

create table public.order_checkout (
  order_id uuid primary key references public.orders (id) on delete cascade,
  snap_redirect_url text,
  created_at timestamptz not null default now()
);

create table public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index order_items_seller_idx on public.order_items (seller_id, order_id);
create index admin_notifications_unread_idx on public.admin_notifications (read_at, created_at desc);

create or replace function public.jaga_order_item()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  status_bayar text;
begin
  if tg_op = 'UPDATE' then
    if new.order_id is distinct from old.order_id
      or new.seller_id is distinct from old.seller_id
      or new.product_id is distinct from old.product_id
      or new.product_name is distinct from old.product_name
      or new.unit_price is distinct from old.unit_price
      or new.quantity is distinct from old.quantity
      or new.line_total is distinct from old.line_total then
      raise exception 'Rincian pesanan tidak dapat diubah';
    end if;
    select payment_status into status_bayar from public.orders where id = new.order_id;
    if status_bayar is distinct from 'dibayar' then
      raise exception 'Pemenuhan hanya dapat diubah setelah pembayaran tercatat server';
    end if;
  end if;
  return new;
end;
$$;

create trigger order_items_jaga
before update on public.order_items
for each row execute function public.jaga_order_item();

create or replace function public.catat_notifikasi_pesanan()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.payment_status is distinct from old.payment_status then
    insert into public.admin_notifications (order_id, message)
    values (new.id, 'Status pembayaran ' || new.gateway_order_id || ' menjadi ' || new.payment_status);
  end if;
  return new;
end;
$$;

create trigger orders_notifikasi
after update on public.orders
for each row execute function public.catat_notifikasi_pesanan();

revoke all on function public.jaga_order_item() from public, anon, authenticated;
revoke all on function public.catat_notifikasi_pesanan() from public, anon, authenticated;

create or replace function public.internal_buat_pesanan(
  p_buyer uuid,
  p_idempotency uuid,
  p_items jsonb,
  p_shipping_rate uuid,
  p_shipping_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_existing public.orders%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_subtotal integer := 0;
  v_rate public.shipping_rates%rowtype;
  v_shipping integer;
  v_total integer;
  v_blocked text;
  v_order_id uuid;
  v_gateway text;
  v_count integer;
  v_seen uuid[] := array[]::uuid[];
begin
  if auth.role() is distinct from 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Fungsi pesanan tidak tersedia untuk klien';
  end if;
  if p_buyer is null or p_idempotency is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Permintaan pesanan tidak lengkap';
  end if;
  if (select count(*) from public.orders where buyer_id = p_buyer and created_at > now() - interval '10 minutes') >= 8 then
    raise exception 'Terlalu banyak percobaan pesanan. Tunggu beberapa menit.';
  end if;

  v_hash := encode(digest(jsonb_build_object('items', p_items, 'shipping_rate', p_shipping_rate, 'note', coalesce(p_shipping_note, ''))::text, 'sha256'), 'hex');
  select * into v_existing from public.orders where buyer_id = p_buyer and idempotency_key = p_idempotency;
  if found then
    if v_existing.payload_hash is distinct from v_hash then
      raise exception 'Kunci idempotensi sudah dipakai untuk pesanan lain';
    end if;
    return jsonb_build_object(
      'order_id', v_existing.id,
      'payment_status', v_existing.payment_status,
      'subtotal', v_existing.subtotal,
      'shipping_amount', v_existing.shipping_amount,
      'total', v_existing.total,
      'blocked_reason', v_existing.payment_blocked_reason,
      'gateway_order_id', v_existing.gateway_order_id,
      'repeated', true
    );
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then
    raise exception 'Jumlah jenis produk tidak valid';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception 'Jumlah produk tidak valid';
    end if;
    if (v_item->>'product_id')::uuid = any (v_seen) then
      raise exception 'Produk yang sama diulang dalam satu pesanan';
    end if;
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid;
    if not found or v_product.status is distinct from 'disetujui' or v_product.contoh then
      raise exception 'Produk tidak dapat dipesan. Hanya produk disetujui yang bukan contoh.';
    end if;
    v_seen := array_append(v_seen, v_product.id);
    v_subtotal := v_subtotal + (v_product.price * v_qty);
  end loop;

  v_blocked := null;
  v_shipping := null;
  v_total := null;
  if p_shipping_rate is null then
    v_blocked := 'ongkir_belum_dikonfigurasi';
  else
    select * into v_rate from public.shipping_rates where id = p_shipping_rate and active and sandbox_only;
    if not found then
      raise exception 'Tarif kirim tidak tersedia';
    end if;
    v_shipping := v_rate.amount_idr;
    v_total := v_subtotal + v_shipping;
  end if;

  v_gateway := 'tki' || replace(gen_random_uuid()::text, '-', '');
  insert into public.orders (
    buyer_id, idempotency_key, payload_hash, subtotal, shipping_rate_id, shipping_amount, total,
    payment_blocked_reason, payment_environment, gateway_order_id, shipping_note
  ) values (
    p_buyer, p_idempotency, v_hash, v_subtotal, p_shipping_rate, v_shipping, v_total,
    v_blocked, case when v_blocked is null then 'sandbox' else null end, v_gateway, nullif(btrim(coalesce(p_shipping_note, '')), '')
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    insert into public.order_items (order_id, seller_id, product_id, product_name, unit_price, quantity, line_total)
    values (v_order_id, v_product.seller_id, v_product.id, v_product.name, v_product.price, v_qty, v_product.price * v_qty);
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id,
    'payment_status', 'menunggu_pembayaran',
    'subtotal', v_subtotal,
    'shipping_amount', v_shipping,
    'total', v_total,
    'blocked_reason', v_blocked,
    'gateway_order_id', v_gateway,
    'repeated', false
  );
end;
$$;

create or replace function public.internal_simpan_snap(p_order uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Fungsi pesanan tidak tersedia untuk klien';
  end if;
  if p_url is null or p_url !~ '^https://app\.sandbox\.midtrans\.com/' then
    raise exception 'Tautan pembayaran harus sandbox Midtrans';
  end if;
  insert into public.order_checkout (order_id, snap_redirect_url)
  values (p_order, p_url)
  on conflict (order_id) do nothing;
end;
$$;

create or replace function public.internal_catat_pembayaran(
  p_gateway_order_id text,
  p_gross_amount numeric,
  p_currency text,
  p_transaction_status text,
  p_fraud_status text,
  p_transaction_id text,
  p_signature_ok boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_next text;
  v_note text := 'diterima';
  v_accept boolean := false;
begin
  if auth.role() is distinct from 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Fungsi pembayaran tidak tersedia untuk klien';
  end if;
  select * into v_order from public.orders where gateway_order_id = p_gateway_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'note', 'pesanan_tidak_ditemukan');
  end if;
  if not coalesce(p_signature_ok, false) then
    insert into public.order_events (order_id, transaction_id, transaction_status, accepted, note)
    values (v_order.id, p_transaction_id, p_transaction_status, false, 'tanda_tangan_ditolak');
    return jsonb_build_object('ok', false, 'note', 'tanda_tangan_ditolak');
  end if;
  if p_currency is distinct from 'IDR' or p_gross_amount is distinct from v_order.total::numeric then
    insert into public.order_events (order_id, transaction_id, transaction_status, accepted, note)
    values (v_order.id, p_transaction_id, p_transaction_status, false, 'jumlah_tidak_cocok');
    return jsonb_build_object('ok', false, 'note', 'jumlah_tidak_cocok');
  end if;

  v_next := case
    when p_transaction_status in ('settlement', 'capture') and coalesce(p_fraud_status, 'accept') = 'accept' then 'dibayar'
    when p_transaction_status = 'expire' then 'kedaluwarsa'
    when p_transaction_status in ('deny', 'cancel', 'failure') then 'gagal'
    else null
  end;

  if v_next is null or (v_order.payment_status = 'dibayar' and v_next is distinct from 'dibayar') then
    v_note := 'diabaikan';
  elsif v_order.payment_status = v_next then
    v_note := 'duplikat';
    v_accept := true;
  elsif v_order.payment_status = 'menunggu_pembayaran' then
    update public.orders set payment_status = v_next, updated_at = now() where id = v_order.id;
    v_accept := true;
  else
    v_note := 'diabaikan';
  end if;

  insert into public.order_events (order_id, transaction_id, transaction_status, accepted, note)
  values (v_order.id, p_transaction_id, p_transaction_status, v_accept, v_note)
  on conflict do nothing;

  return jsonb_build_object('ok', v_accept, 'note', v_note, 'payment_status', (select payment_status from public.orders where id = v_order.id));
end;
$$;

revoke all on function public.internal_buat_pesanan(uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.internal_simpan_snap(uuid, text) from public, anon, authenticated;
revoke all on function public.internal_catat_pembayaran(text, numeric, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.internal_buat_pesanan(uuid, uuid, jsonb, uuid, text) to service_role;
grant execute on function public.internal_simpan_snap(uuid, text) to service_role;
grant execute on function public.internal_catat_pembayaran(text, numeric, text, text, text, text, boolean) to service_role;

alter table public.shipping_rates enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.order_checkout enable row level security;
alter table public.admin_notifications enable row level security;

create policy tarif_baca
on public.shipping_rates
for select
to authenticated
using (active or private.is_admin());

create or replace function private.pesanan_terlihat(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.is_admin()
    or exists (select 1 from public.orders o where o.id = p_order and o.buyer_id = auth.uid())
    or exists (select 1 from public.order_items i where i.order_id = p_order and i.seller_id = auth.uid());
$$;

revoke all on function private.pesanan_terlihat(uuid) from public, anon, authenticated;
grant execute on function private.pesanan_terlihat(uuid) to authenticated;

create policy pesanan_baca
on public.orders
for select
to authenticated
using (private.pesanan_terlihat(id));

create policy butir_baca
on public.order_items
for select
to authenticated
using (private.pesanan_terlihat(order_id));

create policy butir_pemenuhan
on public.order_items
for update
to authenticated
using (seller_id = (select auth.uid()) or private.is_admin())
with check (seller_id = (select auth.uid()) or private.is_admin());

create policy kejadian_admin
on public.order_events
for select
to authenticated
using (private.is_admin());

create policy snap_pembeli
on public.order_checkout
for select
to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_checkout.order_id and o.buyer_id = (select auth.uid())
  )
);

create policy notifikasi_admin_baca
on public.admin_notifications
for select
to authenticated
using (private.is_admin());

create policy notifikasi_admin_baca_status
on public.admin_notifications
for update
to authenticated
using (private.is_admin())
with check (private.is_admin());

grant select on public.shipping_rates to authenticated;
grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant update (fulfillment_status) on public.order_items to authenticated;
grant select on public.order_events to authenticated;
grant select on public.order_checkout to authenticated;
grant select, update (read_at) on public.admin_notifications to authenticated;

create view public.baris_pesanan_penjual
with (security_invoker = true) as
select
  i.id,
  i.order_id,
  i.product_name,
  i.unit_price,
  i.quantity,
  i.line_total,
  i.fulfillment_status,
  o.payment_status,
  o.created_at,
  case when o.payment_status = 'dibayar' then b.display_name else null end as buyer_name,
  case when o.payment_status = 'dibayar' then o.shipping_note else null end as shipping_note
from public.order_items i
join public.orders o on o.id = i.order_id
join public.profiles b on b.id = o.buyer_id
where i.seller_id = (select auth.uid());

grant select on public.baris_pesanan_penjual to authenticated;
