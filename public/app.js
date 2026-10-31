const API = '';
const FETCH_TIMEOUT_MS = 25000; // 25s — se passar, mostra erro
const STORAGE_USER = 'silva_key_user';
const STORAGE_PASSWORD = 'silva_key_password';
const STORAGE_REMEMBER_USER = 'silva_key_login_user';
const STORAGE_REMEMBER_PASSWORD = 'silva_key_login_password';
const STORAGE_REMEMBER_ENABLED = 'silva_key_login_remember';
const STORAGE_ACTIVE_TAB = 'silva_key_active_tab';
const STORAGE_SECRET_PHRASE = 'silva_key_secret_phrase';
const STORAGE_REMEMBER_PHRASE = 'silva_key_login_phrase';
const STORAGE_REMEMBER_PHRASE_USER = 'silva_key_login_phrase_user';
const PRESENCE_PING_INTERVAL_MS = 20000;
const LOADER_ONLINE_POLL_INTERVAL_MS = 5000;

/** owner | staff | ajudante — controla abas e permissões (espelha o servidor) */
let adminPanelRole = 'owner';

let presencePingTimer = null;
let loaderAccountsPollTimer = null;

function startPresencePing() {
  // Presenca agora e definida no login; sem polling continuo.
}

function stopPresencePing() {}

function startLoaderAccountsPolling() {
  if (loaderAccountsPollTimer) return;
  loaderAccountsPollTimer = setInterval(() => {
    const auth = getAuth();
    if (!auth.user || !auth.password) return;
    loadLoaderAccounts();
  }, LOADER_ONLINE_POLL_INTERVAL_MS);
}

function stopLoaderAccountsPolling() {
  if (loaderAccountsPollTimer) {
    clearInterval(loaderAccountsPollTimer);
    loaderAccountsPollTimer = null;
  }
}

function sendPresenceLogout() {
  try {
    fetch(API + '/api/presence/logout', { method: 'POST', headers: headers(), keepalive: true });
  } catch (_) {}
}

function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

function getAuth() {
  const user = sessionStorage.getItem(STORAGE_USER);
  const password = sessionStorage.getItem(STORAGE_PASSWORD);
  const secretPhrase = sessionStorage.getItem(STORAGE_SECRET_PHRASE);
  return { user: user || '', password: password || '', secretPhrase: secretPhrase || '' };
}

function setAuth(user, password, secretPhrase) {
  if (user) sessionStorage.setItem(STORAGE_USER, user);
  else sessionStorage.removeItem(STORAGE_USER);
  if (password) sessionStorage.setItem(STORAGE_PASSWORD, password);
  else sessionStorage.removeItem(STORAGE_PASSWORD);
  if (secretPhrase != null && secretPhrase !== '') sessionStorage.setItem(STORAGE_SECRET_PHRASE, secretPhrase);
  else sessionStorage.removeItem(STORAGE_SECRET_PHRASE);
}

function clearAuth() {
  sessionStorage.removeItem(STORAGE_USER);
  sessionStorage.removeItem(STORAGE_PASSWORD);
  sessionStorage.removeItem(STORAGE_SECRET_PHRASE);
}

function getRememberedAuth() {
  try {
    const user = localStorage.getItem(STORAGE_REMEMBER_USER);
    const password = localStorage.getItem(STORAGE_REMEMBER_PASSWORD);
    let phrase = '';
    if (user && localStorage.getItem(STORAGE_REMEMBER_PHRASE_USER) === user) {
      phrase = localStorage.getItem(STORAGE_REMEMBER_PHRASE) || '';
    }
    return { user: user || '', password: password || '', phrase: phrase || '' };
  } catch (_) {
    return { user: '', password: '', phrase: '' };
  }
}

function setRememberedAuth(user, password, phrase) {
  try {
    if (user !== undefined) {
      if (user) localStorage.setItem(STORAGE_REMEMBER_USER, user);
      else localStorage.removeItem(STORAGE_REMEMBER_USER);
    }
    if (password !== undefined) {
      if (password) localStorage.setItem(STORAGE_REMEMBER_PASSWORD, password);
      else localStorage.removeItem(STORAGE_REMEMBER_PASSWORD);
    }
    if (phrase !== undefined) {
      const u = user !== undefined ? user : localStorage.getItem(STORAGE_REMEMBER_USER);
      if (phrase && u) {
        localStorage.setItem(STORAGE_REMEMBER_PHRASE, phrase);
        localStorage.setItem(STORAGE_REMEMBER_PHRASE_USER, u);
      } else {
        localStorage.removeItem(STORAGE_REMEMBER_PHRASE);
        localStorage.removeItem(STORAGE_REMEMBER_PHRASE_USER);
      }
    }
  } catch (_) {}
}

function isRememberEnabled() {
  try {
    return localStorage.getItem(STORAGE_REMEMBER_ENABLED) === '1';
  } catch (_) {
    return false;
  }
}

function setRememberEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_REMEMBER_ENABLED, enabled ? '1' : '0');
  } catch (_) {}
}

function headers() {
  const auth = getAuth();
  const h = {
    'Content-Type': 'application/json',
    'X-Admin-User': auth.user || '',
    'X-Admin-Password': auth.password || '',
  };
  if (auth.secretPhrase) h['X-Admin-Secret-Phrase'] = auth.secretPhrase;
  return h;
}

const loginBox = document.getElementById('loginBox');
const panel = document.getElementById('panel');
const loginUser = document.getElementById('loginUser');
const btnCheckDb = document.getElementById('btnCheckDb');
const loginDbStatus = document.getElementById('loginDbStatus');
const loginPassword = document.getElementById('loginPassword');
const btnLogin = document.getElementById('btnLogin');
const loginError = document.getElementById('loginError');
const adminPhraseModal = document.getElementById('adminPhraseModal');
const adminModalSecretPhrase = document.getElementById('adminModalSecretPhrase');
const btnAdminModalPhraseConfirm = document.getElementById('btnAdminModalPhraseConfirm');
const btnAdminModalPhraseCancel = document.getElementById('btnAdminModalPhraseCancel');
const adminModalPhraseError = document.getElementById('adminModalPhraseError');
let pendingPhraseLogin = null;

const rememberLogin = document.getElementById('rememberLogin');

function applyRememberedLoginFields() {
  const rememberedAuth = getRememberedAuth();
  const rememberEnabled = isRememberEnabled() || !!(rememberedAuth.user || rememberedAuth.password);
  if (rememberLogin) rememberLogin.checked = rememberEnabled;
  if (rememberEnabled) {
    if (loginUser) loginUser.value = rememberedAuth.user || '';
    if (loginPassword) loginPassword.value = rememberedAuth.password || '';
  } else {
    if (loginUser) loginUser.value = '';
    if (loginPassword) loginPassword.value = '';
  }
}

applyRememberedLoginFields();

if (rememberLogin) {
  rememberLogin.addEventListener('change', () => {
    const enabled = rememberLogin.checked;
    setRememberEnabled(enabled);
    if (!enabled) setRememberedAuth('', '', '');
    applyRememberedLoginFields();
  });
}

const newUserUsername = document.getElementById('newUserUsername');
const newUserPassword = document.getElementById('newUserPassword');
const newUserRole = document.getElementById('newUserRole');
const btnAddUser = document.getElementById('btnAddUser');
const usersMessage = document.getElementById('usersMessage');
const usersList = document.getElementById('usersList');
const newResellerUsername = document.getElementById('newResellerUsername');
const newResellerPassword = document.getElementById('newResellerPassword');
const newResellerBalance = document.getElementById('newResellerBalance');
const btnAddReseller = document.getElementById('btnAddReseller');
const resellersMessage = document.getElementById('resellersMessage');
const resellersList = document.getElementById('resellersList');
const resellerGeneratedKeysList = document.getElementById('resellerGeneratedKeysList');
const mpPanelPayerEmail = document.getElementById('mpPanelPayerEmail');
const mpPanelAccessToken = document.getElementById('mpPanelAccessToken');
const mpPanelClearToken = document.getElementById('mpPanelClearToken');
const btnSaveMpPanel = document.getElementById('btnSaveMpPanel');
const mpPanelMessage = document.getElementById('mpPanelMessage');
const mpPanelStatus = document.getElementById('mpPanelStatus');
const discordWebhookKeyGenerated = document.getElementById('discordWebhookKeyGenerated');
const discordWebhookKeyDeleted = document.getElementById('discordWebhookKeyDeleted');
const discordWebhookResellerPayment = document.getElementById('discordWebhookResellerPayment');
const discordWebhookFallback = document.getElementById('discordWebhookFallback');
const discordWebhookEditArea = document.getElementById('discordWebhookEditArea');
const discordWebhookSavedSummary = document.getElementById('discordWebhookSavedSummary');
const discordWebhookPanelStatus = document.getElementById('discordWebhookPanelStatus');
const btnEditDiscordWebhooks = document.getElementById('btnEditDiscordWebhooks');
const btnSaveDiscordPanel = document.getElementById('btnSaveDiscordPanel');
const discordPanelMessage = document.getElementById('discordPanelMessage');

let discordPanelCache = {
  keyGenerated: '',
  keyDeleted: '',
  resellerPayment: '',
  fallback: '',
};
let discordWebhooksUiCollapsed = false;
const adminPhraseNew = document.getElementById('adminPhraseNew');
const adminPhraseConfirm = document.getElementById('adminPhraseConfirm');
const btnSaveAdminPhrase = document.getElementById('btnSaveAdminPhrase');
const btnClearAdminPhrase = document.getElementById('btnClearAdminPhrase');
const keysCount = document.getElementById('keysCount');
const loaderUsername = document.getElementById('loaderUsername');
const loaderPassword = document.getElementById('loaderPassword');
const loaderExpiresDays = document.getElementById('loaderExpiresDays');
const loaderSkipHwid = document.getElementById('loaderSkipHwid');
const btnAddLoaderAccount = document.getElementById('btnAddLoaderAccount');
const loaderMessage = document.getElementById('loaderMessage');
const loaderAccountsList = document.getElementById('loaderAccountsList');
const btnLogout = document.getElementById('btnLogout');
const buscarUsuarioInput = document.getElementById('buscarUsuarioInput');
const btnBuscarUsuario = document.getElementById('btnBuscarUsuario');
const buscarRedeemInput = document.getElementById('buscarRedeemInput');
const btnBuscarRedeem = document.getElementById('btnBuscarRedeem');
const redeemStatusFilter = document.getElementById('redeemStatusFilter');
const activityList = document.getElementById('activityList');
const renewKeyIdInput = document.getElementById('renewKeyId');
const renewKeyDaysInput = document.getElementById('renewKeyDays');
const btnRenewKey = document.getElementById('btnRenewKey');
const renewKeyMessage = document.getElementById('renewKeyMessage');
const renewKeysList = document.getElementById('renewKeysList');
const loaderAccountsListUsuarios = document.getElementById('loaderAccountsListUsuarios');
const loaderOnlineCountValue = document.getElementById('loaderOnlineCountValue');
const loaderOnlineCountLabel = document.getElementById('loaderOnlineCountLabel');
const dllFileInput = document.getElementById('dllFileInput');
const btnUploadDll = document.getElementById('btnUploadDll');
const dllMessage = document.getElementById('dllMessage');
const dllLinkSection = document.getElementById('dllLinkSection');
const dllLinkUrl = document.getElementById('dllLinkUrl');
const btnCopyDllLink = document.getElementById('btnCopyDllLink');
const dllFileInfo = document.getElementById('dllFileInfo');
const dllMatadorfxFileInput = document.getElementById('dllMatadorfxFileInput');
const btnUploadDllMatadorfx = document.getElementById('btnUploadDllMatadorfx');
const dllMatadorfxMessage = document.getElementById('dllMatadorfxMessage');
const dllMatadorfxLinkSection = document.getElementById('dllMatadorfxLinkSection');
const dllMatadorfxLinkUrl = document.getElementById('dllMatadorfxLinkUrl');
const btnCopyDllLinkMatadorfx = document.getElementById('btnCopyDllLinkMatadorfx');
const dllMatadorfxFileInfo = document.getElementById('dllMatadorfxFileInfo');
const dllNextmenuFileInput = document.getElementById('dllNextmenuFileInput');
const btnUploadDllNextmenu = document.getElementById('btnUploadDllNextmenu');
const dllNextmenuMessage = document.getElementById('dllNextmenuMessage');
const dllNextmenuLinkSection = document.getElementById('dllNextmenuLinkSection');
const dllNextmenuLinkUrl = document.getElementById('dllNextmenuLinkUrl');
const btnCopyDllLinkNextmenu = document.getElementById('btnCopyDllLinkNextmenu');
const dllNextmenuFileInfo = document.getElementById('dllNextmenuFileInfo');
const dllFatalyplayFileInput = document.getElementById('dllFatalyplayFileInput');
const btnUploadDllFatalyplay = document.getElementById('btnUploadDllFatalyplay');
const dllFatalyplayMessage = document.getElementById('dllFatalyplayMessage');
const dllFatalyplayLinkSection = document.getElementById('dllFatalyplayLinkSection');
const dllFatalyplayLinkUrl = document.getElementById('dllFatalyplayLinkUrl');
const btnCopyDllLinkFatalyplay = document.getElementById('btnCopyDllLinkFatalyplay');
const dllFatalyplayFileInfo = document.getElementById('dllFatalyplayFileInfo');
const dllFreefireindiaFileInput = document.getElementById('dllFreefireindiaFileInput');
const btnUploadDllFreefireindia = document.getElementById('btnUploadDllFreefireindia');
const dllFreefireindiaMessage = document.getElementById('dllFreefireindiaMessage');
const dllFreefireindiaLinkSection = document.getElementById('dllFreefireindiaLinkSection');
const dllFreefireindiaLinkUrl = document.getElementById('dllFreefireindiaLinkUrl');
const btnCopyDllLinkFreefireindia = document.getElementById('btnCopyDllLinkFreefireindia');
const dllFreefireindiaFileInfo = document.getElementById('dllFreefireindiaFileInfo');
const dllFreefireplayFileInput = document.getElementById('dllFreefireplayFileInput');
const btnUploadDllFreefireplay = document.getElementById('btnUploadDllFreefireplay');
const dllFreefireplayMessage = document.getElementById('dllFreefireplayMessage');
const dllFreefireplayLinkSection = document.getElementById('dllFreefireplayLinkSection');
const dllFreefireplayLinkUrl = document.getElementById('dllFreefireplayLinkUrl');
const btnCopyDllLinkFreefireplay = document.getElementById('btnCopyDllLinkFreefireplay');
const dllFreefireplayFileInfo = document.getElementById('dllFreefireplayFileInfo');
const loaderFlag0 = document.getElementById('loaderFlag0');
const loaderFlag1 = document.getElementById('loaderFlag1');
const loaderFlag2 = document.getElementById('loaderFlag2');
const loaderProductFlagsMessage = document.getElementById('loaderProductFlagsMessage');
let loaderProductFlagsPanelReady = false;
const libLinceVersionInput = document.getElementById('libLinceVersionInput');
const libLinceFileInput = document.getElementById('libLinceFileInput');
const btnUploadLibLince = document.getElementById('btnUploadLibLince');
const libLinceMessage = document.getElementById('libLinceMessage');
const libLinceLinkSection = document.getElementById('libLinceLinkSection');
const libLinceLinkUrl = document.getElementById('libLinceLinkUrl');
const btnCopyLibLinceLink = document.getElementById('btnCopyLibLinceLink');
const libLinceFileInfo = document.getElementById('libLinceFileInfo');
const currentUserLabel = document.getElementById('currentUserLabel');
const redeemDurationSelect = document.getElementById('redeemDurationSelect');
const redeemCount = document.getElementById('redeemCount');
const btnGenerateRedeemKeys = document.getElementById('btnGenerateRedeemKeys');
const redeemKeysMessage = document.getElementById('redeemKeysMessage');
const redeemKeysResult = document.getElementById('redeemKeysResult');
const redeemKeysCodes = document.getElementById('redeemKeysCodes');
const redeemKeysList = document.getElementById('redeemKeysList');
const topbarTitle = document.getElementById('topbarTitle');
const topbarSubtitle = document.getElementById('topbarSubtitle');
const btnPauseKeys = document.getElementById('btnPauseKeys');
const btnPauseAllLoader = document.getElementById('btnPauseAllLoader');

