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

test("favorit dan perbandingan hanya menyimpan id yang sah", () => {
  assert.deepEqual(catalog.toggleWishlist([1], 1), []);
  assert.deepEqual(catalog.toggleWishlist([1], 4), [1, 4]);
  assert.deepEqual(catalog.toggleWishlist([1], 4), catalog.toggleWishlist([1], 4));
  const raw = JSON.stringify([2, 2, "x", 99, 8]);
  const ids = catalog.parseStoredWishlist(raw, products.map((product) => product.id));
  assert.deepEqual(ids, [2, 8]);
  assert.equal(catalog.wishlistNeedsRepair(raw, ids), true);
  assert.deepEqual(catalog.parseStoredWishlist("bukan-json", [1]), []);
  assert.equal(catalog.COMPARE_LIMIT, 3);
  assert.deepEqual(catalog.toggleCompare([], 1), { ids: [1], status: "added" });
  assert.deepEqual(catalog.toggleCompare([1, 2, 4], 5).status, "limit");
  assert.deepEqual(catalog.toggleCompare([1, 2, 4], 5).ids, [1, 2, 4]);
  assert.deepEqual(catalog.toggleCompare([1, 2], 2), { ids: [1], status: "removed" });
  assert.equal(catalog.toggleCompare([1], "<script>alert(1)</script>").status, "invalid");
  const stale = JSON.stringify([1, 99, "<script>", 2, 4, 5]);
  assert.deepEqual(catalog.parseStoredCompare(stale, [1, 2, 4, 5]), [1, 2, 4]);
  assert.equal(catalog.compareNeedsRepair(stale, [1, 2, 4]), true);
  assert.deepEqual(catalog.parseStoredCompare("bukan-json", [1]), []);
  assert.equal(catalog.availabilityLabel(null), "Tidak ada di katalog");
  assert.equal(catalog.availabilityLabel({ stock: 0 }), "Habis");
  assert.equal(catalog.availabilityLabel({ contoh: true, stock: 4 }), "Contoh, tidak dijual");
  assert.equal(catalog.availabilityLabel({ visible: false, stock: 4 }), "Tidak ditampilkan");
  assert.equal(catalog.availabilityLabel({ stock: 2 }), "Tersedia, 2");
  assert.equal(catalog.availabilityLabel({ name: "<script>" }), "Ketersediaan tidak dicatat");
  assert.equal(catalog.escapeHtml(catalog.availabilityLabel({ name: "<script>" })).includes("<script>"), false);
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

test("katalog akun kosong kembali ke contoh, galat tidak", () => {
  assert.equal(catalog.keputusanKatalogAkun({ products: [] }), "demo-kosong");
  assert.equal(catalog.keputusanKatalogAkun({ products: [], kosong: true }), "demo-kosong");
  assert.equal(catalog.keputusanKatalogAkun({ error: "gagal" }), "galat");
  assert.equal(catalog.keputusanKatalogAkun({ products: [{ id: "x" }] }), "akun");
});

test("teks dan gambar diamankan", () => {
  assert.equal(catalog.escapeHtml(`<b class="x">'`), "&lt;b class=&quot;x&quot;&gt;&#39;");
  assert.equal(catalog.safeImageUrl(products[0].image), products[0].image);
  assert.equal(catalog.safeImageUrl("javascript:alert(1)"), "");
  assert.equal(catalog.safeImageUrl("http://example.com/a.jpg"), "");
  assert.equal(catalog.safeImageUrl("data:text/html,hi"), "");
});

test("detail publik, galeri, dan tautan WhatsApp memakai jalur Pages", () => {
  const document = JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8"));
  const parsed = catalog.parseCatalogDocument(document);
  const iphone = parsed.products[0];
  assert.equal(parsed.ok, true);
  assert.deepEqual(catalog.productGallery(iphone), [iphone.image]);
  assert.equal(iphone.images, undefined);

  const second = parsed.products[1].image;
  const gallery = catalog.productGallery({
    image: iphone.image,
    images: [iphone.image, second, "javascript:alert(1)", "http://example.com/a.jpg", "data:text/html,hi", ""]
  });
  assert.deepEqual(gallery, [iphone.image, second]);
  assert.deepEqual(catalog.productGallery(null), []);
  assert.deepEqual(catalog.productGallery({ image: "javascript:alert(1)" }), []);

  const withExtra = catalog.parseCatalogDocument({
    schema: 1,
    products: [{
      id: 20,
      name: "Kaos Baru",
      price: 125000,
      image: iphone.image,
      images: ["javascript:alert(1)", second, second],
      category: "Fashion",
      description: "Bahan katun yang nyaman untuk dipakai harian.",
      visible: true
    }]
  });
  assert.equal(withExtra.ok, true);
  assert.deepEqual(withExtra.products[0].images, [second]);

  const shown = catalog.publicDetail(iphone, { id: 1 });
  assert.equal(shown.status, "tayang");
  assert.equal(shown.contoh, true);
  assert.equal(shown.gallery.length, 1);
  assert.equal(shown.permalink, "https://yeyenmuhidin.github.io/toko-kita-id/?produk=1&demo=1");
  assert.equal(shown.sellerName, undefined);
  assert.equal(shown.imagePath, undefined);
  assert.equal(catalog.publicDetail(iphone, { id: 99 }).status, "tidak-ada");
  assert.equal(catalog.publicDetail(iphone, { id: "<script>alert(1)</script>" }).status, "tidak-sah");
  assert.equal(catalog.publicDetail(null, { id: 4 }).status, "tidak-ada");
  const hidden = catalog.publicDetail({
    id: 4,
    name: "Rahasia <script>",
    price: 10,
    description: "Data yang tidak boleh dibagikan ke publik.",
    category: "Fashion",
    image: iphone.image,
    visible: false,
    sellerName: "Pemilik"
  }, { id: 4 });
  assert.equal(hidden.status, "tidak-ditampilkan");
  assert.equal(hidden.name, undefined);
  assert.equal(hidden.permalink, undefined);
  const pending = catalog.publicDetail({
    id: "11111111-1111-4111-8111-111111111111",
    name: "Menunggu",
    price: 10,
    description: "Deskripsi produk yang belum disetujui.",
    category: "Fashion",
    image: iphone.image,
    visible: true,
    status: "menunggu"
  }, { id: "11111111-1111-4111-8111-111111111111" });
  assert.equal(pending.status, "tidak-ditampilkan");
  assert.equal(pending.name, undefined);
  assert.equal(catalog.publicDetail(iphone, { id: 1, catalogError: true }).status, "galat");

  const live = catalog.publicDetail({
    id: 9,
    name: "Produk disetujui",
    price: 50000,
    description: "Deskripsi katalog yang memang ditampilkan.",
    category: "Fashion",
    image: second,
    visible: true,
    status: "disetujui",
    contoh: false
  }, { id: 9 });
  assert.equal(live.permalink, "https://yeyenmuhidin.github.io/toko-kita-id/?produk=9");
  assert.equal(live.contoh, false);

  const share = catalog.whatsappShareUrl('Kaos <script> & "x"', shown.permalink);
  assert.match(share, /^https:\/\/wa\.me\/\?text=/);
  assert.equal(share.includes("phone="), false);
  const text = decodeURIComponent(share.slice("https://wa.me/?text=".length));
  assert.equal(text, 'Kaos <script> & "x"\nhttps://yeyenmuhidin.github.io/toko-kita-id/?produk=1&demo=1');
  assert.equal(catalog.whatsappShareUrl("Kaos", "javascript:alert(1)"), "");
  assert.equal(catalog.whatsappShareUrl("Kaos", "https://evil.example/toko-kita-id/?produk=1"), "");
  assert.equal(catalog.whatsappShareUrl("Kaos", "https://yeyenmuhidin.github.io/?produk=1"), "");
  const stripped = catalog.whatsappShareUrl("Kaos", "https://yeyenmuhidin.github.io/toko-kita-id/?produk=1&pratinjau=draf&token=rahasia");
  const strippedText = decodeURIComponent(stripped.slice("https://wa.me/?text=".length));
  assert.equal(strippedText, "Kaos\nhttps://yeyenmuhidin.github.io/toko-kita-id/?produk=1");
  assert.equal(strippedText.includes("rahasia"), false);
  assert.equal(strippedText.includes("pratinjau"), false);
});

test("riwayat dilihat menyimpan id terbaru, membuang yang tidak sah, dan paling banyak delapan", () => {
  assert.equal(catalog.RECENT_LIMIT, 8);
  assert.deepEqual(catalog.rememberViewed([], 4), [4]);
  assert.deepEqual(catalog.rememberViewed([4, 2], 1), [1, 4, 2]);
  assert.deepEqual(catalog.rememberViewed([1, 4, 2], 4), [4, 1, 2]);
  assert.deepEqual(catalog.rememberViewed([1], "<script>alert(1)</script>"), [1]);
  assert.deepEqual(catalog.rememberViewed([1], "bukan-id"), [1]);
  const capped = [8, 7, 6, 5, 4, 3, 2, 1].reduce((list, id) => catalog.rememberViewed(list, id), []);
  assert.deepEqual(capped, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(capped.length, 8);
  assert.deepEqual(catalog.clearViewed(), []);
  const raw = JSON.stringify([2, 2, "x", 99, "<script>", 8, 1]);
  const known = products.map((product) => product.id);
  assert.deepEqual(catalog.parseStoredRecent(raw, known), [2, 8, 1]);
  assert.equal(catalog.recentNeedsRepair(raw, [2, 8, 1]), true);
  assert.deepEqual(catalog.parseStoredRecent("bukan-json", known), []);
  assert.deepEqual(catalog.parseStoredRecent(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9]), [1, 2, 3, 4, 5, 6, 7, 8, 9]), [1, 2, 3, 4, 5, 6, 7, 8]);
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
  assert.match(script, /tokoKitaBanding/);
  assert.match(script, /tokoKitaBaruDilihat/);
  assert.match(html, /id="recentSection"/);
  assert.match(html, /Baru dilihat/);
  assert.match(html, /Hapus riwayat/);
  assert.match(script, /Bagikan lewat WhatsApp/);
  assert.match(script, /whatsappShareUrl/);
  assert.match(sources, /yeyenmuhidin\.github\.io/);
  assert.match(sources, /\/toko-kita-id\//);
  assert.match(html, /id="compareBtn"/);
  assert.match(html, /id="compareSidebar"/);
  assert.match(script, /TokoKitaCatalog/);
  assert.equal(script.includes("18999000"), false);
  ["tokopedia", "terjual", "bintang", "rating", "gratis ongkir", "official store"].forEach((word) => {
    assert.equal(sources.toLowerCase().includes(word), false, word);
  });
});
