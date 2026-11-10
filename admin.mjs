import { konfigurasiAman } from "./akun.mjs";
import { klienToko } from "./supabase-klien.mjs";
import { gambarManajemen, gambarStok, indikatorStok } from "./admin-ui.mjs";

var banner = document.getElementById("adminBanner");
var antrean = document.getElementById("antrean");
var konfigurasi = konfigurasiAman(window.TOKO_KITA_SUPABASE || {});
var state = { notice: "", loading: false, error: "", products: [], query: "", status: "" };
var stokRows = [];
if (!konfigurasi.ok) {
  banner.textContent = "Tinjauan belum terhubung. " + konfigurasi.reason + " Tidak ada produk yang disetujui dan tidak ada penyesuaian stok dari halaman ini.";
  document.getElementById("antrean").textContent = "Daftar produk tidak dimuat.";
  document.getElementById("daftarStok").textContent = "Posisi stok tidak dimuat. Tidak ada angka yang dikirim ke server.";
} else {
  var supabase = klienToko(window.TOKO_KITA_SUPABASE);
  async function muat() {
    var session = await supabase.auth.getSession();
    if (!session.data.session) {
      banner.textContent = "Masuk sebagai admin dulu. Antrean dan stok tidak ditampilkan.";
      document.getElementById("daftarStok").textContent = "Posisi stok tidak dimuat.";
      return;
    }
    var profil = await supabase.from("profiles").select("role").eq("id", session.data.session.user.id).single();
    if (!profil.data || profil.data.role !== "admin") {
      banner.textContent = "Akun ini bukan admin. Menekan tombol di peramban tidak dapat mengangkat peran atau mengubah stok.";
      antrean.innerHTML = "";
      document.getElementById("daftarStok").textContent = "Penyesuaian stok tidak tersedia untuk akun ini.";
      return;
    }
    banner.textContent = "Persetujuan, arsip, dan penyesuaian stok hanya lewat tindakan server. Stok tidak diubah dari formulir produk.";
    var daftar = await supabase.from("products").select("id,name,price,category,description,status,archived,contoh,stock,seller_id");
    state.products = (daftar.data || []).map(function (produk) {
      produk.detail = true;
      produk.seller_label = "akun " + String(produk.seller_id || "").slice(0, 8);
      return produk;
    });
    state.error = daftar.error ? "Daftar produk ditolak server." : "";
    gambarManajemen(antrean, state, function (nama, produk) {
      if (nama === "detail") return;
      putuskan(produk.id, nama);
    });
    var posisi = await supabase.from("posisi_stok").select("id,name,category,status,archived,contoh,on_hand,low_stock_threshold,stock_version,reserved,available");
    stokRows = (posisi.data || []).map(function (row) {
      row.indicator = indikatorStok(row);
      return row;
    });
    if (posisi.error) document.getElementById("daftarStok").textContent = "Posisi stok ditolak server.";
    else gambarStokLayar();
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
  document.getElementById("cariProduk").addEventListener("input", function (event) {
    state.query = event.target.value;
    gambarManajemen(antrean, state, function (nama, produk) {
      if (nama === "detail") return;
      putuskan(produk.id, nama);
    });
  });
  document.getElementById("saringProduk").addEventListener("change", function (event) {
    state.status = event.target.value;
    gambarManajemen(antrean, state, function (nama, produk) {
      if (nama === "detail") return;
      putuskan(produk.id, nama);
    });
  });
  document.getElementById("cariStok").addEventListener("input", gambarStokLayar);
  document.getElementById("saringStok").addEventListener("change", gambarStokLayar);
  var kunciStok = {};
  function gambarStokLayar() {
    var kata = document.getElementById("cariStok").value.trim().toLowerCase();
    var kondisi = document.getElementById("saringStok").value;
    var rows = stokRows.filter(function (row) {
      var teks = (row.name + " " + (row.category || "")).toLowerCase();
      return (!kata || teks.indexOf(kata) !== -1) && (!kondisi || row.indicator === kondisi);
    });
    gambarStok(document.getElementById("daftarStok"), rows, function (article, row) {
      var form = document.createElement("form");
      form.className = "grid gap-2 mt-2";
      var fisik = document.createElement("input");
      fisik.className = "border rounded-lg px-3 py-2.5";
      fisik.inputMode = "numeric";
      fisik.required = true;
      fisik.setAttribute("aria-label", "Fisik " + row.name);
      fisik.value = row.on_hand == null ? "" : String(row.on_hand);
      var ambang = document.createElement("input");
      ambang.className = "border rounded-lg px-3 py-2.5";
      ambang.inputMode = "numeric";
      ambang.setAttribute("aria-label", "Ambang menipis " + row.name);
      ambang.placeholder = "Ambang menipis, kosongkan jika tidak diubah";
      ambang.value = row.low_stock_threshold == null ? "" : String(row.low_stock_threshold);
      var alasan = document.createElement("textarea");
      alasan.className = "border rounded-lg px-3 py-2.5";
      alasan.required = true;
      alasan.minLength = 3;
      alasan.maxLength = 300;
      alasan.placeholder = "Alasan penyesuaian, wajib";
      var simpan = document.createElement("button");
      simpan.type = "submit";
      simpan.className = "min-h-11 bg-indigo-600 text-white rounded-lg px-3";
      simpan.textContent = "Simpan penyesuaian";
      form.append(fisik, ambang, alasan, simpan);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var onHand = Number(fisik.value);
        var low = ambang.value.trim() === "" ? null : Number(ambang.value);
        if (!Number.isInteger(onHand) || onHand < 0 || (low != null && (!Number.isInteger(low) || low < 0))) {
          banner.textContent = "Jumlah stok dan ambang harus bilangan bulat nol atau lebih.";
          return;
        }
        if (!kunciStok[row.id]) kunciStok[row.id] = crypto.randomUUID();
        supabase.rpc("sesuaikan_stok_admin", {
          p_id: row.id,
          p_on_hand: onHand,
          p_reason: alasan.value,
          p_expected_version: row.stock_version,
          p_idempotency: kunciStok[row.id],
          p_low_stock: low
        }).then(function (hasil) {
          if (hasil.error) {
            banner.textContent = hasil.error.message || "Penyesuaian ditolak server.";
            return;
          }
          delete kunciStok[row.id];
          banner.textContent = "Penyesuaian stok tercatat. Riwayat gerakan tidak dapat diubah dari peramban.";
          muat();
        });
      });
      article.append(form);
    });
  }
  async function putuskan(id, aksi) {
    var hasil = await supabase.rpc("kelola_produk_admin", {
      p_aksi: aksi,
      p_id: id,
      p_name: null,
      p_price: null,
      p_stock: null,
      p_description: null,
      p_category: null,
      p_image_path: null,
      p_status: null,
      p_archived: null
    });
    banner.textContent = hasil.error ? "Keputusan ditolak server dan dicatat hanya jika admin berwenang." : "Keputusan tersimpan di server beserta catatan audit.";
    muat();
  }
  muat();
}
