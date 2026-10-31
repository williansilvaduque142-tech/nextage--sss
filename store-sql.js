/**
 * Persistência em Postgres (SQL).
 * - Vercel + Aurora: usa IAM (AWS_ROLE_ARN, PGHOST, PGUSER...) — sem PGPASSWORD.
 * - Outros: DATABASE_URL, POSTGRES_URL ou PGHOST+PGUSER+PGPASSWORD+PGDATABASE.
 */
require('dotenv').config();
const { normalizeStoredHash } = require('./hashNormalize');
const { Pool } = require('pg');

let pool = null;
let poolPromise = null;

const USE_IAM = !!(process.env.VERCEL && process.env.AWS_ROLE_ARN && process.env.PGHOST);

async function getPool() {
  if (pool) return pool;
  if (poolPromise) return poolPromise;

  poolPromise = (async () => {
    let url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    if (!url && process.env.PGHOST) {
      const host = process.env.PGHOST;
      const port = Number(process.env.PGPORT) || 5432;
      const user = process.env.PGUSER || 'postgres';
      const database = process.env.PGDATABASE || 'postgres';
      const sslRequired = process.env.PGSSLMODE === 'require';

      if (USE_IAM) {
        const { Signer } = require('@aws-sdk/rds-signer');
        const { awsCredentialsProvider } = require('@vercel/functions/oidc');
        const signer = new Signer({
          hostname: host,
          port,
          username: user,
          region: process.env.AWS_REGION || 'us-east-1',
          credentials: awsCredentialsProvider({
            roleArn: process.env.AWS_ROLE_ARN,
            clientConfig: { region: process.env.AWS_REGION || 'us-east-1' },
          }),
        });
        const password = await signer.getAuthToken();
        pool = new Pool({
          host,
          port,
          user,
          database,
          password,
          ssl: sslRequired ? { rejectUnauthorized: false } : false,
          max: 2,
        });
        return pool;
      }

      // PGHOST com senha (sem IAM)

      if (!process.env.PGPASSWORD) throw new Error('PGPASSWORD é obrigatório quando usa PGHOST sem IAM (Aurora).');
      const pass = encodeURIComponent(process.env.PGPASSWORD);
      const ssl = sslRequired ? '?sslmode=require' : '';
      url = `postgresql://${encodeURIComponent(user)}:${pass}@${host}:${port}/${database}${ssl}`;
    }

    if (!url) throw new Error('Defina DATABASE_URL, POSTGRES_URL ou PGHOST+PGUSER (+ PGPASSWORD ou AWS_ROLE_ARN na Vercel).');
    pool = new Pool({ connectionString: url, max: 2 });
    return pool;
  })();

  return poolPromise;

  return poolPromise;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS silva_keys (
    id TEXT PRIMARY KEY,
    usuario TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL,
    expires_in_seconds INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS silva_users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    last_login_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS silva_loader_accounts (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    hwid TEXT,
    skip_hwid_check SMALLINT NOT NULL DEFAULT 0,
    paused SMALLINT NOT NULL DEFAULT 0,
    last_login_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `ALTER TABLE silva_loader_accounts ADD COLUMN IF NOT EXISTS paused SMALLINT NOT NULL DEFAULT 0`,
  `ALTER TABLE silva_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`,
  `ALTER TABLE silva_loader_accounts ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`,
  `CREATE TABLE IF NOT EXISTS silva_redeem_keys (
    code TEXT PRIMARY KEY,
    expires_in_seconds INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    used_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS silva_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS silva_activity (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    detail TEXT,
    actor TEXT,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS silva_dll_meta (
    id INT PRIMARY KEY DEFAULT 1,
    filename TEXT NOT NULL DEFAULT 'loader.dll'
  )`,
  `CREATE TABLE IF NOT EXISTS silva_dll_content (
    id INT PRIMARY KEY DEFAULT 1,
    content BYTEA
  )`,
  `INSERT INTO silva_dll_meta (id, filename) VALUES (1, 'loader.dll') ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_content (id, content) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_meta (id, filename) VALUES (2, 'FATALY.dll') ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_content (id, content) VALUES (2, NULL) ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_meta (id, filename) VALUES (3, 'NEXTMENU.dll') ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_content (id, content) VALUES (3, NULL) ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_meta (id, filename) VALUES (4, 'FATALYPLAY.dll') ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_content (id, content) VALUES (4, NULL) ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_meta (id, filename) VALUES (5, 'LuaExecutor.dll') ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_content (id, content) VALUES (5, NULL) ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_meta (id, filename) VALUES (6, 'LuaExecutor.dll') ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_content (id, content) VALUES (6, NULL) ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_meta (id, filename) VALUES (7, 'liblincdev.so') ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO silva_dll_content (id, content) VALUES (7, NULL) ON CONFLICT (id) DO NOTHING`,
  `ALTER TABLE silva_dll_meta ADD COLUMN IF NOT EXISTS blob_url TEXT`,
  `CREATE TABLE IF NOT EXISTS silva_dll_chunks (
    upload_id TEXT NOT NULL,
    chunk_index INT NOT NULL,
    content BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (upload_id, chunk_index)
  )`,
  `CREATE TABLE IF NOT EXISTS silva_resellers (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    balance DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS silva_mp_credited (
    payment_id TEXT PRIMARY KEY
  )`,
  `ALTER TABLE silva_redeem_keys ADD COLUMN IF NOT EXISTS created_by_reseller TEXT`,
  `ALTER TABLE silva_users ADD COLUMN IF NOT EXISTS bound_ip TEXT`,
  `ALTER TABLE silva_resellers ADD COLUMN IF NOT EXISTS bound_ip TEXT`,
  `ALTER TABLE silva_resellers ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
  `ALTER TABLE silva_users ADD COLUMN IF NOT EXISTS secret_phrase_hash TEXT`,
  `ALTER TABLE silva_users ADD COLUMN IF NOT EXISTS role TEXT`,
  `ALTER TABLE silva_resellers ADD COLUMN IF NOT EXISTS secret_phrase_hash TEXT`,
  `ALTER TABLE silva_resellers ADD COLUMN IF NOT EXISTS recovery_email TEXT`,
  `ALTER TABLE silva_resellers ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT`,
  `ALTER TABLE silva_resellers ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMPTZ`,
  `ALTER TABLE silva_resellers ADD COLUMN IF NOT EXISTS secret_phrase_plain TEXT`,
];

let migrated = false;
async function ensureMigration(client) {
  if (migrated) return;
  for (const q of MIGRATIONS) await client.query(q);
  migrated = true;
}

async function withClient(fn) {
  const p = await getPool();
  const client = await p.connect();
  try {
    await ensureMigration(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Verifica se o Postgres responde (usado em GET /api/storage). */
async function pingDb() {
  return withClient(async (client) => {
    await client.query('SELECT 1 AS ok');
  });
}

// --- API (mesma interface do store.js) ---

async function loadKeysData() {
  return withClient(async (client) => {
    const r = await client.query('SELECT id, usuario, added_at, expires_in_seconds FROM silva_keys ORDER BY added_at');
    const keys = (r.rows || []).map((row) => ({
      id: row.id,
      usuario: row.usuario || row.id,
      addedAt: row.added_at ? new Date(row.added_at).toISOString() : new Date().toISOString(),
      expiresInSeconds: row.expires_in_seconds != null ? row.expires_in_seconds : 0,
    }));
    return { keys };
  });
}

async function saveKeysData(data) {
  return withClient(async (client) => {
    await client.query('DELETE FROM silva_keys');
    const keys = data.keys || [];
    for (const k of keys) {
      const sec = k.expiresInSeconds != null ? k.expiresInSeconds : (k.expiresInDays || 0) * 86400;
      await client.query(
        'INSERT INTO silva_keys (id, usuario, added_at, expires_in_seconds) VALUES ($1, $2, $3, $4)',
        [k.id, k.usuario || k.id, k.addedAt || new Date().toISOString(), sec]
      );
    }
  });
}

async function loadUsers() {
  return withClient(async (client) => {
    const r = await client.query(
      'SELECT username, password_hash, last_login_at, bound_ip, secret_phrase_hash, role FROM silva_users'
    );
    return (r.rows || []).map((row) => ({
      username: row.username,
      passwordHash: normalizeStoredHash(row.password_hash),
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
      boundIp: row.bound_ip || null,
      secretPhraseHash: row.secret_phrase_hash ? normalizeStoredHash(row.secret_phrase_hash) : undefined,
      role: row.role || undefined,
    }));
  });
}

async function saveUsers(users) {
  return withClient(async (client) => {
    await client.query('DELETE FROM silva_users');
    for (const u of users) {
      await client.query(
        'INSERT INTO silva_users (username, password_hash, last_login_at, bound_ip, secret_phrase_hash, role) VALUES ($1, $2, $3, $4, $5, $6)',
        [u.username, u.passwordHash, u.lastLoginAt || null, u.boundIp || null, u.secretPhraseHash || null, u.role || 'staff']
      );
    }
  });
}

async function touchAdminUserLastLogin(username, lastLoginAtIso) {
  const u = String(username || '').trim();
  if (!u) return;
  return withClient(async (client) => {
    await client.query('UPDATE silva_users SET last_login_at = $1 WHERE LOWER(username) = LOWER($2)', [lastLoginAtIso, u]);
  });
}

async function loadLoaderAccounts() {
  return withClient(async (client) => {
    const r = await client.query('SELECT username, password_hash, hwid, skip_hwid_check, paused, last_login_at, expires_at, created_at FROM silva_loader_accounts ORDER BY created_at');
    return (r.rows || []).map((row) => ({
      username: row.username,
      passwordHash: normalizeStoredHash(row.password_hash),
      hwid: row.hwid || null,
      skipHwidCheck: !!(row.skip_hwid_check),
      paused: !!(row.paused),
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    }));
  });
}

async function saveLoaderAccounts(accounts) {
  return withClient(async (client) => {
    await client.query('DELETE FROM silva_loader_accounts');
    for (const a of accounts) {
      await client.query(
        'INSERT INTO silva_loader_accounts (username, password_hash, hwid, skip_hwid_check, paused, last_login_at, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [a.username, a.passwordHash, a.hwid || null, a.skipHwidCheck ? 1 : 0, a.paused ? 1 : 0, a.lastLoginAt || null, a.expiresAt || null, a.createdAt || new Date().toISOString()]
      );
    }
  });
}

async function loadRedeemKeys() {
  return withClient(async (client) => {
    const r = await client.query(
      'SELECT code, expires_in_seconds, created_at, used_at, used_by, created_by_reseller FROM silva_redeem_keys ORDER BY created_at'
    );
    return (r.rows || []).map((row) => ({
      code: row.code,
      expiresInSeconds: row.expires_in_seconds != null ? row.expires_in_seconds : 0,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      usedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
      usedBy: row.used_by || null,
      createdByReseller: row.created_by_reseller || null,
    }));
  });
}

async function saveRedeemKeys(keys) {
  return withClient(async (client) => {
    await client.query('DELETE FROM silva_redeem_keys');
    for (const k of keys) {
      await client.query(
        'INSERT INTO silva_redeem_keys (code, expires_in_seconds, created_at, used_at, used_by, created_by_reseller) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          k.code,
          k.expiresInSeconds != null ? k.expiresInSeconds : 0,
          k.createdAt || new Date().toISOString(),
          k.usedAt || null,
          k.usedBy || null,
          k.createdByReseller || null,
        ]
      );
    }
  });
}

async function loadActivityLog() {
  return withClient(async (client) => {
    const r = await client.query('SELECT id, title, detail, actor, created_at FROM silva_activity ORDER BY created_at DESC');
    return (r.rows || []).map((row) => ({
      id: row.id,
      title: row.title,
      detail: row.detail || '',
      actor: row.actor || '',
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    }));
  });
}

async function saveActivityLog(items) {
  return withClient(async (client) => {
    await client.query('DELETE FROM silva_activity');
    for (const item of (items || [])) {
      if (!item) continue;
      await client.query(
        'INSERT INTO silva_activity (id, title, detail, actor, created_at) VALUES ($1, $2, $3, $4, $5)',
        [item.id, item.title || 'Atividade', item.detail || '', item.actor || '', item.createdAt || new Date().toISOString()]
      );
    }
  });
}

async function loadPauseState() {
  return withClient(async (client) => {
    const res = await client.query('SELECT setting_value FROM silva_settings WHERE setting_key = $1', ['pause_state']);
    const raw = res.rows && res.rows[0] && res.rows[0].setting_value;
    if (!raw) return { paused: false, pausedAt: null, totalPausedMs: 0 };
    try {
      return JSON.parse(raw);
    } catch (_) {
      return { paused: false, pausedAt: null, totalPausedMs: 0 };
    }
  });
}

async function savePauseState(state) {
  return withClient(async (client) => {
    const value = JSON.stringify(state || { paused: false, pausedAt: null, totalPausedMs: 0 });
    await client.query(
      'INSERT INTO silva_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
      ['pause_state', value]
    );
  });
}

const DEFAULT_LOADER_PRODUCT_FLAGS = { '0': true, '1': true, '2': true };

async function loadLoaderProductFlags() {
  return withClient(async (client) => {
    const res = await client.query('SELECT setting_value FROM silva_settings WHERE setting_key = $1', ['loader_product_flags']);
    const raw = res.rows && res.rows[0] && res.rows[0].setting_value;
    if (!raw) return { ...DEFAULT_LOADER_PRODUCT_FLAGS };
    try {
      const parsed = JSON.parse(raw);
      const base = { ...DEFAULT_LOADER_PRODUCT_FLAGS };
      if (parsed && typeof parsed === 'object') {
        for (const k of ['0', '1', '2']) {
          if (typeof parsed[k] === 'boolean') base[k] = parsed[k];
          else if (parsed[k] === 0 || parsed[k] === 1) base[k] = !!parsed[k];
        }
      }
      return base;
    } catch (_) {
      return { ...DEFAULT_LOADER_PRODUCT_FLAGS };
    }
  });
}

async function saveLoaderProductFlags(flags) {
  const base = { ...DEFAULT_LOADER_PRODUCT_FLAGS };
  if (flags && typeof flags === 'object') {
    for (const k of ['0', '1', '2']) {
      if (typeof flags[k] === 'boolean') base[k] = flags[k];
      else if (flags[k] === 0 || flags[k] === 1) base[k] = !!flags[k];
    }
  }
  const value = JSON.stringify(base);
  return withClient(async (client) => {
    await client.query(
      'INSERT INTO silva_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
      ['loader_product_flags', value]
    );
  });
}

async function loadRedeemKeyPauses() {
  return withClient(async (client) => {
    const res = await client.query(
      'SELECT setting_key, setting_value FROM silva_settings WHERE setting_key LIKE $1',
      ['redeem_pause:%']
    );
    const map = {};
    for (const row of res.rows || []) {
      const key = row.setting_key ? String(row.setting_key) : '';
      if (!key.startsWith('redeem_pause:')) continue;
      const code = key.slice('redeem_pause:'.length);
      if (!code) continue;
      try {
        const parsed = JSON.parse(row.setting_value);
        if (parsed && typeof parsed === 'object') map[code] = parsed;
      } catch (_) {
        // ignore invalid JSON
      }
    }
    return map;
  });
}

async function saveRedeemKeyPause(code, state) {
  return withClient(async (client) => {
    const key = `redeem_pause:${code}`;
    const value = JSON.stringify(state || { paused: false, pausedAt: null });
    await client.query(
      'INSERT INTO silva_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
      [key, value]
    );
  });
}

async function deleteRedeemKeyPause(code) {
  return withClient(async (client) => {
    const key = `redeem_pause:${code}`;
    await client.query('DELETE FROM silva_settings WHERE setting_key = $1', [key]);
  });
}

async function getLibLinceVersion() {
  return withClient(async (client) => {
    const res = await client.query('SELECT setting_value FROM silva_settings WHERE setting_key = $1', ['liblince_version']);
    const raw = res.rows && res.rows[0] && res.rows[0].setting_value;
    return raw ? String(raw) : '';
  });
}

async function setLibLinceVersion(version) {
  const value = typeof version === 'string' ? version.trim() : '';
  return withClient(async (client) => {
    await client.query(
      'INSERT INTO silva_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
      ['liblince_version', value]
    );
  });
}

function dllSlotId(slot) {
  if (slot === 'matadorfx') return 2;
  if (slot === 'nextmenu') return 3;
  if (slot === 'fatalyplay') return 4;
  if (slot === 'freefireindia') return 5;
  if (slot === 'freefireplay') return 6;
  if (slot === 'liblince') return 7;
  return 1;
}
function dllDefaultFilename(id) {
  if (id === 2) return 'FATALY.dll';
  if (id === 3) return 'NEXTMENU.dll';
  if (id === 4) return 'FATALYPLAY.dll';
  if (id === 5) return 'LuaExecutor.dll';
  if (id === 6) return 'LuaExecutor.dll';
  if (id === 7) return 'liblincdev.so';
  return 'loader.dll';
}

function isValidSlotFilename(name, slot) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  if (slot === 'liblince') return /^[\w.\-]+\.so$/i.test(trimmed);
  return /^[\w.\-]+\.dll$/i.test(trimmed);
}

async function getDllMeta(slot) {
  const id = dllSlotId(slot);
  return withClient(async (client) => {
    const r = await client.query('SELECT filename FROM silva_dll_meta WHERE id=$1', [id]);
    const name = (r.rows[0] && r.rows[0].filename && String(r.rows[0].filename).trim()) || '';
    return isValidSlotFilename(name, slot) ? name : dllDefaultFilename(id);
  });
}

async function setDllMeta(filename, slot) {
  const id = dllSlotId(slot);
  const name = isValidSlotFilename(filename, slot) ? String(filename).trim() : dllDefaultFilename(id);
  return withClient(async (client) => {
    await client.query('UPDATE silva_dll_meta SET filename=$1 WHERE id=$2', [name, id]);
  });
}

async function getDllBuffer(slot) {
  const id = dllSlotId(slot);
  const blobUrl = await getDllBlobUrl(slot);
  if (blobUrl) {
    try {
      const res = await fetch(blobUrl);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (_) {
      return null;
    }
  }
  return withClient(async (client) => {
    const r = await client.query('SELECT content FROM silva_dll_content WHERE id=$1', [id]);
    const content = r.rows[0] && r.rows[0].content;
    if (!content) return null;
    return Buffer.isBuffer(content) ? content : Buffer.from(content);
  });
}

async function getDllBlobUrl(slot) {
  const id = dllSlotId(slot);
  return withClient(async (client) => {
    const r = await client.query('SELECT blob_url FROM silva_dll_meta WHERE id=$1', [id]);
    const url = r.rows[0] && r.rows[0].blob_url && String(r.rows[0].blob_url).trim();
    return url || null;
  });
}

async function setDllBlobUrl(url, slot) {
  const id = dllSlotId(slot);
  const u = url && String(url).trim();
  return withClient(async (client) => {
    await client.query('UPDATE silva_dll_meta SET blob_url=$1 WHERE id=$2', [u || null, id]);
  });
}

async function setDllBuffer(buf, slot) {
  const id = dllSlotId(slot);
  return withClient(async (client) => {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    await client.query('UPDATE silva_dll_content SET content=$1 WHERE id=$2', [b, id]);
    await client.query('UPDATE silva_dll_meta SET blob_url=NULL WHERE id=$1', [id]);
  });
}

async function dllExists(slot) {
  const b = await getDllBuffer(slot);
  return b != null && b.length > 0;
}

async function saveDllChunk(uploadId, index, buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return withClient(async (client) => {
    await client.query(
      'INSERT INTO silva_dll_chunks (upload_id, chunk_index, content, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (upload_id, chunk_index) DO UPDATE SET content=$3, created_at=NOW()',
      [uploadId, index, b]
    );
  });
}

async function getDllChunks(uploadId) {
  return withClient(async (client) => {
    const r = await client.query(
      'SELECT chunk_index, content FROM silva_dll_chunks WHERE upload_id=$1 ORDER BY chunk_index',
      [uploadId]
    );
    return (r.rows || []).map((row) => ({ index: row.chunk_index, content: row.content }));
  });
}

async function deleteDllChunks(uploadId) {
  return withClient(async (client) => {
    await client.query('DELETE FROM silva_dll_chunks WHERE upload_id=$1', [uploadId]);
  });
}

async function loadResellers() {
  return withClient(async (client) => {
    const r = await client.query(
      'SELECT username, password_hash, balance, created_at, bound_ip, avatar_url, secret_phrase_hash, recovery_email, password_reset_token_hash, password_reset_expires, secret_phrase_plain FROM silva_resellers ORDER BY created_at'
    );
    return (r.rows || []).map((row) => ({
      username: row.username,
      passwordHash: normalizeStoredHash(row.password_hash),
      balance: row.balance != null ? Math.round(Number(row.balance) * 100) / 100 : 0,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      boundIp: row.bound_ip || null,
      avatarUrl: row.avatar_url || undefined,
      secretPhraseHash: row.secret_phrase_hash ? normalizeStoredHash(row.secret_phrase_hash) : undefined,
      recoveryEmail: row.recovery_email || undefined,
      passwordResetTokenHash: row.password_reset_token_hash ? normalizeStoredHash(row.password_reset_token_hash) : undefined,
      passwordResetExpires: row.password_reset_expires ? new Date(row.password_reset_expires).toISOString() : undefined,
      secretPhrasePlain:
        row.secret_phrase_plain != null && String(row.secret_phrase_plain).trim() !== ''
          ? String(row.secret_phrase_plain).trim()
          : undefined,
    }));
  });
}

async function saveResellers(resellers) {
  return withClient(async (client) => {
    await client.query('DELETE FROM silva_resellers');
    for (const r of resellers || []) {
      if (!r || !r.username) continue;
      await client.query(
        'INSERT INTO silva_resellers (username, password_hash, balance, created_at, bound_ip, avatar_url, secret_phrase_hash, recovery_email, password_reset_token_hash, password_reset_expires, secret_phrase_plain) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        [
          r.username,
          r.passwordHash,
          r.balance != null ? Math.round(Number(r.balance) * 100) / 100 : 0,
          r.createdAt || new Date().toISOString(),
          r.boundIp || null,
          r.avatarUrl || null,
          r.secretPhraseHash || null,
          r.recoveryEmail || null,
          r.passwordResetTokenHash || null,
          r.passwordResetExpires || null,
          r.secretPhrasePlain || null,
        ]
      );
    }
  });
}

async function loadMpCreditedIds() {
  return withClient(async (client) => {
    const r = await client.query('SELECT payment_id FROM silva_mp_credited');
    return (r.rows || []).map((row) => String(row.payment_id));
  });
}

async function saveMpCreditedIds(ids) {
  return withClient(async (client) => {
    await client.query('DELETE FROM silva_mp_credited');
    for (const id of Array.from(new Set((ids || []).map(String)))) {
      if (id) await client.query('INSERT INTO silva_mp_credited (payment_id) VALUES ($1)', [id]);
    }
  });
}

async function appendMpCreditedId(paymentId) {
  return withClient(async (client) => {
    const id = String(paymentId || '').trim();
    if (!id) return false;
    const r = await client.query('INSERT INTO silva_mp_credited (payment_id) VALUES ($1) ON CONFLICT (payment_id) DO NOTHING', [id]);
    return (r.rowCount || 0) > 0;
  });
}

const MP_PANEL_KEY = 'mercadopago_panel';

function normalizeMercadoPagoPanel(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    accessToken: typeof o.accessToken === 'string' ? o.accessToken : '',
    payerEmail: typeof o.payerEmail === 'string' ? o.payerEmail : '',
  };
}

async function loadMercadoPagoPanelSettings() {
  return withClient(async (client) => {
    const res = await client.query('SELECT setting_value FROM silva_settings WHERE setting_key = $1', [MP_PANEL_KEY]);
    const raw = res.rows && res.rows[0] && res.rows[0].setting_value;
    if (!raw) return { accessToken: '', payerEmail: '' };
    try {
      return normalizeMercadoPagoPanel(JSON.parse(String(raw)));
    } catch (_) {
      return { accessToken: '', payerEmail: '' };
    }
  });
}

async function saveMercadoPagoPanelSettings(data) {
  const payload = normalizeMercadoPagoPanel(data);
  return withClient(async (client) => {
    await client.query(
      'INSERT INTO silva_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
      [MP_PANEL_KEY, JSON.stringify(payload)]
    );
  });
}

const DISCORD_PANEL_KEY = 'discord_panel';

function normalizeDiscordPanel(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    keyGenerated: typeof o.keyGenerated === 'string' ? o.keyGenerated : '',
    keyDeleted: typeof o.keyDeleted === 'string' ? o.keyDeleted : '',
    resellerPayment: typeof o.resellerPayment === 'string' ? o.resellerPayment : '',
    fallback: typeof o.fallback === 'string' ? o.fallback : '',
  };
}

async function loadDiscordPanelSettings() {
  return withClient(async (client) => {
    const res = await client.query('SELECT setting_value FROM silva_settings WHERE setting_key = $1', [DISCORD_PANEL_KEY]);
    const raw = res.rows && res.rows[0] && res.rows[0].setting_value;
    if (!raw) return { keyGenerated: '', keyDeleted: '', resellerPayment: '', fallback: '' };
    try {
      return normalizeDiscordPanel(JSON.parse(String(raw)));
    } catch (_) {
      return { keyGenerated: '', keyDeleted: '', resellerPayment: '', fallback: '' };
    }
  });
}

async function saveDiscordPanelSettings(data) {
  const payload = normalizeDiscordPanel(data);
  return withClient(async (client) => {
    await client.query(
      'INSERT INTO silva_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
      [DISCORD_PANEL_KEY, JSON.stringify(payload)]
    );
  });
}

module.exports = {
  pingDb,
  touchAdminUserLastLogin,
  loadKeysData,
  saveKeysData,
  loadUsers,
  saveUsers,
  loadLoaderAccounts,
  saveLoaderAccounts,
  loadRedeemKeys,
  saveRedeemKeys,
  loadActivityLog,
  saveActivityLog,
  loadPauseState,
  savePauseState,
  loadLoaderProductFlags,
  saveLoaderProductFlags,
  loadRedeemKeyPauses,
  saveRedeemKeyPause,
  deleteRedeemKeyPause,
  getLibLinceVersion,
  setLibLinceVersion,
  getDllMeta,
  setDllMeta,
  getDllBuffer,
  setDllBuffer,
  getDllBlobUrl,
  setDllBlobUrl,
  saveDllChunk,
  getDllChunks,
  deleteDllChunks,
  dllExists,
  loadResellers,
  saveResellers,
  loadMpCreditedIds,
  saveMpCreditedIds,
  appendMpCreditedId,
  loadMercadoPagoPanelSettings,
  saveMercadoPagoPanelSettings,
  loadDiscordPanelSettings,
  saveDiscordPanelSettings,
};
