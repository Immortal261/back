const express = require("express");
const cart = require("../lib/cart");
const orderService = require("../lib/order-service");

const router = express.Router();

router.post("/", async (req, res) => {
  const cartId = cart.getOrCreateCartId(req, res);
  const rawItems = cart.getRawItems(cartId);

  if (rawItems.length === 0) {
    return res.status(400).json({ error: "Корзина пуста" });
  }

  const { name, phone, city, address, comment, paymentMethod } = req.body;

  if (!name || !phone || !city || !address) {
    return res.status(400).json({ error: "Заполните имя, телефон, город и адрес" });
  }
  if (!["kaspi", "card"].includes(paymentMethod)) {
    return res.status(400).json({ error: "Выберите способ оплаты" });
  }

  try {
    const { orderId, totalTenge } = orderService.createOrder({
      cartItems: rawItems,
      contact: { name, phone, city, address, comment },
      paymentMethod,
    });

    const payment = await orderService.initiatePayment(orderId, paymentMethod, totalTenge, {
      name,
      phone,
    });

    cart.clearCart(cartId);

    const order = orderService.getOrderWithItems(orderId);
    res.json({
      order: {
        id: order.id,
        totalTenge: order.total_tenge,
        status: order.status,
        items: order.items,
      },
      payment,
    });
  } catch (e) {
    if (e instanceof orderService.OutOfStockError) {
      return res.status(409).json({
        error: "Часть товаров закончилась или их меньше, чем в корзине. Вы можете связаться с нами по телефону +7 777 363 36 63",
        problems: e.problems,
      });
    }
    const status = e.status || 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: e.message || "Ошибка оформления заказа" });
  }
});

module.exports = router;
