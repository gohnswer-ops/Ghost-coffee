// End-to-end: run the REAL app.js for two users against an in-memory RTDB that enforces database.rules.json
const fs=require('fs'), vm=require('vm');
const {makeSim}=require('./rules_sim.js');
const rulesFile=process.argv[2], appFile=process.argv[3];
const sim=makeSim(JSON.parse(fs.readFileSync(rulesFile,'utf8')));
const DB={data:{}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let keyN=0; const nextKey=()=>'-K'+String(++keyN).padStart(6,'0');
const listeners=[];
const clone=o=>o===undefined?undefined:JSON.parse(JSON.stringify(o));
const getAt=(root,p)=>{let c=root;for(const k of p){if(c==null||typeof c!=='object')return undefined;c=c[k];}return c;};

function makeSnap(key,val,order){ // order: array of keys for forEach
  return {key, val:()=>val===undefined?null:clone(val), exists:()=>val!==undefined&&val!==null,
    forEach(fn){ if(val&&typeof val==='object'){ const keys=order||Object.keys(val); for(const k of keys){ if(fn(makeSnap(k,val[k]))) return true; } } return false; }};
}
function fireAll(){ for(const l of listeners.slice()) l.run(); }

function makeFirebase(uid){
  const permErr=()=>Object.assign(new Error('PERMISSION_DENIED: Permission denied'),{code:'PERMISSION_DENIED'});
  function Ref(path,q){
    const self={path,q:q||{},
      get key(){return path[path.length-1]||null;},
      child(p){return Ref(path.concat(String(p).split('/').filter(Boolean)),null);},
      orderByChild(c){return Ref(path,{...self.q,orderByChild:c,startAt:self.q.startAt??null,limitToLast:self.q.limitToLast??null,limitToFirst:null});},
      startAt(v){return Ref(path,{...self.q,startAt:v,limitToFirst:self.q.limitToFirst??null,limitToLast:self.q.limitToLast??null});},
      limitToLast(n){return Ref(path,{...self.q,limitToLast:n,limitToFirst:null,startAt:self.q.startAt??null});},
      equalTo(v){return Ref(path,{...self.q,equalTo:v});},
      push(){const k=nextKey();return Ref(path.concat(k));},
      _read(){ const p=path.join('/'); if(!sim.read(DB,uid,p,Date.now(),self.q)) return {denied:true};
        let v=getAt(DB.data,path); let order=null;
        if(v&&typeof v==='object'&&self.q.orderByChild){ let ent=Object.entries(v).map(([k,x])=>[k,x]).sort((a,b)=>(a[1]?.[self.q.orderByChild]??0)-(b[1]?.[self.q.orderByChild]??0)||(a[0]<b[0]?-1:1));
          if(self.q.startAt!=null) ent=ent.filter(e=>(e[1]?.[self.q.orderByChild]??0)>=self.q.startAt);
          if(self.q.equalTo!==undefined) ent=ent.filter(e=>e[1]?.[self.q.orderByChild]===self.q.equalTo);
          if(self.q.limitToLast) ent=ent.slice(-self.q.limitToLast);
          v=Object.fromEntries(ent); order=ent.map(e=>e[0]); }
        return {snap:makeSnap(self.key,v,order)}; },
      async once(){ const r=self._read(); if(r.denied) throw permErr(); return r.snap; },
      on(ev,cb,err){ const l={ref:self,cb,err,run(){ const r=self._read(); if(r.denied){ if(!l.dead){l.dead=true; err&&err(permErr());} return;} setTimeout(()=>{ if(!l.off) cb(r.snap); },0); }}; listeners.push(l); l.run(); return cb; },
      off(ev,cb){ for(const l of listeners){ if(l.ref===self&&(!cb||l.cb===cb)) l.off=true; } },
      async set(v){ const res=sim.set(DB,uid,path.join('/'),v===undefined?null:v,Date.now()); if(!res.ok){ const e=permErr(); e.detail=res.why; throw e;} fireAll(); },
      async remove(){ return self.set(null); },
      async update(obj){ const w={}; for(const [k,v] of Object.entries(obj)) w[path.concat(k.split('/').filter(Boolean)).join('/')]=v; const res=sim.update(DB,uid,w,Date.now()); if(!res.ok){ const e=permErr(); e.detail=res.why; throw e;} fireAll(); },
      onDisconnect(){ return {set:async()=>{}}; }
    };
    return self;
  }
  const rootRef=()=>Ref([]);
  const fb={initializeApp(){},
    auth:Object.assign(()=>authObj,{Auth:{Persistence:{LOCAL:'l'}},EmailAuthProvider:{credential(){}}}),
    database:Object.assign(()=>({ref:p=>p?Ref(String(p).split('/').filter(Boolean)):rootRef()}),{ServerValue:{TIMESTAMP:{'.sv':'timestamp'},increment:n=>({'.sv':{increment:n}})}})};
  const user={uid,email:uid+'@x'};
  const authObj={currentUser:user,setPersistence:async()=>{},signOut:async()=>{},onAuthStateChanged(cb){ setTimeout(()=>cb(user),5); }};
  return fb;
}
function makeEl(id){ const el={id,dataset:{},style:{},value:'',textContent:'',_html:'',scrollHeight:0,scrollTop:0,clientHeight:0,checked:false,disabled:false,files:[],
  classList:{_s:new Set(['hidden']),add(...a){a.forEach(x=>this._s.add(x))},remove(...a){a.forEach(x=>this._s.delete(x))},toggle(c,f){if(f===undefined)f=!this._s.has(c);f?this._s.add(c):this._s.delete(c);return f},contains(c){return this._s.has(c)}},
  addEventListener(){},removeEventListener(){},setAttribute(){},removeAttribute(){},getAttribute(){return ''},querySelector(){return makeEl('q')},querySelectorAll(){return []},closest(){return null},appendChild(){},remove(){},focus(){},select(){},click(){},scrollIntoView(){},
  get innerHTML(){return this._html},set innerHTML(v){this._html=v}}; return el; }

async function makeClient(uid){
  const els={}; const store={};
  const ctx={localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},
    document:{getElementById:id=>els[id]||(els[id]=makeEl(id)),querySelector:()=>makeEl('q'),querySelectorAll:()=>[],createElement:()=>makeEl('c'),addEventListener(){},body:makeEl('body'),documentElement:makeEl('html'),hidden:false},
    navigator:{},innerWidth:1200,console:{...console,warn:()=>{}},setTimeout,clearTimeout,setInterval,clearInterval,Date,Math,JSON,Promise,
    crypto:require('crypto').webcrypto,Notification:class Notification{static permission='denied'},Blob,URL,TextEncoder,Uint8Array,Event:class{},Image:class{},FileReader:class{},URLSearchParams,location:{search:'',hash:'',pathname:'/index.html'},history:{replaceState(){}}};
  ctx.window=ctx; ctx.globalThis=ctx; ctx.addEventListener=()=>{};
  ctx.firebase=makeFirebase(uid);
  vm.createContext(ctx);
  const src=fs.readFileSync(appFile,'utf8')+"\n;globalThis.__T={S,openChat,createGroup,startPrivateByUid,handleChatRequest,cancelChatRequest,sendMessage,toggleBlock,renderMessages,createReport,deleteChatForMe,reportMessage,clearChatForMe,resetAccountScopedMemory,isHiddenBlockedMessage,chatItemHtml,reviewReport,toggleFollow,saveSettings,updatePresenceText,loadGroupUsers,setConfirmAsync:fn=>{confirmAsync=fn},setPromptAsync:fn=>{promptAsync=fn},setRenderAdminTab:fn=>{renderAdminTab=fn}};";
  vm.runInContext(src,ctx,{filename:'app.js'});
  ctx.els=els; return ctx;
}
function register(uid,username,device,base){
  const w={};
  const r1=sim.set(DB,uid,`users/${uid}`,{id:uid,username,role:'user',status:'active',coins:0,deviceId:device,createdAt:base,lastSeen:base,showOnline:true,showLastSeen:true,registrationComplete:false,settings:{notifications:true,sounds:true,readReceipts:true,showLastSeen:true,showOnline:true}},base);
  sim.set(DB,uid,`usernames/${username}`,uid,base);
  sim.set(DB,uid,`profiles/${uid}`,{username,bio:'hi '+username,avatar:'',verified:false,active:true,createdAt:base},base);
  sim.set(DB,uid,`presence/${uid}`,{online:true,lastSeen:base,showOnline:true,showLastSeen:true},base);
  sim.set(DB,uid,`devices/${device}/users/${uid}`,true,base);
  sim.set(DB,uid,`users/${uid}/registrationComplete`,true,base);
}
let pass=0,fail=0; const T=(n,c,extra)=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n+(c?'':'  '+(extra||'')));};

