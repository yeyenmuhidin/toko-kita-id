const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../catalog.js");

const products = catalog.products;
const root = path.join(__dirname, "..");

test("katalog asli tetap utuh", () => {
  assert.equal(products.length, 8);
  assert.deepEqual(products.map((product) => [product.id, product.name, product.price, product.category]), [
    [1, "iPhone 15 Pro", 18999000, "Elektronik"],
    [2, "Samsung Galaxy Buds 2 Pro", 2499000, "Elektronik"],
    [3, "Nike Air Force 1", 1799000, "Fashion"],
    [4, "Kaos Oversize Premium", 189000, "Fashion"],
    [5, "Apple Watch Series 9", 6999000, "Elektronik"],
    [6, "Tas Ransel Eiger", 450000, "Fashion"],
    [7, "MacBook Air M2", 15999000, "Elektronik"],
    [8, "The Ordinary Skincare Set", 650000, "Kecantikan"]
  ]);
  assert.equal(Object.isFrozen(products), true);
  assert.equal(Object.isFrozen(products[0]), true);
});

test("format rupiah memakai pemisah ribuan", () => {
  assert.equal(catalog.formatRupiah(18999000), "Rp 18.999.000");
  assert.equal(catalog.formatRupiah(189000), "Rp 189.000");
  assert.equal(catalog.formatRupiah(0), "Rp 0");
  assert.equal(catalog.formatRupiah("abc"), "Rp 0");
});

test("kategori mengikuti urutan kemunculan", () => {
  assert.deepEqual(catalog.categoriesFrom(products), ["Semua", "Elektronik", "Fashion", "Kecantikan"]);
});

test("pencarian nama, deskripsi, dan kategori tidak peka huruf", () => {
  const byName = catalog.filterAndSortProducts(products, catalog.createFilters({ query: "IPHONE" }));
  assert.deepEqual(byName.map((product) => product.id), [1]);

  const byDescription = catalog.filterAndSortProducts(products, catalog.createFilters({ query: "waterproof" }));
  assert.deepEqual(byDescription.map((product) => product.id), [6]);

  const byCategory = catalog.filterAndSortProducts(products, catalog.createFilters({ query: "kecantikan" }));
  assert.deepEqual(byCategory.map((product) => product.id), [8]);

  const partial = catalog.filterAndSortProducts(products, catalog.createFilters({ query: "pro" }));
  assert.deepEqual(partial.map((product) => product.id), [1, 2]);

  const phrase = catalog.filterAndSortProducts(products, catalog.createFilters({ query: "air force" }));
  assert.deepEqual(phrase.map((product) => product.id), [3]);
});

test("filter kategori, harga, dan urutan bisa digabung", () => {
  const fashion = catalog.filterAndSortProducts(products, catalog.createFilters({
    category: "Fashion",
    sort: "harga-asc"
  }));
  assert.deepEqual(fashion.map((product) => product.id), [4, 6, 3]);

  const ranged = catalog.filterAndSortProducts(products, catalog.createFilters({
    minPrice: 1000000,
    maxPrice: 3000000,
    sort: "harga-desc"
  }));
  assert.deepEqual(ranged.map((product) => product.id), [2, 3]);

  const named = catalog.filterAndSortProducts(products, catalog.createFilters({ sort: "nama-asc" }));
  assert.deepEqual(named.map((product) => product.name), [
    "Apple Watch Series 9",
    "iPhone 15 Pro",
    "Kaos Oversize Premium",
    "MacBook Air M2",
    "Nike Air Force 1",
    "Samsung Galaxy Buds 2 Pro",
    "Tas Ransel Eiger",
    "The Ordinary Skincare Set"
  ]);
});

test("rentang harga terbalik tidak menampilkan produk", () => {
  const filters = catalog.createFilters({ minPrice: 500000, maxPrice: 1000 });
  assert.deepEqual(catalog.filtersAreValid(filters), { ok: false, message: catalog.PRICE_RANGE_ERROR });
  assert.deepEqual(catalog.filterAndSortProducts(products, filters), []);
});

