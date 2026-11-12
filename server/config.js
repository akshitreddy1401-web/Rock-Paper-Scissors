// config.js: settings shared by the database, validation and auth files (read once from environment variables)
import { randomBytes } from "node:crypto";

export const IS_PROD = process.env.NODE_ENV === "production";

// Secret used to sign login tokens
let secret = process.env.JWT_SECRET;
if (!secret) {
  if (IS_PROD) {
    console.error("JWT_SECRET is required in production (use a random string of 32+ characters).");
    process.exit(1);
  }
  secret = randomBytes(32).toString("hex");
  console.warn("JWT_SECRET is not set: using a temporary one, so logins reset when the server restarts.");
}
if (IS_PROD && secret.length < 32) {
  console.error("JWT_SECRET must be at least 32 characters.");
  process.exit(1);
}
export const SECRET = secret;

// ---------- Login identifiers ----------
export const EMAIL_MAX_LENGTH = 50; // emails longer than this are rejected
export const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || "91"; // used when a mobile number has no +code

// ---------- Password rules ----------
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 30;
