import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {AccessFailure} from './core-transport.mjs';
export function createSealer(encodedKey,{now=Date.now}={}){
 if(typeof encodedKey!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(encodedKey))throw Error('Dedicated cookie encryption key required');
 const key=Buffer.from(encodedKey,'base64url');if(key.length!==32||key.toString('base64url')!==encodedKey)throw Error('Invalid cookie encryption key');
 const bound=kind=>kind==='session'?900:300;
 return {
  seal(kind,value,seconds){if(!['state','session'].includes(kind)||!Number.isInteger(seconds)||seconds<1||seconds>bound(kind))throw Error('Invalid session policy');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('energyos-pee:'+kind));const encrypted=Buffer.concat([cipher.update(JSON.stringify({version:1,kind,value,expires:now()+seconds*1000}),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');},
  open(kind,sealed){try{if(!['state','session'].includes(kind)||typeof sealed!=='string'||sealed.length<60||sealed.length>3500||!/^[A-Za-z0-9_-]+$/.test(sealed))throw Error();const raw=Buffer.from(sealed,'base64url'),decipher=createDecipheriv('aes-256-gcm',key,raw.subarray(0,12));decipher.setAAD(Buffer.from('energyos-pee:'+kind));decipher.setAuthTag(raw.subarray(12,28));const payload=JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString());if(payload.version!==1||payload.kind!==kind||!Number.isSafeInteger(payload.expires)||payload.expires<=now()||payload.expires>now()+bound(kind)*1000)throw Error();return payload.value;}catch{throw new AccessFailure(401,'Sessão PEE ausente ou expirada. Entre novamente pelo Core.');}}
 };
}
