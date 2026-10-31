/**
 * Envio de e-mail para recuperação de senha do revendedor (SMTP via nodemailer).
 * Configure: SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (0|1), SMTP_USER, SMTP_PASS, SMTP_FROM
 */
'use strict';

function getTransport() {
  const host = process.env.SMTP_HOST && String(process.env.SMTP_HOST).trim();
  if (!host) return null;
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (_) {
    return null;
  }
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER && String(process.env.SMTP_USER).trim();
  const pass = process.env.SMTP_PASS != null ? String(process.env.SMTP_PASS) : '';
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });
}

function isSmtpConfigured() {
  return !!(process.env.SMTP_HOST && String(process.env.SMTP_HOST).trim());
}

async function sendResellerPasswordResetEmail(to, resetUrl) {
  const transport = getTransport();
  const from =
    (process.env.SMTP_FROM && String(process.env.SMTP_FROM).trim()) ||
    (process.env.SMTP_USER && String(process.env.SMTP_USER).trim()) ||
    'noreply@localhost';
  if (!transport) {
    console.warn('[resellerMail] SMTP não configurado ou nodemailer indisponível. Link de redefinição:', resetUrl);
    return { ok: false, skipped: true };
  }
  await transport.sendMail({
    from,
    to: String(to).trim(),
    subject: 'Redefinição de senha — Painel revendedor',
    text:
      'Olá,\n\n' +
      'Para definir uma nova senha no painel de revendedor, abra este link (válido por 1 hora):\n\n' +
      resetUrl +
      '\n\n' +
      'Se não pediu a redefinição, ignore este e-mail.\n',
    html:
      '<p>Olá,</p>' +
      '<p>Para definir uma nova senha no painel de <strong>revendedor</strong>, use o botão abaixo. O link expira em <strong>1 hora</strong>.</p>' +
      '<p><a href="' +
      resetUrl.replace(/"/g, '&quot;') +
      '">Redefinir senha</a></p>' +
      '<p>Se não pediu a redefinição, ignore este e-mail.</p>',
  });
  return { ok: true };
}

module.exports = { sendResellerPasswordResetEmail, isSmtpConfigured };