let loaderAccountsData = [];

function show(el, show) {
  el.classList.toggle('hidden', !show);
}

function showMessage(el, text, isError) {
  el.textContent = text;
  el.className = 'message' + (isError ? ' error' : ' success');
  el.style.display = text ? 'block' : 'none';
}

function setStatValue(key, value) {
  document.querySelectorAll('[data-stat="' + key + '"]').forEach((el) => {
    el.textContent = value;
  });
}

function updateTopbar(tabName) {
  const tabBtn = document.querySelector('.tab[data-tab="' + tabName + '"]');
  if (!tabBtn) return;
  const title = tabBtn.dataset.title || tabBtn.textContent.trim();
  const subtitle = tabBtn.dataset.subtitle || '';
  if (topbarTitle) topbarTitle.textContent = title;
  if (topbarSubtitle) topbarSubtitle.textContent = subtitle;
}

function getActiveTabName() {
  try {
    return localStorage.getItem(STORAGE_ACTIVE_TAB) || '';
  } catch (_) {
    return '';
  }
}

function setActiveTabName(tabName) {
  try {
    if (tabName) localStorage.setItem(STORAGE_ACTIVE_TAB, tabName);
  } catch (_) {}
}

function updateCurrentUserLabel() {
  if (currentUserLabel) {
    const user = getAuth().user;
    currentUserLabel.textContent = user ? 'Logado como: ' + user : '';
  }
}

function updatePauseButton(state) {
  if (!btnPauseKeys) return;
  const paused = !!(state && state.paused);
  btnPauseKeys.textContent = paused ? 'Retomar keys' : 'Pausar keys';
  btnPauseKeys.classList.toggle('is-paused', paused);
}

function updatePauseAllButton() {
  if (!btnPauseAllLoader) return;
  const total = loaderAccountsData.length;
  if (total === 0) {
    btnPauseAllLoader.disabled = true;
    btnPauseAllLoader.textContent = 'Pausar todos';
    btnPauseAllLoader.classList.remove('is-paused');
    return;
  }
  const allPaused = loaderAccountsData.every((a) => a.paused);
  btnPauseAllLoader.disabled = false;
  btnPauseAllLoader.textContent = allPaused ? 'Retomar todos' : 'Pausar todos';
  btnPauseAllLoader.classList.toggle('is-paused', allPaused);
}

function updateLoaderOnlineCount() {
  if (!loaderOnlineCountValue) return;
  const count = (loaderAccountsData || []).filter((a) => a && a.online).length;
  loaderOnlineCountValue.textContent = String(count);
  if (loaderOnlineCountLabel) {
    loaderOnlineCountLabel.textContent = count === 1 ? 'jogador online' : 'jogadores online';
  }
}

const STORAGE_POLL_INTERVAL_MS = 5000; // Verificação contínua a cada 5s (infinito)
const STORAGE_TOAST_THROTTLE_MS = 28000; // Mostra o toast da mensagem no máximo a cada 28s

async function fetchStorageStatus() {
  try {
    const r = await fetch(API + '/api/storage');
    return await r.json().catch(() => ({}));
  } catch (_) {
    return {};
  }
}

let lastStorageToastTime = 0;
let lastStorageToastType = '';

async function checkDbConnectionFromLogin() {
  if (loginDbStatus) {
    loginDbStatus.textContent = 'A verificar…';
    loginDbStatus.className = 'login-db-status';
  }
  try {
    const data = await fetchStorageStatus();
    const isSql = data.storage === 'mysql' || data.storage === 'sql' || data.storage === 'sqlite';
    const ok = !isSql || data.dbConnected !== false;
    const storageLabel =
      data.storage === 'mysql'
        ? 'MySQL'
        : data.storage === 'sql'
          ? 'Postgres'
          : data.storage === 'sqlite'
            ? 'SQLite'
            : data.storage || '?';
    if (loginDbStatus) {
      if (ok) {
        loginDbStatus.textContent =
          'Conectado (' + storageLabel + ').' + (data.message ? ' ' + data.message : '');
        loginDbStatus.className = 'login-db-status ok';
      } else {
        const detail = [data.dbError, data.dbHint].filter(Boolean).join(' ');
        loginDbStatus.textContent = detail || 'Banco de dados não conectado.';
        loginDbStatus.className = 'login-db-status err';
      }
    }
    const toastFail =
      !ok && (data.dbError || data.dbHint)
        ? String(data.dbError || data.dbHint || '').slice(0, 120) + (String(data.dbError || '').length > 120 ? '…' : '')
        : 'Banco de dados não conectado.';
    showToast(ok ? 'Banco de dados acessível.' : toastFail, ok ? 'success' : 'error');
  } catch (_) {
    if (loginDbStatus) {
      loginDbStatus.textContent = 'Não foi possível contactar o servidor.';
      loginDbStatus.className = 'login-db-status err';
    }
    showToast('Erro ao verificar.', 'error');
  }
}

function showStorageToast(data) {
  const valid = data.storage && ['mysql', 'sql', 'sqlite', 'memory', 'blob', 'fs'].includes(data.storage);
  if (!valid) return;
  const isSql = data.storage === 'mysql' || data.storage === 'sql' || data.storage === 'sqlite';
  const dbDown = isSql && data.dbConnected === false;
  const toastKey = data.storage + (dbDown ? ':fail' : ':ok');
  const now = Date.now();
  if (now - lastStorageToastTime < STORAGE_TOAST_THROTTLE_MS && lastStorageToastType === toastKey) return;
  lastStorageToastTime = now;
  lastStorageToastType = toastKey;
  const name = data.storage === 'sqlite' ? 'SQLite' : data.storage === 'mysql' ? 'MySQL' : data.storage === 'sql' ? 'Postgres' : '';
  if (isSql && dbDown) showToast('Banco de dados não conectado.', 'error');
  else if (isSql) showToast('✓ Banco conectado' + (name ? ' (' + name + ').' : '.'), 'success');
  else if (data.storage === 'memory') showToast('⚠️ Dados em memória — configure um banco.', 'error');
}

// Verificação contínua do banco (infinito); mensagem aparece e some como notificação (toast)
async function updateLoginStorageStatus() {
  const data = await fetchStorageStatus();
  showStorageToast(data);
  return !!(data.storage && ['mysql', 'sql', 'sqlite', 'memory', 'blob', 'fs'].includes(data.storage));
}

// Polling infinito na tela de login — fica verificando sempre; para quando logar
let loginStoragePollTimer = null;
function startLoginStoragePolling() {
  if (loginStoragePollTimer) return;
  const tick = () => {
    if (panel && !panel.classList.contains('hidden')) return;
    updateLoginStorageStatus();
  };
  tick();
  loginStoragePollTimer = setInterval(tick, STORAGE_POLL_INTERVAL_MS);
}

function stopLoginStoragePolling() {
  if (loginStoragePollTimer) {
    clearInterval(loginStoragePollTimer);
    loginStoragePollTimer = null;
  }
}

async function checkStorageWarning() {
  const data = await fetchStorageStatus();
  showStorageToast(data);
  const warnEl = document.getElementById('storageWarning');
  const successEl = document.getElementById('storageSuccess');
  const dbErrEl = document.getElementById('storageDbError');
  const sqliteWarnEl = document.getElementById('storageSqliteWarning');
  const serverIdEl = document.getElementById('serverIdDisplay');
  if (warnEl && successEl) {
    const isSql = data.storage === 'mysql' || data.storage === 'sql' || data.storage === 'sqlite';
    const dbDown = isSql && data.dbConnected === false;
    if (data.storage === 'memory') {
      warnEl.classList.remove('hidden'); successEl.classList.add('hidden'); if (dbErrEl) dbErrEl.classList.add('hidden');
      if (sqliteWarnEl) sqliteWarnEl.classList.add('hidden'); if (serverIdEl) serverIdEl.classList.add('hidden');
    }
    else if (isSql) {
      if (dbDown) {
        warnEl.classList.add('hidden'); successEl.classList.add('hidden'); if (dbErrEl) dbErrEl.classList.remove('hidden');
        if (sqliteWarnEl) sqliteWarnEl.classList.add('hidden'); if (serverIdEl) serverIdEl.classList.add('hidden');
      } else {
        if (dbErrEl) dbErrEl.classList.add('hidden');
        warnEl.classList.add('hidden'); successEl.classList.add('hidden');
        if (sqliteWarnEl) sqliteWarnEl.classList.toggle('hidden', data.storage !== 'sqlite');
        if (serverIdEl && data.storage === 'sqlite' && data.serverId) { serverIdEl.textContent = 'Instância: ' + data.serverId; serverIdEl.classList.remove('hidden'); }
        else if (serverIdEl) serverIdEl.classList.add('hidden');
      }
    }
    else {
      warnEl.classList.add('hidden'); successEl.classList.add('hidden'); if (dbErrEl) dbErrEl.classList.add('hidden');
      if (sqliteWarnEl) sqliteWarnEl.classList.add('hidden'); if (serverIdEl) serverIdEl.classList.add('hidden');
    }
  }
}

const ADMIN_TAB_IDS = ['visao', 'loader', 'usuariosloader', 'gerarkey', 'keysgeradas', 'dll', 'usuarios', 'revendedores', 'renovacao'];

function getDefaultTabForRole(role) {
  if (role === 'owner') return 'visao';
  if (role === 'staff') return 'gerarkey';
  if (role === 'ajudante') return 'usuariosloader';
  return 'visao';
}

function isTabAllowedForRole(tabName) {
  if (tabName === 'revendedores') return adminPanelRole === 'owner';
  if (adminPanelRole === 'owner') return true;
  if (adminPanelRole === 'staff') return ['gerarkey', 'keysgeradas', 'renovacao'].includes(tabName);
  if (adminPanelRole === 'ajudante') return tabName === 'usuariosloader';
  return false;
}

/** Atualiza abas visíveis: dono = tudo; staff = keys; ajudante = só Usuários Loader */
function applyRoleTabsVisibility(role) {
  adminPanelRole = role || 'staff';
  const isOwnerRole = adminPanelRole === 'owner';
  const allowed = new Set();
  if (adminPanelRole === 'owner') {
    ADMIN_TAB_IDS.forEach((t) => allowed.add(t));
  } else if (adminPanelRole === 'staff') {
    ['gerarkey', 'keysgeradas', 'renovacao'].forEach((t) => allowed.add(t));
  } else if (adminPanelRole === 'ajudante') {
    allowed.add('usuariosloader');
  }
  ADMIN_TAB_IDS.forEach((name) => {
    const btn = document.querySelector('.tab[data-tab="' + name + '"]');
    if (!btn) return;
    const show = allowed.has(name) && (name !== 'revendedores' || isOwnerRole);
    btn.classList.toggle('hidden', !show);
  });
}

async function checkAuth() {
  const auth = getAuth();
  if (!auth.user || !auth.password) {
    show(loginBox, true);
    show(panel, false);
    return false;
  }
  try {
    const r = await fetchWithTimeout(API + '/api/auth/admin/verify', { headers: headers() });
    if (r.ok) {
      const vdata = await r.json().catch(() => ({}));
      applyRoleTabsVisibility(vdata.role || (vdata.isOwner ? 'owner' : 'staff'));
      stopLoaderAccountsPolling();
      stopActivityStream();
      stopLoginStoragePolling();
      show(loginBox, false);
      show(panel, true);
      updateCurrentUserLabel();
      startPresencePing();
      if (adminPanelRole === 'owner' || adminPanelRole === 'ajudante') {
        startLoaderAccountsPolling();
        loadLoaderAccounts();
      }
      if (adminPanelRole === 'owner' || adminPanelRole === 'staff') {
        startActivityStream();
      }
      if (!isTabAllowedForRole(getActiveTabName())) {
        switchTab(getDefaultTabForRole(adminPanelRole));
      }
      const storedTab = getActiveTabName();
      const storedBtn = storedTab ? document.querySelector('.tab[data-tab="' + storedTab + '"]') : null;
      if (storedBtn) {
        switchTab(storedTab);
      } else {
        const activeTab = document.querySelector('.tab.active');
        if (activeTab) {
          updateTopbar(activeTab.dataset.tab);
          if (activeTab.dataset.tab === 'usuarios') loadUsers();
          if (activeTab.dataset.tab === 'revendedores') {
            loadMercadoPagoPanelSettings();
            loadDiscordPanelSettings();
            loadResellers();
            loadResellerGeneratedKeys();
          }
          if (activeTab.dataset.tab === 'visao') loadOverviewStats();
        }
      }
      checkStorageWarning();
      fetchPauseState();
      return true;
    }
    if (r.status === 401) {
      loginError.textContent = 'Usuário ou senha incorretos.';
    } else {
      const data = await r.json().catch(() => ({}));
      loginError.textContent = data.error || 'Erro do servidor (' + r.status + '). Tente de novo.';
    }
  } catch (e) {
    loginError.textContent = e.name === 'AbortError' ? 'Demorou demais. Tente de novo.' : 'Erro de conexão. Verifique se o site está acessível e se a API está no ar.';
  }
  stopPresencePing();
  stopLoaderAccountsPolling();
  clearAuth();
  show(loginBox, true);
  show(panel, false);
  return false;
}

