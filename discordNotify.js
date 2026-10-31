/**
 * Notificações Discord (Incoming Webhooks) com **embeds** (estilo painel Lua / logger).
 * Prioridade: painel Admin → Revendedores → Discord, depois .env / Vercel.
 */
const https = require('https');
const { URL } = require('url');
require('dotenv').config();

const BRAND = 'Lua Executor';
const EMBED_COLOR = {
  keyGen: 0x57f287, // verde Discord
  keyDel: 0xed4245, // vermelho
  payment: 0xfee75c, // dourado / destaque
};

function normalizeEnvUrl(raw) {
  let s = String(raw || '').trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function webhookFallback() {
  return normalizeEnvUrl(process.env.DISCORD_WEBHOOK);
}

function webhookGenerated() {
  return normalizeEnvUrl(process.env.DISCORD_WEBHOOK_KEY_GENERATED) || webhookFallback();
}
function webhookDeleted() {
  return normalizeEnvUrl(process.env.DISCORD_WEBHOOK_KEY_DELETED) || webhookFallback();
}
function webhookResellerPayment() {
  return (
    normalizeEnvUrl(process.env.DISCORD_WEBHOOK_RESELLER_PAYMENT) ||
    normalizeEnvUrl(process.env.DISCORD_WEBHOOK_PAYMENT) ||
    webhookFallback()
  );
}

function resolveUrlFromPanel(panel, field, envResolver) {
  const p = panel && typeof panel === 'object' ? panel : null;
  const specific = normalizeEnvUrl(p && p[field]);
  if (specific) return specific;
  const fb = normalizeEnvUrl(p && p.fallback);
  if (fb) return fb;
  return envResolver();
}

function isDiscordWebhookUrl(u) {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (!parsed.pathname.startsWith('/api/webhooks/')) return false;
    if (host === 'discord.com' || host.endsWith('.discord.com')) return true;
    if (host === 'discordapp.com' || host.endsWith('.discordapp.com')) return true;
    return false;
  } catch (_) {
    return false;
  }
}

function postHttpsJson(urlString, jsonBody) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlString);
    } catch (e) {
      reject(e);
      return;
    }
    const body = Buffer.from(jsonBody, 'utf8');
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': body.length,
          'User-Agent': 'LuaCorpSite/1.0 (Discord webhook)',
        },
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            statusCode: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            text,
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

