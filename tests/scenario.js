const {makeSim}=require('./rules_sim.js');
const rulesFile=process.argv[2];
const sim=makeSim(JSON.parse(require('fs').readFileSync(rulesFile,'utf8')));
const db={data:{}}; const TS={'.sv':'timestamp'}; const INC=n=>({'.sv':{increment:n}});
let pass=0, fail=0;
const T=(name,res,expect=true)=>{ const ok=res.ok===expect; ok?pass++:fail++; console.log((ok?'PASS ':'FAIL ')+name+(ok?'':'  -> '+(res.why||'(unexpectedly allowed)'))); };
let tAt=1_800_000_000_000;
const tick=()=> (tAt+=1000);

function register(uid, username, device){
  const base=tick();
  const user={id:uid,username,role:'user',status:'active',coins:0,deviceId:device,createdAt:base,lastSeen:base,showOnline:true,showLastSeen:true,registrationComplete:false,settings:{notifications:true,sounds:true,readReceipts:true,showLastSeen:true,showOnline:true}};
  let r;
  r=sim.set(db,uid,`users/${uid}`,user,base); if(!r.ok) return {ok:false,why:'users: '+r.why};
  r=sim.set(db,uid,`usernames/${username}`,uid,base); if(!r.ok) return {ok:false,why:'usernames: '+r.why};
  r=sim.set(db,uid,`profiles/${uid}`,{username,bio:'',avatar:'',verified:false,active:true,createdAt:base},base); if(!r.ok) return {ok:false,why:'profiles: '+r.why};
  r=sim.set(db,uid,`presence/${uid}`,{online:true,lastSeen:base,showOnline:true,showLastSeen:true},base); if(!r.ok) return {ok:false,why:'presence: '+r.why};
  r=sim.set(db,uid,`devices/${device}/users/${uid}`,true,base); if(!r.ok) return {ok:false,why:'devices: '+r.why};
  if (username==='data'){
    r=sim.set(db,uid,'config/ownerUid',uid,base); if(!r.ok) return {ok:false,why:'ownerUid: '+r.why};
    r=sim.set(db,uid,`users/${uid}/role`,'owner',base); if(!r.ok) return {ok:false,why:'owner role: '+r.why};
    r=sim.set(db,uid,`profiles/${uid}/verified`,true,base); if(!r.ok) return {ok:false,why:'verified: '+r.why};
    r=sim.set(db,uid,'config/app',{appName:'Ghost Caffee',maxAccountsPerDevice:3,allowRegistration:true,schemaVersion:10},base); if(!r.ok) return {ok:false,why:'config/app: '+r.why};
  }
  r=sim.set(db,uid,`users/${uid}/registrationComplete`,true,base); if(!r.ok) return {ok:false,why:'complete: '+r.why};
  return {ok:true};
}
T('register owner "data"',register('UOWN','data','dev-1'));
T('register user alice',register('UA','alice','dev-2'));
T('register user bob',register('UB','bob','dev-3'));
T('register carol',register('UC','carol','dev-4'));

// ---- private chat creation exactly like startPrivateByUid
const id=['UA','UB'].sort().join('_');
let r=sim.set(db,'UA',`chats/${id}`,{type:'private',createdBy:'UA',createdAt:TS,updatedAt:TS,requestState:'pending',participants:{UA:{role:'member'},UB:{role:'member'}}},tick());
T('create private chat request',r);
r=sim.set(db,'UA',`chatRequests/UB/UA`,{fromUid:'UA',toUid:'UB',status:'pending',createdAt:tick(),chatId:id},tick());
T('create message request',r);
r=sim.update(db,'UB',{[`chatRequests/UB/UA/status`]:'approved',[`chats/${id}/requestState`]:'approved'},tick());
T('B approves message request',r);
r=sim.update(db,'UA',{[`userChats/UA/${id}`]:true,[`userChats/UB/${id}`]:true},tick());
T('index chat for BOTH users',r);

// ---- send a text message exactly like sendMessage (long text -> preview sliced to 500)
const send=(uid,chat,text,extra={})=>{
  const mid='m'+Math.random().toString(36).slice(2,8);
  const rec={senderId:uid,timestamp:TS,status:'sent',type:'text',text,...extra};
  const parts=Object.keys((db.data.chats[chat]||{participants:{}}).participants).filter(x=>x!==uid);
  const up={[`messages/${chat}/${mid}`]:rec,[`chats/${chat}/lastMessage`]:{senderId:uid,text:text.slice(0,500),type:rec.type},[`chats/${chat}/updatedAt`]:TS};
  parts.forEach(t=>up[`chats/${chat}/unreadCount/${t}`]=INC(1));
  const res=sim.update(db,uid,up,tick()); res.mid=mid; return res;
};
let m1=send('UA',id,'مرحبا');
T('send text A->B',m1);
T('send 4000-char text (preview sliced)',send('UA',id,'x'.repeat(4000)));
T('send reply',(()=>{const mid='mr';return sim.update(db,'UB',{[`messages/${id}/${mid}`]:{senderId:'UB',timestamp:TS,status:'sent',type:'text',text:'رد',replyTo:{messageId:m1.mid,senderId:'UA',text:'مرحبا'}},[`chats/${id}/lastMessage`]:{senderId:'UB',text:'رد',type:'text'},[`chats/${id}/updatedAt`]:TS,[`chats/${id}/unreadCount/UA`]:INC(1)},tick());})());
T('send image message',send('UA',id,'',{type:'image',fileData:{name:'a.jpg',size:1000,mime:'image/jpeg',dataUrl:'data:image/jpeg;base64,AAAA'}}));
T('send file with empty caption removed',(()=>{const mid='mf';return sim.update(db,'UA',{[`messages/${id}/${mid}`]:{senderId:'UA',timestamp:TS,status:'sent',type:'file',fileData:{name:'a.pdf',size:10,mime:'application/pdf',dataUrl:'data:application/pdf;base64,AAAA'}},[`chats/${id}/lastMessage`]:{senderId:'UA',text:'📎 a.pdf',type:'file'},[`chats/${id}/updatedAt`]:TS},tick());})());

