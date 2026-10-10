import {BadRequestException} from '@nestjs/common';
export const GOALS=['costs','automation','ocr','free_market','multiunit','reports','trading','documents'] as const;
export function normalizeLead(input:unknown){
 const fail=()=>{throw new BadRequestException('Confira os dados e o consentimento do formulário.');};
 if(!input||typeof input!=='object'||Array.isArray(input))return fail();
 const b=input as Record<string,unknown>;
 const allowed=['requestId','name','company','cnpj','jobTitle','email','phone','units','users','freeMarket','solar','buysEnergy','management','goals','contactMethod','consent','consentVersion','website'];
 if(Object.keys(b).some(k=>!allowed.includes(k)))return fail();
 const str=(k:string,max:number)=>{if(typeof b[k]!=='string')return fail();const s=(b[k] as string).trim();if(!s||s.length>max||/[\u0000-\u001f]/.test(s))return fail();return s;};
 const requestId=str('requestId',36);if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId))return fail();
 const name=str('name',120),company=str('company',160),jobTitle=str('jobTitle',120),email=str('email',254).toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return fail();
 const cnpj=str('cnpj',18).replace(/[.\/\- ]/g,'').toUpperCase();if(!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)||/^(\d)\1+$/.test(cnpj))return fail();
 for(let size=12;size<14;size++){const w=size===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];const mod=w.reduce((v,n,i)=>v+n*(cnpj.charCodeAt(i)-48),0)%11;if(Number(cnpj[size])!==(mod<2?0:11-mod))return fail();}
 const phone=str('phone',24).replace(/[()+ \-]/g,'');if(!/^55\d{10,11}$/.test(phone))return fail();
 if(!Number.isInteger(b.units)||Number(b.units)<1||Number(b.units)>100000||!Number.isInteger(b.users)||Number(b.users)<1||Number(b.users)>100000)return fail();
 if(!['yes','no','partial'].includes(String(b.freeMarket))||typeof b.solar!=='boolean'||typeof b.buysEnergy!=='boolean'||!['spreadsheet','software','none'].includes(String(b.management))||!['email','whatsapp','phone'].includes(String(b.contactMethod)))return fail();
 if(!Array.isArray(b.goals)||b.goals.length<1||b.goals.length>GOALS.length||new Set(b.goals).size!==b.goals.length||b.goals.some(v=>!GOALS.includes(v)))return fail();
 if(b.consent!==true||b.consentVersion!=='sales-contact-v1'||typeof b.website!=='string'||b.website!=='')return fail();
 const personal=['gmail.com','hotmail.com','yahoo.com','yahoo.com.br','outlook.com','live.com','icloud.com'].includes(email.split('@')[1]);
 return {requestId:requestId.toLowerCase(),name,company,cnpj,jobTitle,email,phone:'+'+phone,units:Number(b.units),users:Number(b.users),freeMarket:String(b.freeMarket),solar:b.solar,buysEnergy:b.buysEnergy,management:String(b.management),goals:[...b.goals].sort(),contactMethod:String(b.contactMethod),consent:true,consentVersion:'sales-contact-v1',emailKind:personal?'PERSONAL':'CORPORATE'};
}
