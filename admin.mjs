import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { konfigurasiAman } from "./akun.mjs";

var banner = document.getElementById("adminBanner");
var antrean = document.getElementById("antrean");
var konfigurasi = konfigurasiAman(window.TOKO_KITA_SUPABASE || {});
if (!konfigurasi.ok) {
  banner.textContent = "Tinjauan belum terhubung. " + konfigurasi.reason + " Tidak ada produk yang disetujui dari halaman ini.";
} else {
  var supabase = createClient(konfigurasi.url, konfigurasi.publishableKey);
  async function muat() {
    var session = await supabase.auth.getSession();
    if (!session.data.session) {
      banner.textContent = "Masuk sebagai admin dulu. Antrean tidak ditampilkan.";
      return;
    }
    var profil = await supabase.from("profiles").select("role").eq("id", session.data.session.user.id).single();
    if (!profil.data || profil.data.role !== "admin") {
      banner.textContent = "Akun ini bukan admin. Menekan tombol di peramban tidak dapat mengangkat peran.";
      antrean.innerHTML = "";
      return;
    }
    banner.textContent = "Hanya produk menunggu yang dapat disetujui dari sini. Persetujuan baru membuatnya terlihat pengunjung.";
    var daftar = await supabase.from("products").select("id,name,price,category,description,status").eq("status", "menunggu");
    antrean.innerHTML = "";
    (daftar.data || []).forEach(function (produk) {
      var article = document.createElement("article");
      article.className = "bg-white rounded-xl shadow-sm p-4";
      var title = document.createElement("h2");
      title.className = "font-semibold";
      title.textContent = produk.name;
      var meta = document.createElement("p");
      meta.className = "text-sm text-gray-600";
      meta.textContent = produk.category + " · " + window.TokoKitaCatalog.formatRupiah(produk.price);
      var deskripsi = document.createElement("p");
      deskripsi.className = "text-sm mt-1";
      deskripsi.textContent = produk.description;
      var setujui = document.createElement("button");
      setujui.type = "button";
      setujui.className = "mt-3 min-h-11 px-3 bg-indigo-600 text-white rounded-lg mr-2";
      setujui.textContent = "Setujui";
      var tolak = document.createElement("button");
      tolak.type = "button";
      tolak.className = "mt-3 min-h-11 px-3 border rounded-lg";
      tolak.textContent = "Tolak";
      setujui.addEventListener("click", function () { putuskan(produk.id, "disetujui"); });
      tolak.addEventListener("click", function () { putuskan(produk.id, "ditolak"); });
      article.append(title, meta, deskripsi, setujui, tolak);
      antrean.append(article);
    });
    if (!(daftar.data || []).length) {
      var kosong = document.createElement("p");
      kosong.textContent = "Tidak ada produk menunggu.";
      antrean.append(kosong);
    }
    var belum = await supabase.from("admin_notifications").select("id", { count: "exact", head: true }).is("read_at", null);
    document.getElementById("lencanaPesanan").textContent = "Notifikasi belum dibaca: " + (belum.count || 0);
    await muatPesanan();
  }
  async function muatPesanan() {
    var status = document.getElementById("saringStatus").value;
    var kueri = supabase.from("orders").select("id,gateway_order_id,payment_status,total,subtotal,payment_blocked_reason,created_at").order("created_at", { ascending: false });
    if (status) kueri = kueri.eq("payment_status", status);
    var hasil = await kueri;
    var root = document.getElementById("daftarPesananAdmin");
    root.replaceChildren();
    (hasil.data || []).forEach(function (order) {
      var article = document.createElement("article");
      article.className = "bg-white rounded-xl shadow-sm p-4";
      var title = document.createElement("h3");
      title.className = "font-medium";
      title.textContent = order.payment_status;
      var meta = document.createElement("p");
      meta.className = "text-sm text-gray-600";
      meta.textContent = (order.total == null ? "total belum ada karena ongkir" : window.TokoKitaCatalog.formatRupiah(order.total)) + " · " + order.gateway_order_id;
      article.append(title, meta);
      root.append(article);
    });
  }
  document.getElementById("saringStatus").addEventListener("change", muatPesanan);
  async function putuskan(id, status) {
    var hasil = await supabase.from("products").update({ status: status }).eq("id", id);
    banner.textContent = hasil.error ? "Keputusan ditolak server." : "Keputusan tersimpan.";
    muat();
  }
  muat();
}