test("harga dari teks menerima titik pemisah dan nilai kosong", () => {
  assert.equal(catalog.parsePriceInput("1.500.000"), 1500000);
  assert.equal(catalog.parsePriceInput(""), null);
  assert.equal(catalog.parsePriceInput("abc"), null);
  assert.equal(catalog.parsePriceInput("0"), 0);
});

test("query katalog kembali ke nilai aman", () => {
  const parsed = catalog.parseCatalogQuery(new URLSearchParams("q=air&kategori=TidakAda&urut=terlaris&min=1000&maks=abc"), catalog.categoriesFrom(products));
  assert.deepEqual(parsed, {
    query: "air",
    category: "Semua",
    sort: "katalog",
    minPrice: 1000,
    maxPrice: null
  });
  assert.equal(catalog.resultHeading(parsed), "Hasil pencarian");
  assert.equal(catalog.resultSummary(2, 8), "Menampilkan 2 dari 8 produk demo");
});

test("filter bisa dipulihkan dari query string", () => {
  const filters = catalog.createFilters({
    query: "air force",
    category: "Fashion",
    sort: "harga-asc",
    minPrice: 1000,
    maxPrice: 2000000
  });
  const parsed = catalog.parseCatalogQuery(new URLSearchParams(catalog.toCatalogSearch(filters).slice(1)), catalog.categoriesFrom(products));
  assert.deepEqual(parsed, filters);
  assert.equal(catalog.toCatalogSearch(catalog.createFilters()), "");
});

test("keranjang menambah, membatasi 99, dan tidak mengubah masukan", () => {
  const original = [];
  const once = catalog.addItem(original, products[0], 2);
  assert.equal(original.length, 0);
  assert.equal(once[0].quantity, 2);
  assert.equal(once[0].price, 18999000);
  const capped = catalog.addItem(once, products[0], 200);
  assert.equal(capped[0].quantity, 99);
  assert.equal(once[0].quantity, 2);
  assert.equal(catalog.totalPrice(once), 37998000);
  assert.equal(catalog.canCheckout(once), true);
  assert.equal(catalog.canCheckout([]), false);
});

test("mengurangi jumlah sampai nol menghapus baris", () => {
  const items = catalog.addItem([], products[3], 1);
  const same = catalog.changeQuantity(items, 4, 0);
  assert.equal(same[0].quantity, 1);
  assert.notEqual(same, items);
  const gone = catalog.changeQuantity(items, 4, -1);
  assert.deepEqual(gone, []);
  const kept = catalog.changeQuantity(catalog.addItem([], products[3], 99), 4, 5);
  assert.equal(kept[0].quantity, 99);
});

test("parse keranjang lama tetap dipakai dan data rusak dibuang", () => {
  const legacy = JSON.stringify([{
    id: 3,
    name: "Nike Air Force 1",
    price: 1799000,
    image: products[2].image,
    category: "Fashion",
    description: products[2].description,
    quantity: 2
  }]);
  const parsed = catalog.parseStoredCart(legacy);
  assert.equal(parsed[0].quantity, 2);
  assert.equal(parsed[0].price, 1799000);
  assert.equal(catalog.cartNeedsRepair(legacy, parsed), false);
  assert.deepEqual(catalog.parseStoredCart("{"), []);
  assert.deepEqual(catalog.parseStoredCart("{\"id\":1}"), []);
  const mixed = JSON.stringify([
    { id: 1, name: "iPhone 15 Pro", price: 18999000, quantity: 150 },
    { id: "x", name: "Rusak", price: 1, quantity: 1 }
  ]);
  const repaired = catalog.parseStoredCart(mixed);
  assert.deepEqual(repaired.map((item) => [item.id, item.quantity]), [[1, 99]]);
  assert.equal(catalog.cartNeedsRepair(mixed, repaired), true);
});

