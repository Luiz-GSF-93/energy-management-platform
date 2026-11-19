import https from 'node:https';
import {lookup as dnsLookup}from'node:dns/promises';
import {publicAddress}from'./official-sources.mjs';
// Exact vendor endpoints only: documented legacy CDN and the current Resend dashboard CDN.
export function receivedAttachmentUrl(detail,emailId,{maxBytes=20971520}={}){
 const u=new URL(detail.download_url);
 const paths={'inbound-cdn.resend.com':`/${emailId}/attachments/${detail.id}`,'cdn.resend.app':`/receiving/${emailId}/attachments/${detail.id}`};
 if(!/^[a-f0-9-]{36}$/i.test(emailId)||!/^[a-f0-9-]{36}$/i.test(detail.id)||u.protocol!=='https:'||!Object.hasOwn(paths,u.hostname)||u.port&&u.port!=='443'||u.username||u.password||u.hash||u.pathname!==paths[u.hostname]||!Number.isInteger(detail.size)||detail.size<1||detail.size>maxBytes)throw Error('MAIL_ATTACHMENT_SOURCE');
 return u;
}
export async function downloadReceivedAttachment(detail,emailId,{lookup=dnsLookup,request=https.get,maxBytes=20971520}={}){
 const u=receivedAttachmentUrl(detail,emailId,{maxBytes});
 const addresses=await lookup(u.hostname,{all:true,verbatim:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('MAIL_ATTACHMENT_ADDRESS');
 const pinned=addresses[0];return new Promise((resolve,reject)=>{
  const req=request(u,{family:pinned.family,autoSelectFamily:false,lookup:(host,options,cb)=>cb(null,pinned.address,pinned.family),headers:{'Accept-Encoding':'identity'},timeout:15000},res=>{
   if(res.statusCode!==200||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.resume();return reject(Error('MAIL_ATTACHMENT_HTTP'));}
   let size=0;const parts=[];res.on('data',part=>{size+=part.length;if(size>maxBytes||size>detail.size){res.destroy();reject(Error('MAIL_ATTACHMENT_LIMIT'));}else parts.push(part);});
   res.on('error',()=>reject(Error('MAIL_ATTACHMENT_READ')));res.on('end',()=>size===detail.size?resolve(Buffer.concat(parts)):reject(Error('MAIL_ATTACHMENT_SIZE')));
  });req.on('timeout',()=>req.destroy(Error('MAIL_ATTACHMENT_TIMEOUT')));req.on('error',()=>reject(Error('MAIL_ATTACHMENT_UNAVAILABLE')));
 });
}