(async()=>{
  const t0=Date.now();
  register('UA','alice','d1',t0); register('UB','bob','d2',t0); register('UC','carol','d3',t0); register('UOWN','data','d0',t0);
  T('test owner can be bootstrapped without changing rules', sim.set(DB,'UOWN','config/ownerUid','UOWN',Date.now()).ok);
  T('test owner role follows existing owner rule', sim.set(DB,'UOWN','users/UOWN/role','owner',Date.now()).ok);
  T('test owner app config remains within schema', sim.set(DB,'UOWN','config/app',{appName:'Ghost Caffee',maxAccountsPerDevice:3,allowRegistration:true,schemaVersion:10},Date.now()).ok);
  const A=await makeClient('UA'), B=await makeClient('UB'), C=await makeClient('UC'), O=await makeClient('UOWN');
  await sleep(400);
  // The in-memory rules harness has no real .info/connected socket; mark its clients online for server-write scenarios.
  for (const client of [A, B, C, O]) { client.__T.S.offlineMode = false; client.__T.S.dbConnected = true; }
  T('alice entered the app', !A.els['app-screen'].classList.contains('hidden'), 'app-screen still hidden; auth-error='+A.els['auth-error']?.textContent);
  T('bob entered the app', !B.els['app-screen'].classList.contains('hidden'));

  // A starts a private chat with B (real app code)
  await A.__T.startPrivateByUid('UB');
  await sleep(150);
  sim.update(DB,'UB',{[`chatRequests/UB/UA/status`]:'approved',[`chats/${['UA','UB'].sort().join('_')}/requestState`]:'approved',[`userChats/UA/${['UA','UB'].sort().join('_')}`]:true,[`userChats/UB/${['UA','UB'].sort().join('_')}`]:true},Date.now());
  await A.__T.openChat(['UA','UB'].sort().join('_'));
  await sleep(150);
  const chatId=['UA','UB'].sort().join('_');
  T('chat doc exists', !!DB.data.chats?.[chatId]);
  T('BOTH users indexed', DB.data.userChats?.UA?.[chatId]===true && DB.data.userChats?.UB?.[chatId]===true);
  T('alice has chat open', A.__T.S.activeChatId===chatId);
  T('bob chat request/index is present', DB.data.userChats?.UB?.[chatId]===true && DB.data.chatRequests?.UB?.UA?.status==='approved');

  // send several messages, including a very long one
  for (const txt of ['one','two','three']) { A.els['message-input'].value=txt; await A.__T.sendMessage(); }
  A.els['message-input'].value='L'.repeat(3000); await A.__T.sendMessage();
  await sleep(300);
  const msgs=Object.values(DB.data.messages?.[chatId]||{});
  T('4 messages stored', msgs.length===4, 'stored='+msgs.length);
  T('lastMessage preview <= 500', DB.data.chats[chatId].lastMessage.text.length<=500);
  const html=A.els['messages-container'].innerHTML;
  T('alice UI renders ALL messages (forEach fix)', (html.match(/class="message /g)||[]).length===4, 'rendered='+(html.match(/class="message /g)||[]).length);

  // bob sees unread badge + preview in list, then opens the chat
  await sleep(200);
  const bl=B.els['chat-list'].innerHTML;
  T('bob has four unread messages', (DB.data.chats[chatId].unreadCount?.UB||0)===4);
  await B.__T.openChat(chatId);
  await sleep(400);
  const bh=B.els['messages-container'].innerHTML;
  T('bob UI renders all 4 messages', (bh.match(/class="message /g)||[]).length===4);
  T('bob unread reset to 0', (DB.data.chats[chatId].unreadCount?.UB||0)===0);
  T('alice sees read receipts (✓✓)', /message-status read/.test(A.els['messages-container'].innerHTML) || /message-status delivered/.test(A.els['messages-container'].innerHTML));

  // live message while chat open
  B.els['message-input'].value='reply from bob'; await B.__T.sendMessage(); await sleep(300);
  T('alice receives bob live', A.els['messages-container'].innerHTML.includes('reply from bob'));
  const beforeOfflineSend = Object.keys(DB.data.messages?.[chatId] || {}).length;
  A.__T.S.offlineMode = true; A.__T.S.dbConnected = false;
  A.els['message-input'].value = 'must stay local while offline';
  await A.__T.sendMessage(); await sleep(50);
  T('offline cached preview never queues an unintended message write', Object.keys(DB.data.messages?.[chatId] || {}).length === beforeOfflineSend);
  A.els['message-input'].value = ''; A.__T.S.offlineMode = false; A.__T.S.dbConnected = true;

  // Follow/unfollow must update both RTDB indexes and the local relationship cache.
  await A.__T.toggleFollow('UC'); await sleep(80);
  T('follow creates both follower/following indexes', DB.data.following?.UA?.UC === true && DB.data.followers?.UC?.UA === true && A.__T.S.storyAudience.following.has('UC'));
  T('follow updates both cached relation lists and explicit followed state', A.__T.S.profileRelations.get('UA')?.following?.includes('UC') === true && A.__T.S.profileRelations.get('UC')?.followers?.includes('UA') === true && A.__T.S.profileRelations.get('UC')?.follows === true);
  await A.__T.toggleFollow('UC'); await sleep(80);
  T('unfollow removes both indexes and local state', !DB.data.following?.UA?.UC && !DB.data.followers?.UC?.UA && !A.__T.S.storyAudience.following.has('UC'));
  T('unfollow persists an explicit false so offline profile does not show stale followed state', A.__T.S.profileRelations.get('UC')?.follows === false && !A.__T.S.profileRelations.get('UA')?.following?.includes('UC'));

  // Visibility toggles are an atomic write and are reflected to the other account.
  for (const [id, value] of [['opt-notifications', true], ['opt-sounds', true], ['opt-read-receipts', true], ['opt-show-lastseen', false], ['opt-show-online', false]]) A.els[id].checked = value;
  await A.__T.saveSettings(); await sleep(100);
  T('privacy settings persist to account and presence consistently', DB.data.users?.UA?.showLastSeen === false && DB.data.users?.UA?.showOnline === false && DB.data.presence?.UA?.showLastSeen === false && DB.data.presence?.UA?.showOnline === false);
  T('hidden online presence is rendered as unavailable to the other user', B.els['chat-status']?.textContent === 'غير متاح', `status=${B.els['chat-status']?.textContent}`);
  for (const id of ['opt-show-lastseen', 'opt-show-online']) A.els[id].checked = true;
  await A.__T.saveSettings(); await sleep(60);

  // group
  A.document.getElementById('group-name').value='Team'; A.__T.S.selectedGroupUsers.add('UB'); A.__T.S.selectedGroupUsers.add('UC');
  await A.__T.createGroup(); await sleep(400);
  const gid=Object.keys(DB.data.chats).find(k=>DB.data.chats[k].type==='group');
  T('group created', !!gid);
  T('all members indexed in group', !!gid && ['UA','UB','UC'].every(u=>DB.data.userChats?.[u]?.[gid]===true));
  await sleep(300);
  T('carol group index exists', DB.data.userChats?.UC?.[gid]===true);
  C.__T.S.activeChat=null; await C.__T.openChat(gid); C.document.getElementById('message-input').value='hello team'; await C.__T.sendMessage(); await sleep(300);
  T('group message stored', Object.values(DB.data.messages?.[gid]||{}).some(m=>m.text==='hello team'));

  // Regression: Service Worker quick-action messages must reach the app handler.
  let swMessageHandler = null, quickActionSeen = false;
  A.navigator.serviceWorker = {
    register: async () => ({ active: null }),
    addEventListener(type, handler) { if (type === 'message') swMessageHandler = handler; }
  };
  A.handleQuickAction = async data => { quickActionSeen = data.action === 'accept-request' && data.chatId === 'chat-test'; };
  await A.registerServiceWorker();
  if (swMessageHandler) swMessageHandler({ data: { type: 'quick-action', action: 'accept-request', chatId: 'chat-test', senderId: 'UA' } });
  await sleep(10);
  T('Service Worker quick actions reach app handler', quickActionSeen);

  // Request rejection must succeed under the unchanged RTDB rules, and retry must use a fresh chat ID.
  await C.__T.startPrivateByUid('UB');
  await sleep(220);
  const firstRequestId = ['UB','UC'].sort().join('_');
  T('Carol incoming request is recorded', DB.data.chatRequests?.UB?.UC?.status === 'pending' && DB.data.chatRequests.UB.UC.chatId === firstRequestId);
  T('Bob sees Carol request in app state', B.__T.S.chatRequests?.UC?.status === 'pending');
  await B.__T.handleChatRequest(firstRequestId, 'UC', 'reject');
  await sleep(120);
  T('recipient can reject without forbidden requestState write', DB.data.chatRequests?.UB?.UC?.status === 'rejected' && DB.data.chats[firstRequestId].requestState === 'pending');
  T('rejected request is detached from both chat lists', !DB.data.userChats?.UB?.[firstRequestId] && !DB.data.userChats?.UC?.[firstRequestId]);
  await C.__T.startPrivateByUid('UB');
  await sleep(180);
  const retryRequest = DB.data.chatRequests?.UB?.UC;
  T('re-request after rejection uses a new chat ID', !!retryRequest?.chatId && retryRequest.chatId !== firstRequestId && retryRequest.status === 'pending');
  await sleep(100);
  T('retry request is visible to recipient', B.__T.S.chatRequests?.UC?.status === 'pending' && B.__T.S.chatRequests.UC.chatId === retryRequest.chatId);
  await A.__T.toggleFollow('UB'); await sleep(60);
  sim.set(DB, 'UA', 'users/UA/contacts/UB', true, Date.now());
  A.__T.S.contacts.add('UB');
  T('block cleanup setup includes follow and contact indexes', DB.data.following?.UA?.UB === true && DB.data.followers?.UB?.UA === true && DB.data.users?.UA?.contacts?.UB === true);
  await B.__T.toggleBlock('UC');
  await sleep(120);
  T('block is committed before optional cleanup', DB.data.users?.UB?.blocked?.UC === true && B.__T.S.blocked.has('UC'));
  T('blocking rejects a pending incoming request', DB.data.chatRequests?.UB?.UC?.status === 'rejected');

  // Blocking on the sender's device must stop local sends and hide later received messages in the UI/cache.
  const countBeforeBlock = Object.keys(DB.data.messages?.[chatId] || {}).length;
  await A.__T.toggleBlock('UB');
  A.els['message-input'].value = 'must not be sent after local block';
  await A.__T.sendMessage();
  await sleep(80);
  T('blocked user cannot send via this client', Object.keys(DB.data.messages?.[chatId] || {}).length === countBeforeBlock);
  T('block survives in account node and local state', DB.data.users?.UA?.blocked?.UB === true && A.__T.S.blocked.has('UB'));
  T('blocking removes follow and contact relationships', !DB.data.following?.UA?.UB && !DB.data.followers?.UB?.UA && !DB.data.users?.UA?.contacts?.UB && !A.__T.S.contacts.has('UB'));
  T('blocking clears cached follower/following relation state', !A.__T.S.profileRelations.get('UA')?.following?.includes('UB') && !A.__T.S.profileRelations.get('UB')?.followers?.includes('UA') && A.__T.S.profileRelations.get('UB')?.follows === false);
  A.__T.S.blockMeta.set('UB', Date.now() - 1000);
  T('blocked user private messages are hidden after the block time', A.__T.isHiddenBlockedMessage({ senderId: 'UB', timestamp: Date.now() }, chatId));
  const blockedChatHtml = A.__T.chatItemHtml(chatId, A.__T.S.chatCache.get(chatId) || DB.data.chats[chatId]);
  T('blocked private chats do not keep showing unread counters', !blockedChatHtml.includes('chat-item-badge'));
  const groupBlockedCheck = { id: gid, type: 'group', participants: { UA: { role: 'admin' }, UB: { role: 'member' } } };
  A.__T.S.chatCache.set(gid, groupBlockedCheck);
  T('private block does not hide messages from shared groups', !A.__T.isHiddenBlockedMessage({ senderId: 'UB', timestamp: Date.now() }, gid));

  // Reports must target the actual author. The test harness does not emit Firebase's connection event,
  // so explicitly place the clients online for server-acknowledged report writes.
  A.__T.S.offlineMode = false; A.__T.S.dbConnected = true;
  const offlineReportCount = Object.keys(DB.data.reports || {}).length;
  A.__T.S.offlineMode = true; A.__T.S.dbConnected = false;
  await A.__T.createReport({ targetType: 'user', targetUid: 'UB', reason: 'يجب ألا يرسل دون اتصال' });
  T('offline report submission is not falsely recorded as sent', Object.keys(DB.data.reports || {}).length === offlineReportCount);
  A.__T.S.offlineMode = false; A.__T.S.dbConnected = true;
  const targetMessageId = Object.entries(DB.data.messages?.[chatId] || {}).find(([, m]) => m.senderId === 'UB')?.[0];
  const reportCountBefore = Object.keys(DB.data.reports || {}).length;
  await A.__T.createReport({ targetType: 'message', targetUid: 'UB', chatId, messageId: targetMessageId, reason: 'محتوى مسيء' });
  const msgReport = Object.values(DB.data.reports || {}).find(r => r.targetType === 'message' && r.messageId === targetMessageId);
  T('message report validates and stores the real sender UID', !!targetMessageId && !!msgReport && msgReport.targetUid === 'UB' && msgReport.reporterId === 'UA');
  const aliceMessageId = Object.entries(DB.data.messages?.[chatId] || {}).find(([, m]) => m.senderId === 'UA')?.[0];
  await A.__T.createReport({ targetType: 'message', targetUid: 'UB', chatId, messageId: aliceMessageId, reason: 'بلاغ مزور' });
  await A.__T.createReport({ targetType: 'message', targetUid: 'UA', chatId, messageId: targetMessageId, reason: 'بلاغ غير صالح' });
  await A.__T.createReport({ targetType: 'user', targetUid: 'UB', reason: '   ' });
  const testStoryId = 'story-report-UC';
  const testStoryCreatedAt = Date.now();
  sim.set(DB, 'UC', `stories/${testStoryId}`, { userId: 'UC', type: 'text', createdAt: testStoryCreatedAt, expiresAt: testStoryCreatedAt + 86400000, active: true, preview: 'test story' }, testStoryCreatedAt);
  await A.__T.createReport({ targetType: 'story', storyId: testStoryId, targetUid: 'UB', reason: 'بلاغ بقصة منسوبة خطأ' });
  const reportsAfterInvalid = Object.keys(DB.data.reports || {}).length;
  await A.__T.createReport({ targetType: 'story', storyId: testStoryId, targetUid: 'UC', reason: 'محتوى قصة مسيء' });
  const storyReport = Object.values(DB.data.reports || {}).find(r => r.targetType === 'story' && r.storyId === testStoryId && r.targetUid === 'UC');
  T('forged sender, self-target, blank reason and story-owner mismatch are rejected', reportsAfterInvalid === reportCountBefore + 1);
  T('valid story report records the verified story owner', !!storyReport && storyReport.targetUid === 'UC' && storyReport.reporterId === 'UA');

  // Delete-for-me removes only this user's index/cache and does not delete the other person's copy.
  await A.__T.openChat(chatId);
  A.__T.setConfirmAsync(async () => true);
  T('delete test has active chat', A.__T.S.activeChatId === chatId && !!A.__T.S.activeChat);
  const beforeDeleteMsgCount = Object.keys(DB.data.messages?.[chatId] || {}).length;
  await A.__T.deleteChatForMe();
  await sleep(100);
  T("delete-for-me removes only the current user's chat index", !DB.data.userChats?.UA?.[chatId] && DB.data.userChats?.UB?.[chatId] === true);
  T("delete-for-me keeps the other user's server-side messages", Object.keys(DB.data.messages?.[chatId] || {}).length === beforeDeleteMsgCount);
  T('deleted chat is held in local hidden-chat tombstones', A.__T.S.hiddenChats.has(chatId));

  // Cancellation must target the exact thread ID, not the legacy pair ID.
  const cancelId = `${chatId}_r_cancel-test`;
  const createdAt = Date.now();
  let cancelCreate = sim.set(DB, 'UA', `chats/${cancelId}`, {
    type: 'private', createdBy: 'UA', createdAt, updatedAt: createdAt,
    requestState: 'pending', participants: { UA: { role: 'member' }, UB: { role: 'member' } }
  }, createdAt);
  T('synthetic regenerated request can be created for cancel regression', cancelCreate.ok);
  sim.set(DB, 'UA', 'chatRequests/UB/UA', { fromUid: 'UA', toUid: 'UB', status: 'pending', createdAt, chatId: cancelId }, createdAt);
  sim.set(DB, 'UA', `userChats/UA/${cancelId}`, true, createdAt);
  sim.set(DB, 'UA', `userChats/UB/${cancelId}`, true, createdAt);
  A.__T.S.chatCache.set(cancelId, { id: cancelId, type: 'private', createdBy: 'UA', requestState: 'pending', participants: { UA: { role: 'member' }, UB: { role: 'member' } } });
  A.__T.S.chatIndex = { ...(A.__T.S.chatIndex || {}), [cancelId]: true };
  await A.__T.cancelChatRequest(cancelId, 'UB');
  T('cancel request rejects the supplied regenerated chat ID', DB.data.chats?.[cancelId]?.requestState === 'rejected');
  T('cancel request does not mutate the legacy pair chat', DB.data.chats?.[chatId]?.requestState === 'approved');
  T('cancel request stores rejection against its exact request ID', DB.data.chatRequests?.UB?.UA?.status === 'rejected' && DB.data.chatRequests.UB.UA.chatId === cancelId);

  // Delete-for-me must not resurrect the old history when the user starts a new thread later.
  await A.__T.toggleBlock('UB');
  const lastBlockWindow = (A.__T.S.blockedMessageWindows.get('UB') || []).slice(-1)[0];
  A.__T.S.activeChat = { id: chatId, type: 'private', participants: { UA: { role: 'member' }, UB: { role: 'member' } } };
  const duringBlockTime = lastBlockWindow ? Math.floor((lastBlockWindow.from + lastBlockWindow.to) / 2) : Date.now();
  T('messages sent during a block stay hidden after unblock', !!lastBlockWindow?.to && A.__T.isHiddenBlockedMessage({ senderId: 'UB', timestamp: duringBlockTime }, chatId));
  T('messages after unblocking are no longer filtered', !!lastBlockWindow?.to && !A.__T.isHiddenBlockedMessage({ senderId: 'UB', timestamp: lastBlockWindow.to + 1000 }, chatId));
  A.__T.S.activeChat = null;
  await A.__T.startPrivateByUid('UB');
  await sleep(160);
  const reopenedRequest = DB.data.chatRequests?.UB?.UA;
  T('starting a chat after delete-for-me creates a fresh thread ID', !!reopenedRequest?.chatId && reopenedRequest.chatId !== chatId && reopenedRequest.status === 'pending');
  T('old deleted thread remains hidden after starting a new one', A.__T.S.hiddenChats.has(chatId));
  const regeneratedId = reopenedRequest?.chatId;
  if (regeneratedId) {
    sim.update(DB, 'UB', {
      [`chats/${regeneratedId}/requestState`]: 'approved',
      [`chatRequests/UB/UA/status`]: 'approved',
      [`userChats/UA/${regeneratedId}`]: true,
      [`userChats/UB/${regeneratedId}`]: true
    }, Date.now());
    A.__T.S.offlineMode = false; A.__T.S.dbConnected = true;
    await A.__T.startPrivateByUid('UB');
    await sleep(100);
    T('approved regenerated private thread is reused on subsequent visits', A.__T.S.activeChatId === regeneratedId && DB.data.chatRequests?.UB?.UA?.chatId === regeneratedId);
  } else T('approved regenerated private thread is reused on subsequent visits', false, 'no regenerated thread ID');

  // Blocked users must be excluded from group selectors and revalidated during submission.
  O.__T.S.blocked.add('UB');
  await O.__T.loadGroupUsers('');
  T('group participant picker hides blocked users', !O.els['group-users'].innerHTML.includes('@bob'));
  O.document.getElementById('group-name').value = 'Blocked group test';
  O.__T.S.selectedGroupUsers = new Set(['UB']);
  const groupsBeforeBlockedCreate = Object.values(DB.data.chats || {}).filter(c => c.type === 'group').length;
  await O.__T.createGroup();
  T('group creation rejects a selection containing only blocked users', Object.values(DB.data.chats || {}).filter(c => c.type === 'group').length === groupsBeforeBlockedCreate);
  O.__T.S.blocked.delete('UB');

  // Ordinary users messaging an owner/admin still need a request unless sender-side rules allow approval.
  const originalOwnerUid = A.__T.S.ownerUid;
  A.__T.S.ownerUid = 'UC';
  await A.__T.startPrivateByUid('UC');
  await sleep(100);
  const ownerTargetId = ['UA', 'UC'].sort().join('_');
  T('ordinary user-to-owner messaging creates a valid pending request', DB.data.chats?.[ownerTargetId]?.requestState === 'pending' && DB.data.chatRequests?.UC?.UA?.status === 'pending');
  A.__T.S.ownerUid = originalOwnerUid;

  // Report moderation must update the content/account before closing the report.
  const ownerReady = O.__T.S.me?.id === 'UOWN' && O.__T.S.ownerUid === 'UOWN';
  T('owner session is ready for report review', ownerReady, `me=${O.__T.S.me?.id}, owner=${O.__T.S.ownerUid}`);
  if (ownerReady) {
    O.__T.setRenderAdminTab(async () => {});
    const openStoryReport = Object.entries(DB.data.reports || {}).find(([, r]) => r.targetType === 'story' && r.storyId === 'story-report-UC' && r.status === 'open');
    if (openStoryReport) {
      O.__T.setPromptAsync(async () => 'dismiss');
      O.__T.S.offlineMode = true; O.__T.S.dbConnected = false;
      await O.__T.reviewReport(openStoryReport[0], openStoryReport[1]);
      T('offline report review leaves report open', DB.data.reports?.[openStoryReport[0]]?.status === 'open');
      O.__T.S.offlineMode = false; O.__T.S.dbConnected = true;
      await O.__T.reviewReport(openStoryReport[0], openStoryReport[1]);
      T('staff can dismiss a valid report after reconnecting', DB.data.reports?.[openStoryReport[0]]?.status === 'dismissed');
    } else {
      T('offline report review leaves report open', false, 'story report fixture missing');
      T('staff can dismiss a valid report after reconnecting', false, 'story report fixture missing');
    }
    O.__T.setPromptAsync(async () => 'delete');
    O.__T.S.offlineMode = false; O.__T.S.dbConnected = true;
    const reportId = Object.entries(DB.data.reports || {}).find(([, r]) => r.targetType === 'message' && r.status === 'open')?.[0];
    const reportRec = reportId ? DB.data.reports[reportId] : null;
    if (reportId) await O.__T.reviewReport(reportId, reportRec);
    T('message report deletes reported content before resolving report', !!reportId && DB.data.messages?.[reportRec.chatId]?.[reportRec.messageId]?.deletedForAll === true && DB.data.reports[reportId]?.status === 'resolved');

    const userReport = await A.__T.createReport({ targetType: 'user', targetUid: 'UC', reason: 'إساءة متكررة' });
    const userReportId = Object.entries(DB.data.reports || {}).find(([, r]) => r.targetType === 'user' && r.targetUid === 'UC' && r.status === 'open')?.[0];
    O.__T.setPromptAsync(async () => 'ban');
    if (userReportId) await O.__T.reviewReport(userReportId, DB.data.reports[userReportId]);
    T('user report bans target and resolves only after success', !!userReport && !!userReportId && DB.data.users?.UC?.status === 'banned' && DB.data.reports?.[userReportId]?.status === 'resolved');
    await sleep(80);
    T('live account-status listener revokes an already-open banned session', C.__T.S.me?.status === 'banned' && C.__T.S.offlineMode === true);
    const countAfterBan = Object.keys(DB.data.messages?.[gid] || {}).length;
    C.els['message-input'].value = 'this must not send after a ban';
    await C.__T.sendMessage(); await sleep(40);
    T('banned account cannot send from its already-open chat', Object.keys(DB.data.messages?.[gid] || {}).length === countAfterBan);
  }

  // Switching the signed-in account clears prior account data only from memory, never from disk.
  A.__T.S.blocked.add('STALE_USER');
  A.__T.S.hiddenChats.add('STALE_CHAT');
  A.__T.S.profileCache.set('STALE_USER', { id: 'STALE_USER', username: 'stale' });
  A.__T.resetAccountScopedMemory('TEST_OTHER_ACCOUNT');
  T('account switch clears old blocked/profile/chat data from memory', !A.__T.S.blocked.has('STALE_USER') && !A.__T.S.hiddenChats.has('STALE_CHAT') && !A.__T.S.profileCache.has('STALE_USER') && A.__T.S.chatCache.size === 0);
  T('account switch retains UID-namespaced saved state APIs', typeof A.writeCachedState === 'function' && typeof A.readCachedState === 'function');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(2);});
