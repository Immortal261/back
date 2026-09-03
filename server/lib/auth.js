// Простые сессии в памяти процесса (без внешних зависимостей вроде
// express-session). Для одного администратора/небольшой команды этого
// достаточно. Ограничение: при перезапуске сервера все сессии сбрасываются
// (нужно будет перелогиниться) — это осознанный компромисс для MVP.

const crypto = require("crypto");
const db = require("../db");
const { verifyPassword } = require("./password");

const SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов

const sessions = new Map(); // sessionId -> { username, expiresAt }

const getAdmin = db.prepare("SELECT * FROM admin_users WHERE username = ?");

function login(username, password) {
  const admin = getAdmin.get(username);
  if (!admin) return null;
  if (!verifyPassword(password, admin.password_hash)) return null;

  const sessionId = crypto.randomBytes(24).toString("hex");
  sessions.set(sessionId, { username: admin.username, expiresAt: Date.now() + SESSION_TTL_MS });
  return sessionId;
}

function logout(sessionId) {
  sessions.delete(sessionId);
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

/** Express middleware: требует валидную сессию администратора. */
function requireAdmin(req, res, next) {
  const sessionId = req.cookies[SESSION_COOKIE];
  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "Требуется авторизация администратора" });
  }
  req.admin = { username: session.username };
  next();
}

module.exports = { login, logout, getSession, requireAdmin, SESSION_COOKIE };
