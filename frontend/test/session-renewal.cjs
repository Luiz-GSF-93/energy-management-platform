/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness transpiles source without a browser bundler. */
/* global require, __dirname, global, Buffer, setTimeout, console, process */
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('typescript');
const loaded={};
function load(relative){const file=path.resolve(__dirname,'../app',relative);if(loaded[file])return loaded[file].exports;const mod={exports:{}};loaded[file]=mod;const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;new Function('require','module','exports',js)(name=>load(path.relative(path.resolve(__dirname,'../app'),path.resolve(path.dirname(file),name+'.ts'))),mod,mod.exports);return mod.exports;}
const values=new Map();const events=[];
global.window={localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},sessionStorage:{removeItem:()=>{}},dispatchEvent:e=>events.push(e.type)};
global.CustomEvent=class {constructor(type,options){this.type=type;this.detail=options.detail;}};
Object.defineProperty(global,'navigator',{value:{locks:{request:async(_,fn)=>fn()}},configurable:true});
const {session}=load('lib/auth/session.ts');const {freshToken}=load('lib/auth/renew.ts');
const jwt=(user,seconds)=>'e30.'+Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+seconds})).toString('base64url')+'.signature';
(async()=>{
 let calls=0;const next=jwt('one',3600);
 session.setTokens({access_token:jwt('one',30),refresh_token:'old'});session.expectUser('one');
 global.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,15));return {ok:true,json:async()=>({access_token:next,refresh_token:'rotated'})};};
 const results=await Promise.all([freshToken(),freshToken(),freshToken()]);assert.equal(calls,1);assert.deepEqual(results,[next,next,next]);assert.equal(values.get('refresh_token'),'rotated');
 await freshToken();assert.equal(calls,1);
 session.setTokens({access_token:jwt('two',3600),refresh_token:'other'});await assert.rejects(freshToken(),/conta mudou/);assert.equal(calls,1);
 session.setTokens({access_token:jwt('one',-5)});await assert.rejects(freshToken(),/Entre novamente/);assert(events.includes('session-attention'));
 session.setTokens({access_token:jwt('one',90)});assert.equal(await freshToken(),session.getAccessToken());
 await assert.rejects(freshToken(true),/Entre novamente/);
 session.setTokens({access_token:jwt('one',30),refresh_token:'retain'});global.fetch=async()=>({ok:false,status:503});await assert.rejects(freshToken(),/conexão/);assert.equal(values.get('refresh_token'),'retain');
 global.fetch=async()=>({ok:true,json:async()=>({access_token:jwt('two',3600),refresh_token:'wrong'})});await assert.rejects(freshToken(),/inválida/);assert.equal(values.get('refresh_token'),'retain');
 let finish;global.fetch=()=>new Promise(resolve=>{finish=resolve;});const late=freshToken();session.clear();finish({ok:true,json:async()=>({access_token:next,refresh_token:'late'})});await assert.rejects(late,/mudou/);assert.equal(session.getAccessToken(),null);
 console.log('PASS session renewal: single flight, valid token reuse, account isolation, legacy expiry warning, transient recovery, response identity, logout race');
})().catch(e=>{console.error(e);process.exitCode=1;});
