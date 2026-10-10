
const assert=require('node:assert/strict'),fs=require('node:fs'),{deflateSync}=require('node:zlib');
require('reflect-metadata');
const {Reflector}=require('@nestjs/core'),{ValidationPipe,Logger}=require('@nestjs/common');Logger.overrideLogger([]);
const {AccountController}=require('../dist/modules/auth/account.controller'),{AccountService}=require('../dist/modules/auth/account.service');
const {PreferencesDto}=require('../dist/modules/auth/account.dto'),{TenantGuard}=require('../dist/common/guards/tenant.guard');
const {assertMfa,assertRecentMethod,MFA_HANDSHAKE}=require('../dist/common/auth/mfa-policy'),{validateAvatar}=require('../dist/modules/auth/avatar-png');
let checks=0;const check=(v)=>{assert.ok(v);checks++;};
const uid='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222',factor='33333333-3333-4333-8333-333333333333';
const jwt=p=>'e30.'+Buffer.from(JSON.stringify(p)).toString('base64url')+'.test';
const verified=[{id:factor,factor_type:'totp',status:'verified'}];
function crc(b){let n=0xffffffff;for(const v of b){n^=v;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(t,b){const h=Buffer.alloc(8),c=Buffer.alloc(4);h.writeUInt32BE(b.length);h.write(t,4);c.writeUInt32BE(crc(Buffer.concat([Buffer.from(t),b])));return Buffer.concat([h,b,c]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('tEXt',Buffer.from('private metadata')),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
const uri='data:image/png;base64,'+png.toString('base64');
(async()=>{
assert.doesNotThrow(()=>assertMfa([],jwt({aal:'aal1'})));checks++;
assert.throws(()=>assertMfa(verified,jwt({aal:'aal1'})),/MFA_REQUIRED/);checks++;
assert.throws(()=>assertMfa(verified,'broken'),/MFA_REQUIRED/);checks++;
assert.doesNotThrow(()=>assertMfa(verified,jwt({aal:'aal2'})));checks++;
assert.doesNotThrow(()=>assertMfa(verified,jwt({aal:'aal1'}),true));checks++;
assert.throws(()=>assertRecentMethod(jwt({amr:[{method:'password',timestamp:1}]}),'password'));checks++;
assert.throws(()=>assertRecentMethod(jwt({amr:[{method:'password',timestamp:Date.now()/1000}]}),'totp'));checks++;
assert.doesNotThrow(()=>assertRecentMethod(jwt({amr:[{method:'totp',timestamp:Date.now()/1000}]}),'totp'));checks++;
check(!Buffer.from(validateAvatar(uri).slice(22),'base64').includes(Buffer.from('private metadata')));
for(const input of ['https://example.com/private.png','data:image/svg+xml;base64,AAAA',uri+'AAAA','data:image/png;base64,AAAA']){assert.throws(()=>validateAvatar(input));checks++;}
let identities=[],calls=[];
const client={auth:{getUser:async()=>({data:{user:{id:uid,factors:verified}}})},from:(table)=>{const q={select(){return q},eq(col,value){if(col==='user_id')identities.push(value);return q},single:async()=>({data:{name:'Nome oficial',email:'private@example.test'},error:null}),maybeSingle:async()=>({data:null,error:null}),then(resolve){return Promise.resolve({data:[],error:null}).then(resolve)}};return q;},rpc:async(name,input)=>{calls.push({name,input});return {data:input.p_data,error:null};}};
const service=new AccountService({getClient:()=>client},{get:()=>undefined});
const read=await service.preferences(uid);check(read.identity.name==='Nome oficial');check(identities.every(i=>i===uid));
const good={revision:0,theme:'blue',avatar_kind:'initials',emoji:'🙂',photo:'',cep:'',personal_phone:''};
await service.save(uid,good);check(calls[0].input.p_user===uid);check(!('name' in calls[0].input.p_data));
const pipe=new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true});
for(const bad of [{...good,user_id:foreign},{...good,name:'Troca indevida'},{...good,organization_id:foreign},{...good,theme:'unknown'},{...good,revision:-1}]){await assert.rejects(()=>pipe.transform(bad,{type:'body',metatype:PreferencesDto}));checks++;}
await assert.rejects(()=>service.challenge(uid,jwt({aal:'aal1'}),foreign),/não pertence/);checks++;
await assert.rejects(()=>service.enroll(uid,jwt({aal:'aal2',amr:[{method:'password',timestamp:1}]})));checks++;
await assert.rejects(()=>service.remove(uid,jwt({aal:'aal2',amr:[{method:'password',timestamp:Date.now()/1000}]}),factor));checks++;
const controller=new AccountController({save:(u,d)=>({u,d})});check(controller.save({authenticatedUser:{userId:uid}},good).u===uid);
const reflector=new Reflector();
for(const method of ['status','challenge','verify'])check(reflector.get(MFA_HANDSHAKE,AccountController.prototype[method])===true);
for(const method of ['preferences','save','enroll','remove'])check(!reflector.get(MFA_HANDSHAKE,AccountController.prototype[method]));
// Real global guard: MFA must reject before recovery/organization/platform resolution.
const req={headers:{authorization:'Bearer '+jwt({aal:'aal1'})},path:'/auth/account/preferences',method:'GET'};
let queried=0;
const guardClient={auth:client.auth,from(){queried++;return {select(){return this},eq(){return this},single:async()=>({data:{organization_id:'org'},error:null})}}};
const guard=new TenantGuard(reflector,{getClient:()=>guardClient});
const ctx=h=>({getHandler:()=>h,getClass:()=>AccountController,switchToHttp:()=>({getRequest:()=>req})});
await assert.rejects(()=>guard.canActivate(ctx(AccountController.prototype.preferences)),/MFA_REQUIRED/);checks++;check(queried===0);
check(await guard.canActivate(ctx(AccountController.prototype.status)));check(req.authenticatedUser.userId===uid);check(queried===1);
// Cadastro unavailable: fail closed, never substitute another user or stale public data.
client.from=()=>({select(){return this},eq(){return this},single:async()=>({error:{message:'down'}}),maybeSingle:async()=>({error:{message:'down'}}),then:r=>Promise.resolve({error:{message:'down'}}).then(r)});
await assert.rejects(()=>service.preferences(uid),/consultar/);checks++;
console.log('Account / MFA / avatar isolation:',checks,'checks passed');
})().catch(e=>{console.error(e);process.exit(1)});
