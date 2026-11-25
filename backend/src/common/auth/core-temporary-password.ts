import {createHash,timingSafeEqual} from 'node:crypto';
export function coreTemporaryAccess(metadata:Record<string,unknown>|undefined,now=Date.now()){
 if(metadata?.energyos_core_temporary_password!==true||metadata.energyos_password_setup_required!==true)return false;
 const expiry=Date.parse(String(metadata.energyos_temporary_password_expires_at||''));
 return Number.isFinite(expiry)&&expiry>now;
}
export function temporaryPasswordMatches(password:string,digest:unknown){
 if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))return false;
 return timingSafeEqual(createHash('sha256').update(password).digest(),Buffer.from(digest,'hex'));
}
