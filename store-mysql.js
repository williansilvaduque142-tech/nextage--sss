/**
 * Persistência em MySQL (igual ao public_html: conexão com host/user/senha/banco).
 * Use MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE no .env
 * ou MYSQL_URI / DATABASE_URL no formato mysql://user:senha@host:3306/banco
 *
 * Hostinger / phpMyAdmin: o MySQL fica NO SERVIDOR. Se o Node corre no seu PC ou noutro VPS,
 * não use MYSQL_HOST=localhost — use o hostname MySQL que o painel mostra (ex.: mysqlNNN.hostinger.io)
 * e em "Acesso remoto MySQL" autorize o IP da máquina onde corre o Node.
 * Opcional: MYSQL_SSL=1 (muitos hosts na cloud exigem SSL).
 */
require('dotenv').config();
const { normalizeStoredHash } = require('./hashNormalize');
const mysql = require('mysql2/promise');

let pool = null;

function mysqlSslOption() {
  const v = String(process.env.MYSQL_SSL || '').trim().toLowerCase();
  if (!v || v === '0' || v === 'false' || v === 'no') return undefined;
  if (process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === '0') {
    return { rejectUnauthorized: false };
  }
  return {};
}

/** Converte mysql://... em opções (útil para aplicar SSL com URI). */
function parseMysqlUrl(urlStr) {
  const s = String(urlStr || '').trim();
  const normalized = s.startsWith('mysql://') ? s.replace(/^mysql:\/\//, 'http://') : `http://${s}`;
  const u = new URL(normalized);
  const path = (u.pathname || '').replace(/^\//, '') || '';
  const database = path.split('?')[0] || undefined;
  return {
    host: u.hostname || 'localhost',
    port: u.port ? parseInt(u.port, 10) : 3306,
    user: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
    database,
  };
}

function buildPoolConfigFromEnv() {
  const host = process.env.MYSQL_HOST || 'localhost';
  const port = parseInt(String(process.env.MYSQL_PORT || '3306'), 10) || 3306;
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD != null ? process.env.MYSQL_PASSWORD : '';
  const database = process.env.MYSQL_DATABASE;
  const socketPath = process.env.MYSQL_SOCKET && String(process.env.MYSQL_SOCKET).trim();
  const connectTimeout = Math.min(
    120000,
    Math.max(3000, parseInt(String(process.env.MYSQL_CONNECT_TIMEOUT_MS || '20000'), 10) || 20000)
  );
  if (!user || !database) throw new Error('Defina MYSQL_USER e MYSQL_DATABASE (ou MYSQL_URI)');
  const cfg = {
    host: socketPath ? undefined : host,
    port: socketPath ? undefined : port,
    socketPath: socketPath || undefined,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 2,
    connectTimeout,
    enableKeepAlive: true,
  };
  const ssl = mysqlSslOption();
  if (ssl) cfg.ssl = ssl;
  return cfg;
}

function getPool() {
  if (!pool) {
    const uri = process.env.MYSQL_URI || process.env.DATABASE_URL;
    const connectTimeout = Math.min(
      120000,
      Math.max(3000, parseInt(String(process.env.MYSQL_CONNECT_TIMEOUT_MS || '20000'), 10) || 20000)
    );
    if (uri && String(uri).startsWith('mysql')) {
      const ssl = mysqlSslOption();
      const p = parseMysqlUrl(String(uri));
      pool = mysql.createPool({
        ...p,
        waitForConnections: true,
        connectionLimit: 2,
        connectTimeout,
        enableKeepAlive: true,
        ...(ssl ? { ssl } : {}),
      });
    } else {
      pool = mysql.createPool(buildPoolConfigFromEnv());
    }
  }
  return pool;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS silva_keys (
    id VARCHAR(255) PRIMARY KEY,
    usuario VARCHAR(255) NOT NULL,
    added_at DATETIME NOT NULL,
    expires_in_seconds INT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS silva_users (
    username VARCHAR(255) PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    last_login_at DATETIME NULL,
    bound_ip VARCHAR(64) NULL,
    secret_phrase_hash VARCHAR(64) NULL,
    role VARCHAR(32) NULL DEFAULT 'staff'
  )`,
  `CREATE TABLE IF NOT EXISTS silva_loader_accounts (
    username VARCHAR(255) PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    hwid VARCHAR(512) NULL,
    skip_hwid_check TINYINT NOT NULL DEFAULT 0,
    paused TINYINT NOT NULL DEFAULT 0,
    last_login_at DATETIME NULL,
    expires_at DATETIME NULL,
    created_at DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS silva_redeem_keys (
    code VARCHAR(255) PRIMARY KEY,
    expires_in_seconds INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    used_by VARCHAR(255) NULL,
    created_by_reseller VARCHAR(255) NULL,
    paused TINYINT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS silva_settings (
    setting_key VARCHAR(64) PRIMARY KEY,
    setting_value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS silva_activity (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    detail TEXT NULL,
    actor VARCHAR(255) NULL,
    created_at DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS silva_dll_meta (
    id INT PRIMARY KEY DEFAULT 1,
    filename VARCHAR(255) NOT NULL DEFAULT 'loader.dll'
  )`,
  `CREATE TABLE IF NOT EXISTS silva_dll_content (
    id INT PRIMARY KEY DEFAULT 1,
    content LONGBLOB NULL
  )`,
  `INSERT IGNORE INTO silva_dll_meta (id, filename) VALUES (1, 'loader.dll')`,
  `INSERT IGNORE INTO silva_dll_content (id, content) VALUES (1, NULL)`,
  `INSERT IGNORE INTO silva_dll_meta (id, filename) VALUES (2, 'FATALY.dll')`,
  `INSERT IGNORE INTO silva_dll_content (id, content) VALUES (2, NULL)`,
  `INSERT IGNORE INTO silva_dll_meta (id, filename) VALUES (3, 'NEXTMENU.dll')`,
  `INSERT IGNORE INTO silva_dll_content (id, content) VALUES (3, NULL)`,
  `INSERT IGNORE INTO silva_dll_meta (id, filename) VALUES (4, 'FATALYPLAY.dll')`,
  `INSERT IGNORE INTO silva_dll_content (id, content) VALUES (4, NULL)`,
  `INSERT IGNORE INTO silva_dll_meta (id, filename) VALUES (5, 'LuaExecutor.dll')`,
  `INSERT IGNORE INTO silva_dll_content (id, content) VALUES (5, NULL)`,
  `INSERT IGNORE INTO silva_dll_meta (id, filename) VALUES (6, 'LuaExecutor.dll')`,
  `INSERT IGNORE INTO silva_dll_content (id, content) VALUES (6, NULL)`,
  `INSERT IGNORE INTO silva_dll_meta (id, filename) VALUES (7, 'liblincdev.so')`,
  `INSERT IGNORE INTO silva_dll_content (id, content) VALUES (7, NULL)`,
  `CREATE TABLE IF NOT EXISTS silva_resellers (
    username VARCHAR(255) PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    bound_ip VARCHAR(64) NULL,
    avatar_url MEDIUMTEXT NULL,
    secret_phrase_hash VARCHAR(64) NULL,
    recovery_email VARCHAR(255) NULL,
    password_reset_token_hash VARCHAR(64) NULL,
    password_reset_expires DATETIME NULL,
    secret_phrase_plain VARCHAR(200) NULL
  )`,
  `CREATE TABLE IF NOT EXISTS silva_mp_credited (
    payment_id VARCHAR(64) PRIMARY KEY
  )`,
];

/** Evita falha em requisições paralelas quando duas migrações tentam ADD COLUMN ao mesmo tempo. */
async function runAlterIgnoreDup(conn, sql) {
  try {
    await conn.query(sql);
  } catch (e) {
    const errno = e && (e.errno != null ? e.errno : e.code);
    if (errno === 1060 || errno === 'ER_DUP_FIELDNAME') return;
    throw e;
  }
}

let migrated = false;
async function ensureRedeemCreatedByResellerColumn(conn) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_redeem_keys' AND COLUMN_NAME = 'created_by_reseller'"
  );
  if (!rows || rows.length === 0) {
    await runAlterIgnoreDup(conn, 'ALTER TABLE silva_redeem_keys ADD COLUMN created_by_reseller VARCHAR(255) NULL');
  }
}

async function ensureUserBoundIpColumn(conn) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_users' AND COLUMN_NAME = 'bound_ip'"
  );
  if (!rows || rows.length === 0) {
    await runAlterIgnoreDup(conn, 'ALTER TABLE silva_users ADD COLUMN bound_ip VARCHAR(64) NULL');
  }
}

async function ensureResellerBoundIpColumn(conn) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'bound_ip'"
  );
  if (!rows || rows.length === 0) {
    await runAlterIgnoreDup(conn, 'ALTER TABLE silva_resellers ADD COLUMN bound_ip VARCHAR(64) NULL');
  }
}

async function ensureResellerAvatarUrlColumn(conn) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'avatar_url'"
  );
  if (!rows || rows.length === 0) {
    await runAlterIgnoreDup(conn, 'ALTER TABLE silva_resellers ADD COLUMN avatar_url MEDIUMTEXT NULL');
  }
}

async function ensureUserSecretPhraseColumn(conn) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_users' AND COLUMN_NAME = 'secret_phrase_hash'"
  );
  if (!rows || rows.length === 0) {
    await runAlterIgnoreDup(conn, 'ALTER TABLE silva_users ADD COLUMN secret_phrase_hash VARCHAR(64) NULL');
  }
}

async function ensureUserRoleColumn(conn) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_users' AND COLUMN_NAME = 'role'"
  );
  if (!rows || rows.length === 0) {
    await runAlterIgnoreDup(conn, "ALTER TABLE silva_users ADD COLUMN role VARCHAR(32) NULL DEFAULT 'staff'");
  }
}

async function ensureResellerSecretPhraseColumn(conn) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'secret_phrase_hash'"
  );
  if (!rows || rows.length === 0) {
    await runAlterIgnoreDup(conn, 'ALTER TABLE silva_resellers ADD COLUMN secret_phrase_hash VARCHAR(64) NULL');
  }
}

async function ensureResellerRecoveryEmailColumn(conn) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'recovery_email'"
  );
  if (!rows || rows.length === 0) {
    await runAlterIgnoreDup(conn, 'ALTER TABLE silva_resellers ADD COLUMN recovery_email VARCHAR(255) NULL');
  }
}

async function ensureResellerPasswordResetColumns(conn) {
  const [r1] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'password_reset_token_hash'"
  );
  if (!r1 || r1.length === 0) {
    await runAlterIgnoreDup(conn, 'ALTER TABLE silva_resellers ADD COLUMN password_reset_token_hash VARCHAR(64) NULL');
  }
  const [r2] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'password_reset_expires'"
  );
  if (!r2 || r2.length === 0) {
    await runAlterIgnoreDup(conn, 'ALTER TABLE silva_resellers ADD COLUMN password_reset_expires DATETIME NULL');
  }
}

async function ensureResellerSecretPhrasePlainColumn(conn) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_resellers' AND COLUMN_NAME = 'secret_phrase_plain'"
  );
  if (!rows || rows.length === 0) {
    await runAlterIgnoreDup(conn, 'ALTER TABLE silva_resellers ADD COLUMN secret_phrase_plain VARCHAR(200) NULL');
  }
}

async function ensureMigration(conn) {
  if (migrated) return;
  for (const q of MIGRATIONS) await conn.query(q);
  await ensureLoaderAccountPausedColumn(conn);
  await ensureUserLastLoginColumn(conn);
  await ensureUserBoundIpColumn(conn);
  await ensureLoaderAccountLastLoginColumn(conn);
  await ensureRedeemCreatedByResellerColumn(conn);
  await ensureResellerBoundIpColumn(conn);
  await ensureResellerAvatarUrlColumn(conn);
  await ensureUserSecretPhraseColumn(conn);
  await ensureUserRoleColumn(conn);
  await ensureResellerSecretPhraseColumn(conn);
  await ensureResellerRecoveryEmailColumn(conn);
  await ensureResellerPasswordResetColumns(conn);
  await ensureResellerSecretPhrasePlainColumn(conn);
  migrated = true;
}

async function ensureLoaderAccountPausedColumn(conn) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_loader_accounts' AND COLUMN_NAME = 'paused'"
  );
  if (!rows || rows.length === 0) {
    await runAlterIgnoreDup(conn, "ALTER TABLE silva_loader_accounts ADD COLUMN paused TINYINT NOT NULL DEFAULT 0");
  }
}

async function ensureUserLastLoginColumn(conn) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_users' AND COLUMN_NAME = 'last_login_at'"
  );
  if (!rows || rows.length === 0) {
    await runAlterIgnoreDup(conn, "ALTER TABLE silva_users ADD COLUMN last_login_at DATETIME NULL");
  }
}

async function ensureLoaderAccountLastLoginColumn(conn) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'silva_loader_accounts' AND COLUMN_NAME = 'last_login_at'"
  );
  if (!rows || rows.length === 0) {
    await runAlterIgnoreDup(conn, "ALTER TABLE silva_loader_accounts ADD COLUMN last_login_at DATETIME NULL");
  }
}

async function withConn(fn) {
  const p = getPool();
  const conn = await p.getConnection();
  try {
    await ensureMigration(conn);
    return await fn(conn);
  } finally {
    conn.release();
  }
}

/** Verifica se o MySQL responde (usado em GET /api/storage). */
async function pingDb() {
  return withConn(async (conn) => {
    await conn.query('SELECT 1 AS ok');
  });
}

async function loadKeysData() {
  return withConn(async (conn) => {
    const [rows] = await conn.query('SELECT id, usuario, added_at, expires_in_seconds FROM silva_keys ORDER BY added_at');
    const keys = (rows || []).map((row) => ({
      id: row.id,
      usuario: row.usuario || row.id,
      addedAt: row.added_at ? new Date(row.added_at).toISOString() : new Date().toISOString(),
      expiresInSeconds: row.expires_in_seconds != null ? row.expires_in_seconds : 0,
    }));
    return { keys };
  });
}

async function saveKeysData(data) {
  return withConn(async (conn) => {
    await conn.query('DELETE FROM silva_keys');
    const keys = data.keys || [];
    for (const k of keys) {
      const sec = k.expiresInSeconds != null ? k.expiresInSeconds : (k.expiresInDays || 0) * 86400;
      await conn.query(
        'INSERT INTO silva_keys (id, usuario, added_at, expires_in_seconds) VALUES (?, ?, ?, ?)',
        [k.id, k.usuario || k.id, k.addedAt || new Date().toISOString(), sec]
      );
    }
  });
}

async function loadUsers() {
  return withConn(async (conn) => {
    const [rows] = await conn.query(
      'SELECT username, password_hash, last_login_at, bound_ip, secret_phrase_hash, role FROM silva_users'
    );
    return (rows || []).map((row) => ({
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
  const list = Array.isArray(users) ? users : [];
  return withConn(async (conn) => {
    await conn.beginTransaction();
    try {
      const want = new Set(list.map((u) => String(u && u.username != null ? u.username : '').trim()).filter(Boolean));
      const [existing] = await conn.query('SELECT username FROM silva_users');
      for (const row of existing || []) {
        const un = String(row.username || '');
        if (!want.has(un)) {
          await conn.query('DELETE FROM silva_users WHERE username = ?', [un]);
        }
      }
      for (const u of list) {
        const un = String(u.username || '').trim();
        if (!un) continue;
        await conn.query(
          `INSERT INTO silva_users (username, password_hash, last_login_at, bound_ip, secret_phrase_hash, role) VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             password_hash = VALUES(password_hash),
             last_login_at = VALUES(last_login_at),
             bound_ip = VALUES(bound_ip),
             secret_phrase_hash = VALUES(secret_phrase_hash),
             role = VALUES(role)`,
          [un, u.passwordHash, u.lastLoginAt || null, u.boundIp || null, u.secretPhraseHash || null, u.role || 'staff']
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  });
}

/** Atualiza só last_login_at — evita DELETE+INSERT de toda a tabela no login. */
async function touchAdminUserLastLogin(username, lastLoginAtIso) {
  const u = String(username || '').trim();
  if (!u) return;
  return withConn(async (conn) => {
    await conn.query('UPDATE silva_users SET last_login_at = ? WHERE LOWER(username) = LOWER(?)', [lastLoginAtIso, u]);
  });
}

async function loadLoaderAccounts() {
  return withConn(async (conn) => {
    const [rows] = await conn.query('SELECT username, password_hash, hwid, skip_hwid_check, paused, last_login_at, expires_at, created_at FROM silva_loader_accounts ORDER BY created_at');
    return (rows || []).map((row) => ({
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
  return withConn(async (conn) => {
    await conn.query('DELETE FROM silva_loader_accounts');
    for (const a of accounts) {
      await conn.query(
        'INSERT INTO silva_loader_accounts (username, password_hash, hwid, skip_hwid_check, paused, last_login_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [a.username, a.passwordHash, a.hwid || null, a.skipHwidCheck ? 1 : 0, a.paused ? 1 : 0, a.lastLoginAt || null, a.expiresAt || null, a.createdAt || new Date().toISOString()]
      );
    }
  });
}

async function loadRedeemKeys() {
  return withConn(async (conn) => {
    const [rows] = await conn.query(
      'SELECT code, expires_in_seconds, created_at, used_at, used_by, created_by_reseller FROM silva_redeem_keys ORDER BY created_at'
    );
    return (rows || []).map((row) => ({
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
  return withConn(async (conn) => {
    await conn.query('DELETE FROM silva_redeem_keys');
    for (const k of keys) {
      await conn.query(
        'INSERT INTO silva_redeem_keys (code, expires_in_seconds, created_at, used_at, used_by, created_by_reseller) VALUES (?, ?, ?, ?, ?, ?)',
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
  return withConn(async (conn) => {
    const [rows] = await conn.query('SELECT id, title, detail, actor, created_at FROM silva_activity ORDER BY created_at DESC');
    return (rows || []).map((row) => ({
      id: row.id,
      title: row.title,
      detail: row.detail || '',
      actor: row.actor || '',
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    }));
  });
}

async function saveActivityLog(items) {
  return withConn(async (conn) => {
    await conn.query('DELETE FROM silva_activity');
    for (const item of (items || [])) {
      if (!item) continue;
      await conn.query(
        'INSERT INTO silva_activity (id, title, detail, actor, created_at) VALUES (?, ?, ?, ?, ?)',
        [item.id, item.title || 'Atividade', item.detail || '', item.actor || '', item.createdAt || new Date().toISOString()]
      );
    }
  });
}

async function loadPauseState() {
  return withConn(async (conn) => {
    const [rows] = await conn.query('SELECT setting_value FROM silva_settings WHERE setting_key = ?', ['pause_state']);
    if (!rows || !rows[0] || !rows[0].setting_value) return { paused: false, pausedAt: null, totalPausedMs: 0 };
    try {
      return JSON.parse(rows[0].setting_value);
    } catch (_) {
      return { paused: false, pausedAt: null, totalPausedMs: 0 };
    }
  });
}

async function savePauseState(state) {
  return withConn(async (conn) => {
    const value = JSON.stringify(state || { paused: false, pausedAt: null, totalPausedMs: 0 });
    await conn.query(
      'INSERT INTO silva_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      ['pause_state', value]
    );
  });
}

const DEFAULT_LOADER_PRODUCT_FLAGS = { '0': true, '1': true, '2': true };

async function loadLoaderProductFlags() {
  return withConn(async (conn) => {
    const [rows] = await conn.query('SELECT setting_value FROM silva_settings WHERE setting_key = ?', ['loader_product_flags']);
    if (!rows || !rows[0] || !rows[0].setting_value) return { ...DEFAULT_LOADER_PRODUCT_FLAGS };
    try {
      const parsed = JSON.parse(rows[0].setting_value);
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
  return withConn(async (conn) => {
    await conn.query(
      'INSERT INTO silva_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      ['loader_product_flags', value]
    );
  });
}

async function loadRedeemKeyPauses() {
  return withConn(async (conn) => {
    const [rows] = await conn.query(
      'SELECT setting_key, setting_value FROM silva_settings WHERE setting_key LIKE ?',
      ['redeem_pause:%']
    );
    const map = {};
    for (const row of rows || []) {
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
  return withConn(async (conn) => {
    const key = `redeem_pause:${code}`;
    const value = JSON.stringify(state || { paused: false, pausedAt: null });
    await conn.query(
      'INSERT INTO silva_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      [key, value]
    );
  });
}

async function deleteRedeemKeyPause(code) {
  return withConn(async (conn) => {
    const key = `redeem_pause:${code}`;
    await conn.query('DELETE FROM silva_settings WHERE setting_key = ?', [key]);
  });
}

async function getLibLinceVersion() {
  return withConn(async (conn) => {
    const [rows] = await conn.query('SELECT setting_value FROM silva_settings WHERE setting_key = ?', ['liblince_version']);
    const raw = rows && rows[0] && rows[0].setting_value;
    return raw ? String(raw) : '';
  });
}

async function setLibLinceVersion(version) {
  const value = typeof version === 'string' ? version.trim() : '';
  return withConn(async (conn) => {
    await conn.query(
      'INSERT INTO silva_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
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
  return withConn(async (conn) => {
    const [rows] = await conn.query('SELECT filename FROM silva_dll_meta WHERE id = ?', [id]);
    const name = (rows[0] && rows[0].filename && String(rows[0].filename).trim()) || '';
    return isValidSlotFilename(name, slot) ? name : dllDefaultFilename(id);
  });
}

async function setDllMeta(filename, slot) {
  const id = dllSlotId(slot);
  const name = isValidSlotFilename(filename, slot) ? String(filename).trim() : dllDefaultFilename(id);
  return withConn(async (conn) => {
    await conn.query('UPDATE silva_dll_meta SET filename = ? WHERE id = ?', [name, id]);
  });
}

async function getDllBuffer(slot) {
  const id = dllSlotId(slot);
  return withConn(async (conn) => {
    const [rows] = await conn.query('SELECT content FROM silva_dll_content WHERE id = ?', [id]);
    const content = rows[0] && rows[0].content;
    if (!content) return null;
    return Buffer.isBuffer(content) ? content : Buffer.from(content);
  });
}

async function setDllBuffer(buf, slot) {
  const id = dllSlotId(slot);
  return withConn(async (conn) => {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    await conn.query('UPDATE silva_dll_content SET content = ? WHERE id = ?', [b, id]);
  });
}

async function dllExists(slot) {
  const b = await getDllBuffer(slot);
  return b != null && b.length > 0;
}

async function loadResellers() {
  return withConn(async (conn) => {
    const [rows] = await conn.query(
      'SELECT username, password_hash, balance, created_at, bound_ip, avatar_url, secret_phrase_hash, recovery_email, password_reset_token_hash, password_reset_expires, secret_phrase_plain FROM silva_resellers ORDER BY created_at'
    );
    return (rows || []).map((row) => ({
      username: row.username,
      passwordHash: normalizeStoredHash(row.password_hash),
      balance: row.balance != null ? Math.round(Number(row.balance) * 100) / 100 : 0,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      boundIp: row.bound_ip || null,
      avatarUrl: row.avatar_url || undefined,
      secretPhraseHash: row.secret_phrase_hash ? normalizeStoredHash(row.secret_phrase_hash) : undefined,
      recoveryEmail: row.recovery_email || undefined,
      passwordResetTokenHash: row.password_reset_token_hash || undefined,
      passwordResetExpires: row.password_reset_expires ? new Date(row.password_reset_expires).toISOString() : undefined,
      secretPhrasePlain:
        row.secret_phrase_plain != null && String(row.secret_phrase_plain).trim() !== ''
          ? String(row.secret_phrase_plain).trim()
          : undefined,
    }));
  });
}

async function saveResellers(resellers) {
  return withConn(async (conn) => {
    await conn.query('DELETE FROM silva_resellers');
    for (const r of resellers || []) {
      if (!r || !r.username) continue;
      await conn.query(
        'INSERT INTO silva_resellers (username, password_hash, balance, created_at, bound_ip, avatar_url, secret_phrase_hash, recovery_email, password_reset_token_hash, password_reset_expires, secret_phrase_plain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
  return withConn(async (conn) => {
    const [rows] = await conn.query('SELECT payment_id FROM silva_mp_credited');
    return (rows || []).map((row) => String(row.payment_id));
  });
}

async function saveMpCreditedIds(ids) {
  return withConn(async (conn) => {
    await conn.query('DELETE FROM silva_mp_credited');
    for (const id of Array.from(new Set((ids || []).map(String)))) {
      if (id) await conn.query('INSERT INTO silva_mp_credited (payment_id) VALUES (?)', [id]);
    }
  });
}

async function appendMpCreditedId(paymentId) {
  return withConn(async (conn) => {
    const id = String(paymentId || '').trim();
    if (!id) return false;
    const [result] = await conn.query('INSERT IGNORE INTO silva_mp_credited (payment_id) VALUES (?)', [id]);
    return result && result.affectedRows > 0;
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
  return withConn(async (conn) => {
    const [rows] = await conn.query('SELECT setting_value FROM silva_settings WHERE setting_key = ?', [MP_PANEL_KEY]);
    const raw = rows && rows[0] && rows[0].setting_value;
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
  return withConn(async (conn) => {
    await conn.query(
      'INSERT INTO silva_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
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
  return withConn(async (conn) => {
    const [rows] = await conn.query('SELECT setting_value FROM silva_settings WHERE setting_key = ?', [DISCORD_PANEL_KEY]);
    const raw = rows && rows[0] && rows[0].setting_value;
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
  return withConn(async (conn) => {
    await conn.query(
      'INSERT INTO silva_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
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