// Abas
function switchTab(tabName) {
  if (!isTabAllowedForRole(tabName)) {
    tabName = getDefaultTabForRole(adminPanelRole);
  }
  if (tabName === 'revendedores') {
    const revBtn = document.querySelector('.tab[data-tab="revendedores"]');
    if (revBtn && revBtn.classList.contains('hidden')) tabName = getDefaultTabForRole(adminPanelRole);
  }
  const prevActiveTab = document.querySelector('.tab.active');
  const prevTabName = prevActiveTab ? prevActiveTab.dataset.tab : '';
  if (prevTabName === 'keysgeradas' && tabName !== 'keysgeradas') {
    resetRedeemSearch();
  }
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
  const tabBtn = document.querySelector('.tab[data-tab="' + tabName + '"]');
  const pane = document.getElementById('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
  if (tabBtn) {
    tabBtn.classList.add('active');
    tabBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
  if (pane) pane.classList.add('active');
  updateTopbar(tabName);
  setActiveTabName(tabName);
  if (tabName === 'visao') loadOverviewStats();
  if (tabName === 'loader') loadLoaderAccounts();
  if (tabName === 'usuariosloader') {
    loadLoaderAccounts().then(() => renderLoaderAccountsListUsuarios());
  }
  if (tabName === 'dll') {
    loadLoaderProductFlagsPanel();
    loadDllInfo();
    loadDllInfo('matadorfx');
    loadDllInfo('nextmenu');
    loadDllInfo('fatalyplay');
    loadDllInfo('freefireindia');
    loadDllInfo('freefireplay');
    loadDllInfo('liblince');
  }
  if (tabName === 'keysgeradas') {
    loadRedeemKeysList();
    fetchPauseState();
  }
  if (tabName === 'renovacao') loadRenewKeysList();
  if (tabName === 'usuarios') {
    updateCurrentUserLabel();
    loadUsers();
  }
  if (tabName === 'revendedores') {
    loadMercadoPagoPanelSettings();
    loadDiscordPanelSettings();
    loadResellers();
    loadResellerGeneratedKeys();
  }
}

function showMpPanelMessage(text, isError) {
  if (!mpPanelMessage) return;
  mpPanelMessage.textContent = text;
  mpPanelMessage.className = 'message' + (isError ? ' error' : ' success');
  mpPanelMessage.style.display = text ? 'block' : 'none';
}

async function loadMercadoPagoPanelSettings() {
  if (!mpPanelPayerEmail) return;
  showMpPanelMessage('');
  try {
    const r = await fetchWithTimeout(API + '/api/mercadopago-settings', { headers: headers() });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return;
    mpPanelPayerEmail.value = data.payerEmail || '';
    if (mpPanelAccessToken) mpPanelAccessToken.value = '';
    if (mpPanelClearToken) mpPanelClearToken.checked = false;
    if (mpPanelStatus) {
      const parts = [];
      if (data.tokenConfigured) parts.push('Há um token guardado no painel.');
      else parts.push('Nenhum token no painel.');
      if (data.envHasToken) parts.push('Variável MERCADOPAGO_ACCESS_TOKEN no servidor está definida (fallback).');
      mpPanelStatus.textContent = parts.join(' ');
    }
  } catch (_) {
    if (mpPanelStatus) mpPanelStatus.textContent = 'Não foi possível carregar as definições.';
  }
}

function showDiscordPanelMessage(text, isError) {
  if (!discordPanelMessage) return;
  discordPanelMessage.textContent = text;
  discordPanelMessage.className = 'message' + (isError ? ' error' : ' success');
  discordPanelMessage.style.display = text ? 'block' : 'none';
}

function discordPanelHasAnyUrl(c) {
  if (!c) return false;
  return !!(String(c.keyGenerated || '').trim() ||
    String(c.keyDeleted || '').trim() ||
    String(c.resellerPayment || '').trim() ||
    String(c.fallback || '').trim());
}

function clearDiscordWebhookInputs() {
  if (discordWebhookKeyGenerated) discordWebhookKeyGenerated.value = '';
  if (discordWebhookKeyDeleted) discordWebhookKeyDeleted.value = '';
  if (discordWebhookResellerPayment) discordWebhookResellerPayment.value = '';
  if (discordWebhookFallback) discordWebhookFallback.value = '';
}

function fillDiscordWebhookInputsFromCache() {
  if (!discordPanelCache) return;
  if (discordWebhookKeyGenerated) discordWebhookKeyGenerated.value = discordPanelCache.keyGenerated || '';
  if (discordWebhookKeyDeleted) discordWebhookKeyDeleted.value = discordPanelCache.keyDeleted || '';
  if (discordWebhookResellerPayment) discordWebhookResellerPayment.value = discordPanelCache.resellerPayment || '';
  if (discordWebhookFallback) discordWebhookFallback.value = discordPanelCache.fallback || '';
}

function updateDiscordWebhookPanelStatusText() {
  if (!discordWebhookPanelStatus) return;
  const c = discordPanelCache || {};
  const rows = [
    ['Keys geradas', String(c.keyGenerated || '').trim()],
    ['Keys apagadas', String(c.keyDeleted || '').trim()],
    ['Recarga PIX', String(c.resellerPayment || '').trim()],
    ['URL única', String(c.fallback || '').trim()],
  ];
  const parts = rows.map(function (row) {
    return row[0] + ': ' + (row[1] ? 'guardado (URL oculta)' : '—');
  });
  discordWebhookPanelStatus.textContent =
    'Webhooks guardados no painel. ' + parts.join(' · ');
}

function syncDiscordWebhookPanelUi() {
  const editing = !discordWebhooksUiCollapsed;
  if (discordWebhookEditArea) discordWebhookEditArea.classList.toggle('hidden', !editing);
  if (discordWebhookSavedSummary) discordWebhookSavedSummary.classList.toggle('hidden', editing);
  if (editing) {
    fillDiscordWebhookInputsFromCache();
  } else {
    clearDiscordWebhookInputs();
  }
  if (!editing) updateDiscordWebhookPanelStatusText();
}

async function loadDiscordPanelSettings() {
  if (!discordWebhookKeyGenerated) return;
  showDiscordPanelMessage('');
  try {
    const r = await fetchWithTimeout(API + '/api/discord-webhook-settings', { headers: headers(), cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return;
    discordPanelCache = {
      keyGenerated: data.keyGenerated || '',
      keyDeleted: data.keyDeleted || '',
      resellerPayment: data.resellerPayment || '',
      fallback: data.fallback || '',
    };
    discordWebhooksUiCollapsed = discordPanelHasAnyUrl(discordPanelCache);
    syncDiscordWebhookPanelUi();
  } catch (_) {
    showDiscordPanelMessage('Não foi possível carregar as URLs do Discord.', true);
  }
}

async function saveDiscordPanelSettings() {
  showDiscordPanelMessage('');
  if (!discordWebhookKeyGenerated) return;
  const body = {
    keyGenerated: (discordWebhookKeyGenerated.value || '').trim(),
    keyDeleted: discordWebhookKeyDeleted ? (discordWebhookKeyDeleted.value || '').trim() : '',
    resellerPayment: discordWebhookResellerPayment ? (discordWebhookResellerPayment.value || '').trim() : '',
    fallback: discordWebhookFallback ? (discordWebhookFallback.value || '').trim() : '',
  };
  try {
    const r = await fetchWithTimeout(API + '/api/discord-webhook-settings', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showDiscordPanelMessage(data.error || 'Erro ao guardar.', true);
      return;
    }
    discordPanelCache = {
      keyGenerated: body.keyGenerated,
      keyDeleted: body.keyDeleted,
      resellerPayment: body.resellerPayment,
      fallback: body.fallback,
    };
    discordWebhooksUiCollapsed = discordPanelHasAnyUrl(discordPanelCache);
    syncDiscordWebhookPanelUi();
    showDiscordPanelMessage('Webhooks do Discord guardados.', false);
  } catch (e) {
    showDiscordPanelMessage('Erro de conexão.', true);
  }
}

async function saveMercadoPagoPanelSettings() {
  showMpPanelMessage('');
  if (!mpPanelPayerEmail) return;
  const body = { payerEmail: (mpPanelPayerEmail.value || '').trim() };
  if (mpPanelClearToken && mpPanelClearToken.checked) {
    body.clearToken = true;
  } else if (mpPanelAccessToken && mpPanelAccessToken.value.trim()) {
    body.accessToken = mpPanelAccessToken.value.trim();
  }
  try {
    const r = await fetchWithTimeout(API + '/api/mercadopago-settings', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showMpPanelMessage(data.error || 'Erro ao guardar.', true);
      return;
    }
    showMpPanelMessage(data.mpActive ? 'Guardado. PIX pode ser usado pelos revendedores.' : 'Guardado. Ainda falta um Access Token (painel ou servidor).', !data.mpActive);
    if (mpPanelAccessToken) mpPanelAccessToken.value = '';
    if (mpPanelClearToken) mpPanelClearToken.checked = false;
    if (mpPanelStatus) {
      const parts = [];
      if (data.tokenConfigured) parts.push('Há um token guardado no painel.');
      else parts.push('Nenhum token no painel.');
      parts.push(data.mpActive ? 'Mercado Pago ativo.' : 'Mercado Pago ainda sem token.');
      mpPanelStatus.textContent = parts.join(' ');
    }
  } catch (e) {
    showMpPanelMessage('Erro de conexão.', true);
  }
}

async function loadLoaderProductFlagsPanel() {
  if (!loaderFlag0 || !loaderFlag1 || !loaderFlag2) return;
  loaderProductFlagsPanelReady = false;
  loaderFlag0.disabled = loaderFlag1.disabled = loaderFlag2.disabled = true;
  try {
    const r = await fetchWithTimeout(API + '/api/loader/product-flags');
    const data = await r.json();
    if (!r.ok) throw new Error('bad status');
    loaderFlag0.checked = data['0'] !== false;
    loaderFlag1.checked = data['1'] !== false;
    loaderFlag2.checked = data['2'] !== false;
    loaderFlag0.disabled = loaderFlag1.disabled = loaderFlag2.disabled = false;
    loaderProductFlagsPanelReady = true;
    if (loaderProductFlagsMessage) loaderProductFlagsMessage.textContent = '';
  } catch (_) {
    if (loaderProductFlagsMessage) loaderProductFlagsMessage.textContent = 'Não foi possível carregar as versões do injector.';
  }
}

async function saveLoaderProductFlagsFromPanel() {
  if (!loaderProductFlagsPanelReady || !loaderFlag0 || !loaderFlag1 || !loaderFlag2) return;
  try {
    const body = { '0': !!loaderFlag0.checked, '1': !!loaderFlag1.checked, '2': !!loaderFlag2.checked };
    const r = await fetchWithTimeout(API + '/api/loader/product-flags', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (loaderProductFlagsMessage) loaderProductFlagsMessage.textContent = data.error || 'Erro ao salvar.';
      return;
    }
    if (loaderProductFlagsMessage) loaderProductFlagsMessage.textContent = 'Salvo. Downloads e injectors passam a respeitar.';
    setTimeout(() => {
      if (loaderProductFlagsMessage) loaderProductFlagsMessage.textContent = '';
    }, 5000);
  } catch (_) {
    if (loaderProductFlagsMessage) loaderProductFlagsMessage.textContent = 'Erro de rede ao salvar.';
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(sec) {
  if (!sec) return 'Permanente';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (d > 0) parts.push(d + ' dia(s)');
  if (h > 0) parts.push(h + ' h');
  if (m > 0) parts.push(m + ' min');
  if (s > 0 || parts.length === 0) parts.push(s + ' s');
  return parts.join(', ');
}

const ACTIVITY_LIMIT = 60;
const ACTIVITY_STREAM_RETRY_MS = 4000;

let activityCache = [];
let activityStreamAbort = null;
let activityStreamRetryTimer = null;

function setActivityItems(items) {
  const next = Array.isArray(items) ? items.slice(0, ACTIVITY_LIMIT) : [];
  activityCache = next;
  if (activityList) renderActivityList(activityCache);
}

function upsertActivity(item) {
  if (!item || !item.id) return;
  if (activityCache.some((a) => a && a.id === item.id)) return;
  activityCache.unshift(item);
  if (activityCache.length > ACTIVITY_LIMIT) activityCache.length = ACTIVITY_LIMIT;
  if (activityList) renderActivityList(activityCache);
}

async function postActivity(title, detail, actor) {
  const auth = getAuth();
  if (!auth.user || !auth.password) return;
  try {
    const r = await fetchWithTimeout(API + '/api/activity', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ title, detail, actor }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data && data.item) {
      upsertActivity(data.item);
    }
  } catch (_) {}
}

function addActivity(title, detail, actor) {
  postActivity(title, detail, actor);
}

function stopActivityStream() {
  if (activityStreamAbort) {
    activityStreamAbort.abort();
    activityStreamAbort = null;
  }
  if (activityStreamRetryTimer) {
    clearTimeout(activityStreamRetryTimer);
    activityStreamRetryTimer = null;
  }
}

function scheduleActivityStreamRetry() {
  if (activityStreamRetryTimer) return;
  activityStreamRetryTimer = setTimeout(() => {
    activityStreamRetryTimer = null;
    startActivityStream();
  }, ACTIVITY_STREAM_RETRY_MS);
}

function handleActivityStreamChunk(chunk) {
  if (!chunk) return;
  const lines = chunk.replace(/\r/g, '').split('\n');
  let eventName = 'message';
  const dataLines = [];
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return;
  const payload = dataLines.join('\n');
  let data = null;
  try {
    data = JSON.parse(payload);
  } catch (_) {
    return;
  }
  if (eventName === 'activity-init') {
    setActivityItems(data && data.items ? data.items : data);
  } else if (eventName === 'activity') {
    upsertActivity(data);
  }
}

async function startActivityStream() {
  if (!activityList) return;
  const auth = getAuth();
  if (!auth.user || !auth.password) return;
  if (activityStreamAbort) return;
  const ctrl = new AbortController();
  activityStreamAbort = ctrl;
  try {
    const r = await fetch(API + '/api/activity/stream', {
      headers: headers(),
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!r.ok || !r.body) throw new Error('stream');
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleActivityStreamChunk(chunk);
        idx = buffer.indexOf('\n\n');
      }
    }
  } catch (e) {
    if (!ctrl.signal.aborted) scheduleActivityStreamRetry();
  } finally {
    if (activityStreamAbort === ctrl) activityStreamAbort = null;
  }
}
function updateKeysCount() {
  const n = loaderAccountsData.length;
  if (keysCount) {
    keysCount.textContent = n === 1 ? '1 conta' : n + ' contas';
  }
  setStatValue('loader-count', n);
  updatePauseAllButton();
}

async function loadOverviewStats() {
  setStatValue('loader-count', loaderAccountsData.length);
  try {
    const r = await fetchWithTimeout(API + '/api/redeem-keys', { headers: headers() });
    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      const keys = data.keys || [];
      setStatValue('redeem-count', keys.length);
    }
  } catch (_) {}
  if (adminPanelRole === 'owner') {
    try {
      const r = await fetchWithTimeout(API + '/api/users', { headers: headers() });
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        const users = data.users || [];
        setStatValue('users-count', users.length);
      }
    } catch (_) {}
  }
  loadRecentActivity();
}

function renderActivityList(items) {
  if (!activityList) return;
  if (!items || items.length === 0) {
    activityList.innerHTML = '<div class="activity-item"><span class="activity-dot"></span><div><strong>Nenhuma atividade recente</strong><p class="activity-time">Assim que ocorrerem acoes, elas aparecerao aqui.</p></div></div>';
    return;
  }
  activityList.innerHTML = items.map((a) => {
    const title = escapeHtml(a.title || 'Atividade');
    const detail = escapeHtml(a.detail || '');
    const actor = escapeHtml((a.actor || a.user || a.username || '').trim() || 'Sistema');
    const time = a.createdAt ? formatDate(a.createdAt) : '';
    const detailHtml = detail ? '<p class="activity-detail">' + detail + '</p>' : '';
    const meta = 'por ' + actor + (time ? ' - ' + escapeHtml(time) : '');
    const timeHtml = '<p class="activity-time">' + meta + '</p>';
    return ('<div class="activity-item">' +
      '<span class="activity-dot"></span>' +
      '<div>' +
      '<strong>' + title + '</strong>' +
      detailHtml +
      timeHtml +
      '</div>' +
      '</div>');
  }).join('');
}

async function loadRecentActivity() {
  if (!activityList) return;
  try {
    const r = await fetchWithTimeout(API + '/api/activity', { headers: headers(), cache: 'no-store' });
    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      const items = Array.isArray(data && data.items) ? data.items : Array.isArray(data) ? data : [];
      setActivityItems(items);
      return;
    }
  } catch (_) {}
  if (activityCache.length) {
    renderActivityList(activityCache);
  } else {
    renderActivityList([]);
  }
}
async function fetchPauseState() {
  if (!btnPauseKeys) return;
  try {
    const r = await fetchWithTimeout(API + '/api/keys/pause', { headers: headers() });
    if (!r.ok) return;
    const data = await r.json().catch(() => ({}));
    updatePauseButton(data);
  } catch (_) {}
}

async function togglePauseKeys() {
  if (!btnPauseKeys) return;
  try {
    const r = await fetchWithTimeout(API + '/api/keys/pause', { method: 'POST', headers: headers() });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      updatePauseButton(data);
      showToast(data.paused ? 'Keys pausadas.' : 'Keys retomadas.', 'success');
      addActivity(data.paused ? 'Keys pausadas' : 'Keys retomadas', 'Sistema de keys');
    } else {
      showToast(data.error || 'Erro ao pausar keys.', 'error');
    }
  } catch (_) {
    showToast('Erro de conexão.', 'error');
  }
}

