const el = (sel) => document.querySelector(sel);
const money = (n) => Number(n).toLocaleString("ru-RU") + " ₸";

const state = {
  range: "today",
  from: null,
  to: null,
  currentStockProductId: null,
  currentPriceProductId: null,
  stockOp: "in",
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });
  if (res.status === 401) {
    window.location.href = "/admin/login.html";
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

// ---------- Auth check / header ----------

async function initAuth() {
  const me = await api("/api/admin/me");
  el("#whoAmI").textContent = me.username;
}

el("#logoutBtn").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  window.location.href = "/admin/login.html";
});

// ---------- Range tabs ----------

function initRangeTabs() {
  el("#rangeTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-range]");
    if (!btn) return;
    document.querySelectorAll("#rangeTabs button").forEach((b) => b.classList.toggle("active", b === btn));
    state.range = btn.dataset.range;
    el("#customRange").classList.toggle("visible", state.range === "custom");
    if (state.range !== "custom") loadAnalytics();
  });

  el("#applyCustomRange").addEventListener("click", () => {
    state.from = el("#fromDate").value;
    state.to = el("#toDate").value;
    if (!state.from || !state.to) return;
    loadAnalytics();
  });
}

// ---------- Chart (простой bar chart на чистом SVG, без библиотек) ----------

