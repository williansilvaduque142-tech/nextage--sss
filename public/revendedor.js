const API = '';
const STORAGE_USER = 'silva_reseller_u';
const STORAGE_PASS = 'silva_reseller_p';
const STORAGE_LAST_PAYMENT = 'silva_reseller_last_payment';
const STORAGE_ACTIVE_TAB = 'silva_reseller_active_tab';
const STORAGE_SECRET_PHRASE = 'silva_reseller_secret_p';
const STORAGE_REMEMBER_FLAG = 'silva_reseller_remember_flag';
const STORAGE_REMEMBER_STORE_U = 'silva_reseller_remember_store_u';
const STORAGE_REMEMBER_STORE_P = 'silva_reseller_remember_store_p';
const STORAGE_REMEMBER_STORE_PH = 'silva_reseller_remember_store_ph';

function isResellerRememberEnabled() {
  try {
    return localStorage.getItem(STORAGE_REMEMBER_FLAG) === '1';
  } catch (_) {
    return false;
  }
}
function setResellerRememberEnabled(on) {
  try {
    localStorage.setItem(STORAGE_REMEMBER_FLAG, on ? '1' : '0');
  } catch (_) {}
}
function getRememberedResellerAuth() {
  try {
    return {
      user: localStorage.getItem(STORAGE_REMEMBER_STORE_U) || '',
      pass: localStorage.getItem(STORAGE_REMEMBER_STORE_P) || '',
      phrase: localStorage.getItem(STORAGE_REMEMBER_STORE_PH) || '',
    };
  } catch (_) {
    return { user: '', pass: '', phrase: '' };
  }
}
function setRememberedResellerAuth(user, pass, phrase) {
  try {
    if (user !== undefined) {
      if (user) localStorage.setItem(STORAGE_REMEMBER_STORE_U, user);
      else localStorage.removeItem(STORAGE_REMEMBER_STORE_U);
    }
    if (pass !== undefined) {
      if (pass) localStorage.setItem(STORAGE_REMEMBER_STORE_P, pass);
      else localStorage.removeItem(STORAGE_REMEMBER_STORE_P);
    }
    if (phrase !== undefined) {
      if (phrase) localStorage.setItem(STORAGE_REMEMBER_STORE_PH, phrase);
      else localStorage.removeItem(STORAGE_REMEMBER_STORE_PH);
    }
  } catch (_) {}
}
function clearRememberedResellerAuth() {
  setRememberedResellerAuth('', '', '');
  setResellerRememberEnabled(false);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
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
  setTimeout(dismiss, 3500);
}

function resellerHeaders() {
  const h = {
    'Content-Type': 'application/json',
    'X-Reseller-User': sessionStorage.getItem(STORAGE_USER) || '',
    'X-Reseller-Password': sessionStorage.getItem(STORAGE_PASS) || '',
  };
  const ph = sessionStorage.getItem(STORAGE_SECRET_PHRASE);
  if (ph) h['X-Reseller-Secret-Phrase'] = ph;
  return h;
}

/** JSON da API; se vier HTML (rota ausente e fallback do painel), define __apiHtml. */
async function readResellerJson(r) {
  const text = await r.text();
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  const trimmed = (text || '').trim();
  if (ct.includes('text/html') || trimmed.startsWith('<!') || trimmed.toLowerCase().startsWith('<html')) {
    return { __apiHtml: true };
  }
  try {
    return trimmed ? JSON.parse(trimmed) : {};
  } catch (_) {
    return { __apiHtml: true };
  }
}

function setResellerAuth(user, pass, secretPhrase) {
  if (user) sessionStorage.setItem(STORAGE_USER, user);
  else sessionStorage.removeItem(STORAGE_USER);
  if (pass) sessionStorage.setItem(STORAGE_PASS, pass);
  else sessionStorage.removeItem(STORAGE_PASS);
  if (secretPhrase != null && secretPhrase !== '') sessionStorage.setItem(STORAGE_SECRET_PHRASE, secretPhrase);
  else sessionStorage.removeItem(STORAGE_SECRET_PHRASE);
}

function show(el, on) {
  if (!el) return;
  el.classList.toggle('hidden', !on);
}

