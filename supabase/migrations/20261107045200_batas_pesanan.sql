-- Fungsi pembayaran pindah ke private. Pembungkus public adalah security invoker.
-- Penjual hanya membaca barisnya sendiri, bukan total atau baris penjual lain.

create schema if not exists extensions;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions'
      and p.proname = 'digest'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'text, text'
  ) then
    execute $fn$
      create function extensions.digest(data text, type text)
      returns bytea
      language sql
      immutable
      set search_path = ''
      as $body$ select public.digest(data, type) $body$
    $fn$;
  end if;
end $$;

grant usage on schema private to service_role;

create or replace function private.pesanan_terlihat(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin())
    or exists (
      select 1 from public.orders o
      where o.id = p_order and o.buyer_id = (select auth.uid())
    );
$$;

revoke all on function private.pesanan_terlihat(uuid) from public, anon, authenticated;
grant execute on function private.pesanan_terlihat(uuid) to authenticated;

create or replace function private.pesanan_sudah_dibayar(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders
    where id = p_order and payment_status = 'dibayar'
  );
$$;

revoke all on function private.pesanan_sudah_dibayar(uuid) from public, anon, authenticated;
grant execute on function private.pesanan_sudah_dibayar(uuid) to authenticated;

create or replace function public.jaga_order_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
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
    if not private.pesanan_sudah_dibayar(new.order_id) then
      raise exception 'Pemenuhan hanya dapat diubah setelah pembayaran tercatat server';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.jaga_order_item() from public, anon, authenticated;

create or replace function private.ringkasan_pesanan_penjual(p_order uuid)
returns table (
  payment_status text,
  created_at timestamptz,
  buyer_name text,
  shipping_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.payment_status,
    o.created_at,
    case when o.payment_status = 'dibayar' then b.display_name else null end,
    case when o.payment_status = 'dibayar' then o.shipping_note else null end
  from public.orders o
  join public.profiles b on b.id = o.buyer_id
  where o.id = p_order
    and exists (
      select 1 from public.order_items i
      where i.order_id = o.id
        and i.seller_id = (select auth.uid())
    );
$$;

revoke all on function private.ringkasan_pesanan_penjual(uuid) from public, anon, authenticated;
grant execute on function private.ringkasan_pesanan_penjual(uuid) to authenticated;

drop view if exists public.baris_pesanan_penjual;
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
  r.payment_status,
  r.created_at,
  r.buyer_name,
  r.shipping_note
from public.order_items i
cross join lateral private.ringkasan_pesanan_penjual(i.order_id) r
where i.seller_id = (select auth.uid());

grant select on public.baris_pesanan_penjual to authenticated;

drop policy if exists pesanan_baca on public.orders;
create policy pesanan_baca
on public.orders
for select
to authenticated
using (
  buyer_id = (select auth.uid())
  or (select private.is_admin())
);

drop policy if exists butir_baca on public.order_items;
create policy butir_baca
on public.order_items
for select
to authenticated
using (
  seller_id = (select auth.uid())
  or (select private.is_admin())
  or exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.buyer_id = (select auth.uid())
  )
);