function esc(s) {
  return String(s || '').replace(/`/g, '′');
}

function code(v) {
  return '`' + esc(v).slice(0, 990) + '`';
}

function footerNow() {
  const t = new Date().toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return BRAND + ' Logger • ' + t;
}

async function postDiscordPayload(urlGetter, payload, logLabel) {
  const u = typeof urlGetter === 'function' ? urlGetter() : String(urlGetter || '').trim();
  if (!u) {
    if (logLabel) {
      console.warn(
        '[Discord] Webhook não configurado (' +
          logLabel +
          '). Painel Admin → Revendedores → Discord, ou DISCORD_WEBHOOK_* no .env / Vercel.'
      );
    }
    return false;
  }
  if (!isDiscordWebhookUrl(u)) {
    console.error(
      '[Discord] URL inválida (' +
        (logLabel || 'webhook') +
        '). Use https://discord.com/api/webhooks/...'
    );
    return false;
  }
  const body = JSON.stringify(payload);
  if (body.length > 600000) {
    console.error('[Discord] Payload demasiado grande.');
    return false;
  }
  try {
    const host = (() => {
      try {
        return new URL(u).hostname;
      } catch (_) {
        return '?';
      }
    })();
    console.log('[Discord] Enviando', logLabel || 'webhook', '→', host);
    const r = await postHttpsJson(u, body);
    if (!r.ok) {
      console.error('[Discord] HTTP', r.statusCode, logLabel || '', (r.text || '').slice(0, 400));
      return false;
    }
    console.log('[Discord] OK:', logLabel || 'webhook');
    return true;
  } catch (e) {
    console.error('[Discord] Erro (' + (logLabel || 'webhook') + '):', e.message || e);
    return false;
  }
}

function notifyKeyGenerated(p, panel) {
  const actor = p.actor || '—';
  const isReseller = p.source === 'reseller';
  const codes = (p.codes || []).map((c) => String(c));
  const codesStr = codes.length ? codes.map((c) => code(c)).join(' · ') : '`—`';
  const fields = [];
  fields.push({
    name: 'Revendedor',
    value: '👤 ' + code(actor),
    inline: false,
  });
  fields.push({
    name: '📋 Origem',
    value: isReseller ? code('Painel revendedor') : code('Painel admin'),
    inline: true,
  });
  if (p.planLabel) {
    fields.push({ name: '📋 Plano', value: code(p.planLabel), inline: true });
  }
  if (p.price != null && Number.isFinite(Number(p.price))) {
    fields.push({ name: '💵 Valor debitado', value: code('R$ ' + Number(p.price).toFixed(2)), inline: true });
  }
  if (p.expiresInSeconds != null) {
    const s = Number(p.expiresInSeconds);
    const d = Math.floor(s / 86400);
    const dur = d > 0 ? d + ' dia(s)' : s + ' s';
    fields.push({ name: '⏱️ Duração', value: code(dur), inline: true });
  }
  fields.push({
    name: '🔑 Código(s)',
    value: codesStr.slice(0, 1024),
    inline: false,
  });

  const embed = {
    title: '🛡️ ' + BRAND + ' — Notificação',
    description: '**Mensagem:** Key de ativação **gerada**.',
    color: EMBED_COLOR.keyGen,
    fields,
    footer: { text: footerNow() },
    timestamp: new Date().toISOString(),
  };

  return postDiscordPayload(
    () => resolveUrlFromPanel(panel, 'keyGenerated', webhookGenerated),
    { embeds: [embed] },
    'KEY_GENERATED'
  );
}

function notifyKeyDeleted(p, panel) {
  const fields = [];
  if (p.kind === 'bulk_used') {
    fields.push({
      name: '🚫 Limpeza em lote',
      value: code(String(p.count || 0) + ' key(s) já utilizadas removidas'),
      inline: false,
    });
    if (p.codes && p.codes.length) {
      const show = p.codes.slice(0, 12);
      const rest = p.codes.length > 12 ? '\n… +' + (p.codes.length - 12) + ' código(s)' : '';
      fields.push({
        name: '👤 Códigos (amostra)',
        value: (show.map((c) => code(c)).join('\n') + rest).slice(0, 1024),
        inline: false,
      });
    }
  } else {
    const c = p.codes && p.codes[0] ? p.codes[0] : '—';
    fields.push({
      name: '🚫 Key removida',
      value: code(c),
      inline: false,
    });
  }

  const embed = {
    title: '🛡️ ' + BRAND + ' — Notificação',
    description: '**Mensagem:** Key de ativação **apagada**.',
    color: EMBED_COLOR.keyDel,
    fields,
    footer: { text: footerNow() },
    timestamp: new Date().toISOString(),
  };

  return postDiscordPayload(
    () => resolveUrlFromPanel(panel, 'keyDeleted', webhookDeleted),
    { embeds: [embed] },
    'KEY_DELETED'
  );
}

function notifyResellerPayment(p, panel) {
  const fields = [];
  fields.push({
    name: 'Revendedor',
    value: '👤 ' + code(p.username || '—'),
    inline: true,
  });
  fields.push({
    name: '💰 Valor creditado',
    value: code('R$ ' + (p.amount != null ? Number(p.amount).toFixed(2) : '—')),
    inline: true,
  });
  fields.push({
    name: '💳 Saldo após crédito',
    value: code('R$ ' + (p.balance != null ? Number(p.balance).toFixed(2) : '—')),
    inline: true,
  });
  if (p.paymentId) {
    fields.push({
      name: '🆔 Pagamento MP',
      value: code(String(p.paymentId)),
      inline: false,
    });
  }
  fields.push({
    name: '🚫 Pendência / bloqueio',
    value: code('Nenhuma — PIX aprovado'),
    inline: false,
  });

  const embed = {
    title: '💰 ' + BRAND + ' — Saldo adicionado (PIX)',
    description: '**Mensagem:** Recarga **confirmada** via Mercado Pago.',
    color: EMBED_COLOR.payment,
    fields,
    footer: { text: footerNow() },
    timestamp: new Date().toISOString(),
  };

  return postDiscordPayload(
    () => resolveUrlFromPanel(panel, 'resellerPayment', webhookResellerPayment),
    { embeds: [embed] },
    'RESELLER_PAYMENT'
  );
}

module.exports = {
  notifyKeyGenerated,
  notifyKeyDeleted,
  notifyResellerPayment,
};