function formatBrl(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'R$ 0,00';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(sec) {
  if (!sec) return 'Permanente';
  const s = parseInt(sec, 10) || 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const parts = [];
  if (d > 0) parts.push(d + ' dia(s)');
  if (h > 0) parts.push(h + ' h');
  if (m > 0) parts.push(m + ' min');
  if (r > 0 || parts.length === 0) parts.push(r + ' s');
  return parts.join(', ');
}

let lastPaymentId = sessionStorage.getItem(STORAGE_LAST_PAYMENT) || '';
let lastResellerLoaders = [];

const resellerLoginBox = document.getElementById('resellerLoginBox');
const resellerPanel = document.getElementById('resellerPanel');
const resellerLoginUser = document.getElementById('resellerLoginUser');
const resellerLoginPassword = document.getElementById('resellerLoginPassword');
const btnResellerLogin = document.getElementById('btnResellerLogin');
const resellerLoginError = document.getElementById('resellerLoginError');
const resellerRememberLogin = document.getElementById('resellerRememberLogin');
const resellerPhraseModal = document.getElementById('resellerPhraseModal');
const resellerModalSecretPhrase = document.getElementById('resellerModalSecretPhrase');
const btnResellerModalPhraseConfirm = document.getElementById('btnResellerModalPhraseConfirm');
const btnResellerModalPhraseCancel = document.getElementById('btnResellerModalPhraseCancel');
const resellerModalPhraseError = document.getElementById('resellerModalPhraseError');
let pendingResellerPhraseLogin = null;
const btnResellerLogout = document.getElementById('btnResellerLogout');
const resellerBalanceDisplay = document.getElementById('resellerBalanceDisplay');
const resellerMpWarning = document.getElementById('resellerMpWarning');
const resellerTopupAmount = document.getElementById('resellerTopupAmount');
const btnResellerTopup = document.getElementById('btnResellerTopup');
const resellerTopupMessage = document.getElementById('resellerTopupMessage');
const resellerQrSection = document.getElementById('resellerQrSection');
const resellerQrImg = document.getElementById('resellerQrImg');
const resellerQrCodeText = document.getElementById('resellerQrCodeText');
const resellerPaymentId = document.getElementById('resellerPaymentId');
const btnResellerPollPayment = document.getElementById('btnResellerPollPayment');
const resellerPlansGrid = document.getElementById('resellerPlansGrid');
const resellerGenMessage = document.getElementById('resellerGenMessage');
const resellerLastCode = document.getElementById('resellerLastCode');
const resellerMyKeysList = document.getElementById('resellerMyKeysList');
const resellerMyLoadersList = document.getElementById('resellerMyLoadersList');
const btnRefreshMyKeys = document.getElementById('btnRefreshMyKeys');
const btnRefreshMyLoaders = document.getElementById('btnRefreshMyLoaders');
const resellerLoaderSearch = document.getElementById('resellerLoaderSearch');
const resellerTopbarTitle = document.getElementById('resellerTopbarTitle');
const resellerTopbarSubtitle = document.getElementById('resellerTopbarSubtitle');
const resellerTopbarUser = document.getElementById('resellerTopbarUser');
const btnResellerAvatarPick = document.getElementById('btnResellerAvatarPick');
const resellerAvatarFile = document.getElementById('resellerAvatarFile');
const resellerAvatarImg = document.getElementById('resellerAvatarImg');
const resellerAvatarInitial = document.getElementById('resellerAvatarInitial');
const btnSidebarPix = document.getElementById('btnSidebarPix');
const resellerProfileDropdown = document.getElementById('resellerProfileDropdown');
const btnResellerProfileText = document.getElementById('btnResellerProfileText');
const btnResellerChangePhoto = document.getElementById('btnResellerChangePhoto');
const resellerPhraseHint = document.getElementById('resellerPhraseHint');
const resellerPhraseNew = document.getElementById('resellerPhraseNew');
const resellerPhraseConfirm = document.getElementById('resellerPhraseConfirm');
const btnSaveResellerPhrase = document.getElementById('btnSaveResellerPhrase');
const btnClearResellerPhrase = document.getElementById('btnClearResellerPhrase');
const resellerResetPasswordModal = document.getElementById('resellerResetPasswordModal');
const resellerResetNew = document.getElementById('resellerResetNew');
const resellerResetConfirm = document.getElementById('resellerResetConfirm');
const resellerResetError = document.getElementById('resellerResetError');
const btnResellerResetSubmit = document.getElementById('btnResellerResetSubmit');
const btnResellerResetClose = document.getElementById('btnResellerResetClose');
let pendingPasswordResetToken = null;
const resellerDropUser = document.getElementById('resellerDropUser');
const resellerDropCreated = document.getElementById('resellerDropCreated');
const resellerDropBalance = document.getElementById('resellerDropBalance');
const resellerDropVolume = document.getElementById('resellerDropVolume');
const resellerDropKeys = document.getElementById('resellerDropKeys');
const resellerDropClients = document.getElementById('resellerDropClients');
const resellerRankingStatus = document.getElementById('resellerRankingStatus');
const resellerRankingChartWrap = document.getElementById('resellerRankingChartWrap');
const resellerRankingChartCanvas = document.getElementById('resellerRankingChart');
const resellerRankingAvatarLayer = document.getElementById('resellerRankingAvatarLayer');
const resellerModalPerfil = document.getElementById('resellerModalPerfil');
const resellerModalVendas = document.getElementById('resellerModalVendas');
const resellerModalRanking = document.getElementById('resellerModalRanking');
const btnResellerRankingRefresh = document.getElementById('btnResellerRankingRefresh');

function applyResellerRememberedFields() {
  const rem = getRememberedResellerAuth();
  /** Igual ao admin: há credenciais guardadas → mostrar como «lembrar» mesmo se a flag falhou */
  const rememberEnabled =
    isResellerRememberEnabled() || !!(rem.user || rem.pass || String(rem.phrase || '').trim());
  if (resellerRememberLogin) resellerRememberLogin.checked = rememberEnabled;
  if (rememberEnabled) {
    if (resellerLoginUser) resellerLoginUser.value = rem.user || '';
    if (resellerLoginPassword) resellerLoginPassword.value = rem.pass || '';
  } else {
    if (resellerLoginUser) resellerLoginUser.value = '';
    if (resellerLoginPassword) resellerLoginPassword.value = '';
  }
}

function showTopupMessage(text, isError) {
  if (!resellerTopupMessage) return;
  resellerTopupMessage.textContent = text;
  resellerTopupMessage.className = 'message' + (isError ? ' error' : ' success');
  resellerTopupMessage.style.display = text ? 'block' : 'none';
}

function showGenMessage(text, isError) {
  if (!resellerGenMessage) return;
  resellerGenMessage.textContent = text;
  resellerGenMessage.className = 'message' + (isError ? ' error' : ' success');
  resellerGenMessage.style.display = text ? 'block' : 'none';
}

function updateResellerTopbarProfileFromMe(data) {
  const name = (data && data.username) || '';
  if (resellerTopbarUser) resellerTopbarUser.textContent = name;
  const url = data && data.avatarUrl ? String(data.avatarUrl).trim() : '';
  if (resellerAvatarImg && resellerAvatarInitial) {
    if (url) {
      resellerAvatarImg.src = url;
      resellerAvatarImg.classList.remove('hidden');
      resellerAvatarInitial.classList.add('hidden');
    } else {
      resellerAvatarImg.removeAttribute('src');
      resellerAvatarImg.classList.add('hidden');
      resellerAvatarInitial.classList.remove('hidden');
      resellerAvatarInitial.textContent = (name.charAt(0) || '?').toUpperCase();
    }
  }
  if (resellerDropUser) resellerDropUser.textContent = name || '—';
  if (resellerDropCreated) {
    resellerDropCreated.textContent = data && data.createdAt ? formatDate(data.createdAt) : '—';
  }
  if (resellerDropBalance) resellerDropBalance.textContent = formatBrl(data && data.balance);
  const vol = data && Number(data.totalKeysVolumeBrl);
  if (resellerDropVolume) resellerDropVolume.textContent = formatBrl(Number.isFinite(vol) ? vol : 0);
  const kg = data && data.keysGenerated;
  if (resellerDropKeys) resellerDropKeys.textContent = String(kg != null ? kg : 0);
  const cc = data && data.clientsCount;
  if (resellerDropClients) resellerDropClients.textContent = String(cc != null ? cc : 0);
  if (resellerPhraseHint) {
    resellerPhraseHint.textContent = data && data.hasSecretPhrase
      ? 'Palavra-chave de login: ativa (obrigatória em novos acessos).'
      : 'Palavra-chave de login: ainda não definida — defina abaixo para proteger a conta.';
  }
}

function closeResellerProfileDropdown() {
  if (!resellerProfileDropdown) return;
  resellerProfileDropdown.classList.add('hidden');
  if (btnResellerAvatarPick) btnResellerAvatarPick.setAttribute('aria-expanded', 'false');
  if (btnResellerProfileText) btnResellerProfileText.setAttribute('aria-expanded', 'false');
}

function closeAllResellerModals() {
  destroyResellerRankingChart();
  [resellerModalPerfil, resellerModalVendas, resellerModalRanking].forEach(function (el) {
    if (!el) return;
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
  });
}

async function openResellerModal(which) {
  const map = { perfil: resellerModalPerfil, vendas: resellerModalVendas, ranking: resellerModalRanking };
  const el = map[which];
  if (!el) return;
  if (which === 'perfil' || which === 'vendas') await refreshMe();
  closeAllResellerModals();
  closeResellerProfileDropdown();
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden', 'false');
  if (which === 'ranking') {
    void loadResellerLeaderboard();
  }
}

let resellerRankingChartInstance = null;
let resellerRankingRequestId = 0;

function destroyResellerRankingChart() {
  if (resellerRankingAvatarLayer) resellerRankingAvatarLayer.innerHTML = '';
  if (resellerRankingChartInstance) {
    try {
      resellerRankingChartInstance.destroy();
    } catch (_) {}
    resellerRankingChartInstance = null;
  }
}

function setRankingUiLoading() {
  if (resellerRankingStatus) {
    resellerRankingStatus.textContent = 'Carregando…';
    resellerRankingStatus.classList.remove('hidden');
  }
  if (resellerRankingChartWrap) resellerRankingChartWrap.classList.add('hidden');
  destroyResellerRankingChart();
}

function setRankingUiError(msg) {
  if (resellerRankingStatus) {
    resellerRankingStatus.textContent = msg;
    resellerRankingStatus.classList.remove('hidden');
  }
  if (resellerRankingChartWrap) resellerRankingChartWrap.classList.add('hidden');
  destroyResellerRankingChart();
}

function setRankingUiSuccessChart() {
  if (resellerRankingStatus) {
    resellerRankingStatus.textContent = '';
    resellerRankingStatus.classList.add('hidden');
  }
}

/** Coroa no topo da barra: 1 ouro, 2 prata, 3 bronze. */
function drawRankingCrownOnBar(ctx, centerX, barTopY, rank) {
  const r = Number(rank);
  if (r < 1 || r > 3 || typeof barTopY !== 'number') return;
  const palette = [
    { fill: '#EAB308', stroke: '#A16207', hi: '#FEF08A' },
    { fill: '#94A3B8', stroke: '#475569', hi: '#F1F5F9' },
    { fill: '#C2410C', stroke: '#7C2D12', hi: '#FDBA74' },
  ];
  const p = palette[r - 1];
  const y = barTopY + 14;
  ctx.save();
  ctx.translate(centerX, y);
  ctx.beginPath();
  ctx.moveTo(-11, 5);
  ctx.lineTo(-9, -7);
  ctx.lineTo(-5, -1);
  ctx.lineTo(0, -9);
  ctx.lineTo(5, -1);
  ctx.lineTo(9, -7);
  ctx.lineTo(11, 5);
  ctx.closePath();
  const g = ctx.createLinearGradient(-11, -9, 11, 5);
  g.addColorStop(0, p.hi);
  g.addColorStop(0.5, p.fill);
  g.addColorStop(1, p.fill);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = p.stroke;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.font = '600 10px system-ui, Segoe UI, sans-serif';
  ctx.fillStyle = 'rgba(245, 245, 250, 0.98)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  ctx.fillText('#' + r, centerX, barTopY + 22);
  ctx.restore();
}

/** Prefixo por posição: 1 coroa ouro; 2 e 3 medalhas (o emoji 👑 é sempre dourado para todos). */
function rankingNamePrefix(rank) {
  const r = Number(rank);
  if (r === 1) return '👑 ';
  if (r === 2) return '🥈 ';
  if (r === 3) return '🥉 ';
  return '';
}

/** Centro X da barra (fallback no eixo quando o elemento está skipped). */
function getRankingBarCenterX(chart, i, el) {
  if (el && typeof el.x === 'number' && !isNaN(el.x)) return el.x;
  const xs = chart.scales && chart.scales.x;
  if (xs && typeof xs.getPixelForTick === 'function') {
    try {
      return xs.getPixelForTick(i);
    } catch (_) {}
  }
  return null;
}

function layoutRankingAvatarLayer(chart) {
  const canvas = chart && chart.canvas;
  if (!resellerRankingAvatarLayer || !canvas || !resellerRankingChartWrap) return;
  const layer = resellerRankingAvatarLayer;
  layer.style.position = 'absolute';
  layer.style.left = canvas.offsetLeft + 'px';
  layer.style.top = canvas.offsetTop + 'px';
  layer.style.width = canvas.offsetWidth + 'px';
  layer.style.height = canvas.offsetHeight + 'px';
  layer.style.pointerEvents = 'none';
  layer.style.zIndex = '2';
}

/** Avatares em HTML sobre o canvas — o browser carrega data URLs como no resto do painel. */
function syncResellerRankingAvatarLayer(chart, rows) {
  const layer = resellerRankingAvatarLayer;
  if (!layer || !chart || !rows || !rows.length) {
    if (layer) layer.innerHTML = '';
    return;
  }
  layoutRankingAvatarLayer(chart);
  const R = 16;
  const canvas = chart.canvas;
  const cw = canvas.width || chart.width || 1;
  const ch = canvas.height || chart.height || 1;
  const yAvatar = ch - R - 12;
  const sx = canvas.clientWidth / cw;
  const sy = canvas.clientHeight / ch;
  const meta = chart.getDatasetMeta(0);
  const bars = meta && meta.data ? meta.data : [];

  layer.innerHTML = '';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const el = bars[i];
    const x = getRankingBarCenterX(chart, i, el);
    if (x == null) continue;
    const url = row.avatarUrl && String(row.avatarUrl).trim();
    const fullName = String(row.username || '');
    const slot = document.createElement('div');
    slot.className = 'reseller-ranking-avatar-slot';
    slot.style.left = x * sx + 'px';
    slot.style.top = yAvatar * sy + 'px';
    slot.style.transform = 'translate(-50%, -50%)';
    if (url) {
      const img = document.createElement('img');
      img.className = 'reseller-ranking-avatar-img';
      img.alt = '';
      img.decoding = 'async';
      img.src = url;
      img.onerror = function () {
        img.remove();
        const ini = document.createElement('span');
        ini.className = 'reseller-ranking-avatar-initial';
        ini.textContent = (fullName.charAt(0) || '?').toUpperCase();
        slot.appendChild(ini);
      };
      slot.appendChild(img);
    } else {
      const ini = document.createElement('span');
      ini.className = 'reseller-ranking-avatar-initial';
      ini.textContent = (fullName.charAt(0) || '?').toUpperCase();
      slot.appendChild(ini);
    }
    layer.appendChild(slot);
  }
}