// ---- receipts / reactions / edit / delete
T('B marks delivered+read',sim.update(db,'UB',{[`messages/${id}/${m1.mid}/deliveredTo/UB`]:TS,[`messages/${id}/${m1.mid}/readBy/UB`]:TS},tick()));
T('B resets own unread',sim.set(db,'UB',`chats/${id}/unreadCount/UB`,0,tick()));
T('B reacts',sim.set(db,'UB',`messages/${id}/${m1.mid}/reactions/UB`,'👍',tick()));
T('B stars',sim.set(db,'UB',`messages/${id}/${m1.mid}/starred/UB`,true,tick()));
T('A edits own text',sim.update(db,'UA',{[`messages/${id}/${m1.mid}/text`]:'مرحبا (معدل)',[`messages/${id}/${m1.mid}/edited`]:true},tick()));
T('B cannot edit A text',sim.set(db,'UB',`messages/${id}/${m1.mid}/text`,'hack',tick()),false);
T('B hides message for himself',sim.set(db,'UB',`messages/${id}/${m1.mid}/deletedFor/UB`,true,tick()));
T('A deletes for all',sim.set(db,'UA',`messages/${id}/${m1.mid}/deletedForAll`,true,tick()));
T('outsider C cannot send',(()=>{const mid='mx';return sim.update(db,'UC',{[`messages/${id}/${mid}`]:{senderId:'UC',timestamp:TS,type:'text',text:'x'}},tick());})(),false);
T('outsider C cannot read chat',{ok:sim.read(db,'UC',`messages/${id}`)},false);
T('member B can read chat',{ok:sim.read(db,'UB',`messages/${id}`)});
T('typing indicator',sim.set(db,'UA',`typing/${id}/UA`,true,tick()));
T('pin/mute/archive own',sim.update(db,'UA',{[`chats/${id}/pinned/UA`]:true,[`chats/${id}/muted/UA`]:true,[`chats/${id}/archived/UA`]:false},tick()));

// ---- group
const gid='G1';
const parts={UA:{role:'admin'},UB:{role:'member'},UC:{role:'member'}};
r=sim.set(db,'UA',`chats/${gid}`,{type:'group',name:'Team',createdBy:'UA',createdAt:TS,updatedAt:TS,participants:parts,groupAdmins:{UA:true}},tick());
T('create group (with groupAdmins)',r);
T('index group for all members',sim.update(db,'UA',{[`userChats/UA/${gid}`]:true,[`userChats/UB/${gid}`]:true,[`userChats/UC/${gid}`]:true},tick()));
T('member sends in group',send('UB',gid,'hi group'));
T('member leaves group',(()=>{let a=sim.set(db,'UC',`chats/${gid}/participants/UC`,null,tick()); if(!a.ok) return a; return sim.set(db,'UC',`userChats/UC/${gid}`,null,tick());})());

// ---- stories
const sid='S1';
T('story meta',sim.set(db,'UA',`stories/${sid}`,{userId:'UA',type:'text',createdAt:tAt,expiresAt:tAt+86400000,active:false},tAt));
T('story content',sim.set(db,'UA',`storyContents/${sid}`,{text:'hello'},tAt));
T('story activate',sim.update(db,'UA',{[`stories/${sid}/active`]:true},tAt));
T('B follows story owner',sim.update(db,'UB',{[`following/UB/UA`]:true,[`followers/UA/UB`]:true},tAt));
T('story view by B views',sim.set(db,'UB',`storyViews/${sid}/UB`,TS,tAt));
T('story view by B index',sim.set(db,'UB',`storyViewedByUser/UB/${sid}`,TS,tAt));
T('stories query (startAt = clientNow-5min)',{ok:sim.read(db,'UB','stories',tAt,{orderByChild:'expiresAt',startAt:tAt-300000,limitToLast:200,limitToFirst:null})});
T('stories query remains available even with client clock skew',{ok:sim.read(db,'UB','stories',tAt,{orderByChild:'expiresAt',startAt:(tAt-3000)-86400000,limitToLast:200,limitToFirst:null})});

// ---- admin
T('owner bans bob',sim.update(db,'UOWN',{[`users/UB/status`]:'banned',[`users/UB/banReason`]:'x',[`users/UB/bannedAt`]:TS,[`users/UB/bannedBy`]:'UOWN',[`profiles/UB/active`]:false},tick()));
T('owner unbans bob (bannedBy=null)',sim.update(db,'UOWN',{[`users/UB/status`]:'active',[`users/UB/banReason`]:null,[`users/UB/bannedAt`]:null,[`users/UB/bannedBy`]:null,[`profiles/UB/active`]:true},tick()));
T('user cannot ban others',sim.set(db,'UA','users/UC/status','banned',tick()),false);
T('user cannot self-promote',sim.set(db,'UA','users/UA/role','admin',tick()),false);
T('settings save',sim.set(db,'UA','users/UA/settings',{notifications:true,sounds:true,readReceipts:false,showLastSeen:true,showOnline:true},tick()));
console.log(`\n${pass} passed, ${fail} failed`);
