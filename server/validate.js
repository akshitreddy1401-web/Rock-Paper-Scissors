// validate.js: checks what people type (email / mobile number, username, password). No database or login logic.
import { EMAIL_MAX_LENGTH, DEFAULT_COUNTRY_CODE, PASSWORD_MIN, PASSWORD_MAX } from "./config.js";

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

// Returns { channel: "email" | "phone", target } in a standard form, or null when it isn't a valid email / mobile number.
// Mobile numbers are saved as +<country code><number>. Without a +code, DEFAULT_COUNTRY_CODE is used.
export function parseIdentifier(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.includes("@")) {
    const email = text.toLowerCase();
    return email.length <= EMAIL_MAX_LENGTH && EMAIL_RE.test(email) ? { channel: "email", target: email } : null;
  }
  const digits = text.replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(digits)) return null;
  let phone;
  if (digits.startsWith("+")) phone = digits;
  else if (DEFAULT_COUNTRY_CODE === "91" && digits.length === 12 && digits.startsWith("91")) phone = "+" + digits;
  else if (DEFAULT_COUNTRY_CODE === "91" && digits.length === 11 && digits.startsWith("0")) phone = "+91" + digits.slice(1);
  else phone = "+" + DEFAULT_COUNTRY_CODE + digits;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  if (phone.startsWith("+91") && !/^\+91[6-9]\d{9}$/.test(phone)) return null; // Indian mobiles: 10 digits starting 6-9
  return { channel: "phone", target: phone };
}

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const usernameProblem = (u) =>
  typeof u === "string" && USERNAME_RE.test(u) ? null : "Name must be 3-20 letters, numbers or underscores";

// Passwords: only letters and numbers (A-Z, a-z, 0-9), no spaces or symbols
const PASSWORD_RE = new RegExp(`^[A-Za-z0-9]{${PASSWORD_MIN},${PASSWORD_MAX}}$`);
export const passwordProblem = (p) =>
  typeof p === "string" && PASSWORD_RE.test(p)
    ? null
    : `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters, only letters and numbers`;
