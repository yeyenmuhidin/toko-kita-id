import { konfigurasiAman } from "./akun.mjs";
import { klienToko } from "./supabase-klien.mjs";

var HOST_MIDTRANS = ["app.sandbox.midtrans.com", "app.midtrans.com"];

export function urlPembayaranDiizinkan(nilai) {
  var url;
  try {
    url = new URL(String(nilai == null ? "" : nilai));
  } catch (error) {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return HOST_MIDTRANS.indexOf(url.hostname) !== -1;
}

export function putuskanPengalihan(nilai) {
  if (!nilai) return { redirect: false, error: "" };
  if (!urlPembayaranDiizinkan(nilai)) {
    return { redirect: false, error: "Tautan pembayaran ditolak karena bukan halaman Midtrans yang diizinkan. Pesanan tidak dialihkan." };
  }
  return { redirect: true, error: "" };
}

if (typeof document === "undefined") {
  // Uji node hanya memakai fungsi di atas.
} else {
var banner = document.getElementById("pesananBanner");
var daftar = document.getElementById("daftarPesanan");
var form = document.getElementById("bayarForm");
var konfigurasi = konfigurasiAman(window.TOKO_KITA_SUPABASE || {});

function kartu(judul, teks) {
  var article = document.createElement("article");
  article.className = "bg-white rounded-xl shadow-sm p-4";
  var h = document.createElement("h2");
  h.className = "font-semibold";
  h.textContent = judul;
  var p = document.createElement("p");
  p.className = "text-sm text-gray-600 mt-1";
  p.textContent = teks;
  article.append(h, p);
  return article;
}

if (!konfigurasi.ok) {
  banner.textContent = "Pembayaran belum terhubung. " + konfigurasi.reason + " Produk contoh tidak dijual, dan tidak ada status lunas yang dibuat.";
} else {
  banner.textContent = "Checkout sandbox hanya untuk produk akun yang sudah disetujui dan bukan contoh. Status lunas hanya berasal dari notifikasi server.";
  var supabase = klienToko(window.TOKO_KITA_SUPABASE);
  var akses = null;

  async function muat() {
    var session = await supabase.auth.getSession();
    daftar.innerHTML = "";
    if (!session.data.session) {
      daftar.append(kartu("Belum masuk", "Masuk untuk melihat pesanan. Keranjang demo tidak dibayar dari sini."));
      return;
    }
    akses = session.data.session.access_token;
    form.hidden = false;
    var pesanan = await supabase.from("orders").select("id,payment_status,subtotal,shipping_amount,total,payment_blocked_reason,created_at").order("created_at", { ascending: false });
    (pesanan.data || []).forEach(function (order) {
      var ongkir = order.shipping_amount == null ? "ongkir belum dikonfigurasi" : window.TokoKitaCatalog.formatRupiah(order.shipping_amount);
      daftar.append(kartu(
        order.payment_status,
        "Subtotal " + window.TokoKitaCatalog.formatRupiah(order.subtotal) + " · " + ongkir + (order.total == null ? "" : " · total " + window.TokoKitaCatalog.formatRupiah(order.total)) + (order.payment_blocked_reason ? " · " + order.payment_blocked_reason : "")
      ));
    });
    if (!(pesanan.data || []).length) daftar.append(kartu("Belum ada pesanan", "Pesanan muncul setelah checkout akun, bukan setelah simulasi WhatsApp."));
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var cart = [];
    try { cart = JSON.parse(localStorage.getItem("tokoKitaCart") || "[]"); } catch (error) { cart = []; }
    var items = cart.filter(function (item) { return typeof item.id === "string" && item.id.includes("-"); }).map(function (item) {
      return { product_id: item.id, quantity: item.quantity };
    });
    if (!items.length) {
      banner.textContent = "Keranjang tidak berisi produk akun. Produk contoh ber-ID angka tidak dijual.";
      return;
    }
    var hasil = await fetch(konfigurasi.url + "/functions/v1/buat-pembayaran", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + akses, apikey: konfigurasi.publishableKey },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        items: items,
        shipping_note: document.getElementById("catatanKirim").value
      })
    });
    var body = await hasil.json().catch(() => ({}));
    if (!hasil.ok) {
      banner.textContent = body.error || "Pesanan ditolak. Tidak ditandai lunas.";
      return;
    }
    banner.textContent = body.penjelasan || "Pesanan tersimpan. Belum tentu dibayar.";
    var keputusan = putuskanPengalihan(body.snap_redirect_url);
    if (keputusan.error) banner.textContent = keputusan.error;
    else if (keputusan.redirect) window.location.assign(body.snap_redirect_url);
    muat();
  });
  muat();
}
}
