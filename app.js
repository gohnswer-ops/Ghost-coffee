/*
 * Ghost Caffee v7.4.4 — Web + Android WebView
 * Auth: username/password via Firebase Auth (internal alias) · Realtime Database only
 */
'use strict';

// Move local preferences to the Ghost Caffee namespace without losing existing settings.
(function migrateLegacyStorageKeys() {
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      const oldKeys = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith('chatapp_')) oldKeys.push(key);
      }
      for (const oldKey of oldKeys) {
        const newKey = oldKey.replace(/^chatapp_/, 'ghostcaffee_');
        if (storage.getItem(newKey) === null) storage.setItem(newKey, storage.getItem(oldKey));
        storage.removeItem(oldKey);
      }
    }
  } catch (e) { console.warn('[Ghost Caffee] Storage migration skipped:', e); }
})();

const firebaseConfig = {
  apiKey: 'AIzaSyD6A_BZ7cg8jm4HePzZ0t-74x6ddIlAYA4',
  authDomain: 'chat-otaku-aed68.firebaseapp.com',
  databaseURL: 'https://chat-otaku-aed68-default-rtdb.firebaseio.com',
  projectId: 'chat-otaku-aed68',
  messagingSenderId: '272172230702',
  appId: '1:272172230702:android:d0ea32284d1960a31117bf'
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();
const SERVER = firebase.database.ServerValue.TIMESTAMP;

const APP_VERSION = '7.4.4';
const APP_THEMES = ['coffee', 'navy', 'ocean', 'forest', 'amethyst', 'light'];
const CHAT_WALLPAPERS = ['default', 'dark', 'gray', 'purple', 'sunrise', 'ocean', 'sunset', 'forest', 'dots'];
const STORY_DURATION = 24 * 60 * 60 * 1000;
const STORY_VIEW_MS = 6000;
const MAX_TEXT = 4000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 2800000;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const ROLES = ['user', 'moderator', 'admin', 'owner'];
const STORE_VERSION = 13;
const LOCAL_CACHE_DB = 'ghostcaffee-local-cache-v1';
const LOCAL_CACHE_SCHEMA_VERSION = 2;
const LOCAL_CACHE_READ_TIMEOUT_MS = 2800;
const MOBILE_BP = 768;
const REQUEST_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/* ==================== Utilities ==================== */
const $ = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);
const qsa = sel => [...document.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const escapeHtmlLine = text => esc(text).replace(/\n/g, '<br>');

const resizeMessageInput = () => {
  const el = $('message-input');
  if (!el) return;
  if (el.tagName === 'TEXTAREA') {
    el.style.height = 'auto';
    el.style.height = Math.min(140, Math.max(46, el.scrollHeight)) + 'px';
    el.style.overflowY = el.scrollHeight > 140 ? 'auto' : 'hidden';
  }
};

const normalizeUsername = value => String(value || '').trim().toLowerCase().replace(/^@/, '');
const uid = () => auth.currentUser?.uid || null;
const now = () => Date.now();

// Never let a stale/offline network read block the cached interface indefinitely.
function withDeadline(promise, ms = LOCAL_CACHE_READ_TIMEOUT_MS, label = 'network request') {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out`), { code: 'APP_TIMEOUT' })), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

function requestDurableLocalStorage() {
  try {
    const storage = navigator.storage;
    if (storage?.persist) storage.persist().then(granted => {
      if (granted) console.info('[Ghost Caffee] Persistent origin storage enabled.');
    }).catch(() => {});
  } catch {}
}

const bytes = n =>
  n < 1024 ? `${n} B`
  : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB`
  : `${(n / 1024 / 1024).toFixed(2)} MB`;

const relativeTime = ts => {
  const d = Math.max(0, now() - Number(ts || 0));
  const m = Math.floor(d / 60000);
  const h = Math.floor(m / 60);
  const dd = Math.floor(h / 24);
  return dd ? `${dd} ي` : h ? `${h} س` : m ? `${m} د` : 'الآن';
};

const dayTime = ts => ts
  ? new Date(ts).toLocaleString('ar', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '-';

const isMobile = () => window.innerWidth <= MOBILE_BP;

const safeDataUrl = u => {
  const v = String(u || '');
  return /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+(;[a-z0-9=.+_-]+)*;base64,/i.test(v) ? v : '';
};
const safeImageUrl = u => {
  const v = safeDataUrl(u);
  return /^data:image\//i.test(v) ? v : '';
};
const fileUrl = data => safeDataUrl(data?.dataUrl);

const isOwner = () => !!S.me?.id && S.me.id === S.ownerUid;
const isAdmin = () => isOwner() || S.me?.role === 'admin';
const isStaff = () => isAdmin() || S.me?.role === 'moderator';
const isPrivilegedTarget = id =>
  id === S.ownerUid
  || S.profileCache.get(id)?.role === 'admin'
  || S.userCache.get(id)?.role === 'admin';

const badgeSvg = (kind, size = 'md') => {
  const cls = `badge-svg badge-${kind} badge-${size}`;
  const defs = {
    verified: '<linearGradient id="g"><stop stop-color="#f5dfc2"/><stop offset=".55" stop-color="#c18a56"/><stop offset="1" stop-color="#75472b"/></linearGradient>',
    owner: '<linearGradient id="g" x2="0" y2="1"><stop stop-color="#fff4e7"/><stop offset=".35" stop-color="#e2b98d"/><stop offset=".7" stop-color="#b97946"/><stop offset="1" stop-color="#75472b"/></linearGradient>',
    admin: '<linearGradient id="g" x2="0" y2="1"><stop stop-color="#e6c7a4"/><stop offset=".5" stop-color="#9a663f"/><stop offset="1" stop-color="#4b2e1d"/></linearGradient>',
    moderator: '<linearGradient id="g" x2="1" y2="1"><stop stop-color="#f2dfca"/><stop offset=".5" stop-color="#c18a56"/><stop offset="1" stop-color="#70482e"/></linearGradient>',
    premium: '<linearGradient id="g"><stop stop-color="#fff5e9"/><stop offset="1" stop-color="#bd8652"/></linearGradient>',
    bot: '<linearGradient id="g" x2="0" y2="1"><stop stop-color="#d2bba5"/><stop offset="1" stop-color="#4a3324"/></linearGradient>',
    new: '<linearGradient id="g" x2="0" y2="1"><stop stop-color="#fff4e7"/><stop offset=".5" stop-color="#e2b98d"/><stop offset="1" stop-color="#9a663f"/></linearGradient>'
  };
  const body = {
    verified: '<path d="M12 1.8l2.1 1.1 2.3-.2 1.1 2.1 2.1 1.1-.2 2.3 1.1 2.1-1.1 2.1.2 2.3-2.1 1.1-1.1 2.1-2.3-.2-2.1 1.1-2.1-1.1-2.3.2-1.1-2.1-2.1-1.1.2-2.3-1.1-2.1 1.1-2.1-.2-2.3 2.1-1.1 1.1-2.1 2.3.2z" fill="url(#g)"/><path d="M8 12.1l2.5 2.5 5.5-5.6" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    owner: '<path d="M2.5 8.5l3.5 3 3.5-5 2.5 3.5 2.5-3.5 3.5 5 3.5-3-1.7 10H4.2L2.5 8.5z" fill="url(#g)"/><rect x="4.2" y="19" width="15.6" height="2.2" rx=".7" fill="#75472b"/><circle cx="12" cy="6" r="1.4" fill="#fff4e7"/><circle cx="6" cy="8.8" r="1" fill="#fff4e7"/><circle cx="18" cy="8.8" r="1" fill="#fff4e7"/>',
    admin: '<path d="M12 1L2.8 5v6.8c0 5.9 3.9 11.2 9.2 12.7 5.3-1.5 9.2-6.8 9.2-12.7V5L12 1z" fill="url(#g)"/><rect x="9.4" y="11.5" width="5.2" height="4.6" rx=".6" fill="#fff"/><path d="M10.4 11.5V10a1.6 1.6 0 013.2 0v1.5" fill="none" stroke="#fff" stroke-width="1.3"/>',
    moderator: '<path d="M10.3 3.2a1.7 1.7 0 013.4 0v.6h3.5a1 1 0 011 1v3.5h.6a1.7 1.7 0 010 3.4h-.6v3.5a1 1 0 01-1 1h-3.5v.6a1.7 1.7 0 01-3.4 0v-.6H6.8a1 1 0 01-1-1v-3.5h-.6a1.7 1.7 0 010-3.4h.6V4.8a1 1 0 011-1h3.5z" fill="url(#g)"/><path d="M9.3 12.4l1.9 1.9 3.5-3.6" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>',
    premium: '<path d="M12 2L5 5l-3 4 10 13L22 9l-3-4-7-3z" fill="url(#g)"/><path d="M2 9h20L12 22 2 9z" fill="#75472b" opacity=".65"/><path d="M5 5h14M2 9h20M7 5l5 17M17 5l-5 17" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".5"/>',
    bot: '<circle cx="12" cy="2.5" r="1" fill="#FF5252"/><rect x="11.6" y="3.5" width=".8" height="2.5" fill="#78909c"/><rect x="4" y="6" width="16" height="13" rx="3" fill="url(#g)"/><rect x="6" y="8" width="12" height="8" rx="1.5" fill="#0f172a"/><circle cx="9.5" cy="12" r="1.3" fill="#e2b98d"/><circle cx="14.5" cy="12" r="1.3" fill="#e2b98d"/>',
    new: '<path d="M12 2l2.9 6.3 6.6.7-4.9 4.5 1.4 6.6L12 16.7 6 20l1.4-6.6L2.5 8.9l6.6-.7L12 2z" fill="url(#g)"/>'
  };
  return `<svg viewBox="0 0 24 24" class="${cls}" aria-label="${kind}"><defs>${defs[kind]}</defs>${body[kind]}</svg>`;
};

function userBadgesHtml(id, size = 'md') {
  const p = S.profileCache.get(id) || {};
  const u = S.userCache.get(id) || {};
  const role = id === S.ownerUid ? 'owner' : (u.role || p.role || '');
  if (role === 'owner' || id === S.ownerUid) return `<span class="badge-row">${badgeSvg('owner', size)}</span>`;
  const out = [];
  if (role === 'admin') out.push(badgeSvg('admin', size));
  else if (role === 'moderator') out.push(badgeSvg('moderator', size));
  if (p.verifyBadge === 'premium') out.push(badgeSvg('premium', size));
  if (p.verified && !['admin', 'moderator'].includes(role)) out.push(badgeSvg('verified', size));
  if (p.verifyBadge === 'bot') out.push(badgeSvg('bot', size));
  if (p.createdAt && now() - Number(p.createdAt) < 7 * 86400000 && !p.verified) out.push(badgeSvg('new', size));
  return out.length ? `<span class="badge-row">${out.join('')}</span>` : '';
}

const canManageUser = target => {
  if (!target?.id || target.id === S.ownerUid || target.id === S.me?.id) return false;
  if (isOwner()) return true;
  if (S.me?.role === 'admin') return ['user', 'moderator'].includes(target.role);
  if (S.me?.role === 'moderator') return target.role === 'user';
  return false;
};

/* ==================== State ==================== */
const S = {
  initializedForUid: null,
  menuEventsBound: false,
  activeUid: null,
  cacheScopeUid: null,
  me: null,
  ownerUid: null,
  ownerProfile: null,
  appConfig: null,
  userCache: new Map(),
  profileCache: new Map(),
  presenceCache: new Map(),
  chatCache: new Map(),
  stories: [],
  storyGroups: [],
  storyRaw: {},
  storyExpiryTimer: null,
  storyGroup: null,
  storyUserList: [],
  contacts: new Set(),
  blocked: new Set(),
  blockMeta: new Map(),
  blockedMessageWindows: new Map(),
  hiddenChats: new Set(),
  profileRelations: new Map(),
  activeChatId: null,
  activeChat: null,
  messageCache: new Map(),
  localCacheDbPromise: null,
  offlineMode: false,
  dbConnected: null,
  reconnectCheckInProgress: false,
  reconnectRetryTimer: null,
  offlineStateRestoredUid: null,
  messageUnsubs: [],
  realtimeUnsubs: [],
  connectionRef: null,
  typingRef: null,
  typingTimer: null,
  currentReply: null,
  currentEdit: null,
  contextMessageId: null,
  storyIndex: 0,
  storyItemIndex: 0,
  storyTimer: null,
  storyProgressTimer: null,
  storyProgressStart: 0,
  storyPaused: false,
  storyDraft: null,
  pendingStoryReply: null,
  pinBuffer: '',
  pinHash: null,
  selectedGroupUsers: new Set(),
  localTheme: (APP_THEMES.includes(localStorage.getItem('ghostcaffee_theme')) ? localStorage.getItem('ghostcaffee_theme') : ({ blue: 'navy', rose: 'amethyst', slate: 'navy', amoled: 'coffee' }[localStorage.getItem('ghostcaffee_theme')] || 'coffee')),
  localWallpaper: CHAT_WALLPAPERS.includes(localStorage.getItem('ghostcaffee_wallpaper')) ? localStorage.getItem('ghostcaffee_wallpaper') : 'default',
  lastNotifications: new Set(),
  adminTab: 'dashboard',
  adminUsers: [],
  adminUsersUnsub: null,
  adminSearch: '',
  adminUserFilter: 'all',
  adminLogFilter: 'all',
  pendingPrompt: null,
  voiceRecorder: null,
  voiceChunks: [],
  voiceStartedAt: 0,
  voiceTimer: null,
  typingInputBound: false,
  chatPresenceUnsub: null,
  chatTypingUnsub: null,
  deviceId: localStorage.getItem('ghostcaffee_device_id') || globalThis.crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  registrationInProgress: false,
  logoutInProgress: false,
  sessionInitInProgress: false,
  signingInAnonymous: false,
  pendingAuthError: null,
  pendingAttachment: null,
  sending: false,
  chatIndex: null,
  chatListeners: new Map(),
  passiveMessageListeners: new Map(),
  chatRequests: {},
  storyAudience: { followers: new Set(), following: new Set() },
  chatRenderSeq: 0,
  chatRenderTimer: null,
  chatTab: 'all',
  chatQuery: '',
  voiceCanceled: false,
  voiceAutoSend: false,
  monitorMode: false,
  openingChat: null,
  profileFetchedAt: null,
  currentInviteCode: null,
  pendingQuickReply: null,
};
localStorage.setItem('ghostcaffee_device_id', S.deviceId);

window.$ = $;
window.hide = el => el?.classList.add('hidden');
window.show = el => el?.classList.remove('hidden');
window.APP_VERSION = APP_VERSION;

/* ==================== In-app Prompt / Confirm ==================== */
function promptAsync(message, defaultValue = '', title = 'إدخال') {
  return new Promise(resolve => {
    const modal = $('prompt-modal');
    const input = $('prompt-input');
    const group = $('prompt-input-group');
    const ok = $('prompt-ok');
    const cancel = $('prompt-cancel');
    $('prompt-title').textContent = title;
    $('prompt-message').textContent = message;
    input.value = defaultValue;
    group.classList.remove('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => { input.focus(); input.select(); }, 50);

    const cleanup = () => {
      modal.classList.add('hidden');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    };
    const onOk = () => { const v = input.value; cleanup(); resolve(v); };
    const onCancel = () => { cleanup(); resolve(null); };
    const onKey = e => {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
      else if (e.key === 'Escape') { onCancel(); }
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

function confirmAsync(message, title = 'تأكيد', okLabel = 'موافق', danger = false) {
  return new Promise(resolve => {
    const modal = $('prompt-modal');
    const input = $('prompt-input');
    const group = $('prompt-input-group');
    const ok = $('prompt-ok');
    const cancel = $('prompt-cancel');
    $('prompt-title').textContent = title;
    $('prompt-message').textContent = message;
    group.classList.add('hidden');
    ok.textContent = okLabel;
    ok.className = danger ? 'btn-danger' : 'btn-primary';
    ok.style.flex = '1';
    cancel.style.flex = '1';
    modal.classList.remove('hidden');

    const cleanup = () => {
      modal.classList.add('hidden');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      ok.textContent = 'موافق';
      ok.className = 'btn-primary';
    };
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
}

/* ==================== Toast ==================== */
function toast(message, type = 'info', ms = 3200) {
  const host = $('toast-container');
  if (!host) return;
  const n = document.createElement('div');
  n.className = `notif ${type}`;
  n.innerHTML = `<b>${type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️'}</b><p>${esc(message)}</p>`;
  host.appendChild(n);
  setTimeout(() => n.remove(), ms);
}

/* ==================== Auth Error ==================== */
function setAuthError(message) {
  const el = $('auth-error');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
  const retry = $('auth-retry');
  if (retry) {
    const showRetry = !!message && /تعذر|رفضت|الاتصال|تفعيل|فعّل|مفعّل|anonymous|الإنترنت|الانترنت/i.test(message);
    retry.classList.toggle('hidden', !showRetry);
  }
}

function firebaseErrorMessage(err) {
  const code = err?.code || '';
  const map = {
    'auth/operation-not-allowed': 'تسجيل الحسابات غير مفعّل. من Firebase Authentication فعّل Email/Password؛ لا يحتاج المستخدم إلى بريد حقيقي.',
    'auth/email-already-in-use': 'اسم المستخدم مستخدم بالفعل. اختر اسماً آخر.',
    'auth/invalid-email': 'اسم المستخدم أو بيانات الحساب غير صالحة.',
    'auth/user-not-found': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    'auth/wrong-password': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    'auth/invalid-credential': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    'auth/weak-password': 'كلمة المرور ضعيفة؛ استخدم 6 أحرف على الأقل.',
    'auth/account-exists-with-different-credential': 'هذا الحساب مرتبط بطريقة دخول مختلفة.',
    'auth/credential-already-in-use': 'بيانات الدخول هذه مرتبطة بحساب آخر بالفعل.',
    'auth/network-request-failed': 'تعذر الاتصال بـ Firebase. تحقق من الإنترنت ثم أعد المحاولة.',
    'auth/too-many-requests': 'تكررت المحاولات بسرعة. انتظر قليلاً ثم حاول مجدداً.',
    'auth/unauthorized-domain': 'هذا النطاق غير مصرح له في Firebase Authentication.',
    'auth/app-not-authorized': 'إعدادات التطبيق لا تتطابق مع مشروع Firebase الحالي.',
    'auth/invalid-api-key': 'مفتاح Firebase غير صالح. راجع firebaseConfig في app.js.',
    'auth/operation-not-supported-in-this-environment': 'لا يمكن تشغيل المصادقة من هذا العنوان. افتح الموقع عبر HTTPS أو استخدم تطبيق Android.',
    'database/permission-denied': 'رفضت قواعد Realtime Database هذا الإجراء. تحقق من صلاحيات قاعدة البيانات.',
    'PERMISSION_DENIED': 'رفضت قواعد Realtime Database هذا الإجراء. تحقق من صلاحيات قاعدة البيانات.'
  };
  return map[code] || err?.message || 'حدث خطأ غير متوقع.';
}

async function sha256(text) {
  if (!globalThis.crypto?.subtle) return text;
  const data = new TextEncoder().encode(text);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* ==================== View helpers ==================== */
function openView(id) {
  qsa('.modal').forEach(m => m.classList.add('hidden'));
  $(id)?.classList.remove('hidden');
}
function closeModals() {
  qsa('.modal').forEach(m => m.classList.add('hidden'));
}

/* ==================== Preferences ==================== */
function applyLocalPreferences() {
  if (!APP_THEMES.includes(S.localTheme)) S.localTheme = 'coffee';
  if (!CHAT_WALLPAPERS.includes(S.localWallpaper)) S.localWallpaper = 'default';
  localStorage.setItem('ghostcaffee_theme', S.localTheme);
  localStorage.setItem('ghostcaffee_wallpaper', S.localWallpaper);
  document.documentElement.dataset.theme = S.localTheme;
  document.documentElement.dataset.wallpaper = S.localWallpaper;
  const themeColorMap = { coffee: '#2b1a11', navy: '#07111f', ocean: '#071a20', forest: '#091710', amethyst: '#130d21', light: '#f5eee6' };
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', themeColorMap[S.localTheme] || themeColorMap.coffee);
  $('messages-container')?.setAttribute('data-wallpaper', S.localWallpaper);
  const pinOpt = $('opt-pin');
  if (pinOpt) pinOpt.checked = !!localStorage.getItem('ghostcaffee_pin_hash');
  qsa('.theme-option').forEach(b => {
    const selected = b.dataset.theme === S.localTheme;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
  qsa('[data-wp]').forEach(b => {
    const selected = b.dataset.wp === S.localWallpaper;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
}
async function setLocalPin(pin) {
  if (!/^\d{4}$/.test(pin)) throw new Error('الـPIN يجب أن يكون 4 أرقام.');
  localStorage.setItem('ghostcaffee_pin_hash', await sha256(pin));
  S.pinHash = localStorage.getItem('ghostcaffee_pin_hash');
}
function clearLocalPin() {
  localStorage.removeItem('ghostcaffee_pin_hash');
  S.pinHash = null;
}
function needsPin() {
  return !!localStorage.getItem('ghostcaffee_pin_hash');
}
function showPinLock() {
  if (!needsPin()) return false;
  S.pinBuffer = '';
  const el = $('pin-error');
  if (el) { el.textContent = ''; el.classList.add('hidden'); }
  $('auth-screen')?.classList.add('hidden');
  $('pin-screen')?.classList.remove('hidden');
  renderPinDots();
  return true;
}
function renderPinDots() {
  const dots = $('pin-dots');
  if (dots) dots.textContent = '●'.repeat(S.pinBuffer.length) + '○'.repeat(4 - S.pinBuffer.length);
}
async function verifyPin() {
  if (await sha256(S.pinBuffer) !== localStorage.getItem('ghostcaffee_pin_hash')) {
    const el = $('pin-error');
    if (el) { el.textContent = 'الـPIN غير صحيح.'; el.classList.remove('hidden'); }
    S.pinBuffer = '';
    renderPinDots();
    return;
  }
  $('pin-screen')?.classList.add('hidden');
  if (S.me) enterApp();
  else $('auth-screen')?.classList.remove('hidden');
}

/* ==================== Username/password account auth ==================== */
async function registrationStep(label, fn) {
  setAuthError(`جارٍ إعداد الحساب — ${label}`);
  try { return await fn(); }
  catch (e) { e.registrationStep = label; throw e; }
}

async function reserveUsername(username, accountUid) {
  const ref = db.ref(`usernames/${username}`);
  // A legacy username may already point to this very UID. Do not rewrite the same
  // RTDB value: the deployed rules intentionally permit creating, not rewriting, an index.
  const existing = await ref.once('value');
  if (existing.exists() && existing.val() === accountUid) return;
  if (existing.exists()) {
    const err = new Error('اسم المستخدم مستخدم بالفعل. اختر اسماً آخر.');
    err.code = 'APP_USERNAME_TAKEN';
    throw err;
  }
  const result = await ref.transaction(current => {
    if (current === null || current === undefined) return accountUid;
    return undefined;
  }, undefined, false);
  if (!result?.committed || result.snapshot?.val() !== accountUid) {
    const err = new Error('اسم المستخدم مستخدم بالفعل. اختر اسماً آخر.');
    err.code = 'APP_USERNAME_TAKEN';
    throw err;
  }
}

async function registerAccount(ev) {
  ev.preventDefault();
  if (S.registrationInProgress) return;
  setAuthError('');
  const username = normalizeUsername($('reg-username')?.value);
  const password = $('reg-password')?.value || '';
  const confirmPassword = $('reg-confirm')?.value || '';
  if (!USERNAME_RE.test(username)) return setAuthError('اسم المستخدم: من 3 إلى 20 حرفاً إنجليزياً صغيراً أو رقماً أو شرطة سفلية.');
  if (password.length < 6) return setAuthError('كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
  if (password !== confirmPassword) return setAuthError('تأكيد كلمة المرور غير مطابق.');

  try {
    await loadConfig({ strict: true });
  } catch (e) {
    return setAuthError(`تعذر الاتصال بقاعدة البيانات: ${firebaseErrorMessage(e)}`);
  }
  if (S.appConfig?.allowRegistration === false) return setAuthError('التسجيلات الجديدة متوقفة حالياً.');

  const btn = $('register-form')?.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  S.registrationInProgress = true;
  let newUid = null;
  let authUser = null;
  let authWasCreated = false;
  let accountWasCommitted = false;
  let oldUsername = '';
  let migratingExistingAccount = false;
  let linkedExistingIdentity = false;
  try {
    const existingAuthUser = auth.currentUser;
    let oldRecord = null;
    if (existingAuthUser?.isAnonymous) {
      const oldSnap = await registrationStep('فحص الحساب الحالي', () => db.ref(`users/${existingAuthUser.uid}`).once('value'));
      if (oldSnap.exists() && oldSnap.val()?.registrationComplete === true) {
        oldRecord = oldSnap.val();
        oldUsername = normalizeUsername(oldRecord.username || '');
        const namedSnap = await db.ref(`usernames/${username}`).once('value');
        if (namedSnap.exists() && namedSnap.val() !== existingAuthUser.uid) {
          const err = new Error('اسم المستخدم مستخدم بالفعل.'); err.code = 'APP_USERNAME_TAKEN'; throw err;
        }
      }
    }

    if (oldRecord && oldUsername && oldUsername !== username) {
      const err = new Error('لتأمين الحساب الحالي والحفاظ على محادثاته، استخدم اسم المستخدم الحالي @' + oldUsername + '. يمكنك محاولة تغيير الاسم لاحقاً من الملف الشخصي.');
      err.code = 'APP_LEGACY_USERNAME_MISMATCH';
      throw err;
    }

    const credential = firebase.auth.EmailAuthProvider.credential(accountEmail(username), password);
    if (existingAuthUser?.isAnonymous && oldRecord) {
      // Convert a complete legacy guest identity in place; its UID/chat history remains unchanged.
      const linked = await registrationStep('تثبيت اسم المستخدم وكلمة المرور', () => existingAuthUser.linkWithCredential(credential));
      authUser = linked.user;
      newUid = authUser.uid;
      migratingExistingAccount = true;
      linkedExistingIdentity = true;
    } else {
      // Incomplete guest sessions have no completed account/history to preserve. Sign them out
      // before creating the durable username/password identity, avoiding a half-linked account.
      if (existingAuthUser?.isAnonymous) await auth.signOut().catch(() => {});
      const created = await registrationStep('إنشاء حساب التطبيق', () => auth.createUserWithEmailAndPassword(accountEmail(username), password));
      authUser = created.user;
      newUid = authUser.uid;
      authWasCreated = true;
    }

    if (oldRecord) {
      // Preserve the legacy UID and all chat/group membership paths. The deployed rules
      // intentionally do not permit updating the entire completed /users/$uid record.
      // Only touch leaf paths with explicit self-write rules; do not rewrite status,
      // username, registrationComplete, role, coins, or any historical chat data.
      await registrationStep('حجز اسم المستخدم', () => reserveUsername(username, newUid));
      const profileRef = db.ref(`profiles/${newUid}`);
      const profileSnap = await registrationStep('فحص الملف العام', () => profileRef.once('value'));
      if (profileSnap.exists()) {
        const profile = profileSnap.val() || {};
        // Existing profile content is preserved. Only repair missing/stale leaf values;
        // never replace a custom display name, avatar, bio, cover, or verification state.
        if (normalizeUsername(profile.username || '') !== username) {
          await registrationStep('مزامنة اسم المستخدم العام', () => profileRef.child('username').set(username));
        }
        if (!String(profile.displayName || '').trim()) {
          const displayName = String(oldRecord.displayName || username).trim().slice(0, 40);
          await registrationStep('استعادة الاسم الظاهر', () => profileRef.child('displayName').set(displayName));
        }
      } else {
        // A rare partial legacy profile can be created with a valid complete profile,
        // rather than attempting an invalid partial parent update.
        const displayName = String(oldRecord.displayName || username).trim().slice(0, 40);
        await registrationStep('استعادة الملف العام', () => profileRef.set({
          username, displayName, bio: '', avatar: '', cover: '', role: oldRecord.role || 'user',
          verified: false, active: true, createdAt: Number(oldRecord.createdAt) || Date.now()
        }));
      }
      // Existing device links can be read-only under the rules; only add a missing link.
      try {
        const deviceLink = db.ref(`devices/${S.deviceId}/users/${newUid}`);
        const deviceSnap = await deviceLink.once('value');
        if (!deviceSnap.exists()) await deviceLink.set(true);
      } catch (e) { console.warn('[Ghost Caffee] Legacy device link retained:', e); }
      // Presence is best-effort and does not decide whether credential linking succeeded.
      try {
        const presenceRef = db.ref(`presence/${newUid}`);
        const presenceSnap = await presenceRef.once('value');
        if (presenceSnap.exists()) await presenceRef.update({ online: true, lastSeen: SERVER });
      } catch (e) { console.warn('[Ghost Caffee] Legacy presence update skipped:', e); }
      accountWasCommitted = true;
    } else {
      // Clean an incomplete anonymous registration before reusing its UID.
      if (existingAuthUser?.isAnonymous) {
        const partial = await db.ref(`users/${newUid}`).once('value').catch(() => null);
        if (partial?.exists()) await cleanupIncompleteRegistration(newUid, normalizeUsername(partial.val()?.username || ''));
      }
      const base = Date.now();
      const userRecord = {
        id: newUid, username, role: 'user', status: 'active', coins: 0, deviceId: S.deviceId,
        createdAt: base, lastSeen: base, showOnline: true, showLastSeen: true,
        registrationComplete: false, contacts: {}, blocked: {},
        settings: { notifications: true, sounds: true, readReceipts: true, showLastSeen: true, showOnline: true }
      };
      const profile = { username, displayName: username, bio: '', avatar: '', cover: '', role: 'user', verified: false, active: true, createdAt: base };
      const presence = { online: true, lastSeen: base, showOnline: true, showLastSeen: true };
      await registrationStep('حفظ ملف الحساب', () => db.ref(`users/${newUid}`).set(userRecord));
      await registrationStep('حجز اسم المستخدم', () => reserveUsername(username, newUid));
      await registrationStep('إنشاء الملف العام', () => db.ref(`profiles/${newUid}`).set(profile));
      await registrationStep('تفعيل حالة الاتصال', () => db.ref(`presence/${newUid}`).set(presence));
      await registrationStep('ربط الحساب بالجهاز', () => db.ref(`devices/${S.deviceId}/users/${newUid}`).set(true));
      await registrationStep('تحميل الحساب', async () => {
        const ok = await loadCurrentAccount();
        if (!ok) throw new Error('تعذرت قراءة بيانات الحساب بعد إنشائه.');
      });
      await registrationStep('تهيئة إعدادات التطبيق', () => loadConfig({ strict: true }));
      await registrationStep('تهيئة المالك عند الحاجة', bootstrapOwnerIfNeeded);
      await registrationStep('تأكيد الحساب', () => db.ref(`users/${newUid}/registrationComplete`).set(true));
      accountWasCommitted = true;
    }

    S.registrationInProgress = false;
    S.sessionInitInProgress = false;
    S.initializedForUid = null;
    S.activeUid = null;
    S.me = null;
    S.pendingAuthError = null;
    localStorage.setItem('ghostcaffee_has_account', '1');
    const initialized = await initializeAuthenticatedUser(authUser, { allowDuringRegistration: true });
    if (!initialized) {
      setAuthError('تم إعداد الحساب، لكن تعذر فتحه. اضغط إعادة المحاولة أو سجّل الدخول بالبيانات نفسها.');
    } else {
      $('reg-password').value = '';
      $('reg-confirm').value = '';
      toast(migratingExistingAccount ? 'تم تأمين حسابك الحالي بكلمة مرور، مع الحفاظ على محادثاتك. ☕' : 'أهلاً بك في Ghost Caffee ☕', 'success');
    }
  } catch (e) {
    const identityWasLinked = linkedExistingIdentity && newUid && auth.currentUser?.uid === newUid && !auth.currentUser?.isAnonymous;
    if (newUid && !accountWasCommitted && !identityWasLinked) {
      await cleanupIncompleteRegistration(newUid, username);
      if (authWasCreated && auth.currentUser?.uid === newUid) await auth.currentUser.delete().catch(() => {});
    }
    S.registrationInProgress = false;
    S.sessionInitInProgress = false;
    S.initializedForUid = null;
    S.activeUid = auth.currentUser?.uid || null;
    const message = e?.code === 'APP_USERNAME_TAKEN'
      ? 'اسم المستخدم مستخدم بالفعل. اختر اسماً مختلفاً.'
      : e?.code === 'APP_LEGACY_USERNAME_MISMATCH'
        ? e.message
        : e?.code === 'PERMISSION_DENIED' || e?.code === 'database/permission-denied'
          ? `رفضت قاعدة البيانات خطوة «${e?.registrationStep || 'غير محددة'}». لم أغيّر database.rules.json؛ راجع صلاحيات الحساب الحالي في Realtime Database.`
          : e?.registrationStep ? `تعذرت خطوة «${e.registrationStep}»: ${firebaseErrorMessage(e)}` : firebaseErrorMessage(e);
    setAuthError(message);
    if (identityWasLinked) {
      // Keep the linked credentials and intact legacy data; let the user retry via login.
      await auth.signOut().catch(() => {});
      showAuthScreen('تم ربط بيانات الدخول، لكن لم تكتمل إحدى خطوات المزامنة. سجّل الدخول بالاسم وكلمة المرور نفسيهما لإعادة المحاولة دون فقد المحادثات.', 'login');
    } else if (!auth.currentUser) {
      showAuthScreen(message, 'register');
    }
  } finally {
    S.registrationInProgress = false;
    if (btn) btn.disabled = false;
  }
}

async function loginAccount(ev) {
  ev.preventDefault();
  if (S.registrationInProgress) return;
  setAuthError('');
  const username = normalizeUsername($('login-username')?.value);
  const password = $('login-password')?.value || '';
  if (!USERNAME_RE.test(username)) return setAuthError('اسم المستخدم غير صالح.');
  if (!password) return setAuthError('أدخل كلمة المرور.');
  const btn = $('login-form')?.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    await auth.signInWithEmailAndPassword(accountEmail(username), password);
    localStorage.setItem('ghostcaffee_has_account', '1');
    $('login-password').value = '';
  } catch (e) {
    setAuthError(firebaseErrorMessage(e));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function logout() {
  if (S.logoutInProgress) return;
  S.logoutInProgress = true;
  try {
    // Presence is best-effort; a transient database error must not block logout.
    try {
      stopMyTyping();
      if (uid()) {
        await db.ref(`presence/${uid()}`).set({ online: false, lastSeen: SERVER, showOnline: S.me?.showOnline !== false, showLastSeen: S.me?.showLastSeen !== false });
      }
    } catch (presenceError) {
      console.warn('[Ghost Caffee] Could not update presence during logout:', presenceError);
    }

    // Do not clear the live session/UI until Firebase confirms sign-out. The previous
    // implementation swallowed signOut errors and could leave an authenticated user
    // stranded on the login screen, or immediately re-enter the app via auth observer.
    try {
      await auth.signOut();
    } catch (error) {
      toast(`تعذر تسجيل الخروج: ${firebaseErrorMessage(error)}`, 'error', 5000);
      return;
    }

    S.pendingAuthError = null;
    detachRealtime();
    S.initializedForUid = null;
    S.activeUid = null;
    S.activeChatId = null;
    S.activeChat = null;
    S.me = null;
    S.sessionInitInProgress = false;
    S.registrationInProgress = false;
    S.messageCache.clear();
    S.chatRequests = {};
    S.chatCache.clear();
    closeModals();
    closeSideMenu();
    closeAdminPanel();
    $('sidebar')?.classList.remove('open');
    $('app-screen')?.classList.add('hidden');
    $('pin-screen')?.classList.add('hidden');
    $('auth-screen')?.classList.remove('hidden');
    setAuthTab('login');
    if ($('login-password')) $('login-password').value = '';
    requestAnimationFrame(() => $('login-username')?.focus({ preventScroll: true }));
  } finally {
    S.logoutInProgress = false;
  }
}

function accountEmail(username) {
  // Internal Firebase credential alias. The user never enters or needs a real email address.
  // Keep the legacy domain so existing Ghost Caffee accounts created by v6.x can still sign in.
  return `${normalizeUsername(username)}@accounts.chatapp.local`;
}

function setAuthTab(tab) {
  const chosen = tab === 'login' ? 'login' : 'register';
  qsa('.auth-tab').forEach(b => {
    const active = b.dataset.tab === chosen;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  $('register-form')?.classList.toggle('hidden', chosen !== 'register');
  $('login-form')?.classList.toggle('hidden', chosen !== 'login');
  const regUsername = $('reg-username');
  if (regUsername) regUsername.readOnly = !!(chosen === 'register' && auth.currentUser?.isAnonymous && S.me?.registrationComplete === true);
  setAuthError('');
}

function showAuthScreen(message = '', tab = 'register') {
  $('splash-screen')?.classList.add('hidden');
  $('app-screen')?.classList.add('hidden');
  $('pin-screen')?.classList.add('hidden');
  $('auth-screen')?.classList.remove('hidden');
  $('sidebar')?.classList.remove('open');
  closeSideMenu();
  setAuthTab(tab);
  if (message) setAuthError(message);
}

/* ==================== Config ==================== */
async function loadConfig(options = {}) {
  const strict = options.strict === true;
  let appSnap = null, ownerSnap = null;
  try {
    appSnap = await withDeadline(db.ref('config/app').once('value'), 4500, 'app configuration');
    if (auth.currentUser) ownerSnap = await withDeadline(db.ref('config/ownerUid').once('value'), 4500, 'owner configuration');
  } catch (e) {
    if (strict) throw e;
    appSnap = null;
    ownerSnap = null;
  }
  const cachedConfig = !appSnap && uid() ? await readCachedState('config', uid()).catch(() => null) : null;
  S.appConfig = { appName: 'Ghost Caffee', maxAccountsPerDevice: 3, allowRegistration: true, schemaVersion: STORE_VERSION, ...(cachedConfig?.appConfig || {}), ...(appSnap?.val() || {}) };
  // Ghost Caffee is the fixed product identity; old/remote labels are never shown in the client.
  S.appConfig.appName = 'Ghost Caffee';
  S.ownerUid = ownerSnap?.val() || cachedConfig?.ownerUid || S.ownerUid || null;
  const an = $('about-app-name');
  if (an) an.textContent = S.appConfig.appName || 'Ghost Caffee';
  if (uid()) writeCachedState('config', { appConfig: S.appConfig, ownerUid: S.ownerUid }, uid()).catch(() => {});
}

/* ==================== Owner bootstrap ==================== */
async function bootstrapOwnerIfNeeded() {
  if (!S.me || S.me.username !== 'data') return;
  const ownerSnap = await db.ref('config/ownerUid').once('value');
  if (ownerSnap?.exists()) { S.ownerUid = ownerSnap.val(); return; }
  try {
    await db.ref('config/ownerUid').set(S.me.id);
    await db.ref(`users/${S.me.id}/role`).set('owner');
    await db.ref(`profiles/${S.me.id}`).update({ verified: true, role: 'owner' });
    S.ownerUid = S.me.id;
    try {
      const cfg = await db.ref('config/app').once('value');
      if (!cfg.exists()) await db.ref('config/app').set({ appName: 'Ghost Caffee', maxAccountsPerDevice: 3, allowRegistration: true, schemaVersion: STORE_VERSION });
    } catch {}
    S.me.role = 'owner';
  } catch (e) {
    e.registrationOwnerBootstrap = true;
    throw e;
  }
}

/* ==================== Load current account ==================== */
async function loadCurrentAccount(retries = 3) {
  if (!uid()) return false;
  let uSnap, pSnap;
  try {
    uSnap = await withDeadline(db.ref(`users/${uid()}`).once('value'), 5000, 'account read');
    if (!uSnap?.exists()) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 300));
        return loadCurrentAccount(retries - 1);
      }
      return false;
    }
    pSnap = await withDeadline(db.ref(`profiles/${uid()}`).once('value'), 5000, 'profile read');
  } catch (e) {
    throw e;
  }
  const p = pSnap?.val() || {};
  const u = uSnap.val() || {};
  S.me = { ...u, id: uid(), bio: p.bio || '', avatar: p.avatar || '', cover: p.cover || '', displayName: p.displayName || u.displayName || u.username, verified: !!p.verified };
  S.userCache.set(uid(), S.me);
  S.contacts = new Set(Object.keys(u.contacts || {}));
  S.blocked = new Set(Object.keys(u.blocked || {}));
  const savedBlockMeta = await readCachedState('blockMeta', uid()).catch(() => null);
  S.blockMeta = new Map(Object.entries(savedBlockMeta || {}).map(([id, at]) => [id, Number(at) || 0]));
  try {
    const viewedSnap = await withDeadline(db.ref(`storyViewedByUser/${uid()}`).once('value'), 3500, 'story state read');
    S.me.storyViewed = viewedSnap?.val() || {};
  } catch { S.me.storyViewed = {}; }
  await writeCachedState('account', { me: S.me, contacts: [...S.contacts], blocked: [...S.blocked], blockedAt: Object.fromEntries(S.blockMeta), storyViewed: S.me.storyViewed || {} }, uid()).catch(() => {});
  await writeCachedState('config', { appConfig: S.appConfig, ownerUid: S.ownerUid }, uid()).catch(() => {});
  return true;
}

/* ==================== Cleanup incomplete registration ==================== */
async function cleanupIncompleteRegistration(newUid, username) {
  if (!newUid) return;
  const paths = [`profiles/${newUid}`, `presence/${newUid}`, `devices/${S.deviceId}/users/${newUid}`];
  if (USERNAME_RE.test(username || '')) {
    try {
      const indexSnap = await db.ref(`usernames/${username}`).once('value');
      if (indexSnap.exists() && indexSnap.val() === newUid) paths.push(`usernames/${username}`);
    } catch {}
  }
  paths.push(`users/${newUid}`);
  for (const path of paths) {
    try { await db.ref(path).remove(); } catch {}
  }
}

async function saveProfile() {
  if (!S.me) return;
  if (S.offlineMode || S.dbConnected === false) return toast('تعديل الملف الشخصي يحتاج إلى اتصال.', 'info');
  const bio = ($('profile-bio')?.value || '').trim().slice(0, 100);
  const displayName = ($('profile-displayName')?.value || '').trim().slice(0, 40);
  const cover = String(S.me.cover || '');
  const username = normalizeUsername($('profile-username')?.value || S.me.username);
  if (!USERNAME_RE.test(username)) return toast('اسم المستخدم غير صالح.', 'error');
  try {
    if (username !== S.me.username) {
      const us = await db.ref(`usernames/${username}`).once('value');
      if (us.exists() && us.val() !== S.me.id) return toast('اسم المستخدم مستخدم بالفعل.', 'error');
      const last = Number(S.me.usernameChangedAt || 0);
      if (last && now() - last < 2592000000) return toast('يمكن تغيير اسم المستخدم مرة كل 30 يوماً.', 'error');
      await db.ref(`usernames/${S.me.username}`).remove();
      await db.ref(`usernames/${username}`).set(S.me.id);
      await db.ref(`users/${S.me.id}/username`).set(username);
      await db.ref(`users/${S.me.id}/usernameChangedAt`).set(SERVER);
      await db.ref(`profiles/${S.me.id}/username`).set(username);
    }
    await db.ref(`profiles/${S.me.id}`).update({ bio, displayName, cover });
    S.me = { ...S.me, username, bio, displayName, cover, usernameChangedAt: username !== S.me.username ? now() : S.me.usernameChangedAt };
    S.profileCache.set(S.me.id, { ...S.profileCache.get(S.me.id), ...S.me });
    writeCachedState('profiles', [...S.profileCache.values()], uid()).catch(() => {});
    writeCachedState('account', { me: S.me, contacts: [...S.contacts], blocked: [...S.blocked], blockedAt: Object.fromEntries(S.blockMeta || []), storyViewed: S.me.storyViewed || {} }, uid()).catch(() => {});
    toast('تم حفظ الملف الشخصي.', 'success');
    renderOwnIdentity();
    renderProfileModal();
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function changeAvatar(file) {
  if (!file || !S.me) return;
  if (S.offlineMode || S.dbConnected === false) return toast('تغيير الصورة يحتاج إلى اتصال.', 'info');
  if (!file.type.startsWith('image/')) return toast('اختر صورة فقط.', 'error');
  try {
    const dataUrl = await compressImage(file, 256, 0.82);
    if (dataUrl.length > MAX_FILE_BYTES * 1.37) throw new Error('الصورة كبيرة جداً.');
    await db.ref(`profiles/${S.me.id}/avatar`).set(dataUrl);
    S.me.avatar = dataUrl;
    writeCachedState('account', { me: S.me, contacts: [...S.contacts], blocked: [...S.blocked], blockedAt: Object.fromEntries(S.blockMeta || []), storyViewed: S.me.storyViewed || {} }, uid()).catch(() => {});
    renderOwnIdentity();
    renderProfileModal();
    toast('تم تحديث الصورة.', 'success');
  } catch (e) {
    toast(e.message || 'تعذر حفظ الصورة.', 'error');
  }
}

async function changeCover(file) {
  if (!file || !S.me) return;
  if (!file.type.startsWith('image/')) return toast('اختر صورة فقط.', 'error');
  try {
    const data = await compressImage(file, 800, .75);
    if (data.length > 2800000) return toast('الغلاف كبير جداً.', 'error');
    await db.ref(`profiles/${S.me.id}/cover`).set(data);
    S.me.cover = data;
    writeCachedState('account', { me: S.me, contacts: [...S.contacts], blocked: [...S.blocked], blockedAt: Object.fromEntries(S.blockMeta || []), storyViewed: S.me.storyViewed || {} }, uid()).catch(() => {});
    renderProfileModal();
    toast('تم تحديث الغلاف.', 'success');
  } catch (e) {
    toast('تعذر حفظ الغلاف.', 'error');
  }
}

function compressImage(file, maxSide = 1280, quality = .8) {
  return new Promise((resolve, reject) => {
    const img = new Image(), fr = new FileReader();
    fr.onload = () => { img.src = fr.result; };
    fr.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
    fr.readAsDataURL(file);
  });
}

/* ==================== Identity render ==================== */
function renderOwnIdentity() {
  if (!S.me) return;
  const avatar = S.me.avatar ? `<img src="${esc(safeImageUrl(S.me.avatar))}" alt="">` : '👻';
  ['my-avatar', 'menu-avatar'].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = avatar;
  });
  const myName = $('my-username');
  if (myName) myName.textContent = S.me.displayName || '@' + S.me.username;
  const menuName = $('menu-username');
  if (menuName) menuName.textContent = S.me.displayName || '@' + S.me.username;
  const myStatus = $('my-status');
  if (myStatus) {
    myStatus.textContent = S.me.status === 'active' ? `@${S.me.username} · متصل` : S.me.status;
    myStatus.style.color = S.me.status === 'active' ? 'var(--accent)' : 'var(--danger)';
  }
  const dev = $('menu-userdevice');
  if (dev) dev.textContent = `الجهاز: ${S.deviceId.slice(0, 12)}…`;
  $('menu-admin')?.classList.toggle('hidden', !isStaff());
  $('menu-secure-account')?.classList.toggle('hidden', !auth.currentUser?.isAnonymous);
  renderOwnerContactCard();
}

async function loadOwnerProfile() {
  if (!S.ownerUid || S.ownerUid === uid()) {
    S.ownerProfile = S.me ? { ...S.me, id: uid() } : null;
    if (S.ownerProfile) writeCachedState('ownerProfile', S.ownerProfile, uid()).catch(() => {});
    renderOwnerContactCard();
    return;
  }
  const snap = await withDeadline(db.ref(`profiles/${S.ownerUid}`).once('value'), 2600, 'owner profile').catch(() => null);
  if (snap?.exists()) {
    S.ownerProfile = { ...snap.val(), id: S.ownerUid };
    S.profileCache.set(S.ownerUid, S.ownerProfile);
    writeCachedState('ownerProfile', S.ownerProfile, uid()).catch(() => {});
  }
  renderOwnerContactCard();
}

function renderOwnerContactCard() {
  const host = $('owner-contact-card');
  if (!host) return;
  const p = S.ownerProfile;
  if (!p) {
    host.innerHTML = '<div class="owner-contact-loading">ملف المالك غير متاح حالياً.</div>';
    return;
  }
  const avatar = p.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : '👑';
  host.innerHTML = `
    <div class="owner-contact-head" data-owner-profile="${esc(p.id)}">
      <div class="owner-contact-avatar">${avatar}</div>
      <div class="owner-contact-info">
        <strong>@${esc(p.username || 'owner')} ${p.verified ? '✓' : ''}</strong>
        <span>👑 مالك التطبيق · للاستفسار والطلبات والشكاوى</span>
      </div>
      <button class="icon-btn owner-profile-btn" title="فتح ملف المالك">›</button>
    </div>
    <div class="owner-contact-actions">
      <button data-owner-request="استفسار">استفسار</button>
      <button data-owner-request="طلب">طلب</button>
      <button data-owner-request="شكوى">شكوى</button>
    </div>`;
  host.querySelector('[data-owner-profile]')?.addEventListener('click', () => openUserProfile(p.id));
  host.querySelector('.owner-profile-btn')?.addEventListener('click', e => { e.stopPropagation(); openUserProfile(p.id); });
  host.querySelectorAll('[data-owner-request]').forEach(btn =>
    btn.addEventListener('click', () => startOwnerRequest(btn.dataset.ownerRequest))
  );
}

async function startOwnerRequest(kind) {
  if (!S.ownerUid) return toast('ملف المالك غير متاح حالياً.', 'error');
  if (S.ownerUid === uid()) return openView('profile-view');
  await startPrivateByUid(S.ownerUid);
  const input = $('message-input');
  if (input) {
    input.value = `${kind}: `;
    resizeMessageInput();
    updateSendButtons();
    input.focus();
  }
}

function renderProfileModal() {
  if (!S.me) return;
  const pu = $('profile-username');
  if (pu) { pu.value = '@' + S.me.username; pu.removeAttribute('disabled'); }
  const pb = $('profile-bio');
  if (pb) pb.value = S.me.bio || '';
  const dn = $('profile-displayName');
  if (dn) dn.value = S.me.displayName || '';
  const pd = $('profile-device');
  if (pd) pd.value = S.deviceId;
  const av = $('profile-avatar-big');
  if (av) av.innerHTML = S.me.avatar ? `<img src="${esc(safeImageUrl(S.me.avatar))}" alt="">` : '👻';
}

/* ==================== Enter app ==================== */
function enterApp() {
  if (!S.me) return;
  setupTyping();
  $('auth-screen')?.classList.add('hidden');
  $('pin-screen')?.classList.add('hidden');
  $('app-screen')?.classList.remove('hidden');
  $('splash-screen')?.classList.add('hidden');
  applyLocalPreferences();
  renderOwnIdentity();
  renderProfileModal();
  const sessionUid = uid();
  // Display locally stored lists first, then attach live listeners after IndexedDB hydration.
  loadChatCache();
  void restoreOfflineCollections(sessionUid).finally(() => {
    if (uid() === sessionUid && S.initializedForUid === sessionUid) bindRealtimeData();
  });
  loadAboutCounts();
  loadOwnerProfile();
  resizeMessageInput();
  updateSendButtons();
  localStorage.setItem('ghostcaffee_has_account', '1');

  if (isMobile()) {
    $('sidebar')?.classList.add('open');
    $('chat-empty')?.classList.remove('hidden');
    $('chat-view')?.classList.add('hidden');
  }

  if (!S.storyExpiryTimer) S.storyExpiryTimer = setInterval(() => renderStoryData(S.storyRaw), 30000);
  handleInviteParam();
  processPendingQuickReply();  // ← أضف هذا السطر
}

/* ==================== Realtime detach / listen ==================== */
function detachRealtime(options = {}) {
  if (S.reconnectRetryTimer) { clearTimeout(S.reconnectRetryTimer); S.reconnectRetryTimer = null; }
  S.realtimeUnsubs.forEach(fn => { try { fn(); } catch {} });
  S.realtimeUnsubs = [];
  S.messageUnsubs.forEach(fn => { try { fn(); } catch {} });
  S.messageUnsubs = [];
  if (S.connectionRef) { try { S.connectionRef.off(); } catch {} S.connectionRef = null; }
  if (S.typingRef) { try { S.typingRef.off(); } catch {} S.typingRef = null; }
  if (S.chatPresenceUnsub) { try { S.chatPresenceUnsub(); } catch {} S.chatPresenceUnsub = null; }
  if (S.chatTypingUnsub) { try { S.chatTypingUnsub(); } catch {} S.chatTypingUnsub = null; }
  if (S.storyExpiryTimer) { clearInterval(S.storyExpiryTimer); S.storyExpiryTimer = null; }
  if (S.adminUsersUnsub) { try { S.adminUsersUnsub(); } catch {} S.adminUsersUnsub = null; }
  detachChatListeners(options.preserveCache === true);
}

function listenError(path) {
  return err => {
    console.warn(`listener ${path} failed:`, err?.code || err);
    if (err?.code === 'PERMISSION_DENIED' || err?.code === 'permission_denied') {
      toast(`رفضت قاعدة البيانات القراءة من «${path.split('/')[0]}». انشر آخر database.rules.json.`, 'error', 5000);
    }
  };
}

function listenValue(path, handler) {
  const ref = db.ref(path);
  ref.on('value', handler, listenError(path));
  S.realtimeUnsubs.push(() => ref.off('value', handler));
}

function bindRealtimeData() {
  // Rebinding listeners must not erase freshly hydrated IndexedDB data.
  detachRealtime({ preserveCache: true });
  if (!uid()) return;
  const presenceRef = db.ref(`presence/${uid()}`);
  const connectedRef = db.ref('.info/connected');
  const connectedHandler = snap => {
    const online = snap.val() === true;
    S.dbConnected = online;
    $('chat-status')?.classList.toggle('db-offline', !online && !!S.activeChatId);
    if (!online) {
      if (S.reconnectRetryTimer) { clearTimeout(S.reconnectRetryTimer); S.reconnectRetryTimer = null; }
      if (!S.offlineMode) {
        S.offlineMode = true;
        if (S.activeChatId) setMessageInputPreviewState(S.activeChatId, true);
      }
      return;
    }
    if (S.offlineMode) void refreshCachedSessionAfterReconnect();
    presenceRef.onDisconnect().set({
      online: false,
      lastSeen: SERVER,
      showOnline: S.me?.showOnline !== false,
      showLastSeen: S.me?.showLastSeen !== false
    }).catch(() => {});
    presenceRef.update({ online: true, lastSeen: SERVER }).catch(() => {});
  };
  connectedRef.on('value', connectedHandler);
  S.realtimeUnsubs.push(() => connectedRef.off('value', connectedHandler));
  S.connectionRef = presenceRef;

  listenValue(`presence/${uid()}`, snap => {
    const p = snap.val() || {};
    S.presenceCache.set(uid(), p);
  });
  // A ban/deletion made by moderation must take effect for an already-open client too.
  // The RTDB status listener is within the signed-in user's own readable account node.
  listenValue(`users/${uid()}/status`, snap => {
    const status = snap.val();
    if (!['active', 'banned', 'deleted'].includes(status) || !S.me) return;
    S.me.status = status;
    S.userCache.set(uid(), S.me);
    writeCachedState('account', {
      me: S.me, contacts: [...S.contacts], blocked: [...S.blocked],
      blockedAt: Object.fromEntries(S.blockMeta), storyViewed: S.me.storyViewed || {}
    }, uid()).catch(() => {});
    if (status === 'active') return;
    S.pendingAuthError = status === 'banned' ? `الحساب محظور: ${S.me.banReason || 'راجع إدارة التطبيق'}` : 'هذا الحساب محذوف.';
    S.offlineMode = true;
    if (S.activeChatId) setMessageInputPreviewState(S.activeChatId, true);
    toast(S.pendingAuthError, 'error', 6000);
    auth.signOut().catch(e => console.warn('sign out after account status change failed:', e?.code || e));
  });
  loadChatCache();
  listenValue(`notifications/${uid()}`, snap => handleNotifications(snap.val() || {}));
  listenValue(`chatRequests/${uid()}`, snap => {
    S.chatRequests = snap.val() || {};
    writeCachedState('chatRequests', S.chatRequests, uid()).catch(() => {});
    scheduleChatListRender();
  });
  listenValue(`followers/${uid()}`, snap => {
    const values = Object.keys(snap.val() || {});
    S.storyAudience.followers = new Set(values);
    writeCachedState('storyFollowers', values, uid()).catch(() => {});
    renderStoryData(S.storyRaw);
  });
  listenValue(`following/${uid()}`, snap => {
    const values = Object.keys(snap.val() || {});
    S.storyAudience.following = new Set(values);
    writeCachedState('storyFollowing', values, uid()).catch(() => {});
    renderStoryData(S.storyRaw);
  });
  listenValue('userChats/' + uid(), snap => renderChatIndex(snap.val() || {}));

  const storyRef = db.ref('stories').orderByChild('expiresAt').limitToLast(200);
  const storyHandler = snap => {
    S.storyRaw = snap.val() || {};
    writeCachedState('stories', S.storyRaw, uid()).catch(() => {});
    renderStoryData(S.storyRaw);
  };
  storyRef.on('value', storyHandler, listenError('stories'));
  S.realtimeUnsubs.push(() => storyRef.off('value', storyHandler));
}

/* ==================== Notifications ==================== */
function handleNotifications(items) {
  Object.entries(items).forEach(([id, n]) => {
    if (!n || S.lastNotifications.has(id)) return;
    if (n.from && S.blocked.has(n.from) && ['message', 'message_request', 'follow'].includes(n.type)) {
      S.lastNotifications.add(id);
      if (!n.read) db.ref(`notifications/${uid()}/${id}/read`).set(true).catch(() => {});
      return;
    }
    S.lastNotifications.add(id);
    if (n.read) return;

    // Toast داخل التطبيق
    toast(`${n.title || 'إشعار'}${n.body ? ': ' + n.body : ''}`, 'info', 4500);

    // نغمة + اهتزاز
    notifyTone(n.type === 'message' ? 'message' : 'other');
    if (n.type === 'message') navigator.vibrate?.(20);

    // ✅ إشعار حقيقي على الجهاز
    const chatId = n.chatId || null;
    const chat = chatId ? S.chatCache.get(chatId) : null;
    const chatName = chat ? displayChatName(chat) : (n.title || 'Ghost Caffee');
    const senderName = n.from ? ('@' + (S.profileCache.get(n.from)?.username || '')) : '';
    const avatar = n.from ? safeImageUrl(S.profileCache.get(n.from)?.avatar) : '';

    const shouldNotify = document.hidden
      || !chatId
      || S.activeChatId !== chatId;

    if (shouldNotify && S.me?.settings?.notifications !== false) {
      showDeviceNotification({
        title: chatName,
        body: senderName
          ? `${senderName}: ${n.body || ''}`
          : (n.body || n.title || ''),
        chatId,
        chatType: chat?.type || 'private',
        senderId: n.from,
        senderName,
        avatar,
        tag: chatId ? `chat-${chatId}` : `notif-${id}`
      });
    }

    db.ref(`notifications/${uid()}/${id}/read`).set(true).catch(() => {});
  });
}

function resetAccountScopedMemory(accountUid) {
  if (!accountUid || S.cacheScopeUid === accountUid) return;
  // A browser/WebView can switch directly between Firebase users without being recreated.
  // Clear only in-memory identity-bound data; on-disk caches remain namespaced by UID.
  if (S.cacheScopeUid && S.cacheScopeUid !== accountUid) {
    detachRealtime({ preserveCache: false });
  }
  S.cacheScopeUid = accountUid;
  S.me = null;
  S.activeChatId = null;
  S.activeChat = null;
  S.userCache = new Map();
  S.profileCache = new Map();
  S.presenceCache = new Map();
  S.chatCache = new Map();
  S.messageCache = new Map();
  S.contacts = new Set();
  S.blocked = new Set();
  S.blockMeta = new Map();
  S.blockedMessageWindows = new Map();
  S.hiddenChats = new Set();
  S.profileRelations = new Map();
  S.chatIndex = null;
  S.chatRequests = {};
  S.chatListeners = new Map();
  S.passiveMessageListeners = new Map();
  S.storyAudience = { followers: new Set(), following: new Set() };
  S.storyRaw = {};
  S.stories = [];
  S.storyGroups = [];
  S.lastNotifications = new Set();
  S.profileFetchedAt = new Map();
  S.offlineStateRestoredUid = null;
  S.renderedMsgIds = null;
  S.currentReply = null;
  S.currentEdit = null;
  S.contextMessageId = null;
}

function loadChatCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(`ghostcaffee_chat_cache_${uid()}`) || '{}');
    Object.entries(raw).forEach(([id, c]) => { if (c?.id) S.chatCache.set(id, c); });
    const idx = JSON.parse(localStorage.getItem(`ghostcaffee_chat_index_${uid()}`) || 'null');
    if (idx && typeof idx === 'object') S.chatIndex = idx;
    const hidden = JSON.parse(localStorage.getItem(`ghostcaffee_hidden_chats_${uid()}`) || '[]');
    if (Array.isArray(hidden)) S.hiddenChats = new Set(hidden.filter(x => typeof x === 'string'));
    const blockedAt = JSON.parse(localStorage.getItem(`ghostcaffee_block_meta_${uid()}`) || '{}');
    if (blockedAt && typeof blockedAt === 'object' && !S.blockMeta.size) S.blockMeta = new Map(Object.entries(blockedAt).map(([id, at]) => [id, Number(at) || 0]));
    const windows = JSON.parse(localStorage.getItem(`ghostcaffee_block_windows_${uid()}`) || '{}');
    if (windows && typeof windows === 'object' && !S.blockedMessageWindows.size) S.blockedMessageWindows = new Map(Object.entries(windows).map(([id, rows]) => [id, Array.isArray(rows) ? rows.filter(w => w && Number(w.from) > 0).map(w => ({ from: Number(w.from), to: w.to == null ? null : Number(w.to) })) : []]));
  } catch {}
  if (S.chatIndex) scheduleChatListRender();
}

function saveChatCache() {
  try {
    const out = {};
    for (const [id, c] of S.chatCache) out[id] = c;
    localStorage.setItem(`ghostcaffee_chat_cache_${uid()}`, JSON.stringify(out));
  } catch (e) { console.warn('[Ghost Caffee] Browser storage is full; IndexedDB remains the primary cache.', e); }
  writeCachedState('chats', Object.fromEntries(S.chatCache), uid()).catch(() => {});
}

/* ==================== Durable account-scoped offline cache ====================
 * IndexedDB stores the user's own account state and individual messages. Cache data
 * is never sent to Firebase and is never placed in the Service Worker HTTP cache.
 * Legacy per-chat message snapshots are migrated forward on first access.
 */
function openLocalCacheDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (S.localCacheDbPromise) return S.localCacheDbPromise;
  S.localCacheDbPromise = new Promise(resolve => {
    let request;
    try { request = indexedDB.open(LOCAL_CACHE_DB, LOCAL_CACHE_SCHEMA_VERSION); }
    catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      const localDb = request.result;
      if (!localDb.objectStoreNames.contains('messages')) localDb.createObjectStore('messages', { keyPath: 'key' }); // legacy snapshots
      if (!localDb.objectStoreNames.contains('messageItems')) {
        const store = localDb.createObjectStore('messageItems', { keyPath: 'key' });
        store.createIndex('byAccountChat', ['accountUid', 'chatId'], { unique: false });
      } else {
        const store = request.transaction.objectStore('messageItems');
        if (!store.indexNames.contains('byAccountChat')) store.createIndex('byAccountChat', ['accountUid', 'chatId'], { unique: false });
      }
      if (!localDb.objectStoreNames.contains('appState')) localDb.createObjectStore('appState', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  }).catch(() => null);
  return S.localCacheDbPromise;
}

function localCacheKey(accountUid, chatId) { return `${accountUid}::${chatId}`; }
function stateCacheKey(accountUid, name) { return `${accountUid}::state::${name}`; }

function idbGet(dbRef, storeName, key) {
  return new Promise(resolve => {
    try {
      const req = dbRef.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function readCachedState(name, accountUid = uid()) {
  if (!accountUid) return null;
  const dbRef = await openLocalCacheDb();
  if (dbRef && dbRef.objectStoreNames.contains('appState')) {
    const row = await idbGet(dbRef, 'appState', stateCacheKey(accountUid, name));
    if (row && Object.prototype.hasOwnProperty.call(row, 'value')) return row.value;
  }
  try {
    const raw = localStorage.getItem(`ghostcaffee_state_${accountUid}_${name}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function writeCachedState(name, value, accountUid = uid()) {
  if (!accountUid || value === undefined) return;
  const dbRef = await openLocalCacheDb();
  if (dbRef && dbRef.objectStoreNames.contains('appState')) {
    await new Promise(resolve => {
      try {
        const tx = dbRef.transaction('appState', 'readwrite');
        tx.objectStore('appState').put({ key: stateCacheKey(accountUid, name), accountUid, name, value, updatedAt: Date.now() });
        tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
      } catch { resolve(); }
    });
  }
  // Small critical state has a localStorage fallback for unusual WebViews without IndexedDB.
  if (['account', 'chatIndex', 'config', 'hiddenChats', 'blockMeta', 'blockedWindows', 'profileRelations'].includes(name)) {
    try {
      let fallback = value;
      if (name === 'account' && value?.me) fallback = { ...value, me: { ...value.me, avatar: '', cover: '' } };
      const serialized = JSON.stringify(fallback);
      if (serialized.length < 800000) localStorage.setItem(`ghostcaffee_state_${accountUid}_${name}`, serialized);
    } catch {}
  }
}

async function restoreOfflineCollections(accountUid = uid()) {
  if (!accountUid || uid() !== accountUid || S.offlineStateRestoredUid === accountUid) return;
  const names = ['chatIndex', 'chats', 'profiles', 'chatRequests', 'stories', 'storyFollowers', 'storyFollowing', 'config', 'ownerProfile', 'hiddenChats', 'blockMeta', 'blockedWindows', 'profileRelations'];
  const values = await Promise.all(names.map(name => readCachedState(name, accountUid)));
  if (uid() !== accountUid) return;
  const cache = Object.fromEntries(names.map((name, i) => [name, values[i]]));
  if (!S.chatIndex && cache.chatIndex && typeof cache.chatIndex === 'object') S.chatIndex = cache.chatIndex;
  if (cache.chats && typeof cache.chats === 'object') {
    for (const [id, chat] of Object.entries(cache.chats)) if (chat?.id && !S.chatCache.has(id)) S.chatCache.set(id, chat);
  }
  if (Array.isArray(cache.profiles)) {
    S.profileFetchedAt = S.profileFetchedAt || new Map();
    cache.profiles.forEach(p => {
      if (!p?.id) return;
      if (!S.profileCache.has(p.id)) S.profileCache.set(p.id, p);
      if (!S.profileFetchedAt.has(p.id)) S.profileFetchedAt.set(p.id, Date.now());
    });
  }
  if (cache.chatRequests && !Object.keys(S.chatRequests || {}).length) S.chatRequests = cache.chatRequests;
  if (Array.isArray(cache.hiddenChats)) S.hiddenChats = new Set(cache.hiddenChats);
  if (cache.blockMeta && typeof cache.blockMeta === 'object' && !S.blockMeta.size) S.blockMeta = new Map(Object.entries(cache.blockMeta).map(([id, at]) => [id, Number(at) || 0]));
  if (cache.blockedWindows && typeof cache.blockedWindows === 'object' && !S.blockedMessageWindows.size) S.blockedMessageWindows = new Map(Object.entries(cache.blockedWindows).map(([id, rows]) => [id, Array.isArray(rows) ? rows.filter(w => w && Number(w.from) > 0).map(w => ({ from: Number(w.from), to: w.to == null ? null : Number(w.to) })) : []]));
  if (cache.profileRelations && typeof cache.profileRelations === 'object') {
    for (const [id, rel] of Object.entries(cache.profileRelations)) if (id && rel && !S.profileRelations.has(id)) S.profileRelations.set(id, rel);
  }
  if (cache.stories && typeof cache.stories === 'object' && !Object.keys(S.storyRaw || {}).length) {
    S.storyRaw = cache.stories;
    renderStoryData(S.storyRaw);
  }
  if (cache.storyFollowers) S.storyAudience.followers = new Set(cache.storyFollowers);
  if (cache.storyFollowing) S.storyAudience.following = new Set(cache.storyFollowing);
  if (cache.config) {
    if (!S.appConfig && cache.config.appConfig) S.appConfig = cache.config.appConfig;
    if (!S.ownerUid && cache.config.ownerUid) S.ownerUid = cache.config.ownerUid;
  }
  if (!S.ownerProfile && cache.ownerProfile) S.ownerProfile = cache.ownerProfile;
  S.offlineStateRestoredUid = accountUid;
  try { renderOwnerContact(); } catch {}
  if (S.chatIndex) {
    try { syncChatListeners(Object.keys(S.chatIndex)); } catch {}
    scheduleChatListRender();
  }
}

function compactMessagesForLocalCache(messages) {
  // Persist complete message payloads (including supported inline attachments) so they
  // remain available offline. Quota failures are caught by the write path, not truncated silently.
  return (Array.isArray(messages) ? messages : []).filter(m => m && m.id).map(original => ({ ...original }));
}

async function readCachedMessages(chatId) {
  const accountUid = uid();
  if (!accountUid || !chatId) return null;
  const localDb = await openLocalCacheDb();
  if (!localDb) {
    try { return JSON.parse(localStorage.getItem(`ghostcaffee_messages_${accountUid}_${chatId}`) || 'null'); } catch { return null; }
  }
  const messagesById = new Map();
  try {
    if (localDb.objectStoreNames.contains('messageItems')) {
      const rows = await new Promise(resolve => {
        try {
          const store = localDb.transaction('messageItems', 'readonly').objectStore('messageItems');
          const req = store.index('byAccountChat').getAll(IDBKeyRange.only([accountUid, chatId]));
          req.onsuccess = () => resolve(req.result || []); req.onerror = () => resolve([]);
        } catch { resolve([]); }
      });
      rows.forEach(row => { if (row?.message?.id) messagesById.set(row.message.id, row.message); });
    }
    const legacy = await idbGet(localDb, 'messages', localCacheKey(accountUid, chatId));
    if (legacy && Array.isArray(legacy.messages)) {
      legacy.messages.forEach(m => { if (m?.id && !messagesById.has(m.id)) messagesById.set(m.id, m); });
      // One-time migration: individual message rows avoid a growing whole-chat rewrite.
      await writeMessageRows(localDb, accountUid, chatId, legacy.messages);
    }
  } catch {}
  return messagesById.size ? [...messagesById.values()].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)) : null;
}

async function writeMessageRows(localDb, accountUid, chatId, messages) {
  if (!localDb?.objectStoreNames.contains('messageItems')) return;
  const compact = compactMessagesForLocalCache(messages);
  if (!compact.length) return;
  await new Promise(resolve => {
    try {
      const tx = localDb.transaction('messageItems', 'readwrite');
      const store = tx.objectStore('messageItems');
      for (const message of compact) {
        const messageId = String(message.id || '');
        if (!messageId) continue;
        store.put({ key: `${accountUid}::${chatId}::${messageId}`, accountUid, chatId, messageId, message, updatedAt: Date.now() });
      }
      tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
    } catch { resolve(); }
  });
}

async function writeCachedMessages(chatId, messages) {
  const accountUid = uid();
  if (!accountUid || !chatId || !Array.isArray(messages)) return;
  const localDb = await openLocalCacheDb();
  if (localDb) {
    await writeMessageRows(localDb, accountUid, chatId, messages);
    return;
  }
  // Limited fallback is only for old/incomplete WebViews without IndexedDB.
  try {
    const old = JSON.parse(localStorage.getItem(`ghostcaffee_messages_${accountUid}_${chatId}`) || '[]');
    const merged = new Map((Array.isArray(old) ? old : []).map(m => [m.id, m]));
    compactMessagesForLocalCache(messages).forEach(m => merged.set(m.id, m));
    localStorage.setItem(`ghostcaffee_messages_${accountUid}_${chatId}`, JSON.stringify([...merged.values()]));
  } catch (e) { console.warn('[Ghost Caffee] Message cache fallback unavailable:', e); }
}

async function clearCachedMessagesForCurrentUser() {
  const accountUid = uid();
  if (!accountUid) return;
  const localDb = await openLocalCacheDb();
  if (localDb) {
    await new Promise(resolve => {
      try {
        const tx = localDb.transaction(['messages', 'messageItems', 'appState'], 'readwrite');
        for (const storeName of ['messages', 'messageItems', 'appState']) {
          const store = tx.objectStore(storeName);
          const req = store.getAll();
          req.onsuccess = () => (req.result || []).filter(row => row.accountUid === accountUid || String(row.key || '').startsWith(`${accountUid}::`)).forEach(row => store.delete(row.key));
        }
        tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
      } catch { resolve(); }
    });
  }
  try {
    const prefix = `ghostcaffee_state_${accountUid}_`;
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(prefix)) toDelete.push(k); }
    toDelete.forEach(k => localStorage.removeItem(k));
    const messagePrefix = `ghostcaffee_messages_${accountUid}_`;
    const messageKeys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(messagePrefix)) messageKeys.push(k); }
    messageKeys.forEach(k => localStorage.removeItem(k));
    localStorage.removeItem(`ghostcaffee_chat_cache_${accountUid}`);
    localStorage.removeItem(`ghostcaffee_chat_index_${accountUid}`);
  } catch {}
}

function notifyTone(kind = 'other') {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || S.me?.settings?.sounds === false) return;
    const ac = new AC(), o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = kind === 'message' ? 880 : 660;
    g.gain.setValueAtTime(.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(.06, ac.currentTime + .01);
    g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + .13);
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + .15);
    setTimeout(() => ac.close?.(), 300);
  } catch {}
}

function makeNotification(targetUid, type, title, body, updates) {
  if (!targetUid || targetUid === uid()) return;
  const nid = db.ref(`notifications/${targetUid}`).push().key;
  updates[`notifications/${targetUid}/${nid}`] = {
    type, from: uid(), title, body, createdAt: SERVER, read: false
  };
}

/* ==================== Chat list ==================== */
const otherParticipant = c => Object.keys(c?.participants || {}).find(x => x !== uid());

function renderChatIndex(index) {
  S.chatIndex = index || {};
  try { localStorage.setItem(`ghostcaffee_chat_index_${uid()}`, JSON.stringify(S.chatIndex)); } catch {}
  writeCachedState('chatIndex', S.chatIndex, uid()).catch(() => {});
  syncChatListeners(Object.keys(S.chatIndex));
  saveChatCache();
  scheduleChatListRender();
}

function syncChatListeners(ids) {
  const wanted = new Set(ids);
  syncPassiveMessageListeners(ids);
  for (const [id, l] of [...S.chatListeners]) {
    if (wanted.has(id)) continue;
    try { l.ref.off('value', l.handler); } catch {}
    S.chatListeners.delete(id);
    S.chatCache.delete(id);
    
  }
  ids.forEach(id => {
    if (S.chatListeners.has(id)) return;
    const ref = db.ref(`chats/${id}`);
    const handler = snap => {
      if (!snap.exists()) {
        S.chatCache.delete(id);
        saveChatCache();
      } else {
        const c = { ...snap.val(), id };
        S.chatCache.set(id, c);
        saveChatCache();
        if (S.activeChatId === id) onActiveChatChanged(c);
      }
      scheduleChatListRender();
    };
    const onErr = err => {
      console.warn('chat listener failed:', id, err?.code || err);
      S.chatListeners.delete(id);
      // A listener failure is not proof that cached membership/chat data is invalid.
      scheduleChatListRender();
    };
    ref.on('value', handler, onErr);
    S.chatListeners.set(id, { ref, handler });
  });
}

function detachChatListeners(preserveCache = false) {
  for (const [, l] of S.passiveMessageListeners) {
    try { l.ref.off('child_added', l.handler); l.ref.off('child_changed', l.handler); } catch {}
  }
  S.passiveMessageListeners.clear();
  for (const [, l] of S.chatListeners) {
    try { l.ref.off('value', l.handler); } catch {}
  }
  S.chatListeners.clear();
  if (!preserveCache) {
    S.chatCache.clear();
    S.chatIndex = null;
  }
  clearTimeout(S.chatRenderTimer);
}

function isHiddenBlockedMessage(message, chatId) {
  const sender = message?.senderId;
  const chat = S.activeChat?.id === chatId ? S.activeChat : S.chatCache.get(chatId);
  // A direct-message block does not affect shared groups or unrelated senders.
  if (chat?.type !== 'private' || !sender || otherParticipant(chat) !== sender) return false;
  const timestamp = Number(message.timestamp || 0);
  const windows = S.blockedMessageWindows.get(sender) || [];
  if (timestamp && windows.some(w => timestamp >= Number(w.from || 0) && (w.to == null || timestamp <= Number(w.to)))) return true;
  if (!S.blocked.has(sender)) return false;
  const blockedAt = Number(S.blockMeta.get(sender) || 0);
  // Fail closed during an active block if an older cache has no recorded start time.
  return !blockedAt || !timestamp || timestamp >= blockedAt;
}

function cachePassiveMessageSnapshot(chatId, snap) {
  if (!chatId || !snap) return;
  const val = snap.val();
  if (!val || typeof val !== 'object') return;
  // Real child_* callbacks expose one message, while simple test/adaptor clients may
  // return the one-row query object. Handle both shapes without storing parent nodes.
  const looksLikeMessage = ('senderId' in val) || ('type' in val) || ('timestamp' in val) || ('text' in val);
  const items = (looksLikeMessage
    ? [{ ...val, id: snap.key }]
    : Object.entries(val).map(([id, message]) => message && typeof message === 'object' ? ({ ...message, id }) : null).filter(Boolean))
    .filter(message => !isHiddenBlockedMessage(message, chatId));
  if (items.length) writeCachedMessages(chatId, items).catch(() => {});
}

function syncPassiveMessageListeners(ids) {
  const wanted = new Set(ids);
  for (const [id, listener] of [...S.passiveMessageListeners]) {
    if (wanted.has(id)) continue;
    try {
      if (listener.ref && listener.handler) {
        listener.ref.off('child_added', listener.handler);
        listener.ref.off('child_changed', listener.handler);
      }
    } catch {}
    S.passiveMessageListeners.delete(id);
  }
  ids.forEach(chatId => {
    if (S.passiveMessageListeners.has(chatId)) return;
    // Reserve this chat immediately so index updates cannot create duplicate async
    // setup tasks while the cache cursor is being read.
    const listener = { ref: null, handler: null };
    S.passiveMessageListeners.set(chatId, listener);
    void (async () => {
      const cached = await readCachedMessages(chatId).catch(() => null);
      if (S.passiveMessageListeners.get(chatId) !== listener) return;
      const latestTimestamp = (cached || []).reduce((max, message) => Math.max(max, Number(message?.timestamp || 0)), 0);
      let ref = db.ref(`messages/${chatId}`).orderByChild('timestamp');
      if (latestTimestamp > 0) {
        // Replay every server message since the last locally cached timestamp. startAt
        // intentionally includes the cursor timestamp to cover equal-millisecond ties;
        // message IDs deduplicate those overlap rows in IndexedDB.
        ref = ref.startAt(latestTimestamp);
      } else {
        // One-time seed for a new/un-cached conversation, then capture arrivals live.
        ref = ref.limitToLast(100);
      }
      if (S.passiveMessageListeners.get(chatId) !== listener) return;
      const handler = snap => cachePassiveMessageSnapshot(chatId, snap);
      const onErr = err => console.warn('passive message cache listener failed:', chatId, err?.code || err);
      listener.ref = ref;
      listener.handler = handler;
      ref.on('child_added', handler, onErr);
      ref.on('child_changed', handler, onErr);
    })().catch(err => {
      if (S.passiveMessageListeners.get(chatId) === listener) S.passiveMessageListeners.delete(chatId);
      console.warn('passive message cache setup failed:', chatId, err?.code || err);
    });
  });
}

function onActiveChatChanged(c) {
  if (!c.participants?.[uid()] || (c.deletedAt && !isStaff())) {
    toast('لم تعد هذه المحادثة متاحة لك.', 'info');
    closeActiveChat();
    return;
  }
  const prev = S.activeChat || {};
  const headerChanged = c.name !== prev.name
    || Object.keys(c.participants || {}).length !== Object.keys(prev.participants || {}).length;
  S.activeChat = c;
  if (headerChanged) renderChatHeader();

  // صفّر العداد طالما المحادثة مفتوحة
  if (S.activeChatId === c.id && Number(c.unreadCount?.[uid()] || 0) > 0) {
    db.ref(`chats/${c.id}/unreadCount/${uid()}`).set(0).then(() => {
      const cached = S.chatCache.get(c.id);
      if (cached) {
        cached.unreadCount = cached.unreadCount || {};
        cached.unreadCount[uid()] = 0;
        S.chatCache.set(c.id, cached);
        saveChatCache();
        scheduleChatListRender();
      }
    }).catch(e => console.warn('unreadCount reset failed:', e?.code));
  }
}

function scheduleChatListRender() {
  clearTimeout(S.chatRenderTimer);
  S.chatRenderTimer = setTimeout(drawChatList, 50);
}

async function drawChatList() {
  const list = $('chat-list');
  const me = uid();
  if (!list || !me || !S.chatIndex) return;
  const seq = ++S.chatRenderSeq;
  const chats = Object.keys(S.chatIndex)
    .map(id => S.chatCache.get(id))
    .filter(c => c && c.participants?.[me] && !(c.deletedAt && !isStaff()) && !S.hiddenChats.has(c.id));
  const pending = Object.values(S.chatRequests || {}).filter(r => r?.status === 'pending' && r.toUid === me && !S.blocked.has(r.fromUid));
  await warmProfiles(
    chats.filter(c => c.type === 'private').map(otherParticipant)
      .concat(pending.map(r => r.fromUid))
  );
  if (seq !== S.chatRenderSeq) return;

  const q = S.chatQuery.trim().toLowerCase();
  const tab = S.chatTab;
  const visible = chats.filter(c => {
    const archived = !!c.archived?.[me];
    if (tab === 'archived') {
      if (!archived) return false;
    } else {
      if (archived) return false;
      if (tab === 'unread' && !(Number(c.unreadCount?.[me] || 0) > 0)) return false;
      if (tab === 'groups' && c.type !== 'group') return false;
    }
    if (q && !`${displayChatName(c)} ${c.lastMessage?.text || ''}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) =>
    (Number(!!b.pinned?.[me]) - Number(!!a.pinned?.[me]))
    || (Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
  );

  const requestHtml = pending
    .filter(r => !q || (`@${S.profileCache.get(r.fromUid)?.username || ''} طلب مراسلة`).toLowerCase().includes(q))
    .map(r => requestItemHtml(r.chatId, r))
    .join('');

  if (!chats.length && !requestHtml) {
    list.innerHTML = `
      <div class="chat-list-empty">
        <strong>لا توجد محادثات بعد</strong>
        <span>ابدأ بمراسلة مستخدم أو أنشئ مجموعة جديدة.</span>
        <div class="empty-actions">
          <button class="admin-btn" id="empty-new-chat">➕ محادثة جديدة</button>
          <button class="admin-btn" id="empty-new-group">👥 مجموعة جديدة</button>
        </div>
      </div>`;
  } else if (!visible.length && !requestHtml) {
    list.innerHTML = '<div class="chat-list-empty"><span>لا توجد نتائج في هذا القسم.</span></div>';
  } else {
    list.innerHTML = requestHtml + visible.map(c => chatItemHtml(c.id, c)).join('');
  }
}

function setChatTab(tab) {
  S.chatTab = tab;
  qsa('.chat-tab').forEach(b => b.classList.toggle('active', b.dataset.ctab === tab));
  scheduleChatListRender();
}

function displayChatName(c) {
  if (c.type === 'group') return c.name || 'مجموعة';
  const p = S.profileCache.get(otherParticipant(c));
  return p?.username ? '@' + p.username : 'محادثة';
}

function chatAvatarHtml(c) {
  if (c.type === 'group') {
    if (c.photo) return `<img src="${esc(safeImageUrl(c.photo))}" alt="">`;
    return `<span class="avatar-fallback">👥</span>`;
  }
  const p = S.profileCache.get(otherParticipant(c));
  return p?.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : '👻';
}

function requestItemHtml(id, r) {
  const p = S.profileCache.get(r.fromUid) || {};
  return `<div class="chat-item request-item" data-request-chat="${esc(id)}" data-request-from="${esc(r.fromUid)}">
    <div class="chat-item-avatar">${p.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : '👤'}</div>
    <div class="chat-item-info">
      <div class="chat-item-name">@${esc(p.username || r.fromUid.slice(0, 8))} ${userBadgesHtml(r.fromUid, 'sm')}</div>
      <div class="chat-item-last">📨 طلب مراسلة جديد</div>
    </div>
    <div class="request-actions">
      <button data-request-action="approve">قبول</button>
      <button data-request-action="reject">رفض</button>
    </div>
  </div>`;
}

function chatItemHtml(id, c) {
  const me = uid();
  const target = c.type === 'private' ? otherParticipant(c) : null;
  const mine = c.lastMessage?.senderId === me;
  const unread = target && S.blocked.has(target) ? 0 : Number(c.unreadCount?.[me] || 0);
  const lastText = target && S.blocked.has(target) ? '🚫 تم حظر هذا المستخدم' : (c.lastMessage?.text || 'لا توجد رسائل بعد');
  return `<div class="chat-item ${S.activeChatId === id ? 'active' : ''}" data-id="${esc(id)}">
    <div class="chat-item-avatar">${chatAvatarHtml(c)}</div>
    <div class="chat-item-info">
      <div class="chat-item-name">${esc(displayChatName(c))}${target ? userBadgesHtml(target, 'sm') : ''}${c.type === 'group' ? ' <small style="color:var(--text-secondary);font-weight:400">· ' + Object.keys(c.participants || {}).length + '</small>' : ''}</div>
      <div class="chat-item-last">${mine ? 'أنت: ' : ''}${esc(lastText.slice(0, 80))}</div>
    </div>
    <div class="chat-item-meta">
      <span class="chat-item-time">${c.lastMessage ? relativeTime(c.updatedAt || c.createdAt) : ''}</span>
      ${unread ? `<b class="chat-item-badge">${unread > 99 ? '99+' : unread}</b>` : ''}
      ${c.pinned?.[me] ? '<span class="chat-item-pin">📌</span>' : ''}
      ${c.muted?.[me] ? '<span class="chat-item-mute">🔕</span>' : ''}
    </div>
  </div>`;
}

async function warmProfiles(userIds) {
  // A cached profile is better than blocking message rendering on a network timeout.
  if (S.offlineMode) return;
  const t = now();
  S.profileFetchedAt = S.profileFetchedAt || new Map();
  const missing = [...new Set(userIds)]
    .filter(x => x && (!S.profileCache.has(x) || t - (S.profileFetchedAt.get(x) || 0) > 5 * 60 * 1000));
  await Promise.all(missing.map(async id => {
    const ps = await withDeadline(db.ref(`profiles/${id}`).once('value'), 2600, 'profile lookup').catch(() => null);
    if (ps?.exists()) {
      S.profileCache.set(id, { ...ps.val(), id });
      S.profileFetchedAt.set(id, t);
    }
    // users/{id} خاص — يُقرأ فقط لنفسنا أو للإداريين
    if (isStaff() || id === uid()) {
      const us = await withDeadline(db.ref(`users/${id}`).once('value'), 2600, 'user lookup').catch(() => null);
      if (us?.exists()) S.userCache.set(id, { ...us.val(), id });
    }
  }));
  writeCachedState('profiles', [...S.profileCache.values()], uid()).catch(() => {});
}

/* ==================== Open / close chat ==================== */
function stopMyTyping() {
  clearTimeout(S.typingTimer);
  S.typingSent = false;
  if (S.activeChatId && uid()) db.ref(`typing/${S.activeChatId}/${uid()}`).remove().catch(() => {});
}

async function openChatMonitor(chatId) {
  if (!isOwner() || !chatId) return;
  try {
    const snap = await db.ref(`chats/${chatId}`).once('value');
    if (!snap.exists()) return toast('المحادثة غير موجودة.', 'error');
    const c = { ...snap.val(), id: chatId };
    S.monitorMode = true;
    S.activeChatId = chatId;
    S.activeChat = c;
    S.chatCache.set(chatId, c);
    $('chat-view')?.classList.remove('hidden');
    $('chat-empty')?.classList.add('hidden');
    $('input-bar')?.classList.add('hidden');
    await renderChatHeader();
    loadMessages(chatId);
    toast('وضع المراقبة: قراءة فقط.', 'info');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function openChat(chatId) {
  if (!chatId || S.openingChat === chatId) return;
  S.openingChat = chatId;
  try {
    let snap;
    let usingLocalChatPreview = false;
    let c;
    try {
      if (S.offlineMode) throw Object.assign(new Error('offline mode'), { code: 'APP_OFFLINE' });
      snap = await withDeadline(db.ref(`chats/${chatId}`).once('value'), 2600, 'chat read');
      if (!snap.exists()) return toast('المحادثة غير متاحة.', 'error');
      c = { ...snap.val(), id: chatId };
    } catch (readError) {
      // A previously confirmed membership may open a local read-only preview while offline.
      // No send/edit/delete action is authorized by this fallback; Firebase rules remain decisive.
      const cachedChat = S.chatCache.get(chatId);
      if (!cachedChat?.participants?.[uid()] || (cachedChat.deletedAt && !isStaff())) {
        return toast('تعذر فتح المحادثة دون اتصال، ولم توجد نسخة محلية صالحة لها.', 'error');
      }
      c = { ...cachedChat, id: chatId };
      usingLocalChatPreview = true;
    }
    if (c.deletedAt && !isStaff()) return toast('هذه المحادثة محذوفة إدارياً.', 'error');
    if (!c.participants?.[uid()]) return toast('ليس لديك صلاحية لهذه المحادثة.', 'error');

    if (c.type === 'private' && c.requestState === 'pending') {
      return c.createdBy === uid()
        ? toast('بانتظار موافقة الطرف الآخر.', 'info')
        : toast('لديك طلب مراسلة. اقبله من قائمة المحادثات.', 'info');
    }
    if (c.type === 'private' && c.requestState === 'rejected') {
      return toast('تم رفض طلب المراسلة سابقاً.', 'info');
    }

    if (S.activeChatId && S.activeChatId !== chatId) {
      stopMyTyping();
      S.currentReply = null;
      S.currentEdit = null;
      S.pendingAttachment = null;
      const inp = $('message-input');
      if (inp) { inp.value = ''; resizeMessageInput(); }
      $('upload-progress')?.classList.add('hidden');
      $('chat-search-bar')?.classList.add('hidden');
      updateReplyEditUI();
      updateSendButtons();
    }
    S.monitorMode = false;
    S.activeChatId = chatId;
    S.activeChat = c;
    S.chatCache.set(chatId, c);
    saveChatCache();
    qsa('#chat-list .chat-item').forEach(x => x.classList.toggle('active', x.dataset.id === chatId));
    $('chat-view')?.classList.remove('hidden');
    $('input-bar')?.classList.remove('hidden');
    $('chat-empty')?.classList.add('hidden');
    if (isMobile()) $('sidebar')?.classList.remove('open');
    await renderChatHeader();
    if (usingLocalChatPreview) $('input-bar')?.classList.add('hidden');
    bindActiveChatPresence();
    bindActiveChatTyping();
    loadMessages(chatId);
    if (usingLocalChatPreview) toast('تعذر الاتصال؛ فُتحت نسخة القراءة المحلية. الإرسال والتغييرات تحتاج إلى اتصال.', 'info', 4500);

    // صفّر العداد فوراً
    if (!S.offlineMode && Number(c.unreadCount?.[uid()] || 0) > 0) {
      db.ref(`chats/${chatId}/unreadCount/${uid()}`).set(0).then(() => {
        const cached = S.chatCache.get(chatId);
        if (cached) {
          cached.unreadCount = cached.unreadCount || {};
          cached.unreadCount[uid()] = 0;
          S.chatCache.set(chatId, cached);
          saveChatCache();
          scheduleChatListRender();
        }
      }).catch(() => {});
    }
  } finally {
    S.openingChat = null;
  }
}

function closeActiveChat() {
  stopMyTyping();
  S.messageUnsubs.forEach(fn => { try { fn(); } catch {} });
  S.messageUnsubs = [];
  if (S.chatPresenceUnsub) { try { S.chatPresenceUnsub(); } catch {} S.chatPresenceUnsub = null; }
  if (S.chatTypingUnsub) { try { S.chatTypingUnsub(); } catch {} S.chatTypingUnsub = null; }
  S.activeChatId = null;
  S.activeChat = null;
  S.monitorMode = false;
  S.renderedMsgIds = null;
  S.currentReply = null;
  S.currentEdit = null;
  S.pendingAttachment = null;
  $('chat-view')?.classList.add('hidden');
  $('chat-empty')?.classList.remove('hidden');
  $('upload-progress')?.classList.add('hidden');
  $('typing-indicator')?.classList.add('hidden');
  const inp = $('message-input');
  if (inp) { inp.value = ''; resizeMessageInput(); }
  updateReplyEditUI();
  updateSendButtons();
  qsa('#chat-list .chat-item.active').forEach(x => x.classList.remove('active'));
  if (isMobile()) $('sidebar')?.classList.add('open');
}

async function renderChatHeader() {
  const c = S.activeChat;
  if (!c) return;
  const target = c.type === 'private' ? otherParticipant(c) : null;
  if (target) await warmProfiles([target]);
  if (S.activeChat?.id !== c.id) return;
  const nm = $('chat-name');
  if (nm) nm.textContent = displayChatName(c);
  const p = target ? (S.profileCache.get(target) || {}) : {};
  const st = $('chat-status');
  if (st) st.textContent = c.type === 'group' ? `${Object.keys(c.participants || {}).length} أعضاء` : (p.bio || 'محادثة خاصة');
  const av = $('chat-avatar');
  if (av) {
    av.innerHTML = c.type === 'group'
      ? (c.photo ? `<img src="${esc(safeImageUrl(c.photo))}" alt="">` : '👥')
      : (p.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : '👤');
  }
  if (target && S.blocked.has(target)) {
    if (st) st.textContent = 'تم حظر المستخدم — الرسائل الجديدة مخفية';
  } else if (target) updatePresenceText();
  applyChatBackground();
  const banner = $('group-ban-banner');
  if (banner) {
    const mePart = c.participants?.[uid()] || {};
    const perma = c.blocked?.[uid()] === true;
    const temp = mePart.bannedUntil && Number(mePart.bannedUntil) > now();
    const isBanned = c.type === 'group' && (perma || temp);
    banner.classList.toggle('hidden', !isBanned);
    const privateBlocked = c.type === 'private' && S.blocked.has(target);
    $('input-bar')?.classList.toggle('hidden', isBanned || privateBlocked || S.monitorMode || S.offlineMode);
    const blockMenuButton = qs('#chat-menu [data-action="block"]');
    if (blockMenuButton && c.type === 'private') {
      blockMenuButton.textContent = S.blocked.has(target) ? '✅ إلغاء حظر المستخدم' : '🚫 حظر المستخدم';
      blockMenuButton.classList.toggle('danger', !S.blocked.has(target));
      blockMenuButton.disabled = !target || target === S.ownerUid;
    } else if (blockMenuButton) { blockMenuButton.textContent = '🚫 حظر'; blockMenuButton.disabled = true; }
    if (isBanned) {
      banner.innerHTML = `🚫 ${perma
        ? 'أنت محظور من هذه المجموعة بشكل دائم.'
        : `أنت محظور مؤقتاً حتى ${esc(dayTime(mePart.bannedUntil))}.`} ${mePart.banReason ? `<br><small>السبب: ${esc(mePart.banReason)}</small>` : ''} ${S.ownerUid && uid() !== S.ownerUid ? '<button id="request-unban" class="btn-sm">طلب رفع الحظر</button>' : ''}`;
      $('request-unban')?.addEventListener('click', () => startPrivateByUid(S.ownerUid));
    }
  }
}

/* ==================== Messages ==================== */
function setMessageInputPreviewState(chatId, cachedOnly) {
  if (S.activeChatId !== chatId) return;
  const bar = $('input-bar');
  if (!bar) return;
  if (cachedOnly || S.offlineMode) { bar.classList.add('hidden'); return; }
  const c = S.activeChat;
  const part = c?.participants?.[uid()] || {};
  const groupBanned = c?.type === 'group' && (c.blocked?.[uid()] === true || (part.bannedUntil && Number(part.bannedUntil) > now()));
  const privateBlocked = c?.type === 'private' && S.blocked.has(otherParticipant(c));
  bar.classList.toggle('hidden', !!groupBanned || !!privateBlocked || !!S.monitorMode);
}

function loadMessages(chatId) {
  S.messageUnsubs.forEach(fn => { try { fn(); } catch {} });
  S.renderedMsgIds = null;
  S.messageUnsubs = [];
  const host = $('messages-container');
  if (host) { delete host.dataset.cacheState; host.innerHTML = '<div class="chat-list-empty"><span>جارٍ تحميل الرسائل…</span></div>'; }
  S.forceScroll = true;
  let liveSnapshotReceived = false;
  const cachedPromise = readCachedMessages(chatId).then(cached => {
    if (!cached || liveSnapshotReceived || S.activeChatId !== chatId) return null;
    S.messageCache.set(chatId, cached);
    renderMessages(cached);
    if (host) host.dataset.cacheState = 'offline-preview';
    setMessageInputPreviewState(chatId, true);
    return cached;
  }).catch(() => null);
  const ref = db.ref(`messages/${chatId}`).orderByChild('timestamp').limitToLast(300);
  const handler = async snap => {
    if (S.activeChatId !== chatId) return;
    liveSnapshotReceived = true;
    const allRemoteMessages = [];
    snap.forEach(ch => { allRemoteMessages.push({ ...ch.val(), id: ch.key }); });
    const remoteMessages = allRemoteMessages.filter(m => !isHiddenBlockedMessage(m, chatId));
    // Upsert instead of replacing: older messages already received on this device
    // remain available even though the live query is limited to its newest window.
    await writeCachedMessages(chatId, remoteMessages).catch(() => {});
    const cachedMessages = await readCachedMessages(chatId).catch(() => null);
    const merged = new Map((cachedMessages || []).map(m => [m.id, m]));
    remoteMessages.forEach(m => merged.set(m.id, m));
    const messages = [...merged.values()]
      .filter(m => !isHiddenBlockedMessage(m, chatId))
      .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
    S.messageCache.set(chatId, messages);
    if (host) delete host.dataset.cacheState;
    setMessageInputPreviewState(chatId, false);
    if (S.activeChat?.type === 'group') await warmProfiles(messages.map(m => m.senderId));
    if (S.activeChatId !== chatId) return;
    renderMessages(messages);
    markMessagesRead(messages);
  };
  const onErr = async err => {
    console.warn('messages listener failed:', err?.code || err);
    const cached = await cachedPromise;
    if (S.activeChatId !== chatId) return;
    if (cached?.length) {
      if (host) host.dataset.cacheState = 'offline-preview';
      setMessageInputPreviewState(chatId, true);
      toast('تعذر الاتصال الآن؛ تُعرض آخر الرسائل المحفوظة على هذا الجهاز.', 'info', 4200);
      return;
    }
    if (host) host.innerHTML = '<div class="chat-list-empty"><strong>تعذر تحميل الرسائل</strong><span>تحقق من اتصالك وصلاحيات Realtime Database.</span></div>';
    setMessageInputPreviewState(chatId, true);
    toast(`تعذر تحميل الرسائل: ${firebaseErrorMessage(err)}`, 'error');
  };
  ref.on('value', handler, onErr);
  S.messageUnsubs.push(() => ref.off('value', handler));
}

async function markMessagesRead(messages) {
  const chatId = S.activeChatId;
  if (!chatId || !uid() || S.offlineMode) return;

  const updates = {};
  for (const m of messages) {
    if (m.senderId === uid() || m.deletedForAll) continue;
    if (!m.deliveredTo?.[uid()]) updates[`messages/${chatId}/${m.id}/deliveredTo/${uid()}`] = SERVER;
    if (S.me?.settings?.readReceipts !== false && !m.readBy?.[uid()])
      updates[`messages/${chatId}/${m.id}/readBy/${uid()}`] = SERVER;
  }

  // صفّر العداد
  const currentUnread = Number(S.chatCache.get(chatId)?.unreadCount?.[uid()] || 0);
  if (currentUnread > 0) {
    updates[`chats/${chatId}/unreadCount/${uid()}`] = 0;
    const cached = S.chatCache.get(chatId);
    if (cached) {
      cached.unreadCount = cached.unreadCount || {};
      cached.unreadCount[uid()] = 0;
      S.chatCache.set(chatId, cached);
      saveChatCache();
      scheduleChatListRender();
    }
  }

  if (Object.keys(updates).length) {
    try {
      await db.ref().update(updates);
    } catch (e) {
      console.warn('read receipt failed:', e?.code, e?.message);
    }
  }
}

function renderMessages(messages) {
  const host = $('messages-container');
  if (!host) return;
  const me = uid();
  const visible = messages.filter(m => !m.deletedFor?.[me] && !isHiddenBlockedMessage(m, S.activeChatId));
  const nearBottom = S.forceScroll || (host.scrollHeight - host.scrollTop - host.clientHeight < 140);
  const prevTop = host.scrollTop;
  const prevIds = S.renderedMsgIds;
  const isFirstRender = !prevIds;
  if (visible.length) {
    host.innerHTML = visible.map(m => {
      const html = messageHtml(m);
      if (!isFirstRender && !prevIds.has(m.id)) {
        return html.replace('class="message ', 'class="message new ');
      }
      return html;
    }).join('');
  } else {
    host.innerHTML = '<div class="chat-list-empty"><span>لا توجد رسائل بعد. ابدأ المحادثة 👋</span></div>';
  }
  S.renderedMsgIds = new Set(visible.map(m => m.id));
  host.scrollTop = nearBottom ? host.scrollHeight : prevTop;
  S.forceScroll = false;
}

function messageHtml(m) {
  const me = uid();
  const mine = m.senderId === me;
  const deleted = !!m.deletedForAll;
  const url = fileUrl(m.fileData);
  let body = '';
  if (deleted) body = '<em>تم حذف الرسالة</em>';
  else if (m.type === 'image') body = url ? `<img class="message-image" loading="lazy" src="${esc(url)}" alt="${esc(m.fileData?.name || 'صورة')}">` : (m.localCacheMediaOmitted ? '<div class="cached-media-placeholder">🖼️ الصورة الأصلية تظهر عند الاتصال مجدداً</div>' : '<div class="cached-media-placeholder">تعذر عرض الصورة</div>');
  else if (m.type === 'video') body = url ? `<video class="message-video" controls preload="metadata" src="${esc(url)}"></video>` : (m.localCacheMediaOmitted ? '<div class="cached-media-placeholder">🎬 الفيديو الأصلي يظهر عند الاتصال مجدداً</div>' : '<div class="cached-media-placeholder">تعذر عرض الفيديو</div>');
  else if (m.type === 'audio') body = url ? `<audio class="message-audio" controls src="${esc(url)}"></audio>` : (m.localCacheMediaOmitted ? '<div class="cached-media-placeholder">🎵 الملف الصوتي يظهر عند الاتصال مجدداً</div>' : '<div class="cached-media-placeholder">تعذر تشغيل الصوت</div>');
  else if (m.type === 'file') body = url ? `<a class="message-file" href="${esc(url)}" download="${esc(m.fileData?.name || 'file')}"><span class="message-file-icon">📎</span><span class="message-file-info"><span class="message-file-name">${esc(m.fileData?.name || 'ملف')}</span><span class="message-file-size">${esc(m.fileData?.size ? bytes(m.fileData.size) : '')}</span></span></a>` : (m.localCacheMediaOmitted ? `<div class="cached-media-placeholder">📎 ${esc(m.fileData?.name || 'المرفق')} — يُتاح عند الاتصال مجدداً</div>` : '<div class="cached-media-placeholder">تعذر فتح الملف</div>');
  else body = escapeHtmlLine(m.text || '');
  if (!deleted && m.type !== 'text' && m.text) body += `<div class="message-caption">${escapeHtmlLine(m.text)}</div>`;

  let replyHtml = '';
  if (m.replyTo && !deleted) {
    const storyReply = String(m.replyTo.messageId || '').startsWith('story_');
    const who = storyReply ? 'قصة' : (m.replyTo.senderId === me ? 'أنت' : '@' + (S.profileCache.get(m.replyTo.senderId)?.username || 'رد'));
    replyHtml = `<div class="msg-reply" data-reply-id="${esc(m.replyTo.messageId || '')}"><span class="msg-reply-sender">↩ ${esc(who)}</span><span class="msg-reply-text">${esc((m.replyTo.text || '').slice(0, 80))}</span></div>`;
  }

  let reactionsHtml = '';
  if (m.reactions && !deleted) {
    const grouped = {};
    Object.entries(m.reactions).forEach(([u, r]) => {
      if (r) (grouped[r] = grouped[r] || []).push(u);
    });
    if (Object.keys(grouped).length) {
      reactionsHtml = '<div class="msg-reactions">' + Object.entries(grouped).map(([r, us]) =>
        `<span class="reaction-chip ${us.includes(me) ? 'mine' : ''}" data-reaction="${esc(r)}">${esc(r)} ${us.length}</span>`
      ).join('') + '</div>';
    }
  }

  const edited = m.edited && !deleted ? ' · معدل' : '';
  const readByOthers = m.readBy && Object.keys(m.readBy).some(x => x !== me);
  const deliveredToOthers = m.deliveredTo && Object.keys(m.deliveredTo).some(x => x !== me);
  const status = mine && !deleted
    ? `<span class="message-status ${readByOthers ? 'read' : deliveredToOthers ? 'delivered' : ''}">${readByOthers || deliveredToOthers ? '✓✓' : '✓'}</span>`
    : '';
  const star = m.starred?.[me] ? '<span class="msg-star">⭐</span>' : '';
  const senderLabel = !mine && S.activeChat?.type === 'group'
    ? `<span class="msg-sender profile-link" data-profile-id="${esc(m.senderId)}">@${esc(S.profileCache.get(m.senderId)?.username || String(m.senderId || '').slice(0, 6))}</span>`
    : '';

  return `<div class="message ${mine ? 'out' : 'in'} ${deleted ? 'deleted' : ''}" data-id="${esc(m.id)}">
    <div class="message-bubble">
      ${senderLabel}${replyHtml}${body}${reactionsHtml}
      <div class="message-meta"><span>${star}${esc(dayTime(m.timestamp))}${edited}</span>${status}</div>
    </div>
  </div>`;
}

async function addReactionTo(ev, messageId, reaction) {
  if (!S.activeChatId) return;
  if (S.offlineMode || S.dbConnected === false) return toast('التفاعلات تحتاج إلى اتصال؛ لم يتغير شيء.', 'info');
  try {
    const path = `messages/${S.activeChatId}/${messageId}/reactions/${uid()}`;
    const cur = (await db.ref(path).once('value')).val();
    await db.ref(path).set(cur === reaction ? null : reaction);
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

/* ==================== Send message ==================== */
function updateSendButtons() {
  const has = ($('message-input')?.value || '').trim().length > 0 || !!S.pendingAttachment;
  $('btn-send')?.classList.toggle('hidden', !has);
  $('btn-voice')?.classList.toggle('hidden', has);
}

const attachmentIcon = t =>
  t === 'image' ? '📷'
  : t === 'video' ? '🎥'
  : t === 'audio' ? '🎵'
  : '📎';

async function sendMessage() {
  if (S.sending) return;
  if (!S.activeChatId || !S.activeChat || !S.me || S.monitorMode) return;
  // Firebase can queue writes while disconnected; do not silently queue sends from a cached-only preview.
  if (S.offlineMode || S.dbConnected === false) return toast('أنت في وضع القراءة دون اتصال. ستتمكن من الإرسال بعد عودة الاتصال.', 'info');
  if (S.me.status !== 'active') return toast('الحساب غير نشط.', 'error');
  const chatId = S.activeChatId;
  const chat = S.activeChat;
  const input = $('message-input');
  const text = (input?.value || '').trim();
  const att = S.pendingAttachment;
  if (!text && !att) return;
  if (text.length > MAX_TEXT) return toast(`الرسالة تتجاوز ${MAX_TEXT} حرف.`, 'error');
  if (!chat.participants?.[uid()]) return toast('لم تعد عضواً في هذه المحادثة.', 'error');
  const myPart = chat.participants?.[uid()] || {};
  if (chat.requestState === 'rejected') return toast('تم رفض طلب المراسلة. لا يمكن إرسال رسائل.', 'error');
  if (chat.requestState === 'pending') return toast('المحادثة بانتظار الموافقة.', 'info');
  if (chat.type === 'group' && chat.blocked?.[uid()] === true) return toast('أنت محظور من هذه المجموعة.', 'error');
  if (chat.type === 'group' && myPart.bannedUntil && Number(myPart.bannedUntil) > now())
    return toast(`أنت محظور مؤقتاً حتى ${dayTime(myPart.bannedUntil)}.`, 'error');
  if (chat.type === 'private') {
    const t = otherParticipant(chat);
    if (t && S.blocked.has(t)) return toast('أنت حاظر هذا المستخدم. ألغِ الحظر لتتمكن من المراسلة.', 'error');
  }

  S.sending = true;
  try {
    if (S.currentEdit) {
      if (!text) return toast('لا يمكن أن تكون الرسالة المعدّلة فارغة.', 'error');
      const up = {};
      up[`messages/${chatId}/${S.currentEdit}/text`] = text;
      up[`messages/${chatId}/${S.currentEdit}/edited`] = true;
      await db.ref().update(up);
      cancelEdit();
      input.value = '';
      resizeMessageInput();
      updateSendButtons();
      return;
    }

    // اقرأ المحادثة الحية
    let liveChat = chat;
    try {
      const fresh = await db.ref(`chats/${chatId}`).once('value');
      if (fresh.exists()) liveChat = { ...fresh.val(), id: chatId };
    } catch (readErr) {
      console.warn('sendMessage: fresh read failed', readErr?.code);
    }

    if (!liveChat.participants?.[uid()]) return toast('لم تعد عضواً في هذه المحادثة.', 'error');
    if (liveChat.deletedAt && !isStaff()) return toast('هذه المحادثة غير متاحة.', 'error');
    if (liveChat.type === 'private') {
      const rs = liveChat.requestState;
      if (rs === 'rejected') return toast('تم رفض طلب المراسلة.', 'error');
      if (rs === 'pending') return toast('بانتظار الموافقة.', 'info');
      const targetUid = otherParticipant(liveChat);
      if (targetUid && S.blocked.has(targetUid)) return toast('هذا المستخدم محظور لديك. ألغِ الحظر أولاً.', 'error');
    } else {
      const freshPart = liveChat.participants?.[uid()] || {};
      if (liveChat.blocked?.[uid()] === true || (freshPart.bannedUntil && Number(freshPart.bannedUntil) > now()))
        return toast('لا يمكنك الإرسال بسبب الحظر في هذه المجموعة.', 'error');
    }

    const freshParts = liveChat.participants || {};
    const activeParticipants = Object.keys(freshParts).filter(
      x => x && x !== uid() && freshParts[x] && freshParts[x].role
    );

    const id = db.ref(`messages/${chatId}`).push().key;
    const rec = { senderId: uid(), timestamp: SERVER, status: 'sent', type: att ? att.type : 'text' };
    if (text) rec.text = text;
    if (att) rec.fileData = att.data;
    if (S.currentReply) {
      rec.replyTo = {
        messageId: S.currentReply.id,
        senderId: S.currentReply.senderId || '',
        text: String(S.currentReply.text || (S.currentReply.fileData?.name ? attachmentIcon(S.currentReply.type) + ' ' + S.currentReply.fileData.name : '')).slice(0, 180)
      };
    }
    const preview = (att ? `${attachmentIcon(att.type)} ${text || att.data?.name || ''}` : text).slice(0, 500);
    const updates = {};
    updates[`messages/${chatId}/${id}`] = rec;
    updates[`chats/${chatId}/lastMessage`] = { senderId: uid(), text: preview, type: rec.type };
    updates[`chats/${chatId}/updatedAt`] = SERVER;
    activeParticipants.forEach(target => {
      updates[`chats/${chatId}/unreadCount/${target}`] = firebase.database.ServerValue.increment(1);
      makeNotification(target, 'message', 'رسالة جديدة', `${S.me.username}: ${preview}`, updates);
    });
    S.forceScroll = true;
    await db.ref().update(updates);

    input.value = '';
    resizeMessageInput();
    S.pendingAttachment = null;
    S.currentReply = null;
    $('upload-progress')?.classList.add('hidden');
    stopMyTyping();
    updateReplyEditUI();
    updateSendButtons();
  } catch (e) {
    console.error('sendMessage failed:', {
      code: e?.code,
      message: e?.message,
      chatId: S.activeChatId,
      me: uid(),
      chatType: S.activeChat?.type,
      requestState: S.activeChat?.requestState,
      participants: Object.keys(S.activeChat?.participants || {})
    });
    const denied = e?.code === 'PERMISSION_DENIED' || e?.code === 'database/permission-denied';
    toast(
      denied
        ? 'تعذر الإرسال: القواعد رفضت العملية. افتح Console (F12) وأرسل لي رسالة الخطأ الكاملة.'
        : firebaseErrorMessage(e),
      'error', 6000
    );
  } finally {
    S.sending = false;
  }
}

/* ==================== Attachment ==================== */
function readAsDataUrl(blobOrFile) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('تعذر قراءة الملف.'));
    r.readAsDataURL(blobOrFile);
  });
}

async function prepareAttachment(file) {
  if (!file) return;
  if (!S.activeChatId) return toast('افتح محادثة أولاً.', 'error');
  if (file.size > MAX_FILE_BYTES) return toast('الحد الأقصى للملف داخل RTDB هو 2MB.', 'error');
  try {
    let type = 'file', dataUrl = '', mime = file.type || 'application/octet-stream', size = file.size;
    if (file.type.startsWith('image/')) {
      type = 'image';
      dataUrl = await compressImage(file, 1280, .78);
      mime = 'image/jpeg';
      size = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
    } else {
      if (file.type.startsWith('video/')) type = 'video';
      else if (file.type.startsWith('audio/')) type = 'audio';
      dataUrl = await readAsDataUrl(file);
    }
    if (!safeDataUrl(dataUrl)) return toast('تعذر تجهيز الملف.', 'error');
    if (dataUrl.length > MAX_DATA_URL_LENGTH || size > MAX_FILE_BYTES)
      return toast('بعد التحويل أصبح الملف أكبر من الحد المسموح (2MB).', 'error');
    S.pendingAttachment = {
      type,
      data: { name: String(file.name || 'file').slice(-200), size, mime: mime.slice(0, 100), dataUrl }
    };
    showAttachmentBar(S.pendingAttachment.data.name);
    updateSendButtons();
  } catch (e) {
    toast(e.message || 'تعذر تجهيز الملف.', 'error');
  }
}

function showAttachmentBar(name) {
  const fn = $('upload-filename');
  if (fn) fn.textContent = name;
  const pc = $('upload-percent');
  if (pc) pc.textContent = 'جاهز للإرسال · اضغط للإلغاء ✕';
  const pf = $('progress-fill');
  if (pf) pf.style.width = '100%';
  $('upload-progress')?.classList.remove('hidden');
}

function cancelAttachment() {
  S.pendingAttachment = null;
  $('upload-progress')?.classList.add('hidden');
  updateSendButtons();
}

/* ===================================================================
 * ==================== STORY SYSTEM =================================
 * =================================================================== */

function renderStoryData(raw) {
  S.storyRaw = raw || {};
  const current = now();
  const audience = S.storyAudience || { followers: new Set(), following: new Set() };
  S.stories = Object.entries(S.storyRaw)
    .map(([id, s]) => ({ ...s, id }))
    .filter(s => s.active === true && Number(s.expiresAt || 0) > current)
    .filter(s =>
      s.userId === uid()
      || isOwner()
      || audience.followers.has(s.userId)
      || audience.following.has(s.userId)
      || !!S.chatIndex?.[[uid(), s.userId].sort().join('_')]
    )
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

  const groups = new Map();
  S.stories.forEach(s => {
    if (!groups.has(s.userId)) groups.set(s.userId, []);
    groups.get(s.userId).push(s);
  });
  const myId = uid();
  S.storyGroups = [...groups.entries()].map(([userId, stories]) => ({ userId, stories }));
  S.storyGroups.sort((a, b) => {
    if (a.userId === myId) return -1;
    if (b.userId === myId) return 1;
    const aUnread = a.stories.some(s => !S.me?.storyViewed?.[s.id]);
    const bUnread = b.stories.some(s => !S.me?.storyViewed?.[s.id]);
    if (aUnread !== bUnread) return aUnread ? -1 : 1;
    const aLast = Math.max(...a.stories.map(s => Number(s.createdAt || 0)));
    const bLast = Math.max(...b.stories.map(s => Number(s.createdAt || 0)));
    return bLast - aLast;
  });
  renderStoriesBar();
}

async function renderStoriesBar() {
  const host = $('stories-bar');
  if (!host) return;
  await warmProfiles(S.storyGroups.map(x => x.userId));
  host.innerHTML = `<div class="story-add" id="story-add"><div class="story-add-circle">＋</div><span>قصتي</span></div>` +
    S.storyGroups.map(g => {
      const p = S.profileCache.get(g.userId) || {};
      const unread = g.stories.some(s => !S.me?.storyViewed?.[s.id]);
      return `<div class="story-item" data-user="${esc(g.userId)}">
        <div class="story-circle ${unread ? 'unread' : 'viewed'}">
          ${p.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : '👤'}
        </div>
        <span>${esc(g.userId === uid() ? 'أنت' : '@' + (p.username || 'مستخدم'))}</span>
      </div>`;
    }).join('');
  $('story-add')?.addEventListener('click', createStory);

  qsa('#stories-bar .story-item').forEach(el =>
    el.addEventListener('click', () => openStoryGroup(el.dataset.user, 0))
  );
}

const STORY_GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  'linear-gradient(135deg, #232526 0%, #414345 100%)',
  'linear-gradient(135deg, #141e30 0%, #243b55 100%)',
  'linear-gradient(135deg, #f12711 0%, #f5af19 100%)',
  'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
  'linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)',
  'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
  'linear-gradient(135deg, #ee0979 0%, #ff6a00 100%)',
  'linear-gradient(135deg, #1d976c 0%, #93f9b9 100%)',
  'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)'
];
const STORY_TEXT_SIZES = { small: '18px', medium: '24px', large: '32px', xlarge: '42px' };

function createStory() {
  if (!S.me || S.me.status !== 'active') return toast('الحساب غير نشط.', 'error');
  S.storyDraft = {
    text: '',
    bgGradient: STORY_GRADIENTS[0],
    imageDataUrl: null,
    textColor: '#ffffff',
    fontSize: 'medium'
  };
  renderStoryComposer();
  openView('story-composer-view');
  setTimeout(() => {
    const ta = $('story-text-input');
    if (ta) { ta.value = ''; ta.focus(); }
  }, 100);
}

function renderStoryComposer() {
  const d = S.storyDraft;
  if (!d) return;

  const preview = $('story-preview');
  if (preview) {
    if (d.imageDataUrl) {
      preview.style.background = `url(${d.imageDataUrl}) center/cover no-repeat`;
      preview.style.backgroundColor = '#000';
    } else {
      preview.style.background = d.bgGradient;
    }
  }

  const textEl = $('story-preview-text');
  if (textEl) {
    textEl.textContent = d.text || 'اكتب قصتك هنا...';
    textEl.style.color = d.textColor;
    textEl.style.fontSize = STORY_TEXT_SIZES[d.fontSize] || '24px';
    textEl.style.opacity = d.text ? '1' : '.45';
  }

  const gList = $('story-gradients');
  if (gList && !gList.dataset.built) {
    gList.innerHTML = STORY_GRADIENTS.map((g, i) =>
      `<button class="story-gradient" data-index="${i}" style="background:${g}"></button>`
    ).join('');
    gList.dataset.built = '1';
    qsa('.story-gradient').forEach(b => b.onclick = () => {
      S.storyDraft.bgGradient = STORY_GRADIENTS[Number(b.dataset.index)];
      S.storyDraft.imageDataUrl = null;
      renderStoryComposer();
    });
  }

  qsa('.story-gradient').forEach((b, i) =>
    b.classList.toggle('active', !d.imageDataUrl && STORY_GRADIENTS[i] === d.bgGradient)
  );
  qsa('.story-color').forEach(b => b.classList.toggle('active', b.dataset.color === d.textColor));
  qsa('.story-size').forEach(b => b.classList.toggle('active', b.dataset.size === d.fontSize));

  $('story-gradients-row')?.classList.toggle('hidden', !!d.imageDataUrl);
  $('story-clear-image')?.classList.toggle('hidden', !d.imageDataUrl);
  $('story-pick-image')?.classList.toggle('hidden', !!d.imageDataUrl);
}

async function publishStory() {
  const d = S.storyDraft;
  if (!d) return;
  const text = (d.text || '').trim();
  if (!text && !d.imageDataUrl) return toast('اكتب نصاً أو اختر صورة.', 'error');
  if (text.length > 200) return toast('النص طويل جداً.', 'error');

  const ref = db.ref('stories').push();
  const ts = now();
  const meta = {
    userId: uid(),
    type: d.imageDataUrl ? 'image' : 'text',
    createdAt: ts,
    expiresAt: ts + STORY_DURATION,
    active: false
  };
  if (d.imageDataUrl) {
    meta.preview = text ? text.slice(0, 600) : '';
  } else {
    meta.preview = text.slice(0, 600);
    meta.bgGradient = d.bgGradient;
    meta.textColor = d.textColor;
    meta.fontSize = d.fontSize;
  }

  const btn = $('story-publish');
  if (btn) btn.disabled = true;

  try {
    await ref.set(meta);
    const content = d.imageDataUrl
      ? { dataUrl: d.imageDataUrl, name: 'story.jpg', caption: text, textColor: d.textColor, fontSize: d.fontSize }
      : { text, bgGradient: d.bgGradient, textColor: d.textColor, fontSize: d.fontSize };
    await db.ref(`storyContents/${ref.key}`).set(content);
    await ref.update({ active: true });
    toast('تم نشر القصة ✨', 'success');
    closeModals();
    S.storyDraft = null;
  } catch (e) {
    await ref.update({ active: false, failedAt: SERVER }).catch(() => {});
    toast(firebaseErrorMessage(e), 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openStoryGroup(userId, index = 0) {
  const g = S.storyGroups.find(x => x.userId === userId);
  if (!g || !g.stories.length) return;
  S.storyGroup = g;
  S.storyIndex = S.storyGroups.findIndex(x => x.userId === userId);
  S.storyItemIndex = Math.min(index, g.stories.length - 1);
  S.storyUserList = S.storyGroups.map(x => x.userId);
  showStoryCurrent();
}

async function showStoryCurrent() {
  const g = S.storyGroups[S.storyIndex];
  if (!g) return closeStory();
  const s = g.stories[S.storyItemIndex];
  if (!s) return closeStory();
  const p = S.profileCache.get(s.userId) || {};
  const viewer = $('story-viewer');
  if (!viewer) return;

  let contentSnap = null;
  let contentReadError = null;
  try { contentSnap = await db.ref(`storyContents/${s.id}`).once('value'); }
  catch (e) { contentReadError = e; }
  const data = contentSnap?.val() || s.data || (s.type === 'text' ? { text: s.preview || '' } : {});
  if (contentReadError && s.type === 'image') {
    console.warn('story content read failed', s.id, contentReadError?.code || contentReadError);
  }

  $('story-username').textContent = s.userId === uid() ? '@' + S.me.username : '@' + (p.username || 'مستخدم');
  $('story-avatar').innerHTML = p.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : '👻';

  const remaining = Math.max(0, Number(s.expiresAt) - now());
  const hrs = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  $('story-time').textContent = `${relativeTime(s.createdAt)} · تُحذف بعد ${hrs}س ${mins}د`;

  const viewsBtn = $('story-views-btn');
  if (viewsBtn) {
    const isMine = s.userId === uid();
    viewsBtn.classList.toggle('hidden', !isMine);
    if (isMine) {
      db.ref(`storyViews/${s.id}`).once('value').then(snap => {
        const n = Object.keys(snap.val() || {}).length;
        viewsBtn.innerHTML = `👁️ ${n}`;
      }).catch(() => {});
    }
  }

  const progress = $('story-progress');
  progress.innerHTML = g.stories.map((_, i) => {
    let width = '0%';
    if (i < S.storyItemIndex) width = '100%';
    else if (i === S.storyItemIndex) width = '0%';
    return `<span class="story-progress-seg"><i style="width:${width};${i === S.storyItemIndex ? `animation:storyProgressFill ${STORY_VIEW_MS}ms linear forwards` : ''}"></i></span>`;
  }).join('');

  const content = $('story-content');
  const sizeMap = { small: '20px', medium: '28px', large: '38px', xlarge: '48px' };
  const textColor = data.textColor || '#ffffff';
  const fontSize = sizeMap[data.fontSize] || '28px';

  if (s.type === 'image') {
    const src = safeImageUrl(data.dataUrl);
    const caption = String(data.caption || s.preview || '').trim();
    content.innerHTML = src
      ? `<div class="story-image-wrap">
           <img src="${esc(src)}" alt="" loading="eager">
           ${caption ? `<div class="story-image-caption" style="color:${esc(textColor)};font-size:${fontSize}">${escapeHtmlLine(caption)}</div>` : ''}
         </div>`
      : '<div class="story-content-text">تعذر تحميل صورة القصة.</div>';
  } else {
    const text = String(data.text || s.preview || '').trim();
    const bg = data.bgGradient || 'linear-gradient(135deg, #24150e 0%, #75472b 52%, #c18a56 100%)';
    content.innerHTML = text
      ? `<div class="story-content-text" style="background:${bg}">
           <span style="color:${esc(textColor)};font-size:${fontSize}">${escapeHtmlLine(text)}</span>
         </div>`
      : '<div class="story-content-text">تعذر تحميل نص القصة.</div>';
  }

  const isMine = s.userId === uid();
  const reactBar = $('story-reactions');
  if (reactBar) {
    reactBar.classList.toggle('hidden', isMine);
    if (!isMine) {
      reactBar.innerHTML = ['❤️', '😍', '😂', '😮', '🔥', '👏']
        .map(r => `<button data-story-reaction="${r}" type="button">${r}</button>`).join('');
      reactBar.querySelectorAll('[data-story-reaction]').forEach(b =>
        b.onclick = (ev) => { ev.stopPropagation(); reactToStory(b.dataset.storyReaction); }
      );
    }
  }
  $('story-reply-btn')?.classList.toggle('hidden', isMine);
  viewer.classList.remove('hidden');
  S.storyPaused = false;
  startStoryTimer();
  await markStoryViewed(s);
}

function startStoryTimer() {
  clearTimeout(S.storyTimer);
  clearInterval(S.storyProgressTimer);
  S.storyProgressStart = now();
  S.storyTimer = setTimeout(() => { if (!S.storyPaused) nextStory(); }, STORY_VIEW_MS);
}

function pauseStory() {
  if (S.storyPaused) return;
  S.storyPaused = true;
  clearTimeout(S.storyTimer);
  const elapsed = now() - S.storyProgressStart;
  const seg = $('story-progress')?.querySelectorAll('.story-progress-seg i')[S.storyItemIndex];
  if (seg) {
    const computed = getComputedStyle(seg).width;
    seg.style.animation = 'none';
    seg.style.width = computed;
  }
  S.storyRemaining = STORY_VIEW_MS - elapsed;
}

function resumeStory() {
  if (!S.storyPaused) return;
  S.storyPaused = false;
  const remaining = S.storyRemaining || STORY_VIEW_MS;
  const seg = $('story-progress')?.querySelectorAll('.story-progress-seg i')[S.storyItemIndex];
  if (seg) {
    seg.style.width = '0%';
    seg.style.animation = `storyProgressFill ${remaining}ms linear forwards`;
  }
  S.storyProgressStart = now();
  clearTimeout(S.storyTimer);
  S.storyTimer = setTimeout(() => { if (!S.storyPaused) nextStory(); }, remaining);
}

async function markStoryViewed(s) {
  if (!uid()) return;
  const updates = {};
  updates[`storyViews/${s.id}/${uid()}`] = SERVER;
  updates[`storyViewedByUser/${uid()}/${s.id}`] = SERVER;
  await db.ref().update(updates).catch(() => {});
  S.me.storyViewed = S.me.storyViewed || {};
  S.me.storyViewed[s.id] = now();
}

function nextStory() {
  clearTimeout(S.storyTimer);
  const g = S.storyGroups[S.storyIndex];
  if (!g) return closeStory();
  if (S.storyItemIndex < g.stories.length - 1) { S.storyItemIndex++; showStoryCurrent(); return; }
  if (S.storyIndex < S.storyGroups.length - 1) { S.storyIndex++; S.storyItemIndex = 0; showStoryCurrent(); return; }
  closeStory();
}

function prevStory() {
  clearTimeout(S.storyTimer);
  const g = S.storyGroups[S.storyIndex];
  if (!g) return;
  if (S.storyItemIndex > 0) { S.storyItemIndex--; showStoryCurrent(); return; }
  if (S.storyIndex > 0) {
    S.storyIndex--;
    S.storyItemIndex = S.storyGroups[S.storyIndex].stories.length - 1;
    showStoryCurrent();
    return;
  }
}

function closeStory() {
  clearTimeout(S.storyTimer);
  clearInterval(S.storyProgressTimer);
  $('story-viewer')?.classList.add('hidden');
  $('story-reply-bar')?.classList.add('hidden');
  $('story-emoji-picker')?.classList.add('hidden');
  S.pendingStoryReply = null;
  S.storyPaused = false;
}

async function storyReply() {
  const g = S.storyGroups[S.storyIndex];
  const s = g?.stories?.[S.storyItemIndex];
  if (!s || s.userId === uid()) return;
  S.pendingStoryReply = { story: s };
  const bar = $('story-reply-bar');
  if (bar) {
    bar.classList.remove('hidden');
    const input = $('story-reply-text');
    if (input) { input.value = ''; setTimeout(() => input.focus(), 100); }
  }
  // استخدم pauseStory لإيقاف الشريط البصري أيضاً
  pauseStory();
}

async function sendStoryReplyFromBar() {
  const s = S.pendingStoryReply?.story;
  const input = $('story-reply-text');
  const text = (input?.value || '').trim();
  if (!s || !text) return;

  try {
    const id = [uid(), s.userId].sort().join('_');
    const chatSnap = await db.ref(`chats/${id}`).once('value').catch(() => null);

    if (!chatSnap?.exists()) {
      await startPrivateByUid(s.userId);
      toast('أرسلنا طلب مراسلة. بعد الموافقة ستتمكن من الرد على القصص.', 'info', 5000);
      return;
    }
    const c = chatSnap.val();

    if (c.requestState === 'rejected') {
      return toast('تم رفض طلب المراسلة. لا يمكنك الرد على القصة.', 'error');
    }
    if (c.requestState === 'pending') {
      return c.createdBy === uid()
        ? toast('بانتظار موافقة الطرف الآخر.', 'info')
        : toast('لديك طلب معلق — اقبله أولاً من قائمة المحادثات.', 'info');
    }

    const mid = db.ref(`messages/${id}`).push().key;
    const preview = `↩️ قصة: ${text.slice(0, 250)}`;
    const updates = {};
    updates[`messages/${id}/${mid}`] = {
      senderId: uid(),
      timestamp: SERVER,
      status: 'sent',
      type: 'text',
      text,
      replyTo: { messageId: 'story_' + s.id, senderId: s.userId, text: '↩️ قصة' }
    };
    updates[`chats/${id}/lastMessage`] = { senderId: uid(), text: preview.slice(0, 500), type: 'text' };
    updates[`chats/${id}/updatedAt`] = SERVER;

    if (c.participants?.[s.userId]) {
      updates[`chats/${id}/unreadCount/${s.userId}`] = firebase.database.ServerValue.increment(1);
      const nid = db.ref(`notifications/${s.userId}`).push().key;
      updates[`notifications/${s.userId}/${nid}`] = {
        type: 'story_reply',
        from: uid(),
        title: 'رد على قصتك',
        body: text.slice(0, 100),
        createdAt: SERVER,
        read: false
      };
    }

    await db.ref().update(updates);
    input.value = '';
    $('story-reply-bar')?.classList.add('hidden');
    $('story-emoji-picker')?.classList.add('hidden');
    S.pendingStoryReply = null;
    resumeStory();
    toast('تم إرسال الرد.', 'success');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function reactToStory(reaction) {
  const g = S.storyGroups[S.storyIndex];
  const s = g?.stories?.[S.storyItemIndex];
  if (!s || s.userId === uid()) return;
  try {
    const path = `storyReactions/${s.id}/${uid()}`;
    const cur = (await db.ref(path).once('value')).val();
    const updates = {};
    updates[path] = cur === reaction ? null : reaction;
    if (cur !== reaction) {
      makeNotification(s.userId, 'story_reaction', 'تفاعل مع قصتك', `@${S.me.username} تفاعل ${reaction} مع قصتك`, updates);
    }
    await db.ref().update(updates);
    notifyTone('other');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function showStoryViewers() {
  const g = S.storyGroups[S.storyIndex];
  const s = g?.stories?.[S.storyItemIndex];
  if (!s) return;
  if (s.userId !== uid() && !isStaff()) return toast('المشاهدات تظهر فقط لصاحب القصة.', 'info');
  const snap = await db.ref(`storyViews/${s.id}`).once('value');
  const views = snap.val() || {};
  const ids = Object.keys(views);
  await warmProfiles(ids);
  const body = ids.length
    ? ids.map(id => {
      const u = S.profileCache.get(id) || {};
      return `<div class="contact-item">
        <div class="contact-avatar">${u.avatar ? `<img src="${esc(safeImageUrl(u.avatar))}" alt="">` : '👤'}</div>
        <div class="contact-info">
          <div class="contact-name">@${esc(u.username || id.slice(0, 8))}</div>
          <div class="contact-status">${esc(dayTime(views[id]))}</div>
        </div>
      </div>`;
    }).join('')
    : '<p style="text-align:center;color:var(--text-secondary)">لا مشاهدات بعد.</p>';
  openView('contacts-view');
  $('contacts-body').innerHTML = `<h3 style="margin-bottom:12px">👁️ المشاهدات (${ids.length})</h3>${body}`;
}

/* ==================== Private chat / groups ==================== */
async function startNewPrivateChat() {
  const name = await promptAsync('اسم المستخدم (@username):', '', 'محادثة جديدة');
  if (name === null) return;
  const username = normalizeUsername(name);
  if (username === S.me.username) return toast('لا يمكنك بدء محادثة مع نفسك.', 'error');
  try {
    const idx = await db.ref(`usernames/${username}`).once('value');
    if (!idx.exists()) return toast('المستخدم غير موجود.', 'error');
    await startPrivateByUid(idx.val());
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function startPrivateByUid(target) {
  if (!uid() || !S.me) return toast('انتظر اكتمال تحميل حسابك ثم أعد المحاولة.', 'info');
  if (!target || target === uid()) return;
  if (S.blocked.has(target)) return toast('أنت حاظر هذا المستخدم. ألغِ الحظر أولاً.', 'error');

  const pairId = [uid(), target].sort().join('_');
  const deletedForMe = [...S.hiddenChats].some(hiddenId => hiddenId === pairId || hiddenId.startsWith(`${pairId}_r_`));
  if (S.offlineMode || S.dbConnected === false) {
    const cachedId = !deletedForMe && S.chatIndex?.[pairId] && !S.hiddenChats.has(pairId)
      ? pairId
      : [...Object.keys(S.chatIndex || {})].find(id => {
          const c = S.chatCache.get(id);
          return !S.hiddenChats.has(id) && c?.type === 'private' && c.participants?.[uid()] && c.participants?.[target];
        });
    if (cachedId && S.chatCache.get(cachedId)?.participants?.[uid()]) return openChat(cachedId);
    return toast('لا توجد محادثة محفوظة متاحة مع هذا المستخدم. اتصل بالإنترنت لبدء محادثة جديدة.', 'info');
  }

  try {
    let id = deletedForMe ? `${pairId}_r_${db.ref('chats').push().key}` : pairId;
    let snap = null;
    try { snap = await withDeadline(db.ref(`chats/${pairId}`).once('value'), 3000, 'private chat lookup'); } catch {}
    let baseChat = snap?.exists() ? { ...snap.val(), id: pairId } : null;
    // Read both directions: the recipient sees chatRequests/me/target; the sender sees
    // chatRequests/target/me. A rejected request record must not be mistaken for pending.
    const [incomingSnap, outgoingSnap] = await Promise.all([
      withDeadline(db.ref(`chatRequests/${uid()}/${target}`).once('value'), 2400, 'incoming request lookup').catch(() => null),
      withDeadline(db.ref(`chatRequests/${target}/${uid()}`).once('value'), 2400, 'outgoing request lookup').catch(() => null)
    ]);
    const incomingReq = incomingSnap?.val();
    const outgoingReq = outgoingSnap?.val();

    // Reuse an already-approved regenerated thread after an earlier request was rejected
    // or the legacy pair thread was deleted-for-me. Without this lookup, every visit to
    // a profile could create yet another `${pairId}_r_*` conversation.
    if (!S.offlineMode && S.dbConnected !== false) {
      const listedSnap = await withDeadline(db.ref(`userChats/${uid()}`).once('value'), 2600, 'private thread list').catch(() => null);
      const candidateIds = new Set([
        ...Object.keys(listedSnap?.val() || {}),
        ...Object.keys(S.chatIndex || {}),
        ...[...S.chatCache.keys()]
      ]);
      const relatedIds = [...candidateIds]
        .filter(cid => (cid === pairId || cid.startsWith(`${pairId}_r_`)) && !S.hiddenChats.has(cid))
        .sort((a, b) => Number(S.chatCache.get(b)?.updatedAt || 0) - Number(S.chatCache.get(a)?.updatedAt || 0));
      for (const cid of relatedIds) {
        let candidate = S.chatCache.get(cid) || null;
        const liveSnap = await withDeadline(db.ref(`chats/${cid}`).once('value'), 2200, 'private thread validation').catch(() => null);
        if (liveSnap?.exists()) candidate = { ...liveSnap.val(), id: cid };
        if (!candidate || candidate.type !== 'private' || !candidate.participants?.[uid()] || !candidate.participants?.[target]) continue;
        if (candidate.requestState === 'rejected') continue;
        if (candidate.requestState === 'pending') {
          S.chatCache.set(cid, candidate);
          if (candidate.createdBy === uid()) return toast('تم إرسال طلب المراسلة، بانتظار الموافقة.', 'info');
          return toast('لديك طلب مراسلة معلق من هذا المستخدم. اقبله من قائمة المحادثات.', 'info');
        }
        S.chatCache.set(cid, candidate);
        S.chatIndex = { ...(S.chatIndex || {}), [cid]: true };
        await db.ref(`userChats/${uid()}/${cid}`).set(true).catch(() => {});
        await db.ref(`userChats/${target}/${cid}`).set(true).catch(() => {});
        saveChatCache();
        scheduleChatListRender();
        return openChat(cid);
      }
    }

    const isRejected = baseChat?.requestState === 'rejected'
      || incomingReq?.status === 'rejected'
      || outgoingReq?.status === 'rejected';

    // A completed chat takes precedence over stale historical request rows.
    if (!deletedForMe && baseChat && !['pending', 'rejected'].includes(baseChat.requestState)) {
      await db.ref(`userChats/${uid()}/${pairId}`).set(true);
      await db.ref(`userChats/${target}/${pairId}`).set(true);
      return openChat(pairId);
    }
    if (!deletedForMe && baseChat && !isRejected) {
      if (baseChat.requestState === 'pending') {
        if (baseChat.createdBy === uid() && outgoingReq?.status === 'pending')
          return toast('تم إرسال طلب المراسلة، بانتظار الموافقة.', 'info');
        if (baseChat.createdBy !== uid() && incomingReq?.status === 'pending')
          return toast('لديك طلب معلق من هذا المستخدم. اقبله من قائمة المحادثات.', 'info');
        // A stale pending chat without a matching pending request is not reusable.
        id = `${pairId}_r_${db.ref('chats').push().key}`;
      }
    }
    if (!deletedForMe && (isRejected || baseChat?.requestState === 'rejected')) {
      // Existing rules do not permit resetting requestState from rejected to pending.
      // Use a fresh chat key for the new request instead of trying a forbidden overwrite.
      id = `${pairId}_r_${db.ref('chats').push().key}`;
    }

    await warmProfiles([target]);
    const targetProfile = S.profileCache.get(target);
    if (targetProfile?.active === false) return toast('هذا الحساب غير نشط ولا يمكن بدء مراسلة جديدة معه.', 'error');
    const state = isAdmin() ? 'approved' : 'pending';
    await db.ref(`chats/${id}`).set({
      type: 'private', createdBy: uid(), createdAt: SERVER, updatedAt: SERVER,
      requestState: state,
      participants: { [uid()]: { role: 'member' }, [target]: { role: 'member' } }
    });
    await db.ref(`userChats/${uid()}/${id}`).set(true);
    if (state === 'approved') await db.ref(`userChats/${target}/${id}`).set(true);
    await db.ref(`chatRequests/${target}/${uid()}`).set({
      fromUid: uid(), toUid: target, status: state, createdAt: Date.now(), chatId: id
    });
    if (state === 'pending') {
      const up = {};
      makeNotification(target, 'message_request', 'طلب مراسلة جديد', `@${S.me.username} يريد مراسلتك`, up);
      if (Object.keys(up).length) await db.ref().update(up);
      return toast('تم إرسال طلب المراسلة. سيظهر للطرف الآخر.', 'success');
    }
    await openChat(id);
  } catch (e) {
    console.error('startPrivateByUid failed:', e);
    toast(e?.code === 'PERMISSION_DENIED'
      ? 'تعذر بدء المحادثة بسبب صلاحيات Realtime Database الحالية.'
      : firebaseErrorMessage(e), 'error', 5000);
  }
}


async function handleChatRequest(chatId, fromUid, action) {
  const req = S.chatRequests?.[fromUid];
  if (!req || req.chatId !== chatId || req.status !== 'pending') return;
  if (S.offlineMode || S.dbConnected === false) return toast('تعامل مع طلبات المراسلة عند عودة الاتصال.', 'info');
  if (S.blocked.has(fromUid)) return toast('هذا المستخدم محظور لديك؛ لا يمكن قبول طلبه.', 'error');
  if (!['approve', 'reject'].includes(action)) return toast('إجراء الطلب غير صالح.', 'error');
  try {
    const state = action === 'approve' ? 'approved' : 'rejected';
    const updates = {};
    updates[`chatRequests/${uid()}/${fromUid}/status`] = state;
    if (state === 'approved') {
      updates[`chats/${chatId}/requestState`] = 'approved';
      updates[`chats/${chatId}/updatedAt`] = SERVER;
      updates[`userChats/${uid()}/${chatId}`] = true;
      updates[`userChats/${fromUid}/${chatId}`] = true;
      makeNotification(fromUid, 'message_request', 'تم قبول طلب المراسلة', `@${S.me.username} قبل طلبك`, updates);
    } else {
      // RTDB rules only allow the chat creator to change requestState to rejected.
      // The recipient may reject the request record and detach both user's indexes.
      updates[`userChats/${uid()}/${chatId}`] = null;
      updates[`userChats/${fromUid}/${chatId}`] = null;
      makeNotification(fromUid, 'message_request', 'تم رفض طلب المراسلة', `@${S.me.username} رفض طلبك`, updates);
    }
    await db.ref().update(updates);
    if (S.chatRequests[fromUid]) S.chatRequests[fromUid].status = state;
    const cachedChat = S.chatCache.get(chatId);
    if (cachedChat) {
      cachedChat.requestState = state;
      cachedChat.updatedAt = Date.now();
      if (state === 'approved') S.chatCache.set(chatId, cachedChat);
    }
    if (state === 'rejected') {
      const next = { ...(S.chatIndex || {}) };
      delete next[chatId];
      S.chatIndex = next;
      S.chatCache.delete(chatId);
      await writeCachedState('chatIndex', next, uid()).catch(() => {});
      saveChatCache();
    }
    notifyTone('other');
    scheduleChatListRender();
    toast(state === 'approved' ? 'تم قبول الطلب.' : 'تم رفض الطلب.', state === 'approved' ? 'success' : 'info');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}


async function cancelChatRequest(chatId, targetUid) {
  if (!uid() || !chatId || !targetUid || targetUid === uid()) return toast('طلب المراسلة غير صالح.', 'error');
  if (S.offlineMode || S.dbConnected === false) return toast('إلغاء طلب المراسلة يحتاج إلى اتصال.', 'info');
  const cached = S.chatCache.get(chatId);
  if (cached && (cached.createdBy !== uid() || cached.requestState !== 'pending'))
    return toast('هذا الطلب لم يعد بانتظار الإرسال أو لا تملك صلاحية إلغائه.', 'info');
  try {
    const path = `chatRequests/${targetUid}/${uid()}`;
    const reqSnap = await withDeadline(db.ref(path).once('value'), 3000, 'outgoing request validation').catch(() => null);
    const request = reqSnap?.val();
    if (request && request.chatId !== chatId)
      return toast('يوجد طلب أحدث لهذا المستخدم؛ لم يتم تغيير الطلب الآخر.', 'info');
    const chatSnap = await withDeadline(db.ref(`chats/${chatId}`).once('value'), 3000, 'outgoing chat validation').catch(() => null);
    const live = chatSnap?.exists() ? chatSnap.val() : cached;
    if (!live || live.type !== 'private' || live.createdBy !== uid() || live.requestState !== 'pending')
      return toast('لم يعد هذا الطلب قابلاً للإلغاء.', 'info');
    const updates = {
      [`chats/${chatId}/requestState`]: 'rejected',
      [`chats/${chatId}/updatedAt`]: SERVER,
      [`userChats/${uid()}/${chatId}`]: null,
      [`userChats/${targetUid}/${chatId}`]: null
    };
    if (request?.chatId === chatId && request.status === 'pending') updates[`${path}/status`] = 'rejected';
    await db.ref().update(updates);
    const local = S.chatCache.get(chatId);
    if (local) S.chatCache.set(chatId, { ...local, requestState: 'rejected', updatedAt: Date.now() });
    const next = { ...(S.chatIndex || {}) };
    delete next[chatId];
    S.chatIndex = next;
    try { localStorage.setItem(`ghostcaffee_chat_index_${uid()}`, JSON.stringify(next)); } catch {}
    await writeCachedState('chatIndex', next, uid()).catch(() => {});
    saveChatCache();
    scheduleChatListRender();
    toast('تم إلغاء طلب المراسلة.', 'success');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

function openGroupModal() {
  S.selectedGroupUsers.clear();
  $('group-name').value = '';
  $('group-search').value = '';
  $('group-selected').innerHTML = '';
  loadGroupUsers();
  openView('group-view');
}

async function loadGroupUsers(filter = '') {
  const host = $('group-users');
  if (!host) return;
  let ids;
  if (isStaff()) {
    const idxSnap = await db.ref('usernames').once('value').catch(() => null);
    const list = idxSnap?.val() || {};
    ids = Object.values(list).filter(x => x !== uid());
  } else {
    ids = [...S.contacts].filter(x => x !== uid());
    if (!ids.length) {
      host.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:20px">لا توجد جهات اتصال بعد. أضف أصدقاءك أولاً من قسم جهات الاتصال.</p>';
      $('group-selected').innerHTML = '';
      return;
    }
  }
  await warmProfiles(ids);
  const items = ids.map(id => S.profileCache.get(id))
    .filter(Boolean)
    .filter(p => p.id !== uid() && !S.blocked.has(p.id) && p.active !== false)
    .filter(p => !filter || String(p.username || '').includes(normalizeUsername(filter)))
    .slice(0, 100);
  host.innerHTML = items.map(p => `
    <div class="group-user-item ${S.selectedGroupUsers.has(p.id) ? 'selected' : ''}" data-id="${esc(p.id)}">
      <span class="group-user-avatar">${p.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : '👤'}</span>
      <b>@${esc(p.username)}</b>${p.verified ? ' ✅' : ''}
    </div>`).join('');
  qsa('.group-user-item').forEach(el => el.addEventListener('click', () => {
    const id = el.dataset.id;
    if (S.selectedGroupUsers.has(id)) S.selectedGroupUsers.delete(id);
    else S.selectedGroupUsers.add(id);
    loadGroupUsers($('group-search').value);
  }));
  $('group-selected').innerHTML = [...S.selectedGroupUsers].map(id =>
    `<span class="group-chip">@${esc(S.profileCache.get(id)?.username || id.slice(0, 6))} <button data-id="${esc(id)}">×</button></span>`
  ).join('');
  qsa('#group-selected button').forEach(b => b.onclick = () => {
    S.selectedGroupUsers.delete(b.dataset.id);
    loadGroupUsers($('group-search').value);
  });
}

async function createGroup() {
  if (S.offlineMode || S.dbConnected === false) return toast('إنشاء المجموعات يحتاج إلى اتصال.', 'info');
  const name = ($('group-name').value || '').trim();
  const users = [...new Set(S.selectedGroupUsers)]
    .filter(x => x && x !== uid() && !S.blocked.has(x) && S.profileCache.get(x)?.active !== false);
  if (name.length < 2) return toast('اكتب اسم المجموعة.', 'error');
  if (!users.length) return toast('أضف عضواً واحداً على الأقل من الحسابات النشطة وغير المحظورة.', 'error');
  if (S.selectedGroupUsers.size !== users.length) {
    S.selectedGroupUsers = new Set(users);
    toast('أزيلت الحسابات المحظورة أو غير النشطة من اختيار المجموعة.', 'info');
  }
  const id = db.ref('chats').push().key;
  const participants = { [uid()]: { role: 'admin' } };
  users.forEach(x => participants[x] = { role: 'member' });
  const c = {
    type: 'group',
    name: name.slice(0, 30),
    createdBy: uid(),
    createdAt: SERVER,
    updatedAt: SERVER,
    participants,
    groupAdmins: { [uid()]: true }
  };
  try {
    await db.ref(`chats/${id}`).set(c);
    const idx = {};
    Object.keys(participants).forEach(x => { idx[`userChats/${x}/${id}`] = true; });
    await db.ref().update(idx);
    closeModals();
    toast('تم إنشاء المجموعة.', 'success');
    openChat(id);
  } catch (e) {
    console.error('createGroup failed:', e);
    toast(firebaseErrorMessage(e), 'error');
  }
}

/* ==================== Context menu ==================== */
function openContextMenu(x, y, id) {
  S.contextMessageId = id;
  const m = S.messageCache.get(S.activeChatId)?.find(x => x.id === id);
  if (!m) return;
  const cm = $('context-menu');
  if (!cm) return;
  const mine = m.senderId === uid();
  qsa('#context-menu [data-action="delete"]').forEach(el => el.classList.toggle('hidden', !mine));
  qsa('#context-menu [data-action="edit"]').forEach(el => el.classList.toggle('hidden', !mine || m.type !== 'text'));
  qsa('#context-menu [data-action="copy"]').forEach(el => el.classList.toggle('hidden', m.type !== 'text'));
  qsa('#context-menu [data-action="report"]').forEach(el => el.classList.toggle('hidden', mine));
  qsa('#context-menu [data-action="star"]').forEach(el => el.textContent = m.starred?.[uid()] ? '⭐ إزالة النجمة' : '⭐ نجمة');
  cm.classList.remove('hidden');
  const w = 200, h = 320;
  cm.style.left = `${Math.min(x, window.innerWidth - w - 8)}px`;
  cm.style.top = `${Math.min(y, window.innerHeight - h - 8)}px`;
  $('reaction-picker')?.classList.add('hidden');
}

async function contextAction(action) {
  const id = S.contextMessageId;
  const m = S.messageCache.get(S.activeChatId)?.find(x => x.id === id);
  if (!m) return closeContext();
  if (['star', 'delete', 'forward'].includes(action) && (S.offlineMode || S.dbConnected === false)) {
    closeContext();
    return toast('هذا الإجراء يحتاج إلى اتصال؛ لم تُرسل أي تغييرات.', 'info');
  }
  try {
    if (action === 'reply') {
      S.currentReply = m;
      S.currentEdit = null;
      updateReplyEditUI();
      $('message-input')?.focus();
    } else if (action === 'copy') {
      try { await navigator.clipboard.writeText(m.text || ''); toast('تم النسخ.', 'success'); }
      catch { toast('تعذر النسخ تلقائياً في هذا المتصفح.', 'error'); }
    } else if (action === 'star') {
      const path = `messages/${S.activeChatId}/${id}/starred/${uid()}`;
      const cur = (await db.ref(path).once('value')).val();
      await db.ref(path).set(cur ? null : true);
    } else if (action === 'edit' && m.senderId === uid() && m.type === 'text') {
      S.currentEdit = id;
      S.currentReply = null;
      $('message-input').value = m.text || '';
      updateReplyEditUI();
      updateSendButtons();
      $('message-input').focus();
    } else if (action === 'delete' && m.senderId === uid()) {
      if (await confirmAsync('حذف الرسالة للجميع؟', 'تأكيد الحذف', 'حذف', true))
        await db.ref(`messages/${S.activeChatId}/${id}/deletedForAll`).set(true);
    } else if (action === 'info') {
      showMessageInfo(m);
    } else if (action === 'report' && m.senderId !== uid()) {
      await reportMessage(m);
    } else if (action === 'forward') {
      await forwardMessage(m);
    }
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
  closeContext();
}

function closeContext() {
  $('context-menu')?.classList.add('hidden');
  $('reaction-picker')?.classList.add('hidden');
}

function updateReplyEditUI() {
  const rep = $('reply-preview'), edit = $('edit-preview');
  if (S.currentReply) {
    $('reply-sender').textContent = S.currentReply.senderId === uid()
      ? 'رد على نفسك'
      : 'رد على @' + (S.profileCache.get(S.currentReply.senderId)?.username || '');
    $('reply-text').textContent = (S.currentReply.text || (S.currentReply.fileData?.name ? attachmentIcon(S.currentReply.type) + ' ' + S.currentReply.fileData.name : '')).slice(0, 100);
    rep?.classList.remove('hidden');
  } else {
    rep?.classList.add('hidden');
  }
  if (S.currentEdit) {
    $('edit-text').textContent = 'تعديل الرسالة';
    edit?.classList.remove('hidden');
  } else {
    edit?.classList.add('hidden');
  }
}

function cancelEdit() {
  if (S.currentEdit) { const i = $('message-input'); if (i) i.value = ''; }
  S.currentEdit = null;
  updateReplyEditUI();
  updateSendButtons();
}

function showMessageInfo(m) {
  openView('msg-info');
  $('msg-info-body').innerHTML = `
    <div class="about-info">
      <div class="about-row"><span>المرسل</span><b>@${esc(S.profileCache.get(m.senderId)?.username || m.senderId.slice(0, 10))}</b></div>
      <div class="about-row"><span>الوقت</span><b>${esc(dayTime(m.timestamp))}</b></div>
      <div class="about-row"><span>النوع</span><b>${esc(m.type)}</b></div>
      <div class="about-row"><span>تم التسليم</span><b>${Object.keys(m.deliveredTo || {}).length}</b></div>
      <div class="about-row"><span>تمت القراءة</span><b>${Object.keys(m.readBy || {}).length}</b></div>
      <div class="about-row"><span>التفاعلات</span><b>${Object.keys(m.reactions || {}).length}</b></div>
    </div>`;
}

async function forwardMessage(m) {
  const target = await promptAsync('اسم مستخدم الهدف:', '', 'إعادة توجيه');
  if (target === null) return;
  const un = normalizeUsername(target);
  const snap = await db.ref(`usernames/${un}`).once('value').catch(() => null);
  if (!snap?.exists()) return toast('المستخدم غير موجود.', 'error');
  const targetUid = snap.val();
  if (targetUid === uid()) return;
  await startPrivateByUid(targetUid);
  const input = $('message-input');
  if (m.type === 'text') {
    input.value = m.text || '';
    await sendMessage();
  } else if (m.fileData) {
    S.pendingAttachment = { type: m.type, data: m.fileData };
    input.value = '';
    await sendMessage();
  }
}

function openImage(src) {
  if (!src) return;
  $('image-viewer-img').src = src;
  openView('image-viewer');
}
window.openImage = openImage;

/* ===================================================================
 * ==================== ADMIN PANEL ==================================
 * =================================================================== */

function openAdminPanel() {
  if (!isStaff()) return toast('ليس لديك صلاحية لوحة الإدارة.', 'error');
  $('admin-panel')?.classList.remove('hidden');
  renderAdminTab('dashboard');
}

function closeAdminPanel() {
  $('admin-panel')?.classList.add('hidden');
  if (S.adminUsersUnsub) {
    try { S.adminUsersUnsub(); } catch {}
    S.adminUsersUnsub = null;
  }
}

function ensureAdminTabs() {
  const host = qs('.admin-tabs');
  if (!host) return;
  const wanted = [
    ['dashboard', '📊 الرئيسية'],
    ['users', '👥 المستخدمون'],
    ['reports', '🚩 البلاغات'],
    ['stories', '⭕ القصص'],
    ['devices', '📱 الأجهزة'],
    ['chats', '💬 المحادثات'],
    ['messages', '📨 الرسائل'],
    ['logs', '📋 السجلات'],
    ['settings', '⚙️ الإعدادات']
  ];
  const visible = wanted.filter(([id]) => id !== 'settings' || isAdmin());
  host.innerHTML = visible.map(([id, t]) =>
    `<button class="admin-tab ${S.adminTab === id ? 'active' : ''}" data-atab="${id}">${t}</button>`
  ).join('');
  qsa('.admin-tab').forEach(b => b.onclick = () => {
    S.adminTab = b.dataset.atab;
    ensureAdminTabs();
    renderAdminTab(S.adminTab);
  });
}

async function renderAdminTab(tab) {
  if (!isStaff()) return closeAdminPanel();
  S.adminTab = tab;
  ensureAdminTabs();
  const sub = $('admin-subtitle');
  if (sub) sub.textContent = `${S.me.role} · @${S.me.username}`;
  const host = $('admin-content');
  if (!host) return;
  host.innerHTML = '<div class="admin-toolbar"><b>⏳ جارٍ التحميل…</b></div>';
  try {
    if (tab === 'dashboard') await adminDashboard(host);
    else if (tab === 'users') await adminUsers(host);
    else if (tab === 'reports') await adminReports(host);
    else if (tab === 'stories') await adminStories(host);
    else if (tab === 'devices') await adminDevices(host);
    else if (tab === 'chats') await adminChats(host);
    else if (tab === 'messages') await adminMessages(host);
    else if (tab === 'logs') await adminLogs(host);
    else if (tab === 'settings') await adminSettings(host);
  } catch (e) {
    host.innerHTML = `<div class="admin-card"><b>تعذر تحميل القسم</b><p>${esc(firebaseErrorMessage(e))}</p></div>`;
  }
}

function statCard(title, value, icon, color = 'blue') {
  return `<div class="admin-stat"><span class="stat-icon ${color}">${icon}</span><div><b>${esc(value)}</b><small>${esc(title)}</small></div></div>`;
}

async function adminDashboard(host) {
  const [u, c, s, r, l, w] = await Promise.all([
    db.ref('users').once('value'),
    db.ref('chats').once('value'),
    db.ref('stories').once('value'),
    db.ref('reports').orderByChild('status').equalTo('open').once('value'),
    db.ref('admin/auditLog').limitToLast(10).once('value'),
    db.ref('walletTransactions').once('value').catch(() => null)
  ]);
  const users = u.val() || {};
  const chats = c.val() || {};
  const stories = s.val() || {};
  const reports = r.val() || {};
  const logs = l.val() || {};
  const activeUsers = Object.values(users).filter(x => x.status === 'active').length;
  const bannedUsers = Object.values(users).filter(x => x.status === 'banned').length;
  const deletedUsers = Object.values(users).filter(x => x.status === 'deleted').length;
  const activeStories = Object.values(stories).filter(x => x && x.active !== false && Number(x.expiresAt) > now()).length;
  const totalCoins = Object.values(users).reduce((s, x) => s + Number(x.coins || 0), 0);

  const total = Object.keys(users).length || 1;
  const chart = `
    <div class="admin-chart">
      <div class="admin-chart-row"><span>نشط</span><div class="admin-chart-bar"><i style="width:${(activeUsers / total * 100).toFixed(1)}%;background:var(--accent)"></i></div><b>${activeUsers}</b></div>
      <div class="admin-chart-row"><span>محظور</span><div class="admin-chart-bar"><i style="width:${(bannedUsers / total * 100).toFixed(1)}%;background:var(--danger)"></i></div><b>${bannedUsers}</b></div>
      <div class="admin-chart-row"><span>محذوف</span><div class="admin-chart-bar"><i style="width:${(deletedUsers / total * 100).toFixed(1)}%;background:var(--text-secondary)"></i></div><b>${deletedUsers}</b></div>
    </div>`;

  host.innerHTML = `
    <div class="admin-dash-grid">
      ${statCard('إجمالي المستخدمين', Object.keys(users).length, '👥', 'blue')}
      ${statCard('المحادثات', Object.keys(chats).length, '💬', 'green')}
      ${statCard('قصص فعالة', activeStories, '⭕', 'orange')}
      ${statCard('بلاغات مفتوحة', Object.keys(reports).length, '🚩', 'red')}
      ${statCard('إجمالي العملات', totalCoins.toLocaleString(), '💰', 'purple')}
      ${statCard('الأجهزة', new Set(Object.values(users).map(x => x.deviceId).filter(Boolean)).size, '📱', 'cyan')}
    </div>
    <div class="admin-card">
      <h3>📈 توزيع حالات المستخدمين</h3>
      ${chart}
    </div>
    <div class="admin-card">
      <h3>⚡ إجراءات سريعة</h3>
      <div class="admin-toolbar">
        <button class="admin-btn" data-fast="users">👥 المستخدمون</button>
        <button class="admin-btn warning" data-fast="reports">🚩 البلاغات</button>
        <button class="admin-btn" data-fast="stories">⭕ القصص</button>
        ${isAdmin() ? '<button class="admin-btn" data-fast="settings">⚙️ الإعدادات</button>' : ''}
      </div>
    </div>
    <div class="admin-card">
      <h3>📋 آخر السجلات</h3>
      ${Object.entries(logs).reverse().map(([id, x]) => `
        <div class="admin-log-row">
          <b>${esc(x.action || 'event')}</b>
          <span>@${esc(x.actorUsername || x.actorId?.slice(0, 8) || '')}</span>
          <span>${esc(x.targetId?.slice(0, 12) || '')}</span>
          <small>${esc(dayTime(x.timestamp))}</small>
          <span>${esc(JSON.stringify(x.meta || {}).slice(0, 60))}</span>
        </div>`).join('') || '<p>لا توجد سجلات.</p>'}
    </div>`;
  qsa('[data-fast]').forEach(b => b.onclick = () => renderAdminTab(b.dataset.fast));
}

async function getAllUsers() {
  const snap = await db.ref('users').once('value');
  const obj = snap.val() || {};
  return Object.entries(obj)
    .map(([id, u]) => ({ ...u, id }))
    .sort((a, b) => String(a.username).localeCompare(String(b.username)));
}

async function adminUsers(host) {
  const users = await getAllUsers();
  S.adminUsers = users;
  await warmProfiles(users.map(u => u.id));

  host.innerHTML = `
    <div class="admin-toolbar">
      <input id="admin-users-search" placeholder="🔍 بحث باليوزر أو UID…" value="${esc(S.adminSearch)}">
      <select id="admin-users-filter" class="admin-select">
        <option value="all" ${S.adminUserFilter === 'all' ? 'selected' : ''}>الكل (${users.length})</option>
        <option value="active" ${S.adminUserFilter === 'active' ? 'selected' : ''}>نشط (${users.filter(u => u.status === 'active').length})</option>
        <option value="banned" ${S.adminUserFilter === 'banned' ? 'selected' : ''}>محظور (${users.filter(u => u.status === 'banned').length})</option>
        <option value="deleted" ${S.adminUserFilter === 'deleted' ? 'selected' : ''}>محذوف (${users.filter(u => u.status === 'deleted').length})</option>
        <option value="admins" ${S.adminUserFilter === 'admins' ? 'selected' : ''}>إداريون</option>
      </select>
      <button class="admin-btn" id="admin-users-refresh">🔄 تحديث</button>
      <button class="admin-btn ghost" id="admin-users-export">📤 CSV</button>
      ${isOwner() ? '<button class="admin-btn ghost" id="admin-seed-config">⚙️ تهيئة</button>' : ''}
    </div>
    <div id="admin-users-table"></div>`;

  const draw = () => {
    const q = normalizeUsername($('admin-users-search')?.value || '');
    const filter = $('admin-users-filter')?.value || 'all';
    S.adminSearch = q;
    S.adminUserFilter = filter;
    let filtered = users.filter(u => {
      if (q && ![u.username, u.id, u.role, u.status].some(v => String(v || '').toLowerCase().includes(q))) return false;
      if (filter === 'active' && u.status !== 'active') return false;
      if (filter === 'banned' && u.status !== 'banned') return false;
      if (filter === 'deleted' && u.status !== 'deleted') return false;
      if (filter === 'admins' && !['admin', 'owner', 'moderator'].includes(u.role)) return false;
      return true;
    });
    $('admin-users-table').innerHTML = adminUserTable(filtered);
    qsa('[data-admin-user]').forEach(b => b.onclick = () => adminUserModal(b.dataset.adminUser));
  };
  $('admin-users-search').oninput = draw;
  $('admin-users-filter').onchange = draw;
  $('admin-users-refresh').onclick = () => renderAdminTab('users');
  $('admin-users-export').onclick = exportUsersCSV;
  $('admin-seed-config')?.addEventListener('click', seedDefaultConfig);
  draw();
}

function roleSelectHtml(u) {
  const options = ROLES.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('');
  const locked = (u.id === S.ownerUid) || !canManageUser(u);
  return `<select class="admin-select sm" data-role-user="${esc(u.id)}" ${locked ? 'disabled' : ''}>${options}</select>`;
}

function adminUserTable(users) {
  if (!users.length) return '<div class="admin-empty"><div class="ico">👥</div><p>لا توجد نتائج مطابقة.</p></div>';
  return `<div class="admin-table-wrap"><table class="admin-table">
    <thead><tr>
      <th>المستخدم</th><th>الدور</th><th>الحالة</th><th>موثق</th><th>العملات</th><th>آخر ظهور</th><th>إجراءات</th>
    </tr></thead>
    <tbody>${users.map(u => {
      const p = S.profileCache.get(u.id) || {};
      return `<tr class="${u.status === 'banned' ? 'blocked-row' : ''}">
        <td>
          <div class="admin-user-cell">
            <div class="admin-avatar">${p.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : esc((u.username || '?')[0].toUpperCase())}</div>
            <div class="admin-user-info"><b>@${esc(u.username)}</b><span>${esc(u.id.slice(0, 12))}…</span></div>
          </div>
        </td>
        <td>${roleSelectHtml(u)}</td>
        <td><span class="status ${esc(u.status)}">${esc(u.status)}</span></td>
        <td><input type="checkbox" data-verify-user="${esc(u.id)}" ${p.verified ? 'checked' : ''} ${(!isAdmin() || u.role === 'owner') ? 'disabled' : ''}></td>
        <td><b>${Number(u.coins || 0).toLocaleString()}</b></td>
        <td><small>${esc(dayTime(u.lastSeen))}</small></td>
        <td>
          <div class="action-btns">
            <button class="icon-action" data-admin-user="${esc(u.id)}" title="فتح">✏️</button>
            ${u.status === 'active' && canManageUser(u) ? `<button class="icon-action danger" data-quick-ban="${esc(u.id)}" title="حظر">🚫</button>` : ''}
            ${u.status === 'banned' ? `<button class="icon-action success" data-quick-unban="${esc(u.id)}" title="فك الحظر">✅</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

async function adminUserModal(id) {
  const u = (S.adminUsers || []).find(x => x.id === id) || S.userCache.get(id);
  if (!u) return;
  const p = (await db.ref(`profiles/${id}`).once('value')).val() || {};
  S.profileCache.set(id, { ...p, id });
  const h = `
    <div class="modal-content" style="max-width:720px">
      <div class="modal-header"><h3>إدارة @${esc(u.username)}</h3><button class="icon-btn" id="admin-user-close">✕</button></div>
      <div class="modal-body">
        <div class="admin-user-cell" style="margin-bottom:16px">
          <div class="profile-avatar-big" style="width:80px;height:80px;margin:0">${p.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : '👤'}</div>
          <div style="flex:1">
            <h3 style="margin:0">@${esc(u.username)} ${p.verified ? '✅' : ''}</h3>
            <p style="color:var(--text-secondary);font-size:13px">${esc(p.bio || 'لا توجد نبذة')}</p>
          </div>
        </div>
        <div class="about-info">
          <div class="about-row"><span>UID</span><b style="font-size:11px">${esc(id)}</b></div>
          <div class="about-row"><span>الحالة</span><b>${esc(u.status)}</b></div>
          <div class="about-row"><span>الدور</span><b>${esc(u.role)}</b></div>
          <div class="about-row"><span>العملات</span><b>${Number(u.coins || 0)}</b></div>
          <div class="about-row"><span>الجهاز</span><b style="font-size:11px">${esc(u.deviceId || '-')}</b></div>
          <div class="about-row"><span>أنشئ</span><b>${esc(dayTime(u.createdAt))}</b></div>
          ${u.banReason ? `<div class="about-row"><span>سبب الحظر</span><b>${esc(u.banReason)}</b></div>` : ''}
        </div>
        <div class="admin-toolbar" style="margin-top:16px">
          <button class="admin-btn" id="grant-role">🎭 تعديل الدور</button>
          <button class="admin-btn" id="toggle-verify">${p.verified ? '❌ إلغاء التوثيق' : '✅ توثيق'}</button>
          <button class="admin-btn warning" id="adjust-coins">💰 تعديل العملات</button>
          ${u.status === 'banned'
            ? '<button class="admin-btn success" id="unban-user">✅ فك الحظر</button>'
            : `<button class="admin-btn danger" id="ban-user" ${!canManageUser(u) ? 'disabled' : ''}>🚫 حظر</button>`}
          ${u.status === 'deleted'
            ? '<button class="admin-btn success" id="restore-user">♻️ استعادة</button>'
            : `<button class="admin-btn danger" id="delete-user" ${(!isAdmin() || u.role === 'owner') ? 'disabled' : ''}>🗑️ حذف قابل للاستعادة</button>`}
        </div>
      </div>
    </div>`;
  const m = document.createElement('div');
  m.className = 'modal admin-dynamic-modal';
  m.id = 'admin-dynamic-modal';
  m.innerHTML = h;
  document.body.appendChild(m);
  m.querySelector('#admin-user-close').onclick = () => m.remove();
  m.querySelector('#grant-role').onclick = () => adminChangeRole(u);
  m.querySelector('#toggle-verify').onclick = () => adminToggleVerify(u, p);
  m.querySelector('#adjust-coins').onclick = () => adminAdjustCoins(u);
  m.querySelector('#ban-user')?.addEventListener('click', () => adminBanUser(u));
  m.querySelector('#unban-user')?.addEventListener('click', () => adminUnbanUser(u));
  m.querySelector('#delete-user')?.addEventListener('click', () => adminSetDeleted(u, true));
  m.querySelector('#restore-user')?.addEventListener('click', () => adminSetDeleted(u, false));
}

async function adminSetRole(u, value) {
  if (!u || !ROLES.includes(value)) return false;
  if (u.id === S.ownerUid && value !== 'owner') { toast('انقل الملكية أولاً.', 'error'); return false; }
  if (!canManageUser(u) && u.id !== S.ownerUid) { toast('هذا الحساب خارج نطاق صلاحيتك.', 'error'); return false; }

  if (value === 'owner') {
    if (!isOwner()) { toast('المالك الحالي فقط يستطيع نقل الملكية.', 'error'); return false; }
    if (u.status !== 'active') { toast('لا يمكن نقل الملكية إلى حساب غير نشط.', 'error'); return false; }
    if (!await confirmAsync(`نقل ملكية النظام إلى @${u.username}؟ سيصبح حسابك admin.`, 'نقل الملكية', 'نقل', true)) return false;
    try {
      const currentOwner = S.ownerUid || uid();
      const up = {};
      up['config/ownerUid'] = u.id;
      up[`users/${u.id}/role`] = 'owner';
      up[`users/${currentOwner}/role`] = 'admin';
      await db.ref().update(up);
      await writeAudit('ownership_transferred', u.id, { from: currentOwner, to: u.id });
      await loadConfig();
      await loadCurrentAccount();
      renderOwnIdentity();
      toast('تم نقل ملكية النظام.', 'success');
      renderAdminTab('users');
      return true;
    } catch (e) {
      toast(firebaseErrorMessage(e), 'error');
      return false;
    }
  }
  if (u.id === S.ownerUid) { toast('لا يمكن تغيير دور المالك قبل نقل الملكية.', 'error'); return false; }
  if (value === 'admin' && !isOwner()) { toast('المالك الحالي فقط يستطيع منح admin.', 'error'); return false; }
  try {
    await db.ref().update({ [`users/${u.id}/role`]: value, [`profiles/${u.id}/role`]: value });
    await writeAudit('role_changed', u.id, { from: u.role, to: value });
    toast('تم تعديل الدور.', 'success');
    renderAdminTab('users');
    return true;
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
    return false;
  }
}

async function adminChangeRole(u) {
  if (!u) return;
  const value = await promptAsync(`الدور الجديد لـ @${u.username}\n(user / moderator / admin / owner)`, u.role, 'تعديل الدور');
  if (value === null) return;
  await adminSetRole(u, value);
}

async function adminToggleVerify(u, p) {
  if (!isAdmin() || u.role === 'owner') return toast('لا تملك صلاحية.', 'error');
  try {
    await db.ref(`profiles/${u.id}/verified`).set(!p.verified);
    await writeAudit('verify_changed', u.id, { verified: !p.verified });
    toast('تم تحديث التوثيق.', 'success');
    document.getElementById('admin-dynamic-modal')?.remove();
    renderAdminTab('users');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function adminAdjustCoins(u) {
  if (!isAdmin() || u.role === 'owner') return toast('صلاحية العملات للمالك/admin فقط.', 'error');
  const raw = await promptAsync('أدخل مقدار التعديل (مثال 50 أو -20):', '0', 'تعديل العملات');
  if (raw === null) return;
  const delta = Number(raw);
  if (!Number.isFinite(delta) || delta === 0 || !Number.isInteger(delta)) return toast('قيمة غير صالحة.', 'error');
  const snap = await db.ref(`users/${u.id}/coins`).once('value');
  const current = Number(snap.val() || 0);
  const next = current + delta;
  if (next < 0) return toast('لا يمكن أن يصبح الرصيد سالباً.', 'error');
  const txId = db.ref().push().key;
  const updates = {};
  updates[`users/${u.id}/coins`] = next;
  updates[`walletTransactions/${u.id}/${txId}`] = { delta, before: current, after: next, reason: 'admin_adjustment', actorId: uid(), timestamp: SERVER };
  try {
    await db.ref().update(updates);
    await writeAudit('coins_adjusted', u.id, { delta, before: current, after: next });
    toast(`تم تعديل الرصيد: ${delta > 0 ? '+' : ''}${delta}.`, 'success');
    document.getElementById('admin-dynamic-modal')?.remove();
    renderAdminTab('users');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function adminBanUser(u) {
  if (!canManageUser(u)) return toast('لا يمكنك حظر هذا الحساب.', 'error');
  const reason = await promptAsync('سبب الحظر:', 'مخالفة القواعد', 'حظر المستخدم');
  if (reason === null) return;
  try {
    await db.ref(`users/${u.id}`).update({ status: 'banned', banReason: reason.slice(0, 300), bannedAt: SERVER, bannedBy: uid() });
    await db.ref(`profiles/${u.id}/active`).set(false);
    await writeAudit('user_banned', u.id, { reason });
    toast('تم الحظر.', 'success');
    document.getElementById('admin-dynamic-modal')?.remove();
    renderAdminTab('users');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function adminUnbanUser(u) {
  if (!canManageUser(u)) return;
  try {
    await db.ref(`users/${u.id}`).update({ status: 'active', banReason: null, bannedAt: null, bannedBy: null });
    await db.ref(`profiles/${u.id}/active`).set(true);
    await writeAudit('user_unbanned', u.id);
    toast('تم فك الحظر.', 'success');
    document.getElementById('admin-dynamic-modal')?.remove();
    renderAdminTab('users');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function adminSetDeleted(u, deleted) {
  if (!isAdmin() || u.role === 'owner') return toast('الحسابات المحمية لا يمكن حذفها.', 'error');
  const ok = await confirmAsync(
    deleted ? `حذف @${u.username}؟ يمكن استعادته لاحقاً.` : `استعادة @${u.username}؟`,
    deleted ? 'حذف قابل للاستعادة' : 'استعادة',
    deleted ? 'حذف' : 'استعادة',
    deleted
  );
  if (!ok) return;
  try {
    await db.ref(`users/${u.id}`).update({
      status: deleted ? 'deleted' : 'active',
      deletedAt: deleted ? SERVER : null,
      deletedBy: deleted ? uid() : null
    });
    await db.ref(`profiles/${u.id}/active`).set(!deleted);
    await writeAudit(deleted ? 'user_soft_deleted' : 'user_restored', u.id);
    toast(deleted ? 'تم الحذف القابل للاستعادة.' : 'تمت الاستعادة.', 'success');
    document.getElementById('admin-dynamic-modal')?.remove();
    renderAdminTab('users');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}



function exportUsersCSV() {
  const rows = [['username', 'uid', 'role', 'status', 'coins', 'deviceId', 'createdAt', 'lastSeen']];
  (S.adminUsers || []).forEach(u => rows.push([
    u.username, u.id, u.role, u.status, u.coins || 0, u.deviceId || '', u.createdAt || '', u.lastSeen || ''
  ]));
  const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  void saveBlobAsDownload(blob, `users-${new Date().toISOString().slice(0, 10)}.csv`);
}

async function adminReports(host) {
  if (!isStaff()) return toast('قسم البلاغات مخصص لفريق الإشراف.', 'error');
  const snap = await db.ref('reports').orderByChild('status').equalTo('open').once('value');
  const reports = snap.val() || {};
  const targetIds = Object.values(reports).map(r => r?.targetUid).filter(Boolean);
  await warmProfiles(targetIds);
  const typeNames = { user: 'مستخدم', message: 'رسالة', story: 'قصة' };
  host.innerHTML = `
    <div class="admin-toolbar">
      <button class="admin-btn" id="reports-refresh">🔄 تحديث</button>
      <span class="admin-toolbar-info">${Object.keys(reports).length} بلاغ مفتوح</span>
    </div>
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>النوع</th><th>الهدف</th><th>المبلّغ</th><th>السبب</th><th>الوقت</th><th>إجراء</th></tr></thead>
      <tbody>${Object.entries(reports).map(([id, r]) => {
        const targetProfile = S.profileCache.get(r.targetUid) || {};
        const targetLabel = targetProfile.username ? `@${targetProfile.username}` : (r.targetUid ? r.targetUid.slice(0, 12) : (r.storyId || `${r.chatId || ''}/${r.messageId || ''}`).slice(0, 16));
        const refLabel = r.targetType === 'message' ? ` · ${String(r.chatId || '').slice(0, 8)}/${String(r.messageId || '').slice(0, 8)}` : '';
        return `<tr>
          <td>${esc(typeNames[r.targetType] || r.targetType || 'غير معروف')}</td>
          <td><code style="font-size:11px">${esc(targetLabel + refLabel)}</code></td>
          <td>@${esc(r.reporterUsername || r.reporterId?.slice(0, 8) || '')}</td>
          <td>${esc((r.reason || '—').slice(0, 120))}</td>
          <td><small>${esc(dayTime(r.createdAt))}</small></td>
          <td><button class="admin-btn sm" data-report="${esc(id)}">🔍 مراجعة</button></td>
        </tr>`;
      }).join('') || '<tr><td colspan="6" style="text-align:center">لا بلاغات مفتوحة.</td></tr>'}
      </tbody></table></div>`;
  $('reports-refresh').onclick = () => renderAdminTab('reports');
  qsa('[data-report]').forEach(b => b.onclick = () => reviewReport(b.dataset.report, reports[b.dataset.report]));
}

async function reviewReport(id, r) {
  if (!isStaff()) return toast('لا تملك صلاحية مراجعة البلاغات.', 'error');
  if (S.offlineMode || S.dbConnected === false) return toast('مراجعة البلاغات تحتاج إلى اتصال. لم يُغيّر البلاغ.', 'info');
  if (!id || !r || r.status !== 'open') return toast('هذا البلاغ لم يعد مفتوحاً.', 'info');
  const action = await promptAsync(
    'اختر الإجراء بدقة: resolve (إغلاق) / dismiss (رفض البلاغ) / ban (حظر حساب) / delete (إزالة المحتوى)',
    'resolve', 'مراجعة البلاغ'
  );
  if (action === null) return;
  if (!['resolve', 'dismiss', 'ban', 'delete'].includes(action)) return toast('الإجراء غير صالح؛ استخدم resolve أو dismiss أو ban أو delete.', 'error');
  const type = r.targetType;
  try {
    if (action === 'ban') {
      if (!['user', 'message', 'story'].includes(type) || !r.targetUid) return toast('لا يحتوي البلاغ على حساب مستهدف صالح للحظر.', 'error');
      // Existing RTDB rules allow account-status changes to owner/admin, not moderators.
      if (!isAdmin()) return toast('قواعد قاعدة البيانات الحالية تسمح بحظر الحسابات للمالك/admin فقط. لم يُغلق البلاغ.', 'error');
      const u = (await db.ref(`users/${r.targetUid}`).once('value')).val() || {};
      if (!canManageUser({ ...u, id: r.targetUid })) return toast('لا يمكنك حظر هذا الحساب (قد يكون حساباً محمياً). لم يُغلق البلاغ.', 'error');
      await db.ref(`users/${r.targetUid}`).update({ status: 'banned', banReason: `بلاغ ${id}: ${String(r.reason || 'مخالفة قواعد').slice(0, 220)}`, bannedBy: uid(), bannedAt: SERVER });
      await db.ref(`profiles/${r.targetUid}/active`).set(false);
    } else if (action === 'delete') {
      if (type === 'user') {
        if (!isAdmin()) return toast('حذف الحساب يحتاج إلى صلاحية admin/المالك. لم يُغلق البلاغ.', 'error');
        if (!r.targetUid) return toast('الحساب المستهدف غير محدد.', 'error');
        const u = (await db.ref(`users/${r.targetUid}`).once('value')).val() || {};
        if (u.role === 'owner' || r.targetUid === uid()) return toast('لا يمكن حذف حساب المالك أو حسابك.', 'error');
        if (!canManageUser({ ...u, id: r.targetUid })) return toast('لا يمكنك حذف هذا الحساب.', 'error');
        await db.ref(`users/${r.targetUid}`).update({ status: 'deleted', deletedBy: uid(), deletedAt: SERVER });
        await db.ref(`profiles/${r.targetUid}/active`).set(false);
      } else if (type === 'message') {
        if (!r.chatId || !r.messageId) return toast('معرف المحادثة أو الرسالة مفقود.', 'error');
        await db.ref(`messages/${r.chatId}/${r.messageId}/deletedForAll`).set(true);
      } else if (type === 'story') {
        if (!r.storyId) return toast('معرف القصة مفقود.', 'error');
        await db.ref(`stories/${r.storyId}`).update({ active: false, deletedAt: SERVER, deletedBy: uid() });
      } else return toast('نوع المحتوى غير معروف؛ لم يُغلق البلاغ.', 'error');
    }
    // Resolve/dismiss only after a selected moderation action succeeds.
    await db.ref(`reports/${id}`).update({
      status: action === 'dismiss' ? 'dismissed' : 'resolved',
      reviewedBy: uid(), reviewedAt: SERVER, action
    });
    await writeAudit('report_reviewed', id, { action, targetType: type, targetUid: r.targetUid || null });
    toast(action === 'dismiss' ? 'تم رفض البلاغ وإغلاقه.' : 'تمت معالجة البلاغ وإغلاقه.', 'success');
    renderAdminTab('reports');
  } catch (e) { toast(firebaseErrorMessage(e), 'error'); }
}

async function adminStories(host) {
  const snap = await db.ref('stories').once('value');
  const stories = snap.val() || {};
  const rows = Object.entries(stories)
    .map(([id, s]) => ({ ...s, id }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  await warmProfiles(rows.map(s => s.userId));
  const active = rows.filter(s => s.active !== false && Number(s.expiresAt) > now()).length;
  host.innerHTML = `
    <div class="admin-toolbar">
      <button class="admin-btn" id="stories-refresh">🔄 تحديث</button>
      <button class="admin-btn warning" id="purge-expired">🧹 تنظيف المنتهية</button>
      <span class="admin-toolbar-info">${active} نشطة · ${rows.length} إجمالي</span>
    </div>
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>المالك</th><th>النوع</th><th>النشر</th><th>الانتهاء</th><th>المشاهدات</th><th>الحالة</th><th>إجراء</th></tr></thead>
      <tbody>${rows.map(s => {
        const expired = Number(s.expiresAt) <= now();
        const activeRow = s.active !== false && !expired;
        return `<tr>
          <td>@${esc(S.profileCache.get(s.userId)?.username || s.userId.slice(0, 8))}</td>
          <td>${s.type === 'image' ? '🖼️' : '📝'}</td>
          <td><small>${esc(dayTime(s.createdAt))}</small></td>
          <td><small>${esc(dayTime(s.expiresAt))}</small></td>
          <td><button class="admin-btn sm" data-story-views="${esc(s.id)}">👁️ عرض</button></td>
          <td><span class="status ${activeRow ? 'active' : 'deleted'}">${activeRow ? 'نشطة' : 'منتهية'}</span></td>
          <td>
            ${activeRow
              ? `<button class="admin-btn danger sm" data-story-delete="${esc(s.id)}">🗑️</button>`
              : (s.active === false && !expired ? `<button class="admin-btn sm" data-story-restore="${esc(s.id)}">♻️</button>` : '—')}
          </td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  $('stories-refresh').onclick = () => renderAdminTab('stories');
  $('purge-expired').onclick = purgeExpiredStories;
  qsa('[data-story-delete]').forEach(b => b.onclick = () => adminSetStoryDeleted(b.dataset.storyDelete, true));
  qsa('[data-story-restore]').forEach(b => b.onclick = () => adminSetStoryDeleted(b.dataset.storyRestore, false));
  qsa('[data-story-views]').forEach(b => b.onclick = () => showStoryViews(b.dataset.storyViews));
}

async function adminSetStoryDeleted(id, deleted) {
  try {
    const snap = await db.ref(`stories/${id}`).once('value');
    const s = snap.val() || {};
    if (deleted) {
      await db.ref(`stories/${id}`).update({ active: false, deletedAt: SERVER, deletedBy: uid() });
    } else {
      if (Number(s.expiresAt || 0) <= now()) return toast('انتهت المدة ولا يمكن استعادتها.', 'error');
      await db.ref(`stories/${id}`).update({ active: true, deletedAt: null, deletedBy: null });
    }
    await writeAudit(deleted ? 'story_deleted' : 'story_restored', id);
    toast(deleted ? 'تم الحذف.' : 'تمت الاستعادة.', 'success');
    renderAdminTab('stories');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function purgeExpiredStories() {
  const snap = await db.ref('stories').once('value');
  const obj = snap.val() || {};
  const updates = {};
  Object.entries(obj).forEach(([id, s]) => {
    if (Number(s.expiresAt || 0) < now() - 7 * 864e5 && s.active !== false) updates[`stories/${id}/active`] = false;
  });
  if (Object.keys(updates).length) await db.ref().update(updates);
  toast('تم التنظيف.', 'success');
  renderAdminTab('stories');
}

async function showStoryViews(id) {
  const snap = await db.ref(`storyViews/${id}`).once('value');
  const views = snap.val() || {};
  const ids = Object.keys(views);
  await warmProfiles(ids);
  const body = ids.length
    ? ids.map(uid2 => {
      const u = S.profileCache.get(uid2) || {};
      return `<div class="contact-item">
        <div class="contact-avatar">${u.avatar ? `<img src="${esc(safeImageUrl(u.avatar))}" alt="">` : '👤'}</div>
        <div class="contact-info">
          <div class="contact-name">@${esc(u.username || uid2.slice(0, 8))}</div>
          <div class="contact-status">${esc(dayTime(views[uid2]))}</div>
        </div>
      </div>`;
    }).join('')
    : '<p style="text-align:center;color:var(--text-secondary)">لا مشاهدات.</p>';
  openView('contacts-view');
  $('contacts-body').innerHTML = `<h3 style="margin-bottom:12px">👁️ المشاهدات (${ids.length})</h3>${body}`;
}

async function adminDevices(host) {
  const users = await getAllUsers();
  const byDevice = new Map();
  users.forEach(u => {
    if (!u.deviceId) return;
    if (!byDevice.has(u.deviceId)) byDevice.set(u.deviceId, []);
    byDevice.get(u.deviceId).push(u);
  });
  host.innerHTML = `
    <div class="admin-toolbar">
      <button class="admin-btn" id="devices-refresh">🔄 تحديث</button>
      <span class="admin-toolbar-info">${byDevice.size} جهاز</span>
    </div>
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>معرف الجهاز</th><th>الحسابات</th><th>الحالات</th><th>إجراء</th></tr></thead>
      <tbody>${[...byDevice.entries()].sort((a, b) => b[1].length - a[1].length).map(([d, list]) => `
        <tr>
          <td><code style="font-size:11px">${esc(d.slice(0, 20))}…</code></td>
          <td><b>${list.length}</b><br><small>${list.map(u => '@' + u.username).join(', ')}</small></td>
          <td>${[...new Set(list.map(u => u.status))].map(s => `<span class="status ${esc(s)}">${esc(s)}</span>`).join(' ')}</td>
          <td><button class="admin-btn sm" data-device="${esc(d)}">🔍 تفاصيل</button></td>
        </tr>`).join('')}</tbody></table></div>`;
  $('devices-refresh').onclick = () => renderAdminTab('devices');
  qsa('[data-device]').forEach(b => b.onclick = () => {
    const list = byDevice.get(b.dataset.device) || [];
    openView('contacts-view');
    $('contacts-body').innerHTML = `<h3 style="margin-bottom:12px">📱 حسابات الجهاز</h3>` +
      (list.map(u => `<div class="contact-item"><div class="contact-info"><div class="contact-name">@${esc(u.username)}</div><div class="contact-status">${esc(u.status)} · ${esc(u.id)}</div></div></div>`).join('')
      || '<p>لا حسابات.</p>');
  });
}

async function adminChats(host) {
  const snap = await db.ref('chats').once('value');
  const chats = snap.val() || {};
  host.innerHTML = `
    <div class="admin-toolbar">
      <input id="admin-chat-search" placeholder="🔍 بحث بالاسم أو ID">
      <button class="admin-btn" id="admin-chat-refresh">🔄 تحديث</button>
      <span class="admin-toolbar-info">${Object.keys(chats).length} محادثة</span>
    </div>
    <div id="admin-chat-table"></div>`;
  const draw = () => {
    const q = ($('admin-chat-search').value || '').toLowerCase();
    const rows = Object.entries(chats).filter(([id, c]) => !q || id.toLowerCase().includes(q) || String(c.name || '').toLowerCase().includes(q));
    $('admin-chat-table').innerHTML = `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>ID</th><th>النوع</th><th>الاسم</th><th>الأعضاء</th><th>آخر تحديث</th><th>إجراء</th></tr></thead>
      <tbody>${rows.map(([id, c]) => `
        <tr>
          <td><code title="${esc(id)}">${esc(id.slice(0, 14))}…</code></td>
          <td>${c.type === 'group' ? '👥' : '💬'}</td>
          <td>${esc(c.name || '—')}</td>
          <td>${Object.keys(c.participants || {}).length}</td>
          <td><small>${esc(dayTime(c.updatedAt))}</small></td>
          <td>
            <button class="admin-btn sm" data-open-admin-chat="${esc(id)}">📖</button>
            ${c.deletedAt
              ? `<button class="admin-btn sm" data-restore-admin-chat="${esc(id)}">♻️</button>`
              : `<button class="admin-btn danger sm" data-delete-admin-chat="${esc(id)}">🗑️</button>`}
          </td>
        </tr>`).join('')}</tbody></table></div>`;
  };
  draw();
  $('admin-chat-search').oninput = draw;
  $('admin-chat-refresh').onclick = () => renderAdminTab('chats');
  qsa('[data-open-admin-chat]').forEach(b => b.onclick = () => openChatAsAdmin(b.dataset.openAdminChat));
  qsa('[data-delete-admin-chat]').forEach(b => b.onclick = () => adminSetChatDeleted(b.dataset.deleteAdminChat, true));
  qsa('[data-restore-admin-chat]').forEach(b => b.onclick = () => adminSetChatDeleted(b.dataset.restoreAdminChat, false));
}

async function openChatAsAdmin(id) {
  try {
    const s = await db.ref(`messages/${id}`).orderByChild('timestamp').limitToLast(30).once('value');
    const arr = [];
    s.forEach(x => { arr.push({ ...x.val(), id: x.key }); });
    await warmProfiles(arr.map(m => m.senderId));
    const body = arr.map(m => `
      <div class="admin-log-row">
        <b>@${esc(S.profileCache.get(m.senderId)?.username || m.senderId.slice(0, 8))}</b>
        <span>${esc(m.type || 'text')}</span>
        <small>${esc(dayTime(m.timestamp))}</small>
        <span>${esc((m.text || m.fileData?.name || '').slice(0, 80))}</span>
        <span>${m.deletedForAll ? '<i style="color:var(--danger)">محذوفة</i>' : ''}</span>
      </div>`).join('') || '<p>لا رسائل.</p>';
    openView('contacts-view');
    $('contacts-body').innerHTML = `<h3>💬 آخر 30 رسالة — ${esc(id.slice(0, 20))}</h3>${body}`;
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function adminSetChatDeleted(id, deleted) {
  if (!isAdmin()) return;
  const ok = await confirmAsync(
    deleted ? 'حذف المحادثة مع إبقاء نسخة قابلة للاستعادة؟' : 'استعادة المحادثة؟',
    deleted ? 'حذف' : 'استعادة',
    deleted ? 'حذف' : 'استعادة',
    deleted
  );
  if (!ok) return;
  try {
    await db.ref(`chats/${id}`).update({ deletedAt: deleted ? SERVER : null, deletedBy: deleted ? uid() : null });
    await writeAudit(deleted ? 'chat_soft_deleted' : 'chat_restored', id);
    toast(deleted ? 'تم الحذف.' : 'تمت الاستعادة.', 'success');
    renderAdminTab('chats');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function adminMessages(host) {
  host.innerHTML = `
    <div class="admin-card">
      <h3>🔎 بحث الرسائل</h3>
      <p style="color:var(--text-secondary);font-size:13px">RTDB ليس محرك بحث نصي — أدخل معرف المحادثة لعرض آخر 200 رسالة.</p>
      <div class="admin-toolbar">
        <input id="admin-message-chat" placeholder="Chat ID">
        <button class="admin-btn" id="admin-message-load">📥 تحميل</button>
      </div>
      <div id="admin-message-results"></div>
    </div>`;
  $('admin-message-load').onclick = async () => {
    const id = $('admin-message-chat').value.trim();
    if (!id) return;
    try {
      const s = await db.ref(`messages/${id}`).orderByChild('timestamp').limitToLast(200).once('value');
      const arr = [];
      s.forEach(x => { arr.push({ ...x.val(), id: x.key }); });
      await warmProfiles(arr.map(m => m.senderId));
      $('admin-message-results').innerHTML = arr.reverse().map(m => `
        <div class="admin-log-row">
          <b>@${esc(S.profileCache.get(m.senderId)?.username || m.senderId.slice(0, 8))}</b>
          <span>${esc(m.type || 'text')}</span>
          <small>${esc(dayTime(m.timestamp))}</small>
          <span>${esc((m.text || m.fileData?.name || '').slice(0, 100))}</span>
          <span>${m.deletedForAll
            ? `<button class="admin-btn sm" data-restore-message="${esc(id + '/' + m.id)}">♻️</button>`
            : `<button class="admin-btn danger sm" data-delete-message="${esc(id + '/' + m.id)}">🗑️</button>`}</span>
        </div>`).join('') || '<p>لا نتائج.</p>';
      qsa('[data-restore-message]').forEach(b => b.onclick = () => adminSetMessageDeleted(b.dataset.restoreMessage, false));
      qsa('[data-delete-message]').forEach(b => b.onclick = () => adminSetMessageDeleted(b.dataset.deleteMessage, true));
    } catch (e) {
      $('admin-message-results').innerHTML = `<p>${esc(firebaseErrorMessage(e))}</p>`;
    }
  };
}

async function adminSetMessageDeleted(path, deleted) {
  if (!isAdmin()) return;
  const [chatId, messageId] = String(path).split('/');
  if (!chatId || !messageId) return;
  try {
    await db.ref(`messages/${chatId}/${messageId}/deletedForAll`).set(!!deleted);
    await writeAudit(deleted ? 'message_deleted' : 'message_restored', path);
    toast(deleted ? 'تم الحذف.' : 'تمت الاستعادة.', 'success');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function adminLogs(host) {
  const snap = await db.ref('admin/auditLog').limitToLast(300).once('value');
  const logs = Object.values(snap.val() || {}).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  const actions = [...new Set(logs.map(l => l.action))].sort();
  const filtered = S.adminLogFilter === 'all' ? logs : logs.filter(l => l.action === S.adminLogFilter);
  host.innerHTML = `
    <div class="admin-toolbar">
      <button class="admin-btn" id="admin-logs-refresh">🔄 تحديث</button>
      <select id="admin-logs-filter" class="admin-select">
        <option value="all" ${S.adminLogFilter === 'all' ? 'selected' : ''}>كل الأحداث (${logs.length})</option>
        ${actions.map(a => `<option value="${esc(a)}" ${S.adminLogFilter === a ? 'selected' : ''}>${esc(a)} (${logs.filter(l => l.action === a).length})</option>`).join('')}
      </select>
    </div>
    <div class="admin-card">${filtered.map(x => `
      <div class="admin-log-row">
        <b>${esc(x.action)}</b>
        <span>@${esc(x.actorUsername || x.actorId?.slice(0, 8) || '')}</span>
        <span>${esc(x.targetId?.slice(0, 16) || '')}</span>
        <small>${esc(dayTime(x.timestamp))}</small>
        <span>${esc(JSON.stringify(x.meta || {}))}</span>
      </div>`).join('') || '<p>لا سجلات.</p>'}</div>`;
  $('admin-logs-refresh').onclick = () => renderAdminTab('logs');
  $('admin-logs-filter').onchange = e => { S.adminLogFilter = e.target.value; renderAdminTab('logs'); };
}

async function adminSettings(host) {
  if (!isAdmin()) { host.innerHTML = '<div class="admin-card"><p>قراءة الإعدادات تتطلب صلاحية admin.</p></div>'; return; }
  const s = (await db.ref('config/app').once('value')).val() || {};
  s.appName = 'Ghost Caffee';
  host.innerHTML = `
    <div class="admin-card">
      <h3>⚙️ الإعدادات العامة</h3>
      <div class="admin-form">
        <label>اسم التطبيق<input id="set-app-name" value="Ghost Caffee" readonly></label>
        <label>أقصى حسابات للجهاز<input id="set-device-limit" type="number" min="1" max="20" value="${Number(s.maxAccountsPerDevice || 3)}"></label>
        <label class="switch-row"><span>السماح بالتسجيلات الجديدة</span><input id="set-reg" type="checkbox" ${s.allowRegistration !== false ? 'checked' : ''}></label>
        <button class="admin-btn" id="set-save">💾 حفظ</button>
      </div>
      <hr>
      <p style="font-size:13px;color:var(--text-secondary)">مالك النظام: <code>${esc(S.ownerUid || 'غير مُعيّن')}</code></p>
      <p style="font-size:13px;color:var(--text-secondary)">الإصدار: ${APP_VERSION} · مخطط: ${STORE_VERSION}</p>
    </div>`;
  $('set-save').onclick = async () => {
    const next = {
      ...s,
      appName: 'Ghost Caffee',
      maxAccountsPerDevice: Math.max(1, Math.min(20, Number($('set-device-limit').value) || 3)),
      allowRegistration: $('set-reg').checked,
      schemaVersion: STORE_VERSION,
      updatedAt: SERVER,
      updatedBy: uid()
    };
    try {
      await db.ref('config/app').set(next);
      await writeAudit('app_settings_changed', 'config/app');
      toast('تم الحفظ.', 'success');
      await loadConfig();
    } catch (e) {
      toast(firebaseErrorMessage(e), 'error');
    }
  };
}

async function seedDefaultConfig() {
  if (!isOwner()) return;
  try {
    await db.ref('config/app').update({ appName: 'Ghost Caffee', maxAccountsPerDevice: 3, allowRegistration: true, schemaVersion: STORE_VERSION });
    await writeAudit('config_seeded', 'config/app');
    toast('تمت التهيئة.', 'success');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function writeAudit(action, targetId = '', meta = {}) {
  if (!uid()) return;
  const ref = db.ref('admin/auditLog').push();
  return ref.set({ actorId: uid(), actorUsername: S.me?.username || '', action, targetId, meta, timestamp: SERVER });
}

/* ===================================================================
 * ==================== PROFILES / CONTACTS ==========================
 * =================================================================== */

async function openUserProfile(targetId) {
  if (!targetId) return;
  const isMe = targetId === uid();
  // A previously opened public profile is immediately usable offline; network refresh is bounded.
  let p = isMe ? { ...(S.me || {}) } : (S.profileCache.get(targetId) || null);
  let pSnap = null;
  if (!S.offlineMode && S.dbConnected !== false) {
    pSnap = await withDeadline(db.ref(`profiles/${targetId}`).once('value'), 2400, 'profile read').catch(() => null);
    if (pSnap?.exists()) p = pSnap.val() || p;
  }
  if (!p && !isMe) return toast('لا توجد نسخة محلية لهذا الملف الشخصي. اتصل بالإنترنت لفتحه أول مرة.', 'info');
  p = p || {};
  p.id = targetId;
  S.profileCache.set(targetId, p);

  const isTargetOwner = targetId === S.ownerUid;
  const cachedRelations = S.profileRelations.get(targetId) || { followers: [], following: [] };
  let follows = S.storyAudience.following.has(targetId);
  let followerIds = cachedRelations.followers || [];
  let followingIds = cachedRelations.following || [];
  let uNode = isMe ? (S.me || {}) : (S.userCache.get(targetId) || {});
  if (!S.offlineMode && S.dbConnected !== false) {
    const [fSnap, followersSnap, followingSnap, uSnap] = await Promise.all([
      withDeadline(db.ref(`following/${uid()}/${targetId}`).once('value'), 2400, 'follow state').catch(() => null),
      withDeadline(db.ref(`followers/${targetId}`).once('value'), 2400, 'followers list').catch(() => null),
      withDeadline(db.ref(`following/${targetId}`).once('value'), 2400, 'following list').catch(() => null),
      (isStaff() || isMe) ? withDeadline(db.ref(`users/${targetId}`).once('value'), 2400, 'account details').catch(() => null) : null
    ]);
    if (fSnap) follows = !!fSnap.val();
    if (followersSnap) followerIds = Object.keys(followersSnap.val() || {});
    if (followingSnap) followingIds = Object.keys(followingSnap.val() || {});
    if (uSnap?.exists()) uNode = uSnap.val() || {};
    S.profileRelations.set(targetId, { followers: followerIds, following: followingIds, follows });
    await writeCachedState('profileRelations', Object.fromEntries(S.profileRelations.entries()), uid()).catch(() => {});
    if (uSnap?.exists()) S.userCache.set(targetId, { ...uNode, id: targetId });
  } else if (!isMe) {
    // An explicit cached false matters after unfollow; do not OR it with a stale set entry.
    follows = cachedRelations.follows !== undefined ? !!cachedRelations.follows : S.storyAudience.following.has(targetId);
  }
  const followersCount = followerIds.filter(id => !S.blocked.has(id)).length;
  const followingCount = followingIds.filter(id => !S.blocked.has(id)).length;

  $('up-title').textContent = p.displayName ? `${p.displayName} · @${p.username || 'user'}` : '@' + (p.username || 'user');
  const coverEl = $('up-cover');
  if (coverEl) coverEl.style.background = p.cover ? `url(${safeImageUrl(p.cover)}) center/cover no-repeat` : '';

  const avatarEl = $('up-avatar');
  avatarEl.innerHTML = p.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : '👻';

  $('up-badges').innerHTML = userBadgesHtml(targetId, 'lg');

  const bioEl = $('up-bio');
  const bioText = String(p.bio || '').trim();
  bioEl.textContent = bioText || (isMe ? 'أضف نبذة عنك من الإعدادات.' : 'لا توجد نبذة.');
  bioEl.classList.toggle('empty', !bioText);

  const meta = [];
  if (uNode.lastSeen && (isMe || uNode.showLastSeen !== false))
    meta.push(`<span>🕐 ${esc(relativeTime(uNode.lastSeen))}</span>`);
  if (uNode.createdAt) {
    const days = Math.max(1, Math.floor((now() - uNode.createdAt) / 86400000));
    meta.push(`<span>📅 عضو منذ ${days} يوم</span>`);
  }
  $('up-meta').innerHTML = meta.join('');

  $('up-stats').innerHTML = `
    <div class="profile-stat-cell"><b>${followersCount}</b><span>متابع</span></div>
    <div class="profile-stat-cell"><b>${followingCount}</b><span>يتابع</span></div>
    <div class="profile-stat-cell"><b>${uNode.coins != null ? Number(uNode.coins).toLocaleString() : '—'}</b><span>نقاط</span></div>
  `;

  const actions = $('up-actions');
  if (isMe) {
    actions.innerHTML = `
      <button class="profile-action primary" id="up-edit-self">✏️ تعديل ملفي</button>
      <button class="profile-action" id="up-goto-settings">⚙️ الإعدادات</button>
    `;
    $('up-edit-self').onclick = () => { closeModals(); renderProfileModal(); openView('profile-view'); };
    $('up-goto-settings').onclick = () => { closeModals(); loadSettingsUI(); openView('settings-view'); };
  } else {
    const blocked = S.blocked.has(targetId);
    actions.innerHTML = `
      <button class="profile-action ${follows ? '' : 'primary'}" id="up-follow" ${blocked ? 'disabled aria-disabled="true"' : ''}>
        ${blocked ? '🚫 محظور' : (follows ? '✓ تتابعه' : '+ متابعة')}
      </button>
      <button class="profile-action" id="up-chat" ${blocked ? 'disabled aria-disabled="true"' : ''}>💬 مراسلة</button>
      <button class="profile-action icon-only" id="up-more" title="المزيد">⋯</button>
    `;
    $('up-follow').onclick = () => toggleFollow(targetId, () => openUserProfile(targetId));
    $('up-chat').onclick = () => { closeModals(); startPrivateByUid(targetId); };
    $('up-more').onclick = e => {
      e.stopPropagation();
      showProfileMenu(e.clientX, e.clientY, targetId, p, blocked, isTargetOwner);
    };
  }

  qsa('#up-tabs .ptab').forEach(t => {
    t.onclick = () => {
      qsa('#up-tabs .ptab').forEach(x => x.classList.toggle('active', x === t));
      renderProfileTab(t.dataset.ptab, targetId);
    };
  });

  qsa('#up-tabs .ptab').forEach(x => x.classList.toggle('active', x.dataset.ptab === 'about'));
  renderProfileTab('about', targetId);

  openView('user-profile-view');
}

function showProfileMenu(x, y, targetId, p, blocked, isOwnerTarget) {
  document.getElementById('profile-menu-popup')?.remove();

  const items = [];
  if (!isOwnerTarget) {
    items.push({ id: 'block', icon: '🚫', text: blocked ? 'إلغاء الحظر' : 'حظر المستخدم', danger: true });
    items.push({ id: 'report', icon: '🚩', text: 'إبلاغ', danger: true });
  }
  items.push({ id: 'copy-id', icon: '📋', text: 'نسخ معرف المستخدم' });

  const menu = document.createElement('div');
  menu.id = 'profile-menu-popup';
  menu.className = 'context-menu';
  menu.style.position = 'fixed';
  menu.style.zIndex = '900';
  menu.innerHTML = items.map(i =>
    `<button data-pm="${i.id}" class="${i.danger ? 'danger' : ''}">${i.icon} ${i.text}</button>`
  ).join('');

  document.body.appendChild(menu);
  const w = menu.offsetWidth || 200;
  const h = menu.offsetHeight || 160;
  menu.style.left = `${Math.min(x, window.innerWidth - w - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - h - 8)}px`;

  const close = () => menu.remove();
  setTimeout(() => {
    const off = ev => {
      if (!menu.contains(ev.target)) { close(); document.removeEventListener('click', off); }
    };
    document.addEventListener('click', off);
  }, 50);

  menu.querySelectorAll('[data-pm]').forEach(b => b.onclick = async () => {
    const a = b.dataset.pm;
    close();
    if (a === 'block') await toggleBlock(targetId, () => openUserProfile(targetId));
    else if (a === 'report') await reportUser(targetId);
    else if (a === 'copy-id') {
      try { await navigator.clipboard.writeText(targetId); toast('تم نسخ المعرف.', 'success'); }
      catch { toast('تعذر النسخ.', 'error'); }
    }
  });
}

async function renderProfileTab(tab, targetId) {
  const host = $('up-tab-content');
  if (!host) return;
  host.innerHTML = '<div class="profile-empty">⏳ جارٍ التحميل…</div>';

  try {
    if (tab === 'about') {
      const p = S.profileCache.get(targetId) || {};
      const uSnap = (isStaff() || targetId === uid()) ? await db.ref(`users/${targetId}`).once('value').catch(() => null) : null;
      const u = uSnap?.val() || {};
      const rows = [];
      rows.push(`<div class="about-row"><span>اسم المستخدم</span><b>@${esc(p.username || '—')}</b></div>`);
      rows.push(`<div class="about-row"><span>المعرف</span><b style="font-size:11px">${esc(targetId.slice(0, 16))}…</b></div>`);
      if (p.verified) rows.push(`<div class="about-row"><span>التوثيق</span><b style="color:#e2b98d">✅ موثق</b></div>`);
      if (targetId === S.ownerUid) rows.push(`<div class="about-row"><span>الحساب</span><b>👑 مالك التطبيق</b></div>`);
      if (u.role && u.role !== 'user') rows.push(`<div class="about-row"><span>الدور</span><b>${esc(u.role)}</b></div>`);
      if (u.createdAt) rows.push(`<div class="about-row"><span>تاريخ الانضمام</span><b>${esc(dayTime(u.createdAt))}</b></div>`);
      if (u.lastSeen && (targetId === uid() || u.showLastSeen !== false))
        rows.push(`<div class="about-row"><span>آخر ظهور</span><b>${esc(dayTime(u.lastSeen))}</b></div>`);
      if (p.bio) rows.push(`<div class="about-row"><span>النبذة</span><b>${esc(p.bio)}</b></div>`);

      host.innerHTML = `<div class="about-info">${rows.join('')}</div>`;
    } else if (tab === 'followers' || tab === 'following') {
      const path = tab === 'followers' ? `followers/${targetId}` : `following/${targetId}`;
      const cached = S.profileRelations.get(targetId) || { followers: [], following: [] };
      let ids = tab === 'followers' ? (cached.followers || []) : (cached.following || []);
      if (!S.offlineMode && S.dbConnected !== false) {
        const snap = await withDeadline(db.ref(path).once('value'), 2400, 'profile relations').catch(() => null);
        if (snap) {
          ids = Object.keys(snap.val() || {});
          S.profileRelations.set(targetId, { ...cached, [tab]: ids });
          await writeCachedState('profileRelations', Object.fromEntries(S.profileRelations.entries()), uid()).catch(() => {});
        }
      }
      if (!ids.length) {
        host.innerHTML = `<div class="profile-empty">${tab === 'followers' ? 'لا يوجد متابعون بعد.' : 'لا يتابع أحداً بعد.'}</div>`;
        return;
      }
      await warmProfiles(ids);
      ids = ids.filter(id => !S.blocked.has(id) && S.profileCache.get(id)?.active !== false);
      if (!ids.length) {
        host.innerHTML = `<div class="profile-empty">لا توجد حسابات ظاهرة في هذه القائمة.</div>`;
        return;
      }
      host.innerHTML = ids.map(id => {
        const u = S.profileCache.get(id) || {};
        return `<div class="profile-list-item" data-uid="${esc(id)}">
          <div class="profile-list-avatar">${u.avatar ? `<img src="${esc(safeImageUrl(u.avatar))}" alt="">` : '👤'}</div>
          <div class="profile-list-info">
            <b>@${esc(u.username || id.slice(0, 8))}${u.verified ? ' ✓' : ''}</b>
            <span>${esc(u.bio || '')}</span>
          </div>
        </div>`;
      }).join('');
      host.querySelectorAll('[data-uid]').forEach(el => {
        el.onclick = () => { closeModals(); openUserProfile(el.dataset.uid); };
      });
    }
  } catch (e) {
    host.innerHTML = `<div class="profile-empty">تعذر التحميل.</div>`;
  }
}

async function toggleFollow(target, onDone) {
  if (!uid() || !S.me || !target || target === uid()) return toast('لا يمكن متابعة هذا الحساب.', 'error');
  if (S.blocked.has(target)) return toast('ألغِ حظر المستخدم قبل متابعته.', 'error');
  if (S.offlineMode || S.dbConnected === false) return toast('المتابعة تحتاج إلى اتصال؛ بياناتك المحفوظة لم تتغير.', 'info');
  try {
    const snap = await withDeadline(db.ref(`following/${uid()}/${target}`).once('value'), 3500, 'follow state');
    const exists = snap.exists();
    const up = {};
    if (exists) {
      up[`following/${uid()}/${target}`] = null;
      up[`followers/${target}/${uid()}`] = null;
    } else {
      const profile = S.profileCache.get(target) || {};
      if (profile.active === false) return toast('لا يمكن متابعة حساب غير نشط.', 'error');
      up[`following/${uid()}/${target}`] = true;
      up[`followers/${target}/${uid()}`] = true;
      const nid = db.ref(`notifications/${target}`).push().key;
      up[`notifications/${target}/${nid}`] = {
        type: 'follow', from: uid(), title: 'متابعة جديدة',
        body: `@${S.me.username} بدأ متابعتك`, createdAt: SERVER, read: false
      };
    }
    await db.ref().update(up);
    const targetRel = S.profileRelations.get(target) || { followers: [], following: [] };
    const followers = new Set(targetRel.followers || []);
    if (exists) followers.delete(uid()); else followers.add(uid());
    S.profileRelations.set(target, { ...targetRel, followers: [...followers], follows: !exists });

    const ownRel = S.profileRelations.get(uid()) || { followers: [], following: [] };
    const following = new Set(ownRel.following || []);
    if (exists) following.delete(target); else following.add(target);
    S.profileRelations.set(uid(), { ...ownRel, following: [...following] });

    if (exists) S.storyAudience.following.delete(target); else S.storyAudience.following.add(target);
    await writeCachedState('storyFollowing', [...S.storyAudience.following], uid()).catch(() => {});
    const relations = Object.fromEntries(S.profileRelations.entries());
    await writeCachedState('profileRelations', relations, uid()).catch(() => {});
    toast(exists ? 'تم إلغاء المتابعة.' : 'تمت المتابعة.', 'success');
    if (typeof onDone === 'function') onDone(); else closeModals();
  } catch (e) { toast(firebaseErrorMessage(e), 'error'); }
}

async function persistHiddenChats() {
  const accountUid = uid();
  if (!accountUid) return;
  const ids = [...S.hiddenChats];
  try { localStorage.setItem(`ghostcaffee_hidden_chats_${accountUid}`, JSON.stringify(ids)); } catch {}
  await writeCachedState('hiddenChats', ids, accountUid).catch(() => {});
}

async function persistBlockState() {
  const accountUid = uid();
  if (!accountUid || !S.me) return;
  S.me.blocked = Object.fromEntries([...S.blocked].map(id => [id, true]));
  await writeCachedState('blockMeta', Object.fromEntries(S.blockMeta), accountUid).catch(() => {});
  try { localStorage.setItem(`ghostcaffee_block_meta_${accountUid}`, JSON.stringify(Object.fromEntries(S.blockMeta))); } catch {}
  const windowsObject = Object.fromEntries(S.blockedMessageWindows);
  await writeCachedState('blockedWindows', windowsObject, accountUid).catch(() => {});
  try { localStorage.setItem(`ghostcaffee_block_windows_${accountUid}`, JSON.stringify(windowsObject)); } catch {}
  await writeCachedState('account', {
    me: S.me, contacts: [...S.contacts], blocked: [...S.blocked],
    blockedAt: Object.fromEntries(S.blockMeta), storyViewed: S.me.storyViewed || {}
  }, accountUid).catch(() => {});
}

async function toggleBlock(target, onDone) {
  if (!uid() || !S.me || !target || target === uid()) return toast('لا يمكن حظر هذا الحساب.', 'error');
  if (target === S.ownerUid) return toast('لا يمكن حظر مالك التطبيق من هذه القائمة.', 'error');
  const exists = S.blocked.has(target);
  if (S.offlineMode || S.dbConnected === false) return toast('تغيير الحظر يحتاج إلى اتصال حتى يُحفظ في حسابك. لم يتغير الحظر.', 'info');
  try {
    if (exists) {
      // Remove the block first; keep the closed interval so messages sent while blocked
      // never reappear from the server/cache after unblocking.
      await db.ref(`users/${uid()}/blocked/${target}`).remove();
      const endedAt = Date.now();
      const legacyStart = Number(S.blockMeta.get(target) || 0);
      const windows = [...(S.blockedMessageWindows.get(target) || [])];
      let closed = false;
      for (let i = windows.length - 1; i >= 0; i--) {
        if (windows[i].to == null) { windows[i] = { ...windows[i], to: endedAt }; closed = true; break; }
      }
      // Upgrade existing v7.4.3 cached blocks, which had a start timestamp but no interval history.
      if (!closed && legacyStart > 0) windows.push({ from: legacyStart, to: endedAt });
      S.blockedMessageWindows.set(target, windows.slice(-12));
      S.blocked.delete(target);
      S.blockMeta.delete(target);
      await persistBlockState();
      toast('تم إلغاء حظر المستخدم. لن تعود المتابعة أو جهة الاتصال تلقائياً.', 'success');
    } else {
      const blockedAt = Date.now();
      // This is the only required write for a block. Commit it before optional cleanup.
      await db.ref(`users/${uid()}/blocked/${target}`).set(true);
      const windows = [...(S.blockedMessageWindows.get(target) || [])];
      if (!windows.length || windows[windows.length - 1].to != null) windows.push({ from: blockedAt, to: null });
      else windows[windows.length - 1] = { ...windows[windows.length - 1], from: blockedAt, to: null };
      S.blockedMessageWindows.set(target, windows.slice(-12));
      S.blocked.add(target);
      S.blockMeta.set(target, blockedAt);
      S.contacts.delete(target);
      S.storyAudience.following.delete(target);
      const ownRel = S.profileRelations.get(uid()) || { followers: [], following: [] };
      S.profileRelations.set(uid(), { ...ownRel, following: (ownRel.following || []).filter(id => id !== target) });
      const targetRel = S.profileRelations.get(target);
      if (targetRel) S.profileRelations.set(target, { ...targetRel, followers: (targetRel.followers || []).filter(id => id !== uid()), follows: false });
      await persistBlockState();
      await writeCachedState('storyFollowing', [...S.storyAudience.following], uid()).catch(() => {});
      await writeCachedState('profileRelations', Object.fromEntries(S.profileRelations.entries()), uid()).catch(() => {});

      // Removing follow indexes is best effort: current rules only allow the target-side
      // follower index to be changed while the target account is active.
      try { await db.ref(`following/${uid()}/${target}`).remove(); } catch (e) { console.warn('block cleanup following failed', e?.code); }
      try { await db.ref(`followers/${target}/${uid()}`).remove(); } catch (e) { console.warn('block cleanup followers failed', e?.code); }
      try { await db.ref(`users/${uid()}/contacts/${target}`).remove(); } catch (e) { console.warn('block cleanup contact failed', e?.code); }

      // Reject an incoming request. Current rules authorize the recipient to update the
      // request record but not to set chats/<id>/requestState to rejected.
      const incoming = S.chatRequests?.[target];
      if (incoming?.status === 'pending' && incoming.chatId) {
        const chatId = incoming.chatId;
        try {
          await db.ref(`chatRequests/${uid()}/${target}/status`).set('rejected');
          await db.ref().update({
            [`userChats/${uid()}/${chatId}`]: null,
            [`userChats/${target}/${chatId}`]: null
          });
          if (S.chatRequests[target]) S.chatRequests[target].status = 'rejected';
        } catch (e) { console.warn('block cleanup incoming request failed', e?.code); }
      }

      // Reject our outgoing pending request. We are its creator, so current rules permit
      // changing requestState for this direction; each cleanup stage remains independent.
      try {
        const outgoingSnap = await withDeadline(db.ref(`chatRequests/${target}/${uid()}`).once('value'), 2200, 'outgoing request lookup');
        const outgoing = outgoingSnap?.val();
        if (outgoing?.status === 'pending' && outgoing.chatId) {
          const chatId = outgoing.chatId;
          try { await db.ref(`chatRequests/${target}/${uid()}/status`).set('rejected'); } catch (e) { console.warn('block outgoing request status failed', e?.code); }
          try {
            const chatState = await db.ref(`chats/${chatId}/requestState`).once('value');
            if (chatState.val() === 'pending') await db.ref(`chats/${chatId}/requestState`).set('rejected');
            await db.ref(`chats/${chatId}/updatedAt`).set(SERVER);
          } catch (e) { console.warn('block outgoing chat state failed', e?.code); }
          try {
            await db.ref().update({
              [`userChats/${uid()}/${chatId}`]: null,
              [`userChats/${target}/${chatId}`]: null
            });
          } catch (e) { console.warn('block outgoing indexes failed', e?.code); }
        }
      } catch (e) { console.warn('block outgoing request lookup failed', e?.code); }
      toast('تم حظر المستخدم. أوقف التطبيق عرض رسائله الجديدة ومنعه من المراسلة من واجهتك.', 'success');
    }

    if (S.activeChat?.type === 'private' && otherParticipant(S.activeChat) === target) {
      if (S.blocked.has(target)) {
        S.currentReply = null;
        S.pendingAttachment = null;
        const input = $('message-input');
        if (input) input.value = '';
        resizeMessageInput();
        updateSendButtons();
      }
      setMessageInputPreviewState(S.activeChatId, false);
      await renderChatHeader();
      renderMessages(S.messageCache.get(S.activeChatId) || []);
    }
    scheduleChatListRender();
    if (typeof onDone === 'function') onDone(); else closeModals();
    return true;
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
    return false;
  }
}


async function reportUser(target) {
  if (!target || target === uid()) return toast('لا يمكنك الإبلاغ عن حسابك الشخصي.', 'error');
  const input = await promptAsync('اكتب سبب البلاغ (مطلوب):', '', 'إبلاغ عن مستخدم');
  if (input === null) return;
  const reason = String(input).trim().slice(0, 300);
  if (!reason) return toast('اكتب سبباً واضحاً للبلاغ.', 'error');
  await createReport({ targetType: 'user', targetUid: target, reason });
}

async function reportMessage(m) {
  if (!m?.id || !S.activeChatId || !S.activeChat || m.senderId === uid()) return toast('لا يمكن الإبلاغ عن هذه الرسالة.', 'error');
  const input = await promptAsync('اكتب سبب البلاغ (مطلوب):', '', 'إبلاغ عن رسالة');
  if (input === null) return;
  const reason = String(input).trim().slice(0, 300);
  if (!reason) return toast('اكتب سبباً واضحاً للبلاغ.', 'error');
  await createReport({ targetType: 'message', targetUid: m.senderId, chatId: S.activeChatId, messageId: m.id, reason });
}

async function createReport(payload) {
  if (!uid() || !S.me) return toast('سجّل الدخول أولاً لإرسال البلاغ.', 'error');
  if (S.offlineMode || S.dbConnected === false) return toast('إرسال البلاغ يحتاج إلى اتصال حتى يصل إلى فريق الإشراف. لم يُرسل البلاغ.', 'info');
  const targetType = payload?.targetType;
  if (!['user', 'message', 'story'].includes(targetType)) return toast('نوع البلاغ غير صالح.', 'error');
  const reason = String(payload.reason || '').trim().slice(0, 300);
  if (!reason) return toast('سبب البلاغ مطلوب.', 'error');
  if (targetType === 'user' && (!payload.targetUid || payload.targetUid === uid())) return toast('المستخدم المستهدف غير صالح.', 'error');
  if (targetType === 'message' && (!payload.chatId || !payload.messageId || !payload.targetUid || payload.targetUid === uid())) return toast('بيانات الرسالة المبلّغ عنها غير مكتملة.', 'error');
  if (targetType === 'story' && (!payload.storyId || !payload.targetUid || payload.targetUid === uid())) return toast('بيانات القصة المبلّغ عنها غير مكتملة.', 'error');
  try {
    if (targetType === 'user') {
      const targetSnap = await withDeadline(db.ref(`profiles/${payload.targetUid}`).once('value'), 3000, 'report target profile');
      if (!targetSnap.exists()) return toast('الحساب المستهدف غير موجود.', 'error');
    } else if (targetType === 'message') {
      const [chatSnap, messageSnap] = await Promise.all([
        withDeadline(db.ref(`chats/${payload.chatId}`).once('value'), 3000, 'report chat validation'),
        withDeadline(db.ref(`messages/${payload.chatId}/${payload.messageId}`).once('value'), 3000, 'report message validation')
      ]);
      const reportChat = chatSnap.val() || {};
      const reportMessage = messageSnap.val() || {};
      if (!chatSnap.exists() || !reportChat.participants?.[uid()]) return toast('لا يمكنك الإبلاغ عن رسالة من محادثة لا تنتمي إليها.', 'error');
      if (!messageSnap.exists() || reportMessage.senderId !== payload.targetUid || reportMessage.senderId === uid() || reportMessage.deletedForAll === true) return toast('الرسالة المستهدفة غير موجودة أو لا تطابق صاحبها.', 'error');
    } else if (targetType === 'story') {
      const storySnap = await withDeadline(db.ref(`stories/${payload.storyId}`).once('value'), 3000, 'report story validation');
      const reportStoryNode = storySnap.val() || {};
      if (!storySnap.exists() || reportStoryNode.userId !== payload.targetUid || reportStoryNode.userId === uid()) return toast('القصة المستهدفة غير موجودة أو لا تطابق صاحبها.', 'error');
    }
    const ref = db.ref('reports').push();
    const id = ref.key;
    if (!id) throw new Error('تعذر إنشاء معرف البلاغ.');
    await ref.set({
      targetType,
      ...(payload.targetUid ? { targetUid: payload.targetUid } : {}),
      ...(payload.chatId ? { chatId: payload.chatId } : {}),
      ...(payload.messageId ? { messageId: payload.messageId } : {}),
      ...(payload.storyId ? { storyId: payload.storyId } : {}),
      reporterId: uid(), reporterUsername: S.me.username,
      reason, status: 'open', createdAt: SERVER
    });
    toast('تم إرسال البلاغ للمراجعة.', 'success');
    return true;
  } catch (e) { toast(firebaseErrorMessage(e), 'error'); return false; }
}

/* ==================== Contacts ==================== */
async function renderContacts() {
  const ids = [...S.contacts];
  await warmProfiles(ids);
  const host = $('contacts-body');
  if (!host) return;
  host.innerHTML = `
    <div class="admin-toolbar">
      <button class="admin-btn" id="contacts-refresh">🔄 تحديث</button>
      <button class="admin-btn" id="contacts-add">➕ إضافة</button>
    </div>
    ${ids.map(id => {
      const p = S.profileCache.get(id);
      return p ? `<div class="chat-item" data-contact="${esc(id)}">
        <div class="chat-item-avatar">${p.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : '👤'}</div>
        <div class="chat-item-info">
          <div class="chat-item-name">@${esc(p.username)} ${p.verified ? '✅' : ''}</div>
          <div class="chat-item-last">${esc(p.bio || '')}</div>
        </div>
      </div>` : '';
    }).join('') || '<p style="text-align:center;color:var(--text-secondary)">لا جهات اتصال.</p>'}`;
  $('contacts-refresh').onclick = renderContacts;
  $('contacts-add').onclick = addContact;
  qsa('[data-contact]').forEach(x => x.onclick = () => openUserProfile(x.dataset.contact));
  openView('contacts-view');
}

async function addContact() {
  const name = await promptAsync('اسم المستخدم:', '', 'إضافة جهة اتصال');
  if (name === null) return;
  const un = normalizeUsername(name);
  const s = await db.ref(`usernames/${un}`).once('value').catch(() => null);
  if (!s?.exists()) return toast('المستخدم غير موجود.', 'error');
  const id = s.val();
  if (id === uid()) return;
  if (S.blocked.has(id)) return toast('لا يمكن إضافة مستخدم محظور إلى جهات الاتصال.', 'error');
  try {
    await db.ref(`users/${uid()}/contacts/${id}`).set(true);
    S.contacts.add(id);
    toast('تمت الإضافة.', 'success');
    renderContacts();
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

function showBlocked() {
  openView('contacts-view');
  const body = $('contacts-body');
  if (!body) return;
  const ids = [...S.blocked];
  Promise.all(ids.map(async id => {
    if (!S.profileCache.has(id)) await warmProfiles([id]);
  })).then(() => {
    const rows = ids.map(id => {
      const p = S.profileCache.get(id) || {};
      return `<div class="chat-item">
        <div class="chat-item-avatar">${p.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : '👤'}</div>
        <div class="chat-item-info">
          <div class="chat-item-name">@${esc(p.username || id.slice(0, 8))}</div>
        </div>
        <button class="admin-btn sm" data-unblock="${esc(id)}">فك الحظر</button>
      </div>`;
    }).join('');
    body.innerHTML = '<h3 style="margin-bottom:12px">🚫 المحظورون</h3>' +
      (rows || '<p style="text-align:center;color:var(--text-secondary)">لا يوجد محظورون.</p>');
    qsa('[data-unblock]').forEach(x => x.onclick = () => toggleBlock(x.dataset.unblock));
  });
}

/* ==================== Voice ==================== */
function voiceExt(mime) {
  return /mp4|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';
}

async function toggleVoice() {
  if (S.voiceRecorder) {
    S.voiceAutoSend = false;
    S.voiceRecorder.stop();
    return;
  }
  if (!S.activeChatId) return toast('افتح محادثة أولاً.', 'error');
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    return toast('تسجيل الصوت غير مدعوم في هذا المتصفح.', 'error');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      .find(t => MediaRecorder.isTypeSupported?.(t));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    S.voiceRecorder = recorder;
    S.voiceChunks = [];
    S.voiceCanceled = false;
    S.voiceStartedAt = Date.now();
    $('voice-recording')?.classList.remove('hidden');
    const tick = () => {
      const el = $('rec-time');
      if (!el) return;
      const elapsed = Math.floor((Date.now() - S.voiceStartedAt) / 1000);
      el.textContent = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
      if (elapsed >= 90 && S.voiceRecorder) {
        S.voiceAutoSend = false;
        S.voiceRecorder.stop();
      }
    };
    tick();
    S.voiceTimer = setInterval(tick, 1000);
    recorder.ondataavailable = e => { if (e.data && e.data.size) S.voiceChunks.push(e.data); };
    recorder.onstop = async () => {
      clearInterval(S.voiceTimer);
      S.voiceTimer = null;
      stream.getTracks().forEach(t => t.stop());
      $('voice-recording')?.classList.add('hidden');
      const canceled = S.voiceCanceled, autoSend = S.voiceAutoSend;
      const chunks = S.voiceChunks;
      S.voiceChunks = [];
      S.voiceRecorder = null;
      S.voiceCanceled = false;
      S.voiceAutoSend = false;
      if (canceled || !chunks.length) return;
      const type = (recorder.mimeType || 'audio/webm').split(';')[0] + (/codecs/.test(recorder.mimeType || '') ? ';' + recorder.mimeType.split(';').slice(1).join(';') : '');
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size > MAX_FILE_BYTES) return toast('التسجيل أكبر من 2MB.', 'error');
      try {
        const dataUrl = await readAsDataUrl(blob);
        if (!safeDataUrl(dataUrl) || dataUrl.length > MAX_DATA_URL_LENGTH)
          return toast('التسجيل كبير جداً.', 'error');
        S.pendingAttachment = {
          type: 'audio',
          data: { name: `voice.${voiceExt(blob.type)}`, size: blob.size, mime: (blob.type || type).slice(0, 100), dataUrl }
        };
        updateSendButtons();
        if (autoSend) await sendMessage();
        else {
          showAttachmentBar('🎤 تسجيل صوتي');
          toast('تم تجهيز التسجيل، اضغط إرسال.', 'success');
        }
      } catch (e) {
        toast('تعذر تجهيز التسجيل.', 'error');
      }
    };
    recorder.start(1000);
  } catch (e) {
    S.voiceRecorder = null;
    toast('تعذر الوصول إلى الميكروفون. اسمح بالصلاحية من إعدادات المتصفح.', 'error');
  }
}

function cancelVoice() {
  if (!S.voiceRecorder) return;
  S.voiceCanceled = true;
  try { S.voiceRecorder.stop(); } catch {}
  toast('تم إلغاء التسجيل.', 'info');
}

/* ==================== Settings ==================== */
async function saveSettings() {
  if (!S.me) return;
  if (S.offlineMode || S.dbConnected === false) return toast('حفظ الإعدادات يحتاج إلى اتصال. لم تتغير إعدادات الحساب.', 'info');
  const payload = {
    notifications: !!$('opt-notifications')?.checked,
    sounds: !!$('opt-sounds')?.checked,
    readReceipts: !!$('opt-read-receipts')?.checked,
    showLastSeen: !!$('opt-show-lastseen')?.checked,
    showOnline: !!$('opt-show-online')?.checked
  };
  try {
    if (payload.notifications && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    await db.ref().update({
      [`users/${uid()}/settings`]: payload,
      [`users/${uid()}/showLastSeen`]: payload.showLastSeen,
      [`users/${uid()}/showOnline`]: payload.showOnline,
      [`presence/${uid()}/showLastSeen`]: payload.showLastSeen,
      [`presence/${uid()}/showOnline`]: payload.showOnline
    });
    S.me.settings = payload;
    S.me.showLastSeen = payload.showLastSeen;
    S.me.showOnline = payload.showOnline;
    await writeCachedState('account', {
      me: S.me, contacts: [...S.contacts], blocked: [...S.blocked],
      blockedAt: Object.fromEntries(S.blockMeta), storyViewed: S.me.storyViewed || {}
    }, uid()).catch(() => {});
    toast('تم الحفظ.', 'success');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

function loadSettingsUI() {
  const s = S.me?.settings || {};
  const notif = $('opt-notifications');
  if (notif) notif.checked = s.notifications !== false;
  const snd = $('opt-sounds');
  if (snd) snd.checked = s.sounds !== false;
  const rr = $('opt-read-receipts');
  if (rr) rr.checked = s.readReceipts !== false;
  const sl = $('opt-show-lastseen');
  if (sl) sl.checked = S.me?.showLastSeen !== false;
  const so = $('opt-show-online');
  if (so) so.checked = S.me?.showOnline !== false;
}

async function exportMyChats() {
  const idx = (await db.ref(`userChats/${uid()}`).once('value')).val() || {};
  const out = { version: STORE_VERSION, exportedAt: new Date().toISOString(), user: { username: S.me.username }, chats: {} };
  for (const id of Object.keys(idx)) {
    const c = (await db.ref(`chats/${id}`).once('value')).val();
    if (!c) continue;
    const msgs = (await db.ref(`messages/${id}`).once('value')).val() || {};
    out.chats[id] = { meta: c, messages: msgs };
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  await saveBlobAsDownload(blob, `ghostcaffee-${S.me.username}-${new Date().toISOString().slice(0, 10)}.json`);
  toast('تم تجهيز النسخة.', 'success');
}

function clearLocalData() {
  confirmAsync('سيتم مسح PIN والتفضيلات والرسائل المحفوظة محلياً لهذا الحساب فقط. ستبقى المحادثات الأصلية في Realtime Database.', 'مسح البيانات المحلية', 'مسح', true)
    .then(async ok => {
      if (!ok) return;
      localStorage.removeItem('ghostcaffee_theme');
      localStorage.removeItem('ghostcaffee_wallpaper');
      clearLocalPin();
      await clearCachedMessagesForCurrentUser();
      toast('تم مسح البيانات المحلية.', 'success');
      location.reload();
    });
}

/* ==================== Search ==================== */
function searchMessages(q) {
  if (!S.activeChatId) return;
  const msgs = S.messageCache.get(S.activeChatId) || [];
  const query = String(q || '').trim().toLowerCase();
  S.forceScroll = !query;
  renderMessages(msgs);
  if (!query) return;
  let first = null;
  qsa('#messages-container .message').forEach(el => {
    const m = msgs.find(x => x.id === el.dataset.id);
    if (m && !m.deletedForAll && String(m.text || '').toLowerCase().includes(query)) {
      el.classList.add('highlight');
      first = first || el;
    }
  });
  first?.scrollIntoView({ block: 'center' });
}

async function openChatInfo() {
  const c = S.activeChat;
  if (!c) return;
  if (c.type !== 'group') return openUserProfile(otherParticipant(c));
  const ids = Object.keys(c.participants || {});
  await warmProfiles(ids);
  const canManage = isOwner() || isAdmin() || c.participants?.[uid()]?.role === 'admin';
  const rows = ids.map(id => {
    const p = S.profileCache.get(id) || {}, part = c.participants[id] || {}, role = part.role || 'member';
    const actions = canManage && id !== uid()
      ? `<div class="member-actions">
          <button data-member-action="${role === 'admin' ? 'demote' : 'promote'}" data-member="${id}">${role === 'admin' ? 'تنزيل' : 'ترقية'}</button>
          <button data-member-action="kick" data-member="${id}">طرد</button>
          <button data-member-action="${c.blocked?.[id] ? 'unban' : 'perm-ban'}" data-member="${id}">${c.blocked?.[id] ? 'رفع الحظر' : 'حظر دائم'}</button>
          <button data-member-action="ban" data-member="${id}">مؤقت</button>
        </div>`
      : '';
    return `<div class="contact-item group-member-row">
      <div class="contact-avatar">${p.avatar ? `<img src="${esc(safeImageUrl(p.avatar))}" alt="">` : '👤'}</div>
      <div class="contact-info">
        <div class="contact-name">@${esc(p.username || id.slice(0, 8))} ${userBadgesHtml(id, 'sm')}</div>
        <div class="contact-status">${esc(role)}${c.blocked?.[id] ? ' · حظر دائم' : ''}${part.bannedUntil && Number(part.bannedUntil) > now() ? ' · حظر مؤقت' : ''}</div>
      </div>
      ${actions}
    </div>`;
  }).join('');
  openView('contacts-view');
  $('contacts-body').innerHTML = `
    <h3>${esc(c.name || 'المجموعة')}</h3>
    <p class="group-description">${esc(c.description || 'لا يوجد وصف.')}</p>
    <div class="admin-toolbar">
      <button class="admin-btn" id="group-add-member">➕ إضافة عضو</button>
      ${canManage ? '<button class="admin-btn" id="group-edit">✏️ تعديل</button><button class="admin-btn" id="group-photo-btn">🖼️ الصورة</button><button class="admin-btn" id="group-invite">🔗 دعوة</button><input type="file" id="group-photo-input" accept="image/*" hidden>' : ''}
      <button class="admin-btn danger" id="group-leave">🚪 مغادرة</button>
    </div>
    <div class="group-member-list">${rows}</div>`;
  $('group-add-member')?.addEventListener('click', addGroupMember);
  $('group-leave')?.addEventListener('click', leaveGroup);
  $('group-edit')?.addEventListener('click', editGroup);
  $('group-photo-btn')?.addEventListener('click', () => $('group-photo-input')?.click());
  $('group-photo-input')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setGroupPhoto(f);
  });
  $('group-invite')?.addEventListener('click', createGroupInvite);
  $('contacts-body').querySelectorAll('[data-member-action]').forEach(b =>
    b.onclick = () => manageGroupMember(b.dataset.memberAction, b.dataset.member)
  );
}

async function setGroupPhoto(file) {
  if (!file || !S.activeChat) return;
  try {
    const data = await compressImage(file, 400, .8);
    if (data.length > 2800000) return toast('الصورة كبيرة جداً.', 'error');
    await db.ref(`chats/${S.activeChat.id}/photo`).set(data);
    S.activeChat.photo = data;
    toast('تم تحديث صورة المجموعة.', 'success');
    openChatInfo();
  } catch (e) {
    toast('تعذر حفظ الصورة.', 'error');
  }
}

async function editGroup() {
  const c = S.activeChat;
  if (!c || c.type !== 'group' || !(isOwner() || isAdmin() || c.participants?.[uid()]?.role === 'admin')) return;
  const name = await promptAsync('اسم المجموعة:', c.name || '', 'تعديل المجموعة');
  if (name === null) return;
  const description = await promptAsync('وصف المجموعة:', c.description || '', 'وصف المجموعة');
  if (description === null) return;
  if (!name.trim() || name.trim().length > 30 || description.length > 200) return toast('البيانات غير صالحة.', 'error');
  try {
    await db.ref(`chats/${c.id}`).update({ name: name.trim(), description: description.slice(0, 200) });
    toast('تم تحديث المجموعة.', 'success');
    openChatInfo();
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function manageGroupMember(action, target) {
  const c = S.activeChat, actor = c?.participants?.[uid()];
  if (!c || !target || target === uid()) return;
  if (!isOwner() && !isAdmin() && actor?.role !== 'admin') return toast('لا تملك الصلاحية.', 'error');
  try {
    if (action === 'promote') await db.ref(`chats/${c.id}/participants/${target}/role`).set('admin');
    else if (action === 'demote') await db.ref(`chats/${c.id}/participants/${target}/role`).set('member');
    else if (action === 'kick') await db.ref().update({ [`chats/${c.id}/participants/${target}`]: null, [`userChats/${target}/${c.id}`]: null });
    else if (action === 'ban') return openGroupBanModal(target);
    else if (action === 'perm-ban') {
      await db.ref(`chats/${c.id}/blocked/${target}`).set(true);
      await db.ref(`userChats/${target}/${c.id}`).remove();
    } else if (action === 'unban') {
      await db.ref(`chats/${c.id}/blocked/${target}`).remove();
    }
    toast('تم تحديث العضو.', 'success');
    openChatInfo();
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

function openGroupBanModal(target) {
  const m = $('group-ban-modal');
  if (!m) return;
  m.dataset.target = target;
  m.classList.remove('hidden');
  $('group-ban-hours').value = 24;
  $('group-ban-reason').value = '';
  $('group-ban-reason').focus();
}

async function applyGroupBan() {
  const c = S.activeChat;
  const target = $('group-ban-modal')?.dataset.target;
  const h = Number($('group-ban-hours')?.value || 0);
  const reason = ($('group-ban-reason')?.value || '').trim();
  const actor = c?.participants?.[uid()];
  if (!c || h < 1 || h > 720 || !reason || reason.length > 200)
    return toast('أدخل مدة 1-720 ساعة وسبباً إلزامياً.', 'error');
  if (!isOwner() && !isAdmin() && actor?.role !== 'admin' && !c.groupModerators?.[uid()])
    return toast('لا تملك صلاحية الحظر.', 'error');
  try {
    const up = {}, until = now() + h * 3600000;
    up[`chats/${c.id}/participants/${target}/bannedUntil`] = until;
    up[`chats/${c.id}/participants/${target}/banReason`] = reason;
    up[`chats/${c.id}/participants/${target}/bannedBy`] = uid();
    makeNotification(target, 'group_ban', 'تم حظرك من المجموعة', `المدة ${h} ساعة — السبب: ${reason}`, up);
    await db.ref().update(up);
    $('group-ban-modal').classList.add('hidden');
    toast('تم الحظر المؤقت.', 'success');
    openChatInfo();
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function createGroupInvite() {
  const c = S.activeChat;
  if (!c) return;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  try {
    await db.ref().update({
      [`invites/${code}`]: { chatId: c.id, createdBy: uid(), createdAt: SERVER },
      [`chats/${c.id}/inviteCode`]: code
    });
    S.currentInviteCode = code;
    const link = `${location.origin}${location.pathname}?invite=${code}`;
    const linkEl = $('invite-link');
    if (linkEl) { linkEl.textContent = link; linkEl.href = link; }
    openView('invite-view');
    toast('تم إنشاء رابط الدعوة.', 'success');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function handleInviteParam() {
  const code = new URLSearchParams(location.search).get('invite');
  if (!code) return;
  if (!uid()) return; // سيعاد الاستدعاء بعد الدخول

  let inv = null;
  try {
    inv = (await db.ref(`invites/${code}`).once('value'))?.val();
  } catch {}
  if (!inv) {
    toast('رابط الدعوة غير صالح أو تم إلغاؤه.', 'error');
    history.replaceState(null, '', location.pathname);
    return;
  }

  let c = null;
  try {
    c = (await db.ref(`chats/${inv.chatId}`).once('value'))?.val();
  } catch {}
  if (!c || c.type !== 'group') {
    toast('المجموعة غير موجودة.', 'error');
    history.replaceState(null, '', location.pathname);
    return;
  }

  // المستخدم عضو بالفعل → افتح القروب مباشرة
  if (c.participants?.[uid()]) {
    toast('أنت عضو بالفعل.', 'info');
    history.replaceState(null, '', location.pathname);
    return openChat(inv.chatId);
  }

  // عرض المودال للمعاينة
  const m = $('invite-preview-modal');
  if (!m) return;
  m.dataset.chatId = inv.chatId;
  m.dataset.inviteCode = code;
  $('invite-preview-title').textContent = c.name || 'مجموعة';
  $('invite-preview-body').textContent = `${Object.keys(c.participants || {}).length} أعضاء${c.description ? ' · ' + c.description : ''}`;
  m.classList.remove('hidden');
}

async function joinInviteGroup() {
  const m = $('invite-preview-modal'), id = m?.dataset.chatId;
  if (!id) return;
  try {
    await db.ref(`chats/${id}/participants/${uid()}`).set({ role: 'member' });
    await db.ref(`userChats/${uid()}/${id}`).set(true);
    m.classList.add('hidden');
    history.replaceState(null, '', location.pathname);
    toast('انضممت إلى المجموعة.', 'success');
    openChat(id);
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function addGroupMember() {
  if (S.activeChat?.type !== 'group') return;
  const name = await promptAsync('اسم العضو:', '', 'إضافة عضو');
  if (name === null) return;
  const s = await db.ref(`usernames/${normalizeUsername(name)}`).once('value');
  if (!s.exists()) return toast('المستخدم غير موجود.', 'error');
  const target = s.val();
  if (S.activeChat.participants?.[target]) return toast('العضو موجود بالفعل.', 'error');
  const actor = S.activeChat.participants?.[uid()];
  if (actor?.role !== 'admin' && !isStaff()) return toast('مشرفو المجموعة فقط يستطيعون الإضافة.', 'error');
  try {
    await db.ref(`chats/${S.activeChatId}/participants/${target}`).set({ role: 'member' });
    await db.ref(`userChats/${target}/${S.activeChatId}`).set(true);
    toast('تمت الإضافة.', 'success');
    closeModals();
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function leaveGroup() {
  if (S.activeChat?.type !== 'group') return;
  if (S.offlineMode || S.dbConnected === false) return toast('مغادرة المجموعة تحتاج إلى اتصال.', 'info');
  if (S.activeChat.participants?.[uid()]?.role === 'admin'
    && !Object.values(S.activeChat.participants || {}).some(x => x.role === 'admin' && x !== S.activeChat.participants[uid()]))
    return toast('عيّن مشرفاً آخر قبل المغادرة.', 'error');
  try {
    await db.ref(`chats/${S.activeChatId}/participants/${uid()}`).remove();
    await db.ref(`userChats/${uid()}/${S.activeChatId}`).remove();
    closeModals();
    toast('غادرت المجموعة.', 'success');
    closeActiveChat();
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

async function pinChat() {
  if (!S.activeChatId || S.offlineMode || S.dbConnected === false) return toast('تغيير التثبيت يحتاج إلى اتصال.', 'info');
  const path = `chats/${S.activeChatId}/pinned/${uid()}`;
  const s = await db.ref(path).once('value');
  await db.ref(path).set(!s.val());
}

async function muteChat() {
  if (!S.activeChatId || S.offlineMode || S.dbConnected === false) return toast('تغيير الكتم يحتاج إلى اتصال.', 'info');
  const path = `chats/${S.activeChatId}/muted/${uid()}`;
  const s = await db.ref(path).once('value');
  await db.ref(path).set(!s.val());
}

async function archiveChat() {
  if (!S.activeChatId || S.offlineMode || S.dbConnected === false) return toast('الأرشفة تحتاج إلى اتصال.', 'info');
  const path = `chats/${S.activeChatId}/archived/${uid()}`;
  const s = await db.ref(path).once('value');
  await db.ref(path).set(!s.val());
}

async function clearChatForMe() {
  const chatId = S.activeChatId;
  if (!chatId || !S.activeChat) return;
  if (S.offlineMode || S.dbConnected === false) return toast('مسح الرسائل يحتاج إلى اتصال حتى لا تتعارض النسخ المحلية.', 'info');
  if (!await confirmAsync('إخفاء الرسائل الحالية لديك فقط؟ ستبقى المحادثة في القائمة.', 'مسح رسائلي', 'مسح', true)) return;
  const msgs = S.messageCache.get(chatId) || [];
  const updates = {};
  msgs.forEach(m => { if (m?.id) updates[`messages/${chatId}/${m.id}/deletedFor/${uid()}`] = true; });
  try {
    if (Object.keys(updates).length) await db.ref().update(updates);
    const updated = msgs.map(m => ({ ...m, deletedFor: { ...(m.deletedFor || {}), [uid()]: true } }));
    S.messageCache.set(chatId, updated);
    await writeCachedMessages(chatId, updated).catch(() => {});
    renderMessages(updated);
    toast('تم مسح الرسائل من عرضك فقط؛ الطرف الآخر يحتفظ بنسخته.', 'success');
  } catch (e) { toast(firebaseErrorMessage(e), 'error'); }
}

async function clearCachedMessagesForChat(chatId, accountUid = uid()) {
  if (!chatId || !accountUid) return;
  const localDb = await openLocalCacheDb();
  if (localDb?.objectStoreNames.contains('messageItems')) {
    await new Promise(resolve => {
      try {
        const tx = localDb.transaction('messageItems', 'readwrite');
        const store = tx.objectStore('messageItems');
        const req = store.index('byAccountChat').getAll(IDBKeyRange.only([accountUid, chatId]));
        req.onsuccess = () => (req.result || []).forEach(row => store.delete(row.key));
        tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
      } catch { resolve(); }
    });
  }
  try { localStorage.removeItem(`ghostcaffee_messages_${accountUid}_${chatId}`); } catch {}
}

async function deleteChatForMe() {
  const chatId = S.activeChatId;
  if (!chatId || !S.activeChat || !S.activeChat.participants?.[uid()]) return;
  if (S.offlineMode || S.dbConnected === false) return toast('حذف المحادثة يحتاج إلى اتصال لحفظه في حسابك.', 'info');
  if (!await confirmAsync('حذف المحادثة من قائمتك وعلى هذا الحساب؟ لن تُحذف نسخة الطرف الآخر، ويمكن بدء المحادثة مجدداً لاحقاً.', 'حذف المحادثة لدي', 'حذف', true)) return;
  try {
    await db.ref(`userChats/${uid()}/${chatId}`).remove();
    S.hiddenChats.add(chatId);
    const nextIndex = { ...(S.chatIndex || {}) };
    delete nextIndex[chatId];
    S.chatIndex = nextIndex;
    try { localStorage.setItem(`ghostcaffee_chat_index_${uid()}`, JSON.stringify(nextIndex)); } catch {}
    await persistHiddenChats();
    await writeCachedState('chatIndex', nextIndex, uid()).catch(() => {});
    S.chatCache.delete(chatId);
    S.messageCache.delete(chatId);
    await clearCachedMessagesForChat(chatId);
    saveChatCache();
    syncChatListeners(Object.keys(nextIndex));
    closeActiveChat();
    scheduleChatListRender();
    toast('حُذفت المحادثة من قائمتك. لم تُحذف من جهاز الطرف الآخر.', 'success');
  } catch (e) { toast(firebaseErrorMessage(e), 'error'); }
}

async function blockChatUser() {
  if (S.activeChat?.type !== 'private') return toast('يمكن حظر مستخدم من محادثة خاصة فقط.', 'info');
  const target = otherParticipant(S.activeChat);
  if (!target) return;
  await toggleBlock(target);
}

/* ==================== Story reporting ==================== */
async function reportStory() {
  const g = S.storyGroups[S.storyIndex];
  const story = g?.stories?.[S.storyItemIndex];
  if (!story || story.userId === uid()) return toast('لا يمكنك الإبلاغ عن قصتك الشخصية.', 'error');
  const input = await promptAsync('اكتب سبب البلاغ (مطلوب):', '', 'إبلاغ عن قصة');
  if (input === null) return;
  const reason = String(input).trim().slice(0, 300);
  if (!reason) return toast('اكتب سبباً واضحاً للبلاغ.', 'error');
  await createReport({ targetType: 'story', storyId: story.id, targetUid: story.userId, reason });
}

/* ==================== Presence / typing ==================== */
function updatePresenceText() {
  if (!S.activeChat || S.activeChat.type !== 'private') return;
  const target = Object.keys(S.activeChat.participants || {}).find(x => x !== uid());
  const pr = S.presenceCache.get(target) || {};
  const el = $('chat-status');
  if (!el) return;
  if (pr.showOnline === false) el.textContent = 'غير متاح';
  else el.textContent = pr.online ? 'متصل الآن' : (pr.showLastSeen === false ? 'آخر ظهور مخفي' : `آخر ظهور ${relativeTime(pr.lastSeen)}`);
}

function setupTyping() {
  if (S.typingInputBound) return;
  const input = $('message-input');
  if (!input) return;
  S.typingInputBound = true;
  input.addEventListener('input', () => {
    resizeMessageInput();
    updateSendButtons();
    if (!S.activeChatId || !uid() || S.currentEdit) return;
    const ref = db.ref(`typing/${S.activeChatId}/${uid()}`);
    S.typingRef = ref;
    if (!S.typingSent) {
      S.typingSent = true;
      ref.set(true).catch(() => {});
    }
    clearTimeout(S.typingTimer);
    S.typingTimer = setTimeout(() => { S.typingSent = false; ref.remove().catch(() => {}); }, 1800);
  });
}

function bindActiveChatPresence() {
  if (S.chatPresenceUnsub) { try { S.chatPresenceUnsub(); } catch {} S.chatPresenceUnsub = null; }
  if (!S.activeChatId || S.activeChat?.type !== 'private') return;
  const target = Object.keys(S.activeChat.participants || {}).find(x => x !== uid());
  if (!target) return;
  const ref = db.ref(`presence/${target}`);
  const h = snap => {
    const p = snap.val() || {};
    S.presenceCache.set(target, p);
    updatePresenceText();
  };
  ref.on('value', h);
  S.chatPresenceUnsub = () => ref.off('value', h);
}

function bindActiveChatTyping() {
  if (S.chatTypingUnsub) { try { S.chatTypingUnsub(); } catch {} S.chatTypingUnsub = null; }
  if (!S.activeChatId) return;
  const ref = db.ref(`typing/${S.activeChatId}`);
  const h = snap => {
    const someone = Object.entries(snap.val() || {}).some(([id, v]) => id !== uid() && v === true);
    $('typing-indicator')?.classList.toggle('hidden', !someone);
  };
  ref.on('value', h);
  S.chatTypingUnsub = () => ref.off('value', h);
}

async function loadAboutCounts() {
  // This view is account-local only: never query global user/chat counts or expose owner IDs.
  const me = S.me || {};
  const username = $('about-account-username');
  const status = $('about-account-status');
  const accountId = $('about-account-id');
  const deviceId = $('about-device-id');
  if (username) username.textContent = me.username ? `@${me.username}` : 'غير مسجّل';
  if (status) status.textContent = ({ active: 'نشط', banned: 'محظور', deleted: 'محذوف' }[me.status] || 'غير معروف');
  if (accountId) accountId.textContent = me.id || uid() || '—';
  if (deviceId) deviceId.textContent = S.deviceId || 'هذا الجهاز';
}

function openSideMenu() {
  const menu = $('side-menu');
  if (!menu || $('app-screen')?.classList.contains('hidden')) return;
  menu.classList.remove('hidden');
  menu.setAttribute('aria-hidden', 'false');
  document.body.classList.add('menu-open');
  $('btn-menu')?.setAttribute('aria-expanded', 'true');
}
function closeSideMenu() {
  $('side-menu')?.classList.add('hidden');
  $('side-menu')?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('menu-open');
  $('btn-menu')?.setAttribute('aria-expanded', 'false');
}

function bindSideMenuEvents() {
  if (S.menuEventsBound) return;
  S.menuEventsBound = true;
  // Delegate from document so the menu stays functional even when the chat/sidebar is re-rendered.
  document.addEventListener('click', async event => {
    const target = event.target?.closest?.('#btn-menu');
    if (target) {
      event.preventDefault();
      openSideMenu();
      return;
    }
    if (event.target?.closest?.('#menu-backdrop,[data-menu-close]')) {
      event.preventDefault();
      closeSideMenu();
      return;
    }
    const button = event.target?.closest?.('#side-menu .menu-item[data-action]');
    if (!button) return;
    event.preventDefault();
    const action = button.dataset.action;
    closeSideMenu();
    try {
      if (action === 'profile') { renderProfileModal(); openView('profile-view'); }
      else if (action === 'contacts') await renderContacts();
      else if (action === 'settings') { loadSettingsUI(); openView('settings-view'); }
      else if (action === 'admin') openAdminPanel();
      else if (action === 'about') openView('about-view');
      else if (action === 'logout') await logout();
      else if (action === 'blocked') showBlocked();
      else if (action === 'secure-account') {
        if (!auth.currentUser?.isAnonymous || !S.me) return toast('هذا الخيار متاح للحسابات القديمة التي تستخدم هوية ضيف فقط.', 'info');
        $('reg-username').value = normalizeUsername(S.me.username || '');
        showAuthScreen('أمّن حسابك الحالي باسم المستخدم نفسه وكلمة مرور. ستبقى المحادثات والمجموعات مرتبطة بحسابك.', 'register');
        $('reg-password')?.focus();
      }
    } catch (error) {
      console.error('[Ghost Caffee] Menu action failed:', action, error);
      toast(firebaseErrorMessage(error), 'error');
    }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSideMenu(); });
}

/* ==================== Wiring ==================== */
function loadChats() { scheduleChatListRender(); }

function wireEvents() {
  bindSideMenuEvents();
  $('register-form')?.addEventListener('submit', registerAccount);
  $('login-form')?.addEventListener('submit', loginAccount);
  qsa('.auth-tab').forEach(b => b.addEventListener('click', () => setAuthTab(b.dataset.tab)));
  setAuthTab(localStorage.getItem('ghostcaffee_has_account') ? 'login' : 'register');
// ============ Invite View handlers ============
  $('invite-copy')?.addEventListener('click', async () => {
  const link = $('invite-link')?.href;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    toast('تم نسخ الرابط.', 'success');
  } catch {
    // fallback للمتصفحات القديمة
    const ta = document.createElement('textarea');
    ta.value = link;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('تم نسخ الرابط.', 'success'); }
    catch { toast('انسخ الرابط يدوياً.', 'info'); }
    ta.remove();
  }
});

  $('invite-share')?.addEventListener('click', async () => {
  const link = $('invite-link')?.href;
  if (!link) return;
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'دعوة لمجموعة',
        text: `انضم إلى ${S.activeChat?.name || 'المجموعة'}`,
        url: link
      });
    } catch {}
  } else {
    $('invite-copy')?.click();
  }
});

$('invite-open')?.addEventListener('click', () => {
  const link = $('invite-link')?.href;
  if (!link) return;
  window.open(link, '_blank', 'noopener');
});

$('invite-revoke')?.addEventListener('click', async () => {
  if (!S.currentInviteCode) return;
  if (!await confirmAsync('إلغاء رابط الدعوة؟ لن يعمل بعد الآن.', 'إلغاء الرابط', 'إلغاء', true)) return;
  try {
    await db.ref(`invites/${S.currentInviteCode}`).remove();
    if (S.activeChatId) await db.ref(`chats/${S.activeChatId}/inviteCode`).remove();
    S.currentInviteCode = null;
    closeModals();
    toast('تم إلغاء الرابط.', 'success');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
});
  // Retry authentication/database initialization without silently creating an anonymous account.
  $('auth-retry')?.addEventListener('click', async () => {
    S.pendingAuthError = null;
    S.initializedForUid = null;
    S.sessionInitInProgress = false;
    setAuthError('');
    if (!auth.currentUser) {
      showAuthScreen('', localStorage.getItem('ghostcaffee_has_account') ? 'login' : 'register');
      return;
    }
    try {
      const ok = await initializeAuthenticatedUser(auth.currentUser);
      if (!ok) setAuthError(S.pendingAuthError || 'تعذر فتح الحساب. تحقق من الاتصال ثم أعد المحاولة.');
    } catch (e) {
      setAuthError(firebaseErrorMessage(e));
    }
  });

  // PIN
  qsa('[data-pin]').forEach(b => b.onclick = async () => {
    const v = b.dataset.pin;
    if (v === 'del') S.pinBuffer = S.pinBuffer.slice(0, -1);
    else if (v === 'ok') {
      if (S.pinBuffer.length === 4) await verifyPin();
      return;
    } else if (S.pinBuffer.length < 4) S.pinBuffer += v;
    renderPinDots();
  });

  // Message input
  $('btn-send')?.addEventListener('click', sendMessage);
  $('btn-voice')?.addEventListener('click', toggleVoice);
  $('rec-send')?.addEventListener('click', () => {
    if (S.voiceRecorder) { S.voiceAutoSend = true; S.voiceRecorder.stop(); }
  });
  $('rec-cancel')?.addEventListener('click', cancelVoice);
  $('upload-progress')?.addEventListener('click', cancelAttachment);

  // Chat list (delegated)
  $('chat-list')?.addEventListener('click', e => {
    const req = e.target.closest('[data-request-action]');
    if (req) {
      const item = e.target.closest('[data-request-chat]');
      return handleChatRequest(item.dataset.requestChat, item.dataset.requestFrom, req.dataset.requestAction);
    }
    const item = e.target.closest('.chat-item');
    if (item) {
      const c = S.chatCache.get(item.dataset.id);
      if (c?.requestState === 'pending' && c.createdBy === uid())
        return cancelChatRequest(item.dataset.id, otherParticipant(c));
      return openChat(item.dataset.id);
    }
    if (e.target.closest('#empty-new-chat')) return startNewPrivateChat();
    if (e.target.closest('#empty-new-group')) return openGroupModal();
  });

  // Messages (delegated)
  const msgHost = $('messages-container');
  if (msgHost) {
    const msgId = el => el?.closest('.message')?.dataset.id;
    msgHost.addEventListener('click', async e => {
      const profile = e.target.closest('[data-profile-id]');
      if (profile) { e.stopPropagation(); return openUserProfile(profile.dataset.profileId); }
      const chip = e.target.closest('.reaction-chip');
      if (chip) { e.stopPropagation(); return addReactionTo(e, msgId(chip), chip.dataset.reaction); }
      const reply = e.target.closest('.msg-reply');
      if (reply) {
        e.stopPropagation();
        const rid = reply.dataset.replyId;
        if (String(rid).startsWith('story_')) return;
        const el = host.querySelector(`.message[data-id="${CSS.escape(rid)}"]`);
        if (!el) return toast('الرسالة الأصلية غير محمّلة', 'info');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('reply-highlight');
        setTimeout(() => el.classList.remove('reply-highlight'), 1500);
        return;
      }
      const img = e.target.closest('.message-image');
      if (img) { return openImage(img.getAttribute('src')); }
      if (e.detail === 2 && msgId(e.target)) openContextMenu(e.clientX, e.clientY, msgId(e.target));
    });
    msgHost.addEventListener('contextmenu', e => {
      const id = msgId(e.target);
      if (!id) return;
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, id);
    });
    // Touch events are only for long-press context menus. Swipe-to-reply is handled
    // exactly once by Pointer Events below; keeping two reply handlers here caused
    // duplicate reply UI updates on modern Android WebView.
    let pressTimer = null, startX = 0, startY = 0, touchMessageId = null;
    const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
    msgHost.addEventListener('touchstart', e => {
      const id = msgId(e.target);
      if (!id || e.touches.length !== 1 || e.target.closest('button,a,input,textarea,video,audio,select')) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      touchMessageId = id;
      cancelPress();
      pressTimer = setTimeout(() => {
        if (!touchMessageId) return;
        navigator.vibrate?.(10);
        openContextMenu(startX, startY, id);
      }, 450);
    }, { passive: true });
    msgHost.addEventListener('touchend', () => {
      cancelPress();
      touchMessageId = null;
    }, { passive: true });
    msgHost.addEventListener('touchcancel', () => {
      cancelPress();
      touchMessageId = null;
    }, { passive: true });
    msgHost.addEventListener('touchmove', e => {
      const t = e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) cancelPress();
    }, { passive: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.activeChatId) {
      markMessagesRead(S.messageCache.get(S.activeChatId) || []);
    }
  });

  $('message-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  resizeMessageInput();
  $('btn-attach')?.addEventListener('click', () => $('file-input')?.click());
  $('file-input')?.addEventListener('change', async e => {
    const f = e.target.files?.[0];
    await prepareAttachment(f);
    e.target.value = '';
  });
  $('btn-emoji')?.addEventListener('click', () => $('emoji-picker')?.classList.toggle('hidden'));

  const emojiSets = {
    smileys: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾',
    hands: '👋 🤚 🖐️ ✋ 🖖 👌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦿 🦵 🦶 👂 🦻 👃 🧠 🦷 🦴 👀 👁️ 👅 👄 💋 🩸',
    hearts: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤',
    animals: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 🐣 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🦟 🦗 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🦧 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🐓 🦃 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦦 🦥 🐁 🐀 🐿️ 🦔',
    food: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🦴 🌭 🍔 🍟 🍕 🥪 🥙 🧆 🌮 🌯 🥗 🥘 🥫 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 ☕ 🍵 🧃 🥤 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊',
    objects: '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🖲️ 🕹️ 🗜️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 🎞️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ 🧭 ⏱️ ⏲️ ⏰ 🕰️ ⌛ ⏳ 📡 🔋 🔌 💡 🔦 🕯️ 🪔 🧯 🛢️ 💸 💵 💴 💶 💷 💰 💳 💎 ⚖️ 🧰 🔧 🔨 ⚒️ 🛠️ ⛏️ 🔩 ⚙️ 🧱 ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ ⚱️ 🏺 🔮 📿 🧿 💈 ⚗️ 🔭 🔬 🕳️ 💊 💉 🩸 🩹 🩺 🌡️ 🪑 🚽 🚰 🚿 🛁 🛀 🧼 🪒 🧽 🧹 🧺 🧻 🚽',
  };
  qsa('.emoji-tab').forEach(b => b.onclick = () => {
    qsa('.emoji-tab').forEach(x => x.classList.toggle('active', x === b));
    const grid = $('emoji-grid');
    if (grid) grid.innerHTML = (emojiSets[b.dataset.cat] || '').split(' ').map(e => `<button type="button">${e}</button>`).join('');
    qsa('#emoji-grid button').forEach(btn => btn.onclick = () => {
      const i = $('message-input');
      if (i) { i.value += btn.textContent; i.focus(); i.dispatchEvent(new Event('input')); }
    });
  });
  qsa('.emoji-tab.active')[0]?.click();

  // Sidebar buttons
  $('btn-new-chat')?.addEventListener('click', startNewPrivateChat);
  $('btn-new-group')?.addEventListener('click', openGroupModal);
  $('btn-stories')?.addEventListener('click', () => {
    $('stories-bar')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  qsa('.modal-close').forEach(b => b.addEventListener('click', () => b.closest('.modal')?.classList.add('hidden')));
  $('btn-close-admin')?.addEventListener('click', closeAdminPanel);

  // Profile
  $('btn-change-avatar')?.addEventListener('click', () => $('avatar-input')?.click());
  $('btn-change-cover')?.addEventListener('click', () => $('profile-cover-input')?.click());
  $('profile-cover-input')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) changeCover(f);
  });
  $('avatar-input')?.addEventListener('change', e => changeAvatar(e.target.files?.[0]));
  $('btn-save-profile')?.addEventListener('click', saveProfile);

  // Settings: application theme and chat wallpaper are independent preferences.
  qsa('.theme-option').forEach(b => b.addEventListener('click', () => {
    if (!APP_THEMES.includes(b.dataset.theme)) return;
    S.localTheme = b.dataset.theme;
    applyLocalPreferences();
    toast(`تم تطبيق ثيم ${b.querySelector('span')?.textContent || b.dataset.theme}.`, 'success', 1800);
  }));
  qsa('[data-wp]').forEach(b => b.addEventListener('click', () => {
    if (!CHAT_WALLPAPERS.includes(b.dataset.wp)) return;
    S.localWallpaper = b.dataset.wp;
    applyLocalPreferences();
  }));
  qsa('#settings-view input[type="checkbox"]').forEach(i => i.addEventListener('change', async () => {
    if (i.id === 'opt-pin') {
      if (i.checked) {
        $('pin-change-group')?.classList.remove('hidden');
        $('btn-save-pin')?.classList.remove('hidden');
      } else {
        clearLocalPin();
        $('pin-change-group')?.classList.add('hidden');
        $('btn-save-pin')?.classList.add('hidden');
      }
      return;
    }
    if (i.id === 'opt-notifications' && i.checked) {
      const perm = await requestNotificationPermission();
      if (perm === 'denied' || perm === 'unsupported' || perm === 'error') {
        toast(perm === 'unsupported' ? 'متصفحك لا يدعم الإشعارات.' : 'لم يتم منح إذن الإشعارات.', 'error', 5000);
        i.checked = false;
        return;
      }
    }
    await saveSettings();
  }));
  $('btn-save-pin')?.addEventListener('click', async () => {
    try {
      await setLocalPin($('pin-input').value);
      $('pin-input').value = '';
      toast('تم حفظ PIN.', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  $('btn-export')?.addEventListener('click', exportMyChats);
  $('btn-clear-local')?.addEventListener('click', clearLocalData);

  // Chat search
  $('search-chats')?.addEventListener('input', e => filterChatList(e.target.value));
  qsa('.chat-tab').forEach(b => b.onclick = () => filterChatTab(b.dataset.ctab));
  $('chat-search-input')?.addEventListener('input', e => searchMessages(e.target.value));
  $('chat-search-close')?.addEventListener('click', () => {
    $('chat-search-bar')?.classList.add('hidden');
    const i = $('chat-search-input');
    if (i) i.value = '';
    searchMessages('');
  });
  $('btn-chat-search')?.addEventListener('click', () => $('chat-search-bar')?.classList.toggle('hidden'));

  $('btn-back')?.addEventListener('click', closeActiveChat);

  $('chat-info-clickable')?.addEventListener('click', async () => {
    if (S.activeChat?.type === 'private') {
      const target = otherParticipant(S.activeChat);
      if (target) return openUserProfile(target);
    }
    return openChatInfo();
  });
  $('chat-avatar')?.addEventListener('click', async () => {
    if (S.activeChat?.type === 'private') {
      const target = otherParticipant(S.activeChat);
      if (target) return openUserProfile(target);
    }
    return openChatInfo();
  });

  // زر النقاط الثلاث (⋮) — مُصلح بحساب موضع دقيق
  $('btn-chat-menu')?.addEventListener('click', e => {
    e.stopPropagation();
    const menu = $('chat-menu'), btn = $('btn-chat-menu');
    if (!menu || !btn) return;
    if (!menu.classList.contains('hidden')) return menu.classList.add('hidden');

    menu.style.visibility = 'hidden';
    menu.style.position = 'fixed';
    menu.style.top = '-9999px';
    menu.style.right = '8px';
    menu.style.left = 'auto';
    menu.classList.remove('hidden');

    const w = menu.offsetWidth || 220;
    const h = menu.offsetHeight || 370;
    const r = btn.getBoundingClientRect();
    const margin = 8;

    let right = window.innerWidth - r.right;
    right = Math.max(margin, Math.min(right, window.innerWidth - w - margin));

    let top = r.bottom + 6;
    if (top + h > window.innerHeight - margin) top = r.top - h - 6;
    if (top < margin) top = margin;

    menu.style.top = top + 'px';
    menu.style.right = right + 'px';
    menu.style.visibility = '';
  });

  $('reply-cancel')?.addEventListener('click', () => { S.currentReply = null; updateReplyEditUI(); });
  $('edit-cancel')?.addEventListener('click', cancelEdit);

  qsa('#context-menu [data-action]').forEach(b => b.onclick = () => contextAction(b.dataset.action));
  qsa('#reaction-picker [data-reaction]').forEach(b => b.onclick = () => addReaction(b.dataset.reaction));
  qsa('#chat-menu [data-action]').forEach(b => b.onclick = () => chatMenuAction(b.dataset.action));

  // Story composer
  $('story-pick-image')?.addEventListener('click', () => $('story-image-input')?.click());
  $('story-image-input')?.addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('اختر صورة فقط.', 'error');
    if (f.size > MAX_FILE_BYTES * 2) return toast('الصورة كبيرة جداً.', 'error');
    try {
      const dataUrl = await compressImage(f, 1080, .78);
      if (dataUrl.length > MAX_DATA_URL_LENGTH) return toast('بعد الضغط الصورة كبيرة جداً.', 'error');
      S.storyDraft.imageDataUrl = dataUrl;
      renderStoryComposer();
    } catch {
      toast('تعذر تجهيز الصورة.', 'error');
    }
  });
  $('story-clear-image')?.addEventListener('click', () => {
    if (S.storyDraft) S.storyDraft.imageDataUrl = null;
    renderStoryComposer();
  });
  $('story-text-input')?.addEventListener('input', e => {
    if (S.storyDraft) S.storyDraft.text = e.target.value;
    renderStoryComposer();
  });
  qsa('.story-color').forEach(b => b.addEventListener('click', () => {
    if (S.storyDraft) S.storyDraft.textColor = b.dataset.color;
    renderStoryComposer();
  }));
  qsa('.story-size').forEach(b => b.addEventListener('click', () => {
    if (S.storyDraft) S.storyDraft.fontSize = b.dataset.size;
    renderStoryComposer();
  }));
  $('story-publish')?.addEventListener('click', publishStory);

  // Story viewer
  $('story-close')?.addEventListener('click', closeStory);
  $('story-next')?.addEventListener('click', nextStory);
  $('story-prev')?.addEventListener('click', prevStory);
  $('story-report')?.addEventListener('click', reportStory);
  $('story-views-btn')?.addEventListener('click', showStoryViewers);
  $('story-reply-btn')?.addEventListener('click', storyReply);
  $('story-reply-send-bar')?.addEventListener('click', sendStoryReplyFromBar);
  $('story-reply-text')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); sendStoryReplyFromBar(); }
  });
  $('story-emoji-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    const picker = $('story-emoji-picker');
    if (!picker) return;
    if (picker.classList.contains('hidden')) {
      const emojis = '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😛 😜 🤪 😝 🤗 🤭 🤔 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤢 🤮 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😢 😭 😱 😞 😓 😩 😫 😤 😡 😠 🤬 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💕 💞 💓 💗 💖 💘 💝 👍 👎 👌 ✌️ 🤞 🤘 🤙 👏 🙌 👐 🤝 🙏 🔥 💯 ✨ ⭐ 🌟'.split(' ');
      picker.innerHTML = emojis.map(e => `<button type="button">${e}</button>`).join('');
      picker.querySelectorAll('button').forEach(b => b.onclick = () => {
        const input = $('story-reply-text');
        if (input) { input.value += b.textContent; input.focus(); }
      });
      picker.classList.remove('hidden');
    } else {
      picker.classList.add('hidden');
    }
  });

  // Story hold-to-pause
  const storyContent = $('story-content');
  storyContent?.addEventListener('pointerdown', () => pauseStory());
  storyContent?.addEventListener('pointerup', () => resumeStory());
  storyContent?.addEventListener('pointerleave', () => resumeStory());
  storyContent?.addEventListener('pointercancel', () => resumeStory());
  $('story-prev')?.addEventListener('pointerdown', pauseStory);
  $('story-next')?.addEventListener('pointerdown', pauseStory);
  $('story-prev')?.addEventListener('pointerup', resumeStory);
  $('story-next')?.addEventListener('pointerup', resumeStory);

  // Group creator
  $('btn-create-group')?.addEventListener('click', createGroup);
  $('group-ban-confirm')?.addEventListener('click', applyGroupBan);
  $('invite-join-btn')?.addEventListener('click', joinInviteGroup);
  $('group-search')?.addEventListener('input', e => loadGroupUsers(e.target.value));

  // Message swipe-to-reply: both directions, horizontal intent only, one reply per gesture.
  if (msgHost && window.PointerEvent) {
    let gesture = null;
    const finishGesture = (commit) => {
      if (!gesture) return;
      const g = gesture;
      g.message?.classList.remove('swipe-reply-armed');
      if (g.message) g.message.style.removeProperty('--swipe-offset');
      gesture = null;
      if (!commit || !g.armed || Math.abs(g.lastX - g.startX) < 58) return;
      const message = S.messageCache.get(S.activeChatId)?.find(item => item.id === g.messageId);
      if (!message) return;
      S.currentReply = message;
      S.currentEdit = null;
      updateReplyEditUI();
      navigator.vibrate?.(15);
      const input = $('message-input');
      if (input) { input.focus({ preventScroll: true }); }
    };
    msgHost.addEventListener('pointerdown', event => {
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (event.target?.closest?.('button,a,input,textarea,select,video,audio,[contenteditable="true"]')) return;
      const message = event.target?.closest?.('.message[data-id]');
      if (!message || !S.activeChatId) return;
      gesture = { message, messageId: message.dataset.id, startX: event.clientX, startY: event.clientY, lastX: event.clientX, armed: false, pointerId: event.pointerId };
    }, { passive: true });
    document.addEventListener('pointermove', event => {
      if (!gesture || (gesture.pointerId != null && event.pointerId !== gesture.pointerId)) return;
      const dx = event.clientX - gesture.startX;
      const dy = Math.abs(event.clientY - gesture.startY);
      gesture.lastX = event.clientX;
      if (Math.abs(dx) < 10 || Math.abs(dx) < dy * 1.25) return;
      gesture.message.style.setProperty('--swipe-offset', `${Math.max(-40, Math.min(40, dx * .22))}px`);
      if (Math.abs(dx) >= 58 && !gesture.armed) {
        gesture.armed = true;
        gesture.message.classList.add('swipe-reply-armed');
      } else if (Math.abs(dx) < 58 && gesture.armed) {
        gesture.armed = false;
        gesture.message.classList.remove('swipe-reply-armed');
      }
    }, { passive: true });
    document.addEventListener('pointerup', event => { if (gesture && event.pointerId === gesture.pointerId) finishGesture(true); }, { passive: true });
    document.addEventListener('pointercancel', event => { if (gesture && event.pointerId === gesture.pointerId) finishGesture(false); }, { passive: true });
  }
  if (isOwner()) {
    let ct = null;
    $('chat-list')?.addEventListener('touchstart', e => {
      const item = e.target.closest('.chat-item');
      if (!item || item.dataset.requestChat) return;
      ct = setTimeout(() => openChatMonitor(item.dataset.id), 700);
    }, { passive: true });
    $('chat-list')?.addEventListener('touchend', () => clearTimeout(ct), { passive: true });
    $('chat-list')?.addEventListener('touchmove', () => clearTimeout(ct), { passive: true });
  }

  // Global clicks
  document.addEventListener('click', e => {
    if (!e.target.closest('#context-menu') && !e.target.closest('.message')) closeContext();
    if (!e.target.closest('#chat-menu') && !e.target.closest('#btn-chat-menu')) $('chat-menu')?.classList.add('hidden');
  });

  // Role change / verify checkboxes (delegated)
  document.addEventListener('change', async e => {
    const role = e.target.closest('[data-role-user]');
    if (role) {
      const target = (S.adminUsers || []).find(x => x.id === role.dataset.roleUser);
      if (!target) return;
      const value = role.value;
      if (value === target.role) return;
      const ok = await adminSetRole(target, value);
      if (!ok) role.value = target.role;
      return;
    }
    const v = e.target.closest('[data-verify-user]');
    if (v) {
      const target = (S.adminUsers || []).find(x => x.id === v.dataset.verifyUser);
      if (!target) return;
      if (!isAdmin() || target.role === 'owner') { v.checked = !v.checked; return; }
      try {
        await db.ref(`profiles/${target.id}/verified`).set(v.checked);
        await writeAudit('verify_changed', target.id, { verified: v.checked });
        toast('تم تحديث التوثيق.', 'success');
      } catch (err) {
        v.checked = !v.checked;
        toast(firebaseErrorMessage(err), 'error');
      }
    }
  });

  document.addEventListener('click', async e => {
    const ban = e.target.closest('[data-quick-ban]');
    if (ban) {
      const u = (S.adminUsers || []).find(x => x.id === ban.dataset.quickBan);
      if (u) await adminBanUser(u);
      return;
    }
    const unban = e.target.closest('[data-quick-unban]');
    if (unban) {
      const u = (S.adminUsers || []).find(x => x.id === unban.dataset.quickUnban);
      if (u) await adminUnbanUser(u);
    }
  });

  window.addEventListener('beforeunload', () => {
    if (uid()) {
      db.ref(`presence/${uid()}`).set({
        online: false,
        lastSeen: SERVER,
        showOnline: S.me?.showOnline !== false,
        showLastSeen: S.me?.showLastSeen !== false
      }).catch(() => {});
    }
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModals();
      closeContext();
      closeStory();
      $('chat-menu')?.classList.add('hidden');
    }
    if (!$('story-viewer')?.classList.contains('hidden')) {
      if (e.key === 'ArrowRight') prevStory();
      if (e.key === 'ArrowLeft') nextStory();
    }
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) {
      $('sidebar')?.classList.remove('open');
      $('sidebar')?.classList.remove('mobile-hidden');
    } else if (!S.activeChatId) {
      $('sidebar')?.classList.add('open');
    }
  });
}

function filterChatList(query) {
  S.chatQuery = String(query || '');
  scheduleChatListRender();
}

function filterChatTab(tab) { setChatTab(tab); }

async function openChatBackgroundPicker() {
  if (!S.activeChatId) return;
  openView('chat-background-modal');
  qsa('[data-chat-bg]').forEach(b => b.onclick = () => setChatBackground(b.dataset.chatBg));
}

async function setChatBackground(value) {
  if (!S.activeChatId) return;
  try {
    const c = S.activeChat, actor = c.participants?.[uid()], canGlobal = isOwner() || isAdmin() || actor?.role === 'admin';
    const updates = {};
    if (canGlobal) updates[`chats/${c.id}/background`] = value === 'default' ? null : value;
    else updates[`chats/${c.id}/backgrounds/${uid()}`] = value;
    await db.ref().update(updates);
    c.background = canGlobal ? (value === 'default' ? null : value) : c.background;
    applyChatBackground();
    closeModals();
    toast('تم تغيير الخلفية.', 'success');
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

function applyChatBackground() {
  const el = $('messages-container'), c = S.activeChat;
  if (!el || !c) return;
  const v = c.background || c.backgrounds?.[uid()] || '';
  el.style.background = v === 'default' || !v ? '' : v;
}

async function chatMenuAction(action) {
  $('chat-menu')?.classList.add('hidden');
  if (action === 'background') return openChatBackgroundPicker();
  if (action === 'pin') return pinChat();
  if (action === 'mute') return muteChat();
  if (action === 'archive') return archiveChat();
  if (action === 'export-chat') return exportSingleChat();
  if (action === 'clear-chat') return clearChatForMe();
  if (action === 'delete-chat-for-me') return deleteChatForMe();
  if (action === 'block') return blockChatUser();
  if (action === 'contact') {
    const t = S.activeChat?.type === 'private' && Object.keys(S.activeChat.participants || {}).find(x => x !== uid());
    if (t) {
      await db.ref(`users/${uid()}/contacts/${t}`).set(true);
      S.contacts.add(t);
      toast('تمت إضافة جهة الاتصال.', 'success');
    }
  }
}

async function exportSingleChat() {
  if (!S.activeChatId) return;
  const data = { chat: S.activeChat, messages: S.messageCache.get(S.activeChatId) || [] };
  const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  await saveBlobAsDownload(b, `chat-${S.activeChatId}.json`);
}

async function addReaction(reaction) {
  const id = S.contextMessageId;
  if (!id || !S.activeChatId) return;
  try {
    const path = `messages/${S.activeChatId}/${id}/reactions/${uid()}`;
    const cur = (await db.ref(path).once('value')).val();
    await db.ref(path).set(cur === reaction ? null : reaction);
    closeContext();
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}

/* ==================== Downloads (Web + Android) ==================== */
async function saveBlobAsDownload(blob, filename) {
  const safeName = String(filename || 'ghostcaffee-download').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);
  // Android bridge writes through MediaStore on modern Android and app-specific
  // Downloads on older versions. Browsers continue using a regular blob URL.
  try {
    if (typeof AndroidBridge !== 'undefined' && typeof AndroidBridge.saveDataUrl === 'function') {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('تعذر قراءة الملف'));
        reader.readAsDataURL(blob);
      });
      if (dataUrl.startsWith('data:')) {
        const saved = AndroidBridge.saveDataUrl(safeName, blob.type || 'application/octet-stream', dataUrl);
        if (saved) return true;
        toast('تعذّر حفظ الملف على الجهاز.', 'error');
        return false;
      }
    }
  } catch (e) {
    console.warn('Native save failed; falling back to browser download:', e);
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}

function installAndroidDownloadHandler() {
  // File attachments are stored as data URLs by this RTDB-only app. On Android,
  // intercept explicit download links and save through MediaStore instead of a
  // browser blob/download implementation that WebView may not support.
  document.addEventListener('click', event => {
    const link = event.target?.closest?.('a[download]');
    if (!link || typeof AndroidBridge === 'undefined' || typeof AndroidBridge.saveDataUrl !== 'function') return;
    const dataUrl = String(link.href || '');
    if (!dataUrl.startsWith('data:')) return;
    const mime = (dataUrl.match(/^data:([^;,]+)/i) || [])[1] || 'application/octet-stream';
    try {
      const saved = AndroidBridge.saveDataUrl(link.getAttribute('download') || 'Ghost Caffee-download', mime, dataUrl);
      event.preventDefault();
      if (!saved) toast('تعذّر حفظ المرفق على الجهاز.', 'error');
    } catch (e) { console.warn('Android file save failed:', e); }
  });
}

/* ==================== Offline authenticated session ==================== */
async function activateCachedAccountSession(user, options = {}) {
  if (!user?.uid) return false;
  const record = await readCachedState('account', user.uid);
  if (!record?.me || record.me.registrationComplete !== true || record.me.id !== user.uid) return false;
  if (record.me.status === 'banned' || record.me.status === 'deleted') {
    S.pendingAuthError = record.me.status === 'banned'
      ? `الحساب محظور: ${record.me.banReason || 'راجع إدارة التطبيق'}`
      : 'هذا الحساب محذوف.';
    setAuthError(S.pendingAuthError);
    return false;
  }
  resetAccountScopedMemory(user.uid);
  S.me = record.me;
  S.activeUid = user.uid;
  S.initializedForUid = user.uid;
  S.contacts = new Set(record.contacts || Object.keys(record.me.contacts || {}));
  S.blocked = new Set(record.blocked || Object.keys(record.me.blocked || {}));
  S.me.storyViewed = record.storyViewed || S.me.storyViewed || {};
  S.userCache.set(user.uid, S.me);
  const configRecord = await readCachedState('config', user.uid);
  if (configRecord?.appConfig) S.appConfig = configRecord.appConfig;
  if (configRecord?.ownerUid) S.ownerUid = configRecord.ownerUid;
  S.offlineMode = true;
  loadSettingsUI();
  await restoreOfflineCollections(user.uid);
  // A locally configured PIN remains required even when Firebase is unavailable.
  if (!showPinLock()) enterApp();
  if (options.cacheFirst === true) {
    toast('تم فتح بياناتك المحفوظة؛ جارٍ التحقق من الاتصال وتحديثها.', 'info', 4200);
  } else {
    toast('وضع عدم الاتصال: عُرضت بياناتك المحفوظة على هذا الجهاز. الإرسال والتعديلات ستتوفر بعد عودة الاتصال.', 'info', 6000);
  }
  return true;
}

async function refreshCachedSessionAfterReconnect() {
  if (S.reconnectCheckInProgress || !S.offlineMode || !uid() || S.dbConnected === false) return;
  S.reconnectCheckInProgress = true;
  const currentUid = uid();
  try {
    const snap = await withDeadline(db.ref(`users/${currentUid}`).once('value'), 7000, 'reconnect account validation');
    if (!snap.exists()) throw new Error('لم يعد الحساب متاحاً.');
    const account = snap.val() || {};
    if (account.status === 'banned' || account.status === 'deleted') {
      S.pendingAuthError = account.status === 'banned' ? `الحساب محظور: ${account.banReason || 'بدون سبب'}` : 'هذا الحساب محذوف.';
      await auth.signOut();
      return;
    }
    const ok = await loadCurrentAccount();
    if (!ok) return;
    await loadConfig().catch(() => {});
    S.offlineMode = false;
    if (S.reconnectRetryTimer) { clearTimeout(S.reconnectRetryTimer); S.reconnectRetryTimer = null; }
    loadSettingsUI();
    renderOwnIdentity();
    renderProfileModal();
    if (S.activeChatId) setMessageInputPreviewState(S.activeChatId, false);
    toast('عاد الاتصال؛ تمت مزامنة الحساب ويمكنك المتابعة.', 'success', 3500);
  } catch (error) {
    console.warn('[Ghost Caffee] Offline session remains read-only until validation succeeds:', error?.code || error);
  } finally {
    S.reconnectCheckInProgress = false;
    // Retry validation only while RTDB reports a live connection. This avoids
    // turning a temporary read timeout into a permanently cached/read-only session.
    if (S.offlineMode && S.dbConnected === true && uid() === currentUid) {
      if (S.reconnectRetryTimer) clearTimeout(S.reconnectRetryTimer);
      S.reconnectRetryTimer = setTimeout(() => { void refreshCachedSessionAfterReconnect(); }, 5000);
    }
  }
}

/* ==================== Init auth ==================== */
async function initializeAuthenticatedUser(user, options = {}) {
  const allowDuringRegistration = options.allowDuringRegistration === true;
  // Do not silently destroy a legacy anonymous identity on transient errors: it may own existing chats.
  const maySignOutOnFailure = !user?.isAnonymous;
  const signOutOnFailure = async () => { if (maySignOutOnFailure) await auth.signOut().catch(() => {}); };
  if (!user || (S.registrationInProgress && !allowDuringRegistration) || S.sessionInitInProgress) return false;
  if (S.initializedForUid === user.uid) return true;
  resetAccountScopedMemory(user.uid);
  S.sessionInitInProgress = true;
  S.activeUid = user.uid;
  S.offlineMode = false;
  S.offlineStateRestoredUid = null;
  // لا نُسجّل initializedForUid إلا بعد النجاح الكامل
  try {
    // Cache-first startup: a previously validated Firebase session with a valid local
    // account snapshot opens immediately from IndexedDB. Live account validation and
    // data refresh then run through the .info/connected listener after the UI is up.
    // New accounts and incomplete registrations still take the normal online path.
    if (!allowDuringRegistration && !user.isAnonymous) {
      const cachedAccount = await readCachedState('account', user.uid).catch(() => null);
      if (cachedAccount?.me?.registrationComplete === true && cachedAccount.me.id === user.uid) {
        if (await activateCachedAccountSession(user, { cacheFirst: true })) return true;
      }
    }

    let uSnap;
    try {
      uSnap = await withDeadline(db.ref(`users/${user.uid}`).once('value'), 3600, 'account validation');
    } catch (e) {
      if (await activateCachedAccountSession(user)) return true;
      S.pendingAuthError = `تعذر قراءة ملف الحساب: ${firebaseErrorMessage(e)}. يلزم اتصال أولي ناجح حتى تُنشأ نسخة محلية.`;
      setAuthError(S.pendingAuthError);
      await signOutOnFailure();
      return false;
    }
    if (!uSnap?.exists()) {
      // Some RTDB WebView/offline states resolve an uncached read as an empty snapshot
      // instead of rejecting. A previously validated account snapshot remains usable read-only.
      if (await activateCachedAccountSession(user)) return true;
      S.pendingAuthError = 'تم تسجيل الدخول لكن لا يوجد ملف حساب في قاعدة البيانات.';
      setAuthError(S.pendingAuthError);
      await signOutOnFailure();
      return false;
    }
    const raw = uSnap.val() || {};
    if (raw.registrationComplete !== true) {
      await cleanupIncompleteRegistration(user.uid, normalizeUsername(raw.username || ''));
      S.pendingAuthError = 'كان إنشاء الحساب غير مكتمل وتم تنظيفه.';
      setAuthError(S.pendingAuthError);
      await signOutOnFailure();
      return false;
    }
    const ok = await loadCurrentAccount();
    if (!ok) {
      if (await activateCachedAccountSession(user)) return true;
      S.pendingAuthError = 'تعذر تحميل ملف الحساب.';
      setAuthError(S.pendingAuthError);
      await signOutOnFailure();
      return false;
    }
    await loadConfig({ strict: true });
    await bootstrapOwnerIfNeeded();
    await loadCurrentAccount();

    if (S.me.status === 'banned') {
      S.pendingAuthError = `الحساب محظور: ${S.me.banReason || 'بدون سبب'}`;
      setAuthError(S.pendingAuthError);
      await signOutOnFailure();
      return false;
    }
    if (S.me.status === 'deleted') {
      S.pendingAuthError = 'هذا الحساب محذوف.';
      setAuthError(S.pendingAuthError);
      await signOutOnFailure();
      return false;
    }
    const settings = S.me.settings || {};
    if (settings.showLastSeen === undefined || settings.showOnline === undefined) {
      const repaired = {
        notifications: true, sounds: true, readReceipts: true,
        showLastSeen: S.me.showLastSeen !== false,
        showOnline: S.me.showOnline !== false,
        ...settings
      };
      await db.ref(`users/${user.uid}/settings`).set(repaired).catch(() => {});
      S.me.settings = repaired;
    }
    loadSettingsUI();
    S.initializedForUid = user.uid;   // ← بعد النجاح الكامل
    if (showPinLock()) return true;
    enterApp();
    return true;
  } catch (e) {
    if (await activateCachedAccountSession(user)) return true;
    S.initializedForUid = null;
    S.activeUid = null;
    S.sessionInitInProgress = false;
    throw e;
  } finally {
    S.sessionInitInProgress = false;
  }
}

async function onAuthState(user) {
  if (S.registrationInProgress) return;
  if (!user) {
    const pendingError = S.pendingAuthError;
    S.pendingAuthError = null;
    detachRealtime();
    S.me = null;
    S.activeUid = null;
    S.activeChatId = null;
    S.activeChat = null;
    S.initializedForUid = null;
    S.sessionInitInProgress = false;
    $('app-screen')?.classList.add('hidden');
    $('pin-screen')?.classList.add('hidden');
    $('splash-screen')?.classList.add('hidden');
    $('auth-screen')?.classList.remove('hidden');
    $('sidebar')?.classList.remove('open');
    setAuthTab(localStorage.getItem('ghostcaffee_has_account') ? 'login' : 'register');
    if (pendingError) setAuthError(pendingError);
    return;
  }

  // Compatibility: existing anonymous sessions from earlier Ghost Caffee builds remain accessible and can be secured from the side menu.
  // New accounts are username/password credentials and no anonymous identity is created on startup.
  if (user.isAnonymous) {
    try {
      const userSnap = await db.ref(`users/${user.uid}`).once('value');
      if (!userSnap.exists() || userSnap.val()?.registrationComplete !== true) {
        showAuthScreen('', 'register');
        return;
      }
    } catch (e) {
      showAuthScreen(`تعذر قراءة الحساب السابق: ${firebaseErrorMessage(e)}`, 'login');
      return;
    }
  }
  try {
    const ok = await initializeAuthenticatedUser(user);
    if (!ok) {
      const message = S.pendingAuthError || 'تعذر فتح الحساب. حاول تسجيل الدخول مجدداً.';
      if (user.isAnonymous) showAuthScreen(message, 'register');
      else showAuthScreen(message, 'login');
    } else {
      localStorage.setItem('ghostcaffee_has_account', '1');
    }
  } catch (e) {
    const msg = e?.code === 'database/permission-denied' || e?.code === 'PERMISSION_DENIED'
      ? 'رفضت قاعدة Realtime Database قراءة ملف الحساب. تأكد من نشر القواعد الصحيحة ومن مصادقة المستخدم.'
      : firebaseErrorMessage(e);
    S.pendingAuthError = msg;
    S.initializedForUid = null;
    S.activeUid = null;
    S.me = null;
    showAuthScreen(msg, user.isAnonymous ? 'register' : 'login');
  }
}
function showDeviceHint() {
  const el = $('device-info-reg');
  if (el) el.textContent = 'حسابك باسم المستخدم وكلمة المرور؛ يمكنك تسجيل الدخول من جهاز آخر بالبيانات نفسها.';
}
/* ==================== Service Worker + Notifications ==================== */
let swRegistration = null;

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] Not supported');
    return;
  }
  try {
    swRegistration = await navigator.serviceWorker.register('sw.js', { scope: './' });
    console.log('[SW] Registered');

// استمع لرسائل من SW
navigator.serviceWorker.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'open-chat' && data.chatId) {
    openChat(data.chatId);
    return;
  }
  if (data.type === 'quick-reply' && data.chatId && data.text) {
    sendQuickReply(data.chatId, data.text);
    return;
  }
  if (data.type === 'quick-action' && data.action) {
    void handleQuickAction(data);
  }
});
    // عند فتح الرابط بـ #chat=ID → افتح المحادثة
    handleChatHashParam();
    window.addEventListener('hashchange', handleChatHashParam);
  } catch (e) {
    console.warn('[SW] Registration failed:', e);
  }
}
/**
 * معالجة الإجراءات السريعة من إشعارات النظام
 */
async function handleQuickAction(data) {
  try {
    if (data.action === 'accept-request' && data.chatId && data.senderId) {
      await handleChatRequest(data.chatId, data.senderId, 'approve');
      return;
    }
    if (data.action === 'reject-request' && data.chatId && data.senderId) {
      await handleChatRequest(data.chatId, data.senderId, 'reject');
      return;
    }
    if (data.action === 'open-story' && data.senderId) {
      const g = S.storyGroups.find(x => x.userId === data.senderId);
      if (g) { openStoryGroup(data.senderId, 0); }
      else { toast('لا توجد قصة متاحة من هذا المستخدم.', 'info'); }
      return;
    }
    if (data.action === 'open-profile' && data.senderId) {
      openUserProfile(data.senderId);
      return;
    }
  } catch (e) {
    toast(firebaseErrorMessage(e), 'error');
  }
}
/**
 * إرسال رد سريع من إشعار النظام دون فتح المحادثة
 */
async function sendQuickReply(chatId, text) {
  console.log('[quickReply] Called with:', { chatId, text, uid: uid(), hasMe: !!S.me });

  if (!chatId || !text) {
    console.warn('[quickReply] Missing chatId or text');
    return;
  }
  if (!uid() || !S.me) {
    console.warn('[quickReply] User not ready yet');
    // احفظ للتنفيذ لاحقاً
    S.pendingQuickReply = { chatId, text };
    try { sessionStorage.setItem('ghostcaffee_pending_reply', JSON.stringify({ chatId, text })); } catch {}
    return;
  }

  const cleanText = String(text).trim().slice(0, 4000);
  if (!cleanText) return;

  try {
    // اقرأ المحادثة الحية
    const snap = await db.ref(`chats/${chatId}`).once('value');
    if (!snap.exists()) {
      console.error('[quickReply] Chat not found:', chatId);
      toast('المحادثة غير متاحة.', 'error');
      return;
    }
    const chat = { ...snap.val(), id: chatId };
    console.log('[quickReply] Chat loaded:', {
      id: chatId,
      type: chat.type,
      participants: Object.keys(chat.participants || {}),
      requestState: chat.requestState
    });

    // فحوصات أمان
    if (!chat.participants?.[uid()]) {
      console.error('[quickReply] User not in chat');
      toast('لم تعد عضواً في هذه المحادثة.', 'error');
      return;
    }
    if (chat.blocked?.[uid()] === true) {
      toast('أنت محظور من هذه المجموعة.', 'error');
      return;
    }
    const mePart = chat.participants[uid()] || {};
    if (mePart.bannedUntil && Number(mePart.bannedUntil) > now()) {
      toast('أنت محظور مؤقتاً.', 'error');
      return;
    }
    if (chat.type === 'private') {
      if (chat.requestState === 'pending') { toast('المحادثة بانتظار الموافقة.', 'error'); return; }
      if (chat.requestState === 'rejected') { toast('تم رفض طلب المراسلة.', 'error'); return; }
      const targetUid = otherParticipant(chat);
      if (targetUid && S.blocked.has(targetUid)) { toast('هذا المستخدم محظور لديك.', 'error'); return; }
    }

    // جهّز الرسالة
    const id = db.ref(`messages/${chatId}`).push().key;
    const rec = { senderId: uid(), timestamp: SERVER, status: 'sent', type: 'text', text: cleanText };
    const preview = cleanText.slice(0, 500);
    const updates = {};
    updates[`messages/${chatId}/${id}`] = rec;
    updates[`chats/${chatId}/lastMessage`] = { senderId: uid(), text: preview, type: 'text' };
    updates[`chats/${chatId}/updatedAt`] = SERVER;

    const activeParticipants = Object.keys(chat.participants).filter(
      x => x && x !== uid() && chat.participants[x]?.role
    );
    activeParticipants.forEach(target => {
      updates[`chats/${chatId}/unreadCount/${target}`] = firebase.database.ServerValue.increment(1);
      makeNotification(target, 'message', 'رسالة جديدة', `${S.me.username}: ${preview}`, updates);
    });

    console.log('[quickReply] Sending updates...');
    await db.ref().update(updates);
    console.log('[quickReply] ✅ Sent successfully');

    toast('✅ تم إرسال الرد السريع.', 'success', 2500);
    notifyTone('message');

    // إن كانت المحادثة مغلقة → افتحها لعرض الرد
    if (S.activeChatId !== chatId) {
      openChat(chatId);
    }
  } catch (e) {
    console.error('[quickReply] ❌ Failed:', {
      code: e?.code,
      message: e?.message,
      chatId,
      me: uid()
    });
    toast(firebaseErrorMessage(e) || 'تعذر إرسال الرد السريع.', 'error', 5000);
  }
}
/* ============ Pending Quick Reply ============ */

/**
 * يقرأ pending_reply من URL أو sessionStorage
 * يُستدعى مرة واحدة عند بدء التطبيق (في init)
 */
function readPendingReply() {
  // 1) جرّب URL أولاً
  try {
    const params = new URLSearchParams(location.search);
    const raw = params.get('pending_reply');
    if (raw) {
      const data = JSON.parse(decodeURIComponent(raw));
      if (data && data.chatId && data.text) {
        S.pendingQuickReply = data;
        // احفظ في sessionStorage للاستمرارية
        try { sessionStorage.setItem('ghostcaffee_pending_reply', JSON.stringify(data)); } catch {}
        // نظّف URL
        params.delete('pending_reply');
        const cleanSearch = params.toString();
        history.replaceState(null, '', location.pathname + (cleanSearch ? '?' + cleanSearch : ''));
      }
    }
  } catch (e) {
    console.warn('[pendingReply] URL parse failed:', e);
  }

  // 2) إن لم يُوجد في URL، جرّب sessionStorage
  if (!S.pendingQuickReply) {
    try {
      const stored = sessionStorage.getItem('ghostcaffee_pending_reply');
      if (stored) {
        const data = JSON.parse(stored);
        if (data && data.chatId && data.text) {
          S.pendingQuickReply = data;
        }
      }
    } catch (e) {
      console.warn('[pendingReply] sessionStorage parse failed:', e);
    }
  }
}

/**
 * ينفّذ الرد السريع المعلّق (بعد أن يصبح المستخدم جاهزاً)
 * يُستدعى من enterApp
 */
async function processPendingQuickReply() {
  if (!S.pendingQuickReply || !uid() || !S.me) return;
  const data = S.pendingQuickReply;
  S.pendingQuickReply = null;
  try { sessionStorage.removeItem('ghostcaffee_pending_reply'); } catch {}
  // انتظر قليلاً لتهدئة الواجهة
  await new Promise(r => setTimeout(r, 800));
  console.log('[pendingReply] Sending quick reply:', data);
  await sendQuickReply(data.chatId, data.text);
}

/* ============ Hash Params ============ */

function handleChatHashParam() {
  const hash = location.hash || '';
  if (!hash) return;

  // ============ فتح محادثة ============
  const m = hash.match(/^#chat=(.+)$/);
  if (!m) return;

  const chatId = decodeURIComponent(m[1]);
  history.replaceState(null, '', location.pathname + location.search);

  if (!uid() || !S.me) {
    // احفظ للتنفيذ لاحقاً بعد الدخول
    setTimeout(() => {
      if (uid() && S.me) openChat(chatId);
      else {
        // أعِد المحاولة بعد 2 ثانية
        setTimeout(() => { if (uid() && S.me) openChat(chatId); }, 2000);
      }
    }, 500);
    return;
  }

  setTimeout(() => openChat(chatId), 500);
}

async function requestNotificationPermission() {
  // Android WebView: let the native app request Android 13+ runtime permission.
  try {
    if (typeof AndroidBridge !== 'undefined'
      && typeof AndroidBridge.requestNotificationPermission === 'function') {
      AndroidBridge.requestNotificationPermission();
      // The Android permission dialog is asynchronous. Poll instead of assuming
      // the result after a fixed 350 ms delay.
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        const state = AndroidBridge.getNotificationPermission?.();
        if (state === 'granted' || state === 'denied') return state;
      }
      const finalState = AndroidBridge.getNotificationPermission?.();
      return finalState === 'granted' ? 'granted' : 'denied';
    }
  } catch (e) {
    console.warn('Native notification permission unavailable:', e);
  }

  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try { return await Notification.requestPermission(); }
  catch { return 'error'; }
}

/** Show a real device notification on Android, or use Web Notifications in browsers. */
function showDeviceNotification(opts = {}) {
  // Do not notify for the active conversation while the app is visible.
  if (opts.chatId && S.activeChatId === opts.chatId && !document.hidden) return false;

  try {
    if (typeof AndroidBridge !== 'undefined'
      && typeof AndroidBridge.showNotification === 'function') {
      AndroidBridge.showNotification(
        String(opts.title || 'Ghost Caffee'),
        String(opts.body || ''),
        String(opts.chatId || ''),
        String(opts.notifType || opts.chatType || 'message')
      );
      return true;
    }
  } catch (e) {
    console.warn('Native notification failed; trying web fallback:', e);
  }

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const payload = {
    title: opts.title || 'Ghost Caffee',
    body: opts.body || '',
    chatId: opts.chatId || null,
    chatType: opts.chatType || 'private',
    senderId: opts.senderId || null,
    senderName: opts.senderName || null,
    avatar: opts.avatar || null,
    tag: opts.tag || (opts.chatId ? `chat-${opts.chatId}` : 'ghostcaffee')
  };

  if (swRegistration?.active) {
    try {
      swRegistration.active.postMessage({ type: 'show-notification', payload });
      return true;
    } catch (e) { console.warn('Service Worker notification fallback failed:', e); }
  }

  try {
    new Notification(payload.title, {
      body: payload.body,
      icon: payload.avatar || 'icons/icon-192.png',
      tag: payload.tag,
      requireInteraction: payload.chatType === 'private',
      vibrate: [200, 100, 200]
    });
    return true;
  } catch (e) {
    console.warn('Notification failed:', e);
    return false;
  }
}

/* ==================== Boot ==================== */
(async function init() {
  try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch {}
  requestDurableLocalStorage();
  readPendingReply();
  installAndroidDownloadHandler();
  try { wireEvents(); }
  catch (error) {
    console.error('[Ghost Caffee] UI event wiring error:', error);
    setAuthError('تعذر تفعيل بعض عناصر الواجهة. أعد تحميل التطبيق؛ إن استمرت المشكلة راجع سجل الأخطاء.');
  }
  registerServiceWorker();
  applyLocalPreferences();
  showDeviceHint();
  const st = $('splash-title');
  if (st) st.textContent = 'Ghost Caffee';
  loadConfig().catch(() => {});
  auth.onAuthStateChanged(onAuthState);
})();