import nodemailer from "nodemailer";
import { config } from "./config.js";

let transporter;

function getTransporter() {
  if (!config.smtp.host || !config.smtp.user || !config.smtp.pass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

export function mailIsConfigured() {
  return Boolean(getTransporter());
}

export async function sendPasswordReset({ email, name, token }) {
  const mail = getTransporter();
  if (!mail) return false;
  const url = new URL(config.publicAppUrl);
  url.searchParams.set("reset", token);
  const safeName = String(name || "").replace(/[<>]/g, "");
  await mail.sendMail({
    from: config.smtp.from,
    to: email,
    subject: "Redefinição de senha — Prazo Legal",
    text: `Olá, ${safeName}. Use este link para criar uma nova senha: ${url.toString()}\n\nO link expira em 30 minutos. Se você não fez esta solicitação, ignore esta mensagem.`,
  });
  return true;
}
