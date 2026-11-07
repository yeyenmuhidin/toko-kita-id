import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { lingkunganDiizinkan, tandaTanganCocok } from "../_shared/midtrans.js";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("invalid", { status: 405 });
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY") || "";
  const envName = Deno.env.get("MIDTRANS_ENV") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serverKey || !lingkunganDiizinkan(envName) || !supabaseUrl || !service) return new Response("invalid", { status: 503 });
  const payload = await req.json().catch(() => null);
  const valid = await tandaTanganCocok(payload, serverKey);
  if (!valid || !payload?.order_id) return new Response("invalid", { status: 401 });
  const status = await fetch("https://api.sandbox.midtrans.com/v2/" + encodeURIComponent(payload.order_id) + "/status", {
    headers: { authorization: "Basic " + btoa(serverKey + ":") }
  });
  if (!status.ok) return new Response("retry", { status: 503 });
  const official = await status.json();
  const officialOk = await tandaTanganCocok(official, serverKey);
  if (!officialOk || official.order_id !== payload.order_id) return new Response("invalid", { status: 401 });
  const admin = createClient(supabaseUrl, service);
  const hasil = await admin.rpc("internal_catat_pembayaran", {
    p_gateway_order_id: official.order_id,
    p_gross_amount: Number(official.gross_amount),
    p_currency: official.currency || "IDR",
    p_transaction_status: official.transaction_status,
    p_fraud_status: official.fraud_status || null,
    p_transaction_id: official.transaction_id || null,
    p_signature_ok: true
  });
  if (hasil.error) return new Response("retry", { status: 503 });
  return new Response("OK", { status: 200 });
});
