/**
 * Camada de armazenamento: MySQL > Postgres > SQLite (dentro do projeto) > Blob > memória > filesystem.
 * SQLite: banco em um único arquivo (data/silva.db), sem serviço externo — tudo dentro do projeto.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

const hasMysqlUri = process.env.MYSQL_URI && String(process.env.MYSQL_URI).startsWith('mysql');
const hasMysqlEnv = !!(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);
const hasMysqlInDatabaseUrl = process.env.DATABASE_URL && String(process.env.DATABASE_URL).startsWith('mysql');
const USE_MYSQL = !!(hasMysqlUri || hasMysqlEnv || hasMysqlInDatabaseUrl);

const hasPostgresUrl = (process.env.DATABASE_URL && !String(process.env.DATABASE_URL).startsWith('mysql')) || process.env.POSTGRES_URL;
const hasPostgresVars = !!(process.env.PGHOST && process.env.PGUSER && process.env.PGDATABASE && (process.env.PGPASSWORD || (process.env.VERCEL && process.env.AWS_ROLE_ARN)));
/** Se MySQL estiver configurado, ignora Postgres (evita conflito quando DATABASE_URL antiga ainda aponta para Postgres). */
const USE_SQL = !USE_MYSQL && !!(hasPostgresUrl || hasPostgresVars);

const USE_SQLITE = !USE_MYSQL && !USE_SQL;

let mysqlStore = null;
let sqlStore = null;
let sqliteStore = null;
function getMysqlStore() {
  if (!USE_MYSQL) return null;
  if (!mysqlStore) mysqlStore = require('./store-mysql.js');
  return mysqlStore;
}
function getSqlStore() {
  if (!USE_SQL) return null;
  if (!sqlStore) sqlStore = require('./store-sql.js');
  return sqlStore;
}
function getSqliteStore() {
  if (!USE_SQLITE) return null;
  if (!sqliteStore) sqliteStore = require('./store-sqlite.js');
  return sqliteStore;
}

// Na Vercel o disco é só leitura. Só usar memória quando NÃO tiver MySQL/Postgres/Blob (evita dados “que mudam sozinhos”).
const USE_BLOB = !!(process.env.VERCEL && process.env.BLOB_READ_WRITE_TOKEN);
const USE_MEMORY = !!(process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN && !USE_SQL && !USE_MYSQL && !USE_SQLITE);
const BLOB_TIMEOUT_MS = 20000; // 20s para não travar

/** Flags Lua Executor no injector: 0=Play/v7a, 1=India, 2=x86/slot principal */
const DEFAULT_LOADER_PRODUCT_FLAGS = { '0': true, '1': true, '2': true };

function normalizeLoaderProductFlags(data) {
  const base = { ...DEFAULT_LOADER_PRODUCT_FLAGS };
  if (!data || typeof data !== 'object') return base;
  for (const k of ['0', '1', '2']) {
    if (typeof data[k] === 'boolean') base[k] = data[k];
    else if (data[k] === 0 || data[k] === 1) base[k] = !!data[k];
  }
  return base;
}

// Armazenamento em memória quando está na Vercel sem Blob (evita EROFS)
const memory = {
  keys: { keys: [] },
  redeem_keys: { keys: [] },
  pause_state: { paused: false, pausedAt: null, totalPausedMs: 0 },
  users: { users: [] },
  loader_accounts: [],
  dll_meta: { filename: 'loader.dll' },
  dll: null,
  dll_meta_matadorfx: { filename: 'FATALY.dll' },
  dll_matadorfx: null,
  dll_meta_nextmenu: { filename: 'NEXTMENU.dll' },
  dll_nextmenu: null,
  dll_meta_fatalyplay: { filename: 'FATALYPLAY.dll' },
  dll_fatalyplay: null,
  dll_meta_freefireindia: { filename: 'LuaExecutor.dll' },
  dll_freefireindia: null,
  dll_meta_freefireplay: { filename: 'LuaExecutor.dll' },
  dll_freefireplay: null,
  dll_meta_liblince: { filename: 'liblincdev.so' },
  dll_liblince: null,
  liblince_version: '',
  activity: [],
  loader_product_flags: { ...DEFAULT_LOADER_PRODUCT_FLAGS },
  resellers: [],
  mp_credited_ids: [],
  mercadopago_panel: { accessToken: '', payerEmail: '' },
  discord_panel: { keyGenerated: '', keyDeleted: '', resellerPayment: '', fallback: '' },
};

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Blob: tempo esgotado')), ms)),
  ]);
}