function renderChart(series) {
  const container = el("#chartContainer");
  if (!series.length) {
    container.innerHTML = `<div class="empty">Нет оплаченных заказов за этот период</div>`;
    return;
  }

  const max = Math.max(...series.map((d) => d.revenue), 1);
  const w = 700;
  const h = 180;
  const barGap = 6;
  const barWidth = Math.min(48, (w - barGap * (series.length - 1)) / series.length);
  const totalWidth = series.length * barWidth + (series.length - 1) * barGap;
  const offsetX = Math.max(0, (w - totalWidth) / 2);

  let bars = "";
  series.forEach((d, i) => {
    const barH = Math.max(2, (d.revenue / max) * (h - 30));
    const x = offsetX + i * (barWidth + barGap);
    const y = h - barH - 20;
    const dayLabel = d.day.slice(5); // MM-DD
    bars += `
      <g>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="3" fill="#e5342a" opacity="0.9">
          <title>${d.day}: ${money(d.revenue)}, ${d.itemsSold} шт.</title>
        </rect>
        <text x="${x + barWidth / 2}" y="${h - 4}" font-size="10" fill="#999" text-anchor="middle" font-family="JetBrains Mono, monospace">${dayLabel}</text>
      </g>
    `;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" xmlns="http://www.w3.org/2000/svg">
      ${bars}
    </svg>
  `;
}

// ---------- Summary ----------

function renderSummary(summary) {
  el("#sumRevenue").textContent = money(summary.revenue);
  el("#sumOrders").textContent = summary.ordersCount;
  el("#sumItems").textContent = summary.itemsSold;
  el("#sumStock").textContent = summary.totalStock;
}

function renderLowStock(lowStock) {
  const note = el("#lowStockNote");
  if (!lowStock.length) {
    note.style.display = "none";
    return;
  }
  note.style.display = "block";
  note.textContent =
    "Заканчиваются: " +
    lowStock.map((p) => `${p.name} (${p.stock_quantity} шт.)`).join(", ");
}

// ---------- Products table ----------

const STATUS_LABEL = { ok: "В наличии", low: "Заканчивается", out: "Нет в наличии" };
const STATUS_CLASS = { ok: "badge-ok", low: "badge-low", out: "badge-out" };

function renderProducts(products) {
  el("#productsBody").innerHTML = products
    .map(
      (p) => `
      <tr>
        <td><button class="link-btn" data-history="${p.id}" data-name="${p.name}">${p.name}</button></td>
        <td class="num">${money(p.priceTenge)}</td>
        <td class="num">${p.stockQuantity}</td>
        <td class="num">${p.sold}</td>
        <td class="num">${p.orders}</td>
        <td class="num">${money(p.revenue)}</td>
        <td><span class="badge ${STATUS_CLASS[p.status]}">${STATUS_LABEL[p.status]}</span></td>
        <td>
          <div class="row-actions">
            <button class="btn btn-sm" data-adjust="${p.id}" data-name="${p.name}">Остаток</button>
            <button class="btn btn-sm" data-price="${p.id}" data-name="${p.name}" data-current-price="${p.priceTenge}">Цена</button>
          </div>
        </td>
      </tr>
    `
    )
    .join("");
}

async function loadProducts() {
  const products = await api("/api/admin/products");
  renderProducts(products);
}

// ---------- Orders table ----------

const ORDER_STATUS_LABEL = { pending_payment: "Ожидает оплаты", paid: "Оплачен", cancelled: "Отменён" };
const ORDER_STATUS_CLASS = { pending_payment: "badge-pending", paid: "badge-paid", cancelled: "badge-cancelled" };

function renderOrders(orders) {
  el("#ordersBody").innerHTML = orders
    .map((o) => {
      const composition = o.items.map((i) => `${i.product_name} ×${i.qty}`).join(", ");
      const actions =
        o.status === "pending_payment"
          ? `
            <div class="row-actions">
              <button class="btn btn-sm btn-primary" data-confirm="${o.id}">Подтвердить оплату</button>
              <button class="btn btn-sm btn-danger" data-cancel="${o.id}">Отменить</button>
            </div>
          `
          : "";
      return `
        <tr>
          <td>${o.id.slice(0, 8)}</td>
          <td>${o.created_at}</td>
          <td>${o.contact_name}<br><span style="color:var(--text-muted)">${o.contact_phone}</span></td>
          <td>${composition}</td>
          <td class="num">${money(o.total_tenge)}</td>
          <td>${o.payment_method === "kaspi" ? "Kaspi" : "Карта"}</td>
          <td><span class="badge ${ORDER_STATUS_CLASS[o.status]}">${ORDER_STATUS_LABEL[o.status]}</span></td>
          <td>${actions}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadOrders() {
  const orders = await api("/api/admin/orders?limit=100");
  renderOrders(orders);
}

// ---------- Analytics ----------

async function loadAnalytics() {
  const params = new URLSearchParams({ range: state.range });
  if (state.range === "custom") {
    params.set("from", state.from);
    params.set("to", state.to);
  }
  const data = await api(`/api/admin/analytics?${params.toString()}`);
  renderSummary(data.summary);
  renderChart(data.dailySeries);
  renderLowStock(data.lowStock);
}

// ---------- Stock modal ----------

function openModal(id) {
  el(`#${id}`).classList.add("open");
}
function closeModal(id) {
  el(`#${id}`).classList.remove("open");
}

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});

el("#productsBody").addEventListener("click", (e) => {
  const adjustBtn = e.target.closest("button[data-adjust]");
  const priceBtn = e.target.closest("button[data-price]");
  const historyBtn = e.target.closest("button[data-history]");

  if (adjustBtn) {
    state.currentStockProductId = adjustBtn.dataset.adjust;
    el("#stockModalProductName").textContent = adjustBtn.dataset.name;
    el("#stockQty").value = "";
    el("#stockReason").value = "";
    el("#stockFormError").textContent = "";
    setStockOp("in");
    openModal("stockModal");
  }

  if (priceBtn) {
    state.currentPriceProductId = priceBtn.dataset.price;
    el("#priceModalProductName").textContent = priceBtn.dataset.name;
    el("#priceValue").value = priceBtn.dataset.currentPrice;
    el("#priceFormError").textContent = "";
    openModal("priceModal");
  }

  if (historyBtn) {
    openProductHistory(historyBtn.dataset.history, historyBtn.dataset.name);
  }
});

el("#priceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = el("#priceFormError");
  errorEl.textContent = "";

  const priceTenge = Number(el("#priceValue").value);
  if (!Number.isInteger(priceTenge) || priceTenge <= 0) {
    errorEl.textContent = "Укажите положительную целую цену в тенге";
    return;
  }

  try {
    await api(`/api/admin/products/${state.currentPriceProductId}/price`, {
      method: "POST",
      body: JSON.stringify({ priceTenge }),
    });
    closeModal("priceModal");
    await loadProducts();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

function setStockOp(op) {
  state.stockOp = op;
  document.querySelectorAll("#stockOpTabs button").forEach((b) => b.classList.toggle("active", b.dataset.op === op));
}

el("#stockOpTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-op]");
  if (btn) setStockOp(btn.dataset.op);
});

el("#stockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = el("#stockFormError");
  errorEl.textContent = "";

  const qty = Number(el("#stockQty").value);
  const reason = el("#stockReason").value.trim();
  if (!Number.isInteger(qty) || qty <= 0) {
    errorEl.textContent = "Укажите положительное целое количество";
    return;
  }

  const delta = state.stockOp === "in" ? qty : -qty;

  try {
    await api(`/api/admin/products/${state.currentStockProductId}/stock`, {
      method: "POST",
      body: JSON.stringify({ delta, reason }),
    });
    closeModal("stockModal");
    await loadProducts();
    await loadAnalytics();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// ---------- History modal ----------

const MOVEMENT_LABEL = { restock: "Поступление", sale: "Продажа", adjustment: "Корректировка" };

async function openProductHistory(productId, name) {
  el("#historyModalProductName").textContent = name;
  el("#historyList").innerHTML = `<p style="color:var(--text-muted)">Загрузка…</p>`;
  openModal("historyModal");

  const history = await api(`/api/admin/products/${productId}/history`);
  if (!history.length) {
    el("#historyList").innerHTML = `<p style="color:var(--text-muted)">Движений пока нет</p>`;
    return;
  }

  el("#historyList").innerHTML = history
    .map((h) => {
      const sign = h.change_qty > 0 ? "pos" : "neg";
      const signStr = h.change_qty > 0 ? `+${h.change_qty}` : h.change_qty;
      return `
        <div class="history-row">
          <div>
            <div>${MOVEMENT_LABEL[h.type] || h.type} — <span class="history-change ${sign}">${signStr}</span></div>
            <div style="color:var(--text-muted)">${h.reason || ""} · ${h.created_by || ""} · ${h.created_at}</div>
          </div>
          <div>Остаток: ${h.resulting_quantity}</div>
        </div>
      `;
    })
    .join("");
}

// ---------- Orders actions ----------

el("#ordersBody").addEventListener("click", async (e) => {
  const confirmBtn = e.target.closest("button[data-confirm]");
  const cancelBtn = e.target.closest("button[data-cancel]");

  if (confirmBtn) {
    if (!window.confirm("Подтвердить оплату и списать товар со склада?")) return;
    try {
      await api(`/api/admin/orders/${confirmBtn.dataset.confirm}/confirm-payment`, { method: "POST" });
      await Promise.all([loadOrders(), loadProducts(), loadAnalytics()]);
    } catch (err) {
      alert(err.message);
    }
  }

  if (cancelBtn) {
    if (!window.confirm("Отменить заказ?")) return;
    try {
      await api(`/api/admin/orders/${cancelBtn.dataset.cancel}/cancel`, { method: "POST" });
      await loadOrders();
    } catch (err) {
      alert(err.message);
    }
  }
});

// ---------- Init ----------

(async function init() {
  try {
    await initAuth();
  } catch {
    return; // initAuth уже редиректит на /admin/login.html при 401
  }
  initRangeTabs();
  await Promise.all([loadAnalytics(), loadProducts(), loadOrders()]);
})();
