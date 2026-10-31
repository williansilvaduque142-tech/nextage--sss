/**
 * Silva Key Website - Backend
 * Serve o painel e a API de keys. GET /keys.json retorna só IDs válidos (não expirados) para o loader.
 * Na Vercel: use BLOB_READ_WRITE_TOKEN para persistir dados (senão /tmp é efêmero e tudo some).
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { sendResellerPasswordResetEmail, isSmtpConfigured } = require('./resellerMail');
const { mountLoaderClientProtection } = require('./loaderClientAuth');
const {
  notifyKeyGenerated,
  notifyKeyDeleted,
  notifyResellerPayment,
} = require('./discordNotify');
const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === '0' ? false : 1);
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || '21';
const SERVER_ID = crypto.randomBytes(4).toString('hex');
const PANEL_PRESENCE_TTL_MS = Math.max(15000, parseInt(process.env.PANEL_PRESENCE_TTL_MS || '90000', 10));
const LOADER_PRESENCE_TTL_MS = Math.max(60000, parseInt(process.env.LOADER_PRESENCE_TTL_MS || '600000', 10));
const ACTIVITY_LIMIT = 60;
const ACTIVITY_SSE_PING_MS = 25000;

/** Mensagem segura para o cliente quando o ping ao SQL falha (sem credenciais). */
function sanitizeDbPingError(e) {
  if (!e) return 'Falha ao ligar ao banco de dados.';
  const code = e.code || e.errno;
  const msg = String(e.message || e.sqlMessage || '');
  if (code === 'ECONNREFUSED') {
    return 'Ligação recusada. Se o Node corre no seu PC e o MySQL está na Hostinger, não use localhost: use o hostname MySQL do painel e autorize o seu IP em "Acesso remoto MySQL".';
  }
  if (code === 'ENOTFOUND') return 'Host MySQL desconhecido (DNS). Verifique MYSQL_HOST.';
  if (code === 'ETIMEDOUT') return 'Timeout ao ligar ao MySQL (firewall, host errado ou servidor offline).';
  if (code === 'ER_ACCESS_DENIED_ERROR' || /access denied/i.test(msg)) {
    return 'MySQL: acesso negado — utilizador/senha incorretos ou utilizador sem permissão a partir deste IP.';
  }
  if (code === 'ER_BAD_DB_ERROR' || /unknown database/i.test(msg)) {
    return 'Base de dados inexistente. Verifique MYSQL_DATABASE.';
  }
  if (/SSL|ssl|TLS|tls/.test(msg)) {
    return 'Erro de SSL com o MySQL. Experimente MYSQL_SSL=1 (e se necessário MYSQL_SSL_REJECT_UNAUTHORIZED=0).';
  }
  return msg.length > 240 ? msg.slice(0, 240) + '…' : msg;
}

const activityClients = new Set();
let activityCache = [];
let activityCacheLoaded = false;

function usernameKey(name) {
  return String(name || '').trim().toLowerCase();
}
/** Conta principal: qualquer capitalização (silva, Silva, SILVA) = sempre dono */
function isSilvaUser(name) {
  return usernameKey(name) === 'silva';
}
function findUserRow(users, name) {
  const k = usernameKey(name);
  return users.find((x) => usernameKey(x.username) === k);
}

function parseLastLogin(value) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return null;
  return ts;
}

function isOnlineByLastLogin(lastLoginAt, ttlMs, now) {
  const ts = parseLastLogin(lastLoginAt);
  if (!ts) return false;
  const age = (now != null ? now : Date.now()) - ts;
  return age <= ttlMs;
}

function buildActivityId() {
  return Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

function normalizeActivityItem(raw, fallbackActor) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const title = String(data.title || 'Atividade');
  const detail = String(data.detail || '');
  const actor = String(data.actor || data.user || data.username || fallbackActor || '').trim() || 'Sistema';
  let createdAt = data.createdAt;
  if (createdAt) {
    const d = new Date(createdAt);
    createdAt = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } else {
    createdAt = new Date().toISOString();
  }
  const id = String(data.id || '').trim() || buildActivityId();
  return { id, title, detail, actor, createdAt };
}

async function loadActivityLog() {
  if (activityCacheLoaded) return activityCache;
  try {
    if (typeof store.loadActivityLog === 'function') {
      const list = await store.loadActivityLog();
      activityCache = Array.isArray(list) ? list.map((item) => normalizeActivityItem(item)) : [];
    } else {
      activityCache = [];
    }
  } catch (_) {
    activityCache = [];
  }
  activityCacheLoaded = true;
  return activityCache;
}

async function saveActivityLog(list) {
  const items = Array.isArray(list) ? list : [];
  activityCache = items;
  activityCacheLoaded = true;
  if (typeof store.saveActivityLog === 'function') {
    try {
      await store.saveActivityLog(items);
    } catch (_) {}
  }
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastActivity(item) {
  for (const client of Array.from(activityClients)) {
    try {
      sendSse(client.res, 'activity', item);
    } catch (_) {
      activityClients.delete(client);
    }
  }
}

async function appendActivity(rawItem, fallbackActor) {
  const item = normalizeActivityItem(rawItem, fallbackActor);
  const list = await loadActivityLog();
  list.unshift(item);
  if (list.length > ACTIVITY_LIMIT) list.length = ACTIVITY_LIMIT;
  await saveActivityLog(list);
  broadcastActivity(item);
  return item;
}

async function updateUserLastLogin(username, value) {
  const user = String(username || '').trim();
  if (!user) return;
  if (store.USE_MYSQL || store.USE_SQL || store.USE_SQLITE) {
    await store.touchAdminUserLastLogin(user, value);
    return;
  }
  const key = usernameKey(user);
  let users = await loadPanelUsers();
  let changed = false;
  const updated = users.map((u) => {
    if (usernameKey(u.username) !== key) return u;
    changed = true;
    return { ...u, lastLoginAt: value };
  });
  if (changed) await store.saveUsers(updated);
}

async function touchUserLastLogin(username) {
  return updateUserLastLogin(username, new Date().toISOString());
}

async function clearUserLastLogin(username) {
  return updateUserLastLogin(username, null);
}

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(String(pwd)).digest('hex');
}

/** Utilizadores embutidos do painel (linhas em silva_users). */
function isBuiltinPanelUsername(name) {
  return ['admin', 'silva'].includes(usernameKey(name));
}

/**
 * Valida senha do painel: contas admin/silva aceitam ADMIN_SECRET em texto OU o hash guardado na base.
 * Outras contas só por hash SHA-256 (igual ao que o painel grava).
 */
function panelPasswordMatches(row, plainPassword) {
  if (!row) return false;
  const pwd = String(plainPassword || '');
  const stored = String(row.passwordHash || '').trim();
  if (isBuiltinPanelUsername(row.username) && pwd === ADMIN_SECRET) return true;
  if (!stored) return false;
  return hashPassword(pwd) === stored;
}