create or replace function private.internal_buat_pesanan(
  p_buyer uuid,
  p_idempotency uuid,
  p_items jsonb,
  p_shipping_rate uuid,
  p_shipping_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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
  v_seen uuid[] := array[]::uuid[];
begin
  if p_buyer is null or p_idempotency is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Permintaan pesanan tidak lengkap';
  end if;
  if (select count(*) from public.orders where buyer_id = p_buyer and created_at > now() - interval '10 minutes') >= 8 then
    raise exception 'Terlalu banyak percobaan pesanan. Tunggu beberapa menit.';
  end if;
  v_hash := encode(extensions.digest(jsonb_build_object('items', p_items, 'shipping_rate', p_shipping_rate, 'note', coalesce(p_shipping_note, ''))::text, 'sha256'), 'hex');
  select * into v_existing from public.orders where buyer_id = p_buyer and idempotency_key = p_idempotency;
  if found then
    if v_existing.payload_hash is distinct from v_hash then
      raise exception 'Kunci idempotensi sudah dipakai untuk pesanan lain';
    end if;
    return jsonb_build_object('order_id', v_existing.id, 'payment_status', v_existing.payment_status, 'subtotal', v_existing.subtotal, 'shipping_amount', v_existing.shipping_amount, 'total', v_existing.total, 'blocked_reason', v_existing.payment_blocked_reason, 'gateway_order_id', v_existing.gateway_order_id, 'repeated', true);
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
  begin
    insert into public.orders (
      buyer_id, idempotency_key, payload_hash, subtotal, shipping_rate_id, shipping_amount, total,
      payment_blocked_reason, payment_environment, gateway_order_id, shipping_note
    ) values (
      p_buyer, p_idempotency, v_hash, v_subtotal, p_shipping_rate, v_shipping, v_total,
      v_blocked, case when v_blocked is null then 'sandbox' else null end, v_gateway, nullif(btrim(coalesce(p_shipping_note, '')), '')
    ) returning id into v_order_id;
  exception
    when unique_violation then
      select * into v_existing from public.orders where buyer_id = p_buyer and idempotency_key = p_idempotency;
      if v_existing.payload_hash is distinct from v_hash then
        raise exception 'Kunci idempotensi sudah dipakai untuk pesanan lain';
      end if;
      return jsonb_build_object('order_id', v_existing.id, 'payment_status', v_existing.payment_status, 'subtotal', v_existing.subtotal, 'shipping_amount', v_existing.shipping_amount, 'total', v_existing.total, 'blocked_reason', v_existing.payment_blocked_reason, 'gateway_order_id', v_existing.gateway_order_id, 'repeated', true);
  end;
  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    insert into public.order_items (order_id, seller_id, product_id, product_name, unit_price, quantity, line_total)
    values (v_order_id, v_product.seller_id, v_product.id, v_product.name, v_product.price, v_qty, v_product.price * v_qty);
  end loop;
  return jsonb_build_object('order_id', v_order_id, 'payment_status', 'menunggu_pembayaran', 'subtotal', v_subtotal, 'shipping_amount', v_shipping, 'total', v_total, 'blocked_reason', v_blocked, 'gateway_order_id', v_gateway, 'repeated', false);
end;
$$;

create or replace function private.internal_simpan_snap(p_order uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_url is null or p_url !~ '^https://app\.sandbox\.midtrans\.com/' then
    raise exception 'Tautan pembayaran harus sandbox Midtrans';
  end if;
  insert into public.order_checkout (order_id, snap_redirect_url)
  values (p_order, p_url)
  on conflict (order_id) do nothing;
end;
$$;

create or replace function private.internal_catat_pembayaran(
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
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_next text;
  v_note text := 'diterima';
  v_accept boolean := false;
begin
  select * into v_order
  from public.orders
  where gateway_order_id = p_gateway_order_id
  for update;
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

revoke all on function private.internal_buat_pesanan(uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function private.internal_simpan_snap(uuid, text) from public, anon, authenticated;
revoke all on function private.internal_catat_pembayaran(text, numeric, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function private.internal_buat_pesanan(uuid, uuid, jsonb, uuid, text) to service_role;
grant execute on function private.internal_simpan_snap(uuid, text) to service_role;
grant execute on function private.internal_catat_pembayaran(text, numeric, text, text, text, text, boolean) to service_role;

drop function if exists public.internal_buat_pesanan(uuid, uuid, jsonb, uuid, text);
drop function if exists public.internal_simpan_snap(uuid, text);
drop function if exists public.internal_catat_pembayaran(text, numeric, text, text, text, text, boolean);

create or replace function public.internal_buat_pesanan(
  p_buyer uuid,
  p_idempotency uuid,
  p_items jsonb,
  p_shipping_rate uuid,
  p_shipping_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Fungsi pesanan tidak tersedia untuk klien';
  end if;
  return private.internal_buat_pesanan(p_buyer, p_idempotency, p_items, p_shipping_rate, p_shipping_note);
end;
$$;

create or replace function public.internal_simpan_snap(p_order uuid, p_url text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Fungsi pesanan tidak tersedia untuk klien';
  end if;
  perform private.internal_simpan_snap(p_order, p_url);
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
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Fungsi pembayaran tidak tersedia untuk klien';
  end if;
  return private.internal_catat_pembayaran(p_gateway_order_id, p_gross_amount, p_currency, p_transaction_status, p_fraud_status, p_transaction_id, p_signature_ok);
end;
$$;

revoke all on function public.internal_buat_pesanan(uuid, uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.internal_simpan_snap(uuid, text) from public, anon, authenticated;
revoke all on function public.internal_catat_pembayaran(text, numeric, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.internal_buat_pesanan(uuid, uuid, jsonb, uuid, text) to service_role;
grant execute on function public.internal_simpan_snap(uuid, text) to service_role;
grant execute on function public.internal_catat_pembayaran(text, numeric, text, text, text, text, boolean) to service_role;
