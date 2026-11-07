(function (root, factory) {
  var api = factory();
  if (root) root.TokoKitaCatalog = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var MAX_QTY = 99;
  var PRICE_RANGE_ERROR = "Harga minimum tidak boleh lebih besar dari harga maksimum.";
  var EMPTY_RESULT_MESSAGE = "Tidak ada produk yang cocok. Coba kata kunci lain atau atur ulang filter.";

  var SORT_OPTIONS = [
    { id: "katalog", label: "Urutan katalog" },
    { id: "harga-asc", label: "Harga terendah" },
    { id: "harga-desc", label: "Harga tertinggi" },
    { id: "nama-asc", label: "Nama A–Z" },
    { id: "nama-desc", label: "Nama Z–A" }
  ];

  var products = [
    { id: 1, name: "iPhone 15 Pro", price: 18999000, image: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=400&h=400&fit=crop", category: "Elektronik", description: "Chip A17 Pro, kamera 48MP, titanium design" },
    { id: 2, name: "Samsung Galaxy Buds 2 Pro", price: 2499000, image: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400&h=400&fit=crop", category: "Elektronik", description: "ANC terbaik, suara Hi-Fi 24bit" },
    { id: 3, name: "Nike Air Force 1", price: 1799000, image: "https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=400&h=400&fit=crop", category: "Fashion", description: "Sneakers klasik yang timeless" },
    { id: 4, name: "Kaos Oversize Premium", price: 189000, image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=400&fit=crop", category: "Fashion", description: "Bahan cotton combed 30s, adem & nyaman" },
    { id: 5, name: "Apple Watch Series 9", price: 6999000, image: "https://images.unsplash.com/photo-1434493789847-2f02dc6ca35d?w=400&h=400&fit=crop", category: "Elektronik", description: "Always-On display, S9 chip, Double Tap" },
    { id: 6, name: "Tas Ransel Eiger", price: 450000, image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&h=400&fit=crop", category: "Fashion", description: "Waterproof, kapasitas 30L, cocok traveling" },
    { id: 7, name: "MacBook Air M2", price: 15999000, image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400&h=400&fit=crop", category: "Elektronik", description: "Chip M2, 13.6 inch Liquid Retina, super tipis" },
    { id: 8, name: "The Ordinary Skincare Set", price: 650000, image: "https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop", category: "Kecantikan", description: "Niacinamide + Hyaluronic Acid + Caffeine Solution" }
  ];

  products.forEach(function (product) {
    Object.freeze(product);
  });
  Object.freeze(products);

  function formatRupiah(amount) {
    var value = Math.round(Number(amount));
    if (!Number.isFinite(value)) value = 0;
    var sign = value < 0 ? "-" : "";
    return "Rp " + sign + Math.abs(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function categoriesFrom(list) {
    var seen = [];
    list.forEach(function (product) {
      if (seen.indexOf(product.category) === -1) seen.push(product.category);
    });
    return ["Semua"].concat(seen);
  }

  function createFilters(overrides) {
    var filters = {
      query: "",
      category: "Semua",
      sort: "katalog",
      minPrice: null,
      maxPrice: null
    };
    if (!overrides) return filters;
    Object.keys(overrides).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(filters, key)) filters[key] = overrides[key];
    });
    return filters;
  }

  function parsePriceInput(value) {
    if (value == null) return null;
    var digits = String(value).replace(/[^\d]/g, "");
    if (!digits) return null;
    var amount = Number(digits);
    return Number.isFinite(amount) ? amount : null;
  }

  function filtersAreValid(filters) {
    if (filters.minPrice != null && filters.maxPrice != null && filters.minPrice > filters.maxPrice) {
      return { ok: false, message: PRICE_RANGE_ERROR };
    }
    return { ok: true, message: "" };
  }

  function normalizedQuery(query) {
    return String(query || "").trim().toLowerCase();
  }

  function matchesQuery(product, query) {
    if (!query) return true;
    var haystack = (product.name + " " + product.description + " " + product.category).toLowerCase();
    var words = query.split(/\s+/).filter(Boolean);
    var haystackWords = haystack.split(/[^a-z0-9]+/).filter(Boolean);
    return words.every(function (word) {
      return haystackWords.some(function (candidate) {
        return candidate.indexOf(word) === 0;
      });
    });
  }

  function sortProducts(list, sort) {
    var sorted = list.slice();
    if (sort === "harga-asc") {
      sorted.sort(function (a, b) { return a.price - b.price || a.id - b.id; });
    } else if (sort === "harga-desc") {
      sorted.sort(function (a, b) { return b.price - a.price || a.id - b.id; });
    } else if (sort === "nama-asc") {
      sorted.sort(function (a, b) { return a.name.localeCompare(b.name, "id") || a.id - b.id; });
    } else if (sort === "nama-desc") {
      sorted.sort(function (a, b) { return b.name.localeCompare(a.name, "id") || a.id - b.id; });
    } else {
      sorted.sort(function (a, b) { return a.id - b.id; });
    }
    return sorted;
  }

  function filterAndSortProducts(list, filters) {
    var active = filters || createFilters();
    if (!filtersAreValid(active).ok) return [];
    var query = normalizedQuery(active.query);
    var known = {};
    list.forEach(function (product) { known[product.category] = true; });
    var category = active.category === "Semua" || known[active.category] ? active.category : "Semua";
    var matched = list.filter(function (product) {
      var matchesQueryText = matchesQuery(product, query);
      var matchesCategory = !category || category === "Semua" || product.category === category;
      var matchesMin = active.minPrice == null || product.price >= active.minPrice;
      var matchesMax = active.maxPrice == null || product.price <= active.maxPrice;
      return matchesQueryText && matchesCategory && matchesMin && matchesMax;
    });
    return sortProducts(matched, active.sort);
  }

  function resultHeading(filters) {
    var query = String((filters && filters.query) || "").trim();
    if (query) return "Hasil pencarian";
    if (filters && filters.category && filters.category !== "Semua") return filters.category;
    return "Semua Produk";
  }

  function resultSummary(shown, total) {
    return "Menampilkan " + shown + " dari " + total + " produk demo";
  }

  function clampQuantity(value) {
    var number = Math.floor(Number(value));
    if (!Number.isFinite(number) || number < 1) return 1;
    return Math.min(MAX_QTY, number);
  }

  function toCartItem(product, quantity) {
    return {
      id: canonicalProductId(product.id),
      name: product.name,
      price: product.price,
      image: product.image,
      category: product.category,
      description: product.description,
      quantity: quantity
    };
  }

  function addItem(items, product, quantity) {
    if (!product || canonicalProductId(product.id) == null) return items.slice();
    var qty = clampQuantity(quantity);
    var existing = null;
    items.forEach(function (item) {
      if (item.id === product.id) existing = item;
    });
    if (!existing) return items.concat([toCartItem(product, qty)]);
    return items.map(function (item) {
      if (item.id !== product.id) return item;
      return Object.assign({}, item, { quantity: Math.min(MAX_QTY, item.quantity + qty) });
    });
  }

  function changeQuantity(items, productId, change) {
    var delta = Math.trunc(Number(change));
    if (!Number.isFinite(delta) || delta === 0) return items.slice();
    return items.flatMap(function (item) {
      if (item.id !== productId) return [item];
      var next = item.quantity + delta;
      if (next <= 0) return [];
      return [Object.assign({}, item, { quantity: Math.min(MAX_QTY, next) })];
    });
  }

  function removeItem(items, productId) {
    return items.filter(function (item) { return item.id !== productId; });
  }

  function totalQuantity(items) {
    return items.reduce(function (sum, item) { return sum + item.quantity; }, 0);
  }

  function totalPrice(items) {
    return items.reduce(function (sum, item) { return sum + (item.price * item.quantity); }, 0);
  }

  function canCheckout(items) {
    return items.length > 0 && totalQuantity(items) > 0;
  }

  function canonicalProductId(value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
    if (typeof value === "string" && /^[1-9]\d{0,8}$/.test(value)) return Number(value);
    if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      return value.toLowerCase();
    }
    return null;
  }

  function toggleWishlist(ids, productId) {
    var id = canonicalProductId(productId);
    if (id == null) return ids.slice();
    if (ids.indexOf(id) !== -1) return ids.filter(function (item) { return item !== id; });
    return ids.concat([id]);
  }

  function integerId(value) {
    var id = canonicalProductId(value);
    return typeof id === "number" ? id : null;
  }

  function parseStoredCart(raw) {
    if (raw == null || raw === "") return [];
    var data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      return [];
    }
    if (!Array.isArray(data)) return [];
    return data.flatMap(function (item) {
      if (!item || typeof item !== "object") return [];
      var id = canonicalProductId(item.id);
      var price = Number(item.price);
      var quantity = Number(item.quantity);
      if (id == null || !Number.isFinite(price) || !Number.isFinite(quantity)) return [];
      if (typeof item.name !== "string" || item.name.trim() === "" || quantity < 1) return [];
      return [{
        id: id,
        name: item.name,
        price: price,
        image: typeof item.image === "string" ? item.image : "",
        category: typeof item.category === "string" ? item.category : "",
        description: typeof item.description === "string" ? item.description : "",
        quantity: Math.min(MAX_QTY, Math.floor(quantity))
      }];
    });
  }

  function parseStoredWishlist(raw, knownIds) {
    if (raw == null || raw === "") return [];
    var data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      return [];
    }
    if (!Array.isArray(data)) return [];
    var known = knownIds ? knownIds.reduce(function (map, id) {
      map[id] = true;
      return map;
    }, {}) : null;
    var ids = [];
    data.forEach(function (value) {
      var id = canonicalProductId(value);
      if (id == null) return;
      if (known && !known[id]) return;
      if (ids.indexOf(id) === -1) ids.push(id);
    });
    return ids;
  }

  function cartNeedsRepair(raw, cart) {
    if (raw == null) return false;
    var data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      return true;
    }
    if (!Array.isArray(data) || data.length !== cart.length) return true;
    return data.some(function (item, index) {
      var next = cart[index];
      return Number(item && item.quantity) !== next.quantity || String(item && item.id) !== String(next.id);
    });
  }

  function wishlistNeedsRepair(raw, ids) {
    if (raw == null) return false;
    var data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      return true;
    }
    if (!Array.isArray(data) || data.length !== ids.length) return true;
    return data.some(function (value, index) { return String(value) !== String(ids[index]); });
  }

  function relatedProducts(list, product) {
    if (!product) return [];
    return list.filter(function (item) {
      return item.id !== product.id && item.category === product.category;
    });
  }

  function catalogCode(id) {
    if (typeof id === "string" && id.indexOf("-") !== -1) return "TKI-" + id.slice(0, 8).toUpperCase();
    return "TKI-" + String(id).padStart(3, "0");
  }

  function sortIds() {
    return SORT_OPTIONS.map(function (option) { return option.id; });
  }

  function parseCatalogQuery(params, knownCategories) {
    var allowed = {};
    sortIds().forEach(function (id) { allowed[id] = true; });
    var categories = {};
    (knownCategories || []).forEach(function (category) { categories[category] = true; });
    var category = params.get("kategori") || "Semua";
    var sort = params.get("urut") || "katalog";
    return {
      query: params.get("q") || "",
      category: category === "Semua" || categories[category] ? category : "Semua",
      sort: allowed[sort] ? sort : "katalog",
      minPrice: parsePriceInput(params.get("min")),
      maxPrice: parsePriceInput(params.get("maks"))
    };
  }

  function toCatalogSearch(filters) {
    var params = new URLSearchParams();
    var query = String(filters.query || "").trim();
    if (query) params.set("q", query);
    if (filters.category && filters.category !== "Semua") params.set("kategori", filters.category);
    if (filters.sort && filters.sort !== "katalog") params.set("urut", filters.sort);
    if (filters.minPrice != null) params.set("min", String(filters.minPrice));
    if (filters.maxPrice != null) params.set("maks", String(filters.maxPrice));
    var queryString = params.toString();
    return queryString ? "?" + queryString : "";
  }

  function normalizePhone(value) {
    var phone = String(value || "").replace(/[\s-]/g, "");
    if (phone.indexOf("+62") === 0) phone = "62" + phone.slice(3);
    return phone;
  }

  function validateCheckout(input) {
    var source = input || {};
    var nama = String(source.nama || "").trim();
    var whatsapp = normalizePhone(source.whatsapp);
    var alamat = String(source.alamat || "").trim();
    var errors = {};
    if (nama.length < 2 || nama.length > 80) errors.nama = "Nama minimal 2 karakter dan maksimal 80 karakter.";
    if (!/^(08\d{8,12}|628\d{8,12})$/.test(whatsapp)) {
      errors.whatsapp = "Masukkan nomor WhatsApp yang valid, misalnya 081234567890.";
    }
    if (alamat.length < 10 || alamat.length > 300) errors.alamat = "Alamat minimal 10 karakter dan maksimal 300 karakter.";
    return {
      ok: Object.keys(errors).length === 0,
      errors: errors,
      value: { nama: nama, whatsapp: whatsapp, alamat: alamat }
    };
  }

  function checkoutSummary(items) {
    return {
      items: items.map(function (item) {
        return {
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          lineTotal: item.price * item.quantity
        };
      }),
      totalQuantity: totalQuantity(items),
      totalPrice: totalPrice(items)
    };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function safeImageUrl(url) {
    if (typeof url !== "string" || url.trim() === "") return "";
    try {
      var parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
      return parsed.href;
    } catch (error) {
      return "";
    }
  }

  var CATALOG_SCHEMA = 1;
  var MAX_PRODUCTS = 200;
  var MAX_PRICE = 999999999;
  var MAX_DATA_URL_LENGTH = 500000;
  var DRAFT_EXPORT_NOTE = "Berkas pengganti catalog.json untuk Toko Kita ID. Mengunduh berkas ini tidak menayangkan perubahan. Pengunjung melihat produk baru hanya setelah berkas ini menggantikan catalog.json di repositori dan GitHub Pages selesai memperbarui.";

  function storefrontProducts(list) {
    return (list || []).filter(function (product) { return product && product.visible !== false; });
  }

  function cleanPlainText(value) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  }

  function isSafeImageDataUrl(url) {
    if (typeof url !== "string" || url.length > MAX_DATA_URL_LENGTH) return false;
    var match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url);
    if (!match || match[2].length < 32 || match[2].length % 4 !== 0) return false;
    return true;
  }

  function safeProductImage(url) {
    var httpsUrl = safeImageUrl(url);
    if (httpsUrl) return httpsUrl;
    return isSafeImageDataUrl(url) ? url : "";
  }

  function parseCatalogPrice(value) {
    var amount = value;
    if (typeof amount === "string" && /^[0-9]+$/.test(amount)) amount = Number(amount);
    if (typeof amount !== "number" || !Number.isInteger(amount)) return null;
    if (amount < 0 || amount > MAX_PRICE) return null;
    return amount;
  }

  function validateProduct(input, options) {
    var source = input || {};
    var settings = options || {};
    var errors = {};
    var id = Number(source.id);
    if (!Number.isInteger(id) || id < 1) errors.id = "Nomor produk tidak valid.";
    var taken = settings.ids || [];
    if (!errors.id && settings.allowSameId !== id && taken.indexOf(id) !== -1) errors.id = "Nomor produk sudah dipakai.";
    var name = cleanPlainText(source.name);
    if (name.length < 2 || name.length > 80 || /[<>]/.test(name)) errors.name = "Nama 2–80 karakter, tanpa tanda < atau >.";
    var price = parseCatalogPrice(source.price);
    if (price == null) errors.price = "Harga harus bilangan bulat rupiah, dari 0 sampai 999.999.999.";
    var description = cleanPlainText(source.description);
    if (description.length < 10 || description.length > 500 || /[<>]/.test(description)) {
      errors.description = "Deskripsi 10–500 karakter, tanpa tanda < atau >.";
    }
    var category = cleanPlainText(source.category);
    if (!/^[\p{L}\p{N}][\p{L}\p{N} .,&()/-]{1,39}$/u.test(category) || /[<>]/.test(category)) {
      errors.category = "Kategori 2–40 huruf atau angka, tanpa tanda < atau >.";
    }
    var image = safeProductImage(typeof source.image === "string" ? source.image.trim() : "");
    if (!image) errors.image = "Gambar harus tautan https atau berkas JPEG, PNG, atau WebP yang dipilih dari perangkat.";
    var product = {
      id: id,
      name: name,
      price: price,
      image: image,
      category: category,
      description: description,
      visible: source.visible !== false
    };
    if (source.contoh === true) product.contoh = true;
    return { ok: Object.keys(errors).length === 0, errors: errors, value: product };
  }

  function parseCatalogDocument(raw) {
    var data = raw;
    if (typeof raw === "string") {
      if (raw.length > 2000000) return { ok: false, message: "Berkas terlalu besar untuk dibaca di peramban ini.", products: [] };
      try {
        data = JSON.parse(raw);
      } catch (error) {
        return { ok: false, message: "Berkas bukan JSON yang utuh.", products: [] };
      }
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, message: "Berkas katalog harus berupa objek dengan daftar produk.", products: [] };
    }
    if (data.schema !== CATALOG_SCHEMA) {
      return { ok: false, message: "Skema katalog tidak dikenali. Unduh berkas dari halaman Kelola.", products: [] };
    }
    if (!Array.isArray(data.products)) {
      return { ok: false, message: "Daftar produk tidak ditemukan.", products: [] };
    }
    if (data.products.length > MAX_PRODUCTS) {
      return { ok: false, message: "Jumlah produk melebihi batas 200.", products: [] };
    }
    var productsOut = [];
    var ids = [];
    for (var index = 0; index < data.products.length; index += 1) {
      var checked = validateProduct(data.products[index], { ids: ids });
      if (!checked.ok) {
        var first = Object.keys(checked.errors)[0];
        return {
          ok: false,
          message: "Produk ke-" + (index + 1) + ": " + checked.errors[first],
          products: []
        };
      }
      ids.push(checked.value.id);
      productsOut.push(checked.value);
    }
    return { ok: true, message: "", products: productsOut };
  }

  function serializeCatalog(list) {
    var parsed = parseCatalogDocument({ schema: CATALOG_SCHEMA, products: list || [] });
    if (!parsed.ok) return "";
    return JSON.stringify({
      schema: CATALOG_SCHEMA,
      catatan: DRAFT_EXPORT_NOTE,
      products: parsed.products
    }, null, 2) + "\n";
  }

  function parseStoredDraft(raw) {
    if (raw == null || raw === "") return { ok: false, message: "Belum ada draf.", products: [], savedAt: "" };
    var data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      return { ok: false, message: "Draf lokal rusak dan tidak dipakai.", products: [], savedAt: "" };
    }
    if (!data || typeof data !== "object" || !Array.isArray(data.products)) {
      return { ok: false, message: "Draf lokal tidak dikenali.", products: [], savedAt: "" };
    }
    var parsed = parseCatalogDocument({ schema: CATALOG_SCHEMA, products: data.products });
    if (!parsed.ok) return { ok: false, message: parsed.message, products: [], savedAt: "" };
    return {
      ok: true,
      message: "",
      savedAt: typeof data.savedAt === "string" ? data.savedAt : "",
      products: parsed.products
    };
  }

  function serializeDraft(list, savedAt) {
    var parsed = parseCatalogDocument({ schema: CATALOG_SCHEMA, products: list || [] });
    if (!parsed.ok) return "";
    return JSON.stringify({ savedAt: savedAt || "", products: parsed.products });
  }

  function nextProductId(list) {
    return (list || []).reduce(function (max, product) {
      return product.id > max ? product.id : max;
    }, 0) + 1;
  }

  function upsertProduct(list, product) {
    var found = false;
    var next = (list || []).map(function (item) {
      if (item.id !== product.id) return item;
      found = true;
      return product;
    });
    return found ? next : next.concat([product]);
  }

  function deleteProduct(list, productId) {
    return (list || []).filter(function (product) { return product.id !== productId; });
  }

  function keputusanKatalogAkun(payload) {
    if (!payload || payload.error) return "galat";
    if (!payload.products || !payload.products.length) return "demo-kosong";
    return "akun";
  }

  return {
    MAX_QTY: MAX_QTY,
    PRICE_RANGE_ERROR: PRICE_RANGE_ERROR,
    EMPTY_RESULT_MESSAGE: EMPTY_RESULT_MESSAGE,
    SORT_OPTIONS: SORT_OPTIONS,
    products: products,
    formatRupiah: formatRupiah,
    categoriesFrom: categoriesFrom,
    createFilters: createFilters,
    parsePriceInput: parsePriceInput,
    filtersAreValid: filtersAreValid,
    filterAndSortProducts: filterAndSortProducts,
    resultHeading: resultHeading,
    resultSummary: resultSummary,
    clampQuantity: clampQuantity,
    addItem: addItem,
    changeQuantity: changeQuantity,
    removeItem: removeItem,
    totalQuantity: totalQuantity,
    totalPrice: totalPrice,
    canCheckout: canCheckout,
    toggleWishlist: toggleWishlist,
    canonicalProductId: canonicalProductId,
    parseStoredCart: parseStoredCart,
    parseStoredWishlist: parseStoredWishlist,
    cartNeedsRepair: cartNeedsRepair,
    wishlistNeedsRepair: wishlistNeedsRepair,
    relatedProducts: relatedProducts,
    catalogCode: catalogCode,
    parseCatalogQuery: parseCatalogQuery,
    toCatalogSearch: toCatalogSearch,
    validateCheckout: validateCheckout,
    checkoutSummary: checkoutSummary,
    escapeHtml: escapeHtml,
    safeImageUrl: safeImageUrl,
    CATALOG_SCHEMA: CATALOG_SCHEMA,
    DRAFT_EXPORT_NOTE: DRAFT_EXPORT_NOTE,
    MAX_DATA_URL_LENGTH: MAX_DATA_URL_LENGTH,
    storefrontProducts: storefrontProducts,
    isSafeImageDataUrl: isSafeImageDataUrl,
    safeProductImage: safeProductImage,
    validateProduct: validateProduct,
    parseCatalogDocument: parseCatalogDocument,
    serializeCatalog: serializeCatalog,
    parseStoredDraft: parseStoredDraft,
    serializeDraft: serializeDraft,
    nextProductId: nextProductId,
    upsertProduct: upsertProduct,
    deleteProduct: deleteProduct,
    keputusanKatalogAkun: keputusanKatalogAkun
  };
});