function ensureRankingAvatarPluginRegistered() {
  if (ensureRankingAvatarPluginRegistered._done || typeof Chart === 'undefined') return;
  ensureRankingAvatarPluginRegistered._done = true;
  Chart.register({
    id: 'resellerRankingAvatars',
    afterDraw: function (chart) {
      const plug = chart.options.plugins && chart.options.plugins.resellerRankingAvatars;
      const rows = plug && plug.rows;
      if (!rows || !rows.length) return;
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data || !meta.data.length) return;
      const ctx = chart.ctx;
      const R = 16;
      const canvas0 = chart.canvas;
      const ch0 = canvas0 && canvas0.height ? canvas0.height : chart.height;
      const yAvatar = ch0 - R - 12;
      const n = Math.min(meta.data.length, rows.length);
      for (let i = 0; i < n; i++) {
        const el = meta.data[i];
        const row = rows[i];
        if (!row) continue;
        const x = getRankingBarCenterX(chart, i, el);
        if (x == null) continue;
        if (Number(row.rank) >= 1 && Number(row.rank) <= 3 && el && !el.skip && typeof el.y === 'number') {
          drawRankingCrownOnBar(ctx, x, el.y, row.rank);
        }
        const fullName = String(row.username || '');
        const shortName = fullName.length > 14 ? fullName.slice(0, 12) + '…' : fullName;
        const label = rankingNamePrefix(row.rank) + shortName;
        const yNameBottom = yAvatar - R - 8;
        ctx.save();
        ctx.fillStyle = 'rgba(230, 230, 240, 0.95)';
        ctx.font = '600 11px system-ui, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, x, yNameBottom);
        ctx.restore();
      }
      syncResellerRankingAvatarLayer(chart, rows);
    },
  });
}

/** Garante avatar no ranking para o utilizador atual (API /me ou mesma foto do topbar). */
function applyLeaderboardAvatarFallbacks(rows, meUsername, meAvatarFromApi) {
  const uMe = String(meUsername || '').trim();
  if (!uMe || !rows || !rows.length) return rows;
  const fromApi = meAvatarFromApi && String(meAvatarFromApi).trim();
  let fromDom = '';
  if (resellerAvatarImg && !resellerAvatarImg.classList.contains('hidden')) {
    fromDom = (resellerAvatarImg.getAttribute('src') || resellerAvatarImg.src || '').trim();
  }
  const fallback = fromApi || fromDom;
  if (!fallback) return rows;
  return rows.map(function (row) {
    if (String(row.username || '').trim() !== uMe) return row;
    const existing = row.avatarUrl && String(row.avatarUrl).trim();
    if (existing) return row;
    return Object.assign({}, row, { avatarUrl: fallback });
  });
}

function renderResellerRankingChart(rows, me) {
  if (!resellerRankingChartWrap || !resellerRankingChartCanvas) return;
  if (typeof Chart === 'undefined') {
    setRankingUiError('Biblioteca do gráfico não carregou. Verifique a rede ou recarregue a página.');
    return;
  }
  destroyResellerRankingChart();
  ensureRankingAvatarPluginRegistered();
  const labels = rows.map(function (r) {
    const u = String(r.username || '');
    return u.length > 16 ? u.slice(0, 14) + '…' : u;
  });
  const volumes = rows.map(function (r) {
    return Number(r.totalKeysVolumeBrl) || 0;
  });
  const bg = rows.map(function (r) {
    return String(r.username) === String(me) ? 'rgba(167, 139, 250, 0.88)' : 'rgba(148, 163, 184, 0.55)';
  });
  var chartH = Math.min(720, Math.max(480, Math.floor(typeof window !== 'undefined' ? window.innerHeight * 0.58 : 520)));
  resellerRankingChartWrap.style.height = chartH + 'px';
  resellerRankingChartWrap.style.minHeight = chartH + 'px';
  resellerRankingChartWrap.classList.remove('hidden');
  setRankingUiSuccessChart();
  const ctx = resellerRankingChartCanvas.getContext('2d');
  resellerRankingChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Volume (R$)',
          data: volumes,
          backgroundColor: bg,
          borderWidth: 0,
          borderRadius: 5,
          maxBarThickness: rows.length <= 8 ? 32 : 26,
          categoryPercentage: 0.98,
          barPercentage: 0.34,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 450 },
      layout: {
        padding: { top: 20, bottom: 76 },
      },
      plugins: {
        legend: { display: false },
        resellerRankingAvatars: { rows: rows },
        tooltip: {
          callbacks: {
            title: function (items) {
              const row = rows[items[0].dataIndex];
              if (!row) return '';
              return rankingNamePrefix(row.rank) + String(row.username);
            },
            label: function (item) {
              const row = rows[item.dataIndex];
              if (!row) return '';
              return 'Gasto: ' + formatBrl(row.totalKeysVolumeBrl);
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            display: false,
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.08)' },
          ticks: {
            color: 'rgba(200, 200, 210, 0.85)',
            callback: function (v) {
              return 'R$ ' + v;
            },
          },
        },
      },
    },
  });
}

