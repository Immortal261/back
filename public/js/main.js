const state = {
  products: [],
  category: "all",
  cart: { items: [], totalTenge: 0, totalItems: 0 },
};

const el = (sel) => document.querySelector(sel);
const money = (n) => n.toLocaleString("ru-RU") + " ₸";

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

// ---------- Config ----------

async function loadConfig() {
  try {
    const cfg = await api("/api/config");
    el("#footerShopName").textContent = cfg.shopName;
    el("#footerCity").textContent = cfg.shopCity;
    el("#footerPhone").textContent = cfg.shopPhone;
  } catch {
    /* конфиг не критичен для работы страницы */
  }
}

// ---------- Catalog ----------

function productCardHtml(p) {
  const specs = [
    `<span>Толщина <b>${p.thicknessMicron} мкр</b></span>`,
    `<span>Гарантия <b>${p.warrantyYears} лет</b></span>`,
  ];

  const outOfStock = p.inStock === false;

  return `
    <div class="product-card" data-id="${p.id}">
      <span class="category-label">${p.categoryLabel}</span>
      <h3>${p.name}</h3>
      <p class="desc">${p.description}</p>
      <div class="tag-row">${p.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
      <div class="spec-row">${specs.join("")}</div>
      <div class="price-row">
        <div class="price">${money(p.priceTenge)}<small>${p.unit}</small></div>
        ${
          outOfStock
            ? `<button class="add-to-cart" disabled>Нет в наличии</button>`
            : `<button class="add-to-cart" data-add="${p.id}">В корзину</button>`
        }
      </div>
    </div>
  `;
}

function renderCatalog() {
  const grid = el("#productGrid");
  const list =
    state.category === "all"
      ? state.products
      : state.products.filter((p) => p.finish === state.category);
  grid.innerHTML = list.map(productCardHtml).join("") || `<p>Товары не найдены.</p>`;
}

async function loadProducts() {
  state.products = await api("/api/products");
  renderCatalog();
}

function initFilterTabs() {
  el("#filterTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-category]");
    if (!btn) return;
    state.category = btn.dataset.category;
    document
      .querySelectorAll("#filterTabs button")
      .forEach((b) => b.classList.toggle("active", b === btn));
    renderCatalog();
  });
}

// ---------- Cart ----------

function renderCart() {
  el("#cartCount").textContent = state.cart.totalItems;
  el("#cartTotal").textContent = money(state.cart.totalTenge);

  const container = el("#cartItems");
  if (state.cart.items.length === 0) {
    container.innerHTML = `<div class="cart-empty">Корзина пуста. Загляните в каталог ниже.</div>`;
    return;
  }

  container.innerHTML = state.cart.items
    .map(
      (i) => `
      <div class="cart-item" data-id="${i.productId}">
        <div>
          <div class="cart-item-name">${i.name}</div>
          <div class="cart-item-unit">${i.unit}</div>
          <div class="qty-control">
            <button data-decr="${i.productId}">−</button>
            <span>${i.qty}</span>
            <button data-incr="${i.productId}">+</button>
          </div>
          <button class="remove-link" data-remove="${i.productId}">Удалить</button>
        </div>
        <div>${money(i.lineTotal)}</div>
      </div>
    `
    )
    .join("");
}

async function refreshCart() {
  state.cart = await api("/api/cart");
  renderCart();
}

async function addToCart(productId) {
  state.cart = await api("/api/cart/items", {
    method: "POST",
    body: JSON.stringify({ productId, qty: 1 }),
  });
  renderCart();
  openCart();
}

async function changeQty(productId, delta) {
  const item = state.cart.items.find((i) => i.productId === productId);
  if (!item) return;
  const newQty = item.qty + delta;
  state.cart = await api(`/api/cart/items/${productId}`, {
    method: "PATCH",
    body: JSON.stringify({ qty: newQty }),
  });
  renderCart();
}

async function removeFromCart(productId) {
  state.cart = await api(`/api/cart/items/${productId}`, { method: "DELETE" });
  renderCart();
}

function openCart() {
  el("#cartOverlay").classList.add("open");
  el("#cartDrawer").classList.add("open");
}
function closeCart() {
  el("#cartOverlay").classList.remove("open");
  el("#cartDrawer").classList.remove("open");
}

function initCartEvents() {
  el("#openCartBtn").addEventListener("click", openCart);
  el("#closeCartBtn").addEventListener("click", closeCart);
  el("#cartOverlay").addEventListener("click", closeCart);

  el("#productGrid").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-add]");
    if (btn) addToCart(btn.dataset.add);
  });

  el("#cartItems").addEventListener("click", (e) => {
    const incr = e.target.closest("button[data-incr]");
    const decr = e.target.closest("button[data-decr]");
    const remove = e.target.closest("button[data-remove]");
    if (incr) changeQty(incr.dataset.incr, 1);
    if (decr) changeQty(decr.dataset.decr, -1);
    if (remove) removeFromCart(remove.dataset.remove);
  });
}

// ---------- Checkout ----------

function initCheckout() {
  const overlay = el("#checkoutOverlay");
  const form = el("#checkoutForm");
  const result = el("#orderResult");
  const optKaspi = el("#optKaspi");
  const optCard = el("#optCard");

  el("#checkoutBtn").addEventListener("click", () => {
    if (state.cart.items.length === 0) return;
    form.style.display = "block";
    result.style.display = "none";
    overlay.classList.add("open");
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("open");
  });

  [optKaspi, optCard].forEach((opt) => {
    opt.addEventListener("click", () => {
      optKaspi.classList.toggle("selected", opt === optKaspi);
      optCard.classList.toggle("selected", opt === optCard);
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      name: fd.get("name"),
      phone: fd.get("phone"),
      city: fd.get("city"),
      address: fd.get("address"),
      comment: fd.get("comment"),
      paymentMethod: fd.get("paymentMethod"),
    };

    try {
      const { order, payment } = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      form.style.display = "none";
      result.style.display = "block";

      if (payment.mode === "link" && payment.paymentUrl) {
        result.innerHTML = `
          <p class="ok">Заказ №${order.id.slice(0, 8)} принят.</p>
          <p>Сумма к оплате: <b>${money(order.totalTenge)}</b> — введите её вручную в приложении Kaspi, ссылка сумму не подставляет.</p>
          <a href="${payment.paymentUrl}" target="_blank" rel="noopener" class="btn btn-primary" style="width:100%; margin-top: 12px;">Оплатить через Kaspi Pay</a>
        `;
      } else if (payment.mode === "demo") {
        result.innerHTML = `
          <p class="ok">Заказ №${order.id.slice(0, 8)} принят.</p>
          <p>${payment.instructions}</p>
        `;
      } else if (payment.paymentUrl) {
        result.innerHTML = `
          <p class="ok">Заказ №${order.id.slice(0, 8)} принят.</p>
          <p>Переходим к оплате...</p>
        `;
        window.location.href = payment.paymentUrl;
      } else {
        result.innerHTML = `
          <p class="ok">Заказ №${order.id.slice(0, 8)} принят.</p>
          <p>${payment.instructions}</p>
        `;
      }

      await refreshCart();
    } catch (err) {
      result.style.display = "block";
      result.innerHTML = `<p style="color: var(--danger)">Ошибка: ${err.message}</p>`;
    }
  });
}

// ---------- Init ----------

el("#year").textContent = new Date().getFullYear();

initFilterTabs();
initCartEvents();
initCheckout();
loadConfig();
loadProducts();
refreshCart();
