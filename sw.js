/*
 * Ghost Caffee Service Worker — v7.4.4
 * ================================
 * - إشعارات غنية (Rich Notifications) مع أيقونات
 * - رد سريع مباشر من الإشعار
 * - تجميع الإشعارات حسب المحادثة
 * - دعم الأنواع المختلفة (رسالة / قصة / طلب / متابعة / حظر)
 * - فتح التطبيق على المحادثة الصحيحة
 * - أصوات واهتزاز مخصص
 * =================================
 */

const SW_VERSION = '7.4.4';
const CACHE_NAME = `ghostcaffee-${SW_VERSION}`;
const ASSET_CACHE_NAME = `${CACHE_NAME}-assets`;
const FONT_CACHE_NAME = `${CACHE_NAME}-fonts`;
const MAX_ASSET_CACHE_ENTRIES = 100;
const MAX_FONT_CACHE_ENTRIES = 24;
const APP_URL = self.location.origin + self.location.pathname.replace(/\/sw\.js$/, '/');

/* ===================================================================
 * 1) التثبيت والتفعيل
 * =================================================================== */
const SHELL_FILES = [
  './index.html', './styles.css?v=7.4.4', './app.js?v=7.4.4', './manifest.json',
  './favicon.ico', './icons/icon-192.png', './icons/icon-512.png', './icons/ghost-caffee-icon.svg', './icons/ghost-coffee-pattern.svg', './icons/brand-wordmark.svg',
  './icons/badge-72.png', './icons/action-open.png', './icons/action-reply.png', './icons/ghost-mark.svg'
];

self.addEventListener('install', event => {
  console.log('[SW] Installing', SW_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .catch(error => console.warn('[SW] Shell precache incomplete:', error))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  console.log('[SW] Activating', SW_VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => (k.startsWith('ghostcaffee-') || k.startsWith('chatapp-')) && k !== CACHE_NAME && k !== ASSET_CACHE_NAME && k !== FONT_CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});


/* ===================================================================
 * Runtime cache: app assets, fonts, and version-pinned Firebase SDK files only.
 * Never cache Firebase Auth/Realtime Database requests or private API responses.
 * =================================================================== */
async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      await Promise.all(keys.slice(0, keys.length - maxEntries).map(key => cache.delete(key)));
    }
  } catch (error) { console.warn('[SW] Cache trim skipped:', cacheName, error); }
}

async function cacheFirstStatic(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  let cached = await cache.match(request);
  // Reuse the precached shell entry instead of storing a duplicate copy in runtime assets.
  if (!cached && cacheName === ASSET_CACHE_NAME) {
    const shell = await caches.open(CACHE_NAME);
    cached = await shell.match(request);
  }
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    try { await cache.put(request, response.clone()); await trimCache(cacheName, maxEntries); } catch (error) {
      console.warn('[SW] Could not persist asset:', request.url, error);
    }
  }
  return response || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }

  // Navigation is network-first so deployments update promptly, with an offline shell fallback.
  const appBase = new URL(APP_URL);
  const insideApp = url.origin === appBase.origin && url.pathname.startsWith(appBase.pathname);
  if (insideApp && request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(request)) || (await cache.match(new URL('./index.html', APP_URL).href)) || Response.error();
      }
    })());
    return;
  }

  // Same-origin shell assets only: never HTML APIs, Firebase traffic, or POST bodies.
  if (insideApp && !url.pathname.endsWith('/sw.js')
      && /\.(?:css|js|mjs|svg|png|jpe?g|webp|ico|json|woff2?|ttf|otf)$/i.test(url.pathname)) {
    event.respondWith(cacheFirstStatic(request, ASSET_CACHE_NAME, MAX_ASSET_CACHE_ENTRIES));
    return;
  }

  // Google Fonts files/stylesheets and the pinned Firebase compatibility SDK are immutable static files.
  const googleFontCss = url.hostname === 'fonts.googleapis.com' && url.pathname === '/css2';
  const googleFontFile = url.hostname === 'fonts.gstatic.com' && /\.(?:woff2?|ttf|otf)$/i.test(url.pathname);
  const pinnedFirebaseSdk = url.hostname === 'www.gstatic.com'
    && /^\/firebasejs\/10\.12\.0\/firebase-(?:app|auth|database)-compat\.js$/.test(url.pathname);
  if (googleFontCss || googleFontFile || pinnedFirebaseSdk) {
    event.respondWith(cacheFirstStatic(request, FONT_CACHE_NAME, MAX_FONT_CACHE_ENTRIES));
  }
});

/* ===================================================================
 * 2) استقبال رسائل من التطبيق
 * =================================================================== */
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'show-notification' && data.payload) {
    showNotification(data.payload);
  }
  if (data.type === 'close-all') {
    self.registration.getNotifications().then(list => list.forEach(n => n.close()));
  }
  if (data.type === 'ping') {
    event.source?.postMessage({ type: 'pong', version: SW_VERSION });
  }
});

