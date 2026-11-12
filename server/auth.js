// auth.js: authentication (who are you?) and authorization helpers (what may you do?)
// People register and log in with their email or mobile number plus a password (letters and numbers only).
// Database tables live in db.js; input checks in validate.js; settings in config.js.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { User, write } from "./db.js";
import { parseIdentifier, usernameProblem, passwordProblem } from "./validate.js";
import { SECRET, IS_PROD } from "./config.js";

const scrypt = promisify(scryptCb);

// Lets async route handlers pass errors to Express
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Cookie settings ----------
const COOKIE = "rps_token";
const WEEK = 7 * 24 * 60 * 60 * 1000;
const cookieOptions = {
  httpOnly: true, // JavaScript on the page can't read it (protects against XSS theft)
  sameSite: "strict", // not sent on cross-site requests (protects against CSRF)
  secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : IS_PROD, // HTTPS only online
  maxAge: WEEK,
  path: "/",
};

// ---------- Passwords (scrypt: slow, salted, built into Node) ----------
const N = 16384, R = 8, P = 1, KEYLEN = 64;

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(password, stored) {
  const [alg, n, r, p, saltB64, keyB64] = String(stored).split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: +n, r: +r, p: +p });
  return timingSafeEqual(key, expected);
}

// Used when the account doesn't exist, so the response time doesn't reveal that
const DUMMY_HASH = await hashPassword(randomBytes(8).toString("hex"));

// ---------- Tokens ----------
function issueToken(res, user) {
  const token = jwt.sign({ sub: user.id, v: user.tokenVersion }, SECRET, { algorithm: "HS256", expiresIn: "7d" });
  res.cookie(COOKIE, token, cookieOptions);
  return token;
}

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  phone: u.phone,
  role: u.role,
  wins: u.wins,
  losses: u.losses,
  draws: u.draws,
});

// ---------- Middleware ----------
// Authentication: finds the logged-in user from the cookie (website) or Authorization header (API tools)
export const requireAuth = h(async (req, res, next) => {
  const header = req.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "Not logged in" });

  let payload;
  try {
    payload = jwt.verify(token, SECRET, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ error: "Session expired, please log in again" });
  }
  // Always re-check the database, so deleted users and "log out everywhere" take effect immediately
  const user = await User.findByPk(payload.sub);
  if (!user || user.tokenVersion !== payload.v) {
    return res.status(401).json({ error: "Session expired, please log in again" });
  }
  req.user = user;
  next();
});

// Authorization by role
export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: "You don't have permission to do that" });

// ---------- Routes ----------
const limiterBase = { windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts, try again later" } };
const registerLimiter = rateLimit(limiterBase);
const loginLimiter = rateLimit({ ...limiterBase, skipSuccessfulRequests: true }); // only failed logins count

// The email / mobile number that gets the admin role when it registers (optional)
const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPhone = parseIdentifier(process.env.ADMIN_PHONE || "")?.target;

export const authRouter = Router();

// Register with a name, an email OR mobile number, and a password
authRouter.post("/register", registerLimiter, h(async (req, res) => {
  const { username, identifier, password } = req.body ?? {};
  const id = parseIdentifier(identifier);
  if (!id) return res.status(400).json({ error: "Enter a valid email (max 50 characters) or mobile number" });
  const problem = usernameProblem(username) || passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  const field = id.channel === "email" ? "email" : "phone";
  const usernameKey = username.toLowerCase();
  if (await User.findOne({ where: { usernameKey } })) return res.status(409).json({ error: "Username is already taken" });
  if (await User.findOne({ where: { [field]: id.target } })) {
    return res.status(409).json({ error: `This ${id.channel === "email" ? "email" : "mobile number"} is already registered` });
  }

  const passwordHash = await hashPassword(password);
  const isAdmin = id.target === (id.channel === "email" ? adminEmail : adminPhone);
  let user;
  try {
    user = await write((t) =>
      User.create({ username, usernameKey, [field]: id.target, passwordHash, role: isAdmin ? "admin" : "user" }, { transaction: t })
    );
  } catch (e) {
    if (e.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ error: "Username, email or mobile number is already registered" });
    }
    throw e;
  }
  const token = issueToken(res, user);
  res.status(201).json({ user: publicUser(user), token });
}));

// Log in with email OR mobile number, plus password
authRouter.post("/login", loginLimiter, h(async (req, res) => {
  const { identifier, password } = req.body ?? {};
  const id = parseIdentifier(identifier);
  const user =
    id && typeof password === "string"
      ? await User.findOne({ where: { [id.channel === "email" ? "email" : "phone"]: id.target } })
      : null;
  const ok = await verifyPassword(String(password ?? ""), user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: "Invalid email / mobile number or password" });

  const token = issueToken(res, user);
  res.json({ user: publicUser(user), token });
}));

const { maxAge, ...clearOptions } = cookieOptions;

authRouter.post("/logout", (req, res) => {
  res.clearCookie(COOKIE, clearOptions);
  res.json({ ok: true });
});

// Ends every session of this account (all devices)
authRouter.post("/logout-all", requireAuth, h(async (req, res) => {
  await write((t) => req.user.increment("tokenVersion", { transaction: t }));
  res.clearCookie(COOKIE, clearOptions);
  res.json({ ok: true });
}));

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});
