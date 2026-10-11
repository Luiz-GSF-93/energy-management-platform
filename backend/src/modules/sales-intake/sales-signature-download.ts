import {lookup} from 'node:dns/promises';
import {request,RequestOptions} from 'node:https';
import {isIP} from 'node:net';

/** Only explicit origins approved for this environment. No wildcard or inferred S3 bucket. */
export function signatureDownloadOrigins(value:unknown):string[]{
 if(typeof value!=='string'||!value.trim())throw Error('Download origins not configured');
 const origins=value.split(',');
 if(origins.length>5)throw Error('Too many origins');
 return origins.map(v=>{
  const s=v.trim(),u=new URL(s);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||isIP(u.hostname)||u.hostname.endsWith('.')||!/^([a-z0-9-]+\.)+[a-z0-9-]+$/.test(u.hostname)||s!==u.origin)throw Error('Invalid download origin');
  return u.origin;
 });
}
export function signatureDownloadUrl(value:unknown,origins:string[]):URL{
 if(typeof value!=='string'||value.length>16000||/[\x00-\x20\x7f\\]/.test(value))throw Error('Invalid download URL');
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!origins.includes(u.origin)||isIP(u.hostname)||u.hostname.endsWith('.'))throw Error('Download origin denied');
 return u;
}
// Restrict connection to globally routed IPv4. IPv6-only origins fail closed until supported.
export function signaturePublicIPv4(address:string):boolean{
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export async function signatureDownloadPdf(u:URL):Promise<Buffer>{
 const signal=AbortSignal.timeout(10000);
 // Timeout covers DNS as well as connect/body; do not resolve again at connection time.
 const addresses=await Promise.race([
  lookup(u.hostname,{all:true}),
  new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(Error('Download timeout')),{once:true})),
 ]);
 if(!addresses.length||addresses.some(a=>!signaturePublicIPv4(a.address)))throw Error('Download address denied');
 const address=addresses[0].address;
 return new Promise((resolve,reject)=>{
  const options:RequestOptions&{autoSelectFamily:boolean}={
   method:'GET',agent:false,family:4,autoSelectFamily:false,signal,headers:{Accept:'application/pdf','Accept-Encoding':'identity'},
   // TLS checks the original hostname; lookup pins the verified address, preventing rebinding.
   lookup:((_host:unknown,_options:unknown,callback:any)=>callback(null,address,4)) as any,
  };
  const req=request(u,options,res=>{
   const type=String(res.headers['content-type']??'').split(';')[0].trim().toLowerCase();
   const length=res.headers['content-length'];
   if(res.statusCode!==200||type!=='application/pdf'||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'||length!==undefined&&(!/^\d+$/.test(length)||Number(length)>1048576)){
    res.destroy();req.destroy();reject(Error('Invalid PDF response'));return;
   }
   let size=0;const chunks:Buffer[]=[];
   res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>1048576){res.destroy();req.destroy();reject(Error('PDF too large'));}else chunks.push(chunk);});
   res.on('end',()=>{if(!res.complete||length!==undefined&&Number(length)!==size){reject(Error('Truncated PDF'));return;}resolve(Buffer.concat(chunks));});
   res.on('error',()=>reject(Error('PDF transfer failed')));
   res.on('aborted',()=>reject(Error('PDF transfer aborted')));
  });
  req.on('error',()=>reject(Error('PDF connection failed')));req.end();
 });
}
