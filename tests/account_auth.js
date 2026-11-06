// Exercise actual username/password registration and login against the bundled RTDB rules simulator.
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const path = require('path');
const { makeSim } = require('./rules_sim.js');
const root = path.resolve(__dirname, '..');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8'));
const sim = makeSim(rules);
const now = Date.now();
const DB = { data: {
  config: { ownerUid: 'UOWNER', app: { appName: 'Ghost Caffee', maxAccountsPerDevice: 3, allowRegistration: true, schemaVersion: 12 } },
  users: { UOWNER: { id: 'UOWNER', username: 'data', role: 'owner', status: 'active', coins: 0, deviceId: 'owner-device', createdAt: now, lastSeen: now, showOnline: true, showLastSeen: true, registrationComplete: true, settings: { notifications: true, sounds: true, readReceipts: true, showOnline: true, showLastSeen: true } } },
  usernames: { data: 'UOWNER', occupied: 'UOTHER' },
  profiles: { UOWNER: { username: 'data', displayName: 'Owner', bio: '', avatar: '', cover: '', role: 'owner', verified: true, active: true, createdAt: now } }
}};
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
function getAt(rootObj, pathText) { let node = rootObj; for (const part of pathText) { if (node == null || typeof node !== 'object') return undefined; node = node[part]; } return node; }
function setAt(rootObj, pathText, value) {
  const parts = pathText.split('/').filter(Boolean); let node = rootObj;
  for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] ||= {};
  const key = parts[parts.length - 1]; if (value == null) delete node[key]; else node[key] = value;
}
function snap(key, value) { return { key, val: () => clone(value) ?? null, exists: () => value !== undefined && value !== null, forEach: () => false }; }
let uidNumber = 0;
const authAccounts = new Map();
const makeAuthError = code => Object.assign(new Error(code), { code: `auth/${code}` });
function makeFirebase() {
  const listeners = [];
  const authObject = {
    currentUser: null,
    async createUserWithEmailAndPassword(email, password) {
      if (authAccounts.has(email)) throw makeAuthError('email-already-in-use');
      if (String(password).length < 6) throw makeAuthError('weak-password');
      const user = { uid: 'UACCT' + (++uidNumber), isAnonymous: false, email,
        async delete() { authAccounts.delete(email); if (authObject.currentUser?.uid === this.uid) authObject.currentUser = null; } };
      authAccounts.set(email, { user, password }); this.currentUser = user; return { user };
    },
    async signInWithEmailAndPassword(email, password) {
      const rec = authAccounts.get(email);
      if (!rec || rec.password !== password) throw makeAuthError('invalid-credential');
      this.currentUser = rec.user; return { user: rec.user };
    },
    async signOut() { this.currentUser = null; },
    async setPersistence() {},
    onAuthStateChanged(callback) { listeners.push(callback); }
  };
  const permission = () => Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' });
  function Ref(parts, query = {}) {
    const ref = {
      path: parts, query,
      get key() { return parts[parts.length - 1] || null; },
      child(k) { return Ref(parts.concat(String(k).split('/').filter(Boolean)), {}); },
      push() { return Ref(parts.concat('push-test-' + Math.random().toString(36).slice(2, 8)), {}); },
      orderByChild(k) { return Ref(parts, { ...query, orderByChild: k }); },
      startAt(v) { return Ref(parts, { ...query, startAt: v }); },
      limitToLast(v) { return Ref(parts, { ...query, limitToLast: v }); },
      equalTo(v) { return Ref(parts, { ...query, equalTo: v }); },
      async once() {
        const pathText = parts.join('/');
        if (!sim.read(DB, authObject.currentUser?.uid || null, pathText, Date.now(), query)) throw permission();
        return snap(ref.key, getAt(DB.data, parts));
      },
      async set(value) {
        const result = sim.set(DB, authObject.currentUser?.uid || null, parts.join('/'), value, Date.now());
        if (!result.ok) { const err = permission(); err.detail = result.why; throw err; }
        setAt(DB.data, parts.join('/'), value); return true;
      },
      async remove() { return ref.set(null); },
      async update(changes) {
        const writes = {};
        for (const [key, value] of Object.entries(changes)) writes[parts.concat(key.split('/').filter(Boolean)).join('/')] = value;
        const result = sim.update(DB, authObject.currentUser?.uid || null, writes, Date.now());
        if (!result.ok) { const err = permission(); err.detail = result.why; throw err; }
        for (const [key, value] of Object.entries(changes)) setAt(DB.data, parts.concat(key.split('/').filter(Boolean)).join('/'), value);
        return true;
      },
      async transaction(updateFn) {
        const pathText = parts.join('/');
        const current = getAt(DB.data, parts);
        const next = updateFn(current === undefined ? null : clone(current));
        if (next === undefined) return { committed: false, snapshot: snap(ref.key, current) };
        const result = sim.set(DB, authObject.currentUser?.uid || null, pathText, next, Date.now());
        if (!result.ok) { const err = permission(); err.detail = result.why; throw err; }
        setAt(DB.data, pathText, next); return { committed: true, snapshot: snap(ref.key, next) };
      },
      on(event, callback, errorCallback) { listeners.push({ ref, callback, errorCallback }); return callback; },
      off() {},
      onDisconnect() { return { async set() {} }; }
    };
    return ref;
  }
  const databaseObject = { ref: p => Ref(p ? String(p).split('/').filter(Boolean) : []), ServerValue: { TIMESTAMP: { '.sv': 'timestamp' }, increment: n => ({ '.sv': { increment: n } }) } };
  const authFactory = Object.assign(() => authObject, {
    Auth: { Persistence: { LOCAL: 'local' } },
    EmailAuthProvider: { credential: (email, password) => ({ providerId: 'password', email, password }) }
  });
  const firebase = {
    initializeApp() {},
    auth: authFactory,
    database: Object.assign(() => databaseObject, { ServerValue: databaseObject.ServerValue })
  };
  return { firebase, authObject };
}
function makeEl(id) {
  const classes = new Set(['hidden']);
  return { id, value: '', textContent: '', innerHTML: '', disabled: false, checked: false, readOnly: false, style: {}, dataset: {}, files: [],
    classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x), toggle(x, v) { if (v === undefined) v = !classes.has(x); v ? classes.add(x) : classes.delete(x); return v; } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return ''; }, querySelector() { return makeEl('nested'); }, querySelectorAll() { return []; }, closest() { return null; }, appendChild() {}, remove() {}, focus() {}, click() {}, select() {}, scrollIntoView() {} };
}
function client() {
  const els = {};
  const store = {};
  const { firebase, authObject } = makeFirebase();
  const document = { getElementById: id => els[id] || (els[id] = makeEl(id)), querySelector: () => makeEl('query'), querySelectorAll: () => [], createElement: () => makeEl('created'), addEventListener() {}, body: makeEl('body'), documentElement: makeEl('html'), hidden: false };
  const storage = { get length() { return Object.keys(store).length; }, key: i => Object.keys(store)[i] ?? null, getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const ctx = { firebase, document, localStorage: storage, sessionStorage: storage, navigator: { vibrate() {} }, location: { pathname: '/index.html', search: '', hash: '' }, history: { replaceState() {} }, innerWidth: 390, console: { ...console, warn() {} }, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise, URL, URLSearchParams, Blob, TextEncoder, Uint8Array, Event: class {}, Image: class {}, FileReader: class {}, crypto: crypto.webcrypto, Notification: class { static permission = 'denied'; } };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.addEventListener = () => {};
  const fullSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const bootPos = fullSource.indexOf('/* ==================== Boot ==================== */');
  if (bootPos < 0) throw new Error('Could not locate boot boundary');
  const source = fullSource.slice(0, bootPos) + '\n;globalThis.__T = { S, registerAccount, loginAccount, accountEmail, reserveUsername, loadCurrentAccount, initializeAuthenticatedUser };';
  vm.createContext(ctx); vm.runInContext(source, ctx, { filename: 'app.js' });
  ctx.initializeAuthenticatedUser = async () => true;
  return { ctx, els, store, authObject };
}
let passed = 0, failed = 0;
function check(name, condition, details = '') { condition ? passed++ : failed++; console.log((condition ? 'PASS ' : 'FAIL ') + name + (condition ? '' : ' — ' + details)); }
function setForm(A, prefix, username, password, confirm) {
  A.els[`${prefix}-username`] = makeEl(`${prefix}-username`); A.els[`${prefix}-username`].value = username;
  A.els[`${prefix}-password`] = makeEl(`${prefix}-password`); A.els[`${prefix}-password`].value = password;
  A.els[`${prefix}-form`] = makeEl(`${prefix}-form`); A.els[`${prefix}-form`].querySelector = () => makeEl('submit-button');
  if (prefix === 'reg') { A.els['reg-confirm'] = makeEl('reg-confirm'); A.els['reg-confirm'].value = confirm; }
}
(async () => {
  const A = client();
  setForm(A, 'reg', 'coffee_guest', 'secret-pass', 'secret-pass');
  await A.ctx.__T.registerAccount({ preventDefault() {} });
  const uid1 = A.authObject.currentUser?.uid;
  check('register form creates a durable Firebase username/password identity', !!uid1 && !A.authObject.currentUser.isAnonymous);
  check('account alias is internal and based on the username', A.authObject.currentUser?.email === 'coffee_guest@accounts.chatapp.local' && A.ctx.__T.accountEmail(' @Coffee_Guest ') === 'coffee_guest@accounts.chatapp.local');
  check('user record is completed after RTDB companions exist', !!uid1 && DB.data.users?.[uid1]?.registrationComplete === true && DB.data.profiles?.[uid1]?.username === 'coffee_guest' && DB.data.presence?.[uid1] && DB.data.devices?.[DB.data.users?.[uid1]?.deviceId]?.users?.[uid1] === true);
  check('username index is reserved for the account UID', !!uid1 && DB.data.usernames?.coffee_guest === uid1);
  check('password is not copied into Realtime Database', !!uid1 && !JSON.stringify(DB.data.users[uid1]).includes('secret-pass'));

  const B = client();
  setForm(B, 'login', 'coffee_guest', 'secret-pass');
  await B.ctx.__T.loginAccount({ preventDefault() {} });
  check('login with username/password resolves the same UID', B.authObject.currentUser?.uid === uid1);
  check('incorrect password is rejected', await (async () => { try { await B.ctx.auth.signInWithEmailAndPassword('coffee_guest@accounts.chatapp.local', 'wrong-pass'); return false; } catch { return true; } })());

  const C = client();
  setForm(C, 'reg', 'occupied', 'secret-pass', 'secret-pass');
  await C.ctx.__T.registerAccount({ preventDefault() {} });
  check('username collision in the RTDB index is reported', /مستخدم بالفعل/.test(C.els['auth-error']?.textContent || ''));
  check('failed registration removes incomplete RTDB rows and auth alias', !Object.values(DB.data.users || {}).some(user => user?.username === 'occupied') && !authAccounts.has('occupied@accounts.chatapp.local'));

  const D = client();
  setForm(D, 'reg', 'bad-name', 'secret-pass', 'secret-pass');
  await D.ctx.__T.registerAccount({ preventDefault() {} });
  check('invalid username is rejected before creating an auth identity', /غير صالح|اسم المستخدم/.test(D.els['auth-error']?.textContent || '') && !authAccounts.has('bad-name@accounts.chatapp.local'));

  const E = client();
  setForm(E, 'reg', 'fresh_user', 'secret-pass', 'different-pass');
  await E.ctx.__T.registerAccount({ preventDefault() {} });
  check('password confirmation mismatch is rejected before account creation', /غير مطابق/.test(E.els['auth-error']?.textContent || '') && !authAccounts.has('fresh_user@accounts.chatapp.local'));

  // Legacy anonymous identity: linking credentials must keep its UID and chat history,
  // and must work with the shipped rules without parent-level updates to completed records.
  const legacyUid = 'ULEGACY';
  const legacyDeviceId = 'legacy-device';
  const legacyTime = Date.now() - 100000;
  DB.data.users[legacyUid] = {
    id: legacyUid, username: 'legacy_user', role: 'user', status: 'active', coins: 7,
    deviceId: legacyDeviceId, createdAt: legacyTime, lastSeen: legacyTime,
    showOnline: true, showLastSeen: true, registrationComplete: true,
    contacts: {}, blocked: {}, settings: { notifications: true, sounds: true, readReceipts: true, showLastSeen: true, showOnline: true }
  };
  DB.data.usernames.legacy_user = legacyUid;
  DB.data.profiles[legacyUid] = { username: 'legacy_user', displayName: 'Old Ghost', bio: 'keep me', avatar: '', cover: '', role: 'user', verified: false, active: true, createdAt: legacyTime };
  DB.data.presence ||= {};
  DB.data.presence[legacyUid] = { online: false, lastSeen: legacyTime, showOnline: true, showLastSeen: true };
  DB.data.devices ||= {};
  DB.data.devices[legacyDeviceId] = { users: { [legacyUid]: true } };
  DB.data.chats ||= {};
  DB.data.chats['legacy-chat-preserved'] = { members: { [legacyUid]: true }, messages: { m1: { text: 'historical message stays', senderId: legacyUid, timestamp: legacyTime } } };
  const F = client();
  const legacyUser = {
    uid: legacyUid, isAnonymous: true,
    async linkWithCredential(credential) {
      if (authAccounts.has(credential.email)) throw Object.assign(new Error('email-already-in-use'), { code: 'auth/email-already-in-use' });
      this.email = credential.email;
      this.isAnonymous = false;
      authAccounts.set(credential.email, { user: this, password: credential.password });
      return { user: this };
    }
  };
  F.authObject.currentUser = legacyUser;
  setForm(F, 'reg', 'legacy_user', 'preserve-pass', 'preserve-pass');
  await F.ctx.__T.registerAccount({ preventDefault() {} });
  check('legacy guest is secured in place with username/password credentials', F.authObject.currentUser?.uid === legacyUid && !F.authObject.currentUser?.isAnonymous && authAccounts.has('legacy_user@accounts.chatapp.local'));
  check('legacy completed users record is not overwritten (rules-safe migration)', DB.data.users[legacyUid]?.registrationComplete === true && DB.data.users[legacyUid]?.coins === 7 && DB.data.users[legacyUid]?.username === 'legacy_user');
  check('legacy profile custom display name and bio are preserved', DB.data.profiles[legacyUid]?.displayName === 'Old Ghost' && DB.data.profiles[legacyUid]?.bio === 'keep me');
  check('legacy chat history and membership remain intact after securing account', DB.data.chats['legacy-chat-preserved']?.members?.[legacyUid] === true && DB.data.chats['legacy-chat-preserved']?.messages?.m1?.text === 'historical message stays');
  check('legacy account migration does not save plaintext password to RTDB', !JSON.stringify(DB.data.users[legacyUid]).includes('preserve-pass'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error('HARNESS ERROR', error); process.exit(2); });