async function togglePauseAllLoader() {
  if (!btnPauseAllLoader) return;
  const allPaused = loaderAccountsData.length > 0 && loaderAccountsData.every((a) => a.paused);
  const nextPaused = !allPaused;
  try {
    const r = await fetchWithTimeout(API + '/api/loader-accounts/pause-all', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ paused: nextPaused }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      if (Array.isArray(data.accounts)) {
        loaderAccountsData = data.accounts;
        updateKeysCount();
        updateLoaderOnlineCount();
        renderLoaderAccountsList();
        if (loaderAccountsListUsuarios) renderLoaderAccountsListUsuarios();
      } else {
        loadLoaderAccounts();
      }
      showToast(nextPaused ? 'Contas pausadas.' : 'Contas retomadas.', 'success');
      addActivity(nextPaused ? 'Contas loader pausadas' : 'Contas loader retomadas', loaderAccountsData.length + ' conta(s)');
    } else {
      showToast(data.error || 'Erro ao pausar contas.', 'error');
    }
  } catch (_) {
    showToast('Erro de conexÃ£o.', 'error');
  }
}

function showLoaderMessage(text, isError) {
  if (!loaderMessage) return;
  loaderMessage.textContent = text;
  loaderMessage.className = 'message' + (isError ? ' error' : ' success');
  loaderMessage.style.display = text ? 'block' : 'none';
}

async function loadLoaderAccounts() {
  try {
    const r = await fetchWithTimeout(API + '/api/loader-accounts?_=' + Date.now(), { headers: headers(), cache: 'no-store' });
    if (!r.ok) return;
    const data = await r.json();
    loaderAccountsData = data.accounts || [];
    updateKeysCount();
    updateLoaderOnlineCount();
    renderLoaderAccountsList();
    const activeTab = document.querySelector('.tab.active');
    if (activeTab && activeTab.dataset.tab === 'usuariosloader') renderLoaderAccountsListUsuarios();
  } catch (_) {
    if (loaderAccountsList) loaderAccountsList.innerHTML = '<p class="empty">Erro ao carregar.</p>';
  }
}

function renderLoaderAccountsList() {
  if (!loaderAccountsList) return;
  const list = loaderAccountsData;
  if (list.length === 0) {
    loaderAccountsList.innerHTML = '<p class="empty">Nenhuma conta do loader. Crie um login acima.</p>';
    return;
  }
  loaderAccountsList.innerHTML = list
    .map(
      (a) => `
    <div class="key-item">
      <div>
        <div class="id">${escapeHtml(a.username)} ${a.skipHwidCheck ? '<span class="badge-skip-hwid">Sem HWID</span>' : ''} ${a.paused ? '<span class="badge-paused">Pausado</span>' : ''}</div>
        <div class="meta">
          HWID: ${a.hwid ? '<code class="hwid-short">' + escapeHtml(a.hwid.length > 40 ? a.hwid.slice(0, 40) + '…' : a.hwid) + '</code>' : '— (ainda não logou)'}
          ${a.expiresAt ? ' · Expira: ' + formatDate(a.expiresAt) : ' · Permanente'} · Status: ${a.paused ? 'Pausada' : 'Ativa'}
        </div>
      </div>
      <div class="actions">
        ${a.hwid && !a.skipHwidCheck ? '<button type="button" class="btn-reset-hwid" data-username="' + escapeHtml(a.username) + '">Reset HWID</button>' : ''}
        <button type="button" class="btn-pause-key btn-pause-loader${a.paused ? ' is-paused' : ''}" data-username="${escapeHtml(a.username)}">${a.paused ? 'Retomar' : 'Pausar'}</button>
        <button type="button" class="danger btn-remove-loader" data-username="${escapeHtml(a.username)}">Remover</button>
      </div>
    </div>
  `
    )
    .join('');
  loaderAccountsList.querySelectorAll('.btn-reset-hwid').forEach((btn) => {
    btn.addEventListener('click', () => resetLoaderHwid(btn.dataset.username));
  });
  loaderAccountsList.querySelectorAll('.btn-pause-loader').forEach((btn) => {
    btn.addEventListener('click', () => toggleLoaderPause(btn.dataset.username));
  });
  loaderAccountsList.querySelectorAll('.btn-remove-loader').forEach((btn) => {
    btn.addEventListener('click', () => removeLoaderAccount(btn.dataset.username));
  });
}

let lastBuscarFilterUsuarios = '';
let lastBuscarRedeemFilter = '';
let lastBuscarRedeemFilterRaw = '';
let renewKeysCache = [];
const RENEW_ALERT_DAYS = 7;

function renderLoaderAccountsListUsuarios(searchFilter) {
  if (!loaderAccountsListUsuarios) return;
  if (searchFilter !== undefined) lastBuscarFilterUsuarios = (searchFilter || '').trim().toLowerCase();
  const filter = lastBuscarFilterUsuarios;
  const list = filter
    ? loaderAccountsData.filter((a) => a.username && a.username.toLowerCase().includes(filter))
    : loaderAccountsData;
  if (list.length === 0) {
    loaderAccountsListUsuarios.innerHTML =
      filter
        ? '<p class="empty">Nenhuma conta encontrada para "' + escapeHtml(filter) + '".</p>'
        : '<p class="empty">Nenhuma conta do loader. Crie um login na aba Contas loader.</p>';
    return;
  }
  loaderAccountsListUsuarios.innerHTML = list
    .map((a) => {
      const removeBtnUsuarios =
        adminPanelRole === 'owner'
          ? '<button type="button" class="danger btn-remove-loader" data-username="' +
            escapeHtml(a.username) +
            '">Remover</button>'
          : '';
      return (
        `
    <div class="key-item">
      <div>
        <div class="id">${escapeHtml(a.username)} ${a.skipHwidCheck ? '<span class="badge-skip-hwid">Sem HWID</span>' : ''} ${a.paused ? '<span class="badge-paused">Pausado</span>' : ''}</div>
        <div class="meta">
          HWID: ${a.hwid ? '<code class="hwid-short">' + escapeHtml(a.hwid.length > 40 ? a.hwid.slice(0, 40) + '…' : a.hwid) + '</code>' : '— (ainda não logou)'}
          ${a.expiresAt ? ' · Expira: ' + formatDate(a.expiresAt) : ' · Permanente'} · Status: ${a.paused ? 'Pausada' : 'Ativa'}
        </div>
      </div>
      <div class="actions">
        ${a.hwid && !a.skipHwidCheck ? '<button type="button" class="btn-reset-hwid" data-username="' + escapeHtml(a.username) + '">Reset HWID</button>' : ''}
        <button type="button" class="btn-pause-key btn-pause-loader${a.paused ? ' is-paused' : ''}" data-username="${escapeHtml(a.username)}">${a.paused ? 'Retomar' : 'Pausar'}</button>
        ${removeBtnUsuarios}
      </div>
    </div>
  `
      );
    })
    .join('');
  loaderAccountsListUsuarios.querySelectorAll('.btn-reset-hwid').forEach((btn) => {
    btn.addEventListener('click', () => resetLoaderHwid(btn.dataset.username));
  });
  loaderAccountsListUsuarios.querySelectorAll('.btn-pause-loader').forEach((btn) => {
    btn.addEventListener('click', () => toggleLoaderPause(btn.dataset.username));
  });
  loaderAccountsListUsuarios.querySelectorAll('.btn-remove-loader').forEach((btn) => {
    btn.addEventListener('click', () => removeLoaderAccount(btn.dataset.username));
  });
}

async function addLoaderAccount() {
  const username = (loaderUsername && loaderUsername.value || '').trim();
  const password = (loaderPassword && loaderPassword.value || '').trim();
  const expiresInDays = parseInt(loaderExpiresDays && loaderExpiresDays.value, 10) || 0;
  const skipHwidCheck = loaderSkipHwid && loaderSkipHwid.checked;

  if (!username || !password) {
    showLoaderMessage('Preencha usuário e senha.', true);
    return;
  }
  showLoaderMessage('');
  try {
    const r = await fetchWithTimeout(API + '/api/loader-accounts', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ username, password, expiresInDays, skipHwidCheck }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      showLoaderMessage('Login "' + username + '" criado.' + (skipHwidCheck ? ' (Sem verificação HWID)' : ''), false);
      showToast('Login criado com sucesso!', 'success');
      const expiresLabel = expiresInDays === 0 ? 'permanente' : expiresInDays + ' dia(s)';
      addActivity('Conta loader criada', username + ' - ' + expiresLabel);
      loaderUsername.value = '';
      loaderPassword.value = '';
      if (Array.isArray(data.accounts)) {
        loaderAccountsData = data.accounts;
        updateKeysCount();
        renderLoaderAccountsList();
      } else loadLoaderAccounts();
    } else {
      showLoaderMessage(data.error || 'Erro ao criar.', true);
    }
  } catch (e) {
    showLoaderMessage(e.name === 'AbortError' ? 'Demorou demais.' : 'Erro de conexão.', true);
  }
}

async function resetLoaderHwid(username) {
  showConfirmToast('Resetar HWID de "' + username + '"? A pessoa poderá logar de outro PC.', async () => {
    try {
      const r = await fetch(API + '/api/loader-accounts/' + encodeURIComponent(username) + '/reset-hwid', { method: 'POST', headers: headers() });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        loadLoaderAccounts();
        showToast('HWID resetado.', 'success');
        addActivity('HWID resetado', username);
      } else {
        showToast(data.error || 'Erro.', 'error');
      }
    } catch (e) {
      showToast('Erro de conexão.', 'error');
    }
  });
}