function normalizeRecoveryEmail(s) {
  return String(s || '').trim().toLowerCase();
}
function isValidEmailBasic(s) {
  const t = String(s || '').trim();
  if (t.length < 5 || t.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}
function publicBaseUrl(req) {
  const b = process.env.PUBLIC_BASE_URL;
  if (b && String(b).trim()) return String(b).trim().replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = req.get('host') || 'localhost';
  return `${proto}://${host}`;
}

/** Para testar redefinição sem e-mail: expor o link na resposta JSON (nunca em produção). */
function shouldExposeResetLinkForLocalTesting(req) {
  if (process.env.NODE_ENV === 'production') return false;
  if (String(process.env.DEV_SHOW_RESET_LINK || '').trim() === '1') return true;
  if (!isSmtpConfigured()) {
    const host = String(req.get('host') || '').toLowerCase();
    if (/^localhost(:\d+)?$/.test(host) || /^127\.0\.0\.1(:\d+)?$/.test(host)) return true;
  }
  return false;
}

const SECRET_PHRASE_MAX_LEN = 200;

/** Se não há hash guardado, o login não exige palavra-chave até ser definida no perfil. */
function secretPhraseMatches(storedHash, provided) {
  const s = String(storedHash || '').trim();
  if (!s) return true;
  const p = String(provided || '').trim();
  if (!p) return false;
  return hashPassword(p) === s;
}

async function validateLoaderCredentials(username, password, hwid) {
  const user = String(username || '').trim();
  const pwd = String(password || '').trim();
  const id = typeof hwid === 'string' ? hwid.trim() : '';
  if (!user || !pwd || !id) {
    return { ok: false, status: 400, message: 'Usuario, senha e HWID obrigatorios.' };
  }
  const accounts = await store.loadLoaderAccounts();
  const acc = accounts.find((a) => a.username === user);
  if (!acc) {
    return { ok: false, message: 'Usuario ou senha incorretos.' };
  }
  if (acc.passwordHash !== hashPassword(pwd)) {
    return { ok: false, message: 'Usuario ou senha incorretos.' };
  }
  if (acc.paused) {
    return { ok: false, message: 'Conta pausada.' };
  }
  const now = getEffectiveNowFromState(await getPauseState());
  if (acc.expiresAt) {
    const end = new Date(acc.expiresAt).getTime();
    if (now >= end) {
      return { ok: false, message: 'Licenca expirada.' };
    }
  }
  let allowSetHwid = false;
  if (acc.skipHwidCheck) {
    allowSetHwid = true;
  } else if (!acc.hwid) {
    allowSetHwid = true;
  } else if (acc.hwid !== id) {
    return { ok: false, message: 'Este login esta vinculado a outro PC (HWID). Peca reset de HWID ao admin.' };
  }
  return { ok: true, accounts, acc, now, allowSetHwid, hwid: id };
}

/**
 * Garante contas admin/silva e cargos — corre no máximo 1× por processo (evita DELETE+INSERT em loop no MySQL → 503).
 */
let panelUsersSeedPromise = null;
function ensurePanelUsersOnce() {
  if (!panelUsersSeedPromise) {
    panelUsersSeedPromise = ensureDefaultUsers().catch((e) => {
      panelUsersSeedPromise = null;
      throw e;
    });
  }
  return panelUsersSeedPromise;
}

/** Utilizadores do painel (após seed único). */
async function loadPanelUsers() {
  await ensurePanelUsersOnce();
  return store.loadUsers();
}

async function ensureDefaultUsers() {
  let users = await store.loadUsers();
  const secretHash = hashPassword(ADMIN_SECRET);

  if (users.length === 0) {
    users = [
      { username: 'admin', passwordHash: secretHash, lastLoginAt: null, role: 'owner' },
      { username: 'silva', passwordHash: secretHash, lastLoginAt: null, role: 'owner' },
    ];
    await store.saveUsers(users);
    return users;
  }

  const existingKeys = new Set(users.map((u) => usernameKey(u.username)));
  let changed = false;
  for (const name of ['admin', 'silva']) {
    if (!existingKeys.has(name)) {
      users.push({ username: name, passwordHash: secretHash, lastLoginAt: null, role: 'owner' });
      existingKeys.add(name);
      changed = true;
    }
  }

  users = users.map((u) => {
    let u2 = { ...u };
    if (isBuiltinPanelUsername(u2.username)) {
      if (!u2.passwordHash || String(u2.passwordHash).trim() === '') {
        u2.passwordHash = secretHash;
        changed = true;
      }
    }
    const canonical = normalizeUserRole(u2);
    if (u2.role !== canonical) {
      u2 = { ...u2, role: canonical };
      changed = true;
    }
    return u2;
  });

  if (changed) await store.saveUsers(users);
  return users;
}

/**
 * Cargo no painel (coluna silva_users.role).
 * No MySQL pode usar: owner ou dono | staff ou admin | ajudante ou suporte
 */
function normalizeUserRole(row) {
  if (!row || !row.username) return 'staff';
  if (isSilvaUser(row.username)) return 'owner';
  const uk = usernameKey(row.username);
  const raw = row.role;
  const r = raw != null && String(raw).trim() !== '' ? String(raw).trim().toLowerCase() : '';
  if (!r && uk === 'admin') return 'owner';
  if (!r) return 'staff';
  if (r === 'owner' || r === 'dono') return 'owner';
  if (r === 'staff' || r === 'admin') return 'staff';
  if (r === 'ajudante' || r === 'suporte') return 'ajudante';
  return 'staff';
}

/** Body.role: dono|admin|suporte ou owner|staff|ajudante → owner|staff|ajudante; inválido → null */
function parseRoleFromRequest(body) {
  const role = String((body && body.role) || '').trim().toLowerCase();
  if (!role) return null;
  if (role === 'owner' || role === 'dono') return 'owner';
  if (role === 'staff' || role === 'admin') return 'staff';
  if (role === 'ajudante' || role === 'suporte') return 'ajudante';
  return null;
}

async function verifyAdmin(req) {
  const secret = req.headers['x-admin-secret'];
  if (secret === ADMIN_SECRET) return true;
  const user = (req.headers['x-admin-user'] || '').trim();
  const pwd = (req.headers['x-admin-password'] || '').trim();
  const phrase = String(req.headers['x-admin-secret-phrase'] || '').trim();
  if (!user || !pwd) return false;
  const users = await loadPanelUsers();
  const found = findUserRow(users, user);
  if (!found || !panelPasswordMatches(found, pwd)) return false;
  if (found.secretPhraseHash) {
    return secretPhraseMatches(found.secretPhraseHash, phrase);
  }
  return true;
}

function requireAuth(req, res, next) {
  Promise.resolve(verifyAdmin(req))
    .then((ok) => {
      if (!ok) return res.status(401).json({ error: 'Não autorizado' });
      next();
    })
    .catch(() => res.status(500).json({ error: 'Erro ao verificar autorização' }));
}

function requireOwner(req, res, next) {
  (async () => {
    const u = getAdminPanelUser(req);
    let users = await loadPanelUsers();
    const row = findUserRow(users, u);
    if (!row || normalizeUserRole(row) !== 'owner') {
      return res.status(403).json({ error: 'Apenas o dono do painel pode aceder a isto.' });
    }
    next();
  })().catch(() => res.status(500).json({ error: 'Erro ao verificar cargo' }));
}

/** Dono ou Staff — keys, redeem, atividade (não ajudante) */
function requireOwnerOrStaff(req, res, next) {
  (async () => {
    const u = getAdminPanelUser(req);
    let users = await loadPanelUsers();
    const row = findUserRow(users, u);
    const role = normalizeUserRole(row);
    if (role !== 'owner' && role !== 'staff') {
      return res.status(403).json({ error: 'Sem permissão para esta ação.' });
    }
    next();
  })().catch(() => res.status(500).json({ error: 'Erro ao verificar cargo' }));
}

/** Dono ou Ajudante — contas loader (listar, reset HWID, pausar) */
function requireOwnerOrAjudante(req, res, next) {
  (async () => {
    const u = getAdminPanelUser(req);
    let users = await loadPanelUsers();
    const row = findUserRow(users, u);
    const role = normalizeUserRole(row);
    if (role !== 'owner' && role !== 'ajudante') {
      return res.status(403).json({ error: 'Sem permissão para esta ação.' });
    }
    next();
  })().catch(() => res.status(500).json({ error: 'Erro ao verificar cargo' }));
}

function getAdminPanelUser(req) {
  return String(req.headers['x-admin-user'] || '').trim() || 'admin';
}

const RESELLER_PLANS = {
  d1: { days: 1, price: 5, label: '1 dia' },
  d7: { days: 7, price: 17.5, label: '7 dias' },
  d15: { days: 15, price: 22.5, label: '15 dias' },
  d30: { days: 30, price: 30, label: '30 dias' },
};

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function verifyReseller(req) {
  const user = String(req.headers['x-reseller-user'] || '').trim();
  const pwd = String(req.headers['x-reseller-password'] || '').trim();
  const phrase = String(req.headers['x-reseller-secret-phrase'] || '').trim();
  if (!user || !pwd) return null;
  const resellers = await store.loadResellers();
  const r = resellers.find((x) => x.username === user);
  if (!r || r.passwordHash !== hashPassword(pwd)) return null;
  if (r.secretPhraseHash && !secretPhraseMatches(r.secretPhraseHash, phrase)) return null;
  return r;
}

function requireReseller(req, res, next) {
  Promise.resolve(verifyReseller(req))
    .then((r) => {
      if (!r) return res.status(401).json({ error: 'Não autorizado' });
      req.resellerUser = r;
      next();
    })
    .catch(() => res.status(500).json({ error: 'Erro ao verificar autorização' }));
}

const MP_API = 'https://api.mercadopago.com/v1';

async function getMercadoPagoCredentials() {
  let stored = { accessToken: '', payerEmail: '' };
  try {
    stored = await store.loadMercadoPagoPanelSettings();
  } catch (_) {}
  const token =
    (stored && String(stored.accessToken || '').trim()) ||
    process.env.MERCADOPAGO_ACCESS_TOKEN ||
    '';
  const email =
    (stored && String(stored.payerEmail || '').trim()) ||
    process.env.MERCADOPAGO_PAYER_EMAIL ||
    'payer@mercadopago.com';
  return { token, email };
}

async function mpCreatePixPayment(amountBrl, description, externalReference, metadata) {
  const { token, email } = await getMercadoPagoCredentials();
  if (!token) {
    const err = new Error('MERCADOPAGO_ACCESS_TOKEN não configurado no servidor');
    err.code = 'NO_MP_TOKEN';
    throw err;
  }
  const idem = String(externalReference || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || crypto.randomBytes(16).toString('hex');
  const res = await fetch(MP_API + '/payments', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idem,
    },
    body: JSON.stringify({
      transaction_amount: roundMoney(amountBrl),
      description: String(description || 'Recarga').slice(0, 255),
      payment_method_id: 'pix',
      payer: { email: String(email).slice(0, 255) },
      external_reference: String(externalReference).slice(0, 255),
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data.message ||
      (data.cause && data.cause[0] && data.cause[0].description) ||
      data.error ||
      'Erro Mercado Pago';
    const err = new Error(msg);
    err.mpBody = data;
    throw err;
  }
  return data;
}

async function mpGetPayment(paymentId) {
  const { token } = await getMercadoPagoCredentials();
  if (!token) return null;
  const res = await fetch(MP_API + '/payments/' + encodeURIComponent(paymentId), {
    headers: { Authorization: 'Bearer ' + token },
  });
  return res.json().catch(() => null);
}

async function processMercadoPagoPaymentForReseller(paymentId, expectedUsername) {
  const pid = String(paymentId || '').trim();
  if (!pid) return { ok: false, error: 'ID inválido' };
  const creditedIds = await store.loadMpCreditedIds();
  if (creditedIds.includes(pid)) {
    const resellers = await store.loadResellers();
    const r = resellers.find((x) => x.username === expectedUsername);
    return { ok: true, credited: false, already: true, balance: r ? r.balance : 0 };
  }
  const p = await mpGetPayment(pid);
  if (!p || p.error) return { ok: false, error: (p && p.message) || 'Pagamento não encontrado' };
  const status = p.status;
  if (status !== 'approved') {
    return { ok: true, credited: false, status, pending: status === 'pending' || status === 'in_process' };
  }
  const meta = p.metadata || {};
  const ref = String(p.external_reference || '');
  const userFromMeta = String(meta.reseller_username || '').trim();
  const userFromRef = ref.startsWith('reseller-topup:') ? ref.split(':')[1] : '';
  const okUser = userFromMeta === expectedUsername || userFromRef === expectedUsername;
  if (!okUser) return { ok: false, error: 'Este pagamento não pertence à sua conta' };
  const amount = roundMoney(p.transaction_amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Valor inválido no pagamento' };

  const inserted = await store.appendMpCreditedId(pid);
  if (!inserted) {
    const resellers = await store.loadResellers();
    const r = resellers.find((x) => x.username === expectedUsername);
    return { ok: true, credited: false, already: true, balance: r ? r.balance : 0 };
  }

  let resellers = await store.loadResellers();
  const idx = resellers.findIndex((x) => x.username === expectedUsername);
  if (idx === -1) {
    return { ok: false, error: 'Revendedor não encontrado' };
  }
  resellers[idx] = { ...resellers[idx], balance: roundMoney(resellers[idx].balance + amount) };
  await store.saveResellers(resellers);
  await appendActivity(
    {
      title: 'Recarga PIX (revendedor)',
      detail: String(expectedUsername) + ' +' + String(amount) + ' BRL',
      actor: expectedUsername,
    },
    expectedUsername
  );
  try {
    const dp = await store.loadDiscordPanelSettings();
    await notifyResellerPayment(
      {
        username: expectedUsername,
        amount,
        balance: resellers[idx].balance,
        paymentId: pid,
      },
      dp
    );
  } catch (_) {}
  return { ok: true, credited: true, balance: resellers[idx].balance, amount };
}

// Rota de token para upload direto ao Blob (DLLs > 4,5 MB) — antes do express.json para controle de body
app.post('/api/dll/upload', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  next();
}, express.json({ limit: '512kb' }), async (req, res) => {
  const payload = req.body && req.body.payload;
  const raw = (payload && payload.clientPayload) ?? (req.body && req.body.clientPayload);
  const auth = raw != null ? (() => { try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return {}; } })() : {};
  const fakeReq = { headers: { 'x-admin-user': auth.user || '', 'x-admin-password': auth.password || '' } };
  const ok = await verifyAdmin(fakeReq);
  if (!ok) return res.status(401).json({ error: 'Não autorizado' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN não configurado. Adicione em Storage → Blob e faça redeploy.' });
  let handleUpload;
  try {
    try {
      const blob = require('@vercel/blob');
      handleUpload = blob.handleUpload;
    } catch (_) {}
    if (!handleUpload) {
      try {
        const client = require('@vercel/blob/client');
        handleUpload = client.handleUpload;
      } catch (_) {}
    }
    if (!handleUpload) {
      const mod = await import('@vercel/blob/client');
      handleUpload = mod.handleUpload;
    }
  } catch (e) {
    return res.status(500).json({ error: 'handleUpload não disponível: ' + (e.message || String(e)) });
  }
  if (!handleUpload) return res.status(500).json({ error: 'handleUpload não encontrado em @vercel/blob.' });
  try {
    const protocol = (req.get('x-forwarded-proto') || req.protocol || 'https');
    const host = req.get('x-forwarded-host') || req.get('host') || req.hostname || 'localhost';
    const url = protocol + '://' + host + req.originalUrl;
    const headers = new Headers();
    if (req.headers) {
      for (const [k, v] of Object.entries(req.headers)) {
        if (v != null && k !== 'host') headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      }
    }
    const webRequest = new Request(url, { method: req.method, headers, body: JSON.stringify(req.body) });
    const response = await handleUpload({
      body: req.body,
      request: webRequest,
      onBeforeGenerateToken: async () => ({
        addRandomSuffix: false,
        validUntil: Date.now() + 120000,
      }),
    });
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    const text = await response.text();
    res.send(text);
  } catch (e) {
    res.status(500).json({ error: 'Erro no upload direto: ' + (e.message || String(e)) });
  }
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '20mb' }));

/** Avatar do revendedor — registado cedo (antes do static) para POST/PUT serem sempre reconhecidos. */
const RESELLER_AVATAR_MAX_LEN = 600000;
function isValidResellerAvatarDataUrl(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t === '') return true;
  if (t.length > RESELLER_AVATAR_MAX_LEN) return false;
  return /^data:image\/(jpeg|jpg|png|gif|webp);base64,/i.test(t);
}

async function handleResellerAvatarUpdate(req, res) {
  const user = String(req.headers['x-reseller-user'] || '').trim();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const hasAvatarKey = Object.prototype.hasOwnProperty.call(body, 'avatarUrl');
  const clearPhoto = body.clear === true;
  if (!hasAvatarKey && !clearPhoto) {
    return res.status(400).json({ error: 'Envie avatarUrl (data URL) ou clear: true para remover a foto.' });
  }
  let avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : '';
  if (clearPhoto) avatarUrl = '';
  if (avatarUrl && !isValidResellerAvatarDataUrl(avatarUrl)) {
    return res.status(400).json({ error: 'Imagem inválida. Use JPG, PNG, GIF ou WebP.' });
  }
  if (avatarUrl.length > RESELLER_AVATAR_MAX_LEN) {
    return res.status(400).json({ error: 'Imagem demasiado grande. Reduza o tamanho ou use outra foto.' });
  }
  try {
    let resellers = await store.loadResellers();
    const idx = resellers.findIndex((x) => x.username === user);
    if (idx === -1) return res.status(401).json({ error: 'Revendedor não encontrado.' });
    const cur = resellers[idx];
    const next = { ...cur };
    if (avatarUrl) next.avatarUrl = avatarUrl;
    else delete next.avatarUrl;
    resellers[idx] = next;
    await store.saveResellers(resellers);
    res.json({ ok: true, avatarUrl: next.avatarUrl || '' });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'Erro ao gravar';
    console.error('POST/PUT /api/reseller/avatar:', msg);
    res.status(500).json({ error: msg });
  }
}

app
  .route('/api/reseller/me')
  .get(requireReseller, async (req, res) => {
    const user = String(req.headers['x-reseller-user'] || '').trim();
    const resellers = await store.loadResellers();
    const r = resellers.find((x) => x.username === user);
    if (!r) return res.status(401).json({ error: 'Sessão inválida' });
    const { token } = await getMercadoPagoCredentials();
    const stats = await computeResellerKeyStats(user);
    res.json({
      username: r.username,
      balance: r.balance,
      mpConfigured: !!token,
      avatarUrl: r.avatarUrl && String(r.avatarUrl).trim() ? String(r.avatarUrl).trim() : '',
      createdAt: r.createdAt || null,
      keysGenerated: stats.keysGenerated,
      clientsCount: stats.clientsCount,
      totalKeysVolumeBrl: stats.totalKeysVolumeBrl,
      hasSecretPhrase: !!(r.secretPhraseHash && String(r.secretPhraseHash).trim()),
      recoveryEmail:
        r.recoveryEmail && String(r.recoveryEmail).trim() ? String(r.recoveryEmail).trim() : '',
    });
  })
  .post(requireReseller, handleResellerAvatarUpdate);

app.post('/api/reseller/recovery-email', requireReseller, async (req, res) => {
  try {
    const user = String(req.headers['x-reseller-user'] || '').trim();
    const raw = req.body && req.body.recoveryEmail != null ? String(req.body.recoveryEmail) : '';
    const trimmed = raw.trim();
    let recovery = '';
    if (trimmed) {
      recovery = normalizeRecoveryEmail(trimmed);
      if (!isValidEmailBasic(recovery)) {
        return res.status(400).json({ error: 'E-mail inválido.' });
      }
    }
    let resellers = await store.loadResellers();
    const idx = resellers.findIndex((x) => x.username === user);
    if (idx === -1) return res.status(400).json({ error: 'Revendedor não encontrado.' });
    const cur = resellers[idx];
    const next = { ...cur };
    if (recovery) next.recoveryEmail = recovery;
    else delete next.recoveryEmail;
    resellers[idx] = next;
    await store.saveResellers(resellers);
    res.json({ ok: true, recoveryEmail: recovery });
  } catch (e) {
    console.error('POST /api/reseller/recovery-email:', e && e.message ? e.message : e);
    res.status(500).json({ error: 'Erro ao guardar e-mail.' });
  }
});

app.post('/api/reseller/secret-phrase', requireReseller, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const clear = !!body.clear;
    const phrase = String(body.secretPhrase || body.palavraChave || '').trim();
    const user = String(req.headers['x-reseller-user'] || '').trim();
    let resellers = await store.loadResellers();
    const idx = resellers.findIndex((x) => x.username === user);
    if (idx === -1) return res.status(400).json({ error: 'Revendedor não encontrado.' });
    if (clear) {
      const nu = { ...resellers[idx] };
      delete nu.secretPhraseHash;
      delete nu.secretPhrasePlain;
      resellers[idx] = nu;
    } else {
      if (phrase.length < 4) return res.status(400).json({ error: 'Use pelo menos 4 caracteres na palavra-chave.' });
      if (phrase.length > SECRET_PHRASE_MAX_LEN) {
        return res.status(400).json({ error: 'Palavra-chave demasiado longa.' });
      }
      resellers[idx] = {
        ...resellers[idx],
        secretPhraseHash: hashPassword(phrase),
        secretPhrasePlain: phrase,
      };
    }
    await store.saveResellers(resellers);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao guardar palavra-chave.' });
  }
});

app.put('/api/reseller/avatar', requireReseller, handleResellerAvatarUpdate);
app.post('/api/reseller/avatar', requireReseller, handleResellerAvatarUpdate);

app.get('/api/reseller/leaderboard', requireReseller, async (req, res) => {
  try {
    const me = String(req.headers['x-reseller-user'] || '').trim();
    const leaderboard = await buildResellerLeaderboard();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ me, leaderboard });
  } catch (e) {
    console.error('GET /api/reseller/leaderboard:', e && e.message ? e.message : e);
    res.status(500).json({ error: 'Erro ao carregar ranking' });
  }
});

const publicDir = path.join(__dirname, 'public');
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'landing.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});
app.get('/vendedor', (req, res) => {
  res.sendFile(path.join(publicDir, 'revendedor.html'));
});
app.get('/revendedor', (req, res) => {
  res.redirect(301, '/vendedor');
});

mountLoaderClientProtection(app);
app.use(express.static(publicDir));

// Status do Blob para upload de DLLs grandes (frontend checa antes de chamar upload())
app.get('/api/dll/blob-status', requireAuth, requireOwner, (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ configured: !!process.env.BLOB_READ_WRITE_TOKEN });
});

// Lista pública para o Lua Executor (injector): quais versões estão ativas (download + UI)
app.get('/api/loader/product-flags', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  try {
    const flags = await store.loadLoaderProductFlags();
    res.json(flags);
  } catch (e) {
    res.status(500).json({ '0': true, '1': true, '2': true, error: String(e && e.message) });
  }
});

// Atualizar flags (admin). Body: { "0": true, "1": false, "2": true } — só precisa enviar as chaves que mudam
app.put('/api/loader/product-flags', requireAuth, requireOwner, async (req, res) => {
  try {
    const cur = await store.loadLoaderProductFlags();
    const body = req.body || {};
    for (const k of ['0', '1', '2']) {
      if (typeof body[k] === 'boolean') cur[k] = body[k];
    }
    await store.saveLoaderProductFlags(cur);
    const next = await store.loadLoaderProductFlags();
    res.json({ ok: true, ...next });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Erro ao salvar flags.' });
  }
});

// Ver qual armazenamento está ativo (útil para conferir na Vercel)
app.get('/api/storage', async (req, res) => {
  let storage = 'fs';
  if (store.USE_MYSQL) storage = 'mysql';
  else if (store.USE_SQL) storage = 'sql';
  else if (store.USE_SQLITE) storage = 'sqlite';
  else if (store.USE_BLOB) storage = 'blob';
  else if (process.env.VERCEL) storage = 'memory';
  res.setHeader('Access-Control-Allow-Origin', '*');
  const messages = {
    mysql: 'Dados salvos no MySQL (persistem).',
    sql: 'Dados salvos no Postgres (persistem).',
    sqlite: 'Dados no SQLite (arquivo no projeto — data/silva.db).',
    memory: 'Dados em memória — vão sumir! Adicione MYSQL_* ou DATABASE_URL nas variáveis de ambiente da Vercel.',
    blob: 'Dados no Blob.',
    fs: 'Dados em arquivos locais.',
  };

  let dbConnected = true;
  let dbError = null;
  if (store.USE_MYSQL) {
    try {
      await require('./store-mysql').pingDb();
    } catch (e) {
      dbConnected = false;
      dbError = sanitizeDbPingError(e);
    }
  } else if (store.USE_SQL) {
    try {
      await require('./store-sql').pingDb();
    } catch (e) {
      dbConnected = false;
      dbError = sanitizeDbPingError(e);
    }
  } else if (store.USE_SQLITE) {
    try {
      require('./store-sqlite').pingDb();
    } catch (e) {
      dbConnected = false;
      dbError = sanitizeDbPingError(e);
    }
  }

  const dbHint =
    storage === 'mysql' && dbConnected === false
      ? 'phpMyAdmin liga ao MySQL no servidor. O Node precisa do mesmo utilizador/senha/base; o host é localhost só se o Node correr nesse servidor. De outro sítio, use o hostname remoto e autorize o IP.'
      : undefined;

  res.json({
    storage,
    dbConnected,
    ...(dbError ? { dbError } : {}),
    ...(dbHint ? { dbHint } : {}),
    message: messages[storage] || messages.fs,
    serverId: SERVER_ID,
  });
});

// Keep-alive: chame a cada 5–15 min (cron externo ou UptimeRobot) para o servidor não dormir e o SQLite continuar no mesmo processo
app.get('/api/keepalive', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (store.USE_SQLITE) {
    store.loadKeysData().catch(() => {});
  }
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

// Atividade recente (compartilhada)
app.get('/api/activity', requireAuth, requireOwnerOrStaff, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const items = await loadActivityLog();
  res.json({ items: Array.isArray(items) ? items : [] });
});

