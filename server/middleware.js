import { config } from "./config.js";
import { isAllowedOrigin } from "./security.js";

export function requireAuth(request, response, next) {
  if (!request.session?.user?.id) {
    return response.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
  }
  next();
}

export function validateOrigin(request, response, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  const origin = request.get("origin");
  if (!isAllowedOrigin(origin, config.allowedOrigins)) {
    return response.status(403).json({ error: "Origem não autorizada." });
  }
  next();
}

export function apiErrorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);
  if (error?.type === "entity.parse.failed") {
    return response.status(400).json({ error: "JSON inválido." });
  }
  console.error("Erro não tratado:", error);
  response.status(500).json({ error: "Ocorreu um erro interno. Tente novamente." });
}
