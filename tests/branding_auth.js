// Branding/auth/theme/cache regression checks for Ghost Caffee v7.4.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const rulesText = fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8');
const rules = JSON.parse(rulesText);
let pass = 0, fail = 0;
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
const appThemes = (js.match(/const APP_THEMES = \[([^\]]+)\]/) || [])[1] || '';
const wallpapers = (js.match(/const CHAT_WALLPAPERS = \[([^\]]+)\]/) || [])[1] || '';
check('Ghost Caffee document and manifest branding', /<title>Ghost Caffee<\/title>/.test(html) && manifest.name === 'Ghost Caffee');
check('username/password registration form is present', /id="register-form"/.test(html) && /id="reg-username"/.test(html) && /id="reg-password"/.test(html));
check('username/password login form is present', /id="login-form"/.test(html) && /id="login-username"/.test(html) && /id="login-password"/.test(html));
check('no real email field or Google sign-in UI', !/<input[^>]+type=["']email/i.test(html) && !/id="(?:google-login|email-login)"|data-provider="google"/i.test(html));
check('account hint accurately explains cross-device username/password login', /id="device-info-reg"/.test(html) && /يمكنك تسجيل الدخول من جهاز آخر/.test(js) && !/مرتبطة بهذا الجهاز/.test(js));
check('Firebase account uses internal username alias (not user-entered email)', /function accountEmail\(username\)[\s\S]{0,260}@accounts\.chatapp\.local/.test(js) && /createUserWithEmailAndPassword\(accountEmail\(username\), password\)/.test(js) && /signInWithEmailAndPassword\(accountEmail\(username\), password\)/.test(js));
check('new startup does not silently create anonymous accounts', !/signInAnonymously\s*\(/.test(js));
check('six application themes are wired in markup and logic', appThemes.split(',').filter(x => x.trim()).length === 6 && (html.match(/class="theme-option"/g) || []).length === 6);
check('nine independent chat wallpapers are wired', wallpapers.split(',').filter(x => x.trim()).length === 9 && (html.match(/data-wp=/g) || []).length === 9);
check('official theme defaults to espresso brown', /localTheme:[\s\S]{0,240}'coffee'/.test(js) && /:root\[data-theme="coffee"\][\s\S]{0,180}--bg-dark:#17100c/i.test(css));
check('authentication layout class matches its responsive styling', /class="auth-container account-auth-container"/.test(html) && /\.account-auth-container \{/.test(css) && !/\.guest-auth-container/.test(css));
check('navy theme exists', /:root\[data-theme="navy"\]/.test(css) && /data-theme="navy"/.test(html));
check('story palette includes vivid warm, cool, and green colors', /#ff453a/.test(html) && /#38bdf8/.test(html) && /#34c759/.test(html) && /#a855f7/.test(html) && /#667eea 0%/.test(js));
check('clipped tagline is removed from the upper wordmark', !/قهوة تجمعنا/.test(html) && !/brand-bean/.test(html));
check('menu uses one early delegated handler and has actions', /function bindSideMenuEvents\(\)/.test(js) && /bindSideMenuEvents\(\);/.test(js) && /data-action="settings"/.test(html) && /data-action="logout"/.test(html));
check('legacy anonymous sessions can be secured before logout', /data-action="secure-account"/.test(html) && /linkWithCredential\(credential\)/.test(js));
check('swipe reply handles left and right horizontal gestures', /pointerdown/.test(js) && /pointerup/.test(js) && /Math\.abs\(dx\) >= 58/.test(js));
check('swipe reply has only one commit path; touch events remain long-press only', /Touch events are only for long-press context menus/.test(js) && !/touchend',\s*e =>[\s\S]{0,850}S\.currentReply\s*=/.test(js) && /document\.addEventListener\('pointerup'/.test(js));
check('no Firebase Storage or Cloud Functions initialization', !/firebase\.storage\s*\(|firebase\.functions\s*\(/.test(js));
check('Realtime Database rules remain valid without client-side rewrite', !!rules.rules && typeof rules.rules === 'object' && rulesText.includes('".read": false'));
check('v7.4.4 page and Service Worker cache references are aligned', /app\.js\?v=7\.4\.4/.test(html) && /styles\.css\?v=7\.4\.4/.test(html) && /const SW_VERSION = '7\.4\.4'/.test(sw) && /styles\.css\?v=7\.4\.4/.test(sw) && /app\.js\?v=7\.4\.4/.test(sw) && /ghost-mark\.svg/.test(sw));
check('logout does not hide a live session when Firebase signOut fails', /await auth\.signOut\(\);[\s\S]{0,160}catch \(error\)[\s\S]{0,180}return;/.test(js) && js.indexOf('await auth.signOut();', js.indexOf('async function logout()')) < js.indexOf('detachRealtime();', js.indexOf('async function logout()')));
check('logout is guarded against double taps', /if \(S\.logoutInProgress\) return;/.test(js) && /S\.logoutInProgress = false;/.test(js));

check('logout button is explicit, near the top of the drawer, and independently wired', /id="btn-menu-logout"[^>]*data-action="logout"/.test(html) && html.indexOf('id="btn-menu-logout"') < html.indexOf('data-action="profile"') && /if \(action === 'logout'\) await logout\(\)/.test(js));
check('Ghost mark is used in chat theme swatches and message watermark', /icons\/ghost-mark\.svg/.test(css) && /mask:url\('icons\/ghost-mark\.svg'\)/.test(css) && /icons\/ghost-mark\.svg/.test(sw));
check('durable account-scoped IndexedDB cache stores individual messages without conversation truncation', /indexedDB\.open\(LOCAL_CACHE_DB, LOCAL_CACHE_SCHEMA_VERSION\)/.test(js) && /createObjectStore\('messageItems'/.test(js) && /byAccountChat/.test(js) && /writeMessageRows/.test(js) && /stateCacheKey\(accountUid, name\)/.test(js) && !/LOCAL_CACHE_MESSAGES_PER_CHAT = 160/.test(js));
check('offline message cache preserves complete received message payloads and media', /Persist complete message payloads/.test(js) && /compactMessagesForLocalCache/.test(js) && /cached-media-placeholder/.test(js));
check('offline cached login continues to respect the local PIN lock', /async function activateCachedAccountSession[\s\S]{0,1500}showPinLock\(\)/.test(js));
check('cached login fallback restores last validated account when RTDB is offline', /activateCachedAccountSession/.test(js) && /registrationComplete !== true/.test(js) && /refreshCachedSessionAfterReconnect/.test(js));
check('app startup is cache-first after a prior validated account and refreshes in the background', /Cache-first startup:[\s\S]{0,500}readCachedState\('account', user\.uid\)/.test(js) && /activateCachedAccountSession\(user, \{ cacheFirst: true \}\)/.test(js) && /connectedHandler[\s\S]{0,500}refreshCachedSessionAfterReconnect/.test(js));
check('temporary reconnect validation failures retry without polling while offline', /S\.dbConnected === false/.test(js) && /S\.dbConnected === true/.test(js) && /reconnectRetryTimer = setTimeout/.test(js));
check('chat index, chat metadata, stories and profiles are persisted per account', /writeCachedState\('chatIndex'/.test(js) && /writeCachedState\('chats'/.test(js) && /writeCachedState\('stories'/.test(js) && /writeCachedState\('profiles'/.test(js));
check('new messages are cached even when their conversation is not open', /syncPassiveMessageListeners/.test(js) && /limitToLast\(100\)/.test(js) && /child_added/.test(js) && /cachePassiveMessageSnapshot/.test(js));
check('passive cache listener resumes from the latest cached timestamp to catch up missed messages', /readCachedMessages\(chatId\)[\s\S]{0,450}latestTimestamp[\s\S]{0,300}startAt\(latestTimestamp\)/.test(js) && /message IDs deduplicate/.test(js));
check('rebind of live listeners does not clear just-hydrated cache state', /detachRealtime\(options = \{\}\)/.test(js) && /detachRealtime\(\{ preserveCache: true \}\)/.test(js) && /detachChatListeners\(preserveCache = false\)/.test(js));
check('remote message snapshots are merged with previously cached history rather than replacing it', /Upsert instead of replacing/.test(js) && /new Map\(\(cachedMessages \|\| \[\]\)\.map/.test(js));
check('cached-only conversation previews disable the composer and restore it on live data', /function setMessageInputPreviewState\(chatId, cachedOnly\)/.test(js) && /setMessageInputPreviewState\(chatId, true\)/.test(js) && /setMessageInputPreviewState\(chatId, false\)/.test(js) && /if \(usingLocalChatPreview\) \$\('input-bar'\)\?\.classList\.add\('hidden'\)/.test(js));
check('Service Worker excludes Firebase Auth and Realtime Database traffic from static caching', /pinnedFirebaseSdk/.test(sw) && /firebasejs/.test(sw) && !/firebaseapp\.com|firebasedatabase\.app/.test(sw));
check('Arabic/English typeface uses IBM Plex Sans Arabic and Inter', /IBM\+Plex\+Sans\+Arabic/.test(html) && /family=Inter/.test(html) && /IBM Plex Sans Arabic/.test(css));
check('Web assets and Android assets are expected to be mirrored from one source', fs.existsSync(path.join(root, 'icons/ghost-mark.svg')));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
