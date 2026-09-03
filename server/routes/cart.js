const express = require("express");
const cart = require("../lib/cart");

const router = express.Router();

router.get("/", (req, res) => {
  const cartId = cart.getOrCreateCartId(req, res);
  res.json(cart.buildCartView(cartId));
});

router.post("/items", (req, res) => {
  const cartId = cart.getOrCreateCartId(req, res);
  const { productId, qty } = req.body;
  if (!productId || !Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: "Некорректные данные товара" });
  }
  try {
    const view = cart.addItem(cartId, productId, qty);
    res.json(view);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.patch("/items/:productId", (req, res) => {
  const cartId = cart.getOrCreateCartId(req, res);
  const { qty } = req.body;
  if (!Number.isFinite(qty)) {
    return res.status(400).json({ error: "Некорректное количество" });
  }
  const view = cart.setItemQty(cartId, req.params.productId, qty);
  res.json(view);
});

router.delete("/items/:productId", (req, res) => {
  const cartId = cart.getOrCreateCartId(req, res);
  const view = cart.removeItem(cartId, req.params.productId);
  res.json(view);
});

module.exports = router;
