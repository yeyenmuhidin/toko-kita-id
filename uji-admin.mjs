import { gambarManajemen, gambarStok, indikatorStok } from "./admin-ui.mjs";

var state = {
  notice: "Perubahan di layar ini tidak dikirim ke server.",
  loading: false,
  error: "",
  query: "",
  status: "",
  products: [
    { id: "uji-1", name: "Keripik data uji", category: "Uji", price: 15000, stock: 8, status: "disetujui", archived: false, contoh: false, description: "Produk uji lokal, bukan barang toko.", seller_label: "Admin uji", detail: true },
    { id: "uji-2", name: "Sambal data uji", category: "Uji", price: 22000, stock: 2, status: "disetujui", archived: false, contoh: false, description: "Stok uji yang menipis.", seller_label: "Penjual uji", detail: true },
    { id: "uji-3", name: "Kopi data uji", category: "Uji", price: 18000, stock: 0, status: "disetujui", archived: false, contoh: false, description: "Stok uji habis.", seller_label: "Penjual uji", detail: true },
    { id: "uji-4", name: "Contoh tidak dijual", category: "Demo", price: 189000, stock: null, status: "disetujui", archived: false, contoh: true, description: "Produk contoh tidak memiliki stok jual.", seller_label: "Katalog contoh", detail: false }
  ]
};

function gambar() {
  gambarManajemen(document.getElementById("daftarUji"), state, function (nama) {
    document.getElementById("hasilUji").textContent = "Uji lokal: tindakan " + nama + " tidak dikirim ke server dan tidak mengubah stok sungguhan.";
  });
}

document.getElementById("cariUji").addEventListener("input", function (event) {
  state.query = event.target.value;
  gambar();
});
document.getElementById("statusUji").addEventListener("change", function (event) {
  state.status = event.target.value;
  gambar();
});
document.getElementById("formUji").addEventListener("submit", function (event) {
  event.preventDefault();
  document.getElementById("hasilUji").textContent = "Uji lokal: formulir tidak menyimpan ke Supabase.";
});
gambar();
gambarStok(document.getElementById("daftarStok"), [
  { name: "Keripik data uji", on_hand: 8, reserved: 2, available: 6, low_stock_threshold: 3, contoh: false },
  { name: "Sambal data uji", on_hand: 2, reserved: 0, available: 2, low_stock_threshold: 2, contoh: false },
  { name: "Kopi data uji", on_hand: 0, reserved: 0, available: 0, low_stock_threshold: 1, contoh: false },
  { name: "Contoh tidak dijual", on_hand: null, reserved: 0, available: null, low_stock_threshold: null, contoh: true }
].map(function (row) { return Object.assign({ indicator: indikatorStok(row) }, row); }));