app.post('/api/activity', requireAuth, requireOwnerOrStaff, async (req, res) => {
  const actor = (req.headers['x-admin-user'] || '').trim();
  const item = await appendActivity(req.body || {}, actor);
  res.json({ ok: true, item });
});

app.get('/api/activity/stream', requireAuth, requireOwnerOrStaff, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();
  res.write(': connected\n\n');

  const items = await loadActivityLog();
  sendSse(res, 'activity-init', { items: Array.isArray(items) ? items : [] });

  const client = { res };
  activityClients.add(client);

  const pingId = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_) {}
  }, ACTIVITY_SSE_PING_MS);

  req.on('close', () => {
    clearInterval(pingId);
    activityClients.delete(client);
  });
});

function generateRedeemCode() {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const part = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return part() + '-' + part() + '-' + part();
}

const DEFAULT_PAUSE_STATE = { paused: false, pausedAt: null, totalPausedMs: 0 };

function normalizePauseState(state) {
  const paused = !!(state && state.paused);
  let pausedAtRaw = null;
  if (state && state.pausedAt) {
    const d = new Date(state.pausedAt);
    if (!Number.isNaN(d.getTime())) pausedAtRaw = d.toISOString();
  }
  const totalPausedMs = Math.max(0, Number(state && state.totalPausedMs) || 0);
  return {
    paused,
    pausedAt: paused ? pausedAtRaw : null,
    totalPausedMs,
  };
}

async function getPauseState() {
  if (!store.loadPauseState) return DEFAULT_PAUSE_STATE;
  const state = await store.loadPauseState();
  return normalizePauseState(state);
}

function getEffectiveNowFromState(state) {
  const total = state.totalPausedMs || 0;
  if (state.paused && state.pausedAt) {
    const pausedAt = new Date(state.pausedAt).getTime();
    return pausedAt - total;
  }
  return Date.now() - total;
}

function normalizeRedeemPauseState(state) {
  const paused = !!(state && state.paused);
  let pausedAt = null;
  if (state && state.pausedAt) {
    const d = new Date(state.pausedAt);
    if (!Number.isNaN(d.getTime())) pausedAt = d.toISOString();
  }
  return { paused, pausedAt };
}

async function loadRedeemKeyPauseMap() {
  if (!store.loadRedeemKeyPauses || !(store.USE_MYSQL || store.USE_SQL || store.USE_SQLITE)) return null;
  const raw = await store.loadRedeemKeyPauses();
  const map = {};
  Object.keys(raw || {}).forEach((code) => {
    map[String(code).toUpperCase()] = normalizeRedeemPauseState(raw[code]);
  });
  return map;
}

async function loadRedeemKeysWithPause() {
  const keys = await store.loadRedeemKeys();
  const pauseMap = await loadRedeemKeyPauseMap();
  return (keys || []).map((k) => {
    const code = String(k.code || '');
    const pause = pauseMap ? pauseMap[code.toUpperCase()] : null;
    const localPause = normalizeRedeemPauseState(k || {});
    return {
      ...k,
      paused: pause ? pause.paused : localPause.paused,
      pausedAt: pause ? pause.pausedAt : localPause.pausedAt,
    };
  });
}

/** Preço pago na geração da key, derivado de expiresInSeconds (planos atuais). */
const RESELLER_EXPIRES_TO_PRICE = new Map();
for (const p of Object.values(RESELLER_PLANS)) {
  RESELLER_EXPIRES_TO_PRICE.set(p.days * 86400, p.price);
}

function resellerPriceForKeyEntry(k) {
  const sec = Number(k && k.expiresInSeconds) || 0;
  return RESELLER_EXPIRES_TO_PRICE.get(sec) ?? 0;
}

async function computeResellerKeyStats(username) {
  const user = String(username || '').trim();
  const keys = await loadRedeemKeysWithPause();
  const mine = (keys || []).filter((k) => String(k.createdByReseller || '').trim() === user);
  let totalVolume = 0;
  const clientSet = new Set();
  for (const k of mine) {
    totalVolume += resellerPriceForKeyEntry(k);
    const ub = String(k.usedBy || '').trim();
    if (ub) clientSet.add(ub);
  }
  return {
    keysGenerated: mine.length,
    clientsCount: clientSet.size,
    totalKeysVolumeBrl: roundMoney(totalVolume),
  };
}

/** Ranking de todos os revendedores (volume em keys, depois quantidade de keys). */
async function buildResellerLeaderboard() {
  const resellers = await store.loadResellers();
  const avatarByUser = {};
  const avatarByUserLower = {};
  for (const r of resellers) {
    const u = String(r.username || '').trim();
    if (!u) continue;
    const av = r.avatarUrl && String(r.avatarUrl).trim() ? String(r.avatarUrl).trim() : '';
    avatarByUser[u] = av;
    if (av) avatarByUserLower[u.toLowerCase()] = av;
  }
  const keys = await loadRedeemKeysWithPause();
  const byUser = {};
  for (const r of resellers) {
    const u = String(r.username || '').trim();
    if (!u) continue;
    byUser[u] = { username: u, keysGenerated: 0, totalKeysVolumeBrl: 0, clientSet: new Set() };
  }
  for (const k of keys || []) {
    const u = String(k.createdByReseller || '').trim();
    if (!u || !byUser[u]) continue;
    byUser[u].keysGenerated += 1;
    byUser[u].totalKeysVolumeBrl += resellerPriceForKeyEntry(k);
    const ub = String(k.usedBy || '').trim();
    if (ub) byUser[u].clientSet.add(ub);
  }
  const rows = Object.values(byUser).map((row) => {
    const un = row.username;
    const av =
      avatarByUser[un] ||
      avatarByUserLower[String(un || '').toLowerCase()] ||
      '';
    return {
    username: row.username,
    avatarUrl: av,
    rank: 0,
    keysGenerated: row.keysGenerated,
    clientsCount: row.clientSet.size,
    totalKeysVolumeBrl: roundMoney(row.totalKeysVolumeBrl),
  };
  });
  rows.sort((a, b) => {
    if (b.totalKeysVolumeBrl !== a.totalKeysVolumeBrl) return b.totalKeysVolumeBrl - a.totalKeysVolumeBrl;
    if (b.keysGenerated !== a.keysGenerated) return b.keysGenerated - a.keysGenerated;
    return String(a.username).localeCompare(String(b.username));
  });
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return rows;
}

// Cada item: { id, usuario, addedAt, expiresInSeconds } (0 = permanente)
async function getValidIds() {
  const data = await store.loadKeysData();
  const now = getEffectiveNowFromState(await getPauseState());
  return (data.keys || [])
    .filter((k) => {
      const sec = k.expiresInSeconds || 0;
      if (sec === 0) return true;
      const added = new Date(k.addedAt).getTime();
      return now < added + sec * 1000;
    })
    .map((k) => k.id);
}

async function findKeyAndDays(productId) {
  const data = await store.loadKeysData();
  const now = getEffectiveNowFromState(await getPauseState());
  const key = (data.keys || []).find((k) => k.id === productId);
  if (!key) return null;
  const sec = key.expiresInSeconds || 0;
  if (sec === 0) return { key, diasRestantes: 9999 };
  const added = new Date(key.addedAt).getTime();
  const end = added + sec * 1000;
  if (now >= end) return null;
  const diasRestantes = Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
  return { key, diasRestantes };
}

// --- Rotas ---

/** Login do painel admin apenas (sem HWID). Revendedor é rejeitado com mensagem para /vendedor. */
async function loginPanelUserFromRequest(req) {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  const palavraChave = String(req.body.palavraChave || req.body.secretPhrase || '').trim();
  if (!username || !password) {
    return { status: 400, body: { ok: false, error: 'Usuário e senha obrigatórios.' } };
  }
  let resellersList = [];
  try {
    resellersList = await store.loadResellers();
  } catch (e) {
    console.error('[loginPanelUserFromRequest] loadResellers', e && e.message);
  }
  const resellerHit = resellersList.find((r) => r.username === username && r.passwordHash === hashPassword(password));
  if (resellerHit) {
    return {
      status: 403,
      body: { ok: false, error: 'Esta conta é de vendedor. Acesse o painel em /vendedor' },
    };
  }
  const users = await loadPanelUsers();

  const row = findUserRow(users, username);
  if (!row || !panelPasswordMatches(row, password)) {
    return { status: 401, body: { ok: false, error: 'Usuário ou senha incorretos.' } };
  }

  const needsPhrase = !!(row && row.secretPhraseHash);
  const role = normalizeUserRole(row);

  if (needsPhrase && !palavraChave) {
    return {
      status: 200,
      body: {
        ok: true,
        needsSecretPhrase: true,
        user: username,
        role,
        isOwner: role === 'owner',
      },
    };
  }

  if (needsPhrase && palavraChave && !secretPhraseMatches(row.secretPhraseHash, palavraChave)) {
    return { status: 403, body: { ok: false, error: 'Palavra-chave incorreta.' } };
  }

  await touchUserLastLogin(username);
  return {
    status: 200,
    body: {
      ok: true,
      user: username,
      role,
      isOwner: role === 'owner',
      needsSecretPhrase: false,
    },
  };
}

// (Legado) Product ID nao usado mais — auth e por login/senha+HWID
app.get('/api/check', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  return res.json({ allowed: false, usuario: '', dias_restantes: 0 });
});

// Para o loader (compatibilidade): GET /keys.json só com IDs válidos
app.get('/keys.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const keys = await getValidIds();
  res.json({ keys });
});

// Login: se vier hwid = login do LOADER (contas loader). Sem hwid = login do PAINEL (usuarios admin).
app.post('/api/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  const hwid = typeof req.body.hwid === 'string' ? req.body.hwid.trim() : '';

  if (!username || !password) {
    return res.status(400).json({ allowed: false, message: 'Usuário e senha obrigatórios.' });
  }

  // --- Login do LOADER (loader envia username, password, hwid) ---
  if (hwid !== '') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    const accounts = await store.loadLoaderAccounts();
    const acc = accounts.find((a) => a.username === username);
    if (!acc) {
      return res.json({ allowed: false, message: 'Usuário ou senha incorretos.' });
    }
    if (acc.passwordHash !== hashPassword(password)) {
      return res.json({ allowed: false, message: 'Usuário ou senha incorretos.' });
    }
    if (acc.paused) {
      return res.json({ allowed: false, message: 'Conta pausada.' });
    }
    const now = getEffectiveNowFromState(await getPauseState());
    if (acc.expiresAt) {
      const end = new Date(acc.expiresAt).getTime();
      if (now >= end) {
        return res.json({ allowed: false, message: 'Licença expirada.' });
      }
    }
    const diasRestantes = !acc.expiresAt ? 9999 : Math.max(0, Math.ceil((new Date(acc.expiresAt).getTime() - now) / (24 * 60 * 60 * 1000)));
    const nowIso = new Date().toISOString();

    if (acc.skipHwidCheck) {
      // Sem verificação HWID: permite e opcionalmente salva o hwid para exibir no painel
      const updated = accounts.map((a) => (a.username === username ? { ...a, hwid: hwid || a.hwid, lastLoginAt: nowIso } : a));
      await store.saveLoaderAccounts(updated);
      return res.json({ allowed: true, usuario: username, dias_restantes: diasRestantes });
    }

    if (!acc.hwid) {
      // Primeiro login: registra o HWID e permite
      const updated = accounts.map((a) => (a.username === username ? { ...a, hwid, lastLoginAt: nowIso } : a));
      await store.saveLoaderAccounts(updated);
      return res.json({ allowed: true, usuario: username, dias_restantes: diasRestantes });
    }

    if (acc.hwid !== hwid) {
      return res.json({ allowed: false, message: 'Este login está vinculado a outro PC (HWID). Peça reset de HWID ao admin.' });
    }
 
    const updated = accounts.map((a) => (a.username === username ? { ...a, lastLoginAt: nowIso } : a));
    await store.saveLoaderAccounts(updated);
    return res.json({ allowed: true, usuario: username, dias_restantes: diasRestantes });
  }

  // --- Login do PAINEL (sem hwid: usuários admin) — mesma regra que POST /api/auth/admin/login ---
  const panelResult = await loginPanelUserFromRequest(req);
  return res.status(panelResult.status).json(panelResult.body);
});

// Login exclusivo do painel admin (recomendado no frontend /admin)
app.post('/api/auth/admin/login', async (req, res) => {
  try {
    const result = await loginPanelUserFromRequest(req);
    return res.status(result.status).json(result.body);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'unknown';
    console.error('[api/auth/admin/login]', msg, e && e.stack);
    const detail = process.env.LOGIN_DEBUG === '1' || process.env.NODE_ENV === 'development' ? msg : undefined;
    return res.status(500).json({ ok: false, error: 'Erro ao processar login', ...(detail ? { detail } : {}) });
  }
});

// Confirma credenciais admin no servidor (use após restaurar sessão do sessionStorage)
app.get('/api/auth/admin/verify', requireAuth, async (req, res) => {
  const u = getAdminPanelUser(req);
  const users = await loadPanelUsers();
  const row = findUserRow(users, u);
  const role = normalizeUserRole(row);
  res.json({
    ok: true,
    user: u,
    role,
    isOwner: role === 'owner',
    hasSecretPhrase: !!(row && row.secretPhraseHash),
  });
});

app.post('/api/auth/admin/secret-phrase', requireAuth, async (req, res) => {
  try {
    const clear = !!(req.body && req.body.clear);
    const phrase = String((req.body && (req.body.secretPhrase || req.body.palavraChave)) || '').trim();
    const username = getAdminPanelUser(req);
    let users = await loadPanelUsers();
    const idx = users.findIndex((x) => usernameKey(x.username) === usernameKey(username));
    if (idx === -1) return res.status(400).json({ error: 'Usuário não encontrado.' });
    if (clear) {
      const nu = { ...users[idx] };
      delete nu.secretPhraseHash;
      users[idx] = nu;
    } else {
      if (phrase.length < 4) return res.status(400).json({ error: 'Use pelo menos 4 caracteres na palavra-chave.' });
      if (phrase.length > SECRET_PHRASE_MAX_LEN) {
        return res.status(400).json({ error: 'Palavra-chave demasiado longa.' });
      }
      users[idx] = { ...users[idx], secretPhraseHash: hashPassword(phrase) };
    }
    await store.saveUsers(users);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao guardar palavra-chave.' });
  }
});

app.patch('/api/users/:username/role', requireAuth, requireOwner, async (req, res) => {
  try {
    const target = decodeURIComponent(req.params.username || '').trim();
    const role = parseRoleFromRequest(req.body);
    if (role === null) {
      return res.status(400).json({
        error: 'Cargo inválido. Use: dono, admin ou suporte (ou owner, staff, ajudante).',
      });
    }
    if (isSilvaUser(target) && role !== 'owner') {
      return res.status(400).json({ error: 'O utilizador silva é sempre dono (cargo máximo).' });
    }
    let users = await loadPanelUsers();
    const idx = users.findIndex((u) => usernameKey(u.username) === usernameKey(target));
    if (idx === -1) return res.status(404).json({ error: 'Utilizador não encontrado.' });
    const owners = users.filter((u) => normalizeUserRole(u) === 'owner');
    if (normalizeUserRole(users[idx]) === 'owner' && role !== 'owner' && owners.length <= 1) {
      return res.status(400).json({ error: 'Tem de existir pelo menos um dono (owner).' });
    }
    users[idx] = { ...users[idx], role };
    await store.saveUsers(users);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao atualizar cargo.' });
  }
});

// Confirma credenciais de vendedor no servidor
app.get('/api/auth/vendedor/verify', requireReseller, (req, res) => {
  const u = req.resellerUser && req.resellerUser.username;
  res.json({ ok: true, user: u || '' });
});

// Presenca do LOADER: ping (online) e logout (offline)
app.post('/api/loader/presence/ping', async (req, res) => {
  const { username, password, hwid } = req.body || {};
  const v = await validateLoaderCredentials(username, password, hwid);
  if (!v.ok) return res.status(v.status || 200).json({ ok: false, message: v.message });

  const nowIso = new Date(v.now).toISOString();
  const updated = v.accounts.map((a) => {
    if (a.username !== v.acc.username) return a;
    const nextHwid = v.allowSetHwid ? (v.hwid || a.hwid) : a.hwid;
    return { ...a, hwid: nextHwid, lastLoginAt: nowIso };
  });
  await store.saveLoaderAccounts(updated);

  const online = updated.filter((a) => isOnlineByLastLogin(a.lastLoginAt, LOADER_PRESENCE_TTL_MS, Date.now())).length;
  res.json({ ok: true, online });
});

