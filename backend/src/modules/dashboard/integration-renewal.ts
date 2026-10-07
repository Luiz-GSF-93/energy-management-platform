import { BadRequestException } from '@nestjs/common';

export type RenewalRecord = { revision:number; issued_on:string|null; expires_on:string|null; no_expiry:boolean; reminder_days:number; updated_at?:string };
export function renewalStatus(record:RenewalRecord, now=new Date()) {
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const remaining=record.expires_on===null?null:Math.ceil((Date.parse(record.expires_on+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
 return {...record,days_remaining:remaining,status:record.no_expiry?'NO_EXPIRY':remaining===null?'NOT_REGISTERED':remaining<=0?'EXPIRED':remaining<=record.reminder_days?'RENEW_SOON':'CURRENT',time_basis:'America/Sao_Paulo',expiry_basis:'Data cadastrada pelo administrador; não verificada automaticamente na Meta.'};
}
export function validateRenewal(record:RenewalRecord) {
 for(const value of [record.issued_on,record.expires_on]) if(value!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value))throw new BadRequestException('Informe datas válidas.');
 if(record.issued_on===null||(!record.no_expiry&&record.expires_on===null)||(record.no_expiry&&record.expires_on!==null)||(record.expires_on!==null&&record.expires_on<=record.issued_on))throw new BadRequestException('Confira a emissão e o vencimento do token.');
}
