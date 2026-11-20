import test from'node:test';import assert from'node:assert/strict';import{installContentProtection}from'./web/content-protection.mjs';import{networkAddress}from'./network-address.mjs';
test('browser privacy masks on blur and does not unmask an unfocused visible window',()=>{
 const classes=new Set(),doc=new EventTarget(),win=new EventTarget(),events=[];let focused=true,removed=false;
 Object.assign(doc,{hidden:false,hasFocus:()=>focused,documentElement:{classList:{add:x=>classes.add(x),remove:(...xs)=>xs.forEach(x=>classes.delete(x))}},createElement:()=>({setAttribute(){},remove(){removed=true;}}),body:{append(){}}});Object.assign(win,{setInterval:()=>1,clearInterval(){}});
 const stop=installContentProtection({identity:{content_protection_enabled:true,display_name:'User',email:'user@invalid.example'},document:doc,window:win,report:x=>events.push(x)});
 focused=false;win.dispatchEvent(new Event('blur'));assert.ok(classes.has('private-screen'));doc.dispatchEvent(new Event('visibilitychange'));assert.ok(classes.has('private-screen'));
 focused=true;win.dispatchEvent(new Event('focus'));assert.equal(classes.has('private-screen'),false);
 const copy=new Event('copy',{cancelable:true});doc.dispatchEvent(copy);assert.equal(copy.defaultPrevented,true);assert.ok(events.includes('copy_command_blocked'));stop();assert.equal(removed,true);
});
test('client IP is accepted only from the configured Railway environment and a valid ingress address',()=>{
 const req={socket:{remoteAddress:'127.0.0.1'},headers:{'x-real-ip':'203.0.113.7','x-forwarded-for':'attacker-supplied'}};
 assert.equal(networkAddress(req,{}),'127.0.0.1');assert.equal(networkAddress(req,{RAILWAY_ENVIRONMENT_ID:'fixture'}),'203.0.113.7');req.headers['x-real-ip']='x\r\nInjected';assert.equal(networkAddress(req,{RAILWAY_ENVIRONMENT_ID:'fixture'}),'127.0.0.1');
});