app.post('/api/loader/presence/logout', async (req, res) => {
  const { username, password, hwid } = req.body || {};
  const v = await validateLoaderCredentials(username, password, hwid);
  if (!v.ok) return res.status(v.status || 200).json({ ok: false, message: v.message });

  const updated = v.accounts.map((a) => {
    if (a.username !== v.acc.username) return a;
    const nextHwid = v.allowSetHwid ? (v.hwid || a.hwid) : a.hwid;
    return { ...a, hwid: nextHwid, lastLoginAt: null };
  });
  await store.saveLoaderAccounts(updated);

  const online = updated.filter((a) => isOnlineByLastLogin(a.lastLoginAt, LOADER_PRESENCE_TTL_MS, Date.now())).length;
  res.json({ ok: true, online });
});

app.get('/api/loader/presence/count', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const accounts = await store.loadLoaderAccounts();
  const online = accounts.filter((a) => isOnlineByLastLogin(a.lastLoginAt, LOADER_PRESENCE_TTL_MS, Date.now())).length;
  res.json({ online });
});

// Presenca do painel: ping (online) e logout (offline)
app.post('/api/presence/ping', requireAuth, async (req, res) => {
  const user = (req.headers['x-admin-user'] || '').trim();
  if (user) await touchUserLastLogin(user);
  res.json({ ok: true });
});

app.post('/api/presence/logout', requireAuth, async (req, res) => {
  const user = (req.headers['x-admin-user'] || '').trim();
  if (user) await clearUserLastLogin(user);
  res.json({ ok: true });
});

// Listar usuários (admin) — só nomes (apenas dono)
app.get('/api/users', requireAuth, requireOwner, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Server-Id', SERVER_ID);
  const users = await loadPanelUsers();
  const now = Date.now();
  res.json({
    users: users.map((u) => ({
      username: u.username,
      online: isOnlineByLastLogin(u.lastLoginAt, PANEL_PRESENCE_TTL_MS, now),
      role: normalizeUserRole(u),
    })),
  });
});

// Registrar novo usuário (admin). Body: { username, password, role? } — role: dono|admin|suporte (ou owner|staff|ajudante)
app.post('/api/users', requireAuth, requireOwner, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha obrigatórios.' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: 'Usuário só pode ter letras, números, _ e -.' });
  }
  let role = 'staff';
  if (req.body && req.body.role != null && String(req.body.role).trim() !== '') {
    const parsed = parseRoleFromRequest(req.body);
    if (parsed === null) {
      return res.status(400).json({
        error: 'Cargo inválido. Use: dono, admin ou suporte (ou owner, staff, ajudante).',
      });
    }
    role = parsed;
  }
  let users = await loadPanelUsers();
  if (users.some((u) => u.username === username)) {
    return res.status(400).json({ error: 'Usuário já existe.' });
  }
  const rs = await store.loadResellers();
  if (rs.some((r) => r.username === username)) {
    return res.status(400).json({ error: 'Já existe um revendedor com esse nome. Use outro usuário.' });
  }
  users.push({ username, passwordHash: hashPassword(password), lastLoginAt: null, role });
  await store.saveUsers(users);
  const now = Date.now();
  res.json({
    ok: true,
    username,
    users: users.map((u) => ({
      username: u.username,
      online: isOnlineByLastLogin(u.lastLoginAt, PANEL_PRESENCE_TTL_MS, now),
      role: normalizeUserRole(u),
    })),
  });
});

// Remover usuário (admin) — apenas dono; silva não pode ser removido
app.delete('/api/users/:username', requireAuth, requireOwner, async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  if (isSilvaUser(username)) {
    return res.status(400).json({ error: 'Não é possível remover o utilizador silva.' });
  }
  let users = await loadPanelUsers();
  users = users.filter((u) => u.username !== username);
  if (users.length === 0) {
    return res.status(400).json({ error: 'Não é possível remover o último usuário.' });
  }
  await store.saveUsers(users);
  const now = Date.now();
  res.json({
    ok: true,
    removed: username,
    users: users.map((u) => ({
      username: u.username,
      online: isOnlineByLastLogin(u.lastLoginAt, PANEL_PRESENCE_TTL_MS, now),
      role: normalizeUserRole(u),
    })),
  });
});

// --- Revendedores (admin cria logins; saldo + PIX + gerar keys) ---

function mapResellerForAdminPanel(r) {
  const hasPhraseHash = !!(
    (r.secretPhraseHash && String(r.secretPhraseHash).trim()) ||
    (r.secret_phrase_hash && String(r.secret_phrase_hash).trim())
  );
  let plain = '';
  if (r.secretPhrasePlain != null && String(r.secretPhrasePlain).trim() !== '') {
    plain = String(r.secretPhrasePlain).trim();
  } else if (r.secret_phrase_plain != null && String(r.secret_phrase_plain).trim() !== '') {
    plain = String(r.secret_phrase_plain).trim();
  }
  return {
    username: r.username,
    balance: r.balance,
    createdAt: r.createdAt || null,
    /** Texto da palavra-chave de login (só para dono; guardado quando o revendedor define no perfil). */
    loginPhrase: plain,
    hasLoginPhrase: hasPhraseHash,
  };
}

app.get('/api/resellers', requireAuth, requireOwner, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const list = await store.loadResellers();
  res.json({
    resellers: list.map((r) => mapResellerForAdminPanel(r)),
  });
});

app.post('/api/resellers', requireAuth, requireOwner, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  const initialBalance = roundMoney(parseFloat(req.body.initialBalance) || 0);
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha obrigatórios.' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: 'Usuário só pode ter letras, números, _ e -.' });
  }
  let resellers = await store.loadResellers();
  if (resellers.some((r) => r.username === username)) {
    return res.status(400).json({ error: 'Revendedor já existe.' });
  }
  const users = await loadPanelUsers();
  if (users.some((u) => u.username === username)) {
    return res.status(400).json({ error: 'Já existe um usuário do painel com esse nome. Use outro usuário.' });
  }
  const nowIso = new Date().toISOString();
  resellers.push({
    username,
    passwordHash: hashPassword(password),
    balance: Math.max(0, initialBalance),
    createdAt: nowIso,
  });
  await store.saveResellers(resellers);
  res.json({
    ok: true,
    resellers: resellers.map((r) => mapResellerForAdminPanel(r)),
  });
});

app.delete('/api/resellers/:username', requireAuth, requireOwner, async (req, res) => {
  const username = decodeURIComponent(req.params.username || '').trim();
  let resellers = await store.loadResellers();
  const before = resellers.length;
  resellers = resellers.filter((r) => r.username !== username);
  if (resellers.length === before) {
    return res.status(404).json({ error: 'Revendedor não encontrado.' });
  }
  await store.saveResellers(resellers);
  res.json({
    ok: true,
    removed: username,
    resellers: resellers.map((r) => mapResellerForAdminPanel(r)),
  });
});

/** Dono: define a palavra-chave de login do revendedor (atualiza hash + texto visível no admin). */
app.put('/api/resellers/:username/login-phrase', requireAuth, requireOwner, express.json(), async (req, res) => {
  try {
    const username = decodeURIComponent(req.params.username || '').trim();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const phrase = String(body.phrase || body.palavraChave || '').trim();
    if (phrase.length < 4) {
      return res.status(400).json({ error: 'Use pelo menos 4 caracteres na palavra-chave.' });
    }
    if (phrase.length > SECRET_PHRASE_MAX_LEN) {
      return res.status(400).json({ error: 'Palavra-chave demasiado longa.' });
    }
    let resellers = await store.loadResellers();
    const idx = resellers.findIndex((r) => r.username === username);
    if (idx === -1) return res.status(404).json({ error: 'Revendedor não encontrado.' });
    resellers[idx] = {
      ...resellers[idx],
      secretPhraseHash: hashPassword(phrase),
      secretPhrasePlain: phrase,
    };
    await store.saveResellers(resellers);
    res.json({
      ok: true,
      resellers: resellers.map((r) => mapResellerForAdminPanel(r)),
    });
  } catch (e) {
    console.error('PUT /api/resellers/:username/login-phrase:', e && e.message ? e.message : e);
    res.status(500).json({ error: 'Erro ao guardar palavra-chave.' });
  }
});

// Mercado Pago: credenciais editáveis no painel (aba Revendedores); complementam .env
app.get('/api/mercadopago-settings', requireAuth, requireOwner, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const s = await store.loadMercadoPagoPanelSettings();
  res.json({
    payerEmail: s.payerEmail || '',
    tokenConfigured: !!(s.accessToken && String(s.accessToken).trim()),
    envHasToken: !!(process.env.MERCADOPAGO_ACCESS_TOKEN && String(process.env.MERCADOPAGO_ACCESS_TOKEN).trim()),
  });
});

app.put('/api/mercadopago-settings', requireAuth, requireOwner, express.json(), async (req, res) => {
  const cur = await store.loadMercadoPagoPanelSettings();
  const body = req.body || {};
  let accessToken = cur.accessToken || '';
  if (body.clearToken === true) {
    accessToken = '';
  } else if (typeof body.accessToken === 'string' && body.accessToken.trim()) {
    accessToken = body.accessToken.trim();
  }
  const payerEmail = typeof body.payerEmail === 'string' ? body.payerEmail.trim() : cur.payerEmail || '';
  await store.saveMercadoPagoPanelSettings({ accessToken, payerEmail });
  const { token } = await getMercadoPagoCredentials();
  res.json({
    ok: true,
    payerEmail,
    tokenConfigured: !!(accessToken && String(accessToken).trim()),
    mpActive: !!token,
  });
});

// Discord: webhooks editáveis no painel (aba Revendedores); prioridade sobre .env
app.get('/api/discord-webhook-settings', requireAuth, requireOwner, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const s = await store.loadDiscordPanelSettings();
  res.json({
    keyGenerated: s.keyGenerated || '',
    keyDeleted: s.keyDeleted || '',
    resellerPayment: s.resellerPayment || '',
    fallback: s.fallback || '',
  });
});

app.put('/api/discord-webhook-settings', requireAuth, requireOwner, express.json(), async (req, res) => {
  const body = req.body || {};
  await store.saveDiscordPanelSettings({
    keyGenerated: typeof body.keyGenerated === 'string' ? body.keyGenerated.trim() : '',
    keyDeleted: typeof body.keyDeleted === 'string' ? body.keyDeleted.trim() : '',
    resellerPayment: typeof body.resellerPayment === 'string' ? body.resellerPayment.trim() : '',
    fallback: typeof body.fallback === 'string' ? body.fallback.trim() : '',
  });
  res.json({ ok: true });
});

app.post('/api/reseller/login', express.json(), async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  const palavraChave = String(req.body.palavraChave || req.body.secretPhrase || '').trim();
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Usuário e senha obrigatórios.' });
  }
  const resellers = await store.loadResellers();
  const r = resellers.find((x) => x.username === username && x.passwordHash === hashPassword(password));
  if (!r) {
    return res.status(401).json({ ok: false, error: 'Usuário ou senha incorretos.' });
  }
  const needsPhrase = !!(r.secretPhraseHash);
  if (needsPhrase && !palavraChave) {
    return res.status(200).json({
      ok: true,
      needsSecretPhrase: true,
      user: r.username,
      balance: r.balance,
    });
  }
  if (needsPhrase && palavraChave && !secretPhraseMatches(r.secretPhraseHash, palavraChave)) {
    return res.status(403).json({ ok: false, error: 'Palavra-chave incorreta.' });
  }
  res.json({ ok: true, user: r.username, balance: r.balance, needsSecretPhrase: false });
});

const RESELLER_RESET_MSG =
  'Se este e-mail estiver registado no perfil, receberá um link para redefinir a senha.';

app.post('/api/reseller/forgot-password', express.json(), async (req, res) => {
  try {
    const email = normalizeRecoveryEmail(req.body && req.body.email);
    const generic = { ok: true, message: RESELLER_RESET_MSG };
    if (!email || !isValidEmailBasic(email)) {
      return res.json(generic);
    }
    const resellers = await store.loadResellers();
    const r = resellers.find((x) => normalizeRecoveryEmail(x.recoveryEmail || '') === email);
    if (!r || !r.recoveryEmail) {
      return res.json(generic);
    }
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashPassword(token);
    const expires = new Date(Date.now() + 3600000).toISOString();
    const idx = resellers.findIndex((x) => x.username === r.username);
    if (idx === -1) return res.json(generic);
    resellers[idx] = {
      ...resellers[idx],
      passwordResetTokenHash: tokenHash,
      passwordResetExpires: expires,
    };
    await store.saveResellers(resellers);
    const resetUrl = `${publicBaseUrl(req)}/vendedor?reset=${encodeURIComponent(token)}`;
    await sendResellerPasswordResetEmail(r.recoveryEmail, resetUrl);
    if (!isSmtpConfigured()) {
      console.warn('[forgot-password] SMTP_HOST não definido. Link para', r.username + ':', resetUrl);
    }
    const out = { ok: true, message: RESELLER_RESET_MSG };
    if (shouldExposeResetLinkForLocalTesting(req)) {
      out.resetUrlForTesting = resetUrl;
    }
    res.json(out);
  } catch (e) {
    console.error('POST /api/reseller/forgot-password:', e && e.message ? e.message : e);
    res.status(500).json({ ok: false, error: 'Erro ao processar pedido.' });
  }
});

app.post('/api/reseller/reset-password', express.json(), async (req, res) => {
  try {
    const token = String((req.body && req.body.token) || '').trim();
    const newPassword = String((req.body && req.body.newPassword) || '').trim();
    if (!token || !newPassword || newPassword.length < 4) {
      return res.status(400).json({ ok: false, error: 'Token e nova senha (mín. 4 caracteres) obrigatórios.' });
    }
    if (newPassword.length > 200) {
      return res.status(400).json({ ok: false, error: 'Senha demasiado longa.' });
    }
    const tokenHash = hashPassword(token);
    let resellers = await store.loadResellers();
    const idx = resellers.findIndex((x) => x.passwordResetTokenHash === tokenHash);
    if (idx === -1) {
      return res.status(400).json({ ok: false, error: 'Link inválido ou já utilizado. Peça um novo e-mail.' });
    }
    const exp = resellers[idx].passwordResetExpires;
    if (!exp || Date.now() > new Date(exp).getTime()) {
      return res.status(400).json({ ok: false, error: 'Link expirado. Peça um novo e-mail de recuperação.' });
    }
    const nu = { ...resellers[idx], passwordHash: hashPassword(newPassword) };
    delete nu.passwordResetTokenHash;
    delete nu.passwordResetExpires;
    resellers[idx] = nu;
    await store.saveResellers(resellers);
    res.json({ ok: true, message: 'Senha atualizada. Já pode entrar com a nova senha.' });
  } catch (e) {
    console.error('POST /api/reseller/reset-password:', e && e.message ? e.message : e);
    res.status(500).json({ ok: false, error: 'Erro ao redefinir senha.' });
  }
});

app.get('/api/reseller/plans', (req, res) => {
  res.json({
    plans: Object.entries(RESELLER_PLANS).map(([id, p]) => ({
      id,
      days: p.days,
      price: p.price,
      label: p.label,
      expiresInSeconds: p.days * 86400,
    })),
  });
});

app.post('/api/reseller/topup', requireReseller, express.json(), async (req, res) => {
  const user = String(req.headers['x-reseller-user'] || '').trim();
  let amount = roundMoney(parseFloat(req.body.amount));
  if (!Number.isFinite(amount) || amount < 1) {
    return res.status(400).json({ error: 'Informe um valor mínimo de R$ 1,00' });
  }
  if (amount > 50000) {
    return res.status(400).json({ error: 'Valor máximo por recarga: R$ 50.000,00' });
  }
  const ext = 'reseller-topup:' + user + ':' + Date.now();
  try {
    const payment = await mpCreatePixPayment(amount, 'Recarga saldo revendedor ' + user, ext, {
      reseller_username: user,
      type: 'reseller_topup',
    });
    const tid = payment.point_of_interaction && payment.point_of_interaction.transaction_data;
    const qr =
      tid && (tid.qr_code_base64 || tid.qr_code)
        ? { base64: tid.qr_code_base64 || null, code: tid.qr_code || null, ticketUrl: tid.ticket_url || null }
        : null;
    res.json({
      ok: true,
      paymentId: payment.id,
      status: payment.status,
      amount,
      qr,
    });
  } catch (e) {
    const msg = e.message || String(e);
    if (e.code === 'NO_MP_TOKEN') {
      return res.status(503).json({ error: msg });
    }
    console.error('POST /api/reseller/topup:', msg);
    res.status(400).json({ error: msg });
  }
});