async function toggleLoaderPause(username) {
  try {
    const r = await fetch(API + '/api/loader-accounts/' + encodeURIComponent(username) + '/pause', { method: 'POST', headers: headers() });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      if (Array.isArray(data.accounts)) {
        loaderAccountsData = data.accounts;
        updateKeysCount();
        renderLoaderAccountsList();
        if (loaderAccountsListUsuarios) renderLoaderAccountsListUsuarios();
      } else {
        loadLoaderAccounts();
      }
      showToast(data.paused ? 'Conta pausada.' : 'Conta retomada.', 'success');
      addActivity(data.paused ? 'Conta loader pausada' : 'Conta loader retomada', username);
    } else {
      showToast(data.error || 'Erro ao pausar conta.', 'error');
    }
  } catch (e) {
    showToast('Erro de conexao.', 'error');
  }
}

async function removeLoaderAccount(username) {
  showConfirmToast('Remover a conta "' + username + '"?', async () => {
    try {
      const r = await fetch(API + '/api/loader-accounts/' + encodeURIComponent(username), { method: 'DELETE', headers: headers() });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        if (Array.isArray(data.accounts)) {
          loaderAccountsData = data.accounts;
          updateKeysCount();
          updateLoaderOnlineCount();
          renderLoaderAccountsList();
        } else loadLoaderAccounts();
        showToast('Conta removida.', 'success');
        addActivity('Conta loader removida', username);
      } else {
        showToast(data.error || 'Erro ao remover.', 'error');
      }
    } catch (e) {
      showToast('Erro de conexão.', 'error');
    }
  });
}

function showRedeemKeysMessage(text, isError) {
  if (!redeemKeysMessage) return;
  redeemKeysMessage.textContent = text;
  redeemKeysMessage.className = 'message' + (isError ? ' error' : ' success');
  redeemKeysMessage.style.display = text ? 'block' : 'none';
}

async function generateRedeemKeys() {
  const durationSelectEl = redeemDurationSelect;
  const countEl = redeemCount;
  const sec = parseInt(durationSelectEl && durationSelectEl.value, 10) || 0;
  const count = Math.min(100, Math.max(1, parseInt(countEl && countEl.value, 10) || 1));
  showRedeemKeysMessage('');
  if (redeemKeysResult) redeemKeysResult.classList.add('hidden');
  try {
    const r = await fetchWithTimeout(API + '/api/redeem-keys', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ expiresInSeconds: sec, count }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.codes && data.codes.length) {
      showRedeemKeysMessage(count === 1 ? '1 key gerada.' : data.codes.length + ' keys geradas.', false);
      if (redeemKeysCodes) {
        redeemKeysCodes.innerHTML = data.codes
          .map(
            (c) =>
              '<div class="redeem-code-line">' +
              '<code class="redeem-code">' + escapeHtml(c) + '</code>' +
              '<button type="button" class="btn-copy-code" data-code="' + escapeHtml(c) + '" title="Copiar">Copiar</button>' +
              '</div>'
          )
          .join('');
        redeemKeysCodes.querySelectorAll('.btn-copy-code').forEach((btn) => {
          btn.addEventListener('click', () => {
            const code = btn.dataset.code;
            if (code) {
              navigator.clipboard.writeText(code).then(
                () => showToast('Código copiado!', 'success'),
                () => showToast('Não foi possível copiar.', 'error')
              );
            }
          });
        });
      }
      if (redeemKeysResult) redeemKeysResult.classList.remove('hidden');
      showToast('Keys geradas com sucesso!', 'success');
      addActivity('Keys geradas', count + ' key(s) - ' + formatDuration(sec));
      loadRedeemKeysList();
      loadResellerGeneratedKeys();
    } else {
      showRedeemKeysMessage(data.error || 'Erro ao gerar keys.', true);
    }
  } catch (e) {
    showRedeemKeysMessage(e.name === 'AbortError' ? 'Demorou demais. Tente de novo.' : 'Erro de conexão.', true);
  }
}

async function loadRedeemKeysList() {
  if (!redeemKeysList) return;
  try {
    const r = await fetch(API + '/api/redeem-keys', { headers: headers() });
    if (!r.ok) {
      redeemKeysList.innerHTML = '<p class="empty">Erro ao carregar.</p>';
      return;
    }
    const data = await r.json();
    const keys = data.keys || [];
    const filter = lastBuscarRedeemFilter || '';
    const filterLabel = lastBuscarRedeemFilterRaw || '';
    const statusFilter = redeemStatusFilter ? redeemStatusFilter.value : 'all';
    const now = Date.now();
    const isActivated = (k) => k.usedAt && k.usedBy;
    const isExpired = (k) => {
      const sec = parseInt(k.expiresInSeconds || 0, 10);
      if (!sec) return false;
      if (!k.usedAt) return false;
      const started = new Date(k.usedAt).getTime();
      if (Number.isNaN(started)) return false;
      return started + sec * 1000 <= now;
    };
    const isAvailable = (k) => !isActivated(k) && !isExpired(k) && !k.paused;
    let filteredKeys = filter
      ? keys.filter((k) => {
          const code = String(k.code || '').toLowerCase();
          const usedBy = String(k.usedBy || '').toLowerCase();
          return code.includes(filter) || usedBy.includes(filter);
        })
      : keys;
    if (statusFilter === 'reseller') {
      filteredKeys = filteredKeys.filter((k) => !!k.createdByReseller);
    } else if (statusFilter === 'activated') {
      filteredKeys = filteredKeys.filter(isActivated);
    } else if (statusFilter === 'expired') {
      filteredKeys = filteredKeys.filter(isExpired);
    } else if (statusFilter === 'available') {
      filteredKeys = filteredKeys.filter(isAvailable);
    }
    if (keys.length === 0) {
      redeemKeysList.innerHTML = '<p class="empty">Nenhuma key gerada ainda. Gere na aba Chaves.</p>';
      setStatValue('redeem-count', 0);
      return;
    }
    setStatValue('redeem-count', keys.length);
    if (filter && filteredKeys.length === 0) {
      redeemKeysList.innerHTML = '<p class="empty">Nenhuma key encontrada para "' + escapeHtml(filterLabel || filter) + '".</p>';
      return;
    }
    if (!filter && statusFilter !== 'all' && filteredKeys.length === 0) {
      const label =
        statusFilter === 'activated'
          ? 'ativada'
          : statusFilter === 'expired'
            ? 'expirada'
            : statusFilter === 'available'
              ? 'disponível'
              : statusFilter === 'reseller'
                ? 'de revendedor'
                : 'neste filtro';
      redeemKeysList.innerHTML = '<p class="empty">Nenhuma key ' + label + '.</p>';
      return;
    }
    redeemKeysList.innerHTML = filteredKeys
      .map((k) => {
        const used = isActivated(k);
        const paused = !!k.paused;
        const expired = isExpired(k);
        const status = used
          ? 'Resgatada por <strong>' + escapeHtml(k.usedBy) + '</strong> em ' + formatDate(k.usedAt) + (expired ? ' — Expirada' : '')
          : paused ? 'Pausada' : 'Disponível';
        const origin =
          k.createdByReseller
            ? 'Origem: revendedor <strong>' + escapeHtml(k.createdByReseller) + '</strong>'
            : 'Origem: painel admin';
        const durationLabel = formatDuration(k.expiresInSeconds || 0);
        const pauseLabel = paused ? 'Retomar' : 'Pausar';
        const pauseClass = 'btn-pause-key' + (paused ? ' is-paused' : '');
        const resetHwidBtn =
          used && k.usedBy
            ? '<button type="button" class="btn-secondary btn-reset-hwid-redeem" data-username="' +
              escapeHtml(k.usedBy) +
              '" title="Resetar HWID da conta loader com este usuário (se existir)">Reset HWID</button>'
            : '';
        return (
          '<div class="key-item ' + ((used || expired) ? 'invalid' : '') + '">' +
          '<div>' +
          '<div class="id"><code class="redeem-code-inline">' + escapeHtml(k.code) + '</code></div>' +
          '<div class="meta">' +
          origin +
          ' · ' +
          escapeHtml(durationLabel) +
          ' · Criada: ' +
          formatDate(k.createdAt) +
          '</div>' +
          '<div class="meta redeem-status-line">' +
          status +
          '</div>' +
          '</div>' +
          '<div class="actions">' +
          '<button type="button" class="btn-copy-code" data-code="' + escapeHtml(k.code) + '" title="Copiar código">Copiar</button>' +
          resetHwidBtn +
          '<button type="button" class="danger btn-delete-redeem" data-code="' + escapeHtml(k.code) + '" title="Excluir key">Excluir</button>' +
          '<button type="button" class="' + pauseClass + '" data-code="' + escapeHtml(k.code) + '" title="Pausar ou retomar key">' + pauseLabel + '</button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
    redeemKeysList.querySelectorAll('.btn-copy-code').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code;
        if (code) {
          navigator.clipboard.writeText(code).then(
            () => showToast('Código copiado!', 'success'),
            () => showToast('Não foi possível copiar.', 'error')
          );
        }
      });
    });
    redeemKeysList.querySelectorAll('.btn-pause-key').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code;
        if (code) toggleRedeemKeyPause(code);
      });
    });
    redeemKeysList.querySelectorAll('.btn-delete-redeem').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code;
        if (code) deleteRedeemKey(code);
      });
    });
    redeemKeysList.querySelectorAll('.btn-reset-hwid-redeem').forEach((btn) => {
      btn.addEventListener('click', () => {
        const u = (btn.dataset.username || '').trim();
        if (u) resetLoaderHwid(u);
      });
    });
  } catch (e) {
    redeemKeysList.innerHTML = '<p class="empty">Erro de conexão.</p>';
  }
}

async function loadResellerGeneratedKeys() {
  if (!resellerGeneratedKeysList) return;
  try {
    const r = await fetch(API + '/api/redeem-keys', { headers: headers(), cache: 'no-store' });
    if (!r.ok) {
      resellerGeneratedKeysList.innerHTML = '<p class="empty">Erro ao carregar.</p>';
      return;
    }
    const data = await r.json();
    const keys = (data.keys || []).filter((k) => !!k.createdByReseller);
    const now = Date.now();
    const isActivated = (k) => k.usedAt && k.usedBy;
    const isExpired = (k) => {
      const sec = parseInt(k.expiresInSeconds || 0, 10);
      if (!sec || !k.usedAt) return false;
      const started = new Date(k.usedAt).getTime();
      if (Number.isNaN(started)) return false;
      return started + sec * 1000 <= now;
    };
    if (keys.length === 0) {
      resellerGeneratedKeysList.innerHTML = '<p class="empty">Nenhuma key gerada por revendedores ainda.</p>';
      return;
    }
    resellerGeneratedKeysList.innerHTML = keys
      .map((k) => {
        const used = isActivated(k);
        const paused = !!k.paused;
        const expired = isExpired(k);
        const status = used
          ? 'Resgatada por <strong>' +
            escapeHtml(k.usedBy) +
            '</strong> em ' +
            formatDate(k.usedAt) +
            (expired ? ' — Expirada' : '')
          : paused
            ? 'Pausada'
            : 'Disponível';
        const durationLabel = formatDuration(k.expiresInSeconds || 0);
        const pauseLabel = paused ? 'Retomar' : 'Pausar';
        const pauseClass = 'btn-pause-key' + (paused ? ' is-paused' : '');
        const resetHwidBtn =
          used && k.usedBy
            ? '<button type="button" class="btn-secondary btn-reset-hwid-reseller-tab" data-username="' +
              escapeHtml(k.usedBy) +
              '">Reset HWID</button>'
            : '';
        return (
          '<div class="key-item ' + ((used || expired) ? 'invalid' : '') + '">' +
          '<div>' +
          '<div class="id"><code class="redeem-code-inline">' +
          escapeHtml(k.code) +
          '</code> <span class="badge-reseller">Rev.: ' +
          escapeHtml(k.createdByReseller) +
          '</span></div>' +
          '<div class="meta">' +
          escapeHtml(durationLabel) +
          ' · Criada: ' +
          formatDate(k.createdAt) +
          '</div>' +
          '<div class="meta">' +
          status +
          '</div>' +
          '</div>' +
          '<div class="actions">' +
          '<button type="button" class="btn-copy-code" data-code="' +
          escapeHtml(k.code) +
          '">Copiar</button>' +
          resetHwidBtn +
          '<button type="button" class="danger btn-delete-redeem" data-code="' +
          escapeHtml(k.code) +
          '">Excluir</button>' +
          '<button type="button" class="' +
          pauseClass +
          '" data-code="' +
          escapeHtml(k.code) +
          '">' +
          pauseLabel +
          '</button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
    resellerGeneratedKeysList.querySelectorAll('.btn-copy-code').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code;
        if (code) navigator.clipboard.writeText(code).then(() => showToast('Copiado.', 'success'));
      });
    });
    resellerGeneratedKeysList.querySelectorAll('.btn-delete-redeem').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code;
        if (code) deleteRedeemKey(code);
      });
    });
    resellerGeneratedKeysList.querySelectorAll('.btn-pause-key').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code;
        if (code) toggleRedeemKeyPause(code);
      });
    });
    resellerGeneratedKeysList.querySelectorAll('.btn-reset-hwid-reseller-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const u = (btn.dataset.username || '').trim();
        if (u) resetLoaderHwid(u);
      });
    });
  } catch (e) {
    resellerGeneratedKeysList.innerHTML = '<p class="empty">Erro de conexão.</p>';
  }
}

function showRenewMessage(text, isError) {
  if (!renewKeyMessage) return;
  renewKeyMessage.textContent = text;
  renewKeyMessage.className = 'message' + (isError ? ' error' : ' success');
  renewKeyMessage.style.display = text ? 'block' : 'none';
}

async function loadRenewKeysList() {
  try {
    const r = await fetchWithTimeout(API + '/api/keys?_=' + Date.now(), { headers: headers(), cache: 'no-store' });
    if (!r.ok) {
      if (renewKeysList) renewKeysList.innerHTML = '<p class="empty">Erro ao carregar.</p>';
      return [];
    }
    const data = await r.json().catch(() => ({}));
    const keys = data.keys || [];
    renewKeysCache = keys;
    if (renewKeysList) renewKeysList.innerHTML = '';
    return keys;
  } catch (e) {
    if (renewKeysList) renewKeysList.innerHTML = '<p class="empty">Erro de conexao.</p>';
    return [];
  }
}

