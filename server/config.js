import "dotenv/config";

function bool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return value.toLowerCase() === "true";
}

function integer(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(name, fallback = []) {
  const values = (process.env[name] || "").split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? values : fallback;
}

const production = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || "development-only-secret-change-before-production";

if (production && sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET deve ter pelo menos 32 caracteres em produção.");
}

export const config = {
  production,
  port: integer("PORT", 3000),
  publicAppUrl: process.env.PUBLIC_APP_URL || "http://localhost:3000",
  allowedOrigins: [...new Set(list("APP_ORIGINS", ["http://localhost:3000", "http://127.0.0.1:3000"]))],
  databaseUrl: process.env.DATABASE_URL || "postgresql://prazo_legal:altere-esta-senha@localhost:5432/prazo_legal",
  databaseSsl: bool("DATABASE_SSL", false),
  autoMigrate: bool("AUTO_MIGRATE", true),
  sessionSecret,
  sessionMaxAgeMs: integer("SESSION_MAX_AGE_HOURS", 12) * 60 * 60 * 1000,
  cookieSecure: bool("COOKIE_SECURE", production),
  cookieSameSite: (process.env.COOKIE_SAME_SITE || "lax").toLowerCase(),
  allowSignup: bool("ALLOW_SIGNUP", true),
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: integer("SMTP_PORT", 587),
    secure: bool("SMTP_SECURE", false),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "Prazo Legal <nao-responda@example.com>",
  },
};

if (config.cookieSameSite === "none" && !config.cookieSecure) {
  throw new Error("COOKIE_SAME_SITE=none exige COOKIE_SECURE=true.");
}
