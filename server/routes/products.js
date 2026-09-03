const express = require("express");
const db = require("../db");

const router = express.Router();

// Публичное представление товара — НИКОГДА не отдаём stock_quantity,
// историю или что-либо ещё внутреннее (см. требование безопасности).
function toPublicProduct(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    categoryLabel: row.category_label,
    finish: row.finish,
    thicknessMicron: row.thickness_micron,
    warrantyYears: row.warranty_years,
    priceTenge: row.price_tenge,
    unit: row.unit,
    description: row.description,
    tags: row.tags ? JSON.parse(row.tags) : [],
    inStock: row.stock_quantity > 0, // только факт наличия, без точного числа
  };
}

const listStmt = db.prepare("SELECT * FROM products WHERE is_active = 1 ORDER BY rowid");
const listByCategoryStmt = db.prepare("SELECT * FROM products WHERE is_active = 1 AND category = ? ORDER BY rowid");
const getStmt = db.prepare("SELECT * FROM products WHERE id = ? AND is_active = 1");

router.get("/", (req, res) => {
  const { category } = req.query;
  const rows = category ? listByCategoryStmt.all(category) : listStmt.all();
  res.json(rows.map(toPublicProduct));
});

router.get("/:id", (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Товар не найден" });
  res.json(toPublicProduct(row));
});

module.exports = router;
