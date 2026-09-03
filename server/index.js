require("dotenv").config();

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

// Инициализирует БД (создаёт таблицы/сидит админа) до подключения роутов
require("./db");

const productsRouter = require("./routes/products");
const cartRouter = require("./routes/cart");
const ordersRouter = require("./routes/orders");
const adminRouter = require("./routes/admin");

const app = express();

app.use(express.json());
app.use(cookieParser());

app.use("/api/products", productsRouter);
app.use("/api/cart", cartRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/admin", adminRouter);

// Отдаём базовую конфигурацию магазина фронтенду (название, телефон и т.п.)
app.get("/api/config", (req, res) => {
  res.json({
    shopName: process.env.SHOP_NAME || "FlexarPPF",
    shopPhone: process.env.SHOP_PHONE || "+7 777 363 36 63",
    shopCity: process.env.SHOP_CITY || "Алматы",
  });
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FlexarPPF запущен: http://localhost:${PORT}`);
});
