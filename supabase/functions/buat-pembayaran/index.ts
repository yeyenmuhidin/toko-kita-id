import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { lingkunganDiizinkan } from "../_shared/midtrans.js";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY") || "";
  const envName = Deno.env.get("MIDTRANS_ENV") || "";
  if (!supabaseUrl || !anon || !service) {
    return json({ error: "Fungsi pembayaran belum dikonfigurasi." }, 503);
  }
  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } });
  const user = await userClient.auth.getUser();
  if (user.error || !user.data.user) return json({ error: "Masuk diperlukan." }, 401);
  const body = await req.json().catch(() => null);
  const admin = createClient(supabaseUrl, service);
  const dibuat = await admin.rpc("internal_buat_pesanan", {
    p_buyer: user.data.user.id,
    p_idempotency: body?.idempotency_key,
    p_items: body?.items || [],
    p_shipping_rate: body?.shipping_rate_id || null,
    p_shipping_note: body?.shipping_note || null
  });
  if (dibuat.error) return json({ error: "Pesanan ditolak." }, 400);
  const order = dibuat.data;
  if (order.blocked_reason || order.repeated || !lingkunganDiizinkan(envName) || !serverKey) {
    return json({
      ...order,
      snap_redirect_url: null,
      penjelasan: penjelasan(order, envName, serverKey)
    }, 200);
  }
  const snap = await fetch("https://app.sandbox.midtrans.com/snap/v1/transactions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Basic " + btoa(serverKey + ":")
    },
    body: JSON.stringify({
      transaction_details: { order_id: order.gateway_order_id, gross_amount: order.total }
    })
  });
  if (!snap.ok) return json({ ...order, snap_redirect_url: null, penjelasan: "Sandbox Midtrans menolak pembuatan pembayaran. Pesanan tetap menunggu dan belum dibayar." }, 200);
  const snapBody = await snap.json();
  const url = snapBody.redirect_url || null;
  if (url) await admin.rpc("internal_simpan_snap", { p_order: order.order_id, p_url: url });
  return json({ ...order, snap_redirect_url: url, penjelasan: "Ini checkout sandbox. Status dibayar hanya dicatat dari notifikasi server." }, 200);
});

function penjelasan(order, envName, serverKey) {
  if (order.blocked_reason === "ongkir_belum_dikonfigurasi") return "Ongkir belum dikonfigurasi, jadi pembayaran tidak dimulai dan tidak ada total kirim.";
  if (!lingkunganDiizinkan(envName)) return "Pembayaran produksi dimatikan. Tidak ada tagihan yang dibuat.";
  if (!serverKey) return "Kunci server sandbox belum diisi. Pesanan tersimpan, tetapi pembayaran belum dimulai.";
  return "Pesanan sandbox.";
}

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
}