app.get('/api/reseller/payment/:paymentId', requireReseller, async (req, res) => {
  const user = String(req.headers['x-reseller-user'] || '').trim();
  const paymentId = String(req.params.paymentId || '').trim();
  try {
    const result = await processMercadoPagoPaymentForReseller(paymentId, user);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || 'Erro ao processar' });
    }
    const resellers = await store.loadResellers();
    const r = resellers.find((x) => x.username === user);
    res.json({
      ...result,
      balance: r ? r.balance : result.balance,
    });
  } catch (e) {
    console.error('GET /api/reseller/payment:', e.message || e);
    res.status(500).json({ error: 'Erro ao consultar pagamento' });
  }
});

app.post('/api/reseller/generate-redeem', requireReseller, express.json(), async (req, res) => {
  const user = String(req.headers['x-reseller-user'] || '').trim();
  const planId = String(req.body.plan || req.body.planId || '').trim();
  const plan = RESELLER_PLANS[planId];
  if (!plan) {
    return res.status(400).json({ error: 'Plano inválido. Use d1, d7, d15 ou d30.' });
  }
  const price = plan.price;
  let resellers = await store.loadResellers();
  const idx = resellers.findIndex((x) => x.username === user);
  if (idx === -1) return res.status(401).json({ error: 'Revendedor não encontrado' });
  if (roundMoney(resellers[idx].balance) < price) {
    return res.status(400).json({ error: 'Saldo insuficiente. Recarregue com PIX.' });
  }
  const keys = await store.loadRedeemKeys();
  let code;
  do {
    code = generateRedeemCode();
  } while (keys.some((k) => k.code === code));
  const expiresInSeconds = plan.days * 86400;
  const entry = {
    code,
    expiresInSeconds,
    createdAt: new Date().toISOString(),
    paused: false,
    pausedAt: null,
    usedAt: null,
    usedBy: null,
    createdByReseller: user,
  };
  keys.push(entry);
  resellers[idx] = { ...resellers[idx], balance: roundMoney(resellers[idx].balance - price) };
  await store.saveRedeemKeys(keys);
  await store.saveResellers(resellers);
  await appendActivity(
    {
      title: 'Key gerada (revendedor)',
      detail: plan.label + ' — ' + code + ' (-R$ ' + price + ')',
      actor: user,
    },
    user
  );
  try {
    const dp = await store.loadDiscordPanelSettings();
    await notifyKeyGenerated(
      {
        source: 'reseller',
        actor: user,
        codes: [code],
        planLabel: plan.label,
        expiresInSeconds,
        price,
      },
      dp
    );
  } catch (_) {}
  res.json({ ok: true, code, expiresInSeconds, plan: planId, label: plan.label, price, balance: resellers[idx].balance });
});

// Keys geradas por este revendedor (histórico)
app.get('/api/reseller/my-keys', requireReseller, async (req, res) => {
  const user = String(req.headers['x-reseller-user'] || '').trim();
  const keys = await loadRedeemKeysWithPause();
  const mine = (keys || []).filter((k) => String(k.createdByReseller || '').trim() === user);
  const nowEff = getEffectiveNowFromState(await getPauseState());
  res.json({
    keys: mine.map((k) => {
      const sec = k.expiresInSeconds || 0;
      let expired = false;
      if (sec > 0 && k.usedAt) {
        const started = new Date(k.usedAt).getTime();
        if (!Number.isNaN(started) && nowEff >= started + sec * 1000) expired = true;
      }
      return {
        code: k.code,
        expiresInSeconds: sec,
        createdAt: k.createdAt,
        usedAt: k.usedAt || null,
        usedBy: k.usedBy || null,
        paused: !!k.paused,
        expired,
      };
    }),
  });
});

// Contas loader cujo registro usou uma key gerada por este revendedor (usedBy = usuário loader)
app.get('/api/reseller/my-loaders', requireReseller, async (req, res) => {
  const user = String(req.headers['x-reseller-user'] || '').trim();
  const keys = await loadRedeemKeysWithPause();
  const mine = (keys || []).filter((k) => String(k.createdByReseller || '').trim() === user);
  const usedBys = new Set();
  for (const k of mine) {
    const ub = String(k.usedBy || '').trim();
    if (ub) usedBys.add(ub);
  }
  const accounts = await store.loadLoaderAccounts();
  const now = Date.now();
  const list = [];
  for (const username of usedBys) {
    const acc = accounts.find((a) => a.username === username);
    if (acc) {
      list.push({
        username: acc.username,
        hwid: acc.hwid || null,
        skipHwidCheck: !!acc.skipHwidCheck,
        expiresAt: acc.expiresAt || null,
        paused: !!acc.paused,
        online: isOnlineByLastLogin(acc.lastLoginAt, LOADER_PRESENCE_TTL_MS, now),
        lastLoginAt: acc.lastLoginAt || null,
        orphan: false,
      });
    } else {
      list.push({
        username,
        hwid: null,
        skipHwidCheck: false,
        expiresAt: null,
        paused: false,
        online: false,
        lastLoginAt: null,
        orphan: true,
      });
    }
  }
  list.sort((a, b) => String(a.username).localeCompare(String(b.username)));
  res.json({ accounts: list });
});

/** True se alguma key deste revendedor foi resgatada por este usuário loader. */
async function resellerOwnsLoaderUsername(resellerUsername, loaderUsername) {
  const ru = String(resellerUsername || '').trim();
  const lu = String(loaderUsername || '').trim();
  if (!ru || !lu) return false;
  const keys = await loadRedeemKeysWithPause();
  return (keys || []).some(
    (k) =>
      String(k.createdByReseller || '').trim() === ru && String(k.usedBy || '').trim() === lu
  );
}

// Reset HWID — só contas ligadas às keys do revendedor
app.post('/api/reseller/loader-accounts/:username/reset-hwid', requireReseller, async (req, res) => {
  const resellerUser = String(req.headers['x-reseller-user'] || '').trim();
  const username = decodeURIComponent(req.params.username);
  const owns = await resellerOwnsLoaderUsername(resellerUser, username);
  if (!owns) return res.status(403).json({ error: 'Esta conta não está ligada às suas keys.' });
  const accounts = await store.loadLoaderAccounts();
  const acc = accounts.find((a) => a.username === username);
  if (!acc) return res.status(404).json({ error: 'Conta não encontrada.' });
  const updated = accounts.map((a) => (a.username === username ? { ...a, hwid: null } : a));
  await store.saveLoaderAccounts(updated);
  res.json({ ok: true, username, message: 'HWID resetado. O usuário pode logar de outro PC.' });
});

app.post('/api/reseller/loader-accounts/:username/pause', requireReseller, express.json(), async (req, res) => {
  const resellerUser = String(req.headers['x-reseller-user'] || '').trim();
  const username = decodeURIComponent(req.params.username);
  const owns = await resellerOwnsLoaderUsername(resellerUser, username);
  if (!owns) return res.status(403).json({ error: 'Esta conta não está ligada às suas keys.' });
  const accounts = await store.loadLoaderAccounts();
  const acc = accounts.find((a) => a.username === username);
  if (!acc) return res.status(404).json({ error: 'Conta não encontrada.' });
  const nextPaused = typeof req.body.paused === 'boolean' ? req.body.paused : !acc.paused;
  const updated = accounts.map((a) => (a.username === username ? { ...a, paused: nextPaused } : a));
  await store.saveLoaderAccounts(updated);
  res.json({ ok: true, username, paused: nextPaused });
});

app.delete('/api/reseller/loader-accounts/:username', requireReseller, async (req, res) => {
  const resellerUser = String(req.headers['x-reseller-user'] || '').trim();
  const username = decodeURIComponent(req.params.username);
  const owns = await resellerOwnsLoaderUsername(resellerUser, username);
  if (!owns) return res.status(403).json({ error: 'Esta conta não está ligada às suas keys.' });
  let accounts = await store.loadLoaderAccounts();
  const acc = accounts.find((a) => a.username === username);
  if (acc) {
    accounts = accounts.filter((a) => a.username !== username);
    await store.saveLoaderAccounts(accounts);
    return res.json({ ok: true, removed: username, mode: 'account' });
  }
  const keys = await store.loadRedeemKeys();
  let changed = false;
  const updated = (keys || []).map((k) => {
    if (
      String(k.createdByReseller || '').trim() === resellerUser &&
      String(k.usedBy || '').trim() === username
    ) {
      changed = true;
      return { ...k, usedBy: null, usedAt: null };
    }
    return k;
  });
  if (!changed) {
    return res.status(404).json({ error: 'Nada encontrado para remover.' });
  }
  await store.saveRedeemKeys(updated);
  res.json({ ok: true, removed: username, mode: 'unlink' });
});

app.post('/api/mercadopago/webhook', express.json(), async (req, res) => {
  res.status(200).json({ ok: true });
  try {
    const body = req.body || {};
    let paymentId = body && body.data && body.data.id;
    if (paymentId == null && typeof body.resource === 'string' && /^\d+$/.test(body.resource)) {
      paymentId = body.resource;
    }
    if (paymentId == null && body.topic === 'payment' && req.query && req.query.id) {
      paymentId = req.query.id;
    }
    if (paymentId == null) return;
    const p = await mpGetPayment(paymentId);
    if (!p || p.status !== 'approved') return;
    const meta = p.metadata || {};
    const user = String(meta.reseller_username || '').trim();
    if (!user || String(meta.type || '') !== 'reseller_topup') return;
    await processMercadoPagoPaymentForReseller(String(paymentId), user);
  } catch (e) {
    console.error('webhook MP:', e.message || e);
  }
});

// --- Contas do loader (login/senha + HWID) ---

// Listar contas loader (admin)
app.get('/api/loader-accounts', requireAuth, requireOwnerOrAjudante, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const accounts = await store.loadLoaderAccounts();
  const now = Date.now();
  res.json({
    accounts: accounts.map((a) => ({
      username: a.username,
      hwid: a.hwid || null,
      skipHwidCheck: !!a.skipHwidCheck,
      expiresAt: a.expiresAt || null,
      createdAt: a.createdAt || null,
      paused: !!a.paused,
      online: isOnlineByLastLogin(a.lastLoginAt, LOADER_PRESENCE_TTL_MS, now),
    })),
  });
});

// Criar conta loader (admin). Body: { username, password, expiresInDays? (0=permanente), skipHwidCheck? }
app.post('/api/loader-accounts', requireAuth, requireOwner, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  const expiresInDays = Math.max(0, parseInt(req.body.expiresInDays, 10) || 0);
  const skipHwidCheck = !!req.body.skipHwidCheck;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha obrigatórios.' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: 'Usuário só pode ter letras, números, _ e -.' });
  }

  const accounts = await store.loadLoaderAccounts();
  if (accounts.some((a) => a.username === username)) {
    return res.status(400).json({ error: 'Usuário já existe.' });
  }

  const nowMs = getEffectiveNowFromState(await getPauseState());
  const nowIso = new Date(nowMs).toISOString();
  const expiresAt = expiresInDays === 0 ? null : new Date(nowMs + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  accounts.push({
    username,
    passwordHash: hashPassword(password),
    hwid: null,
    skipHwidCheck,
    expiresAt,
    createdAt: nowIso,
    paused: false,
    lastLoginAt: null,
  });
  await store.saveLoaderAccounts(accounts);
  const now = Date.now();
  res.json({
    ok: true,
    username,
    skipHwidCheck,
    expiresAt,
    accounts: accounts.map((a) => ({ username: a.username, hwid: a.hwid || null, skipHwidCheck: !!a.skipHwidCheck, expiresAt: a.expiresAt || null, createdAt: a.createdAt || null, paused: !!a.paused, online: isOnlineByLastLogin(a.lastLoginAt, LOADER_PRESENCE_TTL_MS, now) })),
  });
});

// Remover conta loader (admin)
app.delete('/api/loader-accounts/:username', requireAuth, requireOwner, async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  let accounts = await store.loadLoaderAccounts();
  accounts = accounts.filter((a) => a.username !== username);
  await store.saveLoaderAccounts(accounts);
  const now = Date.now();
  res.json({ ok: true, removed: username, accounts: accounts.map((a) => ({ username: a.username, hwid: a.hwid || null, skipHwidCheck: !!a.skipHwidCheck, expiresAt: a.expiresAt || null, paused: !!a.paused, online: isOnlineByLastLogin(a.lastLoginAt, LOADER_PRESENCE_TTL_MS, now) })) });
});

// Reset HWID da conta loader (admin) — permite que a pessoa logue de outro PC
app.post('/api/loader-accounts/:username/reset-hwid', requireAuth, requireOwnerOrAjudante, async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const accounts = await store.loadLoaderAccounts();
  const acc = accounts.find((a) => a.username === username);
  if (!acc) {
    return res.status(404).json({ error: 'Conta não encontrada.' });
  }
  const updated = accounts.map((a) => (a.username === username ? { ...a, hwid: null } : a));
  await store.saveLoaderAccounts(updated);
  res.json({ ok: true, username, message: 'HWID resetado. O usuário pode logar de outro PC.' });
});

// Pausar/retomar conta loader (admin)
app.post('/api/loader-accounts/:username/pause', requireAuth, requireOwnerOrAjudante, async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const accounts = await store.loadLoaderAccounts();
  const acc = accounts.find((a) => a.username === username);
  if (!acc) {
    return res.status(404).json({ error: 'Conta nao encontrada.' });
  }
  const nextPaused = typeof req.body.paused === 'boolean' ? req.body.paused : !acc.paused;
  const updated = accounts.map((a) => (a.username === username ? { ...a, paused: nextPaused } : a));
  await store.saveLoaderAccounts(updated);
  const now = Date.now();
  res.json({
    ok: true,
    username,
    paused: nextPaused,
    accounts: updated.map((a) => ({
      username: a.username,
      hwid: a.hwid || null,
      skipHwidCheck: !!a.skipHwidCheck,
      expiresAt: a.expiresAt || null,
      createdAt: a.createdAt || null,
      paused: !!a.paused,
      online: isOnlineByLastLogin(a.lastLoginAt, LOADER_PRESENCE_TTL_MS, now),
    })),
  });
});

// Pausar/retomar todas as contas do loader (admin)
app.post('/api/loader-accounts/pause-all', requireAuth, requireOwnerOrAjudante, async (req, res) => {
  const accounts = await store.loadLoaderAccounts();
  if (!accounts || accounts.length === 0) {
    return res.json({ ok: true, paused: false, accounts: [] });
  }
  const allPaused = accounts.every((a) => a.paused);
  const nextPaused = typeof req.body.paused === 'boolean' ? req.body.paused : !allPaused;
  const updated = accounts.map((a) => ({ ...a, paused: nextPaused }));
  await store.saveLoaderAccounts(updated);
  const now = Date.now();
  res.json({
    ok: true,
    paused: nextPaused,
    count: updated.length,
    accounts: updated.map((a) => ({
      username: a.username,
      hwid: a.hwid || null,
      skipHwidCheck: !!a.skipHwidCheck,
      expiresAt: a.expiresAt || null,
      createdAt: a.createdAt || null,
      paused: !!a.paused,
      online: isOnlineByLastLogin(a.lastLoginAt, LOADER_PRESENCE_TTL_MS, now),
    })),
  });
});

async function buildKeysList(keysData) {
  const now = getEffectiveNowFromState(await getPauseState());
  const keys = keysData.keys || [];
  return keys.map((k) => {
    const sec = k.expiresInSeconds || 0;
    let expiresAt = null;
    if (sec > 0) {
      const added = new Date(k.addedAt).getTime();
      expiresAt = new Date(added + sec * 1000).toISOString();
    }
    const valid = !expiresAt || now < new Date(expiresAt).getTime();
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const seconds = Math.floor((sec % 3600) / 60);
    return {
      id: k.id,
      usuario: k.usuario || k.id,
      addedAt: k.addedAt,
      expiresInSeconds: sec,
      expiresInDays: days,
      expiresInHours: hours,
      expiresInMinutes: seconds,
      expiresAt: expiresAt,
      valid,
    };
  });
}

