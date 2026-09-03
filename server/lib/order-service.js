const crypto = require("crypto");
const db = require("../db");
const { adjustStockInTx, InsufficientStockError } = require("./inventory");
const { createKaspiPayment } = require("./payments/kaspi");
const { createCardPayment } = require("./payments/card");

const stmt = {
  getProduct: db.prepare("SELECT * FROM products WHERE id = ? AND is_active = 1"),
  insertOrder: db.prepare(`
    INSERT INTO orders
      (id, contact_name, contact_phone, contact_city, contact_address, comment, payment_method, status, total_tenge)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?)
  `),
  insertItem: db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, unit_price_tenge, qty, line_total_tenge)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  insertPayment: db.prepare(`
    INSERT INTO payments (order_id, provider, mode, status, amount_tenge)
    VALUES (?, ?, ?, ?, ?)
  `),
  getOrder: db.prepare("SELECT * FROM orders WHERE id = ?"),
  getOrderItems: db.prepare("SELECT * FROM order_items WHERE order_id = ?"),
  getPaymentByOrder: db.prepare("SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1"),
  markOrderPaid: db.prepare("UPDATE orders SET status = 'paid', paid_at = datetime('now') WHERE id = ?"),
  markOrderCancelled: db.prepare("UPDATE orders SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?"),
  confirmPayment: db.prepare("UPDATE payments SET status = 'confirmed', confirmed_at = datetime('now') WHERE order_id = ?"),
  listOrders: db.prepare(`
    SELECT * FROM orders
    WHERE (@status IS NULL OR status = @status)
    ORDER BY created_at DESC
    LIMIT @limit
  `),
};

class OutOfStockError extends Error {
  constructor(problems) {
    super("Недостаточно товара на складе для части позиций заказа");
    this.name = "OutOfStockError";
    this.problems = problems; // [{ productId, name, available, requested }]
  }
}

/**
 * Создаёт заказ по содержимому корзины. Остаток НЕ списывается —
 * только мягкая проверка, чтобы не принимать заведомо невыполнимый заказ.
 * Реальное списание происходит в confirmOrderPayment().
 */
function createOrder({ cartItems, contact, paymentMethod }) {
  if (!cartItems.length) {
    const err = new Error("Корзина пуста");
    err.status = 400;
    throw err;
  }

  // Проверяем остатки и подтягиваем актуальные цены/названия из БД (не доверяем клиенту)
  const resolvedItems = [];
  const problems = [];
  for (const ci of cartItems) {
    const product = stmt.getProduct.get(ci.productId);
    if (!product) {
      const err = new Error(`Товар не найден: ${ci.productId}`);
      err.status = 404;
      throw err;
    }
    if (product.stock_quantity < ci.qty) {
      problems.push({
        productId: product.id,
        name: product.name,
        available: product.stock_quantity,
        requested: ci.qty,
      });
    }
    resolvedItems.push({
      productId: product.id,
      name: product.name,
      unitPrice: product.price_tenge,
      qty: ci.qty,
      lineTotal: product.price_tenge * ci.qty,
    });
  }

  if (problems.length) throw new OutOfStockError(problems);

  const totalTenge = resolvedItems.reduce((s, i) => s + i.lineTotal, 0);
  const orderId = crypto.randomUUID();

  db.exec("BEGIN");
  try {
    stmt.insertOrder.run(
      orderId,
      contact.name,
      contact.phone,
      contact.city,
      contact.address,
      contact.comment || "",
      paymentMethod,
      totalTenge
    );
    for (const item of resolvedItems) {
      stmt.insertItem.run(orderId, item.productId, item.name, item.unitPrice, item.qty, item.lineTotal);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return { orderId, totalTenge, items: resolvedItems };
}

/** Вызывает провайдера оплаты (пока demo-заглушка) и сохраняет запись о платеже. */
async function initiatePayment(orderId, paymentMethod, totalTenge, contact) {
  const orderStub = { id: orderId, totalTenge, contact };
  const payment =
    paymentMethod === "kaspi"
      ? await createKaspiPayment(orderStub)
      : await createCardPayment(orderStub);

  stmt.insertPayment.run(orderId, paymentMethod, payment.mode, payment.status, totalTenge);
  return payment;
}

/**
 * Подтверждение оплаты: списывает остатки по всем позициям заказа одной
 * транзакцией и переводит заказ в статус 'paid'. Если товара не хватает —
 * всё откатывается, заказ остаётся pending_payment.
 * Сюда же в будущем должен звать webhook реального платёжного провайдера.
 */
function confirmOrderPayment(orderId, adminUsername) {
  const order = stmt.getOrder.get(orderId);
  if (!order) {
    const err = new Error("Заказ не найден");
    err.status = 404;
    throw err;
  }
  if (order.status !== "pending_payment") {
    const err = new Error(`Заказ уже в статусе "${order.status}"`);
    err.status = 409;
    throw err;
  }

  const items = stmt.getOrderItems.all(orderId);

  db.exec("BEGIN");
  try {
    for (const item of items) {
      adjustStockInTx({
        productId: item.product_id,
        delta: -item.qty,
        type: "sale",
        reason: `Продажа по заказу #${orderId.slice(0, 8)}`,
        createdBy: adminUsername || "system",
        orderId,
      });
    }
    stmt.markOrderPaid.run(orderId);
    stmt.confirmPayment.run(orderId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    if (e instanceof InsufficientStockError) {
      const err = new Error(
        `Не удалось подтвердить оплату: не хватает товара на складе (${e.message}). ` +
          `Пополните остаток или отмените заказ.`
      );
      err.status = 409;
      throw err;
    }
    throw e;
  }

  return stmt.getOrder.get(orderId);
}

function cancelOrder(orderId) {
  const order = stmt.getOrder.get(orderId);
  if (!order) {
    const err = new Error("Заказ не найден");
    err.status = 404;
    throw err;
  }
  if (order.status !== "pending_payment") {
    const err = new Error("Отменить можно только неоплаченный заказ");
    err.status = 409;
    throw err;
  }
  stmt.markOrderCancelled.run(orderId);
  return stmt.getOrder.get(orderId);
}

function getOrderWithItems(orderId) {
  const order = stmt.getOrder.get(orderId);
  if (!order) return null;
  return { ...order, items: stmt.getOrderItems.all(orderId) };
}

function listOrders({ status = null, limit = 100 } = {}) {
  return stmt.listOrders.all({ status, limit });
}

module.exports = {
  createOrder,
  initiatePayment,
  confirmOrderPayment,
  cancelOrder,
  getOrderWithItems,
  listOrders,
  OutOfStockError,
};
