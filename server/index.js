import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import connectPgSimple from "connect-pg-simple";
import cors from "cors";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import authRouter from "./auth.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import eventsRouter from "./events.js";
import { apiErrorHandler, validateOrigin } from "./middleware.js";
import { migrate } from "./migrate.js";
import { mailIsConfigured } from "./mailer.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(currentDir, "..", "public");
const PostgreSqlStore = connectPgSimple(session);

if (config.autoMigrate) await migrate();

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", ...config.allowedOrigins],
      upgradeInsecureRequests: config.production ? [] : null,
    },
  },
  crossOriginResourcePolicy: { policy: "same-site" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));
app.use(compression());
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, false);
  },
}));
app.use(express.json({ limit: "32kb" }));
app.use(session({
  name: "prazo.sid",
  store: new PostgreSqlStore({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15,
  }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    maxAge: config.sessionMaxAgeMs,
    path: "/",
  },
}));
app.use("/api", (request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  next();
});
app.use("/api", validateOrigin);

app.get("/api/health", async (request, response) => {
  await pool.query("select 1");
  response.json({ status: "ok", database: "connected", time: new Date().toISOString() });
});
app.use("/api/auth", authRouter);
app.use("/api/events", eventsRouter);
app.use("/api", (request, response) => response.status(404).json({ error: "Rota não encontrada." }));

app.use(express.static(publicDir, {
  dotfiles: "ignore",
  etag: true,
  index: "index.html",
  maxAge: config.production ? "1h" : 0,
  setHeaders(response, filePath) {
    if (filePath.endsWith("config.js") || filePath.endsWith("service-worker.js")) {
      response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  },
}));

app.use((request, response, next) => {
  if (request.method === "GET" && request.accepts("html")) return response.sendFile(path.join(publicDir, "index.html"));
  next();
});

app.use(apiErrorHandler);

const server = app.listen(config.port, () => {
  console.log(`Prazo Legal disponível em http://localhost:${config.port}`);
  console.log(`Banco: conectado • Recuperação de senha: ${mailIsConfigured() ? "configurada" : "aguardando SMTP"}`);
});

async function shutdown(signal) {
  console.log(`\n${signal}: encerrando servidor...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app };