// Listar todas as keys (admin) com detalhes (sem cache para não mostrar dados antigos)
app.get('/api/keys', requireAuth, requireOwnerOrStaff, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Server-Id', SERVER_ID);
  const data = await store.loadKeysData();
  const list = await buildKeysList(data);
  const storage = store.USE_MYSQL ? 'mysql' : store.USE_SQL ? 'sql' : store.USE_SQLITE ? 'sqlite' : store.USE_BLOB ? 'blob' : store.USE_MEMORY ? 'memory' : 'fs';
  res.setHeader('X-Storage', storage);
  res.json({ keys: list });
});

// Adicionar key (admin). Body: { id, usuario?, expiresInSeconds? | expiresInDays? } (0 = permanente)
app.post('/api/keys', requireAuth, requireOwnerOrStaff, async (req, res) => {
  try {
    const id = String(req.body.id || '').trim();
    const usuario = String(req.body.usuario || '').trim() || id;
    let expiresInSeconds = 0;
    if (req.body.expiresInSeconds !== undefined && req.body.expiresInSeconds !== null)
      expiresInSeconds = Math.max(0, parseInt(req.body.expiresInSeconds, 10));
    else
      expiresInSeconds = (Math.max(0, parseInt(req.body.expiresInDays, 10) || 0)) * 86400;
    if (!id) return res.status(400).json({ error: 'ID obrigatório' });

    const data = await store.loadKeysData();
    const nowIso = new Date(getEffectiveNowFromState(await getPauseState())).toISOString();
    const exists = (data.keys || []).find((k) => k.id === id);
    if (exists) {
      exists.addedAt = nowIso;
      exists.expiresInSeconds = expiresInSeconds;
      exists.usuario = usuario;
    } else {
      data.keys = data.keys || [];
      data.keys.push({
        id,
        usuario,
        addedAt: nowIso,
        expiresInSeconds,
      });
    }
    await store.saveKeysData(data);
    const label = expiresInSeconds === 0 ? 'permanente' : expiresInSeconds + ' segundos';
    res.json({ ok: true, id, usuario, expiresInSeconds, label, keys: await buildKeysList(data) });
  } catch (e) {
    console.error('POST /api/keys:', e.message || e);
    res.status(500).json({ error: e.message || 'Erro ao adicionar. Tente de novo.' });
  }
});

// Remover key (admin)

// Renovar key (admin). Body: { key|id|code, addSeconds } (0 = permanente)
app.post('/api/keys/renew', requireAuth, requireOwnerOrStaff, async (req, res) => {
  try {
    const raw = String(req.body.key || req.body.id || req.body.code || '').trim();
    let addSeconds = 0;
    if (req.body.addSeconds !== undefined && req.body.addSeconds !== null)
      addSeconds = Math.max(0, parseInt(req.body.addSeconds, 10) || 0);
    else if (req.body.expiresInSeconds !== undefined && req.body.expiresInSeconds !== null)
      addSeconds = Math.max(0, parseInt(req.body.expiresInSeconds, 10) || 0);
    else
      addSeconds = (Math.max(0, parseInt(req.body.expiresInDays, 10) || 0)) * 86400;
    if (!raw) return res.status(400).json({ error: 'ID da key obrigatorio.' });

    const now = getEffectiveNowFromState(await getPauseState());
    const nowIso = new Date(now).toISOString();

    const data = await store.loadKeysData();
    const list = data.keys || [];
    const findKey = (id) => list.find((k) => String(k.id || '').toLowerCase() === String(id || '').toLowerCase());

    const renewActiveKey = async (key) => {
      const currentSeconds = Math.max(0, parseInt(key.expiresInSeconds, 10) || 0);
      if (currentSeconds === 0) return { error: 'Essa key e permanente e nao precisa de renovacao.' };
      const addedMs = new Date(key.addedAt).getTime();
      const endMs = Number.isNaN(addedMs) ? now : addedMs + currentSeconds * 1000;
      const remainingSec = Math.max(0, Math.floor((endMs - now) / 1000));
      const newSeconds = addSeconds === 0 ? 0 : remainingSec + addSeconds;
      key.expiresInSeconds = newSeconds;
      key.addedAt = nowIso;
      await store.saveKeysData(data);
      return { ok: true, id: key.id, expiresInSeconds: newSeconds };
    };

    const renewLoaderAccount = async (username) => {
      const accounts = await store.loadLoaderAccounts();
      const account = accounts.find((a) => String(a.username || '').toLowerCase() === String(username || '').toLowerCase());
      if (!account) return null;
      if (!account.expiresAt) {
        if (addSeconds === 0) return { ok: true, username: account.username, expiresAt: null };
        return { error: 'Essa conta e permanente e nao precisa de renovacao.' };
      }
      const endMs = new Date(account.expiresAt).getTime();
      const remainingSec = Number.isNaN(endMs) ? 0 : Math.max(0, Math.floor((endMs - now) / 1000));
      const newSeconds = addSeconds === 0 ? 0 : remainingSec + addSeconds;
      account.expiresAt = newSeconds === 0 ? null : new Date(now + newSeconds * 1000).toISOString();
      await store.saveLoaderAccounts(accounts);
      return { ok: true, username: account.username, expiresAt: account.expiresAt };
    };


    let key = findKey(raw);
    if (key) {
      const result = await renewActiveKey(key);
      if (result && result.error) return res.status(400).json({ error: result.error });
      return res.json({ ok: true, type: 'id', id: key.id, expiresInSeconds: result.expiresInSeconds });
    }

    if (typeof store.loadRedeemKeys === 'function') {
      const redeemKeys = await store.loadRedeemKeys();
      const entry = redeemKeys.find((k) => String(k.code || '').toUpperCase() === raw.toUpperCase());
      if (entry) {
        if (entry.usedAt) {
          const usedBy = String(entry.usedBy || '').trim();
          if (usedBy) {
            key = findKey(usedBy);
            if (key) {
              const result = await renewActiveKey(key);
              if (result && result.error) return res.status(400).json({ error: result.error });
              return res.json({ ok: true, type: 'id', id: key.id, sourceCode: entry.code, expiresInSeconds: result.expiresInSeconds });
            }

            const loaderResult = await renewLoaderAccount(usedBy);
            if (loaderResult && loaderResult.error) return res.status(400).json({ error: loaderResult.error });
            if (loaderResult && loaderResult.ok) {
              return res.json({ ok: true, type: 'loader', username: loaderResult.username, sourceCode: entry.code, expiresAt: loaderResult.expiresAt });
            }
          }
          return res.status(400).json({ error: 'Essa key ja foi utilizada. Informe o ID da key ativa.' });
        }
        const currentSeconds = Math.max(0, parseInt(entry.expiresInSeconds, 10) || 0);
        if (currentSeconds === 0) return res.status(400).json({ error: 'Essa key e permanente e nao precisa de renovacao.' });
        const newSeconds = addSeconds === 0 ? 0 : currentSeconds + addSeconds;
        entry.expiresInSeconds = newSeconds;
        await store.saveRedeemKeys(redeemKeys);
        return res.json({ ok: true, type: 'redeem', code: entry.code, expiresInSeconds: newSeconds });
      }
    }

    return res.status(404).json({ error: 'Key nao encontrada.' });
  } catch (e) {
    console.error('POST /api/keys/renew:', e.message || e);
    res.status(500).json({ error: 'Erro ao renovar key.' });
  }
});

app.delete('/api/keys/:id', requireAuth, requireOwnerOrStaff, async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const data = await store.loadKeysData();
  data.keys = (data.keys || []).filter((k) => k.id !== id);
  await store.saveKeysData(data);
  res.json({ ok: true, removed: id, keys: await buildKeysList(data) });
});

// Limpar apenas keys/IDs expirados (admin)
app.delete('/api/keys/expired', requireAuth, requireOwnerOrStaff, async (req, res) => {
  const data = await store.loadKeysData();
  const now = getEffectiveNowFromState(await getPauseState());
  const before = (data.keys || []).length;
  data.keys = (data.keys || []).filter((k) => {
    const sec = k.expiresInSeconds || 0;
    if (sec === 0) return true;
    const added = new Date(k.addedAt).getTime();
    return now < added + sec * 1000;
  });
  const removed = before - data.keys.length;
  await store.saveKeysData(data);
  res.json({ ok: true, removed });
});

// Pausar/retomar contagem de tempo das keys (admin)
app.get('/api/keys/pause', requireAuth, requireOwnerOrStaff, async (req, res) => {
  const state = await getPauseState();
  res.json(state);
});

app.post('/api/keys/pause', requireAuth, requireOwnerOrStaff, async (req, res) => {
  const state = await getPauseState();
  const now = Date.now();
  if (!state.paused) {
    state.paused = true;
    state.pausedAt = new Date(now).toISOString();
  } else {
    if (state.pausedAt) {
      const startedAt = new Date(state.pausedAt).getTime();
      if (!Number.isNaN(startedAt)) {
        state.totalPausedMs = (state.totalPausedMs || 0) + Math.max(0, now - startedAt);
      }
    }
    state.paused = false;
    state.pausedAt = null;
  }
  await store.savePauseState(state);
  res.json(state);
});

// Limpar todas as keys (admin)
app.delete('/api/keys', requireAuth, requireOwnerOrStaff, async (req, res) => {
  const data = await store.loadKeysData();
  const count = (data.keys || []).length;
  data.keys = [];
  await store.saveKeysData(data);
  res.json({ ok: true, removed: count });
});

// Importar keys em lote (admin). Body: { keys: [ { id, usuario?, expiresInDays? } ] }
app.post('/api/keys/import', requireAuth, requireOwnerOrStaff, async (req, res) => {
  const list = req.body.keys;
  if (!Array.isArray(list) || list.length === 0) {
    return res.status(400).json({ error: 'Envie { keys: [ { id, usuario?, expiresInDays? } ] }' });
  }
  const data = await store.loadKeysData();
  data.keys = data.keys || [];
  const now = new Date(getEffectiveNowFromState(await getPauseState())).toISOString();
  let added = 0;
  for (const item of list) {
    const id = String(item.id || '').trim();
    if (!id) continue;
    let sec = Math.max(0, parseInt(item.expiresInSeconds, 10));
    if (sec === 0 && item.expiresInSeconds === undefined)
      sec = (Math.max(0, parseInt(item.expiresInDays, 10) || 0)) * 86400;
    const existing = data.keys.find((k) => k.id === id);
    if (existing) {
      existing.usuario = String(item.usuario || id).trim() || id;
      existing.expiresInSeconds = sec;
      existing.addedAt = now;
    } else {
      data.keys.push({
        id,
        usuario: String(item.usuario || id).trim() || id,
        addedAt: now,
        expiresInSeconds: sec,
      });
      added++;
    }
  }
  await store.saveKeysData(data);
  res.json({ ok: true, added, total: data.keys.length });
});

// Gerar keys de ativação (admin). Body: { expiresInSeconds, count? } — count default 1
app.post('/api/redeem-keys', requireAuth, requireOwnerOrStaff, async (req, res) => {
  try {
    let expiresInSeconds = 0;
    if (req.body.expiresInSeconds !== undefined && req.body.expiresInSeconds !== null)
      expiresInSeconds = Math.max(0, parseInt(req.body.expiresInSeconds, 10));
    else
      expiresInSeconds = (Math.max(0, parseInt(req.body.expiresInDays, 10) || 0)) * 86400;
    const count = Math.min(100, Math.max(1, parseInt(req.body.count, 10) || 1));
    const keys = await store.loadRedeemKeys();
    const codes = [];
    for (let i = 0; i < count; i++) {
      let code;
      do {
        code = generateRedeemCode();
      } while (keys.some((k) => k.code === code));
      keys.push({
        code,
        expiresInSeconds,
        createdAt: new Date().toISOString(),
        paused: false,
        pausedAt: null,
        usedAt: null,
        usedBy: null,
      });
      codes.push(code);
    }
    await store.saveRedeemKeys(keys);
    try {
      const dp = await store.loadDiscordPanelSettings();
      await notifyKeyGenerated(
        {
          source: 'admin',
          actor: getAdminPanelUser(req),
          codes,
          expiresInSeconds,
        },
        dp
      );
    } catch (_) {}
    res.json({ ok: true, codes, expiresInSeconds });
  } catch (e) {
    console.error('POST /api/redeem-keys:', e.message || e);
    res.status(500).json({ error: e.message || 'Erro ao gerar keys. Tente de novo.' });
  }
});

// Remover keys de ativação já usadas (admin)
app.delete('/api/redeem-keys/used', requireAuth, requireOwnerOrStaff, async (req, res) => {
  const keys = await loadRedeemKeysWithPause();
  const removedCodes = keys.filter((k) => k.usedAt).map((k) => k.code);
  const kept = keys.filter((k) => !k.usedAt);
  const removed = keys.length - kept.length;
  await store.saveRedeemKeys(kept);
  if (store.deleteRedeemKeyPause && (store.USE_MYSQL || store.USE_SQL || store.USE_SQLITE)) {
    for (const code of removedCodes) {
      await store.deleteRedeemKeyPause(code);
    }
  }
  try {
    const dp = await store.loadDiscordPanelSettings();
    await notifyKeyDeleted(
      {
        kind: 'bulk_used',
        count: removed,
        codes: removedCodes,
      },
      dp
    );
  } catch (_) {}
  res.json({ ok: true, removed });
});