function formatRenewDuration(seconds) {
  if (!seconds) return 'permanente';
  if (seconds === 10) return '10 segundos';
  if (seconds === 3600) return '1 hora';
  if (seconds === 86400) return '1 dia';
  if (seconds === 604800) return '7 dias';
  if (seconds === 1296000) return '15 dias';
  if (seconds === 2592000) return '30 dias';
  return seconds + ' segundos';
}


async function renewKeyDays() {
  const id = (renewKeyIdInput && renewKeyIdInput.value || '').trim();
  const addSeconds = Math.max(0, parseInt(renewKeyDaysInput && renewKeyDaysInput.value, 10) || 0);
  if (!id) {
    showRenewMessage('Informe o ID da key.', true);
    return;
  }
  if (!renewKeyDaysInput || Number.isNaN(addSeconds)) {
    showRenewMessage('Selecione a duracao para renovar.', true);
    return;
  }
  try {
    const r = await fetchWithTimeout(API + '/api/keys/renew', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ key: id, addSeconds }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      if (addSeconds === 0) showRenewMessage('Key definida como permanente.', false);
      else showRenewMessage('Key renovada por ' + formatRenewDuration(addSeconds) + '.', false);
      const activityId = (data && (data.id || data.code)) ? (data.id || data.code) : id;
      addActivity(addSeconds === 0 ? 'Key permanente' : 'Key renovada', activityId + ' - ' + formatRenewDuration(addSeconds));
      await loadRenewKeysList();
    } else {
      showRenewMessage(data.error || 'Erro ao renovar.', true);
    }
  } catch (e) {
    showRenewMessage('Erro de conexao.', true);
  }
}

async function deleteRedeemKey(code) {
  showConfirmToast('Excluir a key "' + code + '"?', async () => {
    try {
      const r = await fetch(API + '/api/redeem-keys/' + encodeURIComponent(code), { method: 'DELETE', headers: headers() });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        showToast('Key excluída.', 'success');
        addActivity('Key excluida', code);
        loadRedeemKeysList();
        loadResellerGeneratedKeys();
      } else {
        showToast(data.error || 'Erro ao excluir.', 'error');
      }
    } catch (e) {
      showToast('Erro de conexão.', 'error');
    }
  });
}

async function toggleRedeemKeyPause(code) {
  try {
    const r = await fetch(API + '/api/redeem-keys/' + encodeURIComponent(code) + '/pause', { method: 'POST', headers: headers() });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      showToast(data.paused ? 'Key pausada.' : 'Key retomada.', 'success');
      addActivity(data.paused ? 'Key pausada' : 'Key retomada', code);
      loadRedeemKeysList();
      loadResellerGeneratedKeys();
    } else {
      showToast(data.error || 'Erro ao pausar key.', 'error');
    }
  } catch (e) {
    showToast('Erro de conexão.', 'error');
  }
}

function showToast(message, type) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const isSuccess = type === 'success';
  const icon = isSuccess ? '✓' : '!';
  const el = document.createElement('div');
  el.className = 'toast toast-' + (type || 'info');
  el.innerHTML =
    '<div class="toast-inner">' +
    '<span class="toast-icon toast-icon-' + (type || 'info') + '">' + icon + '</span>' +
    '<p class="toast-msg">' + escapeHtml(message) + '</p>' +
    '<button type="button" class="toast-close" aria-label="Fechar">×</button>' +
    '</div>' +
    '<div class="toast-progress toast-progress-' + (type || 'info') + '"></div>';
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));

  const dismiss = () => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 300);
  };
  el.querySelector('.toast-close').addEventListener('click', dismiss);
  setTimeout(dismiss, 3000);
}

function showConfirmToast(message, onConfirm, onCancel) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast toast-confirm';
  el.innerHTML =
    '<p class="toast-confirm-msg">' + escapeHtml(message) + '</p>' +
    '<div class="toast-confirm-btns">' +
    '<button type="button" class="toast-btn-cancel">Cancelar</button>' +
    '<button type="button" class="toast-btn-ok">Remover</button>' +
    '</div>';
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));

  const remove = () => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 300);
  };
  el.querySelector('.toast-btn-ok').addEventListener('click', () => {
    remove();
    if (onConfirm) onConfirm();
  });
  el.querySelector('.toast-btn-cancel').addEventListener('click', () => {
    remove();
    if (onCancel) onCancel();
  });
}

function runBuscarUsuario() {
  const q = (buscarUsuarioInput && buscarUsuarioInput.value || '').trim();
  renderLoaderAccountsListUsuarios(q);
}

function resetRedeemSearch() {
  lastBuscarRedeemFilterRaw = '';
  lastBuscarRedeemFilter = '';
  if (buscarRedeemInput) buscarRedeemInput.value = '';
}

function runBuscarRedeemKeys() {
  const q = (buscarRedeemInput && buscarRedeemInput.value || '').trim();
  if (!q) {
    lastBuscarRedeemFilterRaw = '';
    lastBuscarRedeemFilter = '';
    loadRedeemKeysList();
    return;
  }
  lastBuscarRedeemFilterRaw = q;
  lastBuscarRedeemFilter = q.toLowerCase();
  loadRedeemKeysList();
}

// --- DLL: link fixo para injector ---
function getDllSlotElements(slot) {
  if (slot === 'matadorfx') return { linkSection: dllMatadorfxLinkSection, linkUrl: dllMatadorfxLinkUrl, fileInfo: dllMatadorfxFileInfo };
  if (slot === 'nextmenu') return { linkSection: dllNextmenuLinkSection, linkUrl: dllNextmenuLinkUrl, fileInfo: dllNextmenuFileInfo };
  if (slot === 'fatalyplay') return { linkSection: dllFatalyplayLinkSection, linkUrl: dllFatalyplayLinkUrl, fileInfo: dllFatalyplayFileInfo };
  if (slot === 'freefireindia') return { linkSection: dllFreefireindiaLinkSection, linkUrl: dllFreefireindiaLinkUrl, fileInfo: dllFreefireindiaFileInfo };
  if (slot === 'freefireplay') return { linkSection: dllFreefireplayLinkSection, linkUrl: dllFreefireplayLinkUrl, fileInfo: dllFreefireplayFileInfo };
  if (slot === 'liblince') return { linkSection: libLinceLinkSection, linkUrl: libLinceLinkUrl, fileInfo: libLinceFileInfo, versionInput: libLinceVersionInput };
  return { linkSection: dllLinkSection, linkUrl: dllLinkUrl, fileInfo: dllFileInfo };
}

function getDllSlotConfig(slot) {
  if (slot === 'matadorfx') return { endpoint: API + '/api/dll/matadorfx/info', defaultUrl: window.location.origin + '/api/dll/download/FATALY.dll', defaultName: 'FATALY.dll' };
  if (slot === 'nextmenu') return { endpoint: API + '/api/dll/nextmenu/info', defaultUrl: window.location.origin + '/api/dll/download/NEXTMENU.dll', defaultName: 'NEXTMENU.dll' };
  if (slot === 'fatalyplay') return { endpoint: API + '/api/dll/fatalyplay/info', defaultUrl: window.location.origin + '/api/dll/download/FATALYPLAY.dll', defaultName: 'FATALYPLAY.dll' };
  if (slot === 'freefireindia') return { endpoint: API + '/api/dll/freefireindia/info', defaultUrl: window.location.origin + '/api/dll/download/freefireindia', defaultName: 'LuaExecutor.dll' };
  if (slot === 'freefireplay') return { endpoint: API + '/api/dll/freefireplay/info', defaultUrl: window.location.origin + '/api/dll/download/freefireplay', defaultName: 'LuaExecutor.dll' };
  if (slot === 'liblince') return { endpoint: API + '/api/dll/liblince/info', defaultUrl: window.location.origin + '/api/dll/download/liblincdev.so', defaultName: 'liblincdev.so', emptyText: 'Nenhuma lib enviada ainda. Envie um arquivo acima.' };
  return { endpoint: API + '/api/dll/info', defaultUrl: window.location.origin + '/api/dll/download', defaultName: 'loader.dll' };
}

async function loadDllInfo(slot) {
  const elems = getDllSlotElements(slot);
  const config = getDllSlotConfig(slot);
  if (!elems.linkSection || !elems.linkUrl || !elems.fileInfo) return;
  try {
    const r = await fetch(config.endpoint, { headers: headers() });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      elems.linkSection.classList.add('hidden');
      return;
    }
    if (elems.versionInput) {
      elems.versionInput.value = data.version ? String(data.version) : '';
    }
    const url = data.url || config.defaultUrl;
    elems.linkUrl.value = url;
    if (data.exists) {
      show(elems.linkSection, true);
      const sizeKb = (data.size / 1024).toFixed(1);
      const name = data.filename || config.defaultName;
      const versionInfo = data.version ? ' â€” VersÃ£o: ' + escapeHtml(String(data.version)) : '';
      elems.fileInfo.textContent = 'Arquivo hospedado: ' + escapeHtml(name) + ' (' + sizeKb + ' KB)' + versionInfo;
    } else {
      show(elems.linkSection, true);
      elems.fileInfo.textContent = config.emptyText || 'Nenhuma DLL enviada ainda. Envie um arquivo acima.';
    }
  } catch (e) {
    elems.linkSection.classList.add('hidden');
  }
}

function showDllMessage(text, isError, slot) {
  const el = slot === 'matadorfx' ? dllMatadorfxMessage
    : slot === 'nextmenu' ? dllNextmenuMessage
      : slot === 'fatalyplay' ? dllFatalyplayMessage
        : slot === 'freefireindia' ? dllFreefireindiaMessage
          : slot === 'freefireplay' ? dllFreefireplayMessage
            : slot === 'liblince' ? libLinceMessage
              : dllMessage;
  if (!el) return;
  el.textContent = text;
  el.className = 'message' + (isError ? ' error' : ' success');
  el.style.display = text ? 'block' : 'none';
}

// --- Usuários (aba Logins) ---
function showUsersMessage(text, isError) {
  if (!usersMessage) return;
  usersMessage.textContent = text;
  usersMessage.className = 'message' + (isError ? ' error' : ' success');
  usersMessage.style.display = text ? 'block' : 'none';
}

async function saveAdminSecretPhrase() {
  const n = (adminPhraseNew && adminPhraseNew.value || '').trim();
  const c = (adminPhraseConfirm && adminPhraseConfirm.value || '').trim();
  if (n !== c) {
    showUsersMessage('As palavras-chave não coincidem.', true);
    return;
  }
  if (n.length < 4) {
    showUsersMessage('Use pelo menos 4 caracteres.', true);
    return;
  }
  try {
    const r = await fetchWithTimeout(API + '/api/auth/admin/secret-phrase', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ palavraChave: n }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showUsersMessage(data.error || 'Erro ao guardar.', true);
      return;
    }
    if (adminPhraseNew) adminPhraseNew.value = '';
    if (adminPhraseConfirm) adminPhraseConfirm.value = '';
    const auth = getAuth();
    setAuth(auth.user, auth.password, n);
    if (isRememberEnabled()) setRememberedAuth(auth.user, auth.password, n);
    showUsersMessage('Palavra-chave guardada. Use-a em novos logins.', false);
  } catch (_) {
    showUsersMessage('Erro de conexão.', true);
  }
}

async function clearAdminSecretPhrase() {
  try {
    const r = await fetchWithTimeout(API + '/api/auth/admin/secret-phrase', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ clear: true }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showUsersMessage(data.error || 'Erro ao remover.', true);
      return;
    }
    if (adminPhraseNew) adminPhraseNew.value = '';
    if (adminPhraseConfirm) adminPhraseConfirm.value = '';
    const auth = getAuth();
    setAuth(auth.user, auth.password, '');
    if (isRememberEnabled()) setRememberedAuth(auth.user, auth.password, '');
    showUsersMessage('Palavra-chave removida.', false);
  } catch (_) {
    showUsersMessage('Erro de conexão.', true);
  }
}

async function loadUsers() {
  if (!usersList) return;
  const tryLoad = async () => {
    const r = await fetchWithTimeout(API + '/api/users?_=' + Date.now(), { headers: headers(), cache: 'no-store' });
    if (!r.ok) return null;
    const data = await r.json();
    return data.users || [];
  };
  let users = [];
  try {
    users = await tryLoad() || [];
    if (users.length === 0) {
      await new Promise((r) => setTimeout(r, 2000));
      users = await tryLoad() || [];
    }
  } catch (_) {}
  const currentUser = getAuth().user;
  if (users.length === 0) {
    usersList.innerHTML = '<p class="empty">Nenhum usuário cadastrado.</p>';
    setStatValue('users-count', 0);
    return;
  }
  setStatValue('users-count', users.length);
  renderUsersList(users);
}

function renderUsersList(users) {
  if (!usersList) return;
  const currentUser = getAuth().user;
  try {
    usersList.innerHTML = users
      .map(
        (u) => {
          const role = u.role === 'owner' ? 'owner' : u.role === 'ajudante' ? 'ajudante' : 'staff';
          const roleLabel =
            role === 'owner' ? 'Dono' : role === 'ajudante' ? 'Suporte' : 'Admin';
          const isSilva = String(u.username || '').trim().toLowerCase() === 'silva';
          const roleSelect =
            adminPanelRole === 'owner' && u.username !== currentUser && !isSilva
              ? '<select class="admin-user-role-select" data-username="' +
                escapeHtml(u.username) +
                '" aria-label="Cargo">' +
                '<option value="staff"' +
                (role === 'staff' ? ' selected' : '') +
                '>Admin</option>' +
                '<option value="ajudante"' +
                (role === 'ajudante' ? ' selected' : '') +
                '>Suporte</option>' +
                '<option value="owner"' +
                (role === 'owner' ? ' selected' : '') +
                '>Dono</option>' +
                '</select>'
              : '<span style="color:var(--muted)">' +
                roleLabel +
                (isSilva ? ' (máx.)' : '') +
                '</span>';
          return (
            '<div class="key-item">' +
            '<div>' +
            '<div class="id">' +
            escapeHtml(u.username) +
            (u.username === currentUser ? ' <span class="badge-you">(você)</span>' : '') +
            ' · ' +
            roleSelect +
            '</div>' +
            '</div>' +
            '<div class="actions">' +
            (u.username === currentUser || isSilva
              ? ''
              : '<button type="button" class="danger btn-remove-user" data-username="' +
                escapeHtml(u.username) +
                '">Remover</button>') +
            '</div>' +
            '</div>'
          );
        }
      )
      .join('');
    usersList.querySelectorAll('.btn-remove-user').forEach((btn) => {
      btn.addEventListener('click', () => removeUser(btn.dataset.username));
    });
    usersList.querySelectorAll('.admin-user-role-select').forEach((sel) => {
      sel.addEventListener('change', function () {
        const un = this.getAttribute('data-username');
        const role = this.value;
        setUserRole(un, role, this);
      });
    });
  } catch (e) {
    usersList.innerHTML = '<p class="empty">Erro de conexão.</p>';
  }
}