async function loadResellerLeaderboard() {
  if (!resellerRankingStatus && !resellerRankingChartWrap) return;
  const reqId = ++resellerRankingRequestId;
  setRankingUiLoading();
  try {
    const [r, rMe] = await Promise.all([
      fetch(API + '/api/reseller/leaderboard', {
        headers: { ...resellerHeaders(), Accept: 'application/json' },
      }),
      fetch(API + '/api/reseller/me', { headers: { ...resellerHeaders(), Accept: 'application/json' } }),
    ]);
    const data = await readResellerJson(r);
    const meData = await readResellerJson(rMe);
    if (reqId !== resellerRankingRequestId) return;
    if (data.__apiHtml || !r.ok) {
      setRankingUiError(
        r.status === 401 ? 'Sessão expirada. Entre de novo.' : 'Não foi possível carregar o ranking.'
      );
      return;
    }
    let rows = data.leaderboard || [];
    const me = data.me || '';
    const meAv =
      !meData.__apiHtml && rMe.ok && meData.avatarUrl ? String(meData.avatarUrl).trim() : '';
    rows = applyLeaderboardAvatarFallbacks(rows, me, meAv);
    if (rows.length === 0) {
      setRankingUiError('Ainda não há revendedores.');
      return;
    }
    renderResellerRankingChart(rows, me);
  } catch (_) {
    if (reqId === resellerRankingRequestId) setRankingUiError('Erro de rede.');
  }
}

async function toggleResellerProfileDropdown() {
  const dd = resellerProfileDropdown;
  if (!dd) return;
  const opening = dd.classList.contains('hidden');
  dd.classList.toggle('hidden', !opening);
  const expanded = !dd.classList.contains('hidden');
  if (btnResellerAvatarPick) btnResellerAvatarPick.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  if (btnResellerProfileText) btnResellerProfileText.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function resizeImageFileToJpegDataUrl(file, maxEdge, quality, done) {
  const blobUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = function () {
    URL.revokeObjectURL(blobUrl);
    try {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (!w || !h) {
        done(new Error('imagem'));
        return;
      }
      const scale = Math.min(maxEdge / w, maxEdge / h, 1);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      done(null, canvas.toDataURL('image/jpeg', quality));
    } catch (e) {
      done(e);
    }
  };
  img.onerror = function () {
    URL.revokeObjectURL(blobUrl);
    done(new Error('imagem'));
  };
  img.src = blobUrl;
}

function parseResellerApiError(r, text) {
  try {
    const j = JSON.parse(text);
    if (j && j.error) return j.error;
  } catch (_) {}
  const t = (text || '').trim();
  if (t) return t.slice(0, 200);
  if (r.status === 413) return 'Imagem demasiado grande para o servidor.';
  return r.statusText || 'Falha ao guardar foto';
}

async function uploadResellerAvatarDataUrl(dataUrl) {
  const r = await fetch(API + '/api/reseller/me', {
    method: 'POST',
    headers: { ...resellerHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatarUrl: dataUrl }),
  });
  const text = await r.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = {};
  }
  if (!r.ok) throw new Error(parseResellerApiError(r, text));
  return data;
}

async function refreshMe() {
  try {
    const r = await fetch(API + '/api/reseller/me', { headers: resellerHeaders() });
    const data = await readResellerJson(r);
    if (data.__apiHtml || !r.ok) return false;
    if (resellerBalanceDisplay) resellerBalanceDisplay.textContent = formatBrl(data.balance);
    show(resellerMpWarning, !data.mpConfigured);
    updateResellerTopbarProfileFromMe(data);
    return true;
  } catch (_) {
    return false;
  }
}

async function saveResellerSecretPhrase() {
  const n = (resellerPhraseNew && resellerPhraseNew.value || '').trim();
  const c = (resellerPhraseConfirm && resellerPhraseConfirm.value || '').trim();
  if (n !== c) {
    showToast('As palavras-chave não coincidem.', 'error');
    return;
  }
  if (n.length < 4) {
    showToast('Use pelo menos 4 caracteres.', 'error');
    return;
  }
  const u = sessionStorage.getItem(STORAGE_USER);
  const p = sessionStorage.getItem(STORAGE_PASS);
  try {
    const r = await fetch(API + '/api/reseller/secret-phrase', {
      method: 'POST',
      headers: resellerHeaders(),
      body: JSON.stringify({ palavraChave: n }),
    });
    const data = await readResellerJson(r);
    if (data.__apiHtml || !r.ok) {
      showToast((data && data.error) || 'Erro ao guardar.', 'error');
      return;
    }
    if (resellerPhraseNew) resellerPhraseNew.value = '';
    if (resellerPhraseConfirm) resellerPhraseConfirm.value = '';
    setResellerAuth(u, p, n);
    if (isResellerRememberEnabled()) setRememberedResellerAuth(u, p, n);
    showToast('Palavra-chave guardada.', 'success');
    await refreshMe();
  } catch (_) {
    showToast('Erro de conexão.', 'error');
  }
}

function openResellerResetPasswordModal(token) {
  pendingPasswordResetToken = token && String(token).trim() ? String(token).trim() : null;
  if (resellerResetPasswordModal) {
    resellerResetPasswordModal.classList.remove('hidden');
    resellerResetPasswordModal.setAttribute('aria-hidden', 'false');
  }
  if (resellerResetNew) resellerResetNew.value = '';
  if (resellerResetConfirm) resellerResetConfirm.value = '';
  if (resellerResetError) resellerResetError.textContent = '';
  if (resellerResetNew) setTimeout(function () { resellerResetNew.focus(); }, 80);
}

function closeResellerResetPasswordModal() {
  pendingPasswordResetToken = null;
  if (resellerResetPasswordModal) {
    resellerResetPasswordModal.classList.add('hidden');
    resellerResetPasswordModal.setAttribute('aria-hidden', 'true');
  }
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.has('reset')) {
      u.searchParams.delete('reset');
      window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    }
  } catch (_) {}
}

async function clearResellerSecretPhrase() {
  const u = sessionStorage.getItem(STORAGE_USER);
  const p = sessionStorage.getItem(STORAGE_PASS);
  try {
    const r = await fetch(API + '/api/reseller/secret-phrase', {
      method: 'POST',
      headers: resellerHeaders(),
      body: JSON.stringify({ clear: true }),
    });
    const data = await readResellerJson(r);
    if (data.__apiHtml || !r.ok) {
      showToast((data && data.error) || 'Erro ao remover.', 'error');
      return;
    }
    if (resellerPhraseNew) resellerPhraseNew.value = '';
    if (resellerPhraseConfirm) resellerPhraseConfirm.value = '';
    setResellerAuth(u, p, '');
    if (isResellerRememberEnabled()) setRememberedResellerAuth(u, p, '');
    showToast('Palavra-chave removida.', 'success');
    await refreshMe();
  } catch (_) {
    showToast('Erro de conexão.', 'error');
  }
}

