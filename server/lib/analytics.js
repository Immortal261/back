// Аналитика считается "на лету" запросами к orders/order_items (status='paid'),
// без отдельной таблицы-кэша — так исключается рассинхронизация со складом.

const db = require("../db");

function pad(n) {
  return String(n).padStart(2, "0");
}
function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Возвращает { from, to } как строки 'YYYY-MM-DD' (включительно) для пресета.
 */
function resolveRange(range, customFrom, customTo) {
  const now = new Date();
  const today = toDateStr(now);

  switch (range) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const s = toDateStr(y);
      return { from: s, to: s };
    }
    case "7d": {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { from: toDateStr(from), to: today };
    }
    case "30d": {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { from: toDateStr(from), to: today };
    }
    case "month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toDateStr(from), to: today };
    }
    case "lastMonth": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toDateStr(from), to: toDateStr(to) };
    }
    case "custom":
      if (!customFrom || !customTo) throw new Error("Укажите обе даты периода");
      return { from: customFrom, to: customTo };
    default:
      return { from: "0000-01-01", to: "9999-12-31" }; // всё время
  }
}

function getSummary(range, customFrom, customTo) {
  const { from, to } = resolveRange(range, customFrom, customTo);

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(oi.line_total_tenge), 0) AS revenue,
         COALESCE(SUM(oi.qty), 0) AS itemsSold,
         COUNT(DISTINCT o.id) AS ordersCount
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status = 'paid' AND date(o.paid_at) BETWEEN ? AND ?`
    )
    .get(from, to);

  const stock = db
    .prepare(
      `SELECT
         COALESCE(SUM(stock_quantity), 0) AS totalStock,
         COUNT(*) AS productsCount
       FROM products WHERE is_active = 1`
    )
    .get();

  return { range: { from, to }, ...totals, ...stock };
}

function getTopProducts(range, customFrom, customTo, limit = 10) {
  const { from, to } = resolveRange(range, customFrom, customTo);
  return db
    .prepare(
      `SELECT
         p.id, p.name,
         COALESCE(SUM(oi.qty), 0) AS sold,
         COALESCE(SUM(oi.line_total_tenge), 0) AS revenue,
         COUNT(DISTINCT oi.order_id) AS orders
       FROM products p
       LEFT JOIN order_items oi ON oi.product_id = p.id
       LEFT JOIN orders o ON o.id = oi.order_id AND o.status = 'paid' AND date(o.paid_at) BETWEEN ? AND ?
       WHERE p.is_active = 1
       GROUP BY p.id
       ORDER BY sold DESC
       LIMIT ?`
    )
    .all(from, to, limit);
}

function getLowStock() {
  return db
    .prepare(
      `SELECT id, name, stock_quantity, low_stock_threshold
       FROM products
       WHERE is_active = 1 AND stock_quantity <= low_stock_threshold
       ORDER BY stock_quantity ASC`
    )
    .all();
}

function getDailySeries(range, customFrom, customTo) {
  const { from, to } = resolveRange(range, customFrom, customTo);
  return db
    .prepare(
      `SELECT
         date(o.paid_at) AS day,
         COALESCE(SUM(oi.line_total_tenge), 0) AS revenue,
         COALESCE(SUM(oi.qty), 0) AS itemsSold
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.status = 'paid' AND date(o.paid_at) BETWEEN ? AND ?
       GROUP BY day
       ORDER BY day ASC`
    )
    .all(from, to);
}

/** Полная статистика по одному товару (для карточки в админке) */
function getProductStats(productId) {
  const overall = db
    .prepare(
      `SELECT
         COALESCE(SUM(oi.qty), 0) AS sold,
         COALESCE(SUM(oi.line_total_tenge), 0) AS revenue,
         COUNT(DISTINCT oi.order_id) AS orders
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status = 'paid' AND oi.product_id = ?`
    )
    .get(productId);

  const periods = {};
  for (const key of ["today", "7d", "30d"]) {
    const { from, to } = resolveRange(key);
    periods[key] = db
      .prepare(
        `SELECT COALESCE(SUM(oi.qty), 0) AS sold, COALESCE(SUM(oi.line_total_tenge), 0) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.status = 'paid' AND oi.product_id = ? AND date(o.paid_at) BETWEEN ? AND ?`
      )
      .get(productId, from, to);
  }

  return { overall, ...periods };
}

module.exports = { resolveRange, getSummary, getTopProducts, getLowStock, getDailySeries, getProductStats };