async function setUserRole(username, role, selectEl) {
  try {
    const r = await fetch(API + '/api/users/' + encodeURIComponent(username) + '/role', {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ role }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(data.error || 'Erro ao alterar cargo.', 'error');
      if (selectEl) loadUsers();
      return;
    }
    showToast('Cargo atualizado.', 'success');
    loadUsers();
  } catch (e) {
    showToast('Erro de conexão.', 'error');
    if (selectEl) loadUsers();
  }
}

async function addUser() {
  const username = (newUserUsername && newUserUsername.value || '').trim();
  const password = (newUserPassword && newUserPassword.value || '').trim();
  if (!username || !password) {
    showUsersMessage('Preencha usuário e senha.', true);
    return;
  }
  showUsersMessage('');
  try {
    const role = newUserRole && newUserRole.value ? newUserRole.value : 'staff';
    const r = await fetch(API + '/api/users', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ username, password, role }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      showUsersMessage('Usuário "' + username + '" registrado. Pode acessar o painel.', false);
      showToast('Usuário registrado com sucesso!', 'success');
      addActivity('Usuario criado', username);
      newUserUsername.value = '';
      newUserPassword.value = '';
      if (newUserRole) newUserRole.value = 'staff';
      if (Array.isArray(data.users)) renderUsersList(data.users);
      else loadUsers();
    } else {
      showUsersMessage(data.error || 'Erro ao registrar.', true);
    }
  } catch (e) {
    showUsersMessage('Erro de conexão.', true);
  }
}

async function removeUser(username) {
  showConfirmToast('Remover o usuário "' + username + '"? Ele não poderá mais acessar o painel.', async () => {
    try {
      const r = await fetch(API + '/api/users/' + encodeURIComponent(username), {
        method: 'DELETE',
        headers: headers(),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        if (Array.isArray(data.users)) renderUsersList(data.users);
        else loadUsers();
        showToast('Usuário removido.', 'success');
        addActivity('Usuario removido', username);
      } else {
        showToast(data.error || 'Erro ao remover.', 'error');
      }
    } catch (e) {
      showToast('Erro de conexão.', 'error');
    }
  });
}

function showResellersMessage(text, isError) {
  if (!resellersMessage) return;
  resellersMessage.textContent = text;
  resellersMessage.className = 'message' + (isError ? ' error' : ' success');
  resellersMessage.style.display = text ? 'block' : 'none';
}

async function loadResellers() {
  if (!resellersList) return;
  try {
    const r = await fetchWithTimeout(API + '/api/resellers?_=' + Date.now(), { headers: headers(), cache: 'no-store' });
    if (!r.ok) {
      resellersList.innerHTML = '<p class="empty">Não foi possível carregar.</p>';
      return;
    }
    const data = await r.json();
    renderResellersList(data.resellers || []);
  } catch (_) {
    resellersList.innerHTML = '<p class="empty">Erro de conexão.</p>';
  }
}

function renderResellersList(list) {
  if (!resellersList) return;
  if (!list || list.length === 0) {
    resellersList.innerHTML = '<p class="empty">Nenhum revendedor cadastrado.</p>';
    return;
  }
  resellersList.innerHTML = list
    .map(
      (u) => {
        const phraseHtml = u.loginPhrase
          ? '<span class="reseller-login-phrase"><strong>Palavra-chave login:</strong> <code>' +
            escapeHtml(String(u.loginPhrase)) +
            '</code></span>'
          : u.hasLoginPhrase
            ? '<span class="reseller-login-phrase muted"><strong>Palavra-chave login:</strong> definida no servidor (texto só após guardar de novo no perfil do /vendedor ou aqui em baixo)</span>'
            : '<span class="reseller-login-phrase muted"><strong>Palavra-chave login:</strong> ainda não definida</span>';
        const ownerPhraseRow =
          '<div class="activity-time reseller-phrase-owner-row" style="margin-top:0.45rem">' +
          '<input type="text" class="full-width input-admin-reseller-phrase" data-username="' +
          escapeHtml(u.username) +
          '" placeholder="Definir ou alterar palavra-chave (visível só para o dono)" autocomplete="off" style="max-width:min(100%,20rem)">' +
          '<button type="button" class="btn-secondary btn-save-reseller-phrase" data-username="' +
          escapeHtml(u.username) +
          '">Guardar</button>' +
          '</div>';
        return (
          '<div class="key-item">' +
          '<div><div class="id">' +
          escapeHtml(u.username) +
          '</div>' +
          '<div class="activity-time reseller-admin-phrase-row">' +
          phraseHtml +
          ownerPhraseRow +
          '</div>' +
          '<div class="activity-time">Saldo: R$ ' +
          escapeHtml(String(u.balance != null ? Number(u.balance).toFixed(2) : '0.00')) +
          '</div></div>' +
          '<div class="actions"><button type="button" class="danger btn-remove-reseller" data-username="' +
          escapeHtml(u.username) +
          '">Remover</button></div></div>'
        );
      }
    )
    .join('');
  resellersList.querySelectorAll('.btn-remove-reseller').forEach((btn) => {
    btn.addEventListener('click', () => removeReseller(btn.dataset.username));
  });
  if (!resellersList.dataset.adminPhraseBound) {
    resellersList.dataset.adminPhraseBound = '1';
    resellersList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-save-reseller-phrase');
      if (!btn || !resellersList.contains(btn)) return;
      const username = btn.getAttribute('data-username');
      if (!username) return;
      const item = btn.closest('.key-item');
      const inp = item && item.querySelector('.input-admin-reseller-phrase');
      const phrase = inp && (inp.value || '').trim();
      if (!phrase || phrase.length < 4) {
        showToast('Palavra-chave: mínimo 4 caracteres.', 'error');
        return;
      }
      try {
        const r = await fetch(API + '/api/resellers/' + encodeURIComponent(username) + '/login-phrase', {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({ phrase }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          showToast(data.error || 'Erro ao guardar.', 'error');
          return;
        }
        showToast('Palavra-chave guardada para o revendedor.', 'success');
        if (inp) inp.value = '';
        if (Array.isArray(data.resellers)) renderResellersList(data.resellers);
        else loadResellers();
      } catch (_) {
        showToast('Erro de conexão.', 'error');
      }
    });
  }
}

async function addReseller() {
  const username = (newResellerUsername && newResellerUsername.value || '').trim();
  const password = (newResellerPassword && newResellerPassword.value || '').trim();
  const balRaw = (newResellerBalance && newResellerBalance.value) || '';
  const initialBalance = balRaw === '' ? 0 : parseFloat(balRaw);
  if (!username || !password) {
    showResellersMessage('Preencha usuário e senha.', true);
    return;
  }
  showResellersMessage('');
  try {
    const r = await fetch(API + '/api/resellers', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ username, password, initialBalance: Number.isFinite(initialBalance) ? initialBalance : 0 }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      showResellersMessage('Revendedor "' + username + '" criado.', false);
      showToast('Revendedor criado.', 'success');
      addActivity('Revendedor criado', username);
      if (newResellerUsername) newResellerUsername.value = '';
      if (newResellerPassword) newResellerPassword.value = '';
      if (newResellerBalance) newResellerBalance.value = '';
      if (Array.isArray(data.resellers)) renderResellersList(data.resellers);
      else loadResellers();
    } else {
      showResellersMessage(data.error || 'Erro ao criar.', true);
    }
  } catch (e) {
    showResellersMessage('Erro de conexão.', true);
  }
}

async function removeReseller(username) {
  showConfirmToast('Remover o revendedor "' + username + '"? O saldo dele será perdido do sistema.', async () => {
    try {
      const r = await fetch(API + '/api/resellers/' + encodeURIComponent(username), {
        method: 'DELETE',
        headers: headers(),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        if (Array.isArray(data.resellers)) renderResellersList(data.resellers);
        else loadResellers();
        showToast('Revendedor removido.', 'success');
        addActivity('Revendedor removido', username);
      } else {
        showToast(data.error || 'Erro ao remover.', 'error');
      }
    } catch (e) {
      showToast('Erro de conexão.', 'error');
    }
  });
}

const DLL_CHUNK_SIZE = 3 * 1024 * 1024; // 3 MB por chunk (fica under 4,5 MB em base64)
const DLL_CHUNK_THRESHOLD = 3.5 * 1024 * 1024; // acima disso usa upload em chunks (Postgres)

function readChunkAsBase64(file, start, length) {
  return new Promise((resolve, reject) => {
    const blob = file.slice(start, start + length);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const b64 = dataUrl.indexOf('base64,') >= 0 ? dataUrl.split('base64,')[1] : '';
      resolve(b64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function getDllUploadConfig(slot) {
  if (slot === 'matadorfx') return { endpoint: API + '/api/dll/matadorfx', defaultName: 'FATALY.dll', slot: 'matadorfx', label: 'MatadorFX', ext: '.dll', kind: 'DLL' };
  if (slot === 'nextmenu') return { endpoint: API + '/api/dll/nextmenu', defaultName: 'NEXTMENU.dll', slot: 'nextmenu', label: 'NextMenu', ext: '.dll', kind: 'DLL' };
  if (slot === 'fatalyplay') return { endpoint: API + '/api/dll/fatalyplay', defaultName: 'FATALYPLAY.dll', slot: 'fatalyplay', label: 'FATALYPLAY', ext: '.dll', kind: 'DLL' };
  if (slot === 'freefireindia') return { endpoint: API + '/api/dll/freefireindia', defaultName: 'LuaExecutor.dll', slot: 'freefireindia', label: 'Free Fire India', ext: '.dll', kind: 'DLL' };
  if (slot === 'freefireplay') return { endpoint: API + '/api/dll/freefireplay', defaultName: 'LuaExecutor.dll', slot: 'freefireplay', label: 'Free Fire Play', ext: '.dll', kind: 'DLL' };
  if (slot === 'liblince') return { endpoint: API + '/api/dll/liblince', defaultName: 'liblincdev.so', slot: 'liblince', label: 'Lince', ext: '.so', kind: 'Lib' };
  return { endpoint: API + '/api/dll', defaultName: 'loader.dll', slot: undefined, label: '', ext: '.dll', kind: 'DLL' };
}

async function uploadDll(slot) {
  const config = getDllUploadConfig(slot);
  const fileInput = slot === 'matadorfx' ? dllMatadorfxFileInput
    : slot === 'nextmenu' ? dllNextmenuFileInput
      : slot === 'fatalyplay' ? dllFatalyplayFileInput
        : slot === 'freefireindia' ? dllFreefireindiaFileInput
          : slot === 'freefireplay' ? dllFreefireplayFileInput
            : slot === 'liblince' ? libLinceFileInput
              : dllFileInput;
  const ext = (config.ext || '.dll').toLowerCase();
  const kind = config.kind || 'DLL';
  const label = config.label || '';
  const version = slot === 'liblince' && libLinceVersionInput ? String(libLinceVersionInput.value || '').trim() : '';
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    showDllMessage('Selecione um arquivo ' + ext, true, slot);
    return;
  }
  const file = fileInput.files[0];
  if (!file.name.toLowerCase().endsWith(ext)) {
    showDllMessage('Selecione um arquivo ' + ext, true, slot);
    return;
  }
  showDllMessage('Enviando...', false, slot);

  const chunkCompleteBody = (uploadId, totalChunks, filename) => {
    const body = { uploadId, total: totalChunks, filename: filename || config.defaultName };
    if (config.slot) body.slot = config.slot;
    if (config.slot === 'liblince') body.version = version;
    return body;
  };

  if (file.size > DLL_CHUNK_THRESHOLD) {
    try {
      const uploadId = crypto.randomUUID ? crypto.randomUUID() : 'upload-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const totalChunks = Math.ceil(file.size / DLL_CHUNK_SIZE);
      for (let i = 0; i < totalChunks; i++) {
        const start = i * DLL_CHUNK_SIZE;
        const len = Math.min(DLL_CHUNK_SIZE, file.size - start);
        const b64 = await readChunkAsBase64(file, start, len);
        const r = await fetch(API + '/api/dll/chunk', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ uploadId, index: i, total: totalChunks, chunk: b64 }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          showDllMessage(data.error || 'Erro ao enviar parte ' + (i + 1) + '/' + totalChunks, true, slot);
          return;
        }
      }
      const r = await fetch(API + '/api/dll/chunk-complete', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(chunkCompleteBody(uploadId, totalChunks, file.name || config.defaultName)),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        const okMsg = label ? kind + ' ' + label + ' enviada. O link permanece o mesmo.' : kind + ' enviada. O link permanece o mesmo.';
        showDllMessage(okMsg, false, slot);
        fileInput.value = '';
        loadDllInfo(slot);
        showToast(label ? kind + ' ' + label + ' atualizada!' : kind + ' atualizada com sucesso!', 'success');
      } else {
        showDllMessage(data.error || 'Erro ao finalizar envio.', true, slot);
      }
    } catch (e) {
      showDllMessage(e.message || 'Erro no envio em partes.', true, slot);
    }
    return;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const b64 = dataUrl.indexOf('base64,') >= 0 ? dataUrl.split('base64,')[1] : '';
      if (!b64) {
        showDllMessage('Erro ao ler o arquivo.', true, slot);
        resolve();
        return;
      }
      try {
        const payload = { file: b64, filename: file.name || config.defaultName };
        if (config.slot === 'liblince') payload.version = version;
        const r = await fetch(config.endpoint, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(payload),
        });
        const res = await r.json().catch(() => ({}));
        if (r.ok) {
          const okMsg = label ? kind + ' ' + label + ' enviada. O link permanece o mesmo.' : kind + ' enviada. O link permanece o mesmo.';
          showDllMessage(okMsg, false, slot);
          fileInput.value = '';
          loadDllInfo(slot);
          showToast(label ? kind + ' ' + label + ' atualizada!' : kind + ' atualizada com sucesso!', 'success');
        } else {
          let msg = res.error || 'Erro ao enviar.';
          if (r.status === 413 || (msg && (msg.includes('payload') || msg.includes('size') || msg.includes('too large')))) {
            msg = 'Requisição muito grande. Com Postgres, DLLs maiores que ~3 MB são enviadas em partes automaticamente.';
          }
          showDllMessage(msg, true, slot);
        }
      } catch (e) {
        showDllMessage('Erro de conexão.', true, slot);
      }
      resolve();
    };
    reader.readAsDataURL(file);
  });
}

