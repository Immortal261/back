const express = require("express");
const db = require("../db");
const auth = require("../lib/auth");
const inventory = require("../lib/inventory");
const analytics = require("../lib/analytics");
const orderService = require("../lib/order-service");

const router = express.Router();

const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  maxAge: 12 * 60 * 60 * 1000,
};

// ---------- Авторизация ----------

router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Введите логин и пароль" });
  }
  const sessionId = auth.login(username, password);
  if (!sessionId) {
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }
  res.cookie(auth.SESSION_COOKIE, sessionId, SESSION_COOKIE_OPTS);
  res.json({ ok: true, username });
});

router.post("/logout", (req, res) => {
  auth.logout(req.cookies[auth.SESSION_COOKIE]);
  res.clearCookie(auth.SESSION_COOKIE);
  res.json({ ok: true });
});

router.get("/me", auth.requireAdmin, (req, res) => {
  res.json({ username: req.admin.username });
});

// Всё, что ниже — только для авторизованного администратора.
router.use(auth.requireAdmin);

// ---------- Товары и остатки ----------

const STOCK_STATUS = (qty, threshold) => {
  if (qty <= 0) return "out";
  if (qty <= threshold) return "low";
  return "ok";
};

router.get("/products", (req, res) => {
  const products = db.prepare("SELECT * FROM products WHERE is_active = 1 ORDER BY rowid").all();
  const stats = analytics.getTopProducts("all", null, null, 1000);
  const statsById = Object.fromEntries(stats.map((s) => [s.id, s]));

  const result = products.map((p) => {
    const s = statsById[p.id] || { sold: 0, revenue: 0, orders: 0 };
    return {
      id: p.id,
      name: p.name,
      unit: p.unit,
      priceTenge: p.price_tenge,
      stockQuantity: p.stock_quantity,
      lowStockThreshold: p.low_stock_threshold,
      status: STOCK_STATUS(p.stock_quantity, p.low_stock_threshold),
      sold: s.sold,
      orders: s.orders,
      revenue: s.revenue,
    };
  });

  res.json(result);
});

router.post("/products/:id/stock", (req, res) => {
  const { delta, reason } = req.body;
  const deltaNum = Number(delta);

  if (!Number.isInteger(deltaNum) || deltaNum === 0) {
    return res.status(400).json({ error: "Укажите целое ненулевое количество" });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: "Укажите причину изменения" });
  }

  try {
    const newQty = inventory.adjustStock({
      productId: req.params.id,
      delta: deltaNum,
      type: deltaNum > 0 ? "restock" : "adjustment",
      reason: String(reason).trim(),
      createdBy: req.admin.username,
    });
    res.json({ ok: true, stockQuantity: newQty });
  } catch (e) {
    if (e instanceof inventory.InsufficientStockError) {
      return res.status(409).json({ error: "Нельзя уйти в минус по остатку", detail: e.message });
    }
    res.status(e.message.includes("не найден") ? 404 : 500).json({ error: e.message });
  }
});

router.get("/products/:id/history", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(inventory.getHistory(req.params.id, limit));
});

router.post("/products/:id/price", (req, res) => {
  const { priceTenge } = req.body;
  const priceNum = Number(priceTenge);

  if (!Number.isInteger(priceNum) || priceNum <= 0) {
    return res.status(400).json({ error: "Укажите целую положительную цену в тенге" });
  }

  const product = db.prepare("SELECT id FROM products WHERE id = ? AND is_active = 1").get(req.params.id);
  if (!product) {
    return res.status(404).json({ error: "Товар не найден" });
  }

  db.prepare("UPDATE products SET price_tenge = ? WHERE id = ?").run(priceNum, req.params.id);
  res.json({ ok: true, priceTenge: priceNum });
});

// ---------- Заказы ----------

router.get("/orders", (req, res) => {
  const status = req.query.status || null;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const orders = orderService.listOrders({ status, limit });
  const withItems = orders.map((o) => orderService.getOrderWithItems(o.id));
  res.json(withItems);
});

router.post("/orders/:id/confirm-payment", (req, res) => {
  try {
    const order = orderService.confirmOrderPayment(req.params.id, req.admin.username);
    res.json({ ok: true, order });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post("/orders/:id/cancel", (req, res) => {
  try {
    const order = orderService.cancelOrder(req.params.id);
    res.json({ ok: true, order });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------- Аналитика ----------

router.get("/analytics", (req, res) => {
  const { range = "30d", from, to } = req.query;
  try {
    const summary = analytics.getSummary(range, from, to);
    const topProducts = analytics.getTopProducts(range, from, to, 10);
    const lowStock = analytics.getLowStock();
    const dailySeries = analytics.getDailySeries(range, from, to);
    res.json({ summary, topProducts, lowStock, dailySeries });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
