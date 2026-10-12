import assert from "node:assert/strict";
import test from "node:test";
import { eventSchema } from "../server/events.js";
import { hashResetToken, isAllowedOrigin, normalizeEmail, strongPasswordSchema } from "../server/security.js";

test("normaliza e-mail antes da autenticação", () => {
  assert.equal(normalizeEmail("  ADVOGADO@EXEMPLO.COM  "), "advogado@exemplo.com");
});

test("exige senha longa e aceita frase-senha", () => {
  assert.equal(strongPasswordSchema.safeParse("curta").success, false);
  assert.equal(strongPasswordSchema.safeParse("Uma frase segura 2026").success, true);
});

test("hash de token é determinístico e não expõe o token", () => {
  const token = "token-super-secreto-com-entropia";
  const hash = hashResetToken(token);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
  assert.equal(hash, hashResetToken(token));
});

test("valida a origem contra a lista permitida", () => {
  const origins = ["https://agenda.exemplo.com"];
  assert.equal(isAllowedOrigin("https://agenda.exemplo.com", origins), true);
  assert.equal(isAllowedOrigin("https://site-malicioso.test", origins), false);
});

test("aceita compromisso válido e rejeita tipo arbitrário", () => {
  const base = {
    id: "0d56319b-0f8d-487a-9dbe-fdb69aa188b6",
    title: "Apresentar contestação",
    type: "prazo",
    date: "2026-10-13",
    time: "18:00",
    status: "pending",
    priority: true,
  };
  assert.equal(eventSchema.safeParse(base).success, true);
  assert.equal(eventSchema.safeParse({ ...base, type: "qualquer" }).success, false);
});
