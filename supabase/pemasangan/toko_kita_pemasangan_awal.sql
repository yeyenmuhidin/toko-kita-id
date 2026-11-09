-- Pemasangan awal Toko Kita ID, keadaan akhir yang aman.
-- Nama berkas ini stabil. Bukan versi riwayat remote.
-- Jangan menjalankan supabase db push dan jangan menulis schema_migrations sendiri.
-- Pemilik menerapkan isi berkas ini sekali lewat apply_migration.
-- Versi yang dikembalikan alat itu dipakai untuk mengganti nama berkas pada commit berikutnya.
-- Berkas migrasi lama tidak dipakai. Tidak ada SECURITY DEFINER di skema public.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;


--
-- Name: account_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_role AS ENUM (
    'pembeli',
    'penjual',
    'admin'
);


--
-- Name: product_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.product_status AS ENUM (
    'menunggu',
    'disetujui',
    'ditolak',
    'disembunyikan'
);


--
-- Name: angka_stok(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.angka_stok(p_id uuid) RETURNS TABLE(on_hand integer, low_stock_threshold integer, stock_version integer, reserved integer, available integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    p.stock,
    p.low_stock_threshold,
    p.stock_version,
    coalesce(r.reserved, 0)::integer,
    case when p.stock is null then null else p.stock - coalesce(r.reserved, 0) end
  from public.products p
  left join lateral (
    select sum(i.quantity)::integer as reserved
    from public.order_items i
    join public.orders o on o.id = i.order_id
    where i.product_id = p.id
      and o.stock_reserved
      and (
        (select private.is_admin())
        or i.seller_id = (select auth.uid())
      )
  ) r on true
  where p.id = p_id
    and (
      (select private.is_admin())
      or p.seller_id = (select auth.uid())
    );
$$;


--
-- Name: catat_stok_awal(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.catat_stok_awal() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' and new.stock is not null then
    insert into public.inventory_movements (product_id, actor_id, reason, delta, on_hand_before, on_hand_after)
    values (new.id, auth.uid(), 'stok awal', new.stock, null, new.stock);
  end if;
  return new;
end;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  nama text := left(btrim(coalesce(new.raw_user_meta_data->>'display_name', '')), 80);
begin
  if nama !~ '^[^<>]{2,80}$' then
    nama := 'Pengguna';
  end if;
  insert into public.profiles (id, display_name, role)
  values (new.id, nama, 'pembeli');
  return new;
end;
$_$;


--
-- Name: internal_buat_pesanan(uuid, uuid, jsonb, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.internal_buat_pesanan(p_buyer uuid, p_idempotency uuid, p_items jsonb, p_shipping_rate uuid, p_shipping_note text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


--
-- Name: internal_catat_pembayaran(text, numeric, text, text, text, text, boolean); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.internal_catat_pembayaran(p_gateway_order_id text, p_gross_amount numeric, p_currency text, p_transaction_status text, p_fraud_status text, p_transaction_id text, p_signature_ok boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: internal_simpan_snap(uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.internal_simpan_snap(p_order uuid, p_url text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if p_url is null or p_url !~ '^https://app\.sandbox\.midtrans\.com/' then
    raise exception 'Tautan pembayaran harus sandbox Midtrans';
  end if;
  insert into public.order_checkout (order_id, snap_redirect_url)
  values (p_order, p_url)
  on conflict (order_id) do nothing;
end;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;


--
-- Name: kelola_produk_admin(text, uuid, text, integer, integer, text, text, text, text, boolean); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.kelola_produk_admin(p_aksi text, p_id uuid, p_name text, p_price integer, p_stock integer, p_description text, p_category text, p_image_path text, p_status text, p_archived boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_product public.products%rowtype;
  v_id uuid;
  v_summary text;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Hanya admin';
  end if;
  if p_aksi not in ('ubah_produk_penjual', 'ubah_stok', 'setujui', 'tolak', 'sembunyikan', 'arsipkan', 'pulihkan', 'buat_produk_sendiri') then
    raise exception 'Tindakan admin tidak dikenal';
  end if;
  if p_name is not null and (char_length(btrim(p_name)) < 2 or p_name ~ '[<>]') then
    raise exception 'Nama produk tidak valid';
  end if;
  if p_price is not null and (p_price < 0 or p_price > 999999999) then
    raise exception 'Harga tidak valid';
  end if;
  if p_stock is not null and p_stock < 0 then
    raise exception 'Stok tidak boleh negatif';
  end if;
  if p_description is not null and (char_length(btrim(p_description)) < 10 or p_description ~ '[<>]') then
    raise exception 'Deskripsi tidak valid';
  end if;
  if p_category is not null and (char_length(btrim(p_category)) < 2 or p_category ~ '[<>]') then
    raise exception 'Kategori tidak valid';
  end if;
  perform set_config('app.kelola_admin', '1', true);
  if p_aksi = 'buat_produk_sendiri' then
    insert into public.products (seller_id, name, price, stock, description, category, image_path, status, contoh, archived)
    values (auth.uid(), btrim(p_name), p_price, p_stock, btrim(p_description), btrim(p_category), p_image_path, 'menunggu', false, false)
    returning id into v_id;
    v_summary := 'Admin membuat produk sendiri';
  else
    select * into v_product from public.products where id = p_id;
    if not found then
      raise exception 'Produk tidak ditemukan';
    end if;
    if v_product.seller_id is distinct from auth.uid() and p_aksi not in ('ubah_produk_penjual', 'ubah_stok', 'setujui', 'tolak', 'sembunyikan', 'arsipkan', 'pulihkan') then
      raise exception 'Perubahan produk penjual lain harus dinyatakan';
    end if;
    if p_aksi = 'ubah_stok' then
      raise exception 'Stok diubah lewat sesuaikan_stok_admin agar tidak tercatat dua kali';
    elsif p_aksi = 'setujui' then
      update public.products set status = 'disetujui', archived = false where id = p_id;
      v_summary := 'Admin menyetujui produk';
    elsif p_aksi = 'tolak' then
      update public.products set status = 'ditolak' where id = p_id;
      v_summary := 'Admin menolak produk';
    elsif p_aksi = 'sembunyikan' then
      update public.products set status = 'disembunyikan' where id = p_id;
      v_summary := 'Admin menyembunyikan produk';
    elsif p_aksi = 'arsipkan' then
      update public.products set archived = true, status = 'disembunyikan' where id = p_id;
      v_summary := 'Admin mengarsipkan produk';
    elsif p_aksi = 'pulihkan' then
      update public.products set archived = false, status = 'menunggu' where id = p_id;
      v_summary := 'Admin memulihkan produk ke menunggu';
    else
      update public.products set
        name = coalesce(nullif(btrim(p_name), ''), name),
        price = coalesce(p_price, price),
        description = coalesce(nullif(btrim(p_description), ''), description),
        category = coalesce(nullif(btrim(p_category), ''), category),
        image_path = coalesce(p_image_path, image_path)
      where id = p_id;
      v_summary := case when v_product.seller_id = auth.uid() then 'Admin mengubah produk sendiri' else 'Admin mengubah produk penjual lain' end;
    end if;
    v_id := p_id;
  end if;
  insert into public.admin_audit (actor_id, action, product_id, summary)
  values (auth.uid(), p_aksi, v_id, v_summary);
  return v_id;
end;
$$;


--
-- Name: pesanan_sudah_dibayar(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.pesanan_sudah_dibayar(p_order uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.orders
    where id = p_order and payment_status = 'dibayar'
  );
$$;


--
-- Name: pesanan_terlihat(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.pesanan_terlihat(p_order uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select (select private.is_admin())
    or exists (
      select 1 from public.orders o
      where o.id = p_order and o.buyer_id = (select auth.uid())
    );
$$;


--
-- Name: ringkasan_pesanan_penjual(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.ringkasan_pesanan_penjual(p_order uuid) RETURNS TABLE(payment_status text, created_at timestamp with time zone, buyer_name text, shipping_note text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: sesuaikan_stok_admin(uuid, integer, text, integer, uuid, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.sesuaikan_stok_admin(p_id uuid, p_on_hand integer, p_reason text, p_expected_version integer, p_idempotency uuid, p_low_stock integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_product public.products%rowtype;
  v_reserved integer;
  v_existing uuid;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Hanya admin';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 or p_reason ~ '[<>]' then
    raise exception 'Alasan penyesuaian wajib diisi';
  end if;
  if p_on_hand is null or p_on_hand < 0 or p_low_stock is not null and p_low_stock < 0 then
    raise exception 'Jumlah stok tidak valid';
  end if;
  if p_idempotency is not null then
    select product_id into v_existing from public.inventory_movements where idempotency_key = p_idempotency;
    if found then
      if v_existing is distinct from p_id then
        raise exception 'Kunci penyesuaian sudah dipakai';
      end if;
      return (select stock_version from public.products where id = p_id);
    end if;
  end if;
  select * into v_product from public.products where id = p_id for update;
  if not found then
    raise exception 'Produk tidak ditemukan';
  end if;
  if v_product.stock_version is distinct from p_expected_version then
    raise exception 'Stok sudah berubah, muat ulang';
  end if;
  select coalesce(sum(i.quantity), 0) into v_reserved
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where i.product_id = p_id and o.stock_reserved;
  if p_on_hand < v_reserved then
    raise exception 'Stok fisik tidak boleh lebih kecil dari cadangan';
  end if;
  perform set_config('app.stok_tercatat', '1', true);
  perform set_config('app.kelola_admin', '1', true);
  update public.products
  set stock = p_on_hand,
      stock_version = stock_version + 1,
      low_stock_threshold = coalesce(p_low_stock, low_stock_threshold)
  where id = p_id;
  insert into public.inventory_movements (product_id, actor_id, reason, delta, on_hand_before, on_hand_after, idempotency_key)
  values (p_id, auth.uid(), btrim(p_reason), p_on_hand - coalesce(v_product.stock, 0), v_product.stock, p_on_hand, p_idempotency);
  insert into public.admin_audit (actor_id, action, product_id, summary)
  values (auth.uid(), 'ubah_stok', p_id, 'Penyesuaian stok fisik');
  return p_expected_version + 1;
end;
$$;


--
-- Name: catat_notifikasi_pesanan(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.catat_notifikasi_pesanan() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'UPDATE' and new.payment_status is distinct from old.payment_status then
    insert into public.admin_notifications (order_id, message)
    values (new.id, 'Status pembayaran ' || new.gateway_order_id || ' menjadi ' || new.payment_status);
  end if;
  return new;
end;
$$;


--
-- Name: internal_buat_pesanan(uuid, uuid, jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.internal_buat_pesanan(p_buyer uuid, p_idempotency uuid, p_items jsonb, p_shipping_rate uuid, p_shipping_note text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Fungsi pesanan tidak tersedia untuk klien';
  end if;
  return private.internal_buat_pesanan(p_buyer, p_idempotency, p_items, p_shipping_rate, p_shipping_note);
end;
$$;


--
-- Name: internal_catat_pembayaran(text, numeric, text, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.internal_catat_pembayaran(p_gateway_order_id text, p_gross_amount numeric, p_currency text, p_transaction_status text, p_fraud_status text, p_transaction_id text, p_signature_ok boolean) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Fungsi pembayaran tidak tersedia untuk klien';
  end if;
  return private.internal_catat_pembayaran(p_gateway_order_id, p_gross_amount, p_currency, p_transaction_status, p_fraud_status, p_transaction_id, p_signature_ok);
end;
$$;


--
-- Name: internal_simpan_snap(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.internal_simpan_snap(p_order uuid, p_url text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Fungsi pesanan tidak tersedia untuk klien';
  end if;
  perform private.internal_simpan_snap(p_order, p_url);
end;
$$;


--
-- Name: jaga_order_item(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jaga_order_item() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.order_id is distinct from old.order_id
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


--
-- Name: jaga_produk(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jaga_produk() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  admin_berlaku boolean := private.is_admin();
begin
  if tg_op = 'INSERT' then
    if new.seller_id is null then
      new.seller_id := auth.uid();
    end if;
    if new.seller_id is distinct from auth.uid() then
      raise exception 'Produk hanya dapat dibuat untuk akun sendiri';
    end if;
    if not admin_berlaku then
      new.status := 'menunggu';
      new.contoh := false;
      new.archived := false;
    elsif current_setting('app.kelola_admin', true) is distinct from '1' then
      raise exception 'Perubahan admin harus lewat tindakan tercatat';
    end if;
  else
    if new.id is distinct from old.id then
      raise exception 'Identitas produk tidak dapat diubah';
    end if;
    if new.seller_id is distinct from old.seller_id then
      raise exception 'Pemilik produk tidak dapat diubah';
    end if;
    if admin_berlaku then
      if current_setting('app.kelola_admin', true) is distinct from '1'
        and current_setting('app.stok_tercatat', true) is distinct from '1' then
        raise exception 'Perubahan admin harus lewat tindakan tercatat';
      end if;
    else
      if new.contoh is distinct from old.contoh or new.archived is distinct from old.archived then
        raise exception 'Tanda contoh atau arsip tidak dapat diubah';
      end if;
      if new.status is distinct from old.status and new.status in ('disetujui', 'ditolak') then
        raise exception 'Status persetujuan hanya dapat diubah admin';
      end if;
      if new.name is distinct from old.name
        or new.price is distinct from old.price
        or new.description is distinct from old.description
        or new.category is distinct from old.category
        or new.image_path is distinct from old.image_path then
        new.status := 'menunggu';
      end if;
    end if;
  end if;
    if tg_op = 'UPDATE' and new.stock is distinct from old.stock and current_setting('app.stok_tercatat', true) is distinct from '1' then
    raise exception 'Stok hanya dapat diubah lewat penyesuaian yang tercatat';
  end if;
  if tg_op = 'UPDATE' and new.stock_version is distinct from old.stock_version and current_setting('app.stok_tercatat', true) is distinct from '1' then
    raise exception 'Versi stok hanya dapat diubah lewat penyesuaian yang tercatat';
  end if;
  if tg_op = 'UPDATE' and new.low_stock_threshold is distinct from old.low_stock_threshold
     and current_setting('app.stok_tercatat', true) is distinct from '1'
     and current_setting('app.kelola_admin', true) is distinct from '1' then
    raise exception 'Ambang stok hanya dapat diubah lewat penyesuaian yang tercatat';
  end if;
  if tg_op = 'INSERT' and new.stock_version is distinct from 0 and current_setting('app.stok_tercatat', true) is distinct from '1' then
    new.stock_version := 0;
  end if;
  if tg_op = 'INSERT' and new.low_stock_threshold is not null and not admin_berlaku then
    new.low_stock_threshold := null;
  end if;
    if new.stock is not null and new.stock < 0 then
    raise exception 'Stok tidak boleh negatif';
  end if;
    if new.low_stock_threshold is not null and new.low_stock_threshold < 0 then
    raise exception 'Ambang stok tidak boleh negatif';
  end if;
  if new.image_path is not null then
    if new.image_path ~ '^admin/' then
      if not admin_berlaku or new.image_path !~ ('^admin/' || auth.uid()::text || '/[A-Za-z0-9._-]{1,80}$') then
        raise exception 'Jalur gambar admin tidak valid';
      end if;
    elsif new.image_path !~ ('^' || new.seller_id::text || '/[A-Za-z0-9._-]{1,80}$') then
      raise exception 'Jalur gambar tidak valid';
    end if;
  end if;
  return new;
end;
$_$;


--
-- Name: jaga_profil(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jaga_profil() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.id is distinct from old.id then
    raise exception 'Identitas profil tidak dapat diubah';
  end if;
  if new.role is distinct from old.role then
    if new.role = 'admin' then
      if current_user not in ('postgres', 'supabase_admin') then
        raise exception 'Peran admin tidak dapat ditetapkan dari aplikasi';
      end if;
    elsif not (
      old.role = 'pembeli'
      and new.role = 'penjual'
      and old.id = auth.uid()
      and new.shop_name is not null
      and char_length(btrim(new.shop_name)) >= 2
    ) then
      raise exception 'Perubahan peran tidak diizinkan';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: kelola_produk_admin(text, uuid, text, integer, integer, text, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kelola_produk_admin(p_aksi text, p_id uuid, p_name text, p_price integer, p_stock integer, p_description text, p_category text, p_image_path text, p_status text, p_archived boolean) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'Hanya admin';
  end if;
  return private.kelola_produk_admin(p_aksi, p_id, p_name, p_price, p_stock, p_description, p_category, p_image_path, p_status, p_archived);
end;
$$;


--
-- Name: sesuaikan_stok_admin(uuid, integer, text, integer, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sesuaikan_stok_admin(p_id uuid, p_on_hand integer, p_reason text, p_expected_version integer, p_idempotency uuid, p_low_stock integer) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'Hanya admin';
  end if;
  return private.sesuaikan_stok_admin(p_id, p_on_hand, p_reason, p_expected_version, p_idempotency, p_low_stock);
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid NOT NULL,
    action text NOT NULL,
    product_id uuid,
    summary text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_audit_action_check CHECK ((action = ANY (ARRAY['ubah_produk_penjual'::text, 'ubah_stok'::text, 'setujui'::text, 'tolak'::text, 'sembunyikan'::text, 'arsipkan'::text, 'pulihkan'::text, 'buat_produk_sendiri'::text]))),
    CONSTRAINT admin_audit_summary_check CHECK ((((char_length(summary) >= 1) AND (char_length(summary) <= 500)) AND (summary !~ '[<>]'::text)))
);


--
-- Name: admin_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    message text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_name text NOT NULL,
    unit_price integer NOT NULL,
    quantity integer NOT NULL,
    line_total integer NOT NULL,
    fulfillment_status text DEFAULT 'belum_diproses'::text NOT NULL,
    CONSTRAINT order_items_fulfillment_check CHECK ((fulfillment_status = ANY (ARRAY['belum_diproses'::text, 'dikemas'::text, 'dikirim'::text, 'selesai'::text]))),
    CONSTRAINT order_items_price_check CHECK (((unit_price >= 0) AND (line_total = (unit_price * quantity)))),
    CONSTRAINT order_items_qty_check CHECK (((quantity >= 1) AND (quantity <= 99)))
);


--
-- Name: baris_pesanan_penjual; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.baris_pesanan_penjual WITH (security_invoker='true') AS
 SELECT i.id,
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
   FROM (public.order_items i
     CROSS JOIN LATERAL private.ringkasan_pesanan_penjual(i.order_id) r(payment_status, created_at, buyer_name, shipping_note))
  WHERE (i.seller_id = ( SELECT auth.uid() AS uid));


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    name text NOT NULL,
    price integer NOT NULL,
    description text NOT NULL,
    category text NOT NULL,
    image_path text,
    status public.product_status DEFAULT 'menunggu'::public.product_status NOT NULL,
    contoh boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stock integer,
    low_stock_threshold integer,
    stock_version integer DEFAULT 0 NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    CONSTRAINT products_category_check CHECK ((((char_length(category) >= 2) AND (char_length(category) <= 40)) AND (category !~ '[<>]'::text))),
    CONSTRAINT products_description_check CHECK ((((char_length(description) >= 10) AND (char_length(description) <= 500)) AND (description !~ '[<>]'::text))),
    CONSTRAINT products_image_path_check CHECK (((image_path IS NULL) OR (image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$'::text) OR (image_path ~ '^admin/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$'::text))),
    CONSTRAINT products_low_stock_check CHECK (((low_stock_threshold IS NULL) OR (low_stock_threshold >= 0))),
    CONSTRAINT products_name_check CHECK ((((char_length(name) >= 2) AND (char_length(name) <= 80)) AND (name !~ '[<>]'::text))),
    CONSTRAINT products_price_check CHECK (((price >= 0) AND (price <= 999999999))),
    CONSTRAINT products_stock_check CHECK (((stock IS NULL) OR (stock >= 0)))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    role public.account_role DEFAULT 'pembeli'::public.account_role NOT NULL,
    display_name text NOT NULL,
    shop_name text,
    bio text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profiles_bio_check CHECK (((bio IS NULL) OR ((char_length(bio) <= 500) AND (bio !~ '[<>]'::text)))),
    CONSTRAINT profiles_display_name_check CHECK ((((char_length(display_name) >= 2) AND (char_length(display_name) <= 80)) AND (display_name !~ '[<>]'::text))),
    CONSTRAINT profiles_shop_name_check CHECK (((shop_name IS NULL) OR (((char_length(shop_name) >= 2) AND (char_length(shop_name) <= 80)) AND (shop_name !~ '[<>]'::text))))
);


--
-- Name: etalase; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.etalase WITH (security_invoker='true') AS
 SELECT p.id,
    p.name,
    p.price,
    p.description,
    p.category,
    p.image_path,
    p.contoh,
    p.stock,
    pr.display_name AS seller_name,
    pr.shop_name
   FROM (public.products p
     LEFT JOIN public.profiles pr ON (((pr.id = p.seller_id) AND (pr.role = 'penjual'::public.account_role))))
  WHERE ((p.status = 'disetujui'::public.product_status) AND (p.archived = false));


--
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    order_id uuid,
    actor_id uuid,
    reason text NOT NULL,
    delta integer NOT NULL,
    on_hand_before integer,
    on_hand_after integer,
    idempotency_key uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_reason_check CHECK ((((char_length(reason) >= 3) AND (char_length(reason) <= 300)) AND (reason !~ '[<>]'::text)))
);


--
-- Name: order_checkout; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_checkout (
    order_id uuid NOT NULL,
    snap_redirect_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    transaction_id text,
    transaction_status text,
    accepted boolean NOT NULL,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    payload_hash text NOT NULL,
    payment_status text DEFAULT 'menunggu_pembayaran'::text NOT NULL,
    currency text DEFAULT 'IDR'::text NOT NULL,
    subtotal integer NOT NULL,
    shipping_rate_id uuid,
    shipping_amount integer,
    total integer,
    payment_blocked_reason text,
    payment_environment text,
    gateway_order_id text NOT NULL,
    shipping_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stock_reserved boolean DEFAULT false NOT NULL,
    CONSTRAINT orders_currency_check CHECK ((currency = 'IDR'::text)),
    CONSTRAINT orders_environment_check CHECK (((payment_environment IS NULL) OR (payment_environment = 'sandbox'::text))),
    CONSTRAINT orders_money_check CHECK (((subtotal >= 0) AND ((shipping_amount IS NULL) OR (shipping_amount >= 0)) AND ((total IS NULL) OR (total = (subtotal + shipping_amount))))),
    CONSTRAINT orders_note_check CHECK (((shipping_note IS NULL) OR ((char_length(shipping_note) <= 300) AND (shipping_note !~ '[<>]'::text)))),
    CONSTRAINT orders_status_check CHECK ((payment_status = ANY (ARRAY['menunggu_pembayaran'::text, 'dibayar'::text, 'gagal'::text, 'kedaluwarsa'::text, 'dibatalkan'::text])))
);


--
-- Name: posisi_stok; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.posisi_stok WITH (security_invoker='true') AS
 SELECT p.id,
    p.name,
    p.category,
    p.status,
    p.archived,
    p.contoh,
    a.on_hand,
    a.low_stock_threshold,
    a.stock_version,
    a.reserved,
    a.available
   FROM (public.products p
     LEFT JOIN LATERAL private.angka_stok(p.id) a(on_hand, low_stock_threshold, stock_version, reserved, available) ON (true));


--
-- Name: shipping_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    amount_idr integer NOT NULL,
    active boolean DEFAULT false NOT NULL,
    sandbox_only boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shipping_rates_amount_check CHECK (((amount_idr >= 0) AND (amount_idr <= 999999999))),
    CONSTRAINT shipping_rates_label_check CHECK ((((char_length(label) >= 2) AND (char_length(label) <= 80)) AND (label !~ '[<>]'::text))),
    CONSTRAINT shipping_rates_sandbox_check CHECK (sandbox_only)
);


--
-- Name: admin_audit admin_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit
    ADD CONSTRAINT admin_audit_pkey PRIMARY KEY (id);


--
-- Name: admin_notifications admin_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notifications
    ADD CONSTRAINT admin_notifications_pkey PRIMARY KEY (id);


--
-- Name: inventory_movements inventory_movements_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: order_checkout order_checkout_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_checkout
    ADD CONSTRAINT order_checkout_pkey PRIMARY KEY (order_id);


--
-- Name: order_events order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_buyer_idempotency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_buyer_idempotency UNIQUE (buyer_id, idempotency_key);


--
-- Name: orders orders_gateway_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_gateway_order_id_key UNIQUE (gateway_order_id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: shipping_rates shipping_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_rates
    ADD CONSTRAINT shipping_rates_pkey PRIMARY KEY (id);


--
-- Name: admin_notifications_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_notifications_unread_idx ON public.admin_notifications USING btree (read_at, created_at DESC);


--
-- Name: inventory_gerakan_pesanan_unik; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_gerakan_pesanan_unik ON public.inventory_movements USING btree (order_id, product_id) WHERE (reason = ANY (ARRAY['penjualan sandbox'::text, 'lepas cadangan'::text]));


--
-- Name: order_events_idempotent; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_events_idempotent ON public.order_events USING btree (order_id, transaction_id, transaction_status) WHERE ((transaction_id IS NOT NULL) AND (transaction_status IS NOT NULL));


--
-- Name: order_items_seller_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_items_seller_idx ON public.order_items USING btree (seller_id, order_id);


--
-- Name: orders_buyer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_buyer_idx ON public.orders USING btree (buyer_id, created_at DESC);


--
-- Name: products_seller_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_seller_id_idx ON public.products USING btree (seller_id);


--
-- Name: products_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_status_idx ON public.products USING btree (status);


--
-- Name: order_items order_items_jaga; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_items_jaga BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.jaga_order_item();


--
-- Name: orders orders_notifikasi; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_notifikasi AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.catat_notifikasi_pesanan();


--
-- Name: products products_jaga; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_jaga BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.jaga_produk();


--
-- Name: products products_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: products produk_stok_awal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER produk_stok_awal AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION private.catat_stok_awal();


--
-- Name: profiles profiles_jaga; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_jaga BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.jaga_profil();


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: admin_notifications admin_notifications_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notifications
    ADD CONSTRAINT admin_notifications_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: inventory_movements inventory_movements_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: inventory_movements inventory_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: order_checkout order_checkout_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_checkout
    ADD CONSTRAINT order_checkout_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_events order_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: order_items order_items_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id);


--
-- Name: orders orders_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id);


--
-- Name: orders orders_shipping_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_shipping_rate_id_fkey FOREIGN KEY (shipping_rate_id) REFERENCES public.shipping_rates(id);


--
-- Name: products products_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: admin_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_audit audit_baca; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_baca ON public.admin_audit FOR SELECT TO authenticated USING (private.is_admin());


--
-- Name: order_items butir_baca; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY butir_baca ON public.order_items FOR SELECT TO authenticated USING (((seller_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_admin() AS is_admin) OR (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND (o.buyer_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: order_items butir_pemenuhan; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY butir_pemenuhan ON public.order_items FOR UPDATE TO authenticated USING (((seller_id = ( SELECT auth.uid() AS uid)) OR private.is_admin())) WITH CHECK (((seller_id = ( SELECT auth.uid() AS uid)) OR private.is_admin()));


--
-- Name: inventory_movements gerakan_baca; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gerakan_baca ON public.inventory_movements FOR SELECT TO authenticated USING ((private.is_admin() OR (EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = inventory_movements.product_id) AND (p.seller_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: inventory_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: order_events kejadian_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kejadian_admin ON public.order_events FOR SELECT TO authenticated USING (private.is_admin());


--
-- Name: admin_notifications notifikasi_admin_baca; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifikasi_admin_baca ON public.admin_notifications FOR SELECT TO authenticated USING (private.is_admin());


--
-- Name: admin_notifications notifikasi_admin_baca_status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifikasi_admin_baca_status ON public.admin_notifications FOR UPDATE TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());


--
-- Name: order_checkout; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_checkout ENABLE ROW LEVEL SECURITY;

--
-- Name: order_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: orders pesanan_baca; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pesanan_baca ON public.orders FOR SELECT TO authenticated USING (((buyer_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_admin() AS is_admin)));


--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: products produk_baca_disetujui; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY produk_baca_disetujui ON public.products FOR SELECT TO anon, authenticated USING ((status = 'disetujui'::public.product_status));


--
-- Name: products produk_baca_pemilik; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY produk_baca_pemilik ON public.products FOR SELECT TO authenticated USING (((seller_id = ( SELECT auth.uid() AS uid)) OR private.is_admin()));


--
-- Name: products produk_hapus; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY produk_hapus ON public.products FOR DELETE TO authenticated USING (((seller_id = ( SELECT auth.uid() AS uid)) OR private.is_admin()));


--
-- Name: products produk_tambah; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY produk_tambah ON public.products FOR INSERT TO authenticated WITH CHECK (((seller_id = ( SELECT auth.uid() AS uid)) OR private.is_admin()));


--
-- Name: products produk_ubah; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY produk_ubah ON public.products FOR UPDATE TO authenticated USING (((seller_id = ( SELECT auth.uid() AS uid)) OR private.is_admin())) WITH CHECK (((seller_id = ( SELECT auth.uid() AS uid)) OR private.is_admin()));


--
-- Name: profiles profil_baca_anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profil_baca_anon ON public.profiles FOR SELECT TO anon USING ((role = 'penjual'::public.account_role));


--
-- Name: profiles profil_baca_masuk; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profil_baca_masuk ON public.profiles FOR SELECT TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) OR (role = 'penjual'::public.account_role) OR ( SELECT private.is_admin() AS is_admin)));


--
-- Name: profiles profil_ubah_sendiri; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profil_ubah_sendiri ON public.profiles FOR UPDATE TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipping_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: order_checkout snap_pembeli; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY snap_pembeli ON public.order_checkout FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_checkout.order_id) AND (o.buyer_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: shipping_rates tarif_baca; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tarif_baca ON public.shipping_rates FOR SELECT TO authenticated USING ((active OR private.is_admin()));


-- Hak yang diwarisi default Supabase dibersihkan pada objek berkas ini,
-- lalu hanya izin yang dimaksud yang dikembalikan. Default global tidak diubah.

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role, supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

DO $acl$
DECLARE
  objek text;
BEGIN
  FOREACH objek IN ARRAY ARRAY[
    'public.admin_audit',
    'public.admin_notifications',
    'public.inventory_movements',
    'public.order_checkout',
    'public.order_events',
    'public.order_items',
    'public.orders',
    'public.products',
    'public.profiles',
    'public.shipping_rates',
    'public.baris_pesanan_penjual',
    'public.etalase',
    'public.posisi_stok'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', objek);
  END LOOP;
END
$acl$;

DO $acl$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'private.angka_stok(uuid)',
    'private.catat_stok_awal()',
    'private.handle_new_user()',
    'private.internal_buat_pesanan(uuid,uuid,jsonb,uuid,text)',
    'private.internal_catat_pembayaran(text,numeric,text,text,text,text,boolean)',
    'private.internal_simpan_snap(uuid,text)',
    'private.is_admin()',
    'private.kelola_produk_admin(text,uuid,text,integer,integer,text,text,text,text,boolean)',
    'private.pesanan_sudah_dibayar(uuid)',
    'private.pesanan_terlihat(uuid)',
    'private.ringkasan_pesanan_penjual(uuid)',
    'private.sesuaikan_stok_admin(uuid,integer,text,integer,uuid,integer)',
    'public.catat_notifikasi_pesanan()',
    'public.internal_buat_pesanan(uuid,uuid,jsonb,uuid,text)',
    'public.internal_catat_pembayaran(text,numeric,text,text,text,text,boolean)',
    'public.internal_simpan_snap(uuid,text)',
    'public.jaga_order_item()',
    'public.jaga_produk()',
    'public.jaga_profil()',
    'public.kelola_produk_admin(text,uuid,text,integer,integer,text,text,text,text,boolean)',
    'public.sesuaikan_stok_admin(uuid,integer,text,integer,uuid,integer)',
    'public.set_updated_at()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', fn);
  END LOOP;
END
$acl$;

GRANT SELECT ON TABLE public.etalase TO anon, authenticated;
GRANT SELECT ON TABLE public.products TO anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO anon, authenticated;

GRANT SELECT ON TABLE public.admin_audit TO authenticated;
GRANT SELECT ON TABLE public.admin_notifications TO authenticated;
GRANT UPDATE (read_at) ON TABLE public.admin_notifications TO authenticated;
GRANT SELECT ON TABLE public.inventory_movements TO authenticated;
GRANT SELECT ON TABLE public.order_checkout TO authenticated;
GRANT SELECT ON TABLE public.order_events TO authenticated;
GRANT SELECT ON TABLE public.order_items TO authenticated;
GRANT UPDATE (fulfillment_status) ON TABLE public.order_items TO authenticated;
GRANT SELECT ON TABLE public.orders TO authenticated;
GRANT SELECT ON TABLE public.posisi_stok TO authenticated;
GRANT SELECT ON TABLE public.baris_pesanan_penjual TO authenticated;
GRANT SELECT ON TABLE public.shipping_rates TO authenticated;
GRANT UPDATE (display_name, shop_name, bio, role) ON TABLE public.profiles TO authenticated;
GRANT INSERT (seller_id, name, price, description, category, image_path, status) ON TABLE public.products TO authenticated;
GRANT UPDATE (name, price, description, category, image_path, status) ON TABLE public.products TO authenticated;
GRANT DELETE ON TABLE public.products TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.admin_audit,
  public.admin_notifications,
  public.inventory_movements,
  public.order_checkout,
  public.order_events,
  public.order_items,
  public.orders,
  public.products,
  public.profiles,
  public.shipping_rates
TO service_role;
GRANT SELECT ON TABLE public.baris_pesanan_penjual, public.etalase, public.posisi_stok TO service_role;

GRANT EXECUTE ON FUNCTION private.angka_stok(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.handle_new_user() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.internal_buat_pesanan(uuid,uuid,jsonb,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION private.internal_catat_pembayaran(text,numeric,text,text,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION private.internal_simpan_snap(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.kelola_produk_admin(text,uuid,text,integer,integer,text,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION private.pesanan_sudah_dibayar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.pesanan_terlihat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.ringkasan_pesanan_penjual(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.sesuaikan_stok_admin(uuid,integer,text,integer,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.internal_buat_pesanan(uuid,uuid,jsonb,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.internal_catat_pembayaran(text,numeric,text,text,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.internal_simpan_snap(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kelola_produk_admin(text,uuid,text,integer,integer,text,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sesuaikan_stok_admin(uuid,integer,text,integer,uuid,integer) TO authenticated;


CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('produk', 'produk', false, 350000, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT SELECT ON storage.objects TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

CREATE POLICY produk_unggah
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'produk'
  AND (storage.foldername(name))[1] = (SELECT auth.jwt()->>'sub')
);

CREATE POLICY produk_ubah_berkas
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'produk'
  AND (storage.foldername(name))[1] = (SELECT auth.jwt()->>'sub')
)
WITH CHECK (
  bucket_id = 'produk'
  AND (storage.foldername(name))[1] = (SELECT auth.jwt()->>'sub')
);

CREATE POLICY produk_hapus_berkas
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'produk'
  AND (storage.foldername(name))[1] = (SELECT auth.jwt()->>'sub')
);

CREATE POLICY produk_baca_pemilik_berkas
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'produk'
  AND (storage.foldername(name))[1] = (SELECT auth.jwt()->>'sub')
);

CREATE POLICY produk_baca_admin_berkas
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'produk' AND private.is_admin());

CREATE POLICY produk_baca_disetujui_berkas
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'produk'
  AND storage.allow_any_operation(ARRAY['object.get_authenticated_info', 'object.get_authenticated'])
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.image_path = storage.objects.name
      AND p.status = 'disetujui'
  )
);

CREATE POLICY produk_unggah_admin
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'produk'
  AND private.is_admin()
  AND (storage.foldername(name))[1] = 'admin'
  AND (storage.foldername(name))[2] = (SELECT auth.jwt()->>'sub')
);

CREATE POLICY produk_baca_folder_admin
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'produk'
  AND private.is_admin()
  AND (storage.foldername(name))[1] = 'admin'
  AND (storage.foldername(name))[2] = (SELECT auth.jwt()->>'sub')
);
