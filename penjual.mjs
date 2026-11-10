import { berkasGambarAman, konfigurasiAman } from "./akun.mjs";
import { klienToko } from "./supabase-klien.mjs";

var banner = document.getElementById("jualBanner");
var status = document.getElementById("jualStatus");
var konfigurasi = konfigurasiAman(window.TOKO_KITA_SUPABASE || {});
if (!konfigurasi.ok) {
  banner.textContent = "Halaman jual belum terhubung. " + konfigurasi.reason + " Tidak ada produk yang dikirim.";
} else {
  banner.textContent = "Perubahan dikirim ke akun Anda dan menunggu tinjauan. Etalase publik tidak berubah sebelum disetujui.";
  var supabase = klienToko(window.TOKO_KITA_SUPABASE);
  var userId = null;
  var gambarLama = null;

  async function muat() {
    var session = await supabase.auth.getSession();
    if (!session.data.session) {
      status.textContent = "Masuk dulu untuk menambah produk. Belum ada sesi.";
      return;
    }
    userId = session.data.session.user.id;
    var profil = await supabase.from("profiles").select("role,display_name,shop_name").eq("id", userId).single();
    if (profil.error || !profil.data) {
      status.textContent = "Profil gagal dimuat.";
      return;
    }
    if (profil.data.role === "pembeli") {
      document.getElementById("jadiPenjual").hidden = false;
      document.getElementById("displayName").value = profil.data.display_name || "";
      return;
    }
    document.getElementById("jadiPenjual").hidden = true;
    document.getElementById("produkPenjual").hidden = false;
    var daftar = await supabase.from("products").select("id,name,price,description,category,image_path,status").eq("seller_id", userId).order("created_at", { ascending: false });
    var root = document.getElementById("daftarProduk");
    root.innerHTML = "";
    (daftar.data || []).forEach(function (produk) {
      var article = document.createElement("article");
      article.className = "border rounded-xl p-3";
      var title = document.createElement("h2");
      title.className = "font-semibold";
      title.textContent = produk.name;
      var meta = document.createElement("p");
      meta.className = "text-sm text-gray-600";
      meta.textContent = produk.category + " · " + window.TokoKitaCatalog.formatRupiah(produk.price) + " · " + produk.status;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "mt-2 min-h-11 px-3 border rounded-lg text-sm";
      button.textContent = "Ubah";
      button.addEventListener("click", function () {
        document.getElementById("productId").value = produk.id;
        document.getElementById("productName").value = produk.name;
        document.getElementById("productPrice").value = String(produk.price);
        document.getElementById("productCategory").value = produk.category;
        document.getElementById("productDescription").value = produk.description;
        gambarLama = produk.image_path;
      });
      article.append(title, meta, button);
      root.append(article);
    });
    var baris = await supabase.from("baris_pesanan_penjual").select("id,product_name,payment_status,fulfillment_status,buyer_name").order("created_at", { ascending: false });
    var tujuan = document.getElementById("barisPesanan");
    if (tujuan) {
      tujuan.replaceChildren();
      (baris.data || []).forEach(function (barisItem) {
        var kartu = document.createElement("article");
        kartu.className = "border rounded-xl p-3";
        var judul = document.createElement("h3");
        judul.className = "font-medium";
        judul.textContent = barisItem.product_name;
        var info = document.createElement("p");
        info.className = "text-sm text-gray-600";
        info.textContent = barisItem.payment_status + " · " + barisItem.fulfillment_status + (barisItem.buyer_name ? " · " + barisItem.buyer_name : "");
        kartu.append(judul, info);
        tujuan.append(kartu);
      });
    }
  }

  document.getElementById("tokoForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    var hasil = await supabase.from("profiles").update({
      role: "penjual",
      shop_name: document.getElementById("shopName").value.trim(),
      display_name: document.getElementById("displayName").value.trim()
    }).eq("id", userId);
    status.textContent = hasil.error ? "Profil penjual ditolak server." : "Profil penjual tersimpan. Anda belum otomatis menjadi admin.";
    if (!hasil.error) muat();
  });

  document.getElementById("produkForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    var harga = window.TokoKitaCatalog.parsePriceInput(document.getElementById("productPrice").value);
    var file = document.getElementById("productImage").files[0];
    var pesanGambar = file ? berkasGambarAman(file) : "";
    if (harga == null || pesanGambar) {
      status.textContent = pesanGambar || "Harga harus bilangan bulat rupiah.";
      return;
    }
    var path = gambarLama;
    if (file) {
      var ekstensi = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
      path = userId + "/" + crypto.randomUUID() + "." + ekstensi;
      var unggah = await supabase.storage.from("produk").upload(path, file, { contentType: file.type, upsert: false });
      if (unggah.error) {
        status.textContent = "Foto ditolak. Produk tidak dikirim.";
        return;
      }
    }
    var data = {
      name: document.getElementById("productName").value.trim(),
      price: harga,
      category: document.getElementById("productCategory").value.trim(),
      description: document.getElementById("productDescription").value.trim(),
      image_path: path
    };
    if (!id) data.seller_id = userId;
    var id = document.getElementById("productId").value;
    var hasil = id
      ? await supabase.from("products").update(data).eq("id", id)
      : await supabase.from("products").insert(data);
    status.textContent = hasil.error ? "Produk ditolak server dan belum tampil di etalase." : "Produk tersimpan dengan status menunggu. Belum tampil untuk pengunjung.";
    if (!hasil.error) {
      document.getElementById("produkForm").reset();
      gambarLama = null;
      muat();
    }
  });
  muat();
}