const ROOT = path.join(__dirname, 'data');
const FILES = {
  keys: path.join(ROOT, 'keys.json'),
  redeem_keys: path.join(ROOT, 'redeem_keys.json'),
  pause_state: path.join(ROOT, 'pause_state.json'),
  users: path.join(ROOT, 'users.json'),
  loader_accounts: path.join(ROOT, 'loader_accounts.json'),
  activity: path.join(ROOT, 'activity.json'),
  loader_product_flags: path.join(ROOT, 'loader_product_flags.json'),
  dll_meta: path.join(ROOT, 'dll_meta.json'),
  dll: path.join(ROOT, 'loader.dll'),
  dll_meta_matadorfx: path.join(ROOT, 'dll_meta_matadorfx.json'),
  dll_matadorfx: path.join(ROOT, 'matadorfx.dll'),
  dll_meta_nextmenu: path.join(ROOT, 'dll_meta_nextmenu.json'),
  dll_nextmenu: path.join(ROOT, 'nextmenu.dll'),
  dll_meta_fatalyplay: path.join(ROOT, 'dll_meta_fatalyplay.json'),
  dll_fatalyplay: path.join(ROOT, 'fatalyplay.dll'),
  dll_meta_freefireindia: path.join(ROOT, 'dll_meta_freefireindia.json'),
  dll_freefireindia: path.join(ROOT, 'freefireindia.dll'),
  dll_meta_freefireplay: path.join(ROOT, 'dll_meta_freefireplay.json'),
  dll_freefireplay: path.join(ROOT, 'freefireplay.dll'),
  dll_meta_liblince: path.join(ROOT, 'dll_meta_liblince.json'),
  dll_liblince: path.join(ROOT, 'liblincdev.so'),
  liblince_version: path.join(ROOT, 'liblince_version.json'),
  resellers: path.join(ROOT, 'resellers.json'),
  mp_credited: path.join(ROOT, 'mp_credited.json'),
  mercadopago_panel: path.join(ROOT, 'mercadopago_panel.json'),
  discord_panel: path.join(ROOT, 'discord_panel.json'),
};

const BLOB_NAMES = {
  keys: 'keys.json',
  redeem_keys: 'redeem_keys.json',
  pause_state: 'pause_state.json',
  users: 'users.json',
  loader_accounts: 'loader_accounts.json',
  activity: 'activity.json',
  loader_product_flags: 'loader_product_flags.json',
  dll_meta: 'dll_meta.json',
  dll: 'loader.dll',
  dll_meta_matadorfx: 'dll_meta_matadorfx.json',
  dll_matadorfx: 'matadorfx.dll',
  dll_meta_nextmenu: 'dll_meta_nextmenu.json',
  dll_nextmenu: 'nextmenu.dll',
  dll_meta_fatalyplay: 'dll_meta_fatalyplay.json',
  dll_fatalyplay: 'fatalyplay.dll',
  dll_meta_freefireindia: 'dll_meta_freefireindia.json',
  dll_freefireindia: 'freefireindia.dll',
  dll_meta_freefireplay: 'dll_meta_freefireplay.json',
  dll_freefireplay: 'freefireplay.dll',
  dll_meta_liblince: 'dll_meta_liblince.json',
  dll_liblince: 'liblincdev.so',
  liblince_version: 'liblince_version.json',
  resellers: 'resellers.json',
  mp_credited: 'mp_credited.json',
  mercadopago_panel: 'mercadopago_panel.json',
  discord_panel: 'discord_panel.json',
};

function dllSlotKeys(slot) {
  if (slot === 'matadorfx') return { meta: 'dll_meta_matadorfx', file: 'dll_matadorfx', defaultName: 'FATALY.dll' };
  if (slot === 'nextmenu') return { meta: 'dll_meta_nextmenu', file: 'dll_nextmenu', defaultName: 'NEXTMENU.dll' };
  if (slot === 'fatalyplay') return { meta: 'dll_meta_fatalyplay', file: 'dll_fatalyplay', defaultName: 'FATALYPLAY.dll' };
  if (slot === 'freefireindia') return { meta: 'dll_meta_freefireindia', file: 'dll_freefireindia', defaultName: 'LuaExecutor.dll' };
  if (slot === 'freefireplay') return { meta: 'dll_meta_freefireplay', file: 'dll_freefireplay', defaultName: 'LuaExecutor.dll' };
  if (slot === 'liblince') return { meta: 'dll_meta_liblince', file: 'dll_liblince', defaultName: 'liblincdev.so', ext: '.so' };
  return { meta: 'dll_meta', file: 'dll', defaultName: 'loader.dll', ext: '.dll' };
}