test("daftar simpan membalik status dan membuang id yang tidak dikenal", () => {
  assert.deepEqual(catalog.toggleWishlist([1], 1), []);
  assert.deepEqual(catalog.toggleWishlist([1], 4), [1, 4]);
  assert.deepEqual(catalog.toggleWishlist([1], 4), catalog.toggleWishlist([1], 4));
  const raw = JSON.stringify([2, 2, "x", 99, 8]);
  const ids = catalog.parseStoredWishlist(raw, products.map((product) => product.id));
  assert.deepEqual(ids, [2, 8]);
  assert.equal(catalog.wishlistNeedsRepair(raw, ids), true);
  assert.deepEqual(catalog.parseStoredWishlist("bukan-json", [1]), []);
});

test("detail hanya mengaitkan produk dalam kategori yang sama", () => {
  assert.deepEqual(catalog.relatedProducts(products, products[0]).map((product) => product.id), [2, 5, 7]);
  assert.deepEqual(catalog.relatedProducts(products, products[7]), []);
  assert.equal(catalog.catalogCode(1), "TKI-001");
  assert.equal(catalog.catalogCode(8), "TKI-008");
});

test("checkout demo memvalidasi kontak dan merangkum barang", () => {
  const valid = catalog.validateCheckout({
    nama: "  Yeyen  ",
    whatsapp: "+62 812-3456-7890",
    alamat: "Jalan Mawar No. 1"
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.nama, "Yeyen");
  assert.equal(valid.value.whatsapp, "6281234567890");

  const invalid = catalog.validateCheckout({ nama: "A", whatsapp: "123", alamat: "pendek" });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.nama);
  assert.ok(invalid.errors.whatsapp);
  assert.ok(invalid.errors.alamat);

  const summary = catalog.checkoutSummary([{ id: 4, name: "Kaos Oversize Premium", price: 189000, quantity: 2 }]);
  assert.equal(summary.totalQuantity, 2);
  assert.equal(summary.totalPrice, 378000);
  assert.equal(summary.items[0].lineTotal, 378000);
});

test("teks dan gambar diamankan", () => {
  assert.equal(catalog.escapeHtml(`<b class="x">'`), "&lt;b class=&quot;x&quot;&gt;&#39;");
  assert.equal(catalog.safeImageUrl(products[0].image), products[0].image);
  assert.equal(catalog.safeImageUrl("javascript:alert(1)"), "");
  assert.equal(catalog.safeImageUrl("http://example.com/a.jpg"), "");
  assert.equal(catalog.safeImageUrl("data:text/html,hi"), "");
});

test("halaman mempertahankan checkout, merek, dan batas demo", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
  const sources = html + "\n" + script + "\n" + fs.readFileSync(path.join(root, "catalog.js"), "utf8");
  [
    "cartBtn",
    "cartCount",
    "cartItems",
    "checkoutBtn",
    "checkoutForm",
    "nama",
    "whatsapp",
    "alamat",
    "successModal",
    "productGrid",
    "searchInput",
    "wishlistBtn"
  ].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`));
  });
  assert.match(html, /Toko Kita ID/);
  assert.ok(html.indexOf('src="catalog.js"') < html.indexOf('src="script.js"'));
  assert.match(html, /Etalase membaca berkas catalog\.json di situs ini, bukan draf peramban/);
  assert.match(html, /Simulasi checkout/);
  assert.match(html, /Tidak ada pembayaran atau pengiriman yang diproses/);
  assert.match(script, /tokoKitaCart/);
  assert.match(script, /tokoKitaWishlist/);
  assert.match(script, /TokoKitaCatalog/);
  assert.equal(script.includes("18999000"), false);
  ["tokopedia", "terjual", "bintang", "rating", "gratis ongkir", "official store"].forEach((word) => {
    assert.equal(sources.toLowerCase().includes(word), false, word);
  });
});