function buildLoaderCardsHtml(accounts) {
  if (!accounts || accounts.length === 0) {
    return (
      '<p class="empty">Ninguém registrou ainda com suas keys. Quando alguém usar uma key no registro do loader, o usuário aparece aqui.</p>'
    );
  }
  return accounts
    .map((a) => {
      const orphanNote = a.orphan
        ? '<div class="meta reseller-orphan">Conta loader não encontrada no servidor (ex.: removida pelo admin). <strong>Remover vínculo</strong> tira este nome da lista e libera a key para novo uso, se ainda for válida.</div>'
        : '';
      const hwidShort = a.hwid ? escapeHtml(String(a.hwid).slice(0, 18)) + (a.hwid.length > 18 ? '…' : '') : '—';
      const exp = a.expiresAt ? formatDate(a.expiresAt) : 'Permanente';
      const on = a.online
        ? '<span class="reseller-tag reseller-tag-ok">Online</span>'
        : '<span class="reseller-tag reseller-tag-muted">Offline</span>';
      const pause = a.paused ? ' · <strong>Pausada</strong>' : '';
      const skip = a.skipHwidCheck ? ' · Sem HWID' : '';
      const u = escapeHtml(a.username);
      const actions = a.orphan
        ? '<div class="actions">' +
          '<button type="button" class="danger btn-reseller-remove-loader" data-username="' +
          u +
          '" data-orphan="1">Remover vínculo</button>' +
          '</div>'
        : '<div class="actions">' +
          (a.hwid && !a.skipHwidCheck
            ? '<button type="button" class="btn-secondary btn-reseller-reset-hwid" data-username="' +
              u +
              '">Reset HWID</button>'
            : '') +
          '<button type="button" class="btn-secondary btn-reseller-pause-loader' +
          (a.paused ? ' is-paused' : '') +
          '" data-username="' +
          u +
          '">' +
          (a.paused ? 'Retomar' : 'Pausar') +
          '</button>' +
          '<button type="button" class="danger btn-reseller-remove-loader" data-username="' +
          u +
          '">Excluir conta</button>' +
          '</div>';
      return (
        '<div class="key-item">' +
        '<div>' +
        '<div class="id">' +
        u +
        ' ' +
        on +
        '</div>' +
        '<div class="meta">HWID: <code class="reseller-hwid-snippet">' +
        hwidShort +
        '</code>' +
        skip +
        pause +
        '</div>' +
        '<div class="meta">Expira: ' +
        escapeHtml(exp) +
        (a.lastLoginAt ? ' · Último login: ' + formatDate(a.lastLoginAt) : '') +
        '</div>' +
        orphanNote +
        '</div>' +
        actions +
        '</div>'
      );
    })
    .join('');
}

function bindResellerLoaderActions(root) {
  if (!root) return;
  root.querySelectorAll('.btn-reseller-reset-hwid').forEach((btn) => {
    btn.addEventListener('click', () => resellerResetHwid(btn.getAttribute('data-username')));
  });
  root.querySelectorAll('.btn-reseller-pause-loader').forEach((btn) => {
    btn.addEventListener('click', () => resellerTogglePauseLoader(btn.getAttribute('data-username')));
  });
  root.querySelectorAll('.btn-reseller-remove-loader').forEach((btn) => {
    btn.addEventListener('click', () =>
      resellerRemoveLoader(btn.getAttribute('data-username'), btn.getAttribute('data-orphan') === '1')
    );
  });
}

async function resellerResetHwid(username) {
  if (!username) return;
  if (!window.confirm('Resetar HWID de "' + username + '"? A pessoa poderá logar de outro PC.')) return;
  try {
    const r = await fetch(
      API + '/api/reseller/loader-accounts/' + encodeURIComponent(username) + '/reset-hwid',
      { method: 'POST', headers: resellerHeaders() }
    );
    const data = await readResellerJson(r);
    if (data.__apiHtml) {
      showToast('Resposta inválida do servidor.', 'error');
      return;
    }
    if (!r.ok) {
      showToast(data.error || 'Erro ao resetar HWID.', 'error');
      return;
    }
    showToast('HWID resetado.', 'success');
    await loadMyLoaders();
  } catch (e) {
    showToast('Erro de conexão.', 'error');
  }
}

async function resellerTogglePauseLoader(username) {
  if (!username) return;
  try {
    const r = await fetch(
      API + '/api/reseller/loader-accounts/' + encodeURIComponent(username) + '/pause',
      { method: 'POST', headers: resellerHeaders(), body: JSON.stringify({}) }
    );
    const data = await readResellerJson(r);
    if (data.__apiHtml) {
      showToast('Resposta inválida do servidor.', 'error');
      return;
    }
    if (!r.ok) {
      showToast(data.error || 'Erro ao alterar pausa.', 'error');
      return;
    }
    showToast(data.paused ? 'Conta pausada.' : 'Conta retomada.', 'success');
    await loadMyLoaders();
  } catch (e) {
    showToast('Erro de conexão.', 'error');
  }
}

async function resellerRemoveLoader(username, isOrphan) {
  if (!username) return;
  const msg = isOrphan
    ? 'Remover o vínculo de "' +
      username +
      '" com suas keys? As keys afetadas voltarão a aparecer como não resgatadas (se ainda forem válidas).'
    : 'Excluir a conta loader "' + username + '"? Esta ação não pode ser desfeita.';
  if (!window.confirm(msg)) return;
  try {
    const r = await fetch(API + '/api/reseller/loader-accounts/' + encodeURIComponent(username), {
      method: 'DELETE',
      headers: resellerHeaders(),
    });
    const data = await readResellerJson(r);
    if (data.__apiHtml) {
      showToast('Resposta inválida do servidor.', 'error');
      return;
    }
    if (!r.ok) {
      showToast(data.error || 'Erro ao remover.', 'error');
      return;
    }
    showToast(isOrphan ? 'Vínculo removido.' : 'Conta removida.', 'success');
    await loadMyLoaders();
  } catch (e) {
    showToast('Erro de conexão.', 'error');
  }
}

function applyLoaderSearchFilter() {
  if (!resellerMyLoadersList) return;
  if (lastResellerLoaders.length === 0) {
    resellerMyLoadersList.innerHTML = buildLoaderCardsHtml([]);
    bindResellerLoaderActions(resellerMyLoadersList);
    return;
  }
  const q = (resellerLoaderSearch && resellerLoaderSearch.value || '').trim().toLowerCase();
  let acc = lastResellerLoaders;
  if (q) acc = lastResellerLoaders.filter((a) => String(a.username || '').toLowerCase().includes(q));
  if (q && acc.length === 0) {
    resellerMyLoadersList.innerHTML = '<p class="empty">Nenhum usuário encontrado para esta busca.</p>';
    return;
  }
  resellerMyLoadersList.innerHTML = buildLoaderCardsHtml(acc);
  bindResellerLoaderActions(resellerMyLoadersList);
}

async function loadMyKeys() {
  if (!resellerMyKeysList) return;
  resellerMyKeysList.innerHTML = '<p class="empty">Carregando…</p>';
  try {
    const r = await fetch(API + '/api/reseller/my-keys', { headers: resellerHeaders(), cache: 'no-store' });
    const data = await readResellerJson(r);
    if (data.__apiHtml) {
      resellerMyKeysList.innerHTML =
        '<p class="empty">O servidor está servindo o painel em vez da API do revendedor. Pare o Node antigo e inicie de novo com <code>node server.js</code> (ou faça redeploy).</p>';
      return;
    }
    if (!r.ok) {
      resellerMyKeysList.innerHTML =
        '<p class="empty">' + escapeHtml(data.error || 'Não foi possível carregar.') + '</p>';
      return;
    }
    const keys = data.keys || [];
    if (keys.length === 0) {
      resellerMyKeysList.innerHTML = '<p class="empty">Você ainda não gerou nenhuma key.</p>';
      return;
    }
    resellerMyKeysList.innerHTML = keys
      .map((k) => {
        const used = k.usedAt && k.usedBy;
        const status = k.paused
          ? '<span class="reseller-tag reseller-tag-warn">Pausada</span>'
          : used
            ? k.expired
              ? '<span class="reseller-tag reseller-tag-muted">Resgatada · expirada</span>'
              : '<span class="reseller-tag reseller-tag-ok">Resgatada</span>'
            : '<span class="reseller-tag">Disponível</span>';
        const who = used
          ? '<div class="meta">Resgatada por <strong>' +
            escapeHtml(k.usedBy) +
            '</strong> em ' +
            formatDate(k.usedAt) +
            '</div>'
          : '';
        return (
          '<div class="key-item">' +
          '<div>' +
          '<div class="id"><code class="redeem-code-inline">' +
          escapeHtml(k.code) +
          '</code> ' +
          status +
          '</div>' +
          '<div class="meta">' +
          formatDuration(k.expiresInSeconds) +
          ' · Criada em ' +
          formatDate(k.createdAt) +
          '</div>' +
          who +
          '</div>' +
          '<div class="actions">' +
          '<button type="button" class="btn-secondary btn-copy-mk" data-code="' +
          escapeHtml(k.code) +
          '">Copiar</button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
    resellerMyKeysList.querySelectorAll('.btn-copy-mk').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = btn.dataset.code;
        if (c) navigator.clipboard.writeText(c).then(() => showToast('Copiado.', 'success'));
      });
    });
  } catch (e) {
    resellerMyKeysList.innerHTML = '<p class="empty">Erro de conexão.</p>';
  }
}

