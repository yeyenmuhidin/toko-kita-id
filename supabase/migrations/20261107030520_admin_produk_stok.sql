-- Stok sungguhan dan kelola admin. Produk lama tetap stok null dan contoh tetap tidak dijual.

alter table public.products add column stock integer;
alter table public.products add column low_stock_threshold integer;
alter table public.products add column stock_version integer not null default 0;
alter table public.products add column archived boolean not null default false;
alter table public.products add constraint products_stock_check check (stock is null or stock >= 0);
alter table public.products add constraint products_low_stock_check check (low_stock_threshold is null or low_stock_threshold >= 0);
alter table public.products drop constraint products_image_path_check;
alter table public.products add constraint products_image_path_check check (
  image_path is null
  or image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$'
  or image_path ~ '^admin/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$'
);

alter table public.orders add column stock_reserved boolean not null default false;

create table public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  action text not null,
  product_id uuid,
  summary text not null,
  created_at timestamptz not null default now(),
  constraint admin_audit_action_check check (action in (
    'ubah_produk_penjual', 'ubah_stok', 'setujui', 'tolak', 'sembunyikan', 'arsipkan', 'pulihkan', 'buat_produk_sendiri'
  )),
  constraint admin_audit_summary_check check (char_length(summary) between 1 and 500 and summary !~ '[<>]')
);

alter table public.admin_audit enable row level security;
create policy audit_baca on public.admin_audit for select to authenticated using (private.is_admin());
grant select on public.admin_audit to authenticated;

create or replace function public.jaga_produk()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
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
$$;

revoke all on function public.jaga_produk() from public, anon, authenticated;

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
security definer
set search_path = public
as $$
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

revoke all on function public.kelola_produk_admin(text, uuid, text, integer, integer, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.kelola_produk_admin(text, uuid, text, integer, integer, text, text, text, text, boolean) to authenticated;

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
  v_seen uuid[] := array[]::uuid[];
  v_updated uuid;
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
    for v_item in select value from jsonb_array_elements(p_items) loop
      v_qty := (v_item->>'quantity')::integer;
      select * into v_product from public.products where id = (v_item->>'product_id')::uuid for update;
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
  insert into public.orders (
    buyer_id, idempotency_key, payload_hash, subtotal, shipping_rate_id, shipping_amount, total,
    payment_blocked_reason, payment_environment, gateway_order_id, shipping_note, stock_reserved
  ) values (
    p_buyer, p_idempotency, v_hash, v_subtotal, p_shipping_rate, v_shipping, v_total,
    v_blocked, case when v_blocked is null then 'sandbox' else null end, v_gateway,
    nullif(btrim(coalesce(p_shipping_note, '')), ''), v_blocked is null
  ) returning id into v_order_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    insert into public.order_items (order_id, seller_id, product_id, product_name, unit_price, quantity, line_total)
    values (v_order_id, v_product.seller_id, v_product.id, v_product.name, v_product.price, v_qty, v_product.price * v_qty);
  end loop;
  return jsonb_build_object('order_id', v_order_id, 'payment_status', 'menunggu_pembayaran', 'subtotal', v_subtotal, 'shipping_amount', v_shipping, 'total', v_total, 'blocked_reason', v_blocked, 'gateway_order_id', v_gateway, 'repeated', false);
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
  v_rows integer;
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

drop view if exists public.etalase;
create view public.etalase
with (security_invoker = true) as
select
  p.id, p.name, p.price, p.description, p.category, p.image_path, p.contoh, p.stock,
  pr.display_name as seller_name, pr.shop_name
from public.products p
left join public.profiles pr on pr.id = p.seller_id and pr.role = 'penjual'
where p.status = 'disetujui' and p.archived = false;

grant select on public.etalase to anon, authenticated;

create policy produk_unggah_admin
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'produk'
  and private.is_admin()
  and (storage.foldername(name))[1] = 'admin'
  and (storage.foldername(name))[2] = (select auth.jwt()->>'sub')
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  order_id uuid references public.orders (id),
  actor_id uuid,
  reason text not null,
  delta integer not null,
  on_hand_before integer,
  on_hand_after integer,
  idempotency_key uuid unique,
  created_at timestamptz not null default now(),
  constraint inventory_reason_check check (char_length(reason) between 3 and 300 and reason !~ '[<>]')
);

alter table public.inventory_movements enable row level security;

create policy gerakan_baca
on public.inventory_movements
for select
to authenticated
using (
  private.is_admin()
  or exists (
    select 1 from public.products p
    where p.id = inventory_movements.product_id
      and p.seller_id = (select auth.uid())
  )
);

revoke all on public.inventory_movements from public, anon, authenticated;
grant select on public.inventory_movements to authenticated;

create or replace function public.catat_stok_awal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.stock is not null then
    insert into public.inventory_movements (product_id, actor_id, reason, delta, on_hand_before, on_hand_after)
    values (new.id, auth.uid(), 'stok awal', new.stock, null, new.stock);
  end if;
  return new;
end;
$$;

revoke all on function public.catat_stok_awal() from public, anon, authenticated;
create trigger produk_stok_awal
after insert on public.products
for each row execute function public.catat_stok_awal();

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
security definer
set search_path = public
as $$
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

revoke all on function public.sesuaikan_stok_admin(uuid, integer, text, integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.sesuaikan_stok_admin(uuid, integer, text, integer, uuid, integer) to authenticated;

create view public.posisi_stok
with (security_invoker = true) as
select
  p.id,
  p.name,
  p.category,
  p.status,
  p.archived,
  p.contoh,
  p.stock as on_hand,
  p.low_stock_threshold,
  p.stock_version,
  coalesce((
    select sum(i.quantity)
    from public.order_items i
    join public.orders o on o.id = i.order_id
    where i.product_id = p.id and o.stock_reserved
  ), 0)::integer as reserved,
  case
    when p.stock is null then null
    else p.stock - coalesce((
      select sum(i.quantity)
      from public.order_items i
      join public.orders o on o.id = i.order_id
      where i.product_id = p.id and o.stock_reserved
    ), 0)
  end as available
from public.products p;

grant select on public.posisi_stok to authenticated;

create policy produk_baca_folder_admin
on storage.objects
for select
to authenticated
using (
  bucket_id = 'produk'
  and private.is_admin()
  and (storage.foldername(name))[1] = 'admin'
  and (storage.foldername(name))[2] = (select auth.jwt()->>'sub')
);
