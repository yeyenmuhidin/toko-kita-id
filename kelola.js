(function () {
  "use strict";

  var catalog = window.TokoKitaCatalog;
  var DRAFT_KEY = "tokoKitaCatalogDraft";
  var MAX_IMAGE_BYTES = 350000;
  if (!catalog) {
    document.getElementById("draftMeta").textContent = "Modul katalog gagal dimuat.";
    return;
  }

  var liveProducts = [];
  var draftProducts = null;
  var draftSavedAt = "";
  var editingId = null;
  var formImage = "";
  var pendingAction = null;
  var searchQuery = "";

  var draftMeta = document.getElementById("draftMeta");
  var listStatus = document.getElementById("listStatus");
  var productList = document.getElementById("productList");
  var fileStatus = document.getElementById("fileStatus");
  var formTitle = document.getElementById("formTitle");
  var liveStatus = document.getElementById("liveStatus");

  function workingList() {
    return (draftProducts || liveProducts).slice();
  }

  function announce(message) {
    liveStatus.textContent = "";
    window.setTimeout(function () { liveStatus.textContent = message; }, 30);
  }

  function fieldError(id, message) {
    var inputs = { name: "productName", price: "productPrice", category: "productCategory", description: "productDescription", image: "productImageUrl" };
    var node = document.getElementById(id + "Error");
    var input = document.getElementById(inputs[id] || "");
    if (!node) return;
    node.hidden = !message;
    node.textContent = message || "";
    if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function clearErrors() {
    ["name", "price", "category", "description", "image"].forEach(function (field) { fieldError(field, ""); });
    document.getElementById("fileError").hidden = true;
    document.getElementById("fileError").textContent = "";
  }

  function formatWhen(iso) {
    if (!iso) return "";
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("id-ID");
  }

  function renderStatus() {
    if (draftProducts) {
      draftMeta.textContent = "Draf lokal tersimpan di peramban ini" + (formatWhen(draftSavedAt) ? " pada " + formatWhen(draftSavedAt) : "") + ". Status: belum tayang. Katalog tayang tetap " + liveProducts.length + " produk di berkas catalog.json.";
    } else {
      draftMeta.textContent = "Belum ada draf tersimpan. Daftar di bawah menyalin " + liveProducts.length + " produk tayang agar bisa diubah. Simpan ke draf sebelum mengunduh.";
    }
  }

  function renderCategories() {
    var options = document.getElementById("categoryOptions");
    var seen = [];
    workingList().forEach(function (product) {
      if (seen.indexOf(product.category) === -1) seen.push(product.category);
    });
    options.innerHTML = seen.map(function (category) {
      return "<option value=\"" + catalog.escapeHtml(category) + "\"></option>";
    }).join("");
  }

  function liveProduct(id) {
    return liveProducts.find(function (product) { return product.id === id; }) || null;
  }

  function renderList() {
    var filtered = catalog.filterAndSortProducts(workingList(), catalog.createFilters({ query: searchQuery }));
    listStatus.textContent = filtered.length + " produk di " + (draftProducts ? "draf lokal" : "salinan katalog tayang") + ".";
    if (!filtered.length) {
      productList.innerHTML = "<p class=\"text-sm text-gray-600\" role=\"status\">Tidak ada produk pada pencarian ini.</p>";
      return;
    }
    productList.innerHTML = filtered.map(function (product) {
      var image = catalog.safeProductImage(product.image);
      var live = liveProduct(product.id);
      var priceNote = live && live.price !== product.price
        ? "<p class=\"text-xs text-amber-800\">Tayang " + catalog.formatRupiah(live.price) + " · draf " + catalog.formatRupiah(product.price) + "</p>"
        : "";
      var sample = product.contoh ? "<span class=\"text-xs bg-amber-100 text-amber-950 rounded-full px-2 py-0.5\">Contoh</span>" : "";
      var hiddenNote = product.visible === false ? "<span class=\"text-xs text-gray-600\">Disembunyikan dari etalase</span>" : "";
      return "<article class=\"border border-gray-200 rounded-xl p-3 flex gap-3\">" +
        (image ? "<img src=\"" + catalog.escapeHtml(image) + "\" alt=\"\" class=\"w-16 h-16 object-cover rounded-lg bg-gray-100\" />" : "<div class=\"w-16 h-16 rounded-lg bg-gray-100 text-xs text-gray-500 flex items-center justify-center text-center px-1\">Gambar tidak tersedia</div>") +
        "<div class=\"min-w-0 flex-1\">" +
          "<h3 class=\"font-semibold\">" + catalog.escapeHtml(product.name) + "</h3>" +
          "<p class=\"text-sm text-gray-600\">" + catalog.escapeHtml(product.category) + " · " + catalog.formatRupiah(product.price) + "</p>" +
          priceNote +
          "<div class=\"flex flex-wrap gap-2 mt-1\">" + sample + hiddenNote + "</div>" +
          "<button type=\"button\" data-action=\"edit\" data-id=\"" + product.id + "\" class=\"mt-2 min-h-11 px-3 rounded-lg border border-gray-300 text-sm font-medium\">Ubah</button>" +
        "</div></article>";
    }).join("");
    productList.querySelectorAll("img").forEach(function (img) {
      img.addEventListener("error", function () { img.replaceWith(Object.assign(document.createElement("div"), { className: "w-16 h-16 rounded-lg bg-gray-100", textContent: "Gambar tidak tersedia" })); });
    });
  }

  function renderPreview() {
    var name = document.getElementById("productName").value.trim() || "Nama produk";
    var price = catalog.parsePriceInput(document.getElementById("productPrice").value);
    var image = catalog.safeProductImage(formImage || document.getElementById("productImageUrl").value.trim());
    var preview = document.getElementById("preview");
    preview.innerHTML = "<p class=\"text-xs font-medium text-gray-500 mb-2\">Pratinjau formulir, belum tayang</p>" +
      (image ? "<img alt=\"\" class=\"w-full h-40 object-cover rounded-lg bg-gray-100 mb-2\" />" : "<div class=\"w-full h-40 rounded-lg bg-gray-100 mb-2 flex items-center justify-center text-sm text-gray-500\">Gambar tidak tersedia</div>") +
      "<h3 class=\"font-semibold\"></h3><p class=\"text-sm text-gray-600\"></p><p class=\"text-indigo-700 font-bold mt-1\"></p>";
    if (image) preview.querySelector("img").src = image;
    preview.querySelector("h3").textContent = name;
    preview.querySelector("p.text-sm").textContent = document.getElementById("productDescription").value.trim();
    preview.querySelector("p.text-indigo-700").textContent = price == null ? "Harga belum valid" : catalog.formatRupiah(price);
  }

  function fillForm(product) {
    clearErrors();
    editingId = product ? product.id : null;
    formTitle.textContent = product ? "Ubah produk" : "Tambah produk";
    document.getElementById("productName").value = product ? product.name : "";
    document.getElementById("productPrice").value = product ? String(product.price) : "";
    document.getElementById("productCategory").value = product ? product.category : (workingList()[0] ? workingList()[0].category : "");
    document.getElementById("productDescription").value = product ? product.description : "";
    document.getElementById("productImageUrl").value = product && catalog.safeImageUrl(product.image) ? product.image : "";
    document.getElementById("productImageFile").value = "";
    formImage = product ? product.image : "";
    document.getElementById("productVisible").checked = product ? product.visible !== false : true;
    document.getElementById("deleteProduct").hidden = !product;
    renderPreview();
    formTitle.focus();
  }

  function refresh() {
    renderStatus();
    renderCategories();
    renderList();
  }

  function persistDraft(list) {
    var savedAt = new Date().toISOString();
    var raw = catalog.serializeDraft(list, savedAt);
    if (!raw) {
      fileStatus.textContent = "Draf tidak dapat disimpan karena isinya tidak lolos pemeriksaan.";
      return false;
    }
    try {
      localStorage.setItem(DRAFT_KEY, raw);
    } catch (error) {
      fileStatus.textContent = "Penyimpanan peramban penuh atau ditolak. Draf tidak tersimpan. Unduh berkas sebelum menutup halaman jika penyimpanan gagal.";
      return false;
    }
    draftProducts = catalog.parseStoredDraft(raw).products;
    draftSavedAt = savedAt;
    refresh();
    return true;
  }

  function currentImage() {
    var typed = document.getElementById("productImageUrl").value.trim();
    if (typed) return typed;
    return formImage;
  }

  function saveForm(event) {
    event.preventDefault();
    clearErrors();
    var list = workingList();
    var id = editingId || catalog.nextProductId(list);
    var original = list.find(function (product) { return product.id === id; });
    var checked = catalog.validateProduct({
      id: id,
      name: document.getElementById("productName").value,
      price: catalog.parsePriceInput(document.getElementById("productPrice").value),
      category: document.getElementById("productCategory").value,
      description: document.getElementById("productDescription").value,
      image: currentImage(),
      visible: document.getElementById("productVisible").checked,
      contoh: original ? original.contoh === true : false,
      images: original && original.images
    }, { ids: list.map(function (product) { return product.id; }).filter(function (itemId) { return itemId !== id; }) });
    if (!checked.ok) {
      Object.keys(checked.errors).forEach(function (key) { fieldError(key, checked.errors[key]); });
      return;
    }
    if (!persistDraft(catalog.upsertProduct(list, checked.value))) return;
    editingId = checked.value.id;
    document.getElementById("deleteProduct").hidden = false;
    formTitle.textContent = "Ubah produk";
    fileStatus.textContent = "Perubahan disimpan ke draf lokal. Belum tayang.";
    announce(checked.value.name + " disimpan ke draf. Belum tayang.");
  }

  function askConfirm(title, message, action) {
    pendingAction = action;
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = message;
    document.getElementById("confirmDialog").hidden = false;
    document.getElementById("confirmTitle").focus();
  }

  function closeConfirm() {
    pendingAction = null;
    document.getElementById("confirmDialog").hidden = true;
  }

  function readImage(file) {
    document.getElementById("fileError").hidden = true;
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      document.getElementById("fileError").hidden = false;
      document.getElementById("fileError").textContent = "Gambar maksimal 350 KB. Untuk berkas lebih besar, tempel tautan https.";
      return;
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      document.getElementById("fileError").hidden = false;
      document.getElementById("fileError").textContent = "Gunakan JPEG, PNG, atau WebP.";
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      document.getElementById("fileError").hidden = false;
      document.getElementById("fileError").textContent = "Gambar tidak dapat dibaca.";
    };
    reader.onload = function () {
      var url = String(reader.result || "");
      if (!catalog.isSafeImageDataUrl(url)) {
        document.getElementById("fileError").hidden = false;
        document.getElementById("fileError").textContent = "Isi gambar tidak aman atau tidak dikenali.";
        return;
      }
      var image = new Image();
      image.onload = function () {
        formImage = url;
        document.getElementById("productImageUrl").value = "";
        renderPreview();
        fileStatus.textContent = "Gambar perangkat masuk ke formulir. Belum diunggah ke server dan belum tayang.";
      };
      image.onerror = function () {
        document.getElementById("fileError").hidden = false;
        document.getElementById("fileError").textContent = "Berkas bukan gambar yang bisa ditampilkan.";
      };
      image.src = url;
    };
    reader.readAsDataURL(file);
  }

  function downloadDraft() {
    if (!draftProducts) {
      fileStatus.textContent = "Belum ada draf untuk diunduh. Simpan perubahan dulu. Mengunduh tidak menayangkan katalog.";
      return;
    }
    var body = catalog.serializeCatalog(draftProducts);
    if (!body || body.indexOf(catalog.DRAFT_EXPORT_NOTE) === -1) {
      fileStatus.textContent = "Draf tidak dapat diunduh karena tidak lolos pemeriksaan.";
      return;
    }
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    link.download = "catalog.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    fileStatus.textContent = "Draf catalog.json terunduh. Berkas ini belum tayang. Ikuti langkah commit di bawah agar pengunjung melihatnya.";
    announce("Draf terunduh. Belum tayang.");
  }

  function importText(text) {
    var parsed = catalog.parseCatalogDocument(text);
    if (!parsed.ok) {
      fileStatus.textContent = "Impor ditolak. " + parsed.message + " Draf yang ada tidak diganti.";
      return;
    }
    askConfirm(
      "Ganti draf lokal?",
      "Berkas berisi " + parsed.products.length + " produk yang valid. Ini hanya mengganti draf di peramban ini. Katalog tayang tidak berubah, dan impor belum menayangkan produk.",
      function () {
        if (!persistDraft(parsed.products)) return;
        fillForm(null);
        fileStatus.textContent = "Draf lokal diganti dari berkas. Belum tayang.";
      }
    );
  }

  document.getElementById("productForm").addEventListener("submit", saveForm);
  document.getElementById("productForm").addEventListener("input", renderPreview);
  document.getElementById("productImageUrl").addEventListener("input", function () {
    formImage = document.getElementById("productImageUrl").value.trim();
    renderPreview();
  });
  document.getElementById("productImageFile").addEventListener("change", function (event) {
    readImage(event.target.files && event.target.files[0]);
  });
  document.getElementById("editorSearch").addEventListener("input", function (event) {
    searchQuery = event.target.value;
    renderList();
  });
  document.getElementById("newProduct").addEventListener("click", function () { fillForm(null); });
  document.getElementById("deleteProduct").addEventListener("click", function () {
    var product = workingList().find(function (item) { return item.id === editingId; });
    if (!product) return;
    askConfirm(
      "Hapus dari draf?",
      "Hapus " + product.name + " dari draf lokal? Katalog tayang tidak berubah dan produk belum dihapus dari etalase pengunjung.",
      function () {
        if (!persistDraft(catalog.deleteProduct(workingList(), product.id))) return;
        fillForm(null);
        fileStatus.textContent = product.name + " dihapus dari draf. Katalog tayang tidak berubah.";
      }
    );
  });
  document.getElementById("downloadDraft").addEventListener("click", downloadDraft);
  document.getElementById("importFile").addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2000000) {
      fileStatus.textContent = "Impor ditolak. Berkas terlalu besar. Draf yang ada tidak diganti.";
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { fileStatus.textContent = "Berkas impor tidak dapat dibaca. Draf yang ada tidak diganti."; };
    reader.onload = function () { importText(String(reader.result || "")); };
    reader.readAsText(file);
  });
  document.getElementById("discardDraft").addEventListener("click", function () {
    askConfirm(
      "Buang draf lokal?",
      "Draf di peramban ini akan dihapus. Katalog tayang tidak berubah. Perubahan yang belum diunduh ikut hilang.",
      function () {
        localStorage.removeItem(DRAFT_KEY);
        draftProducts = null;
        draftSavedAt = "";
        fillForm(null);
        refresh();
        fileStatus.textContent = "Draf lokal dibuang. Etalase tetap memakai katalog tayang.";
      }
    );
  });
  document.getElementById("confirmCancel").addEventListener("click", closeConfirm);
  document.getElementById("confirmOk").addEventListener("click", function () {
    var action = pendingAction;
    closeConfirm();
    if (action) action();
  });
  document.getElementById("confirmDialog").addEventListener("click", function (event) {
    if (event.target.id === "confirmDialog") closeConfirm();
  });
  productList.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action='edit']");
    if (!button) return;
    var product = workingList().find(function (item) { return item.id === Number(button.dataset.id); });
    if (product) fillForm(product);
  });

  fetch("catalog.json", { cache: "no-store" }).then(function (response) {
    if (!response.ok) throw new Error("katalog");
    return response.json();
  }).then(function (data) {
    var parsed = catalog.parseCatalogDocument(data);
    if (!parsed.ok) throw new Error(parsed.message);
    liveProducts = parsed.products;
  }).catch(function () {
    liveProducts = catalog.products.map(function (product) {
      return catalog.validateProduct(Object.assign({}, product, { visible: true, contoh: true })).value;
    });
    fileStatus.textContent = "Berkas catalog.json tidak termuat. Daftar awal memakai katalog contoh bawaan. Draf tetap belum tayang.";
  }).then(function () {
    var stored = null;
    try { stored = localStorage.getItem(DRAFT_KEY); } catch (error) { stored = null; }
    var draft = catalog.parseStoredDraft(stored);
    if (draft.ok) {
      draftProducts = draft.products;
      draftSavedAt = draft.savedAt;
    } else if (stored) {
      fileStatus.textContent = draft.message + " Draf rusak tidak dipakai.";
    }
    refresh();
    fillForm(null);
  });
})();