async function loadMyLoaders() {
  if (resellerMyLoadersList) resellerMyLoadersList.innerHTML = '<p class="empty">Carregando…</p>';
  try {
    const r = await fetch(API + '/api/reseller/my-loaders', { headers: resellerHeaders(), cache: 'no-store' });
    const data = await readResellerJson(r);
    if (data.__apiHtml) {
      const err =
        '<p class="empty">O servidor está servindo o painel em vez da API. Reinicie <code>node server.js</code> ou atualize o deploy.</p>';
      if (resellerMyLoadersList) resellerMyLoadersList.innerHTML = err;
      return;
    }
    if (!r.ok) {
      const err = '<p class="empty">' + escapeHtml(data.error || 'Não foi possível carregar.') + '</p>';
      if (resellerMyLoadersList) resellerMyLoadersList.innerHTML = err;
      return;
    }
    lastResellerLoaders = data.accounts || [];
    applyLoaderSearchFilter();
  } catch (e) {
    const err = '<p class="empty">Erro de conexão.</p>';
    if (resellerMyLoadersList) resellerMyLoadersList.innerHTML = err;
  }
}

function paneIdForTab(tabName) {
  return 'tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
}

function switchResellerTab(tabName) {
  const paneId = paneIdForTab(tabName);
  document.querySelectorAll('#resellerPanel .main-content .tab-pane').forEach((p) => {
    p.classList.toggle('active', p.id === paneId);
  });
  document.querySelectorAll('.reseller-sidebar-nav .tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  const btn = document.querySelector('.reseller-sidebar-nav .tab[data-tab="' + tabName + '"]');
  if (resellerTopbarTitle && btn && btn.dataset.title) resellerTopbarTitle.textContent = btn.dataset.title;
  if (resellerTopbarSubtitle && btn && btn.dataset.subtitle) resellerTopbarSubtitle.textContent = btn.dataset.subtitle;
  try {
    sessionStorage.setItem(STORAGE_ACTIVE_TAB, tabName);
  } catch (_) {}
  if (tabName === 'rkeys') loadMyKeys();
  if (tabName === 'rcontas') loadMyLoaders();
  if (tabName === 'rgerar') loadPlans();
  if (tabName === 'rpix') {
    if (resellerTopbarTitle) resellerTopbarTitle.textContent = 'Recarga PIX';
    if (resellerTopbarSubtitle) resellerTopbarSubtitle.textContent = 'Saldo via Mercado Pago';
  } else {
    showTopupMessage('');
  }
}

let resellerTabsBound = false;
function bindResellerTabs() {
  if (resellerTabsBound) return;
  resellerTabsBound = true;
  document.querySelectorAll('.reseller-sidebar-nav .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab) switchResellerTab(tab);
    });
  });
  if (btnSidebarPix) {
    btnSidebarPix.addEventListener('click', () => switchResellerTab('rpix'));
  }
  if (resellerLoaderSearch) {
    resellerLoaderSearch.addEventListener('input', () => applyLoaderSearchFilter());
  }
}

async function loadPlans() {
  if (!resellerPlansGrid) return;
  try {
    const r = await fetch(API + '/api/reseller/plans');
    const data = await r.json();
    const plans = data.plans || [];
    resellerPlansGrid.innerHTML = plans
      .map(
        (p) =>
          '<button type="button" class="reseller-plan-btn" data-plan="' +
          escapeHtml(p.id) +
          '">' +
          '<span class="reseller-plan-label">' +
          escapeHtml(p.label) +
          '</span>' +
          '<span class="reseller-plan-price">' +
          formatBrl(p.price) +
          '</span>' +
          '</button>'
      )
      .join('');
    resellerPlansGrid.querySelectorAll('.reseller-plan-btn').forEach((btn) => {
      btn.addEventListener('click', () => generateRedeem(btn.dataset.plan));
    });
  } catch (_) {
    resellerPlansGrid.innerHTML = '<p class="empty">Não foi possível carregar os planos.</p>';
  }
}

async function generateRedeem(planId) {
  showGenMessage('');
  if (resellerLastCode) {
    resellerLastCode.classList.add('hidden');
    resellerLastCode.innerHTML = '';
  }
  try {
    const r = await fetch(API + '/api/reseller/generate-redeem', {
      method: 'POST',
      headers: resellerHeaders(),
      body: JSON.stringify({ plan: planId }),
    });
    const data = await readResellerJson(r);
    if (data.__apiHtml) {
      showGenMessage(
        'Servidor sem a API do revendedor (processo antigo?). Reinicie com node server.js ou atualize o deploy.',
        true
      );
      return;
    }
    if (!r.ok) {
      showGenMessage(data.error || 'Erro ao gerar.', true);
      return;
    }
    showGenMessage('Key gerada com sucesso.', false);
    showToast('Key: ' + data.code, 'success');
    if (resellerBalanceDisplay) resellerBalanceDisplay.textContent = formatBrl(data.balance);
    if (resellerLastCode) {
      resellerLastCode.classList.remove('hidden');
      resellerLastCode.innerHTML =
        '<p class="card-desc"><strong>Código:</strong> <code class="reseller-code">' +
        escapeHtml(data.code) +
        '</code> <button type="button" class="btn-secondary btn-copy-code">Copiar</button></p>';
      const btn = resellerLastCode.querySelector('.btn-copy-code');
      if (btn)
        btn.addEventListener('click', () => {
          navigator.clipboard.writeText(data.code).then(() => showToast('Copiado.', 'success'));
        });
    }
    loadMyLoaders();
    switchResellerTab('rkeys');
  } catch (e) {
    showGenMessage('Erro de conexão.', true);
  }
}

function displayQr(qr) {
  if (!qr) return;
  const b64 = qr.base64;
  const code = qr.code;
  if (resellerQrImg) {
    if (b64) {
      resellerQrImg.src = b64.indexOf('data:') === 0 ? b64 : 'data:image/png;base64,' + b64;
      resellerQrImg.classList.remove('hidden');
    } else {
      resellerQrImg.classList.add('hidden');
      resellerQrImg.removeAttribute('src');
    }
  }
  if (resellerQrCodeText) {
    if (code) {
      resellerQrCodeText.innerHTML =
        '<label class="duration-label">PIX copia e cola</label>' +
        '<textarea readonly class="full-width reseller-pix-textarea" rows="4">' +
        escapeHtml(code) +
        '</textarea>' +
        '<button type="button" class="btn-secondary" id="btnCopyPix">Copiar código</button>';
      const copyBtn = document.getElementById('btnCopyPix');
      if (copyBtn)
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(code).then(() => showToast('Código PIX copiado.', 'success'));
        });
    } else {
      resellerQrCodeText.innerHTML = '';
    }
  }
}

