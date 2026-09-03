// Все изменения остатка идут через adjustStock — единственная точка входа,
// которая пишет и products.stock_quantity, и запись в stock_movements,
// в одной транзакции. Это и есть защита от рассинхронизации.

const db = require("../db");

const stmt = {
  getProduct: db.prepare("SELECT * FROM products WHERE id = ?"),
  updateStock: db.prepare("UPDATE products SET stock_quantity = ? WHERE id = ?"),
  insertMovement: db.prepare(`
    INSERT INTO stock_movements
      (product_id, change_qty, type, reason, resulting_quantity, order_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  history: db.prepare(`
    SELECT id, change_qty, type, reason, resulting_quantity, order_id, created_by, created_at
    FROM stock_movements
    WHERE product_id = ?
    ORDER BY id DESC
    LIMIT ?
  `),
};

class InsufficientStockError extends Error {
  constructor(productId, available, requested) {
    super(`Недостаточно товара на складе (id=${productId}): доступно ${available}, нужно ${requested}`);
    this.name = "InsufficientStockError";
    this.productId = productId;
    this.available = available;
    this.requested = requested;
  }
}

/**
 * Изменяет остаток товара на delta (может быть отрицательным) внутри уже
 * открытой транзакции (вызывающий код отвечает за BEGIN/COMMIT/ROLLBACK).
 */
function adjustStockInTx({ productId, delta, type, reason, createdBy, orderId }) {
  const product = stmt.getProduct.get(productId);
  if (!product) throw new Error(`Товар не найден: ${productId}`);

  const newQty = product.stock_quantity + delta;
  if (newQty < 0) {
    throw new InsufficientStockError(productId, product.stock_quantity, -delta);
  }

  stmt.updateStock.run(newQty, productId);
  stmt.insertMovement.run(productId, delta, type, reason || null, newQty, orderId || null, createdBy || null);
  return newQty;
}

/** Самостоятельная операция (открывает свою транзакцию) — для ручных правок из админки. */
function adjustStock(params) {
  db.exec("BEGIN");
  try {
    const result = adjustStockInTx(params);
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function getHistory(productId, limit = 50) {
  return stmt.history.all(productId, limit);
}

module.exports = { adjustStock, adjustStockInTx, getHistory, InsufficientStockError };