/* ===================================================================
 * 3) عرض الإشعار — الدالة الرئيسية
 * =================================================================== */
async function showNotification(payload = {}) {
  const {
    title = 'Ghost Caffee',
    body = '',
    chatId = null,
    chatType = 'private',
    senderId = null,
    senderName = null,
    avatar = null,
    tag,
    notifType = 'message', // message | story | request | follow | ban | system
    badgeCount = null
  } = payload;

  // ============ حدد النوع والأسلوب ============
  const style = styleForType(notifType, chatType);

  // ============ الأيقونات ============
  const iconUrl = avatar || `${APP_URL}icons/icon-192.png`;
  const badgeUrl = `${APP_URL}icons/badge-72.png`;

  // ============ الأفعال (Actions) ============
  const actions = buildActions(notifType, chatType);

  // ============ Tag + renotify ============
  const finalTag = tag || (chatId ? `chat-${chatId}` : `notif-${Date.now()}`);

  // ============ الخيارات النهائية ============
  const options = {
    body,
    icon: iconUrl,
    badge: badgeUrl,
    tag: finalTag,
    renotify: true,               // اهتزاز + صوت مرة أخرى حتى مع نفس الـ tag
    requireInteraction: style.requireInteraction,
    silent: false,
    vibrate: style.vibrate,
    timestamp: Date.now(),
    dir: 'rtl',
    lang: 'ar',
    data: {
      chatId,
      chatType,
      senderId,
      senderName,
      notifType,
      url: APP_URL,
      receivedAt: Date.now()
    },
    actions
  };

  // ============ اعرض الإشعار ============
  try {
    await self.registration.showNotification(title, options);

    // ============ Badge على أيقونة التطبيق (Android) ============
    if (badgeCount != null && 'setAppBadge' in navigator) {
      try { navigator.setAppBadge(badgeCount); } catch {}
    }
  } catch (e) {
    console.error('[SW] showNotification failed:', e);
  }
}

/* ===================================================================
 * 4) تخصيص الأسلوب حسب النوع
 * =================================================================== */
function styleForType(notifType, chatType) {
  switch (notifType) {
    case 'message':
      return {
        vibrate: chatType === 'group' ? [200, 100, 200] : [180, 80, 180],
        requireInteraction: false
      };
    case 'request':
      return {
        vibrate: [300, 100, 300, 100, 300],
        requireInteraction: true  // لا تختفي حتى يقرر المستخدم
      };
    case 'story':
      return {
        vibrate: [150, 70, 150],
        requireInteraction: false
      };
    case 'follow':
      return {
        vibrate: [120],
        requireInteraction: false
      };
    case 'ban':
      return {
        vibrate: [400, 200, 400, 200, 400],
        requireInteraction: true
      };
    case 'system':
      return {
        vibrate: [100],
        requireInteraction: false
      };
    default:
      return {
        vibrate: [200, 100, 200],
        requireInteraction: false
      };
  }
}

/* ===================================================================
 * 5) بناء الأفعال حسب النوع
 * =================================================================== */
function buildActions(notifType, chatType) {
  const actions = [];

  // ===== رسالة عادية (خاص أو مجموعة) =====
  if (notifType === 'message') {
    actions.push({
      action: 'reply',
      type: 'text',
      title: 'رد ↩️',
      placeholder: chatType === 'group' ? 'رد للمجموعة...' : 'اكتب رسالتك...'
    });
    actions.push({
      action: 'open',
      title: 'فتح',
      icon: `${APP_URL}icons/action-open.png` // اختياري
    });
    return actions;
  }

  // ===== طلب مراسلة =====
  if (notifType === 'request') {
    actions.push({ action: 'accept', title: '✓ قبول' });
    actions.push({ action: 'reject', title: '✕ رفض' });
    return actions;
  }

  // ===== قصة جديدة =====
  if (notifType === 'story') {
    actions.push({ action: 'view-story', title: '👁️ عرض القصة' });
    actions.push({ action: 'open', title: 'فتح' });
    return actions;
  }

  // ===== متابعة جديدة =====
  if (notifType === 'follow') {
    actions.push({ action: 'open-profile', title: '👤 عرض الملف' });
    return actions;
  }

  // ===== حظر / إداري =====
  if (notifType === 'ban') {
    actions.push({ action: 'open', title: 'تفاصيل' });
    return actions;
  }

  // ===== افتراضي =====
  actions.push({ action: 'open', title: 'فتح' });
  return actions;
}

/* ===================================================================
 * 6) معالج النقر على الإشعار
 * =================================================================== */
