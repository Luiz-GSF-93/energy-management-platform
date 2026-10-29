import {BadRequestException} from '@nestjs/common';
import {createHmac,randomInt} from 'node:crypto';

export const SUPPORT_ACTIONS={
 draft:['title','description'], authorize:['revision','confirmed','quoteMinor'],submit:['code'],
 policy:['revision','allowance','extraMinor','reason'],activate:['licenseId','enabled','reason'],
 triage:['replyRevision','assigneeId','priority','deadline','status','reason'],reply:['replyRevision','reason'],
 retry_email:['reason'],
} as const;
export function supportInput(action:keyof typeof SUPPORT_ACTIONS,input:unknown):Record<string,any>{
 if(!input||typeof input!=='object'||Array.isArray(input)||Buffer.byteLength(JSON.stringify(input))>20000)throw new BadRequestException('Dados de atendimento inválidos.');
 const b=input as Record<string,any>,allowed:readonly string[]=SUPPORT_ACTIONS[action];
 if(Object.keys(b).some(k=>!allowed.includes(k)))throw new BadRequestException('Campos de atendimento inválidos.');
 const text=(k:string,min:number,max:number)=>{if(typeof b[k]!=='string'||b[k].trim().length<min||b[k].length>max)throw new BadRequestException('Confira '+k+'.');b[k]=b[k].trim();};
 const integer=(k:string,max:number)=>{if(!Number.isSafeInteger(b[k])||b[k]<0||b[k]>max)throw new BadRequestException('Confira '+k+'.');};
 if(action==='draft'){text('title',5,200);text('description',10,12000);}
 if(action==='authorize'){integer('revision',1000000);integer('quoteMinor',100000000);if(b.confirmed!==true)throw new BadRequestException('Confirme conteúdo, sigilo e eventual custo extra.');}
 if(action==='submit'&&!/^\d{8}$/.test(b.code??''))throw new BadRequestException('Informe o código de oito dígitos.');
 if(action==='policy'){integer('revision',1000000);integer('allowance',100000);integer('extraMinor',100000000);text('reason',5,1000);}
 if(action==='activate'){text('licenseId',1,100);text('reason',5,1000);if(typeof b.enabled!=='boolean')throw new BadRequestException('Confirme a ativação.');}
 if(action==='triage'||action==='reply'){integer('replyRevision',1000000);text('reason',5,4000);}
 if(action==='retry_email')text('reason',5,1000);
 if(action==='triage'){
  if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(b.assigneeId??'')||!['LOW','NORMAL','HIGH'].includes(b.priority)||!['OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED'].includes(b.status)||!/^\d{4}-\d{2}-\d{2}$/.test(b.deadline??''))throw new BadRequestException('Informe responsável, situação e prazo válidos.');
 }
 return b;
}
export function supportCodeHash(secret:string,org:string,id:string,code:string){
 if(secret.length<32)throw Error('SUPPORT_CODE_SECRET_REQUIRED');
 return createHmac('sha256',secret).update(JSON.stringify([org,id,code])).digest('hex');
}
export const generateSupportCode=()=>String(randomInt(0,100000000)).padStart(8,'0');
export function supportEmail(payload:any){
 const s=payload.summary;if(!s||!payload.protocol||typeof payload.organizationName!=='string')throw Error('INVALID_SUPPORT_NOTICE');
 const money=(n:number)=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 return {subject:'EnergyOS · Atendimento '+payload.protocol,text:[
 'Atendimento Central — EnergyOS',payload.organizationName,'Protocolo: '+payload.protocol,'Assunto: '+payload.title,
 'Situação: '+payload.status,'Prazo informado: '+(payload.deadline??'Aguardando triagem'),
 'Ciclo: '+s.starts+' até '+s.ends+' (término exclusivo). Próxima renovação: '+s.ends,
 'Tickets incluídos no plano: '+s.allowance,'Incluídos utilizados: '+s.includedUsed,'Incluídos restantes: '+s.remaining,
 'Tickets extras utilizados: '+s.extrasUsed,'Total de chamados utilizados: '+s.totalUsed,
 payload.quoteMinor>0?'Este chamado tem custo extra autorizado: '+money(payload.quoteMinor)+'. Inclusão na fatura depende da confirmação financeira.':'Valor extra deste chamado: '+money(payload.quoteMinor??0)+'.',
 'Consulte o conteúdo e as respostas no Atendimento Central, com seu acesso autorizado.',
 'https://app.expertenergy.com.br/backoffice/support',
 ].join('\n')};
}

export function supportPage(value:unknown){if(value===undefined)return 0;if(typeof value!=='string'||!/^\d{1,4}$/.test(value)||Number(value)>1000)throw new BadRequestException('Página inválida.');return Number(value);}
