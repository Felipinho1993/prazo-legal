import crypto from "node:crypto";
import { z } from "zod";

export const strongPasswordSchema = z.string()
  .min(10, "A senha deve ter pelo menos 10 caracteres.")
  .max(128, "A senha deve ter no máximo 128 caracteres.");

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function hashResetToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function createResetToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

export function publicUser(row) {
  return { id: row.id, name: row.full_name, email: row.email };
}
