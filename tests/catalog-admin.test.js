const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../catalog.js");

const root = path.join(__dirname, "..");
const png = "data:image/png;base64," + "A".repeat(32);

function sample(overrides) {
  return Object.assign({
    id: 20,
    name: "Kaos Baru",
    price: 125000,
    image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400",
    category: "Fashion",
    description: "Bahan katun yang nyaman untuk dipakai harian.",
    visible: true
  }, overrides);
}

test("katalog tayang berisi delapan produk contoh yang sama", () => {
  const document = JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8"));
  const parsed = catalog.parseCatalogDocument(document);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.products.map((product) => [product.id, product.price, product.contoh, product.visible]), catalog.products.map((product) => [product.id, product.price, true, true]));
  assert.equal(catalog.storefrontProducts(parsed.products).length, 8);
});

test("ubah harga bertahan lewat ekspor dan impor, dan unduhan tidak mengaku tayang", () => {
  const edited = catalog.upsertProduct(catalog.products, catalog.validateProduct(sample({ id: 1, name: "iPhone 15 Pro", price: 123456, description: "Deskripsi produk yang sudah diubah pemilik.", category: "Elektronik", contoh: true })).value);
  const raw = catalog.serializeCatalog(edited);
  assert.match(raw, /Mengunduh berkas ini tidak menayangkan perubahan/);
  const parsed = catalog.parseCatalogDocument(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.products.find((product) => product.id === 1).price, 123456);
  const draftRaw = catalog.serializeDraft(parsed.products, "2026-11-07T00:00:00.000Z");
  const draft = catalog.parseStoredDraft(draftRaw);
  assert.equal(draft.ok, true);
  assert.equal(draft.products.find((product) => product.id === 1).price, 123456);
  assert.equal(draft.savedAt, "2026-11-07T00:00:00.000Z");
});

test("produk tersembunyi tidak masuk etalase", () => {
  const hidden = catalog.products.map((product) => Object.assign({}, product, { visible: product.id !== 4 }));
  assert.deepEqual(catalog.storefrontProducts(hidden).map((product) => product.id), [1, 2, 3, 5, 6, 7, 8]);
});

test("impor menolak data rusak, tautan berbahaya, dan duplikat", () => {
  assert.equal(catalog.parseCatalogDocument("{").ok, false);
  assert.equal(catalog.parseCatalogDocument({ schema: 2, products: [] }).ok, false);
  assert.equal(catalog.parseCatalogDocument({ schema: 1, products: [sample({ name: "<script>" })] }).ok, false);
  assert.equal(catalog.parseCatalogDocument({ schema: 1, products: [sample({ price: -1 })] }).ok, false);
  assert.equal(catalog.parseCatalogDocument({ schema: 1, products: [sample({ price: 10.5 })] }).ok, false);
  assert.equal(catalog.parseCatalogDocument({ schema: 1, products: [sample({ image: "javascript:alert(1)" })] }).ok, false);
  assert.equal(catalog.parseCatalogDocument({ schema: 1, products: [sample({ image: "http://example.com/a.jpg" })] }).ok, false);
  assert.equal(catalog.parseCatalogDocument({ schema: 1, products: [sample({ image: "data:image/svg+xml;base64," + "A".repeat(32) })] }).ok, false);
  assert.equal(catalog.parseCatalogDocument({ schema: 1, products: [sample({ id: 1 }), sample({ id: 1, name: "Produk lain" })] }).ok, false);
  assert.equal(catalog.parseStoredDraft("{").ok, false);
  assert.equal(catalog.parseStoredDraft("").ok, false);
  assert.equal(catalog.serializeCatalog([sample({ name: "<b>" })]), "");
});

test("gambar https dan data gambar yang aman diterima", () => {
  const https = catalog.parseCatalogDocument({ schema: 1, products: [sample()] });
  const embedded = catalog.parseCatalogDocument({ schema: 1, products: [sample({ image: png })] });
  assert.equal(https.ok, true);
  assert.equal(embedded.ok, true);
  assert.equal(catalog.safeProductImage("https://user:secret@example.com/a.jpg"), "");
  assert.equal(catalog.isSafeImageDataUrl(png), true);
});

test("etalase memakai berkas tayang, draf hanya lewat pratinjau", () => {
  const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
  const editor = fs.readFileSync(path.join(root, "kelola.js"), "utf8");
  const page = fs.readFileSync(path.join(root, "kelola.html"), "utf8");
  assert.match(script, /fetch\("catalog\.json"/);
  assert.match(script, /pratinjau/);
  assert.match(script, /tokoKitaCatalogDraft/);
  assert.equal(script.includes("password"), false);
  assert.match(editor, /tokoKitaCatalogDraft/);
  assert.match(editor, /Belum tayang/);
  assert.match(page, /belum tayang/i);
  assert.match(page, /Unduh draf catalog\.json/);
  assert.match(page, /confirmDialog/);
  assert.equal(/password|github_pat|ghp_|secret/i.test(editor + page), false);
  assert.equal(editor.includes("method: \"POST\""), false);
});
