import test from "node:test";
import assert from "node:assert/strict";
import { barisKeProduk, berkasGambarAman, konfigurasiAman, jalurGambarAman } from "../akun.mjs";
import catalog from "../catalog.js";

function token(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${body}.x`;
}

test("konfigurasi kosong dan service role ditolak", () => {
  assert.equal(konfigurasiAman({ url: "", publishableKey: "" }).ok, false);
  assert.equal(konfigurasiAman({ url: "http://xlsbhvpveivhbqikmxxp.supabase.co", publishableKey: "sb_publishable_contoh" }).ok, false);
  assert.equal(konfigurasiAman({ url: "https://xlsbhvpveivhbqikmxxp.supabase.co", publishableKey: token({ role: "service_role" }) }).ok, false);
  const aman = konfigurasiAman({ url: "https://xlsbhvpveivhbqikmxxp.supabase.co/", publishableKey: "sb_publishable_contoh" });
  assert.equal(aman.ok, true);
  assert.equal(aman.url, "https://xlsbhvpveivhbqikmxxp.supabase.co");
});

test("jalur gambar hanya milik penjual dan jenis berkas dibatasi", () => {
  const seller = "11111111-1111-4111-8111-111111111111";
  assert.equal(jalurGambarAman(seller, `${seller}/foto.jpg`), true);
  assert.equal(jalurGambarAman(seller, "22222222-2222-4222-8222-222222222222/foto.jpg"), false);
  assert.equal(berkasGambarAman({ type: "image/svg+xml", size: 100 }), "Gunakan JPEG, PNG, atau WebP.");
  assert.equal(berkasGambarAman({ type: "image/png", size: 350001 }), "Gambar maksimal 350 KB.");
  assert.equal(berkasGambarAman({ type: "image/webp", size: 1000 }), "");
});

test("baris etalase dan keranjang uuid tidak merusak id lama", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const produk = barisKeProduk({ id, name: "Sabun", price: 25000, description: "Deskripsi cukup panjang.", category: "Rumah", image_path: `${id}/a.jpg`, contoh: false, seller_name: "A", shop_name: "Toko A" });
  const cart = catalog.parseStoredCart(JSON.stringify([
    { id: 4, name: "Kaos Oversize Premium", price: 189000, quantity: 2 },
    { id, name: "Sabun", price: 25000, quantity: 1 }
  ]));
  assert.deepEqual(cart.map((item) => item.id), [4, id]);
  assert.equal(catalog.cartNeedsRepair(JSON.stringify([{ id: 4, name: "Kaos Oversize Premium", price: 189000, quantity: 2 }]), [cart[0]]), false);
  assert.deepEqual(catalog.toggleWishlist([4], id), [4, id]);
  assert.equal(catalog.addItem([], produk, 1)[0].id, id);
  assert.equal(catalog.catalogCode(id), "TKI-11111111");
});
