import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createResendProvider,ResendFailure} from './resend-provider.mjs';
import {createProjectZip} from './project-package.mjs';
import {downloadReceivedAttachment,receivedAttachmentUrl} from './mail-attachments.mjs';

test('PEE shares Resend capacity with at most two request starts per second',async()=>{
 let clock=0;const starts=[],delays=[],provider=createResendProvider({key:'synthetic-only-key'},{now:()=>clock,pause:async ms=>{delays.push(ms);await new Promise(resolve=>setImmediate(resolve));clock+=ms;},fetcher:async()=>{starts.push(clock);return Response.json({id:randomUUID()});}});
 await Promise.all(Array.from({length:4},()=>provider.outgoing(randomUUID())));
 assert.deepEqual(starts,[0,500,1000,1500]);assert.deepEqual(delays,[500,500,500]);
});
test('Resend throttling honors Retry-After without replaying a network mutation',async()=>{
 let clock=0,calls=0;const starts=[],provider=createResendProvider({key:'synthetic-only-key'},{now:()=>clock,pause:async ms=>{clock+=ms;},fetcher:async()=>{starts.push(clock);return ++calls===1?new Response('',{status:429,headers:{'retry-after':'3'}}):Response.json({id:randomUUID()});}});
 await assert.rejects(provider.outgoing(randomUUID()),e=>e.code==='RESEND_HTTP_429'&&e.retryable&&!e.uncertain);
 assert.equal(calls,1);await provider.outgoing(randomUUID());assert.deepEqual(starts,[0,3000]);
});
test('long provider cooldowns fail promptly instead of leaving an HTTP request open',async()=>{
 let calls=0;const provider=createResendProvider({key:'synthetic-only-key'},{now:()=>0,pause:async()=>{throw Error('Must not wait');},fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'3600'}});}});
 await assert.rejects(provider.outgoing(randomUUID()),ResendFailure);await assert.rejects(provider.outgoing(randomUUID()),e=>e.code==='RESEND_COOLDOWN');assert.equal(calls,1);
});
test('packages reject traversal and duplicate names and preserve deterministic ZIP bytes',()=>{
 for(const name of ['/absolute','../outside','anexos/../../outside','anexos\\outside','a//b'])assert.throws(()=>createProjectZip([{name,bytes:Buffer.from('x')}]));
 assert.throws(()=>createProjectZip([{name:'same',bytes:[]},{name:'same',bytes:[]}]))
 const files=[{name:'anexos/ação.txt',bytes:Buffer.from('conteúdo')}];assert.deepEqual(createProjectZip(files),createProjectZip(files));
});
test('receiving attachments reject foreign hosts, mismatched paths and private DNS before download',async()=>{
 const email=randomUUID(),id=randomUUID(),detail={id,size:10,download_url:`https://inbound-cdn.resend.com/${email}/attachments/${id}?token=synthetic`};let requests=0;
 const options={lookup:async()=>[{address:'127.0.0.1',family:4}],request:()=>{requests++;throw Error('No network');}};
 await assert.rejects(downloadReceivedAttachment(detail,email,options),/MAIL_ATTACHMENT_ADDRESS/);
 await assert.rejects(downloadReceivedAttachment({...detail,download_url:'https://attacker.invalid/file'},email,options),/MAIL_ATTACHMENT_SOURCE/);
 await assert.rejects(downloadReceivedAttachment(detail,randomUUID(),options),/MAIL_ATTACHMENT_SOURCE/);assert.equal(requests,0);
});
test('current and legacy Resend attachment CDNs require the exact same email and attachment IDs',()=>{
 const email=randomUUID(),id=randomUUID(),base={id,size:123};
 for(const download_url of [`https://inbound-cdn.resend.com/${email}/attachments/${id}?signature=synthetic`,`https://cdn.resend.app/receiving/${email}/attachments/${id}?signature=synthetic`])assert.equal(receivedAttachmentUrl({...base,download_url},email).protocol,'https:');
 for(const download_url of [`https://cdn.resend.app.evil.invalid/receiving/${email}/attachments/${id}`,`https://cdn.resend.app/receiving/${randomUUID()}/attachments/${id}`,`https://cdn.resend.app/receiving/${email}/attachments/${randomUUID()}`,`https://cdn.resend.app/${email}/attachments/${id}`,`http://cdn.resend.app/receiving/${email}/attachments/${id}`])assert.throws(()=>receivedAttachmentUrl({...base,download_url},email),/MAIL_ATTACHMENT_SOURCE/);
});
