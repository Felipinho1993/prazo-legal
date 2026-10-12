import argon2 from "argon2";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { pool, withTransaction } from "./db.js";
import { requireAuth } from "./middleware.js";
import { mailIsConfigured, sendPasswordReset } from "./mailer.js";
import { createResetToken, hashResetToken, normalizeEmail, publicUser, strongPasswordSchema } from "./security.js";

const router = Router();
const argonOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
const dummyPasswordHash = await argon2.hash("verificacao-de-tempo-constante", argonOptions);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
});

const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Limite de solicitações atingido. Tente novamente mais tarde." },
});

const signupSchema = z.object({
  name: z.string().trim().min(3, "Informe seu nome completo.").max(120),
  email: z.email("Informe um e-mail válido.").transform(normalizeEmail),
  password: strongPasswordSchema,
});

const loginSchema = z.object({
  email: z.email("Informe um e-mail válido.").transform(normalizeEmail),
  password: z.string().min(1, "Informe a senha.").max(128),
  remember: z.boolean().optional().default(false),
});

function validationMessage(result) {
  return result.error.issues[0]?.message || "Dados inválidos.";
}

async function establishSession(request, user, remember = false) {
  await new Promise((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
  request.session.user = { id: user.id };
  if (!remember) {
    request.session.cookie.maxAge = null;
    request.session.cookie.expires = null;
  }
  await new Promise((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()));
}

router.get("/me", async (request, response) => {
  if (!request.session?.user?.id) return response.status(401).json({ error: "Não autenticado." });
  const result = await pool.query(
    "select id, full_name, email from users where id = $1 and is_active = true",
    [request.session.user.id],
  );
  if (!result.rowCount) {
    request.session.destroy(() => {});
    return response.status(401).json({ error: "Não autenticado." });
  }
  response.json({ user: publicUser(result.rows[0]) });
});

router.post("/signup", authLimiter, async (request, response) => {
  if (!config.allowSignup) return response.status(403).json({ error: "Novos cadastros estão desativados." });
  const parsed = signupSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: validationMessage(parsed) });
  const { name, email, password } = parsed.data;
  const passwordHash = await argon2.hash(password, argonOptions);
  try {
    const result = await pool.query(
      `insert into users (full_name, email, password_hash)
       values ($1, $2, $3)
       returning id, full_name, email`,
      [name, email, passwordHash],
    );
    const user = publicUser(result.rows[0]);
    await establishSession(request, user, false);
    response.status(201).json({ user });
  } catch (error) {
    if (error.code === "23505") return response.status(409).json({ error: "Já existe uma conta com este e-mail." });
    throw error;
  }
});

router.post("/login", authLimiter, async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: validationMessage(parsed) });
  const { email, password, remember } = parsed.data;
  const result = await pool.query(
    "select id, full_name, email, password_hash from users where email = $1 and is_active = true",
    [email],
  );
  const row = result.rows[0];
  const valid = await argon2.verify(row?.password_hash || dummyPasswordHash, password);
  if (!row || !valid) return response.status(401).json({ error: "E-mail ou senha incorretos." });
  const user = publicUser(row);
  await establishSession(request, user, remember);
  response.json({ user });
});

router.post("/logout", requireAuth, async (request, response) => {
  await new Promise((resolve) => request.session.destroy(() => resolve()));
  response.clearCookie("prazo.sid", {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
  });
  response.status(204).end();
});

router.post("/request-password-reset", recoveryLimiter, async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const validEmail = z.email().safeParse(email).success;
  if (validEmail && mailIsConfigured()) {
    try {
      const result = await pool.query("select id, full_name, email from users where email = $1 and is_active = true", [email]);
      if (result.rowCount) {
        const user = result.rows[0];
        const token = createResetToken();
        await pool.query("delete from password_reset_tokens where user_id = $1 or expires_at < now()", [user.id]);
        await pool.query(
          "insert into password_reset_tokens (user_id, token_hash, expires_at) values ($1, $2, now() + interval '30 minutes')",
          [user.id, hashResetToken(token)],
        );
        await sendPasswordReset({ email: user.email, name: user.full_name, token });
      }
    } catch (error) {
      console.error("Falha ao enviar recuperação de senha:", error.message);
    }
  }
  response.json({ message: "Se o e-mail estiver cadastrado, você receberá as instruções de recuperação." });
});

router.post("/reset-password", recoveryLimiter, async (request, response) => {
  const parsed = z.object({ token: z.string().min(30).max(200), password: strongPasswordSchema }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: validationMessage(parsed) });
  const passwordHash = await argon2.hash(parsed.data.password, argonOptions);
  const success = await withTransaction(async (client) => {
    const tokenResult = await client.query(
      `select id, user_id from password_reset_tokens
       where token_hash = $1 and used_at is null and expires_at > now()
       for update`,
      [hashResetToken(parsed.data.token)],
    );
    if (!tokenResult.rowCount) return false;
    const token = tokenResult.rows[0];
    await client.query("update users set password_hash = $1, updated_at = now() where id = $2", [passwordHash, token.user_id]);
    await client.query("update password_reset_tokens set used_at = now() where id = $1", [token.id]);
    await client.query("delete from user_sessions where sess->'user'->>'id' = $1", [token.user_id]);
    return true;
  });
  if (!success) return response.status(400).json({ error: "O link é inválido ou expirou." });
  response.json({ message: "Senha atualizada. Você já pode entrar." });
});

export default router;
