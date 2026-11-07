-- Stok dan pembayaran akhir. Kunci pesanan dulu, lalu produk menurut id.
-- Pembungkus public tetap security invoker.

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
  v_updated uuid;
begin
  if p_buyer is null or p_idempotency is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Permintaan pesanan tidak lengkap';
  end if;
  if (select count(*) from public.orders where buyer_id = p_buyer and created_at > now() - interval '10 minutes') >= 8 then
    raise exception 'Terlalu banyak percobaan pesanan. Tunggu beberapa menit.';
  end if;
  v_hash := encode(extensions.digest(jsonb_build_object('items', p_items, 'shipping_rate', p_shipping_rate, 'note', coalesce(p_shipping_note, ''))::text, 'sha256'), 'hex');
  select * into v_existing from public.orders where buyer_id = p_buyer and idempotency_key = p_idempotency for update;
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
    begin
      v_qty := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'Jumlah produk tidak valid';
    end;
    if v_qty is null or v_qty < 1 or v_qty > 99 or (v_item->>'quantity') !~ '^[1-9][0-9]?$' then
      raise exception 'Jumlah produk tidak valid';
    end if;
    if (v_item->>'product_id')::uuid = any (v_seen) then
      raise exception 'Produk yang sama diulang dalam satu pesanan';
    end if;
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid;
    if not found or v_product.status is distinct from 'disetujui' or v_product.contoh or v_product.archived then
      raise exception 'Produk tidak dapat dipesan. Hanya produk disetujui yang bukan contoh.';
    end if;
    v_seen := array_append(v_seen, v_product.id);
    v_subtotal := v_subtotal + (v_product.price * v_qty);
  end loop;
  if p_shipping_rate is null then
    v_blocked := 'ongkir_belum_dikonfigurasi';
    v_shipping := null;
    v_total := null;
  else
    select * into v_rate from public.shipping_rates where id = p_shipping_rate and active and sandbox_only;
    if not found then raise exception 'Tarif kirim tidak tersedia'; end if;
    v_blocked := null;
    v_shipping := v_rate.amount_idr;
    v_total := v_subtotal + v_shipping;
    perform p.id
    from public.products p
    where p.id = any (v_seen)
    order by p.id
    for update;
    for v_item in select value from jsonb_array_elements(p_items) loop
      v_qty := (v_item->>'quantity')::integer;
      select * into v_product from public.products where id = (v_item->>'product_id')::uuid;
      v_updated := null;
      if v_product.stock is not null and v_product.stock - coalesce((
        select sum(i.quantity) from public.order_items i
        join public.orders o on o.id = i.order_id
        where i.product_id = v_product.id and o.stock_reserved
      ), 0) >= v_qty then
        v_updated := v_product.id;
      end if;
      if v_updated is null then
        raise exception 'Stok tidak cukup atau belum diatur';
      end if;
    end loop;
  end if;
  v_gateway := 'tki' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.orders (
      buyer_id, idempotency_key, payload_hash, subtotal, shipping_rate_id, shipping_amount, total,
      payment_blocked_reason, payment_environment, gateway_order_id, shipping_note, stock_reserved
    ) values (
      p_buyer, p_idempotency, v_hash, v_subtotal, p_shipping_rate, v_shipping, v_total,
      v_blocked, case when v_blocked is null then 'sandbox' else null end, v_gateway,
      nullif(btrim(coalesce(p_shipping_note, '')), ''), v_blocked is null
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
  v_rows integer;
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
  if p_currency is distinct from 'IDR' or v_order.total is null or p_gross_amount is distinct from v_order.total::numeric then
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
    if v_order.stock_reserved and v_next in ('dibayar', 'gagal', 'kedaluwarsa', 'dibatalkan') then
      perform p.id
      from public.products p
      join public.order_items i on i.product_id = p.id
      where i.order_id = v_order.id
      order by p.id
      for update of p;
    end if;
    if v_order.stock_reserved and v_next = 'dibayar' then
      perform set_config('app.stok_tercatat', '1', true);
      update public.products p
      set stock = p.stock - i.quantity,
          stock_version = p.stock_version + 1
      from public.order_items i
      where i.order_id = v_order.id and p.id = i.product_id and p.stock >= i.quantity;
      get diagnostics v_rows = row_count;
      if v_rows <> (select count(*) from public.order_items where order_id = v_order.id) then
        raise exception 'Stok tidak cukup saat pelunasan';
      end if;
      insert into public.inventory_movements (product_id, order_id, actor_id, reason, delta, on_hand_before, on_hand_after, idempotency_key)
      select i.product_id, v_order.id, null, 'penjualan sandbox', -i.quantity, p.stock + i.quantity, p.stock, null
      from public.order_items i
      join public.products p on p.id = i.product_id
      where i.order_id = v_order.id;
    elsif v_order.stock_reserved and v_next in ('gagal', 'kedaluwarsa', 'dibatalkan') then
      insert into public.inventory_movements (product_id, order_id, actor_id, reason, delta, on_hand_before, on_hand_after, idempotency_key)
      select i.product_id, v_order.id, null, 'lepas cadangan', 0, p.stock, p.stock, null
      from public.order_items i
      join public.products p on p.id = i.product_id
      where i.order_id = v_order.id;
    end if;
    update public.orders
    set payment_status = v_next,
        stock_reserved = false,
        updated_at = now()
    where id = v_order.id;
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

create unique index if not exists inventory_gerakan_pesanan_unik
on public.inventory_movements (order_id, product_id)
where reason in ('penjualan sandbox', 'lepas cadangan');

alter function public.kelola_produk_admin(text, uuid, text, integer, integer, text, text, text, text, boolean) set schema private;
alter function public.sesuaikan_stok_admin(uuid, integer, text, integer, uuid, integer) set schema private;

create or replace function public.kelola_produk_admin(
  p_aksi text,
  p_id uuid,
  p_name text,
  p_price integer,
  p_stock integer,
  p_description text,
  p_category text,
  p_image_path text,
  p_status text,
  p_archived boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'Hanya admin';
  end if;
  return private.kelola_produk_admin(p_aksi, p_id, p_name, p_price, p_stock, p_description, p_category, p_image_path, p_status, p_archived);
end;
$$;

create or replace function public.sesuaikan_stok_admin(
  p_id uuid,
  p_on_hand integer,
  p_reason text,
  p_expected_version integer,
  p_idempotency uuid,
  p_low_stock integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'Hanya admin';
  end if;
  return private.sesuaikan_stok_admin(p_id, p_on_hand, p_reason, p_expected_version, p_idempotency, p_low_stock);
end;
$$;

revoke all on function public.kelola_produk_admin(text, uuid, text, integer, integer, text, text, text, text, boolean) from public, anon;
revoke all on function public.sesuaikan_stok_admin(uuid, integer, text, integer, uuid, integer) from public, anon;
grant execute on function public.kelola_produk_admin(text, uuid, text, integer, integer, text, text, text, text, boolean) to authenticated;
grant execute on function public.sesuaikan_stok_admin(uuid, integer, text, integer, uuid, integer) to authenticated;

revoke all on function private.kelola_produk_admin(text, uuid, text, integer, integer, text, text, text, text, boolean) from public, anon;
revoke all on function private.sesuaikan_stok_admin(uuid, integer, text, integer, uuid, integer) from public, anon;
grant execute on function private.kelola_produk_admin(text, uuid, text, integer, integer, text, text, text, text, boolean) to authenticated;
grant execute on function private.sesuaikan_stok_admin(uuid, integer, text, integer, uuid, integer) to authenticated;

alter function public.catat_stok_awal() set schema private;
drop trigger if exists produk_stok_awal on public.products;
create trigger produk_stok_awal
after insert on public.products
for each row execute function private.catat_stok_awal();
revoke all on function private.catat_stok_awal() from public, anon, authenticated;
