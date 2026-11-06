// Minimal Firebase RTDB security-rules simulator (enough for this project's rules)
String.prototype.matches = function(re){ return re.test(this); };
const clone = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
const getAt = (root, path) => { let c = root; for (const k of path) { if (c == null || typeof c !== 'object') return undefined; c = c[k]; } return c; };
const setAt = (root, path, val) => {
  if (!path.length) return val;
  let c = root; for (let i=0;i<path.length-1;i++){ if (c[path[i]]==null || typeof c[path[i]]!=='object') c[path[i]]={}; c=c[path[i]]; }
  const k=path[path.length-1]; if (val===null||val===undefined) delete c[k]; else c[k]=val;
  return root;
};
const prune = o => { if (o && typeof o==='object'){ for (const k of Object.keys(o)){ const v=prune(o[k]); if (v===null||v===undefined||(typeof v==='object'&&!Object.keys(v).length)) delete o[k]; } } return o; };
class Snap {
  constructor(rootGetter, path){ this.r=rootGetter; this.p=path; }
  _v(){ const v=getAt(this.r(), this.p); return v===undefined?null:v; }
  child(x){ const parts=String(x).split('/').filter(Boolean); return new Snap(this.r, this.p.concat(parts)); }
  parent(){ if(!this.p.length) throw new Error('no parent'); return new Snap(this.r, this.p.slice(0,-1)); }
  val(){ return this._v(); }
  exists(){ return this._v()!==null; }
  hasChild(k){ return this.child(k).exists(); }
  hasChildren(keys){ const v=this._v(); if(v===null||typeof v!=='object') return false; if(!keys) return Object.keys(v).length>0; return keys.every(k=>v[k]!==undefined&&v[k]!==null); }
  isString(){ return typeof this._v()==='string'; }
  isNumber(){ return typeof this._v()==='number'; }
  isBoolean(){ return typeof this._v()==='boolean'; }
}
function evalExpr(expr, ctx){
  const names=Object.keys(ctx);
  const fn=new Function(...names, `return (${expr});`);
  try { return fn(...names.map(n=>ctx[n])) === true; } catch(e){ return false; }
}
function makeSim(rules){
  const R=rules.rules;
  function matchChild(node,key,vars){
    if (node && Object.prototype.hasOwnProperty.call(node,key) && !key.startsWith('.')) return {node:node[key],vars};
    for (const k of Object.keys(node||{})) if (k.startsWith('$')) return {node:node[k],vars:{...vars,[k]:key}};
    return null;
  }
  function ctxFor(pre, post, uid, now, vars, path){
    return {auth: uid?{uid}:null, now, root:new Snap(()=>pre,[]), data:new Snap(()=>pre,path), newData:new Snap(()=>post,path), ...vars};
  }
  function validateSubtree(node, vars, path, pre, post, uid, now, out){
    const nv=getAt(post,path);
    if (nv===undefined||nv===null) return true;
    if (node['.validate']!==undefined){ if(!evalExpr(node['.validate'], ctxFor(pre,post,uid,now,vars,path))) { out.push('validate@/'+path.join('/')); return false; } }
    if (nv && typeof nv==='object'){
      for (const k of Object.keys(nv)){ const m=matchChild(node,k,vars); if(m && !validateSubtree(m.node,m.vars,path.concat(k),pre,post,uid,now,out)) return false; }
    }
    return true;
  }
  // check one location write
  function checkWrite(pre, post, uid, now, path, out){
    let node=R, vars={}, allowed=false;
    for (let i=0;i<=path.length;i++){
      const cur=path.slice(0,i);
      if (node['.write']!==undefined && evalExpr(node['.write'], ctxFor(pre,post,uid,now,vars,cur))) allowed=true;
      if (i<path.length){
        // ancestor validate
        if (node['.validate']!==undefined && getAt(post,cur)!=null && !evalExpr(node['.validate'], ctxFor(pre,post,uid,now,vars,cur))) { out.push('validate@/'+cur.join('/')); return false; }
        const m=matchChild(node,path[i],vars); if(!m){ node=null; break; } node=m.node; vars=m.vars;
      }
    }
    if (!allowed){ out.push('write denied @/'+path.join('/')); return false; }
    if (node && !validateSubtree(node,vars,path,pre,post,uid,now,out)) return false;
    return true;
  }
  return {
    // writes: {path: value}; supports {'.sv':'timestamp'} and increments
    update(db, uid, writes, now=Date.now()){
      const pre=clone(db.data)||{}; let post=clone(pre);
      const resolve=(v,path)=>{
        if (v && typeof v==='object'){
          if (v['.sv']==='timestamp') return now;
          if (v['.sv'] && v['.sv'].increment!==undefined){ const cur=getAt(pre,path); return (typeof cur==='number'?cur:0)+v['.sv'].increment; }
          const o=Array.isArray(v)?[]:{}; for(const k of Object.keys(v)) o[k]=resolve(v[k],path.concat(k)); return o;
        }
        return v;
      };
      const entries=Object.entries(writes).map(([p,v])=>[p.split('/').filter(Boolean),v]);
      for (const [p,v] of entries) post=setAt(post,p,v===null?null:resolve(v,p)) ?? post;
      prune(post);
      const out=[];
      for (const [p] of entries){ if(!checkWrite(pre,post,uid,now,p,out)) return {ok:false,why:out.join('; ')}; }
      db.data=post; return {ok:true};
    },
    set(db,uid,path,val,now){ return this.update(db,uid,{[path]:val},now); },
    read(db,uid,path,now=Date.now(),query){
      const pre=db.data; const p=path.split('/').filter(Boolean);
      let node=R, vars={};
      for (let i=0;i<=p.length;i++){
        const cur=p.slice(0,i);
        if (node['.read']!==undefined){ const c=ctxFor(pre,pre,uid,now,vars,cur); c.query=query||{}; if(evalExpr(node['.read'],c)) return true; }
        if (i<p.length){ const m=matchChild(node,p[i],vars); if(!m) return false; node=m.node; vars=m.vars; }
      }
      return false;
    }
  };
}
module.exports={makeSim};
