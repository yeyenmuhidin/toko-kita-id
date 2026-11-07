export async function tandaTanganMidtrans(orderId, statusCode, grossAmount, serverKey) {
  var input = String(orderId) + String(statusCode) + String(grossAmount) + String(serverKey);
  var bytes = new TextEncoder().encode(input);
  var digest = await crypto.subtle.digest("SHA-512", bytes);
  return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}

export async function tandaTanganCocok(payload, serverKey) {
  if (!payload || !serverKey) return false;
  var expected = await tandaTanganMidtrans(payload.order_id, payload.status_code, payload.gross_amount, serverKey);
  return expected === String(payload.signature_key || "");
}

export function statusDariGateway(transactionStatus, fraudStatus) {
  if (transactionStatus === "settlement" || (transactionStatus === "capture" && (!fraudStatus || fraudStatus === "accept"))) return "dibayar";
  if (transactionStatus === "expire") return "kedaluwarsa";
  if (transactionStatus === "deny" || transactionStatus === "cancel" || transactionStatus === "failure") return "gagal";
  return null;
}

export function lingkunganDiizinkan(envName) {
  return envName === "sandbox";
}