self.addEventListener('notificationclick', event => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action;
  const replyText = (event.reply || '').trim();

  // أغلق الإشعار
  notification.close();

  // ===== 1) رد سريع =====
  if (action === 'reply') {
    if (!replyText) return; // لم يكتب شيئاً
    event.waitUntil(dispatchQuickReply(data.chatId, replyText));
    return;
  }

  // ===== 2) قبول طلب المراسلة =====
  if (action === 'accept') {
    event.waitUntil(dispatchToApp('quick-action', {
      action: 'accept-request',
      chatId: data.chatId,
      senderId: data.senderId
    }));
    return;
  }

  // ===== 3) رفض طلب المراسلة =====
  if (action === 'reject') {
    event.waitUntil(dispatchToApp('quick-action', {
      action: 'reject-request',
      chatId: data.chatId,
      senderId: data.senderId
    }));
    return;
  }

  // ===== 4) عرض قصة =====
  if (action === 'view-story') {
    event.waitUntil(dispatchToApp('quick-action', {
      action: 'open-story',
      senderId: data.senderId
    }));
    return;
  }

  // ===== 5) فتح ملف شخصي =====
  if (action === 'open-profile') {
    event.waitUntil(dispatchToApp('quick-action', {
      action: 'open-profile',
      senderId: data.senderId
    }));
    return;
  }

  // ===== 6) فتح المحادثة (افتراضي) =====
  event.waitUntil(openChatWindow(data.chatId, data.senderId));
});

/* ===================================================================
 * 7) إغلاق الإشعارات (المستخدم أزالها يدوياً)
 * =================================================================== */
self.addEventListener('notificationclose', event => {
  // يمكن إرسال إشارة للتطبيق بأن الإشعار أُغلق
  const data = event.notification.data || {};
  if (data.chatId) {
    self.clients.matchAll({ type: 'window' }).then(clients => {
      clients.forEach(c => c.postMessage({
        type: 'notification-dismissed',
        chatId: data.chatId
      }));
    });
  }
});

/* ===================================================================
 * 8) Push Notifications (مستقبلي — مع Cloud Functions)
 * =================================================================== */
self.addEventListener('push', event => {
  let payload = { title: 'Ghost Caffee', body: 'لديك إشعار جديد' };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch {
    payload.body = event.data?.text() || payload.body;
  }
  event.waitUntil(showNotification(payload));
});

/* ===================================================================
 * 9) Background Sync (اختياري - للمستقبل)
 * =================================================================== */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncPendingMessages());
  }
});

async function syncPendingMessages() {
  // هنا يمكن إضافة منطق إرسال الرسائل المعلقة
  console.log('[SW] Sync messages');
}

/* ===================================================================
 * 10) دوال مساعدة داخلية
 * =================================================================== */

/**
 * إرسال رد سريع للنافذة المفتوحة أو فتح نافذة جديدة
 */
async function dispatchQuickReply(chatId, text) {
  if (!chatId || !text) return;

  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  // ✅ ابحث عن أي نافذة للتطبيق (حتى بدون focus)
  for (const client of clients) {
    if (client.url.startsWith(APP_URL)) {
      client.postMessage({
        type: 'quick-reply',
        chatId,
        text
      });
      return client.focus();
    }
  }

  // ✅ لا نافذة → افتح واحدة مع query parameter (أكثر موثوقية من hash)
  const payload = encodeURIComponent(JSON.stringify({ chatId, text }));
  const baseUrl = APP_URL.split('?')[0].split('#')[0];
  return self.clients.openWindow(`${baseUrl}?pending_reply=${payload}`);
}

/**
 * إرسال رسالة للتطبيق (نافذة مفتوحة أو فتح جديدة)
 */
async function dispatchToApp(messageType, payload) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  for (const client of clients) {
    if (client.url.startsWith(APP_URL)) {
      client.postMessage({ type: messageType, ...payload });
      return client.focus();
    }
  }

  // لا نافذة → افتح مع hash
  const hash = encodeURIComponent(JSON.stringify(payload));
  return self.clients.openWindow(`${APP_URL}#${messageType}=${hash}`);
}

/**
 * فتح نافذة المحادثة (بدون رد)
 */
async function openChatWindow(chatId, senderId) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  for (const client of clients) {
    if (client.url.startsWith(APP_URL)) {
      client.postMessage({
        type: 'open-chat',
        chatId,
        senderId
      });
      return client.focus();
    }
  }

  // افتح نافذة جديدة مع hash
  const url = chatId ? `${APP_URL}#chat=${encodeURIComponent(chatId)}` : APP_URL;
  return self.clients.openWindow(url);
}

/* ===================================================================
 * 12) معلومات
 * =================================================================== */
console.log(`[SW] Ghost Caffee Service Worker loaded — v${SW_VERSION}`);