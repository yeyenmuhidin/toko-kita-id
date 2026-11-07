export function labelStok(stock) {
  if (stock == null || stock === "") return "Stok belum diatur";
  if (Number(stock) === 0) return "Habis";
  return "Stok " + stock;
}

export function labelStatus(product) {
  if (product.archived) return "Diarsipkan";
  if (product.status === "disetujui" && product.contoh) return "Contoh, tidak dijual";
  if (product.status === "disetujui") return "Disetujui";
  if (product.status === "menunggu") return "Menunggu";
  if (product.status === "ditolak") return "Ditolak";
  if (product.status === "disembunyikan") return "Disembunyikan";
  return product.status || "Tidak diketahui";
}

export function saringProduk(products, query, status) {
  var kata = String(query || "").trim().toLowerCase();
  return (products || []).filter(function (product) {
    var cocokStatus = !status || (status === "diarsipkan" ? product.archived : product.status === status && !product.archived);
    var teks = (product.name + " " + product.category).toLowerCase();
    return cocokStatus && (!kata || teks.indexOf(kata) !== -1);
  });
}

export function gambarStok(root, rows, form) {
  root.replaceChildren();
  var catatan = document.createElement("p");
  catatan.className = "text-sm text-gray-600";
  catatan.textContent = "Fisik adalah jumlah di tangan. Cadangan adalah pesanan sandbox yang belum lunas. Tersedia = fisik - cadangan.";
  root.append(catatan);
  if (!rows.length) {
    var kosong = document.createElement("p");
    kosong.textContent = "Tidak ada produk pada saringan stok.";
    root.append(kosong);
    return;
  }
  rows.forEach(function (row) {
    var article = document.createElement("article");
    article.className = "bg-white rounded-xl shadow-sm p-4";
    var title = document.createElement("h3");
    title.className = "font-semibold";
    title.textContent = row.name;
    var angka = document.createElement("p");
    angka.className = "text-sm";
    angka.textContent = "Fisik " + (row.on_hand == null ? "belum diatur" : row.on_hand) + " · Cadangan " + row.reserved + " · Tersedia " + (row.available == null ? "tidak dijual" : row.available);
    var tanda = document.createElement("p");
    tanda.className = "text-sm font-medium";
    if (row.indicator === "Habis") tanda.className += " text-red-700";
    else if (row.indicator === "Menipis") tanda.className += " text-amber-800";
    else if (row.indicator === "Cukup") tanda.className += " text-emerald-800";
    tanda.textContent = row.indicator + (row.low_stock_threshold == null ? "" : " · ambang " + row.low_stock_threshold);
    article.append(title, angka, tanda);
    if (typeof form === "function") form(article, row);
    root.append(article);
  });
}

export function indikatorStok(row) {
  if (row.contoh || row.on_hand == null) return "Belum diatur, tidak dijual";
  if (row.available <= 0) return "Habis";
  if (row.low_stock_threshold != null && row.available <= row.low_stock_threshold) return "Menipis";
  return "Cukup";
}

export function gambarManajemen(root, state, aksi) {
  root.replaceChildren();
  var judul = document.createElement("p");
  judul.className = "text-sm";
  judul.textContent = state.notice || "";
  root.append(judul);
  if (state.loading) {
    var muat = document.createElement("p");
    muat.textContent = "Memuat produk…";
    root.append(muat);
    return;
  }
  if (state.error) {
    var gagal = document.createElement("p");
    gagal.className = "text-sm text-red-700";
    gagal.setAttribute("role", "alert");
    gagal.textContent = state.error;
    root.append(gagal);
    return;
  }
  var daftar = saringProduk(state.products, state.query, state.status);
  if (!daftar.length) {
    var kosong = document.createElement("p");
    kosong.textContent = "Tidak ada produk pada saringan ini.";
    root.append(kosong);
    return;
  }
  daftar.forEach(function (product) {
    var article = document.createElement("article");
    article.className = "bg-white rounded-xl shadow-sm p-4 space-y-2";
    var title = document.createElement("h3");
    title.className = "font-semibold";
    title.textContent = product.name;
    var meta = document.createElement("p");
    meta.className = "text-sm text-gray-600";
    meta.textContent = product.category + " · Rp " + Number(product.price).toLocaleString("id-ID") + " · " + labelStatus(product) + " · " + labelStok(product.stock);
    var pemilik = document.createElement("p");
    pemilik.className = "text-xs text-gray-500";
    pemilik.textContent = product.milikUji || "Pemilik: " + (product.seller_label || "tidak diketahui");
    article.append(title, meta, pemilik);
    if (product.detail) {
      var detail = document.createElement("p");
      detail.className = "text-sm";
      detail.textContent = product.description;
      article.append(detail);
    }
    var bar = document.createElement("div");
    bar.className = "flex flex-wrap gap-2";
    function tombol(teks, nama) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "min-h-11 px-3 rounded-lg border text-sm";
      button.textContent = teks;
      button.addEventListener("click", function () { aksi(nama, product); });
      bar.append(button);
    }
    tombol("Detail", "detail");
    if (product.status === "menunggu") {
      tombol("Setujui", "setujui");
      tombol("Tolak", "tolak");
    }
    tombol(product.archived ? "Pulihkan" : "Arsipkan", product.archived ? "pulihkan" : "arsipkan");
    article.append(bar);
    root.append(article);
  });
}
