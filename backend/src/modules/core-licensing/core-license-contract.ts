import {BadRequestException} from '@nestjs/common';
export const CORE_LICENSE_MODULES=['document_management','advanced_analytics','report_generation','free_market_management','client_portal','ccee_registrations','trading_hub','bot_energy_rag','organization_audit','ccee_data','acl_admissions'] as const;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/,date=/^\d{4}-\d{2}-\d{2}$/;
function object(v:unknown,keys:string[]){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||Object.keys(v).length!==keys.length)throw new BadRequestException('Campos da integração de licença inválidos.');return v as Record<string,any>;}
function text(v:unknown,max:number,min=1){if(typeof v!=='string'||v.trim()!==v||v.length<min||v.length>max||/[\x00-\x1f\x7f]/.test(v))throw new BadRequestException('Texto da licença inválido.');return v;}
function num(v:unknown,max:number,min=1){if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)throw new BadRequestException('Limite da licença inválido.');return v as number;}
function day(v:unknown,nullable=false):string|null{if(v===null&&nullable)return null;if(typeof v!=='string'||!date.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new BadRequestException('Data da licença inválida.');return v;}
function instant(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(v)||!Number.isFinite(Date.parse(v)))throw new BadRequestException('Data de verificação inválida.');return v;}
function cnpj(v:unknown){const s=text(v,14,14);if(!/^[A-Z0-9]{12}\d{2}$/.test(s)||/^(\d)\1+$/.test(s))throw new BadRequestException('CNPJ inválido.');for(let n=12;n<14;n++){let w=n-7,sum=0;for(const c of s.slice(0,n)){sum+=(c.charCodeAt(0)-48)*w;if(--w===1)w=9;}const r=sum%11;if(Number(s[n])!==(r<2?0:11-r))throw new BadRequestException('CNPJ inválido.');}return s;}
export function coreLicenseInput(raw:unknown){
 const b=object(raw,['eventId','coreSubscriptionId','revision','source','customer','plan','contract','payment','billing']);
 if(!uuid.test(b.eventId)||!uuid.test(b.coreSubscriptionId)||!['site','manual'].includes(b.source))throw new BadRequestException('Protocolo de licença inválido.');num(b.revision,100000000);
 const c=object(b.customer,['legalName','cnpj','adminName','email']);text(c.legalName,180,2);text(c.adminName,120,2);cnpj(c.cnpj);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(c.email,254)))throw new BadRequestException('E-mail do administrador inválido.');
 const planKeys=['id','version','name','description','modules','limits','aiMonthlyMicroUsd','monthlyCents'];
 if(b.plan&&Object.prototype.hasOwnProperty.call(b.plan,'support'))planKeys.push('support');
 const p=object(b.plan,planKeys);if(!uuid.test(p.id))throw new BadRequestException('Plano inválido.');num(p.version,1000000);text(p.name,65,2);text(p.description,2000,0);num(p.aiMonthlyMicroUsd,1000000000000,0);num(p.monthlyCents,1000000000);
 if(p.support!==undefined){const support=object(p.support,['enabled','annual_tickets','extra_ticket_cents']);if(typeof support.enabled!=='boolean')throw new BadRequestException('Atendimento do plano inválido.');num(support.annual_tickets,100000,0);num(support.extra_ticket_cents,100000000,0);if(!support.enabled&&(support.annual_tickets!==0||support.extra_ticket_cents!==0))throw new BadRequestException('Ative o atendimento para configurar sua franquia.');}
 const m=object(p.modules,[...CORE_LICENSE_MODULES]);for(const k of CORE_LICENSE_MODULES)if(typeof m[k]!=='boolean')throw new BadRequestException('Módulo da licença inválido.');if(m.acl_admissions&&!m.free_market_management)throw new BadRequestException('Adesão ACL exige Gestão ACL.');
 const l=object(p.limits,['clients','users','units','documents']);for(const k of ['clients','users','units'])num(l[k],100000);num(l.documents,10000000);
 const ct=object(b.contract,['offerId','contentHash','signedPdfHash','verifiedAt','environment']);if(!uuid.test(ct.offerId)||!hash.test(ct.contentHash)||!hash.test(ct.signedPdfHash)||ct.environment!=='production')throw new BadRequestException('Contrato de produção assinado é obrigatório.');instant(ct.verifiedAt);
 const pay=object(b.payment,['id','subscriptionId','customerId','status','billingType','amountCents','cycle','verifiedAt']);if(!/^pay_[A-Za-z0-9_]{1,100}$/.test(pay.id)||!/^sub_[A-Za-z0-9_]{1,100}$/.test(pay.subscriptionId)||!/^cus_[A-Za-z0-9_]{1,100}$/.test(pay.customerId)||!['CONFIRMED','RECEIVED','OVERDUE','PENDING','REFUNDED','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL'].includes(pay.status)||!['MONTHLY','YEARLY'].includes(pay.cycle)||!['CREDIT_CARD','BOLETO','PIX'].includes(pay.billingType)||b.source==='site'&&pay.billingType!=='CREDIT_CARD')throw new BadRequestException('Evidência de cobrança inválida.');num(pay.amountCents,1200000000);instant(pay.verifiedAt);
 if((pay.cycle==='MONTHLY'?pay.amountCents:Math.round(pay.amountCents/12))!==p.monthlyCents)throw new BadRequestException('Preço da licença difere da cobrança contratada.');
 const bi=object(b.billing,['paidThrough','oldestUnpaidDueOn','cancelled']);day(bi.paidThrough,true);day(bi.oldestUnpaidDueOn,true);if(typeof bi.cancelled!=='boolean')throw new BadRequestException('Situação da assinatura inválida.');
 return b;
}
export function coreAccessState(b:{paidThrough:string|null;oldestUnpaidDueOn:string|null;cancelled:boolean},today:string){
 if(b.cancelled)return{state:'cancelled',blocked:true,notice:'Assinatura cancelada.'};
 if(!b.paidThrough)return{state:'suspended',blocked:true,notice:'Assinatura aguardando conciliação do pagamento.'};
 const due=b.oldestUnpaidDueOn??b.paidThrough;
 if(due<today){const days=Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(due+'T00:00:00Z'))/86400000);return{state:days>7?'suspended':'grace',blocked:days>7,notice:'Assinatura em atraso',overdueDays:days};}
 return{state:'active',blocked:false,notice:null};
}