function isValidSlotFilename(name, slot) {
  const k = dllSlotKeys(slot);
  const ext = (k && k.ext) || '.dll';
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  if (ext === '.so') return /^[\w.\-]+\.so$/i.test(trimmed);
  return /^[\w.\-]+\.dll$/i.test(trimmed);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// --- FS (sync) helpers ---
function readJsonFile(filePath, defaultValue) {
  ensureDir(filePath);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// --- API: todas async; prioridade MySQL > Postgres > SQLite (projeto) > blob > memória > fs ---

async function loadKeysData() {
  if (USE_MYSQL) return getMysqlStore().loadKeysData();
  if (USE_SQL) return getSqlStore().loadKeysData();
  if (USE_SQLITE) return getSqliteStore().loadKeysData();
  if (USE_MEMORY) {
    const data = memory.keys;
    if (!Array.isArray(data.keys)) data.keys = [];
    data.keys = (data.keys || []).map((k) => {
      const sec = k.expiresInSeconds != null ? k.expiresInSeconds : (k.expiresInDays || 0) * 86400;
      return { ...k, expiresInSeconds: sec };
    });
    return data;
  }
  if (!USE_BLOB) {
    const data = readJsonFile(FILES.keys, { keys: [] });
    if (!Array.isArray(data.keys)) data.keys = [];
    data.keys = (data.keys || []).map((k) => {
      const sec = k.expiresInSeconds != null ? k.expiresInSeconds : (k.expiresInDays || 0) * 86400;
      return { ...k, expiresInSeconds: sec };
    });
    return data;
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES.keys, { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return { keys: [] };
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    const data = JSON.parse(raw);
    if (!Array.isArray(data.keys)) data.keys = [];
    data.keys = data.keys.map((k) => {
      const sec = k.expiresInSeconds != null ? k.expiresInSeconds : (k.expiresInDays || 0) * 86400;
      return { ...k, expiresInSeconds: sec };
    });
    return data;
  } catch (_) {
    return { keys: [] };
  }
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

async function loadPauseState() {
  if (USE_MYSQL) return normalizePauseState(await getMysqlStore().loadPauseState());
  if (USE_SQL) return normalizePauseState(await getSqlStore().loadPauseState());
  if (USE_SQLITE) return normalizePauseState(await getSqliteStore().loadPauseState());
  if (USE_MEMORY) {
    memory.pause_state = normalizePauseState(memory.pause_state);
    return memory.pause_state;
  }
  if (!USE_BLOB) {
    return normalizePauseState(readJsonFile(FILES.pause_state, DEFAULT_PAUSE_STATE));
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES.pause_state, { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return DEFAULT_PAUSE_STATE;
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    const data = JSON.parse(raw);
    return normalizePauseState(data);
  } catch (_) {
    return DEFAULT_PAUSE_STATE;
  }
}

async function savePauseState(state) {
  const normalized = normalizePauseState(state);
  if (USE_MYSQL) return getMysqlStore().savePauseState(normalized);
  if (USE_SQL) return getSqlStore().savePauseState(normalized);
  if (USE_SQLITE) return getSqliteStore().savePauseState(normalized);
  if (USE_MEMORY) {
    memory.pause_state = normalized;
    return;
  }
  if (!USE_BLOB) {
    writeJsonFile(FILES.pause_state, normalized);
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(
    put(BLOB_NAMES.pause_state, JSON.stringify(normalized, null, 2), { access: 'private', allowOverwrite: true }),
    BLOB_TIMEOUT_MS
  );
}

async function loadLoaderProductFlags() {
  if (USE_MYSQL) return normalizeLoaderProductFlags(await getMysqlStore().loadLoaderProductFlags());
  if (USE_SQL) return normalizeLoaderProductFlags(await getSqlStore().loadLoaderProductFlags());
  if (USE_SQLITE) return normalizeLoaderProductFlags(await getSqliteStore().loadLoaderProductFlags());
  if (USE_MEMORY) {
    return normalizeLoaderProductFlags(memory.loader_product_flags);
  }
  if (!USE_BLOB) {
    const data = readJsonFile(FILES.loader_product_flags, DEFAULT_LOADER_PRODUCT_FLAGS);
    return normalizeLoaderProductFlags(data);
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES.loader_product_flags, { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return { ...DEFAULT_LOADER_PRODUCT_FLAGS };
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    const data = JSON.parse(raw);
    return normalizeLoaderProductFlags(data);
  } catch (_) {
    return { ...DEFAULT_LOADER_PRODUCT_FLAGS };
  }
}

async function saveLoaderProductFlags(flags) {
  const normalized = normalizeLoaderProductFlags(flags);
  if (USE_MYSQL) return getMysqlStore().saveLoaderProductFlags(normalized);
  if (USE_SQL) return getSqlStore().saveLoaderProductFlags(normalized);
  if (USE_SQLITE) return getSqliteStore().saveLoaderProductFlags(normalized);
  if (USE_MEMORY) {
    memory.loader_product_flags = normalized;
    return;
  }
  if (!USE_BLOB) {
    writeJsonFile(FILES.loader_product_flags, normalized);
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(
    put(BLOB_NAMES.loader_product_flags, JSON.stringify(normalized, null, 2), {
      access: 'private',
      allowOverwrite: true,
    }),
    BLOB_TIMEOUT_MS
  );
}

async function loadRedeemKeyPauses() {
  if (USE_MYSQL) return getMysqlStore().loadRedeemKeyPauses();
  if (USE_SQL) return getSqlStore().loadRedeemKeyPauses();
  if (USE_SQLITE) return getSqliteStore().loadRedeemKeyPauses();
  return {};
}

async function saveRedeemKeyPause(code, state) {
  if (USE_MYSQL) return getMysqlStore().saveRedeemKeyPause(code, state);
  if (USE_SQL) return getSqlStore().saveRedeemKeyPause(code, state);
  if (USE_SQLITE) return getSqliteStore().saveRedeemKeyPause(code, state);
}

async function deleteRedeemKeyPause(code) {
  if (USE_MYSQL) return getMysqlStore().deleteRedeemKeyPause(code);
  if (USE_SQL) return getSqlStore().deleteRedeemKeyPause(code);
  if (USE_SQLITE) return getSqliteStore().deleteRedeemKeyPause(code);
}

async function saveKeysData(data) {
  if (USE_MYSQL) return getMysqlStore().saveKeysData(data);
  if (USE_SQL) return getSqlStore().saveKeysData(data);
  if (USE_SQLITE) return getSqliteStore().saveKeysData(data);
  if (USE_MEMORY) {
    memory.keys = data;
    return;
  }
  if (!USE_BLOB) {
    writeJsonFile(FILES.keys, data);
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(put(BLOB_NAMES.keys, JSON.stringify(data, null, 2), { access: 'private', allowOverwrite: true }), BLOB_TIMEOUT_MS);
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

async function loadUsers() {
  if (USE_MYSQL) return getMysqlStore().loadUsers();
  if (USE_SQL) return getSqlStore().loadUsers();
  if (USE_SQLITE) return getSqliteStore().loadUsers();
  if (USE_MEMORY) return Array.isArray(memory.users.users) ? memory.users.users : [];
  if (!USE_BLOB) {
    const data = readJsonFile(FILES.users, null);
    return Array.isArray(data && data.users) ? data.users : [];
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES.users, { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return [];
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    const data = JSON.parse(raw);
    return Array.isArray(data.users) ? data.users : [];
  } catch (_) {
    return [];
  }
}

async function touchAdminUserLastLogin(username, lastLoginAtIso) {
  if (USE_MYSQL) return getMysqlStore().touchAdminUserLastLogin(username, lastLoginAtIso);
  if (USE_SQL) return getSqlStore().touchAdminUserLastLogin(username, lastLoginAtIso);
  if (USE_SQLITE) return getSqliteStore().touchAdminUserLastLogin(username, lastLoginAtIso);
}

async function saveUsers(users) {
  if (USE_MYSQL) return getMysqlStore().saveUsers(users);
  if (USE_SQL) return getSqlStore().saveUsers(users);
  if (USE_SQLITE) return getSqliteStore().saveUsers(users);
  if (USE_MEMORY) {
    memory.users = { users };
    return;
  }
  if (!USE_BLOB) {
    writeJsonFile(FILES.users, { users });
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(put(BLOB_NAMES.users, JSON.stringify({ users }, null, 2), { access: 'private', allowOverwrite: true }), BLOB_TIMEOUT_MS);
}

function normalizeLoaderAccount(account) {
  if (!account || typeof account !== 'object') return account;
  return { ...account, paused: !!account.paused };
}

function normalizeLoaderAccounts(list) {
  return (list || []).map((a) => normalizeLoaderAccount(a));
}

async function loadLoaderAccounts() {
  if (USE_MYSQL) return normalizeLoaderAccounts(await getMysqlStore().loadLoaderAccounts());
  if (USE_SQL) return normalizeLoaderAccounts(await getSqlStore().loadLoaderAccounts());
  if (USE_SQLITE) return normalizeLoaderAccounts(await getSqliteStore().loadLoaderAccounts());
  if (USE_MEMORY) return normalizeLoaderAccounts(Array.isArray(memory.loader_accounts) ? memory.loader_accounts : []);
  if (!USE_BLOB) {
    const data = readJsonFile(FILES.loader_accounts, null);
    return normalizeLoaderAccounts(Array.isArray(data && data.accounts) ? data.accounts : []);
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES.loader_accounts, { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return [];
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    const data = JSON.parse(raw);
    return normalizeLoaderAccounts(Array.isArray(data.accounts) ? data.accounts : []);
  } catch (_) {
    return [];
  }
}

async function saveLoaderAccounts(accounts) {
  if (USE_MYSQL) return getMysqlStore().saveLoaderAccounts(accounts);
  if (USE_SQL) return getSqlStore().saveLoaderAccounts(accounts);
  if (USE_SQLITE) return getSqliteStore().saveLoaderAccounts(accounts);
  if (USE_MEMORY) {
    memory.loader_accounts = Array.isArray(accounts) ? accounts : [];
    return;
  }
  if (!USE_BLOB) {
    writeJsonFile(FILES.loader_accounts, { accounts: accounts || [] });
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(put(BLOB_NAMES.loader_accounts, JSON.stringify({ accounts: accounts || [] }, null, 2), { access: 'private', allowOverwrite: true }), BLOB_TIMEOUT_MS);
}

async function loadRedeemKeys() {
  if (USE_MYSQL) return getMysqlStore().loadRedeemKeys();
  if (USE_SQL) return getSqlStore().loadRedeemKeys();
  if (USE_SQLITE) return getSqliteStore().loadRedeemKeys();
  if (USE_MEMORY) return Array.isArray(memory.redeem_keys.keys) ? memory.redeem_keys.keys : [];
  if (!USE_BLOB) {
    const data = readJsonFile(FILES.redeem_keys, { keys: [] });
    return Array.isArray(data.keys) ? data.keys : [];
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES.redeem_keys, { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return [];
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    const data = JSON.parse(raw);
    return Array.isArray(data.keys) ? data.keys : [];
  } catch (_) {
    return [];
  }
}

async function saveRedeemKeys(keys) {
  if (USE_MYSQL) return getMysqlStore().saveRedeemKeys(keys);
  if (USE_SQL) return getSqlStore().saveRedeemKeys(keys);
  if (USE_SQLITE) return getSqliteStore().saveRedeemKeys(keys);
  if (USE_MEMORY) {
    memory.redeem_keys = { keys };
    return;
  }
  if (!USE_BLOB) {
    writeJsonFile(FILES.redeem_keys, { keys });
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(put(BLOB_NAMES.redeem_keys, JSON.stringify({ keys }, null, 2), { access: 'private', allowOverwrite: true }), BLOB_TIMEOUT_MS);
}

function normalizeActivityList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

async function loadActivityLog() {
  if (USE_MYSQL) {
    const s = getMysqlStore();
    if (s && typeof s.loadActivityLog === 'function') return s.loadActivityLog();
  }
  if (USE_SQL) {
    const s = getSqlStore();
    if (s && typeof s.loadActivityLog === 'function') return s.loadActivityLog();
  }
  if (USE_SQLITE) {
    const s = getSqliteStore();
    if (s && typeof s.loadActivityLog === 'function') return s.loadActivityLog();
  }
  if (USE_MEMORY) return normalizeActivityList(memory.activity);
  if (!USE_BLOB) {
    const data = readJsonFile(FILES.activity, { items: [] });
    return normalizeActivityList(data);
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES.activity, { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return [];
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    const data = JSON.parse(raw);
    return normalizeActivityList(data);
  } catch (_) {
    return [];
  }
}

async function saveActivityLog(list) {
  const items = normalizeActivityList(list);
  if (USE_MYSQL) {
    const s = getMysqlStore();
    if (s && typeof s.saveActivityLog === 'function') return s.saveActivityLog(items);
  }
  if (USE_SQL) {
    const s = getSqlStore();
    if (s && typeof s.saveActivityLog === 'function') return s.saveActivityLog(items);
  }
  if (USE_SQLITE) {
    const s = getSqliteStore();
    if (s && typeof s.saveActivityLog === 'function') return s.saveActivityLog(items);
  }
  if (USE_MEMORY) {
    memory.activity = items;
    return;
  }
  if (!USE_BLOB) {
    writeJsonFile(FILES.activity, { items });
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(put(BLOB_NAMES.activity, JSON.stringify({ items }, null, 2), { access: 'private', allowOverwrite: true }), BLOB_TIMEOUT_MS);
}

async function getDllMeta(slot) {
  const k = dllSlotKeys(slot);
  if (USE_MYSQL) return getMysqlStore().getDllMeta(slot);
  if (USE_SQL) return getSqlStore().getDllMeta(slot);
  if (USE_SQLITE) return getSqliteStore().getDllMeta(slot);
  if (USE_MEMORY) {
    const o = memory[k.meta];
    const name = (o && o.filename && String(o.filename).trim()) || '';
    return isValidSlotFilename(name, slot) ? name : k.defaultName;
  }
  if (!USE_BLOB) {
    const o = readJsonFile(FILES[k.meta], {});
    const name = (o && o.filename && String(o.filename).trim()) || '';
    return isValidSlotFilename(name, slot) ? name : k.defaultName;
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES[k.meta], { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return k.defaultName;
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    const o = JSON.parse(raw);
    const name = (o && o.filename && String(o.filename).trim()) || '';
    return isValidSlotFilename(name, slot) ? name : k.defaultName;
  } catch (_) {
    return k.defaultName;
  }
}

async function setDllMeta(filename, slot) {
  const k = dllSlotKeys(slot);
  const name = isValidSlotFilename(filename, slot) ? String(filename).trim() : k.defaultName;
  const data = { filename: name };
  if (USE_MYSQL) return getMysqlStore().setDllMeta(filename, slot);
  if (USE_SQL) return getSqlStore().setDllMeta(filename, slot);
  if (USE_SQLITE) return getSqliteStore().setDllMeta(filename, slot);
  if (USE_MEMORY) {
    memory[k.meta] = data;
    return;
  }
  if (!USE_BLOB) {
    writeJsonFile(FILES[k.meta], data);
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(put(BLOB_NAMES[k.meta], JSON.stringify(data, null, 2), { access: 'private', allowOverwrite: true }), BLOB_TIMEOUT_MS);
}

async function getDllBuffer(slot) {
  const k = dllSlotKeys(slot);
  if (USE_MYSQL) return getMysqlStore().getDllBuffer(slot);
  if (USE_SQL) return getSqlStore().getDllBuffer(slot);
  if (USE_SQLITE) return getSqliteStore().getDllBuffer(slot);
  if (USE_MEMORY) {
    const d = memory[k.file];
    return d ? Buffer.from(d) : null;
  }
  if (!USE_BLOB) {
    try {
      if (fs.existsSync(FILES[k.file])) return fs.readFileSync(FILES[k.file]);
    } catch (_) {}
    return null;
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES[k.file], { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const stream = Readable.fromWeb(result.stream);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (_) {
    return null;
  }
}

async function setDllBuffer(buf, slot) {
  const k = dllSlotKeys(slot);
  if (USE_MYSQL) return getMysqlStore().setDllBuffer(buf, slot);
  if (USE_SQL) return getSqlStore().setDllBuffer(buf, slot);
  if (USE_SQLITE) return getSqliteStore().setDllBuffer(buf, slot);
  if (USE_MEMORY) {
    memory[k.file] = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    return;
  }
  if (!USE_BLOB) {
    ensureDir(FILES[k.file]);
    fs.writeFileSync(FILES[k.file], buf);
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(put(BLOB_NAMES[k.file], buf, { access: 'private', allowOverwrite: true }), BLOB_TIMEOUT_MS);
}

async function dllExists(slot) {
  const k = dllSlotKeys(slot);
  if (USE_MYSQL) return getMysqlStore().dllExists(slot);
  if (USE_SQL) return getSqlStore().dllExists(slot);
  if (USE_SQLITE) return getSqliteStore().dllExists(slot);
  if (USE_MEMORY) {
    const d = memory[k.file];
    return d != null && d.length > 0;
  }
  if (!USE_BLOB) return fs.existsSync(FILES[k.file]);
  const b = await getDllBuffer(slot);
  return b != null && b.length > 0;
}

function normalizeLibLinceVersion(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return '';
  return v.length > 64 ? v.slice(0, 64) : v;
}

async function getLibLinceVersion() {
  if (USE_MYSQL) {
    const s = getMysqlStore();
    if (s && typeof s.getLibLinceVersion === 'function') return s.getLibLinceVersion();
  }
  if (USE_SQL) {
    const s = getSqlStore();
    if (s && typeof s.getLibLinceVersion === 'function') return s.getLibLinceVersion();
  }
  if (USE_SQLITE) {
    const s = getSqliteStore();
    if (s && typeof s.getLibLinceVersion === 'function') return s.getLibLinceVersion();
  }
  if (USE_MEMORY) {
    return normalizeLibLinceVersion(memory.liblince_version || '');
  }
  if (!USE_BLOB) {
    const data = readJsonFile(FILES.liblince_version, { version: '' });
    return normalizeLibLinceVersion(data && data.version);
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES.liblince_version, { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return '';
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    const data = JSON.parse(raw);
    return normalizeLibLinceVersion(data && data.version);
  } catch (_) {
    return '';
  }
}

async function setLibLinceVersion(version) {
  const v = normalizeLibLinceVersion(version);
  if (USE_MYSQL) {
    const s = getMysqlStore();
    if (s && typeof s.setLibLinceVersion === 'function') return s.setLibLinceVersion(v);
  }
  if (USE_SQL) {
    const s = getSqlStore();
    if (s && typeof s.setLibLinceVersion === 'function') return s.setLibLinceVersion(v);
  }
  if (USE_SQLITE) {
    const s = getSqliteStore();
    if (s && typeof s.setLibLinceVersion === 'function') return s.setLibLinceVersion(v);
  }
  if (USE_MEMORY) {
    memory.liblince_version = v;
    return;
  }
  const payload = { version: v };
  if (!USE_BLOB) {
    writeJsonFile(FILES.liblince_version, payload);
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(put(BLOB_NAMES.liblince_version, JSON.stringify(payload, null, 2), { access: 'private', allowOverwrite: true }), BLOB_TIMEOUT_MS);
}

async function setDllBlobUrl(url, slot) {
  if (USE_SQL) return getSqlStore().setDllBlobUrl(url, slot);
}

async function saveDllChunk(uploadId, index, buffer) {
  if (USE_SQL) return getSqlStore().saveDllChunk(uploadId, index, buffer);
}

async function getDllChunks(uploadId) {
  if (USE_SQL) return getSqlStore().getDllChunks(uploadId);
  return [];
}

async function deleteDllChunks(uploadId) {
  if (USE_SQL) return getSqlStore().deleteDllChunks(uploadId);
}

const RESELLER_AVATAR_URL_MAX_LEN = 600000;

function normalizeResellerRow(r) {
  if (!r || typeof r !== 'object') return null;
  const bal = Number(r.balance);
  const row = {
    username: String(r.username || '').trim(),
    passwordHash: String(r.passwordHash || ''),
    balance: Number.isFinite(bal) ? Math.round(bal * 100) / 100 : 0,
    createdAt: r.createdAt || new Date().toISOString(),
  };
  const bip = r.boundIp != null && String(r.boundIp).trim() ? String(r.boundIp).trim() : '';
  if (bip) row.boundIp = bip;
  const av =
    typeof r.avatarUrl === 'string'
      ? r.avatarUrl.trim()
      : typeof r.avatar_url === 'string'
        ? String(r.avatar_url).trim()
        : '';
  if (av.length > RESELLER_AVATAR_URL_MAX_LEN) {
    /* ignora valor corrompido / demasiado grande */
  } else if (av && /^data:image\/(jpeg|jpg|png|gif|webp);base64,/i.test(av)) {
    row.avatarUrl = av;
  }
  const sph =
    typeof r.secretPhraseHash === 'string'
      ? r.secretPhraseHash.trim()
      : typeof r.secret_phrase_hash === 'string'
        ? String(r.secret_phrase_hash).trim()
        : '';
  if (sph && /^[a-f0-9]{64}$/i.test(sph)) {
    row.secretPhraseHash = sph;
  }
  const rec =
    typeof r.recoveryEmail === 'string'
      ? r.recoveryEmail.trim().toLowerCase()
      : typeof r.recovery_email === 'string'
        ? String(r.recovery_email).trim().toLowerCase()
        : '';
  if (rec && rec.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec)) {
    row.recoveryEmail = rec;
  }
  const prh =
    typeof r.passwordResetTokenHash === 'string'
      ? r.passwordResetTokenHash.trim()
      : typeof r.password_reset_token_hash === 'string'
        ? String(r.password_reset_token_hash).trim()
        : '';
  if (prh && /^[a-f0-9]{64}$/i.test(prh)) {
    row.passwordResetTokenHash = prh;
  }
  const pre =
    typeof r.passwordResetExpires === 'string'
      ? r.passwordResetExpires
      : typeof r.password_reset_expires === 'string'
        ? String(r.password_reset_expires)
        : '';
  if (pre) {
    const t = new Date(pre).getTime();
    if (!Number.isNaN(t)) row.passwordResetExpires = new Date(t).toISOString();
  }
  const RESELLER_PHRASE_PLAIN_MAX = 200;
  const rawPlain =
    r.secretPhrasePlain != null && r.secretPhrasePlain !== ''
      ? r.secretPhrasePlain
      : r.secret_phrase_plain != null && r.secret_phrase_plain !== ''
        ? r.secret_phrase_plain
        : null;
  let spp = '';
  if (rawPlain != null) {
    spp = String(rawPlain).trim();
    if (spp.length > RESELLER_PHRASE_PLAIN_MAX) spp = '';
  }
  if (spp) row.secretPhrasePlain = spp;
  return row;
}

async function loadResellers() {
  if (USE_MYSQL) return getMysqlStore().loadResellers();
  if (USE_SQL) return getSqlStore().loadResellers();
  if (USE_SQLITE) return getSqliteStore().loadResellers();
  if (USE_MEMORY) {
    return Array.isArray(memory.resellers) ? memory.resellers.map((r) => normalizeResellerRow(r)).filter(Boolean) : [];
  }
  if (!USE_BLOB) {
    const data = readJsonFile(FILES.resellers, { resellers: [] });
    const list = Array.isArray(data.resellers) ? data.resellers : [];
    return list.map((r) => normalizeResellerRow(r)).filter(Boolean);
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES.resellers, { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return [];
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    const data = JSON.parse(raw);
    const list = Array.isArray(data.resellers) ? data.resellers : [];
    return list.map((r) => normalizeResellerRow(r)).filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function saveResellers(resellers) {
  const list = (resellers || []).map((r) => normalizeResellerRow(r)).filter((x) => x && x.username);
  if (USE_MYSQL) return getMysqlStore().saveResellers(list);
  if (USE_SQL) return getSqlStore().saveResellers(list);
  if (USE_SQLITE) return getSqliteStore().saveResellers(list);
  if (USE_MEMORY) {
    memory.resellers = list;
    return;
  }
  if (!USE_BLOB) {
    writeJsonFile(FILES.resellers, { resellers: list });
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(put(BLOB_NAMES.resellers, JSON.stringify({ resellers: list }, null, 2), { access: 'private', allowOverwrite: true }), BLOB_TIMEOUT_MS);
}

async function loadMpCreditedIds() {
  if (USE_MYSQL) return getMysqlStore().loadMpCreditedIds();
  if (USE_SQL) return getSqlStore().loadMpCreditedIds();
  if (USE_SQLITE) return getSqliteStore().loadMpCreditedIds();
  if (USE_MEMORY) {
    return Array.isArray(memory.mp_credited_ids) ? memory.mp_credited_ids.map(String) : [];
  }
  if (!USE_BLOB) {
    const data = readJsonFile(FILES.mp_credited, { ids: [] });
    return Array.isArray(data.ids) ? data.ids.map(String) : [];
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES.mp_credited, { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return [];
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    const data = JSON.parse(raw);
    return Array.isArray(data.ids) ? data.ids.map(String) : [];
  } catch (_) {
    return [];
  }
}

async function saveMpCreditedIds(ids) {
  const unique = Array.from(new Set((ids || []).map(String)));
  if (USE_MYSQL) return getMysqlStore().saveMpCreditedIds(unique);
  if (USE_SQL) return getSqlStore().saveMpCreditedIds(unique);
  if (USE_SQLITE) return getSqliteStore().saveMpCreditedIds(unique);
  if (USE_MEMORY) {
    memory.mp_credited_ids = unique;
    return;
  }
  if (!USE_BLOB) {
    writeJsonFile(FILES.mp_credited, { ids: unique });
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(put(BLOB_NAMES.mp_credited, JSON.stringify({ ids: unique }, null, 2), { access: 'private', allowOverwrite: true }), BLOB_TIMEOUT_MS);
}

async function appendMpCreditedId(paymentId) {
  const id = String(paymentId || '').trim();
  if (!id) return false;
  if (USE_MYSQL) return getMysqlStore().appendMpCreditedId(id);
  if (USE_SQL) return getSqlStore().appendMpCreditedId(id);
  if (USE_SQLITE) return getSqliteStore().appendMpCreditedId(id);
  const ids = await loadMpCreditedIds();
  if (ids.includes(id)) return false;
  ids.push(id);
  await saveMpCreditedIds(ids);
  return true;
}

function normalizeMercadoPagoPanel(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    accessToken: typeof o.accessToken === 'string' ? o.accessToken : '',
    payerEmail: typeof o.payerEmail === 'string' ? o.payerEmail : '',
  };
}

async function loadMercadoPagoPanelSettings() {
  if (USE_MYSQL) return getMysqlStore().loadMercadoPagoPanelSettings();
  if (USE_SQL) return getSqlStore().loadMercadoPagoPanelSettings();
  if (USE_SQLITE) return getSqliteStore().loadMercadoPagoPanelSettings();
  if (USE_MEMORY) return normalizeMercadoPagoPanel(memory.mercadopago_panel);
  if (!USE_BLOB) {
    const data = readJsonFile(FILES.mercadopago_panel, { accessToken: '', payerEmail: '' });
    return normalizeMercadoPagoPanel(data);
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES.mercadopago_panel, { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) return { accessToken: '', payerEmail: '' };
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    return normalizeMercadoPagoPanel(JSON.parse(raw));
  } catch (_) {
    return { accessToken: '', payerEmail: '' };
  }
}

async function saveMercadoPagoPanelSettings(data) {
  const payload = normalizeMercadoPagoPanel(data);
  if (USE_MYSQL) return getMysqlStore().saveMercadoPagoPanelSettings(payload);
  if (USE_SQL) return getSqlStore().saveMercadoPagoPanelSettings(payload);
  if (USE_SQLITE) return getSqliteStore().saveMercadoPagoPanelSettings(payload);
  if (USE_MEMORY) {
    memory.mercadopago_panel = payload;
    return;
  }
  if (!USE_BLOB) {
    writeJsonFile(FILES.mercadopago_panel, payload);
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(
    put(BLOB_NAMES.mercadopago_panel, JSON.stringify(payload, null, 2), { access: 'private', allowOverwrite: true }),
    BLOB_TIMEOUT_MS
  );
}

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
  if (USE_MYSQL) return getMysqlStore().loadDiscordPanelSettings();
  if (USE_SQL) return getSqlStore().loadDiscordPanelSettings();
  if (USE_SQLITE) return getSqliteStore().loadDiscordPanelSettings();
  if (USE_MEMORY) return normalizeDiscordPanel(memory.discord_panel);
  if (!USE_BLOB) {
    const data = readJsonFile(FILES.discord_panel, {
      keyGenerated: '',
      keyDeleted: '',
      resellerPayment: '',
      fallback: '',
    });
    return normalizeDiscordPanel(data);
  }
  const { get } = require('@vercel/blob');
  try {
    const result = await withTimeout(get(BLOB_NAMES.discord_panel, { access: 'private' }), BLOB_TIMEOUT_MS);
    if (!result || result.statusCode !== 200 || !result.stream) {
      return { keyGenerated: '', keyDeleted: '', resellerPayment: '', fallback: '' };
    }
    const raw = await withTimeout(streamToString(Readable.fromWeb(result.stream)), BLOB_TIMEOUT_MS);
    return normalizeDiscordPanel(JSON.parse(raw));
  } catch (_) {
    return { keyGenerated: '', keyDeleted: '', resellerPayment: '', fallback: '' };
  }
}

async function saveDiscordPanelSettings(data) {
  const payload = normalizeDiscordPanel(data);
  if (USE_MYSQL) return getMysqlStore().saveDiscordPanelSettings(payload);
  if (USE_SQL) return getSqlStore().saveDiscordPanelSettings(payload);
  if (USE_SQLITE) return getSqliteStore().saveDiscordPanelSettings(payload);
  if (USE_MEMORY) {
    memory.discord_panel = payload;
    return;
  }
  if (!USE_BLOB) {
    writeJsonFile(FILES.discord_panel, payload);
    return;
  }
  const { put } = require('@vercel/blob');
  await withTimeout(
    put(BLOB_NAMES.discord_panel, JSON.stringify(payload, null, 2), { access: 'private', allowOverwrite: true }),
    BLOB_TIMEOUT_MS
  );
}

module.exports = {
  USE_MYSQL,
  USE_SQL,
  USE_SQLITE,
  USE_BLOB,
  loadKeysData,
  saveKeysData,
  loadPauseState,
  savePauseState,
  loadLoaderProductFlags,
  saveLoaderProductFlags,
  loadRedeemKeyPauses,
  saveRedeemKeyPause,
  deleteRedeemKeyPause,
  loadUsers,
  touchAdminUserLastLogin,
  saveUsers,
  loadLoaderAccounts,
  saveLoaderAccounts,
  loadRedeemKeys,
  saveRedeemKeys,
  loadActivityLog,
  saveActivityLog,
  getDllMeta,
  setDllMeta,
  getDllBuffer,
  setDllBuffer,
  getLibLinceVersion,
  setLibLinceVersion,
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
