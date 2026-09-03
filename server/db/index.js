// Инициализация SQLite (встроенный node:sqlite, без внешних npm-зависимостей).
// Требует Node.js 22.5+. При старте создаёт таблицы, если их ещё нет,
// один раз переносит товары из старого server/data/products.json (если БД
// пустая) и создаёт первого администратора из .env (или генерирует пароль).

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (e) {
  console.error(
    "\n[FlexarPPF] Не найден встроенный модуль node:sqlite.\n" +
      "Нужен Node.js версии 22.5 или новее (у вас: " + process.version + ").\n" +
      "Обновите Node.js (например через nvm: `nvm install 22 && nvm use 22`).\n"
  );
  throw e;
}

const { hashPassword } = require("../lib/password");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "shop.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  category_label TEXT,
  finish TEXT,
  thickness_micron INTEGER,
  warranty_years INTEGER,
  price_tenge INTEGER NOT NULL,
  unit TEXT,
  description TEXT,
  tags TEXT,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_city TEXT NOT NULL,
  contact_address TEXT NOT NULL,
  comment TEXT,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  total_tenge INTEGER NOT NULL,
  paid_at TEXT,
  cancelled_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price_tenge INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  line_total_tenge INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_tenge INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id),
  change_qty INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'restock' | 'sale' | 'adjustment'
  reason TEXT,
  resulting_quantity INTEGER NOT NULL,
  order_id TEXT REFERENCES orders(id),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
`;

db.exec(SCHEMA);

// --- Разовая миграция товаров из старого JSON-файла, если таблица пустая ---
function migrateProductsFromJson() {
  const countRow = db.prepare("SELECT COUNT(*) AS c FROM products").get();
  if (countRow.c > 0) return;

  const jsonPath = path.join(DATA_DIR, "products.json");
  if (!fs.existsSync(jsonPath)) return;

  const items = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const insert = db.prepare(`
    INSERT INTO products
      (id, name, category, category_label, finish, thickness_micron, warranty_years,
       price_tenge, unit, description, tags, stock_quantity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    for (const p of items) {
      insert.run(
        p.id,
        p.name,
        p.category || null,
        p.categoryLabel || null,
        p.finish || null,
        p.thicknessMicron || null,
        p.warrantyYears || null,
        p.priceTenge,
        p.unit || null,
        p.description || null,
        JSON.stringify(p.tags || []),
        // Стартовый остаток не был предусмотрен в старой системе — ставим 0,
        // администратор указывает реальное количество через "Изменить остаток".
        0
      );
    }
    db.exec("COMMIT");
    console.log(`[FlexarPPF] Перенесено товаров из products.json: ${items.length} (остаток у всех = 0, укажите в админке)`);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

migrateProductsFromJson();

// --- Сид первого администратора ---
function seedAdmin() {
  const countRow = db.prepare("SELECT COUNT(*) AS c FROM admin_users").get();
  if (countRow.c > 0) return;

  const username = process.env.ADMIN_USERNAME || "admin";
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;

  if (!password) {
    password = crypto.randomBytes(9).toString("base64url");
    generated = true;
  }

  db.prepare("INSERT INTO admin_users (username, password_hash) VALUES (?, ?)").run(
    username,
    hashPassword(password)
  );

  console.log("\n========================================");
  console.log("[FlexarPPF] Создан администратор:");
  console.log("  логин:  ", username);
  if (generated) {
    console.log("  пароль: ", password, " (сгенерирован автоматически — сохраните его!)");
    console.log("  Чтобы задать свой пароль — впишите ADMIN_USERNAME/ADMIN_PASSWORD в .env и удалите server/data/shop.db, затем перезапустите.");
  } else {
    console.log("  пароль: тот, что указан в .env (ADMIN_PASSWORD)");
  }
  console.log("========================================\n");
}

seedAdmin();

module.exports = db;