function openAdminPhraseModal(user, password, remember) {
  pendingPhraseLogin = { user: user, password: password, remember: remember };
  if (adminModalPhraseError) adminModalPhraseError.textContent = '';
  if (adminModalSecretPhrase) {
    adminModalSecretPhrase.value = '';
    const rem = getRememberedAuth();
    if (remember && rem.user === user && rem.phrase) {
      adminModalSecretPhrase.value = rem.phrase;
    }
  }
  if (adminPhraseModal) {
    adminPhraseModal.classList.remove('hidden');
    adminPhraseModal.setAttribute('aria-hidden', 'false');
  }
  if (adminModalSecretPhrase) setTimeout(function () { adminModalSecretPhrase.focus(); }, 80);
}

function closeAdminPhraseModal() {
  pendingPhraseLogin = null;
  if (adminModalSecretPhrase) adminModalSecretPhrase.value = '';
  if (adminModalPhraseError) adminModalPhraseError.textContent = '';
  if (adminPhraseModal) {
    adminPhraseModal.classList.add('hidden');
    adminPhraseModal.setAttribute('aria-hidden', 'true');
  }
}

function finishAdminLogin(user, password, phrase, remember, data) {
  closeAdminPhraseModal();
  setAuth(user, password, phrase);
  if (remember) setRememberedAuth(user, password, phrase);
  else setRememberedAuth('', '', '');
  applyRoleTabsVisibility(data.role || (data.isOwner ? 'owner' : 'staff'));
  show(loginBox, false);
  show(panel, true);
  updateCurrentUserLabel();
  startPresencePing();
  stopLoaderAccountsPolling();
  stopActivityStream();
  if (adminPanelRole === 'owner' || adminPanelRole === 'ajudante') {
    startLoaderAccountsPolling();
    loadLoaderAccounts();
  }
  if (adminPanelRole === 'owner' || adminPanelRole === 'staff') {
    startActivityStream();
  }
  const storedTab = getActiveTabName();
  const storedBtn = storedTab ? document.querySelector('.tab[data-tab="' + storedTab + '"]') : null;
  if (storedBtn && isTabAllowedForRole(storedTab)) {
    switchTab(storedTab);
  } else {
    switchTab(getDefaultTabForRole(adminPanelRole));
  }
  checkStorageWarning();
  fetchPauseState();
  if (loginUser) loginUser.value = '';
  if (loginPassword) loginPassword.value = '';
}

async function confirmAdminPhraseModal() {
  if (!pendingPhraseLogin) return;
  const phrase = (adminModalSecretPhrase && adminModalSecretPhrase.value || '').trim();
  if (!phrase) {
    if (adminModalPhraseError) adminModalPhraseError.textContent = 'Digite a palavra-chave.';
    return;
  }
  const pl = pendingPhraseLogin;
  if (adminModalPhraseError) adminModalPhraseError.textContent = '';
  try {
    const r = await fetch(API + '/api/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: pl.user, password: pl.password, palavraChave: phrase }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok && !data.needsSecretPhrase) {
      finishAdminLogin(pl.user, pl.password, phrase, pl.remember, data);
      return;
    }
    if (adminModalPhraseError) adminModalPhraseError.textContent = data.error || 'Palavra-chave incorreta.';
  } catch (e) {
    if (adminModalPhraseError) adminModalPhraseError.textContent = 'Erro de conexão.';
  }
}

// --- Eventos ---

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('[data-jump]').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.jump));
});

if (btnPauseKeys) btnPauseKeys.addEventListener('click', togglePauseKeys);
if (btnPauseAllLoader) btnPauseAllLoader.addEventListener('click', togglePauseAllLoader);

btnLogin.addEventListener('click', async () => {
  loginError.textContent = '';
  const user = (loginUser && loginUser.value || '').trim();
  const password = (loginPassword && loginPassword.value || '').trim();
  if (!user || !password) {
    loginError.textContent = 'Digite usuário e senha.';
    return;
  }
  const remember = rememberLogin && rememberLogin.checked;
  setRememberEnabled(remember);
  let phraseForLogin = '';
  if (remember) {
    const rem = getRememberedAuth();
    if (rem.user === user && rem.phrase) phraseForLogin = rem.phrase;
    const keepPhrase = rem.user === user ? rem.phrase : '';
    setRememberedAuth(user, password, keepPhrase);
  } else setRememberedAuth('', '', '');
  clearAuth();
  try {
    const payload = { username: user, password: password };
    if (phraseForLogin) payload.palavraChave = phraseForLogin;
    const r = await fetch(API + '/api/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 403 && phraseForLogin) {
      setRememberedAuth(user, password, '');
      openAdminPhraseModal(user, password, remember);
      loginError.textContent = data.error || '';
      return;
    }
    if (r.ok && data.ok && data.needsSecretPhrase) {
      openAdminPhraseModal(user, password, remember);
      return;
    }
    if (r.ok && data.ok && !data.needsSecretPhrase) {
      finishAdminLogin(user, password, phraseForLogin, remember, data);
      return;
    }
    loginError.textContent = data.error || 'Usuário ou senha incorretos.';
  } catch (e) {
    loginError.textContent = 'Erro de conexão. Tente de novo.';
  }
});

if (btnCheckDb) btnCheckDb.addEventListener('click', () => checkDbConnectionFromLogin());

if (btnAdminModalPhraseConfirm) btnAdminModalPhraseConfirm.addEventListener('click', confirmAdminPhraseModal);
if (btnAdminModalPhraseCancel) {
  btnAdminModalPhraseCancel.addEventListener('click', function () {
    closeAdminPhraseModal();
  });
}
if (adminModalSecretPhrase) {
  adminModalSecretPhrase.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') confirmAdminPhraseModal();
  });
}

if (btnAddLoaderAccount) btnAddLoaderAccount.addEventListener('click', addLoaderAccount);
if (btnGenerateRedeemKeys) btnGenerateRedeemKeys.addEventListener('click', generateRedeemKeys);

if (btnBuscarUsuario) btnBuscarUsuario.addEventListener('click', runBuscarUsuario);
if (buscarUsuarioInput) buscarUsuarioInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runBuscarUsuario(); });
if (buscarUsuarioInput) buscarUsuarioInput.addEventListener('input', () => {
  const q = (buscarUsuarioInput.value || '').trim();
  if (!q) renderLoaderAccountsListUsuarios('');
});
if (btnBuscarRedeem) btnBuscarRedeem.addEventListener('click', runBuscarRedeemKeys);
if (redeemStatusFilter) redeemStatusFilter.addEventListener('change', () => loadRedeemKeysList());
if (buscarRedeemInput) buscarRedeemInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runBuscarRedeemKeys(); });
if (btnRenewKey) btnRenewKey.addEventListener('click', renewKeyDays);
if (renewKeyIdInput) renewKeyIdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') renewKeyDays(); });
if (renewKeyDaysInput) renewKeyDaysInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') renewKeyDays(); });
if (buscarRedeemInput) buscarRedeemInput.addEventListener('input', () => {
  const q = (buscarRedeemInput.value || '').trim();
  if (!q && (lastBuscarRedeemFilter || lastBuscarRedeemFilterRaw)) {
    lastBuscarRedeemFilter = '';
    lastBuscarRedeemFilterRaw = '';
    loadRedeemKeysList();
  }
});

if (btnAddUser) btnAddUser.addEventListener('click', addUser);
if (newUserUsername) newUserUsername.addEventListener('keydown', (e) => { if (e.key === 'Enter') newUserPassword && newUserPassword.focus(); });
if (newUserPassword) newUserPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') addUser(); });

if (btnAddReseller) btnAddReseller.addEventListener('click', addReseller);
if (btnSaveMpPanel) btnSaveMpPanel.addEventListener('click', saveMercadoPagoPanelSettings);
if (btnSaveDiscordPanel) btnSaveDiscordPanel.addEventListener('click', saveDiscordPanelSettings);
if (btnEditDiscordWebhooks) {
  btnEditDiscordWebhooks.addEventListener('click', function () {
    discordWebhooksUiCollapsed = false;
    syncDiscordWebhookPanelUi();
  });
}
if (btnSaveAdminPhrase) btnSaveAdminPhrase.addEventListener('click', saveAdminSecretPhrase);
if (btnClearAdminPhrase) btnClearAdminPhrase.addEventListener('click', clearAdminSecretPhrase);
if (newResellerUsername) newResellerUsername.addEventListener('keydown', (e) => { if (e.key === 'Enter') newResellerPassword && newResellerPassword.focus(); });
if (newResellerPassword) newResellerPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnAddReseller && btnAddReseller.click(); });

if (btnUploadDll) btnUploadDll.addEventListener('click', () => uploadDll());
if (btnUploadDllMatadorfx) btnUploadDllMatadorfx.addEventListener('click', () => uploadDll('matadorfx'));
if (btnUploadDllNextmenu) btnUploadDllNextmenu.addEventListener('click', () => uploadDll('nextmenu'));
if (btnUploadDllFatalyplay) btnUploadDllFatalyplay.addEventListener('click', () => uploadDll('fatalyplay'));
if (btnUploadDllFreefireindia) btnUploadDllFreefireindia.addEventListener('click', () => uploadDll('freefireindia'));
if (btnUploadDllFreefireplay) btnUploadDllFreefireplay.addEventListener('click', () => uploadDll('freefireplay'));
if (loaderFlag0) loaderFlag0.addEventListener('change', saveLoaderProductFlagsFromPanel);
if (loaderFlag1) loaderFlag1.addEventListener('change', saveLoaderProductFlagsFromPanel);
if (loaderFlag2) loaderFlag2.addEventListener('change', saveLoaderProductFlagsFromPanel);
if (btnUploadLibLince) btnUploadLibLince.addEventListener('click', () => uploadDll('liblince'));
if (btnCopyDllLink) btnCopyDllLink.addEventListener('click', () => {
  if (dllLinkUrl && dllLinkUrl.value) {
    navigator.clipboard.writeText(dllLinkUrl.value).then(
      () => showToast('Link copiado!', 'success'),
      () => showToast('Não foi possível copiar.', 'error')
    );
  }
});
if (btnCopyDllLinkMatadorfx) btnCopyDllLinkMatadorfx.addEventListener('click', () => {
  if (dllMatadorfxLinkUrl && dllMatadorfxLinkUrl.value) {
    navigator.clipboard.writeText(dllMatadorfxLinkUrl.value).then(
      () => showToast('Link MatadorFX copiado!', 'success'),
      () => showToast('Não foi possível copiar.', 'error')
    );
  }
});
if (btnCopyDllLinkNextmenu) btnCopyDllLinkNextmenu.addEventListener('click', () => {
  if (dllNextmenuLinkUrl && dllNextmenuLinkUrl.value) {
    navigator.clipboard.writeText(dllNextmenuLinkUrl.value).then(
      () => showToast('Link NextMenu copiado!', 'success'),
      () => showToast('Não foi possível copiar.', 'error')
    );
  }
});
if (btnCopyDllLinkFatalyplay) btnCopyDllLinkFatalyplay.addEventListener('click', () => {
  if (dllFatalyplayLinkUrl && dllFatalyplayLinkUrl.value) {
    navigator.clipboard.writeText(dllFatalyplayLinkUrl.value).then(
      () => showToast('Link FATALYPLAY copiado!', 'success'),
      () => showToast('Não foi possível copiar.', 'error')
    );
  }
});

if (btnCopyDllLinkFreefireindia) btnCopyDllLinkFreefireindia.addEventListener('click', () => {
  if (dllFreefireindiaLinkUrl && dllFreefireindiaLinkUrl.value) {
    navigator.clipboard.writeText(dllFreefireindiaLinkUrl.value).then(
      () => showToast('Link Free Fire India copiado!', 'success'),
      () => showToast('Não foi possível copiar.', 'error')
    );
  }
});
if (btnCopyDllLinkFreefireplay) btnCopyDllLinkFreefireplay.addEventListener('click', () => {
  if (dllFreefireplayLinkUrl && dllFreefireplayLinkUrl.value) {
    navigator.clipboard.writeText(dllFreefireplayLinkUrl.value).then(
      () => showToast('Link Free Fire Play copiado!', 'success'),
      () => showToast('Não foi possível copiar.', 'error')
    );
  }
});
if (btnCopyLibLinceLink) btnCopyLibLinceLink.addEventListener('click', () => {
  if (libLinceLinkUrl && libLinceLinkUrl.value) {
    navigator.clipboard.writeText(libLinceLinkUrl.value).then(
      () => showToast('Link Lib Lince copiado!', 'success'),
      () => showToast('Não foi possível copiar.', 'error')
    );
  }
});

btnLogout.addEventListener('click', () => {
  sendPresenceLogout();
  stopPresencePing();
  stopLoaderAccountsPolling();
  stopActivityStream();
  clearAuth();
  updateCurrentUserLabel();
  show(loginBox, true);
  show(panel, false);


  applyRememberedLoginFields();
  loginError.textContent = '';
});

window.addEventListener('beforeunload', () => {
  sendPresenceLogout();
  stopLoaderAccountsPolling();
  stopActivityStream();
});

resetRedeemSearch();
checkAuth();
startLoginStoragePolling();


