// Remover uma key de ativação pelo código (admin)
app.delete('/api/redeem-keys/:code', requireAuth, requireOwnerOrStaff, async (req, res) => {
  const code = decodeURIComponent(req.params.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Código obrigatório.' });
  const keys = await loadRedeemKeysWithPause();
  const idx = keys.findIndex((k) => k.code.toUpperCase() === code.toUpperCase());
  if (idx === -1) return res.status(404).json({ error: 'Key não encontrada.' });
  keys.splice(idx, 1);
  await store.saveRedeemKeys(keys);
  if (store.deleteRedeemKeyPause && (store.USE_MYSQL || store.USE_SQL || store.USE_SQLITE)) {
    await store.deleteRedeemKeyPause(code);
  }
  try {
    const dp = await store.loadDiscordPanelSettings();
    await notifyKeyDeleted({ kind: 'single', codes: [code] }, dp);
  } catch (_) {}
  res.json({ ok: true, removed: code });
});

// Pausar/retomar uma key de ativação (admin)
app.post('/api/redeem-keys/:code/pause', requireAuth, requireOwnerOrStaff, async (req, res) => {
  const code = decodeURIComponent(req.params.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Código obrigatório.' });
  const keys = await loadRedeemKeysWithPause();
  const entry = keys.find((k) => k.code.toUpperCase() === code.toUpperCase());
  if (!entry) return res.status(404).json({ error: 'Key não encontrada.' });
  const nextPaused = typeof req.body.paused === 'boolean' ? req.body.paused : !entry.paused;
  const pausedAt = nextPaused ? new Date().toISOString() : null;
  entry.paused = nextPaused;
  entry.pausedAt = pausedAt;
  if (store.saveRedeemKeyPause && (store.USE_MYSQL || store.USE_SQL || store.USE_SQLITE)) {
    await store.saveRedeemKeyPause(code, { paused: nextPaused, pausedAt });
  } else {
    await store.saveRedeemKeys(keys);
  }
  res.json({ ok: true, code, paused: nextPaused, pausedAt });
});

// Listar keys de ativação (admin): todas, com status usado/não usado
app.get('/api/redeem-keys', requireAuth, requireOwnerOrStaff, async (req, res) => {
  const keys = await loadRedeemKeysWithPause();
  res.json({
    keys: keys.map((k) => ({
      code: k.code,
      expiresInSeconds: k.expiresInSeconds,
      createdAt: k.createdAt,
      paused: !!k.paused,
      pausedAt: k.pausedAt || null,
      usedAt: k.usedAt,
      usedBy: k.usedBy,
      createdByReseller: k.createdByReseller || null,
    })),
  });
});

// Registro pelo loader: usuário envia username, password e key (código gerado no site).
// A key vem da aba "Gerar key" / "Keys geradas". Cria conta loader e marca a key como usada.
app.post('/api/register', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  const key = String(req.body.key || '').trim();

  if (!username || !password || !key) {
    return res.status(400).json({ success: false, message: 'Preencha usuário, senha e key.' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ success: false, message: 'Usuário só pode ter letras, números, _ e -.' });
  }

  const keys = await loadRedeemKeysWithPause();
  const entry = keys.find((k) => k.code.toUpperCase() === key.toUpperCase());
  if (!entry) {
    return res.json({ success: false, message: 'Key inválida ou já utilizada.' });
  }
  if (entry.paused) {
    return res.json({ success: false, message: 'Key pausada.' });
  }
  if (entry.usedAt) {
    return res.json({ success: false, message: 'Key já foi utilizada.' });
  }

  const accounts = await store.loadLoaderAccounts();
  if (accounts.some((a) => a.username === username)) {
    return res.json({ success: false, message: 'Usuário já existe. Escolha outro.' });
  }

  entry.usedAt = new Date().toISOString();
  entry.usedBy = username;
  await store.saveRedeemKeys(keys);

  const expiresInSeconds = entry.expiresInSeconds != null ? entry.expiresInSeconds : 0;
  const expiresAt = expiresInSeconds === 0 ? null : new Date(getEffectiveNowFromState(await getPauseState()) + expiresInSeconds * 1000).toISOString();
  accounts.push({
    username,
    passwordHash: hashPassword(password),
    hwid: null,
    skipHwidCheck: false,
    expiresAt,
    createdAt: new Date().toISOString(),
    paused: false,
  });
  await store.saveLoaderAccounts(accounts);

  res.json({ success: true });
});

// Resgatar key (bot ou admin). Body: { code, id } — adiciona id às keys com a duração da key
app.post('/api/redeem', async (req, res) => {
  const code = String(req.body.code || '').trim();
  const id = String(req.body.id || req.body.productId || '').trim();
  if (!code || !id) {
    return res.status(400).json({ error: 'Envie code e id (ou productId).' });
  }
  const ok = await verifyAdmin(req);
  if (!ok) return res.status(401).json({ error: 'Não autorizado' });
  const keys = await loadRedeemKeysWithPause();
  const entry = keys.find((k) => k.code.toUpperCase() === code.toUpperCase());
  if (!entry) {
    return res.status(404).json({ error: 'Key inválida ou já utilizada.' });
  }
  if (entry.paused) {
    return res.status(400).json({ error: 'Key pausada.' });
  }
  if (entry.usedAt) {
    return res.status(400).json({ error: 'Key já foi utilizada.' });
  }
  entry.usedAt = new Date().toISOString();
  entry.usedBy = id;
  await store.saveRedeemKeys(keys);
  const data = await store.loadKeysData();
  const usuario = id;
  const nowIso = new Date(getEffectiveNowFromState(await getPauseState())).toISOString();
  const exists = (data.keys || []).find((k) => k.id === id);
  if (exists) {
    exists.addedAt = nowIso;
    exists.expiresInSeconds = entry.expiresInSeconds;
    exists.usuario = usuario;
  } else {
    data.keys = data.keys || [];
    data.keys.push({
      id,
      usuario,
      addedAt: nowIso,
      expiresInSeconds: entry.expiresInSeconds,
    });
  }
  await store.saveKeysData(data);
  res.json({ ok: true, id, expiresInSeconds: entry.expiresInSeconds });
});

// --- DLL: hospedar arquivo com link fixo para o injector ---
const DLL_DOWNLOAD_FILENAME = 'SilvaCheats.dll';
const MATADORFX_DOWNLOAD_FILENAME = 'FATALY.dll';
const NEXTMENU_DOWNLOAD_FILENAME = 'NEXTMENU.dll';
const FATALYPLAY_DOWNLOAD_FILENAME = 'FATALYPLAY.dll';
const FREEFIREINDIA_DOWNLOAD_FILENAME = 'LuaExecutor.dll';
const FREEFIREPLAY_DOWNLOAD_FILENAME = 'LuaExecutor.dll';
const LIBLINCE_DOWNLOAD_FILENAME = 'liblincdev.so';

function slotDefaultFilename(slot) {
  if (slot === 'matadorfx') return MATADORFX_DOWNLOAD_FILENAME;
  if (slot === 'nextmenu') return NEXTMENU_DOWNLOAD_FILENAME;
  if (slot === 'fatalyplay') return FATALYPLAY_DOWNLOAD_FILENAME;
  if (slot === 'freefireindia') return FREEFIREINDIA_DOWNLOAD_FILENAME;
  if (slot === 'freefireplay') return FREEFIREPLAY_DOWNLOAD_FILENAME;
  if (slot === 'liblince') return LIBLINCE_DOWNLOAD_FILENAME;
  return 'loader.dll';
}

function slotLabelName(slot) {
  if (slot === 'matadorfx') return 'MatadorFX';
  if (slot === 'nextmenu') return 'NextMenu';
  if (slot === 'fatalyplay') return 'FATALYPLAY';
  if (slot === 'freefireindia') return 'Free Fire India';
  if (slot === 'freefireplay') return 'Free Fire Play';
  if (slot === 'liblince') return 'Lince';
  return '';
}

function slotKindLabel(slot) {
  return slot === 'liblince' ? 'Lib' : 'DLL';
}

// Upload DLL em chunks (Postgres/Prisma) — evita limite 4,5 MB. Body: { uploadId, index, total, chunk: "base64..." }
const DLL_CHUNK_MAX_BASE64 = 4 * 1024 * 1024; // ~4 MB em base64 por requisição
app.post('/api/dll/chunk', requireAuth, requireOwner, async (req, res) => {
  const uploadId = req.body && req.body.uploadId && String(req.body.uploadId).trim();
  const index = req.body && typeof req.body.index === 'number' ? req.body.index : parseInt(req.body && req.body.index, 10);
  const chunkB64 = req.body && req.body.chunk;
  if (!uploadId || uploadId.length > 64 || !/^[a-zA-Z0-9\-_]+$/.test(uploadId)) {
    return res.status(400).json({ error: 'uploadId inválido.' });
  }
  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: 'index inválido.' });
  }
  if (!chunkB64 || typeof chunkB64 !== 'string' || chunkB64.length > DLL_CHUNK_MAX_BASE64) {
    return res.status(400).json({ error: 'chunk inválido ou grande demais.' });
  }
  if (!store.saveDllChunk) {
    return res.status(501).json({ error: 'Upload em chunks só disponível com Postgres.' });
  }
  try {
    const buf = Buffer.from(chunkB64, 'base64');
    await store.saveDllChunk(uploadId, index, buf);
    res.json({ ok: true, index });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao salvar chunk: ' + (e.message || String(e)) });
  }
});

// Finalizar upload em chunks. Body: { uploadId, total, filename, slot?, version? }
app.post('/api/dll/chunk-complete', requireAuth, requireOwner, async (req, res) => {
  const uploadId = req.body && req.body.uploadId && String(req.body.uploadId).trim();
  const total = req.body && (typeof req.body.total === 'number' ? req.body.total : parseInt(req.body.total, 10));
  const slot = req.body && ['matadorfx', 'nextmenu', 'fatalyplay', 'freefireindia', 'freefireplay', 'liblince'].includes(req.body.slot) ? req.body.slot : undefined;
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || slotDefaultFilename(slot);
  const version = req.body && req.body.version != null ? String(req.body.version).trim() : '';
  if (!uploadId || !Number.isInteger(total) || total < 1) {
    return res.status(400).json({ error: 'uploadId e total obrigatórios.' });
  }
  if (!store.getDllChunks || !store.setDllBuffer || !store.deleteDllChunks) {
    return res.status(501).json({ error: 'Upload em chunks só disponível com Postgres.' });
  }
  try {
    const chunks = await store.getDllChunks(uploadId);
    if (chunks.length !== total) {
      return res.status(400).json({ error: 'Faltam chunks. Enviados: ' + chunks.length + ', esperado: ' + total + '.' });
    }
    const ordered = chunks.sort((a, b) => a.index - b.index);
    const merged = Buffer.concat(ordered.map((c) => (Buffer.isBuffer(c.content) ? c.content : Buffer.from(c.content))));
    await store.setDllBuffer(merged, slot);
    await store.setDllMeta(filename, slot);
    if (slot === 'liblince' && typeof store.setLibLinceVersion === 'function') {
      await store.setLibLinceVersion(version);
    }
    await store.deleteDllChunks(uploadId);
    const kind = slotKindLabel(slot);
    const label = slotLabelName(slot);
    const msg = label ? `${kind} ${label} enviada. O link de download permanece o mesmo.` : `${kind} enviada. O link de download permanece o mesmo.`;
    res.json({ ok: true, size: merged.length, filename, message: msg });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao finalizar: ' + (e.message || String(e)) });
  }
});

// Upload DLL (admin). Body: { file: "base64...", filename: "nome.dll" } — slot principal
app.post('/api/dll', requireAuth, requireOwner, async (req, res) => {
  const b64 = req.body && req.body.file;
  if (!b64 || typeof b64 !== 'string') {
    return res.status(400).json({ error: 'Envie { file: "base64..." } com o conteúdo da DLL.' });
  }
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'loader.dll';
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'Arquivo vazio.' });
    await store.setDllBuffer(buf);
    await store.setDllMeta(filename);
    const name = await store.getDllMeta();
    res.json({ ok: true, size: buf.length, filename: name, message: 'DLL atualizada. O link de download permanece o mesmo.' });
  } catch (e) {
    const msg = e.message || String(e);
    const hint = process.env.VERCEL ? ' Na Vercel o corpo da requisição tem limite de 4,5 MB — adicione BLOB_READ_WRITE_TOKEN (Storage → Blob) e faça redeploy para DLLs maiores.' : '';
    res.status(500).json({ error: 'Erro ao salvar: ' + msg + hint });
  }
});

// Upload DLL MatadorFX (admin). Body: { file: "base64...", filename: "nome.dll" }
app.post('/api/dll/matadorfx', requireAuth, requireOwner, async (req, res) => {
  const b64 = req.body && req.body.file;
  if (!b64 || typeof b64 !== 'string') {
    return res.status(400).json({ error: 'Envie { file: "base64..." } com o conteúdo da DLL.' });
  }
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'FATALY.dll';
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'Arquivo vazio.' });
    await store.setDllBuffer(buf, 'matadorfx');
    await store.setDllMeta(filename, 'matadorfx');
    const name = await store.getDllMeta('matadorfx');
    res.json({ ok: true, size: buf.length, filename: name, message: 'DLL MatadorFX atualizada. O link de download permanece o mesmo.' });
  } catch (e) {
    const msg = e.message || String(e);
    res.status(500).json({ error: 'Erro ao salvar: ' + msg });
  }
});

// Upload DLL NextMenu (admin). Body: { file: "base64...", filename: "nome.dll" }
app.post('/api/dll/nextmenu', requireAuth, requireOwner, async (req, res) => {
  const b64 = req.body && req.body.file;
  if (!b64 || typeof b64 !== 'string') {
    return res.status(400).json({ error: 'Envie { file: "base64..." } com o conteúdo da DLL.' });
  }
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'NEXTMENU.dll';
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'Arquivo vazio.' });
    await store.setDllBuffer(buf, 'nextmenu');
    await store.setDllMeta(filename, 'nextmenu');
    const name = await store.getDllMeta('nextmenu');
    res.json({ ok: true, size: buf.length, filename: name, message: 'DLL NextMenu atualizada. O link de download permanece o mesmo.' });
  } catch (e) {
    const msg = e.message || String(e);
    res.status(500).json({ error: 'Erro ao salvar: ' + msg });
  }
});

// Confirmar DLL enviada por upload direto ao Blob (evita limite 4,5 MB). Body: { url: "https://...", filename: "nome.dll" }
app.post('/api/dll/confirm', requireAuth, requireOwner, async (req, res) => {
  const url = req.body && req.body.url && String(req.body.url).trim();
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'loader.dll';
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Envie { url: "https://..." } da DLL no Blob.' });
  }
  if (!store.setDllBlobUrl) {
    return res.status(501).json({ error: 'Upload por URL só disponível com Postgres.' });
  }
  try {
    await store.setDllBlobUrl(url);
    await store.setDllMeta(filename);
    res.json({ ok: true, message: 'DLL vinculada. O link de download permanece o mesmo.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao salvar: ' + (e.message || String(e)) });
  }
});

// Upload DLL FATALYPLAY (admin). Body: { file: "base64...", filename: "nome.dll" }
app.post('/api/dll/fatalyplay', requireAuth, requireOwner, async (req, res) => {
  const b64 = req.body && req.body.file;
  if (!b64 || typeof b64 !== 'string') {
    return res.status(400).json({ error: 'Envie { file: "base64..." } com o conteúdo da DLL.' });
  }
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'FATALYPLAY.dll';
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'Arquivo vazio.' });
    await store.setDllBuffer(buf, 'fatalyplay');
    await store.setDllMeta(filename, 'fatalyplay');
    const name = await store.getDllMeta('fatalyplay');
    res.json({ ok: true, size: buf.length, filename: name, message: 'DLL FATALYPLAY atualizada. O link de download permanece o mesmo.' });
  } catch (e) {
    const msg = e.message || String(e);
    res.status(500).json({ error: 'Erro ao salvar: ' + msg });
  }
});

// Upload DLL Free Fire India (admin). Body: { file: "base64...", filename: "nome.dll" }
app.post('/api/dll/freefireindia', requireAuth, requireOwner, async (req, res) => {
  const b64 = req.body && req.body.file;
  if (!b64 || typeof b64 !== 'string') {
    return res.status(400).json({ error: 'Envie { file: "base64..." } com o conteÃºdo da DLL.' });
  }
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'LuaExecutor.dll';
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'Arquivo vazio.' });
    await store.setDllBuffer(buf, 'freefireindia');
    await store.setDllMeta(filename, 'freefireindia');
    const name = await store.getDllMeta('freefireindia');
    res.json({ ok: true, size: buf.length, filename: name, message: 'DLL Free Fire India atualizada. O link de download permanece o mesmo.' });
  } catch (e) {
    const msg = e.message || String(e);
    res.status(500).json({ error: 'Erro ao salvar: ' + msg });
  }
});

// Upload DLL Free Fire Play (admin). Body: { file: "base64...", filename: "nome.dll" }
app.post('/api/dll/freefireplay', requireAuth, requireOwner, async (req, res) => {
  const b64 = req.body && req.body.file;
  if (!b64 || typeof b64 !== 'string') {
    return res.status(400).json({ error: 'Envie { file: "base64..." } com o conteÃºdo da DLL.' });
  }
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'LuaExecutor.dll';
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'Arquivo vazio.' });
    await store.setDllBuffer(buf, 'freefireplay');
    await store.setDllMeta(filename, 'freefireplay');
    const name = await store.getDllMeta('freefireplay');
    res.json({ ok: true, size: buf.length, filename: name, message: 'DLL Free Fire Play atualizada. O link de download permanece o mesmo.' });
  } catch (e) {
    const msg = e.message || String(e);
    res.status(500).json({ error: 'Erro ao salvar: ' + msg });
  }
});

// Upload Lib Lince (admin). Body: { file: "base64...", filename: "nome.so", version?: "1.2.3" }
app.post('/api/dll/liblince', requireAuth, requireOwner, async (req, res) => {
  const b64 = req.body && req.body.file;
  if (!b64 || typeof b64 !== 'string') {
    return res.status(400).json({ error: 'Envie { file: "base64..." } com o conteÃºdo da lib.' });
  }
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'liblincdev.so';
  const version = req.body && req.body.version != null ? String(req.body.version).trim() : '';
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'Arquivo vazio.' });
    await store.setDllBuffer(buf, 'liblince');
    await store.setDllMeta(filename, 'liblince');
    if (typeof store.setLibLinceVersion === 'function') {
      await store.setLibLinceVersion(version);
    }
    const name = await store.getDllMeta('liblince');
    res.json({ ok: true, size: buf.length, filename: name, version: version || '', message: 'Lib Lince atualizada. O link de download permanece o mesmo.' });
  } catch (e) {
    const msg = e.message || String(e);
    res.status(500).json({ error: 'Erro ao salvar: ' + msg });
  }
});

// Confirmar DLL NextMenu por URL Blob
app.post('/api/dll/nextmenu/confirm', requireAuth, requireOwner, async (req, res) => {
  const url = req.body && req.body.url && String(req.body.url).trim();
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'NEXTMENU.dll';
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Envie { url: "https://..." } da DLL no Blob.' });
  }
  if (!store.setDllBlobUrl) {
    return res.status(501).json({ error: 'Upload por URL só disponível com Postgres.' });
  }
  try {
    await store.setDllBlobUrl(url, 'nextmenu');
    await store.setDllMeta(filename, 'nextmenu');
    res.json({ ok: true, message: 'DLL NextMenu vinculada. O link de download permanece o mesmo.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao salvar: ' + (e.message || String(e)) });
  }
});

