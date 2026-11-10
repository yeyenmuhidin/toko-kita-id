import { barisKeProduk, konfigurasiAman } from "./akun.mjs";
import { klienToko } from "./supabase-klien.mjs";

var antrean = window.TokoKitaAntreanKatalog || [];
window.TokoKitaAntreanKatalog = antrean;

function kirim(payload) {
  if (typeof window.TokoKitaTerimaKatalog === "function") window.TokoKitaTerimaKatalog(payload);
  else antrean.push(payload);
}

var demo = new URLSearchParams(window.location.search).get("demo") === "1";
var pratinjau = new URLSearchParams(window.location.search).get("pratinjau") === "draf";
var konfigurasi = konfigurasiAman(window.TOKO_KITA_SUPABASE || {});
if (!konfigurasi.ok || demo || pratinjau) {
  // Etalase demo ditangani script.js. Jangan mengirim katalog kosong.
} else {
  var supabase = klienToko(window.TOKO_KITA_SUPABASE);
  supabase.from("etalase").select("id,name,price,description,category,image_path,contoh,seller_name,shop_name").then(async function (result) {
    if (result.error) {
      kirim({ error: "Katalog akun gagal dimuat. Mode demo tidak dipakai otomatis." });
      return;
    }
    var products = (result.data || []).map(barisKeProduk);
    if (!products.length) {
      kirim({ products: [], kosong: true });
      return;
    }
    await Promise.all(products.map(async function (product) {
      if (!product.imagePath) return;
      var signed = await supabase.storage.from("produk").createSignedUrl(product.imagePath, 3600);
      if (!signed.error && signed.data && signed.data.signedUrl) product.image = signed.data.signedUrl;
    }));
    kirim({ products: products });
  }).catch(function () {
    kirim({ error: "Katalog akun gagal dimuat. Mode demo tidak dipakai otomatis." });
  });
}
