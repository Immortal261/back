const crypto = require("crypto");
const db = require("../db");

// Корзины живут в памяти процесса, ключ — cartId из cookie.
// Остаток НЕ резервируется в момент добавления в корзину — только мягкая
// проверка при оформлении заказа (см. order-service.js). Это осознанный
// компромисс для небольшого магазина: если что-то разберут за секунды
// между добавлением в корзину и оплатой — заказ будет отклонён на чекауте
// с понятной ошибкой, а не молча продан в минус.

const carts = new Map(); // cartId -> { items: [{ productId, qty }] }

const getProductStmt = db.prepare("SELECT * FROM products WHERE id = ? AND is_active = 1");

function getOrCreateCartId(req, res) {
  let cartId = req.cookies.cartId;
  if (!cartId || !carts.has(cartId)) {
    cartId = crypto.randomUUID();
    carts.set(cartId, { items: [] });
    res.cookie("cartId", cartId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 дней
    });
  }
  return cartId;
}

function getCartRaw(cartId) {
  if (!carts.has(cartId)) carts.set(cartId, { items: [] });
  return carts.get(cartId);
}

function buildCartView(cartId) {
  const cart = getCartRaw(cartId);

  const items = cart.items
    .map((item) => {
      const product = getProductStmt.get(item.productId);
      if (!product) return null;
      return {
        productId: product.id,
        name: product.name,
        categoryLabel: product.category_label,
        unit: product.unit,
        priceTenge: product.price_tenge,
        qty: item.qty,
        lineTotal: product.price_tenge * item.qty,
        inStock: product.stock_quantity > 0,
      };
    })
    .filter(Boolean);

  const totalTenge = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const totalItems = items.reduce((sum, i) => sum + i.qty, 0);

  return { items, totalTenge, totalItems };
}

function addItem(cartId, productId, qty) {
  const product = getProductStmt.get(productId);
  if (!product) {
    const err = new Error("Товар не найден");
    err.status = 404;
    throw err;
  }
  const cart = getCartRaw(cartId);
  const existing = cart.items.find((i) => i.productId === productId);
  if (existing) existing.qty += qty;
  else cart.items.push({ productId, qty });
  return buildCartView(cartId);
}

function setItemQty(cartId, productId, qty) {
  const cart = getCartRaw(cartId);
  if (qty <= 0) {
    cart.items = cart.items.filter((i) => i.productId !== productId);
  } else {
    const existing = cart.items.find((i) => i.productId === productId);
    if (existing) existing.qty = qty;
    else cart.items.push({ productId, qty });
  }
  return buildCartView(cartId);
}

function removeItem(cartId, productId) {
  const cart = getCartRaw(cartId);
  cart.items = cart.items.filter((i) => i.productId !== productId);
  return buildCartView(cartId);
}

function clearCart(cartId) {
  carts.set(cartId, { items: [] });
}

function getRawItems(cartId) {
  return getCartRaw(cartId).items;
}

module.exports = {
  getOrCreateCartId,
  buildCartView,
  addItem,
  setItemQty,
  removeItem,
  clearCart,
  getRawItems,
};
