import {BadRequestException} from '@nestjs/common';
export type ReportPolicyConfig={name:string;customerId:string;unitId:string;frequency:'MONTHLY'|'FORTNIGHTLY';days:number[];hour:number;monthlyLimit:number;kinds:('OPERATIONAL'|'EXECUTIVE')[];formats:('pdf'|'excel')[];channels:('email'|'whatsapp'|'sms')[];contactIds:string[]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function reportPolicy(input:unknown):ReportPolicyConfig{
 const c=input as ReportPolicyConfig;
 const fail=()=>{throw new BadRequestException('Revise cliente, unidade, contatos, canais e calendário do relatório.');};
 const keys=['name','customerId','unitId','frequency','days','hour','monthlyLimit','kinds','formats','channels','contactIds'];
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).length!==keys.length||Object.keys(c).some(k=>!keys.includes(k)))fail();
 if(typeof c.name!=='string'||!c.name.trim()||c.name.trim().length>100||/[\u0000-\u001f\u007f]/.test(c.name)||!uuid.test(c.customerId??'')||!uuid.test(c.unitId??'')||!['MONTHLY','FORTNIGHTLY'].includes(c.frequency)||!Number.isInteger(c.hour)||c.hour<0||c.hour>23||!Number.isInteger(c.monthlyLimit)||c.monthlyLimit<1||c.monthlyLimit>2)fail();
 const array=(v:unknown,values:readonly unknown[],min:number,max:number)=>Array.isArray(v)&&v.length>=min&&v.length<=max&&new Set(v).size===v.length&&v.every(x=>values.includes(x));
 if(!array(c.days,Array.from({length:31},(_,i)=>i+1),c.frequency==='MONTHLY'?1:2,c.frequency==='MONTHLY'?1:2)||c.monthlyLimit>c.days.length||!array(c.kinds,['OPERATIONAL','EXECUTIVE'],1,2)||!array(c.formats,['pdf','excel'],1,2)||!array(c.channels,['email','whatsapp','sms'],1,3)||c.channels.includes('sms')&&!c.channels.includes('email'))fail();
 if(!Array.isArray(c.contactIds)||c.contactIds.length<1||c.contactIds.length>10||c.contactIds.some(x=>typeof x!=='string'||!uuid.test(x))||new Set(c.contactIds.map(x=>x.toLowerCase())).size!==c.contactIds.length)fail();
 return {...c,name:c.name.trim(),customerId:c.customerId.toLowerCase(),unitId:c.unitId.toLowerCase(),days:[...c.days].sort((a,b)=>a-b),kinds:[...c.kinds].sort(),formats:[...c.formats].sort(),channels:[...c.channels].sort(),contactIds:c.contactIds.map(x=>x.toLowerCase()).sort()};
}
