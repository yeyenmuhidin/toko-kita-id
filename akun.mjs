export function konfigurasiAman(cfg) {
  var source = cfg || {};
  var url = String(source.url || "").trim();
  var key = String(source.publishableKey || "").trim();
  if (!url || !key) return { ok: false, reason: "Supabase belum diisi." };
  var parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    return { ok: false, reason: "URL Supabase tidak valid." };
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: "URL Supabase harus https." };
  if (peranToken(key) === "service_role") return { ok: false, reason: "Kunci service role tidak boleh dipakai di peramban." };
  return { ok: true, url: parsed.origin, publishableKey: key };
}

export function peranToken(key) {
  var parts = String(key || "").split(".");
  if (parts.length < 2) return "";
  try {
    var padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    var json = JSON.parse(atob(padded));
    return json.role || "";
  } catch (error) {
    return "";
  }
}

export function jalurGambarAman(sellerId, path) {
  return new RegExp("^" + sellerId + "/[A-Za-z0-9._-]{1,80}$").test(String(path || ""));
}

export function barisKeProduk(row) {
  var source = row || {};
  return {
    id: source.id,
    name: source.name,
    price: source.price,
    description: source.description,
    category: source.category,
    image: "",
    imagePath: source.image_path || "",
    contoh: source.contoh === true,
    visible: true,
    sellerName: source.seller_name || "",
    shopName: source.shop_name || ""
  };
}

export function berkasGambarAman(file) {
  if (!file) return "Pilih berkas gambar.";
  if (!/^image\/(jpeg|png|webp)$/.test(file.type || "")) return "Gunakan JPEG, PNG, atau WebP.";
  if (file.size > 350000) return "Gambar maksimal 350 KB.";
  return "";
}