// Confirmar DLL FATALYPLAY por URL Blob
app.post('/api/dll/fatalyplay/confirm', requireAuth, requireOwner, async (req, res) => {
  const url = req.body && req.body.url && String(req.body.url).trim();
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'FATALYPLAY.dll';
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Envie { url: "https://..." } da DLL no Blob.' });
  }
  if (!store.setDllBlobUrl) {
    return res.status(501).json({ error: 'Upload por URL só disponível com Postgres.' });
  }
  try {
    await store.setDllBlobUrl(url, 'fatalyplay');
    await store.setDllMeta(filename, 'fatalyplay');
    res.json({ ok: true, message: 'DLL FATALYPLAY vinculada. O link de download permanece o mesmo.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao salvar: ' + (e.message || String(e)) });
  }
});

// Confirmar DLL MatadorFX por URL Blob
app.post('/api/dll/matadorfx/confirm', requireAuth, requireOwner, async (req, res) => {
  const url = req.body && req.body.url && String(req.body.url).trim();
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'FATALY.dll';
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Envie { url: "https://..." } da DLL no Blob.' });
  }
  if (!store.setDllBlobUrl) {
    return res.status(501).json({ error: 'Upload por URL só disponível com Postgres.' });
  }
  try {
    await store.setDllBlobUrl(url, 'matadorfx');
    await store.setDllMeta(filename, 'matadorfx');
    res.json({ ok: true, message: 'DLL MatadorFX vinculada. O link de download permanece o mesmo.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao salvar: ' + (e.message || String(e)) });
  }
});

// Confirmar DLL Free Fire India por URL Blob
app.post('/api/dll/freefireindia/confirm', requireAuth, requireOwner, async (req, res) => {
  const url = req.body && req.body.url && String(req.body.url).trim();
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'LuaExecutor.dll';
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Envie { url: "https://..." } da DLL no Blob.' });
  }
  if (!store.setDllBlobUrl) {
    return res.status(501).json({ error: 'Upload por URL sÃ³ disponÃ­vel com Postgres.' });
  }
  try {
    await store.setDllBlobUrl(url, 'freefireindia');
    await store.setDllMeta(filename, 'freefireindia');
    res.json({ ok: true, message: 'DLL Free Fire India vinculada. O link de download permanece o mesmo.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao salvar: ' + (e.message || String(e)) });
  }
});

// Confirmar DLL Free Fire Play por URL Blob
app.post('/api/dll/freefireplay/confirm', requireAuth, requireOwner, async (req, res) => {
  const url = req.body && req.body.url && String(req.body.url).trim();
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'LuaExecutor.dll';
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Envie { url: "https://..." } da DLL no Blob.' });
  }
  if (!store.setDllBlobUrl) {
    return res.status(501).json({ error: 'Upload por URL sÃ³ disponÃ­vel com Postgres.' });
  }
  try {
    await store.setDllBlobUrl(url, 'freefireplay');
    await store.setDllMeta(filename, 'freefireplay');
    res.json({ ok: true, message: 'DLL Free Fire Play vinculada. O link de download permanece o mesmo.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao salvar: ' + (e.message || String(e)) });
  }
});

// Confirmar Lib Lince por URL Blob
app.post('/api/dll/liblince/confirm', requireAuth, requireOwner, async (req, res) => {
  const url = req.body && req.body.url && String(req.body.url).trim();
  const filename = (req.body && req.body.filename && String(req.body.filename).trim()) || 'liblincdev.so';
  const version = req.body && req.body.version != null ? String(req.body.version).trim() : '';
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Envie { url: "https://..." } da lib no Blob.' });
  }
  if (!store.setDllBlobUrl) {
    return res.status(501).json({ error: 'Upload por URL sÃ³ disponÃ­vel com Postgres.' });
  }
  try {
    await store.setDllBlobUrl(url, 'liblince');
    await store.setDllMeta(filename, 'liblince');
    if (typeof store.setLibLinceVersion === 'function') {
      await store.setLibLinceVersion(version);
    }
    res.json({ ok: true, message: 'Lib Lince vinculada. O link de download permanece o mesmo.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao salvar: ' + (e.message || String(e)) });
  }
});

async function sendDllFile(req, res, slot) {
  const flags = await store.loadLoaderProductFlags();
  let flagKey = null;
  if (slot === 'freefireplay') flagKey = '0';
  else if (slot === 'freefireindia') flagKey = '1';
  else if (slot === undefined || slot === null || slot === '') flagKey = '2';
  if (flagKey !== null && flags[flagKey] === false) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(403).json({ error: 'Esta versao esta desativada no painel.', disabled: true });
  }

  const buf = await store.getDllBuffer(slot);
  if (!buf || buf.length === 0) {
    return res.status(404).json({ error: 'Nenhuma DLL hospedada ainda.' });
  }
  const filename = slot === 'matadorfx' ? MATADORFX_DOWNLOAD_FILENAME
    : slot === 'nextmenu' ? NEXTMENU_DOWNLOAD_FILENAME
      : slot === 'fatalyplay' ? FATALYPLAY_DOWNLOAD_FILENAME
        : slot === 'freefireindia' ? FREEFIREINDIA_DOWNLOAD_FILENAME
          : slot === 'freefireplay' ? FREEFIREPLAY_DOWNLOAD_FILENAME
            : slot === 'liblince' ? LIBLINCE_DOWNLOAD_FILENAME
              : DLL_DOWNLOAD_FILENAME;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename.replace(/"/g, '\\"') + '"');
  res.send(buf);
}

app.get('/api/dll/download', (req, res) => sendDllFile(req, res, undefined));
app.get('/api/dll/download/' + DLL_DOWNLOAD_FILENAME, (req, res) => sendDllFile(req, res, undefined));
app.get('/api/dll/download/matadorfx', (req, res) => sendDllFile(req, res, 'matadorfx'));
app.get('/api/dll/download/' + MATADORFX_DOWNLOAD_FILENAME, (req, res) => sendDllFile(req, res, 'matadorfx'));
app.get('/api/dll/download/nextmenu', (req, res) => sendDllFile(req, res, 'nextmenu'));
app.get('/api/dll/download/' + NEXTMENU_DOWNLOAD_FILENAME, (req, res) => sendDllFile(req, res, 'nextmenu'));
app.get('/api/dll/download/fatalyplay', (req, res) => sendDllFile(req, res, 'fatalyplay'));
app.get('/api/dll/download/' + FATALYPLAY_DOWNLOAD_FILENAME, (req, res) => sendDllFile(req, res, 'fatalyplay'));
app.get('/api/dll/download/freefireindia', (req, res) => sendDllFile(req, res, 'freefireindia'));
app.get('/api/dll/download/freefireplay', (req, res) => sendDllFile(req, res, 'freefireplay'));
app.get('/api/dll/download/liblince', (req, res) => sendDllFile(req, res, 'liblince'));
app.get('/api/dll/download/' + LIBLINCE_DOWNLOAD_FILENAME, (req, res) => sendDllFile(req, res, 'liblince'));

// Info da DLL (admin): existe, tamanho, URL fixo — slot principal
app.get('/api/dll/info', requireAuth, requireOwner, async (req, res) => {
  const exists = await store.dllExists();
  let size = 0;
  if (exists) {
    const buf = await store.getDllBuffer();
    if (buf) size = buf.length;
  }
  const baseUrl = req.protocol + '://' + req.get('host');
  res.json({
    exists,
    size,
    filename: exists ? DLL_DOWNLOAD_FILENAME : null,
    url: baseUrl + '/api/dll/download/' + DLL_DOWNLOAD_FILENAME,
  });
});

// Deletar DLL do slot principal (admin)
app.delete('/api/dll', requireAuth, requireOwner, async (req, res) => {
  try {
    await store.setDllBuffer(Buffer.alloc(0));
    await store.setDllMeta('loader.dll');
    res.json({ ok: true, message: 'DLL principal removida do site.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao remover: ' + (e.message || String(e)) });
  }
});

// Deletar DLL MatadorFX (admin)
app.delete('/api/dll/matadorfx', requireAuth, requireOwner, async (req, res) => {
  try {
    await store.setDllBuffer(Buffer.alloc(0), 'matadorfx');
    await store.setDllMeta('FATALY.dll', 'matadorfx');
    res.json({ ok: true, message: 'DLL MatadorFX removida do site.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao remover: ' + (e.message || String(e)) });
  }
});

// Deletar DLL NextMenu (admin)
app.delete('/api/dll/nextmenu', requireAuth, requireOwner, async (req, res) => {
  try {
    await store.setDllBuffer(Buffer.alloc(0), 'nextmenu');
    await store.setDllMeta('NEXTMENU.dll', 'nextmenu');
    res.json({ ok: true, message: 'DLL NextMenu removida do site.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao remover: ' + (e.message || String(e)) });
  }
});

// Deletar DLL FATALYPLAY (admin)
app.delete('/api/dll/fatalyplay', requireAuth, requireOwner, async (req, res) => {
  try {
    await store.setDllBuffer(Buffer.alloc(0), 'fatalyplay');
    await store.setDllMeta('FATALYPLAY.dll', 'fatalyplay');
    res.json({ ok: true, message: 'DLL FATALYPLAY removida do site.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao remover: ' + (e.message || String(e)) });
  }
});

// Deletar DLL Free Fire India (admin)
app.delete('/api/dll/freefireindia', requireAuth, requireOwner, async (req, res) => {
  try {
    await store.setDllBuffer(Buffer.alloc(0), 'freefireindia');
    await store.setDllMeta('LuaExecutor.dll', 'freefireindia');
    res.json({ ok: true, message: 'DLL Free Fire India removida do site.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao remover: ' + (e.message || String(e)) });
  }
});

// Deletar DLL Free Fire Play (admin)
app.delete('/api/dll/freefireplay', requireAuth, requireOwner, async (req, res) => {
  try {
    await store.setDllBuffer(Buffer.alloc(0), 'freefireplay');
    await store.setDllMeta('LuaExecutor.dll', 'freefireplay');
    res.json({ ok: true, message: 'DLL Free Fire Play removida do site.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao remover: ' + (e.message || String(e)) });
  }
});

// Deletar Lib Lince (admin)
app.delete('/api/dll/liblince', requireAuth, requireOwner, async (req, res) => {
  try {
    await store.setDllBuffer(Buffer.alloc(0), 'liblince');
    await store.setDllMeta('liblincdev.so', 'liblince');
    if (typeof store.setLibLinceVersion === 'function') {
      await store.setLibLinceVersion('');
    }
    res.json({ ok: true, message: 'Lib Lince removida do site.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao remover: ' + (e.message || String(e)) });
  }
});

// Info da DLL MatadorFX (admin)
app.get('/api/dll/matadorfx/info', requireAuth, requireOwner, async (req, res) => {
  const exists = await store.dllExists('matadorfx');
  let size = 0;
  if (exists) {
    const buf = await store.getDllBuffer('matadorfx');
    if (buf) size = buf.length;
  }
  const baseUrl = req.protocol + '://' + req.get('host');
  res.json({
    exists,
    size,
    filename: exists ? MATADORFX_DOWNLOAD_FILENAME : null,
    url: baseUrl + '/api/dll/download/' + MATADORFX_DOWNLOAD_FILENAME,
  });
});

// Info da DLL NextMenu (admin)
app.get('/api/dll/nextmenu/info', requireAuth, requireOwner, async (req, res) => {
  const exists = await store.dllExists('nextmenu');
  let size = 0;
  if (exists) {
    const buf = await store.getDllBuffer('nextmenu');
    if (buf) size = buf.length;
  }
  const baseUrl = req.protocol + '://' + req.get('host');
  res.json({
    exists,
    size,
    filename: exists ? NEXTMENU_DOWNLOAD_FILENAME : null,
    url: baseUrl + '/api/dll/download/' + NEXTMENU_DOWNLOAD_FILENAME,
  });
});

// Info da DLL FATALYPLAY (admin)
app.get('/api/dll/fatalyplay/info', requireAuth, requireOwner, async (req, res) => {
  const exists = await store.dllExists('fatalyplay');
  let size = 0;
  if (exists) {
    const buf = await store.getDllBuffer('fatalyplay');
    if (buf) size = buf.length;
  }
  const baseUrl = req.protocol + '://' + req.get('host');
  res.json({
    exists,
    size,
    filename: exists ? FATALYPLAY_DOWNLOAD_FILENAME : null,
    url: baseUrl + '/api/dll/download/' + FATALYPLAY_DOWNLOAD_FILENAME,
  });
});

// Info da DLL Free Fire India (admin)
app.get('/api/dll/freefireindia/info', requireAuth, requireOwner, async (req, res) => {
  const exists = await store.dllExists('freefireindia');
  let size = 0;
  if (exists) {
    const buf = await store.getDllBuffer('freefireindia');
    if (buf) size = buf.length;
  }
  const baseUrl = req.protocol + '://' + req.get('host');
  res.json({
    exists,
    size,
    filename: exists ? FREEFIREINDIA_DOWNLOAD_FILENAME : null,
    url: baseUrl + '/api/dll/download/freefireindia',
  });
});

// Info da DLL Free Fire Play (admin)
app.get('/api/dll/freefireplay/info', requireAuth, requireOwner, async (req, res) => {
  const exists = await store.dllExists('freefireplay');
  let size = 0;
  if (exists) {
    const buf = await store.getDllBuffer('freefireplay');
    if (buf) size = buf.length;
  }
  const baseUrl = req.protocol + '://' + req.get('host');
  res.json({
    exists,
    size,
    filename: exists ? FREEFIREPLAY_DOWNLOAD_FILENAME : null,
    url: baseUrl + '/api/dll/download/freefireplay',
  });
});

// Info da Lib Lince (admin)
app.get('/api/dll/liblince/info', requireAuth, requireOwner, async (req, res) => {
  const exists = await store.dllExists('liblince');
  let size = 0;
  if (exists) {
    const buf = await store.getDllBuffer('liblince');
    if (buf) size = buf.length;
  }
  const baseUrl = req.protocol + '://' + req.get('host');
  const version = typeof store.getLibLinceVersion === 'function' ? await store.getLibLinceVersion() : '';
  res.json({
    exists,
    size,
    filename: exists ? LIBLINCE_DOWNLOAD_FILENAME : null,
    url: baseUrl + '/api/dll/download/' + LIBLINCE_DOWNLOAD_FILENAME,
    version: version || '',
  });
});

// Rotas HTML principais: /, /admin, /vendedor (definidas antes do express.static)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Rota não encontrada' });
  }
  res.redirect(302, '/');
});

// Exportar para a Vercel usar como serverless; localmente inicia o servidor
module.exports = app;
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Cloud Fire: http://0.0.0.0:' + PORT);
    console.log('  Site: /  ·  Admin: /admin  ·  Vendedor: /vendedor');
    console.log('  GET /keys.json -> lista de IDs válidos (para o loader)');
    if (store.USE_MYSQL) {
      require('./store-mysql')
        .pingDb()
        .then(() => {
          console.log('  MySQL: ligado (SELECT 1 OK).');
          return ensurePanelUsersOnce();
        })
        .then(() => console.log('  Painel: contas admin/silva verificadas.'))
        .catch((e) => {
          console.error('  MySQL: FALHA ao ligar —', e.message || e);
          console.error('  → Sem MySQL a funcionar, login e API vão falhar. Teste: npm run verify:mysql');
          console.error('  → Sem MYSQL_* no .env o projeto usa SQLite local e não depende do servidor MySQL.');
        });
    } else if (store.USE_SQL) {
      require('./store-sql')
        .pingDb()
        .then(() => console.log('  Postgres: ligado (SELECT 1 OK).'))
        .then(() => ensurePanelUsersOnce())
        .then(() => console.log('  Painel: contas admin/silva verificadas.'))
        .catch((e) => {
          console.error('  Postgres: FALHA —', e.message || e);
        });
    } else if (store.USE_SQLITE) {
      ensurePanelUsersOnce()
        .then(() => console.log('  Painel: contas admin/silva verificadas.'))
        .catch((e) => console.error('  Painel: seed utilizadores —', e.message || e));
    }
    // Aquecer o SQLite na subida para o banco ficar carregado e não resetar por atraso na primeira requisição
    if (store.USE_SQLITE) {
      Promise.all([
        store.loadKeysData(),
        store.loadLoaderAccounts ? store.loadLoaderAccounts() : Promise.resolve(),
        store.loadUsers(),
        store.loadRedeemKeys ? store.loadRedeemKeys() : Promise.resolve(),
      ]).catch(() => {});
    }
  });
}