async function doTopup() {
  showTopupMessage('');
  const raw = (resellerTopupAmount && resellerTopupAmount.value) || '';
  const amount = parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 1) {
    showTopupMessage('Informe um valor válido (mínimo R$ 1,00).', true);
    return;
  }
  try {
    const r = await fetch(API + '/api/reseller/topup', {
      method: 'POST',
      headers: resellerHeaders(),
      body: JSON.stringify({ amount }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showTopupMessage(data.error || 'Erro ao criar pagamento.', true);
      return;
    }
    lastPaymentId = String(data.paymentId || '');
    sessionStorage.setItem(STORAGE_LAST_PAYMENT, lastPaymentId);
    showTopupMessage('QR gerado. Pague e depois clique em “Já paguei”.', false);
    if (resellerPaymentId) resellerPaymentId.textContent = lastPaymentId;
    show(resellerQrSection, true);
    displayQr(data.qr);
    if (!data.qr || (!data.qr.base64 && !data.qr.code)) {
      showTopupMessage('Pagamento criado, mas o QR não veio na resposta. Use o app Mercado Pago ou consulte o painel MP.', true);
    }
  } catch (e) {
    showTopupMessage('Erro de conexão.', true);
  }
}

async function pollPayment() {
  if (!lastPaymentId) {
    showToast('Nenhum pagamento pendente.', 'error');
    return;
  }
  showTopupMessage('Consultando…', false);
  try {
    const r = await fetch(API + '/api/reseller/payment/' + encodeURIComponent(lastPaymentId), {
      headers: resellerHeaders(),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showTopupMessage(data.error || 'Erro ao consultar.', true);
      return;
    }
    if (data.credited) {
      showToast('Saldo creditado: ' + formatBrl(data.amount || 0), 'success');
      showTopupMessage('');
      if (resellerBalanceDisplay) resellerBalanceDisplay.textContent = formatBrl(data.balance);
      sessionStorage.removeItem(STORAGE_LAST_PAYMENT);
      show(resellerQrSection, false);
      lastPaymentId = '';
    } else if (data.already) {
      if (resellerBalanceDisplay) resellerBalanceDisplay.textContent = formatBrl(data.balance);
      showTopupMessage('Este pagamento já estava registrado.', false);
    } else if (data.pending) {
      showTopupMessage('Pagamento ainda pendente ou em análise. Tente de novo em instantes.', true);
    } else {
      showTopupMessage('Status: ' + (data.status || 'desconhecido'), false);
    }
    await refreshMe();
  } catch (e) {
    showTopupMessage('Erro de conexão.', true);
  }
}

async function trySession() {
  const u = sessionStorage.getItem(STORAGE_USER);
  const p = sessionStorage.getItem(STORAGE_PASS);
  if (!u || !p) return false;
  try {
    const vr = await fetch(API + '/api/auth/vendedor/verify', { headers: resellerHeaders() });
    const vdata = await readResellerJson(vr);
    if (vdata.__apiHtml || !vr.ok || !vdata.ok) {
      setResellerAuth('', '');
      return false;
    }
  } catch (_) {
    setResellerAuth('', '');
    return false;
  }
  const ok = await refreshMe();
  if (!ok) {
    setResellerAuth('', '');
    return false;
  }
  show(resellerLoginBox, false);
  show(resellerPanel, true);
  bindResellerTabs();
  let startTab = 'rcontas';
  try {
    const raw = sessionStorage.getItem(STORAGE_ACTIVE_TAB);
    const saved = raw === 'rusuarios' ? 'rcontas' : raw;
    if (saved && ['rcontas', 'rgerar', 'rkeys', 'rpix'].includes(saved)) startTab = saved;
  } catch (_) {}
  switchResellerTab(startTab);
  lastPaymentId = sessionStorage.getItem(STORAGE_LAST_PAYMENT) || '';
  if (lastPaymentId && resellerPaymentId) {
    resellerPaymentId.textContent = lastPaymentId;
    show(resellerQrSection, true);
  }
  return true;
}

function openResellerPhraseModal(username, password, remember) {
  pendingResellerPhraseLogin = { user: username, password: password, remember: remember };
  if (resellerModalPhraseError) resellerModalPhraseError.textContent = '';
  if (resellerModalSecretPhrase) {
    resellerModalSecretPhrase.value = '';
    const rem = getRememberedResellerAuth();
    if (remember && rem.user === username && rem.phrase) {
      resellerModalSecretPhrase.value = rem.phrase;
    }
  }
  if (resellerPhraseModal) {
    resellerPhraseModal.classList.remove('hidden');
    resellerPhraseModal.setAttribute('aria-hidden', 'false');
  }
  if (resellerModalSecretPhrase) setTimeout(function () { resellerModalSecretPhrase.focus(); }, 80);
}

function closeResellerPhraseModal() {
  pendingResellerPhraseLogin = null;
  if (resellerModalSecretPhrase) resellerModalSecretPhrase.value = '';
  if (resellerModalPhraseError) resellerModalPhraseError.textContent = '';
  if (resellerPhraseModal) {
    resellerPhraseModal.classList.add('hidden');
    resellerPhraseModal.setAttribute('aria-hidden', 'true');
  }
}

async function finishResellerLogin(username, password, phrase, remember) {
  closeResellerPhraseModal();
  setResellerAuth(username, password, phrase);
  if (remember) {
    setResellerRememberEnabled(true);
    setRememberedResellerAuth(username, password, phrase);
  } else clearRememberedResellerAuth();
  show(resellerLoginBox, false);
  show(resellerPanel, true);
  await refreshMe();
  bindResellerTabs();
  switchResellerTab('rcontas');
}

async function confirmResellerPhraseModal() {
  if (!pendingResellerPhraseLogin) return;
  const phrase = (resellerModalSecretPhrase && resellerModalSecretPhrase.value || '').trim();
  if (!phrase) {
    if (resellerModalPhraseError) resellerModalPhraseError.textContent = 'Digite a palavra-chave.';
    return;
  }
  const pl = pendingResellerPhraseLogin;
  if (resellerModalPhraseError) resellerModalPhraseError.textContent = '';
  try {
    const r = await fetch(API + '/api/reseller/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: pl.user, password: pl.password, palavraChave: phrase }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok && !data.needsSecretPhrase) {
      await finishResellerLogin(pl.user, pl.password, phrase, pl.remember);
      return;
    }
    if (resellerModalPhraseError) resellerModalPhraseError.textContent = data.error || 'Palavra-chave incorreta.';
  } catch (e) {
    if (resellerModalPhraseError) resellerModalPhraseError.textContent = 'Erro de conexão.';
  }
}

if (btnResellerLogin) {
  btnResellerLogin.addEventListener('click', async () => {
    if (resellerLoginError) resellerLoginError.textContent = '';
    const username = (resellerLoginUser && resellerLoginUser.value || '').trim();
    const password = (resellerLoginPassword && resellerLoginPassword.value || '').trim();
    if (!username || !password) {
      if (resellerLoginError) resellerLoginError.textContent = 'Preencha usuário e senha.';
      return;
    }
    const remember = resellerRememberLogin && resellerRememberLogin.checked;
    setResellerRememberEnabled(remember);
    /** Só envia palavra-chave no 1.º pedido com «Lembrar» ativo e frase guardada para este utilizador */
    let phraseForLogin = '';
    if (remember) {
      const rem = getRememberedResellerAuth();
      if (rem.user === username && String(rem.phrase || '').trim()) phraseForLogin = String(rem.phrase).trim();
      const keepPhrase = rem.user === username ? rem.phrase : '';
      setRememberedResellerAuth(username, password, keepPhrase);
    } else clearRememberedResellerAuth();
    setResellerAuth('', '', '');
    try {
      const payload = { username: username, password: password };
      if (phraseForLogin) payload.palavraChave = phraseForLogin;
      const r = await fetch(API + '/api/reseller/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      /** 403 = palavra-chave errada: abre sempre o popup (não deixa o erro só no login principal) */
      if (r.status === 403) {
        setRememberedResellerAuth(username, password, '');
        openResellerPhraseModal(username, password, remember);
        if (resellerModalPhraseError) resellerModalPhraseError.textContent = data.error || 'Palavra-chave incorreta.';
        if (resellerLoginError) resellerLoginError.textContent = '';
        return;
      }
      if (r.ok && data.ok && data.needsSecretPhrase) {
        if (resellerLoginError) resellerLoginError.textContent = '';
        openResellerPhraseModal(username, password, remember);
        return;
      }
      if (r.ok && data.ok && !data.needsSecretPhrase) {
        await finishResellerLogin(username, password, phraseForLogin, remember);
        return;
      }
      if (resellerLoginError) resellerLoginError.textContent = data.error || 'Falha no login.';
    } catch (e) {
      if (resellerLoginError) resellerLoginError.textContent = 'Erro de conexão.';
    }
  });
}

if (btnResellerLogout) {
  btnResellerLogout.addEventListener('click', function (e) {
    e.stopPropagation();
    closeResellerProfileDropdown();
    setResellerAuth('', '');
    sessionStorage.removeItem(STORAGE_LAST_PAYMENT);
    lastPaymentId = '';
    updateResellerTopbarProfileFromMe({ username: '', avatarUrl: '' });
    show(resellerPanel, false);
    show(resellerLoginBox, true);
    applyResellerRememberedFields();
  });
}

if (resellerRememberLogin) {
  resellerRememberLogin.addEventListener('change', function () {
    const on = resellerRememberLogin.checked;
    setResellerRememberEnabled(on);
    if (!on) clearRememberedResellerAuth();
    applyResellerRememberedFields();
  });
}

if (btnResellerModalPhraseConfirm) btnResellerModalPhraseConfirm.addEventListener('click', confirmResellerPhraseModal);
if (btnResellerModalPhraseCancel) {
  btnResellerModalPhraseCancel.addEventListener('click', function () {
    closeResellerPhraseModal();
  });
}
if (resellerModalSecretPhrase) {
  resellerModalSecretPhrase.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') void confirmResellerPhraseModal();
  });
}

if (btnSaveResellerPhrase) btnSaveResellerPhrase.addEventListener('click', saveResellerSecretPhrase);
if (btnClearResellerPhrase) btnClearResellerPhrase.addEventListener('click', clearResellerSecretPhrase);

if (btnResellerResetSubmit) {
  btnResellerResetSubmit.addEventListener('click', async function () {
    const a = (resellerResetNew && resellerResetNew.value) || '';
    const b = (resellerResetConfirm && resellerResetConfirm.value) || '';
    if (resellerResetError) resellerResetError.textContent = '';
    if (String(a).trim().length < 4) {
      if (resellerResetError) resellerResetError.textContent = 'Use pelo menos 4 caracteres.';
      return;
    }
    if (String(a).trim() !== String(b).trim()) {
      if (resellerResetError) resellerResetError.textContent = 'As senhas não coincidem.';
      return;
    }
    if (!pendingPasswordResetToken) {
      if (resellerResetError) resellerResetError.textContent = 'Link inválido ou expirado.';
      return;
    }
    try {
      const r = await fetch(API + '/api/reseller/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: pendingPasswordResetToken, newPassword: String(a).trim() }),
      });
      const data = await r.json().catch(function () { return {}; });
      if (r.ok && data.ok) {
        showToast(data.message || 'Senha atualizada. Já pode entrar.', 'success');
        closeResellerResetPasswordModal();
        return;
      }
      if (resellerResetError) resellerResetError.textContent = data.error || 'Não foi possível redefinir.';
    } catch (_) {
      if (resellerResetError) resellerResetError.textContent = 'Erro de conexão.';
    }
  });
}

