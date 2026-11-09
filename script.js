(function () {
  "use strict";

  var catalog = window.TokoKitaCatalog;
  var grid = document.getElementById("productGrid");
  var catalogError = document.getElementById("catalogError");

  if (!catalog) {
    if (grid) {
      grid.innerHTML = "";
      grid.setAttribute("aria-busy", "false");
    }
    if (catalogError) catalogError.hidden = false;
    return;
  }

  var products = catalog.products;
  var DRAFT_KEY = "tokoKitaCatalogDraft";
  var previewDraftRequested = new URLSearchParams(window.location.search).get("pratinjau") === "draf";
  var demoRequested = new URLSearchParams(window.location.search).get("demo") === "1";
  var requestedProductId = catalog.canonicalProductId(new URLSearchParams(window.location.search).get("produk"));
  var historyMode = "replace";
  var detailPushed = false;
  var defaultTitle = document.title;

  function shopProducts() {
    return catalog.storefrontProducts(products);
  }
  var CART_KEY = "tokoKitaCart";
  var WISHLIST_KEY = "tokoKitaWishlist";
  var COMPARE_KEY = "tokoKitaBanding";
  var ACTIVE_CATEGORY = "snap-start shrink-0 rounded-full px-4 py-2 min-h-11 text-sm font-medium bg-indigo-600 text-white";
  var IDLE_CATEGORY = "snap-start shrink-0 rounded-full px-4 py-2 min-h-11 text-sm font-medium bg-indigo-50 text-indigo-800 border border-indigo-100 hover:border-indigo-400";

  var searchForm = document.getElementById("searchForm");
  var searchInput = document.getElementById("searchInput");
  var clearSearch = document.getElementById("clearSearch");
  var sortSelect = document.getElementById("sortSelect");
  var minPrice = document.getElementById("minPrice");
  var maxPrice = document.getElementById("maxPrice");
  var filterError = document.getElementById("filterError");
  var categoryFilters = document.getElementById("categoryFilters");
  var catalogHeading = document.getElementById("catalogHeading");
  var resultCount = document.getElementById("resultCount");
  var cartBtn = document.getElementById("cartBtn");
  var wishlistBtn = document.getElementById("wishlistBtn");
  var wishlistIcon = document.getElementById("wishlistIcon");
  var cartCount = document.getElementById("cartCount");
  var wishlistCount = document.getElementById("wishlistCount");
  var cartSidebar = document.getElementById("cartSidebar");
  var wishlistSidebar = document.getElementById("wishlistSidebar");
  var cartItems = document.getElementById("cartItems");
  var wishlistItems = document.getElementById("wishlistItems");
  var cartTotal = document.getElementById("cartTotal");
  var checkoutBtn = document.getElementById("checkoutBtn");
  var checkoutTotal = document.getElementById("checkoutTotal");
  var checkoutItemCount = document.getElementById("checkoutItemCount");
  var cartOverlay = document.getElementById("cartOverlay");
  var detailModal = document.getElementById("detailModal");
  var detailBody = document.getElementById("detailBody");
  var detailTitle = document.getElementById("detailTitle");
  var checkoutModal = document.getElementById("checkoutModal");
  var checkoutForm = document.getElementById("checkoutForm");
  var successModal = document.getElementById("successModal");
  var successSummary = document.getElementById("successSummary");
  var storageWarning = document.getElementById("storageWarning");
  var liveStatus = document.getElementById("liveStatus");
  var brandLink = document.getElementById("brandLink");
  var filterForm = document.getElementById("filterForm");
  var pageRegions = [
    document.getElementById("skipLink"),
    document.getElementById("siteHeader"),
    document.getElementById("hero"),
    document.getElementById("demoBanner"),
    document.getElementById("storageWarning"),
    document.getElementById("katalog"),
    document.getElementById("compareBar"),
    document.getElementById("siteFooter")
  ];
  var ACTION_NAMES = {
    "open-detail": true,
    "add-cart": true,
    "add-detail-cart": true,
    "toggle-wishlist": true,
    "qty-dec": true,
    "qty-inc": true,
    "remove-cart": true,
    "remove-wishlist": true,
    "toggle-compare": true,
    "remove-compare": true,
    "clear-compare": true,
    "set-category": true,
    "reset-filters": true,
    "shop": true
  };

  var state = {
    filters: catalog.createFilters(),
    cart: [],
    wishlist: [],
    compare: [],
    detailId: null,
    detailPhoto: 0,
    detailDismissed: false,
    catalogFailed: false,
    activeDrawer: null,
    activeModal: null,
    storageUnavailable: false,
    lastOrder: null
  };
  var lastFocus = null;

  function showCatalogFailure() {
    grid.innerHTML = "";
    grid.setAttribute("aria-busy", "false");
    catalogError.hidden = false;
  }

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      state.storageUnavailable = true;
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      state.storageUnavailable = true;
      return false;
    }
  }

  function loadCart() {
    var raw = readStorage(CART_KEY);
    var cart = catalog.parseStoredCart(raw);
    if (catalog.cartNeedsRepair(raw, cart)) writeStorage(CART_KEY, JSON.stringify(cart));
    return cart;
  }

  function loadWishlist() {
    var raw = readStorage(WISHLIST_KEY);
    var ids = catalog.parseStoredWishlist(raw, knownProductIds());
    if (catalog.wishlistNeedsRepair(raw, ids)) writeStorage(WISHLIST_KEY, JSON.stringify(ids));
    return ids;
  }

  function persistCart() {
    if (!writeStorage(CART_KEY, JSON.stringify(state.cart))) paintStorageWarning();
  }

  function persistWishlist() {
    if (!writeStorage(WISHLIST_KEY, JSON.stringify(state.wishlist))) paintStorageWarning();
  }

  function knownProductIds() {
    return products.map(function (product) { return product.id; });
  }

  function loadCompare() {
    var raw = readStorage(COMPARE_KEY);
    var ids = catalog.parseStoredCompare(raw, knownProductIds());
    if (catalog.compareNeedsRepair(raw, ids)) writeStorage(COMPARE_KEY, JSON.stringify(ids));
    return ids;
  }

  function persistCompare() {
    if (!writeStorage(COMPARE_KEY, JSON.stringify(state.compare))) paintStorageWarning();
  }

  function paintStorageWarning() {
    storageWarning.hidden = !state.storageUnavailable;
  }

  function announce(message) {
    liveStatus.textContent = "";
    window.setTimeout(function () { liveStatus.textContent = message; }, 30);
  }

  function rememberFocus() {
    lastFocus = document.activeElement;
  }

  function restoreFocus() {
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function productById(id) {
    return products.find(function (product) { return product.id === id; }) || null;
  }

  function syncUrl() {
    var next = catalog.toCatalogSearch(state.filters);
    var params = new URLSearchParams(next.charAt(0) === "?" ? next.slice(1) : next);
    if (previewDraftRequested) params.set("pratinjau", "draf");
    if (demoRequested) params.set("demo", "1");
    var detailId = state.activeModal === "detail" && state.detailId != null
      ? state.detailId
      : (!state.detailDismissed ? requestedProductId : null);
    if (detailId != null) params.set("produk", String(detailId));
    var query = params.toString();
    next = query ? "?" + query : "";
    var current = window.location.search || "";
    if (current === next) {
      historyMode = "replace";
      return;
    }
    try {
      var method = historyMode === "push" ? "pushState" : "replaceState";
      historyMode = "replace";
      window.history[method](null, "", window.location.pathname + next);
    } catch (error) {
      /* Beberapa peramban menolak replaceState saat file dibuka lewat file:// */
    }
  }

  function paintChrome() {
    var cartOpen = state.activeDrawer === "cart";
    var wishOpen = state.activeDrawer === "wishlist";
    var compareOpen = state.activeDrawer === "compare";
    var compareSidebar = document.getElementById("compareSidebar");
    cartSidebar.classList.toggle("open", cartOpen);
    wishlistSidebar.classList.toggle("open", wishOpen);
    if (compareSidebar) compareSidebar.classList.toggle("open", compareOpen);
    cartSidebar.inert = !cartOpen;
    wishlistSidebar.inert = !wishOpen;
    if (compareSidebar) compareSidebar.inert = !compareOpen;
    cartSidebar.setAttribute("aria-hidden", cartOpen ? "false" : "true");
    wishlistSidebar.setAttribute("aria-hidden", wishOpen ? "false" : "true");
    if (compareSidebar) compareSidebar.setAttribute("aria-hidden", compareOpen ? "false" : "true");
    cartOverlay.hidden = !state.activeDrawer;
    detailModal.hidden = state.activeModal !== "detail";
    checkoutModal.hidden = state.activeModal !== "checkout";
    successModal.hidden = state.activeModal !== "success";
    document.body.style.overflow = state.activeDrawer || state.activeModal ? "hidden" : "";
    cartBtn.setAttribute("aria-expanded", cartOpen ? "true" : "false");
    wishlistBtn.setAttribute("aria-expanded", wishOpen ? "true" : "false");
    var compareBtn = document.getElementById("compareBtn");
    if (compareBtn) compareBtn.setAttribute("aria-expanded", compareOpen ? "true" : "false");
    var dialogOpen = Boolean(state.activeDrawer || state.activeModal);
    pageRegions.forEach(function (region) {
      if (region) region.inert = dialogOpen;
    });
  }

  function openDrawer(name, options) {
    var opts = options || {};
    if (!opts.preserveFocusMemory && !state.activeDrawer && !state.activeModal) rememberFocus();
    state.activeDrawer = name;
    paintChrome();
    var closeId = name === "cart" ? "closeCart" : name === "compare" ? "closeCompare" : "closeWishlist";
    document.getElementById(closeId).focus();
  }

  function openModal(name, options) {
    var opts = options || {};
    if (!opts.preserveFocusMemory && !state.activeDrawer && !state.activeModal) rememberFocus();
    state.activeDrawer = null;
    state.activeModal = name;
    paintChrome();
    if (name === "checkout") document.getElementById("checkoutTitle").focus();
    if (name === "detail") detailTitle.focus();
    if (name === "success") document.getElementById("successTitle").focus();
  }

  function closeDrawer() {
    state.activeDrawer = null;
    paintChrome();
    restoreFocus();
  }

  function clearDetailRequest() {
    var shouldBack = detailPushed;
    detailPushed = false;
    state.detailId = null;
    state.detailPhoto = 0;
    requestedProductId = null;
    state.detailDismissed = true;
    document.title = defaultTitle;
    if (shouldBack) {
      window.history.back();
      return;
    }
    syncUrl();
  }

  function closeModal(name, options) {
    var opts = options || {};
    var wasDetail = name === "detail" && state.activeModal === "detail";
    if (state.activeModal === name) state.activeModal = null;
    paintChrome();
    if (wasDetail && !opts.skipUrl) clearDetailRequest();
    if (opts.restore !== false) restoreFocus();
  }

  function closeAll(options) {
    var opts = options || {};
    var wasDetail = state.activeModal === "detail";
    state.activeDrawer = null;
    state.activeModal = null;
    paintChrome();
    if (wasDetail && !opts.skipUrl) clearDetailRequest();
    if (opts.restore !== false) restoreFocus();
  }

  function imageMarkup(url, alt, className) {
    var safe = catalog.safeProductImage(url);
    if (!safe) {
      return '<div class="' + className + ' bg-gray-100 flex items-center justify-center text-sm text-gray-500 text-center px-2" role="img" aria-label="Gambar tidak tersedia">Gambar tidak tersedia</div>';
    }
    return '<img src="' + catalog.escapeHtml(safe) + '" alt="' + catalog.escapeHtml(alt) + '" class="' + className + '" decoding="async" />';
  }

  function bindImageFallbacks(root) {
    root.querySelectorAll("img").forEach(function (img) {
      img.addEventListener("error", function () {
        var note = document.createElement("div");
        note.className = img.className + " bg-gray-100 flex items-center justify-center text-xs text-gray-500 text-center px-2";
        note.setAttribute("role", "img");
        note.setAttribute("aria-label", "Gambar tidak tersedia");
        note.textContent = "Gambar tidak tersedia";
        img.replaceWith(note);
      });
    });
  }

  function captureActionFocus(container) {
    var active = document.activeElement;
    if (!active || !container.contains(active) || !ACTION_NAMES[active.dataset.action]) return null;
    var canonical = catalog.canonicalProductId(active.dataset.id);
    if (active.dataset.id && canonical == null) return null;
    return { action: active.dataset.action, id: canonical == null ? "" : String(canonical) };
  }

  function restoreActionFocus(container, token, fallback) {
    if (!token) return;
    var selector = '[data-action="' + token.action + '"]';
    if (token.id) selector += '[data-id="' + token.id + '"]';
    var next = container.querySelector(selector);
    if (next) next.focus();
    else if (fallback) fallback.focus();
  }

  function renderCategories() {
    var categories = catalog.categoriesFrom(shopProducts());
    var current = categoryFilters.querySelectorAll("[data-category]");
    var same = current.length === categories.length && categories.every(function (category, index) {
      return current[index].dataset.category === category;
    });
    if (!same) {
      categoryFilters.innerHTML = categories.map(function (category) {
        return '<button type="button" data-action="set-category" data-category="' + catalog.escapeHtml(category) + '" class="' + IDLE_CATEGORY + '" aria-pressed="false">' + catalog.escapeHtml(category) + "</button>";
      }).join("");
    }
    categoryFilters.querySelectorAll("[data-category]").forEach(function (button) {
      var selected = button.dataset.category === state.filters.category;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.className = selected ? ACTIVE_CATEGORY : IDLE_CATEGORY;
    });
  }

  function renderFilterError() {
    var validity = catalog.filtersAreValid(state.filters);
    filterError.hidden = validity.ok;
    filterError.textContent = validity.message;
    minPrice.setAttribute("aria-invalid", validity.ok ? "false" : "true");
    maxPrice.setAttribute("aria-invalid", validity.ok ? "false" : "true");
    var describedBy = validity.ok ? "priceHelp" : "priceHelp filterError";
    minPrice.setAttribute("aria-describedby", describedBy);
    maxPrice.setAttribute("aria-describedby", describedBy);
    return validity;
  }

  function cartQty(id) {
    var item = state.cart.find(function (entry) { return entry.id === id; });
    return item ? item.quantity : 0;
  }

  function renderProducts() {
    var restore = captureActionFocus(grid);
    var validity = renderFilterError();
    clearSearch.hidden = state.filters.query.length === 0;
    catalogHeading.textContent = catalog.resultHeading(state.filters);
    if (!validity.ok) {
      grid.innerHTML = "";
      grid.setAttribute("aria-busy", "false");
      resultCount.textContent = "Filter harga belum berlaku";
      return;
    }
    var visible = catalog.filterAndSortProducts(shopProducts(), state.filters);
    resultCount.textContent = catalog.resultSummary(visible.length, shopProducts().length);
    if (visible.length === 0) {
      grid.innerHTML = '<div class="col-span-full text-center bg-white rounded-xl border border-dashed border-gray-300 px-6 py-12" role="status"><p class="text-lg font-medium mb-2">Tidak ada produk yang cocok</p><p class="text-gray-600 mb-4">' + catalog.escapeHtml(catalog.EMPTY_RESULT_MESSAGE) + '</p><button type="button" data-action="reset-filters" class="min-h-11 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium">Atur ulang filter</button></div>';
      grid.setAttribute("aria-busy", "false");
      return;
    }
    grid.innerHTML = visible.map(function (product) {
      var saved = state.wishlist.indexOf(product.id) !== -1;
      var compared = state.compare.indexOf(product.id) !== -1;
      var inCart = cartQty(product.id);
      var cartNote = inCart > 0 ? '<p class="text-sm font-medium text-indigo-700">Sudah di keranjang: ' + inCart + "</p>" : "";
      return '<article class="product-card relative bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col' + (compared ? " is-compared" : "") + '" data-product-id="' + product.id + '">' +
        '<button type="button" data-action="open-detail" data-id="' + product.id + '" class="absolute inset-0 z-0 rounded-2xl" aria-label="Lihat detail ' + catalog.escapeHtml(product.name) + '"></button>' +
        '<div class="relative z-10 pointer-events-none">' +
          '<div class="relative aspect-[4/3] bg-indigo-50">' +
            imageMarkup(product.image, "", "w-full h-full object-cover") +
          "</div>" +
          '<div class="p-4 flex flex-col gap-2">' +
            '<p class="self-start rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">' + catalog.escapeHtml(product.category) + "</p>" +
            '<h3 class="font-semibold text-base leading-snug text-gray-900">' + catalog.escapeHtml(product.name) + "</h3>" +
            '<p class="text-gray-600 text-sm leading-relaxed line-clamp-2">' + catalog.escapeHtml(product.description) + "</p>" +
            '<p class="text-indigo-800 font-bold text-lg tabular-nums">' + catalog.formatRupiah(product.price) + "</p>" +
            '<p class="text-sm text-gray-600">' + catalog.escapeHtml(catalog.availabilityLabel(product)) + "</p>" +
            cartNote +
          "</div>" +
        "</div>" +
        '<div class="relative z-10 px-4 pb-4 mt-auto grid grid-cols-2 gap-2">' +
          '<button type="button" data-action="toggle-wishlist" data-id="' + product.id + '" class="min-h-11 rounded-xl border px-2 py-2 text-sm font-medium ' + (saved ? "border-rose-200 bg-rose-50 text-rose-700" : "border-gray-200 bg-white text-gray-700") + '" aria-pressed="' + (saved ? "true" : "false") + '" aria-label="' + (saved ? "Hapus " : "Simpan ") + catalog.escapeHtml(product.name) + (saved ? " dari favorit" : " ke favorit") + '">' + (saved ? "Favorit" : "Simpan") + "</button>" +
          '<button type="button" data-action="toggle-compare" data-id="' + product.id + '" class="min-h-11 rounded-xl border px-2 py-2 text-sm font-medium ' + (compared ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-gray-200 bg-white text-gray-700") + '" aria-pressed="' + (compared ? "true" : "false") + '" aria-label="' + (compared ? "Keluarkan " : "Bandingkan ") + catalog.escapeHtml(product.name) + '">' + (compared ? "Dipilih" : "Bandingkan") + "</button>" +
          '<button type="button" data-action="add-cart" data-id="' + product.id + '" class="col-span-2 min-h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 text-sm font-medium" aria-label="Tambah ' + catalog.escapeHtml(product.name) + ' ke keranjang">Tambah ke keranjang</button>' +
        "</div>" +
      "</article>";
    }).join("");
    grid.setAttribute("aria-busy", "false");
    bindImageFallbacks(grid);
    restoreActionFocus(grid, restore);
  }

  function renderBadges() {
    var items = catalog.totalQuantity(state.cart);
    cartCount.textContent = String(items);
    cartCount.hidden = items === 0;
    cartBtn.setAttribute("aria-label", items > 0 ? "Buka keranjang, " + items + " barang" : "Buka keranjang");
    var saved = state.wishlist.length;
    wishlistCount.textContent = String(saved);
    wishlistCount.hidden = saved === 0;
    wishlistBtn.setAttribute("aria-label", saved > 0 ? "Buka favorit, " + saved + " produk" : "Buka favorit");
    var compareCount = document.getElementById("compareCount");
    var compareIcon = document.getElementById("compareIcon");
    var compareBtn = document.getElementById("compareBtn");
    var compared = state.compare.length;
    if (compareCount && compareBtn) {
      compareCount.textContent = String(compared);
      compareCount.hidden = compared === 0;
      compareBtn.setAttribute("aria-label", compared > 0 ? "Buka perbandingan, " + compared + " dari 3 produk" : "Buka perbandingan");
      if (compareIcon) compareIcon.className = "fas fa-columns text-xl " + (compared > 0 ? "text-indigo-700" : "text-gray-700");
    }
    var compareBar = document.getElementById("compareBar");
    var compareBarText = document.getElementById("compareBarText");
    if (compareBar && compareBarText) {
      compareBar.hidden = compared === 0;
      compareBarText.textContent = compared + " dari 3 produk untuk dibandingkan";
      document.body.classList.toggle("has-compare", compared > 0);
    }
    wishlistIcon.className = (saved > 0 ? "fas" : "far") + " fa-heart text-xl " + (saved > 0 ? "text-rose-600" : "text-gray-700");
  }

  function renderCart() {
    var restore = captureActionFocus(cartItems);
    var total = catalog.totalPrice(state.cart);
    var count = catalog.totalQuantity(state.cart);
    cartTotal.textContent = catalog.formatRupiah(total);
    checkoutTotal.textContent = catalog.formatRupiah(total);
    checkoutItemCount.textContent = count + " barang";
    checkoutBtn.disabled = !catalog.canCheckout(state.cart);
    if (state.cart.length === 0) {
      cartItems.innerHTML = '<div class="text-center py-12 text-gray-500" role="status"><i class="fas fa-shopping-basket text-5xl mb-4" aria-hidden="true"></i><p class="mb-4">Keranjang masih kosong</p><button type="button" data-action="shop" class="min-h-11 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium">Lihat produk</button></div>';
      renderBadges();
      restoreActionFocus(cartItems, restore, document.getElementById("closeCart"));
      return;
    }
    cartItems.innerHTML = state.cart.map(function (item) {
      var plusDisabled = item.quantity >= catalog.MAX_QTY ? " disabled" : "";
      return '<div class="flex gap-4 border-b pb-4">' +
        imageMarkup(item.image, item.name, "w-20 h-20 object-cover rounded-lg shrink-0") +
        '<div class="flex-1 min-w-0">' +
          '<h3 class="font-medium">' + catalog.escapeHtml(item.name) + "</h3>" +
          '<p class="text-indigo-700 font-semibold text-sm">' + catalog.formatRupiah(item.price) + "</p>" +
          '<div class="flex items-center gap-3 mt-2">' +
            '<div class="inline-flex items-center overflow-hidden rounded-full border border-gray-200">' +
              '<button type="button" data-action="qty-dec" data-id="' + item.id + '" class="w-12 h-12 text-lg bg-gray-50 hover:bg-gray-200" aria-label="Kurangi jumlah ' + catalog.escapeHtml(item.name) + '">−</button>' +
              '<span class="font-medium w-10 text-center" aria-live="polite">' + item.quantity + "</span>" +
              '<button type="button" data-action="qty-inc" data-id="' + item.id + '" class="w-12 h-12 text-lg bg-gray-50 hover:bg-gray-200" aria-label="Tambah jumlah ' + catalog.escapeHtml(item.name) + '"' + plusDisabled + ">+</button>" +
            "</div>" +
            '<button type="button" data-action="remove-cart" data-id="' + item.id + '" class="ml-auto min-h-12 px-3 text-red-600 hover:text-red-800 font-medium" aria-label="Hapus ' + catalog.escapeHtml(item.name) + ' dari keranjang">Hapus</button>' +
          "</div>" +
        "</div>" +
      "</div>";
    }).join("");
    bindImageFallbacks(cartItems);
    renderBadges();
    restoreActionFocus(cartItems, restore, document.getElementById("closeCart"));
  }

  function renderWishlist() {
    var restore = captureActionFocus(wishlistItems);
    if (state.wishlist.length === 0) {
      wishlistItems.innerHTML = '<div class="text-center py-12 text-gray-500" role="status"><i class="far fa-heart text-5xl mb-4" aria-hidden="true"></i><p class="mb-2 font-medium text-gray-800">Belum ada favorit</p><p class="mb-4 text-sm">Simpan produk dari katalog. Daftar ini tetap di peramban ini.</p><button type="button" data-action="shop" class="min-h-11 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium">Lihat produk</button></div>';
      renderBadges();
      restoreActionFocus(wishlistItems, restore, document.getElementById("closeWishlist"));
      return;
    }
    wishlistItems.innerHTML = state.wishlist.map(function (id) {
      var product = productById(id);
      if (!product) return "";
      var compared = state.compare.indexOf(product.id) !== -1;
      return '<article class="rounded-2xl border border-gray-200 bg-white p-3">' +
        '<div class="flex gap-3">' +
          imageMarkup(product.image, product.name, "w-16 h-16 object-cover rounded-xl shrink-0") +
          '<div class="min-w-0">' +
            '<h3 class="font-semibold leading-snug">' + catalog.escapeHtml(product.name) + "</h3>" +
            '<p class="text-sm text-gray-600">' + catalog.escapeHtml(product.category) + (product.visible === false ? " · Disembunyikan dari etalase" : "") + "</p>" +
            '<p class="text-indigo-800 font-bold tabular-nums">' + catalog.formatRupiah(product.price) + "</p>" +
          "</div>" +
        "</div>" +
        '<div class="mt-3 grid grid-cols-2 gap-2">' +
          '<button type="button" data-action="open-detail" data-id="' + product.id + '" class="min-h-11 px-3 rounded-xl border border-gray-200 text-sm font-medium">Detail</button>' +
          '<button type="button" data-action="toggle-compare" data-id="' + product.id + '" class="min-h-11 px-3 rounded-xl border text-sm font-medium ' + (compared ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-gray-200") + '" aria-pressed="' + (compared ? "true" : "false") + '">' + (compared ? "Dipilih" : "Bandingkan") + "</button>" +
          '<button type="button" data-action="add-cart" data-id="' + product.id + '" class="col-span-2 min-h-11 px-3 rounded-xl bg-indigo-600 text-white text-sm font-medium">Tambah ke keranjang</button>' +
          '<button type="button" data-action="remove-wishlist" data-id="' + product.id + '" class="col-span-2 min-h-11 px-3 rounded-xl border border-rose-200 text-rose-700 text-sm font-medium">Hapus dari favorit</button>' +
        "</div>" +
      "</article>";
    }).join("");
    bindImageFallbacks(wishlistItems);
    renderBadges();
    restoreActionFocus(wishlistItems, restore, document.getElementById("closeWishlist"));
  }

  function compareField(label, value) {
    return '<div class="border-b border-gray-100 py-2"><dt class="text-xs font-medium uppercase tracking-wide text-gray-500">' + label + '</dt><dd class="mt-1 text-sm text-gray-900">' + catalog.escapeHtml(value) + "</dd></div>";
  }

  function renderCompare() {
    var root = document.getElementById("compareItems");
    if (!root) return;
    var restore = captureActionFocus(root);
    if (state.compare.length === 0) {
      root.innerHTML = '<div class="text-center py-12 text-gray-500" role="status"><p class="mb-2 font-medium text-gray-800">Belum ada produk dibandingkan</p><p class="mb-4 text-sm">Pilih paling banyak 3 produk dari katalog. Jika produk sudah tidak ada, identitasnya dibuang.</p><button type="button" data-action="shop" class="min-h-11 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium">Lihat produk</button></div>';
      renderBadges();
      restoreActionFocus(root, restore, document.getElementById("closeCompare"));
      return;
    }
    root.innerHTML = '<div class="grid gap-4 md:grid-cols-3">' + state.compare.map(function (id) {
      var product = productById(id);
      var name = product ? product.name : "Tidak ada di katalog";
      var price = product ? catalog.formatRupiah(product.price) : "—";
      var category = product && product.category ? product.category : "—";
      var description = product && product.description ? product.description : "Deskripsi tidak diisi.";
      var picture = product ? '<div class="aspect-[4/3] bg-indigo-50">' + imageMarkup(product.image, "", "w-full h-full object-cover") + "</div>" : "";
      return '<article class="rounded-2xl border border-indigo-100 bg-white overflow-hidden flex flex-col">' +
        picture +
        '<div class="p-4 flex flex-col gap-2 flex-1">' +
          '<h3 class="font-semibold text-base leading-snug">' + catalog.escapeHtml(name) + "</h3>" +
          '<p class="text-lg font-bold tabular-nums text-indigo-800">' + catalog.escapeHtml(price) + "</p>" +
          '<dl>' +
            compareField("Kategori", category) +
            compareField("Deskripsi", description) +
            compareField("Ketersediaan", catalog.availabilityLabel(product)) +
          "</dl>" +
          (product ? '<button type="button" data-action="remove-compare" data-id="' + product.id + '" class="mt-auto min-h-11 px-3 rounded-xl border border-gray-200 text-sm font-medium">Keluarkan</button>' : "") +
        "</div>" +
      "</article>";
    }).join("") + "</div>";
    bindImageFallbacks(root);
    renderBadges();
    restoreActionFocus(root, restore, document.getElementById("closeCompare"));
  }

  function detailStatus(message) {
    detailTitle.textContent = "Detail produk";
    document.title = defaultTitle;
    detailBody.innerHTML = '<p role="status" class="text-gray-700">' + catalog.escapeHtml(message) + '</p><button type="button" data-action="shop" class="mt-4 min-h-11 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-medium">Kembali ke etalase</button>';
  }

  function galleryMarkup(view) {
    var photos = view.gallery;
    if (!photos.length) {
      return '<div class="aspect-[4/3] bg-indigo-50 rounded-2xl flex items-center justify-center text-sm text-gray-600 px-4 text-center" role="img" aria-label="Gambar tidak tersedia">Gambar tidak tersedia</div>';
    }
    var index = state.detailPhoto;
    if (index < 0 || index >= photos.length) index = 0;
    state.detailPhoto = index;
    var several = photos.length > 1;
    var label = view.name + (several ? ", foto " + (index + 1) + " dari " + photos.length : "");
    var controls = "";
    if (several) {
      controls = '<div class="mt-3 flex items-center gap-2">' +
        '<button type="button" data-action="gallery-prev" class="min-h-11 min-w-11 rounded-xl border border-gray-200 bg-white font-medium" aria-label="Foto sebelumnya">Sebelumnya</button>' +
        '<button type="button" data-action="gallery-next" class="min-h-11 min-w-11 rounded-xl border border-gray-200 bg-white font-medium" aria-label="Foto berikutnya">Berikutnya</button>' +
        '<p class="text-sm text-gray-600" aria-live="polite">Foto ' + (index + 1) + " dari " + photos.length + "</p>" +
      "</div>" +
      '<div class="gallery-thumbs mt-3 flex gap-2 overflow-x-auto" role="group" aria-label="Pilih foto">' +
        photos.map(function (url, photoIndex) {
          var current = photoIndex === index;
          return '<button type="button" data-action="gallery-go" data-index="' + photoIndex + '" class="shrink-0 h-16 w-16 rounded-xl overflow-hidden border ' + (current ? "border-indigo-600 ring-2 ring-indigo-200" : "border-gray-200") + '" aria-label="Tampilkan foto ' + (photoIndex + 1) + " dari " + photos.length + '" aria-current="' + (current ? "true" : "false") + '">' +
            imageMarkup(url, "", "h-16 w-16 object-cover") +
          "</button>";
        }).join("") +
      "</div>";
    }
    return '<div id="productGallery" class="min-w-0" role="region" aria-label="Galeri foto" tabindex="0">' +
      '<div class="aspect-[4/3] bg-indigo-50 rounded-2xl overflow-hidden">' +
        imageMarkup(photos[index], label, "w-full h-full object-cover") +
      "</div>" +
      controls +
    "</div>";
  }

  function shareMarkup(view) {
    var share = catalog.whatsappShareUrl(view.name, view.permalink);
    if (!share) return "";
    return '<div class="mt-5 space-y-2">' +
      '<a href="' + catalog.escapeHtml(share) + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center min-h-11 w-full rounded-xl bg-green-700 px-4 font-medium text-white">Bagikan lewat WhatsApp</a>' +
      '<div class="flex gap-2">' +
        '<label for="detailPermalink" class="sr-only">Tautan produk</label>' +
        '<input id="detailPermalink" readonly value="' + catalog.escapeHtml(view.permalink) + '" class="min-w-0 flex-1 min-h-11 rounded-xl border border-gray-300 px-3 text-sm">' +
        '<button type="button" data-action="copy-link" class="shrink-0 min-h-11 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-sm font-medium text-indigo-800">Salin tautan</button>' +
      "</div>" +
      '<p class="text-sm text-gray-600">WhatsApp hanya membuka pesan untuk Anda kirim sendiri. Tidak ada nomor penerima yang dikumpulkan.</p>' +
    "</div>";
  }

  function renderDetail() {
    var product = productById(state.detailId);
    var view = catalog.publicDetail(product, {
      id: state.detailId,
      demo: demoRequested,
      catalogError: state.catalogFailed
    });
    if (view.status === "galat") {
      detailStatus("Katalog tidak dapat dimuat. Detail produk tidak ditampilkan, dan mode demo tidak dipakai otomatis.");
      return;
    }
    if (view.status === "tidak-sah" || view.status === "tidak-ada") {
      detailStatus("Produk tidak ditemukan di katalog yang sedang dimuat.");
      return;
    }
    if (view.status !== "tayang") {
      detailStatus("Produk ini tidak ditampilkan.");
      return;
    }
    var saved = state.wishlist.indexOf(view.id) !== -1;
    var compared = state.compare.indexOf(view.id) !== -1;
    var currentDetail = detailBody.querySelector("[data-detail-id]");
    var keepQty = currentDetail && String(currentDetail.getAttribute("data-detail-id")) === String(view.id)
      ? catalog.clampQuantity((document.getElementById("detailQty") || {}).value)
      : 1;
    var related = catalog.relatedProducts(shopProducts(), product);
    var relatedHtml = related.length === 0 ? "" : '<section class="mt-8"><h3 class="font-semibold mb-3">Produk lain di kategori ' + catalog.escapeHtml(view.category) + '</h3><ul class="grid gap-2">' + related.map(function (item) {
      return '<li><button type="button" data-action="open-detail" data-id="' + item.id + '" class="w-full text-left min-h-11 rounded-xl border border-gray-200 px-3 py-2 hover:border-indigo-400"><span class="font-medium">' + catalog.escapeHtml(item.name) + '</span><span class="block text-sm text-indigo-700">' + catalog.formatRupiah(item.price) + "</span></button></li>";
    }).join("") + "</ul></section>";
    detailTitle.textContent = view.name;
    document.title = view.name + " — Toko Kita ID";
    detailBody.innerHTML = '<div data-detail-id="' + catalog.escapeHtml(view.id) + '" class="grid md:grid-cols-2 gap-6">' +
      galleryMarkup(view) +
      '<div class="min-w-0">' +
        '<button type="button" data-action="set-category" data-category="' + catalog.escapeHtml(view.category) + '" class="text-sm font-semibold uppercase tracking-wide text-indigo-700">' + catalog.escapeHtml(view.category) + "</button>" +
        '<p class="text-2xl font-bold tabular-nums text-indigo-800 mt-2">' + (view.price == null ? "Harga tidak tercatat" : catalog.formatRupiah(view.price)) + "</p>" +
        '<p class="mt-2 text-sm text-gray-700">' + catalog.escapeHtml(view.availability) + "</p>" +
        '<dl class="mt-4 space-y-3 text-sm">' +
          '<div class="border-b border-gray-100 pb-2"><dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Kode katalog</dt><dd class="mt-1 font-medium">' + catalog.escapeHtml(catalog.catalogCode(view.id)) + "</dd></div>" +
          '<div><dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Deskripsi</dt><dd class="mt-1 text-gray-800 leading-relaxed">' + catalog.escapeHtml(view.description) + "</dd></div>" +
        "</dl>" +
        '<p class="mt-4 text-sm text-gray-600">Yang ditampilkan hanya data katalog yang ada. Tidak ada ulasan, angka penjualan, atau potongan harga.</p>' +
        '<div class="mt-5 flex items-end gap-3">' +
          '<div><label for="detailQty" class="block text-sm font-medium mb-1">Jumlah</label><input id="detailQty" type="number" min="1" max="' + catalog.MAX_QTY + '" value="' + keepQty + '" inputmode="numeric" class="w-24 border border-gray-300 rounded-xl px-3 py-2.5 text-base" /></div>' +
          '<button type="button" data-action="add-detail-cart" data-id="' + view.id + '" class="flex-1 min-h-11 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium px-4">Tambah ke keranjang</button>' +
        "</div>" +
        '<div class="mt-3 grid grid-cols-2 gap-2">' +
          '<button type="button" data-action="toggle-wishlist" data-id="' + view.id + '" class="min-h-11 rounded-xl border font-medium ' + (saved ? "border-rose-200 bg-rose-50 text-rose-700" : "border-gray-200") + '" aria-pressed="' + (saved ? "true" : "false") + '">' + (saved ? "Favorit" : "Simpan") + "</button>" +
          '<button type="button" data-action="toggle-compare" data-id="' + view.id + '" class="min-h-11 rounded-xl border font-medium ' + (compared ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-gray-200") + '" aria-pressed="' + (compared ? "true" : "false") + '">' + (compared ? "Dipilih" : "Bandingkan") + "</button>" +
        "</div>" +
        shareMarkup(view) +
      "</div>" +
    "</div>" + relatedHtml;
    bindImageFallbacks(detailBody);
  }

  function showDetail(id, push) {
    if (String(state.detailId) !== String(id)) state.detailPhoto = 0;
    state.detailId = id;
    requestedProductId = id;
    state.detailDismissed = false;
    renderDetail();
    if (state.activeModal !== "detail") openModal("detail", { preserveFocusMemory: Boolean(state.activeDrawer || state.activeModal) });
    else detailTitle.focus();
    var before = window.location.search || "";
    if (push) historyMode = "push";
    syncUrl();
    if (push && (window.location.search || "") !== before) detailPushed = true;
  }

  function stepGallery(delta) {
    var product = productById(state.detailId);
    var photos = catalog.productGallery(product);
    if (photos.length < 2) return;
    var next = state.detailPhoto + delta;
    state.detailPhoto = (next + photos.length) % photos.length;
    renderDetail();
    var control = detailBody.querySelector(delta < 0 ? '[data-action="gallery-prev"]' : '[data-action="gallery-next"]');
    if (control) control.focus();
  }

  function copyDetailLink() {
    var input = document.getElementById("detailPermalink");
    var value = input ? input.value : "";
    function ready(copied) {
      if (input) input.focus();
      if (input && input.select) input.select();
      announce(copied ? "Tautan produk disalin." : "Tautan produk siap disalin.");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () { ready(true); }, function () { ready(false); });
      return;
    }
    ready(false);
  }

  function renderSuccess() {
    var order = state.lastOrder;
    if (!order) {
      successSummary.innerHTML = "";
      return;
    }
    successSummary.innerHTML = '<p class="font-medium mb-2">Atas nama ' + catalog.escapeHtml(order.buyer.nama) + "</p>" +
      "<ul class=\"space-y-1 mb-3\">" + order.items.map(function (item) {
        return "<li>" + catalog.escapeHtml(item.name) + " × " + item.quantity + " — " + catalog.formatRupiah(item.lineTotal) + "</li>";
      }).join("") + "</ul>" +
      '<p class="font-semibold">Total ' + catalog.formatRupiah(order.totalPrice) + "</p>";
  }

  function publishFilters() {
    syncUrl();
    renderCategories();
    renderProducts();
  }

  function resetFilters() {
    state.filters = catalog.createFilters();
    searchInput.value = "";
    sortSelect.value = "katalog";
    minPrice.value = "";
    maxPrice.value = "";
    publishFilters();
  }

  function addProductToCart(id, quantity, options) {
    var opts = options || {};
    var product = productById(id);
    if (!product) return;
    var before = cartQty(id);
    state.cart = catalog.addItem(state.cart, product, quantity);
    var after = cartQty(id);
    persistCart();
    renderCart();
    renderProducts();
    if (state.activeModal === "detail") renderDetail();
    if (after === before && before >= catalog.MAX_QTY) announce("Jumlah maksimal " + catalog.MAX_QTY + " untuk " + product.name + " sudah tercapai.");
    else announce(product.name + " ada di keranjang, jumlah " + after + ".");
    if (opts.openCartAfter !== false) {
      var keepFocus = Boolean(state.activeDrawer || state.activeModal);
      if (state.activeModal === "detail") closeModal("detail", { restore: false });
      openDrawer("cart", { preserveFocusMemory: keepFocus });
    }
  }

  function toggleProductWishlist(id) {
    var product = productById(id);
    if (!product) return;
    var saved = state.wishlist.indexOf(id) !== -1;
    var detailFocused = detailBody.contains(document.activeElement);
    state.wishlist = catalog.toggleWishlist(state.wishlist, id);
    persistWishlist();
    renderWishlist();
    renderProducts();
    if (state.detailId === id && state.activeModal === "detail") {
      renderDetail();
      if (detailFocused) {
        var wishButton = detailBody.querySelector('[data-action="toggle-wishlist"]');
        if (wishButton) wishButton.focus();
      }
    }
    announce(saved ? product.name + " dihapus dari favorit." : product.name + " disimpan ke favorit di peramban ini.");
  }

  function toggleProductCompare(id) {
    var product = productById(id);
    if (!product) return;
    var detailFocused = detailBody.contains(document.activeElement);
    var result = catalog.toggleCompare(state.compare, id);
    state.compare = result.ids;
    persistCompare();
    renderCompare();
    renderProducts();
    renderWishlist();
    if (state.detailId === id && state.activeModal === "detail") {
      renderDetail();
      if (detailFocused) {
        var button = detailBody.querySelector('[data-action="toggle-compare"]');
        if (button) button.focus();
      }
    }
    if (result.status === "limit") announce("Perbandingan paling banyak 3 produk. Keluarkan satu untuk menambah yang lain.");
    else if (result.status === "added") announce(product.name + " masuk perbandingan.");
    else if (result.status === "removed") announce(product.name + " dikeluarkan dari perbandingan.");
  }

  function showFieldError(field, message) {
    var error = document.getElementById(field + "Error");
    var input = document.getElementById(field);
    if (!error || !input) return;
    error.hidden = !message;
    error.textContent = message || "";
    input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function clearCheckoutErrors() {
    ["nama", "whatsapp", "alamat"].forEach(function (field) { showFieldError(field, ""); });
  }

  function onCheckoutSubmit(event) {
    event.preventDefault();
    if (!catalog.canCheckout(state.cart)) return;
    var result = catalog.validateCheckout({
      nama: document.getElementById("nama").value,
      whatsapp: document.getElementById("whatsapp").value,
      alamat: document.getElementById("alamat").value
    });
    clearCheckoutErrors();
    if (!result.ok) {
      Object.keys(result.errors).forEach(function (field) { showFieldError(field, result.errors[field]); });
      var first = Object.keys(result.errors)[0];
      document.getElementById(first).focus();
      return;
    }
    state.lastOrder = Object.assign({ buyer: result.value }, catalog.checkoutSummary(state.cart));
    state.cart = [];
    persistCart();
    checkoutForm.reset();
    renderCart();
    renderProducts();
    renderSuccess();
    openModal("success", { preserveFocusMemory: true });
    announce("Pesanan demo tercatat di peramban ini.");
  }

  function handleAction(actionEl) {
    var action = actionEl.dataset.action;
    var id = catalog.canonicalProductId(actionEl.dataset.id);
    var needsId = action === "open-detail" || action === "add-cart" || action === "add-detail-cart" || action === "toggle-wishlist" || action === "toggle-compare" || action === "qty-dec" || action === "qty-inc" || action === "remove-cart" || action === "remove-wishlist" || action === "remove-compare";
    if (needsId && id == null) return;
    if (action === "open-detail") {
      showDetail(id, true);
      detailModal.scrollTop = 0;
      return;
    }
    if (action === "gallery-prev") {
      stepGallery(-1);
      return;
    }
    if (action === "gallery-next") {
      stepGallery(1);
      return;
    }
    if (action === "gallery-go") {
      var photoIndex = Number(actionEl.dataset.index);
      var count = catalog.productGallery(productById(state.detailId)).length;
      if (!Number.isInteger(photoIndex) || photoIndex < 0 || photoIndex >= count) return;
      state.detailPhoto = photoIndex;
      renderDetail();
      var thumb = detailBody.querySelector('[data-action="gallery-go"][data-index="' + photoIndex + '"]');
      if (thumb) thumb.focus();
      return;
    }
    if (action === "copy-link") {
      copyDetailLink();
      return;
    }
    if (action === "add-cart") {
      addProductToCart(id, 1);
      return;
    }
    if (action === "add-detail-cart") {
      var qtyInput = document.getElementById("detailQty");
      addProductToCart(id, qtyInput ? qtyInput.value : 1);
      return;
    }
    if (action === "toggle-wishlist") {
      toggleProductWishlist(id);
      return;
    }
    if (action === "toggle-compare" || action === "remove-compare") {
      toggleProductCompare(id);
      return;
    }
    if (action === "clear-compare") {
      state.compare = [];
      persistCompare();
      renderCompare();
      renderProducts();
      renderWishlist();
      if (state.activeModal === "detail") renderDetail();
      announce("Perbandingan dikosongkan.");
      return;
    }
    if (action === "qty-dec") {
      state.cart = catalog.changeQuantity(state.cart, id, -1);
      persistCart();
      renderCart();
      renderProducts();
      return;
    }
    if (action === "qty-inc") {
      state.cart = catalog.changeQuantity(state.cart, id, 1);
      persistCart();
      renderCart();
      renderProducts();
      return;
    }
    if (action === "remove-cart") {
      var removed = productById(id);
      state.cart = catalog.removeItem(state.cart, id);
      persistCart();
      renderCart();
      renderProducts();
      announce((removed ? removed.name : "Produk") + " dihapus dari keranjang.");
      return;
    }
    if (action === "remove-wishlist") {
      toggleProductWishlist(id);
      return;
    }
    if (action === "set-category") {
      state.filters.category = actionEl.dataset.category || "Semua";
      var fromDetail = Boolean(actionEl.closest("#detailModal"));
      if (fromDetail) closeModal("detail", { restore: false });
      publishFilters();
      if (fromDetail) catalogHeading.focus();
      return;
    }
    if (action === "reset-filters") {
      resetFilters();
      searchInput.focus();
      return;
    }
    if (action === "shop") {
      closeAll({ restore: false });
      searchInput.focus();
    }
  }

  function applyInitialFilters() {
    state.filters = catalog.parseCatalogQuery(new URLSearchParams(window.location.search), catalog.categoriesFrom(shopProducts()));
    searchInput.value = state.filters.query;
    sortSelect.value = state.filters.sort;
    minPrice.value = state.filters.minPrice == null ? "" : String(state.filters.minPrice);
    maxPrice.value = state.filters.maxPrice == null ? "" : String(state.filters.maxPrice);
  }

  function init() {
    state.cart = loadCart();
    state.wishlist = loadWishlist();
    state.compare = loadCompare();
    applyInitialFilters();
    paintStorageWarning();
    paintChrome();
    publishFilters();
    renderCart();
    renderWishlist();
    renderCompare();

    searchInput.addEventListener("input", function () {
      state.filters.query = searchInput.value;
      publishFilters();
    });
    searchForm.addEventListener("submit", function (event) {
      event.preventDefault();
      state.filters.query = searchInput.value;
      publishFilters();
      catalogHeading.focus();
    });
    clearSearch.addEventListener("click", function () {
      searchInput.value = "";
      state.filters.query = "";
      publishFilters();
      searchInput.focus();
    });
    sortSelect.addEventListener("change", function () {
      state.filters.sort = sortSelect.value;
      publishFilters();
    });
    minPrice.addEventListener("input", function () {
      state.filters.minPrice = catalog.parsePriceInput(minPrice.value);
      publishFilters();
    });
    maxPrice.addEventListener("input", function () {
      state.filters.maxPrice = catalog.parsePriceInput(maxPrice.value);
      publishFilters();
    });
    document.getElementById("resetFilters").addEventListener("click", function () {
      resetFilters();
      searchInput.focus();
    });
    filterForm.addEventListener("submit", function (event) {
      event.preventDefault();
      catalogHeading.focus();
    });
    brandLink.addEventListener("click", function (event) {
      event.preventDefault();
      resetFilters();
      closeAll({ restore: false });
      var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      searchInput.focus();
    });
    cartBtn.addEventListener("click", function () { openDrawer("cart"); });
    wishlistBtn.addEventListener("click", function () { openDrawer("wishlist"); });
    document.getElementById("compareBtn").addEventListener("click", function () { openDrawer("compare"); });
    document.getElementById("openCompare").addEventListener("click", function () { openDrawer("compare"); });
    document.getElementById("closeCompare").addEventListener("click", closeDrawer);
    document.getElementById("closeCart").addEventListener("click", closeDrawer);
    document.getElementById("closeWishlist").addEventListener("click", closeDrawer);
    cartOverlay.addEventListener("click", closeDrawer);
    document.getElementById("closeDetail").addEventListener("click", function () { closeModal("detail"); });
    window.addEventListener("popstate", function () {
      detailPushed = false;
      var id = catalog.canonicalProductId(new URLSearchParams(window.location.search).get("produk"));
      if (id == null) {
        state.detailId = null;
        requestedProductId = null;
        state.detailDismissed = true;
        document.title = defaultTitle;
        if (state.activeModal === "detail") closeModal("detail", { restore: false, skipUrl: true });
        return;
      }
      requestedProductId = id;
      state.detailDismissed = false;
      state.detailId = id;
      state.detailPhoto = 0;
      renderDetail();
      if (state.activeModal !== "detail") openModal("detail", { preserveFocusMemory: true });
    });
    detailModal.addEventListener("click", function (event) {
      if (event.target === detailModal) closeModal("detail");
    });
    checkoutBtn.addEventListener("click", function () {
      if (!catalog.canCheckout(state.cart)) return;
      clearCheckoutErrors();
      openModal("checkout", { preserveFocusMemory: true });
    });
    document.getElementById("closeCheckout").addEventListener("click", function () { closeModal("checkout"); });
    checkoutModal.addEventListener("click", function (event) {
      if (event.target === checkoutModal) closeModal("checkout");
    });
    checkoutForm.addEventListener("submit", onCheckoutSubmit);
    document.getElementById("closeSuccess").addEventListener("click", function () { closeModal("success"); });
    var skipQtyClick = false;
    document.addEventListener("pointerdown", function (event) {
      var actionEl = event.target.closest("[data-action]");
      if (!actionEl || actionEl.disabled) return;
      if (actionEl.dataset.action !== "qty-inc" && actionEl.dataset.action !== "qty-dec") return;
      event.preventDefault();
      skipQtyClick = true;
      handleAction(actionEl);
    });
    document.addEventListener("pointerup", function () {
      window.setTimeout(function () { skipQtyClick = false; }, 0);
    });
    document.addEventListener("click", function (event) {
      var actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      if (skipQtyClick && (actionEl.dataset.action === "qty-inc" || actionEl.dataset.action === "qty-dec")) return;
      handleAction(actionEl);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (state.activeModal === "success") closeModal("success");
        else if (state.activeModal === "checkout") closeModal("checkout");
        else if (state.activeModal === "detail") closeModal("detail");
        else if (state.activeDrawer) closeDrawer();
        return;
      }
      if (state.activeModal === "detail" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        var typing = event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
        if (!typing && catalog.productGallery(productById(state.detailId)).length > 1) {
          event.preventDefault();
          stepGallery(event.key === "ArrowLeft" ? -1 : 1);
        }
        return;
      }
      if (event.key !== "Tab") return;
      var container = null;
      if (state.activeModal === "success") container = successModal;
      else if (state.activeModal === "checkout") container = checkoutModal;
      else if (state.activeModal === "detail") container = detailModal;
      else if (state.activeDrawer === "cart") container = cartSidebar;
      else if (state.activeDrawer === "wishlist") container = wishlistSidebar;
      else if (state.activeDrawer === "compare") container = document.getElementById("compareSidebar");
      if (!container) return;
      var items = Array.prototype.filter.call(container.querySelectorAll("button, [href], input, select, textarea"), function (el) {
        return !el.disabled && el.tabIndex !== -1;
      });
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (!container.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    ["nama", "whatsapp", "alamat"].forEach(function (field) {
      document.getElementById(field).addEventListener("input", function () { showFieldError(field, ""); });
    });
    loadStorefrontCatalog();
  }

  function setCatalogSource(message) {
    var note = document.getElementById("catalogSource");
    if (note) note.textContent = message;
  }

  function applyCatalog(list) {
    products = list;
    state.wishlist = loadWishlist();
    state.compare = loadCompare();
    applyInitialFilters();
    publishFilters();
    renderCart();
    renderWishlist();
    renderCompare();
    if (requestedProductId != null) showDetail(requestedProductId, false);
  }

  function supabaseTerkonfigurasi() {
    var cfg = window.TOKO_KITA_SUPABASE || {};
    return Boolean(String(cfg.url || "").trim() && String(cfg.publishableKey || "").trim());
  }

  function loadStorefrontCatalog() {
    if (supabaseTerkonfigurasi() && !demoRequested && !previewDraftRequested) {
      setCatalogSource("Menghubungkan katalog akun…");
      window.TokoKitaTerimaKatalog = function (payload) {
        var keputusan = catalog.keputusanKatalogAkun(payload);
        if (keputusan === "galat") {
          var pesan = (payload && payload.error) || "Katalog akun tidak dapat dimuat. Mode demo tidak dipakai otomatis.";
          setCatalogSource(pesan);
          catalogError.hidden = false;
          catalogError.textContent = pesan;
          grid.innerHTML = "";
          grid.setAttribute("aria-busy", "false");
          state.catalogFailed = true;
          if (requestedProductId != null) showDetail(requestedProductId, false);
          return;
        }
        if (keputusan === "demo-kosong") {
          fetch("catalog.json", { cache: "no-store" }).then(function (response) {
            if (!response.ok) throw new Error("katalog");
            return response.json();
          }).then(function (data) {
            var parsed = catalog.parseCatalogDocument(data);
            if (!parsed.ok) throw new Error(parsed.message);
            applyCatalog(parsed.products);
            setCatalogSource("Basis data akun masih kosong. Delapan produk ini contoh catalog.json, bukan stok sungguhan, dan tidak dapat dibayar.");
          }).catch(function () {
            applyCatalog(catalog.products);
            setCatalogSource("Basis data akun masih kosong. Contoh bawaan ditampilkan, bukan stok sungguhan, dan tidak dapat dibayar.");
          });
          return;
        }
        applyCatalog(payload.products || []);
        setCatalogSource("Etalase menampilkan produk yang sudah disetujui. Pembayaran tetap simulasi, bukan pembayaran sungguhan.");
      };
      (window.TokoKitaAntreanKatalog || []).splice(0).forEach(window.TokoKitaTerimaKatalog);
      return;
    }
    fetch("catalog.json", { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("katalog");
      return response.json();
    }).then(function (data) {
      var parsed = catalog.parseCatalogDocument(data);
      if (!parsed.ok) throw new Error(parsed.message);
      if (!previewDraftRequested || supabaseTerkonfigurasi()) {
        applyCatalog(parsed.products);
        setCatalogSource(demoRequested
          ? "Mode demo dipilih lewat tautan. Etalase memakai catalog.json, bukan akun penjual."
          : "Mode demo: Supabase belum diisi. Etalase membaca catalog.json di situs ini, bukan draf peramban.");
        return;
      }
      var draft = catalog.parseStoredDraft(readStorage(DRAFT_KEY));
      if (!draft.ok) {
        applyCatalog(parsed.products);
        setCatalogSource("Pratinjau draf diminta, tetapi tidak ada draf valid di peramban ini. Yang tampil tetap katalog tayang.");
        return;
      }
      applyCatalog(draft.products);
      setCatalogSource("Pratinjau draf lokal di peramban ini. Pengunjung lain tetap melihat katalog tayang.");
    }).catch(function () {
      applyCatalog(catalog.products);
        setCatalogSource("Mode demo cadangan: berkas catalog.json tidak termuat. Etalase memakai katalog contoh bawaan, bukan akun penjual.");
    });
  }

  try {
    init();
  } catch (error) {
    console.error(error);
    showCatalogFailure();
  }
})();
