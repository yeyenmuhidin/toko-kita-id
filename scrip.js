const products = [
  { id: 1, name: "iPhone 15 Pro", price: 18999000, image: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=400&h=400&fit=crop", category: "Elektronik", description: "Chip A17 Pro, kamera 48MP, titanium design" },
  { id: 2, name: "Samsung Galaxy Buds 2 Pro", price: 2499000, image: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400&h=400&fit=crop", category: "Elektronik", description: "ANC terbaik, suara Hi-Fi 24bit" },
  { id: 3, name: "Nike Air Force 1", price: 1799000, image: "https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=400&h=400&fit=crop", category: "Fashion", description: "Sneakers klasik yang timeless" },
  { id: 4, name: "Kaos Oversize Premium", price: 189000, image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=400&fit=crop", category: "Fashion", description: "Bahan cotton combed 30s, adem & nyaman" },
  { id: 5, name: "Apple Watch Series 9", price: 6999000, image: "https://images.unsplash.com/photo-1434493789847-2f02dc6ca35d?w=400&h=400&fit=crop", category: "Elektronik", description: "Always-On display, S9 chip, Double Tap" },
  { id: 6, name: "Tas Ransel Eiger", price: 450000, image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&h=400&fit=crop", category: "Fashion", description: "Waterproof, kapasitas 30L, cocok traveling" },
  { id: 7, name: "MacBook Air M2", price: 15999000, image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400&h=400&fit=crop", category: "Elektronik", description: "Chip M2, 13.6 inch Liquid Retina, super tipis" },
  { id: 8, name: "The Ordinary Skincare Set", price: 650000, image: "https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=400&fit=crop", category: "Kecantikan", description: "Niacinamide + Hyaluronic Acid + Caffeine Solution" }
];

let cart = JSON.parse(localStorage.getItem("tokoKitaCart")) || [];

function formatRupiah(angka) {
  return "Rp " + angka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function renderProducts() {
  const grid = document.getElementById("productGrid");
  grid.innerHTML = products.map(product => `
    <div class="product-card bg-white rounded-xl shadow-sm overflow-hidden transition duration-300">
      <div class="relative overflow-hidden h-52">
        <img src="${product.image}" alt="${product.name}" class="w-full h-full object-cover hover:scale-105 transition duration-500" />
        <span class="absolute top-3 left-3 bg-indigo-600 text-white text-xs px-2 py-1 rounded-full">${product.category}</span>
      </div>
      <div class="p-4">
        <h3 class="font-semibold text-lg mb-1 line-clamp-1">${product.name}</h3>
        <p class="text-gray-500 text-sm mb-3 line-clamp-2">${product.description}</p>
        <div class="flex justify-between items-center">
          <span class="text-indigo-700 font-bold text-lg">${formatRupiah(product.price)}</span>
          <button onclick="addToCart(${product.id})" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2">
            <i class="fas fa-cart-plus"></i> Tambah
          </button>
        </div>
      </div>
    </div>
  `).join("");
}

function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  const existing = cart.find(item => item.id === productId);
  if (existing) existing.quantity += 1;
  else cart.push({ ...product, quantity: 1 });
  saveCart();
  updateCartUI();
  openCart();
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
  saveCart();
  updateCartUI();
}

function updateQuantity(productId, change) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  item.quantity += change;
  if (item.quantity <= 0) removeFromCart(productId);
  else { saveCart(); updateCartUI(); }
}

function saveCart() {
  localStorage.setItem("tokoKitaCart", JSON.stringify(cart));
}

function updateCartUI() {
  const cartItems = document.getElementById("cartItems");
  const cartCount = document.getElementById("cartCount");
  const cartTotal = document.getElementById("cartTotal");
  const checkoutBtn = document.getElementById("checkoutBtn");

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  if (totalItems > 0) {
    cartCount.textContent = totalItems;
    cartCount.classList.remove("hidden");
  } else cartCount.classList.add("hidden");

  cartTotal.textContent = formatRupiah(totalPrice);
  document.getElementById("checkoutTotal").textContent = formatRupiah(totalPrice);
  checkoutBtn.disabled = cart.length === 0;

  if (cart.length === 0) {
    cartItems.innerHTML = `<div class="text-center py-12 text-gray-400"><i class="fas fa-shopping-basket text-5xl mb-4"></i><p>Keranjang masih kosong</p></div>`;
    return;
  }

  cartItems.innerHTML = cart.map(item => `
    <div class="flex gap-4 border-b pb-4">
      <img src="${item.image}" alt="${item.name}" class="w-20 h-20 object-cover rounded-lg" />
      <div class="flex-1">
        <h4 class="font-medium line-clamp-1">${item.name}</h4>
        <p class="text-indigo-600 font-semibold text-sm">${formatRupiah(item.price)}</p>
        <div class="flex items-center gap-3 mt-2">
          <button onclick="updateQuantity(${item.id}, -1)" class="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">-</button>
          <span class="font-medium w-6 text-center">${item.quantity}</span>
          <button onclick="updateQuantity(${item.id}, 1)" class="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">+</button>
          <button onclick="removeFromCart(${item.id})" class="ml-auto text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    </div>
  `).join("");
}

function openCart() {
  document.getElementById("cartSidebar").classList.add("open");
  document.getElementById("cartOverlay").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeCart() {
  document.getElementById("cartSidebar").classList.remove("open");
  document.getElementById("cartOverlay").classList.add("hidden");
  document.body.style.overflow = "";
}

document.getElementById("cartBtn").addEventListener("click", openCart);
document.getElementById("closeCart").addEventListener("click", closeCart);
document.getElementById("cartOverlay").addEventListener("click", closeCart);

document.getElementById("checkoutBtn").addEventListener("click", () => {
  if (cart.length === 0) return;
  closeCart();
  document.getElementById("checkoutModal").classList.remove("hidden");
});

document.getElementById("closeCheckout").addEventListener("click", () => {
  document.getElementById("checkoutModal").classList.add("hidden");
});

document.getElementById("checkoutForm").addEventListener("submit", (e) => {
  e.preventDefault();
  document.getElementById("checkoutModal").classList.add("hidden");
  document.getElementById("successModal").classList.remove("hidden");
  cart = [];
  saveCart();
  updateCartUI();
  e.target.reset();
});

document.getElementById("closeSuccess").addEventListener("click", () => {
  document.getElementById("successModal").classList.add("hidden");
});

renderProducts();
updateCartUI();