if (btnResellerTopup) btnResellerTopup.addEventListener('click', doTopup);
if (btnResellerPollPayment) btnResellerPollPayment.addEventListener('click', pollPayment);
if (btnRefreshMyKeys) btnRefreshMyKeys.addEventListener('click', () => loadMyKeys());
if (btnRefreshMyLoaders) btnRefreshMyLoaders.addEventListener('click', () => loadMyLoaders());

if (btnResellerAvatarPick) {
  btnResellerAvatarPick.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleResellerProfileDropdown();
  });
}
if (btnResellerProfileText) {
  btnResellerProfileText.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleResellerProfileDropdown();
  });
}
if (btnResellerChangePhoto && resellerAvatarFile) {
  btnResellerChangePhoto.addEventListener('click', function (e) {
    e.stopPropagation();
    resellerAvatarFile.click();
  });
}
if (resellerProfileDropdown) {
  resellerProfileDropdown.addEventListener('click', function (e) {
    e.stopPropagation();
    const item = e.target.closest('[data-open-modal]');
    if (!item) return;
    const which = item.getAttribute('data-open-modal');
    if (which) void openResellerModal(which);
  });
}
function cleanupResellerRankingIfClosing(backdrop) {
  if (backdrop && backdrop.id === 'resellerModalRanking') {
    destroyResellerRankingChart();
  }
}
document.querySelectorAll('.reseller-modal-backdrop').forEach(function (backdrop) {
  function hideBackdrop() {
    if (backdrop.id === 'resellerResetPasswordModal') closeResellerResetPasswordModal();
    else {
      cleanupResellerRankingIfClosing(backdrop);
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
    }
  }
  backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop) hideBackdrop();
  });
  backdrop.querySelectorAll('.reseller-modal-close').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      hideBackdrop();
    });
  });
});
if (btnResellerRankingRefresh) {
  btnResellerRankingRefresh.addEventListener('click', function (e) {
    e.stopPropagation();
    void loadResellerLeaderboard();
  });
}
document.addEventListener('click', function (e) {
  if (!resellerProfileDropdown || resellerProfileDropdown.classList.contains('hidden')) return;
  const profile = document.querySelector('.reseller-topbar-profile');
  if (profile && profile.contains(e.target)) return;
  closeResellerProfileDropdown();
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (resellerResetPasswordModal && !resellerResetPasswordModal.classList.contains('hidden')) {
    closeResellerResetPasswordModal();
    return;
  }
  const modals = [resellerModalRanking, resellerModalVendas, resellerModalPerfil];
  for (let i = 0; i < modals.length; i++) {
    const m = modals[i];
    if (m && !m.classList.contains('hidden')) {
      cleanupResellerRankingIfClosing(m);
      m.classList.add('hidden');
      m.setAttribute('aria-hidden', 'true');
      return;
    }
  }
  if (resellerProfileDropdown && !resellerProfileDropdown.classList.contains('hidden')) closeResellerProfileDropdown();
});
if (resellerAvatarFile) {
  resellerAvatarFile.addEventListener('change', function () {
    const f = resellerAvatarFile.files && resellerAvatarFile.files[0];
    resellerAvatarFile.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png|gif|webp)$/i.test(f.type)) {
      showToast('Use JPG, PNG, GIF ou WebP.', 'error');
      return;
    }
    if (f.size > 12 * 1024 * 1024) {
      showToast('Ficheiro demasiado grande (máx. 12 MB).', 'error');
      return;
    }
    function uploadAvatarDataUrl(dataUrl) {
      uploadResellerAvatarDataUrl(dataUrl)
        .then(() => refreshMe())
        .then(() => showToast('Foto do perfil atualizada.', 'success'))
        .catch((e) => showToast((e && e.message) || 'Erro ao enviar foto.', 'error'));
    }
    resizeImageFileToJpegDataUrl(f, 384, 0.68, function (err, dataUrl) {
      if (err || !dataUrl) {
        showToast('Não foi possível ler a imagem.', 'error');
        return;
      }
      if (dataUrl.length > 520000) {
        resizeImageFileToJpegDataUrl(f, 256, 0.55, function (err2, dataUrl2) {
          if (err2 || !dataUrl2) {
            showToast('Não foi possível comprimir a imagem.', 'error');
            return;
          }
          uploadAvatarDataUrl(dataUrl2);
        });
        return;
      }
      uploadAvatarDataUrl(dataUrl);
    });
  });
}
try {
  const u = new URL(window.location.href);
  const rt = u.searchParams.get('reset');
  if (rt && String(rt).trim()) {
    openResellerResetPasswordModal(String(rt).trim());
  }
} catch (_) {}

applyResellerRememberedFields();
trySession();
