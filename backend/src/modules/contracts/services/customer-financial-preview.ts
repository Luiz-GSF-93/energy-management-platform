import {allocateFee,feeCents,feeMoney} from './management-fee';
import {monthPeriod} from './preparation';
import type {OperationalComposition} from './operational-composition';
export type CustomerUnitInput={unitId:string;month:string;composition:OperationalComposition;checkedAt:string};
export type CustomerFinancialPreview={formulaVersion:'customer-financial-preview-1.0';status:'BLOCKED'|'AVAILABLE';month:string;customerId:string;unitCount:number;acr:string|null;aclBeforeFees:string|null;savingsBeforeFees:string|null;fixedFee:string|null;variableFee:string|null;totalFees:string|null;aclAfterFees:string|null;savingsAfterFees:string|null;savingsPercent:string|null;contract:null|{id:string;number:string;model:string;percentage:string};allocation:null|{id:string;version:number;source:string};units:{id:string;name:string;acr:string|null;aclBeforeFees:string|null;fixedFee:string|null;variableFee:string|null;totalFees:string|null;aclAfterFees:string|null;savingsAfterFees:string|null;allocationPercent:string|null;checkedAt:string|null;references:{id:string;revision:number;group:string;scenario:string;source:string}[];blockers:string[]}[];blockers:string[];warnings:string[]};
const money=(v:unknown)=>{if(typeof v!=='string'||v.length>80||!/^(0|[1-9][0-9]*)[.][0-9]{2}$/.test(v))throw Error('Valor monetário inválido.');return BigInt(v.replace('.',''));};
const day=(v:unknown):v is string=>typeof v==='string'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
function rate(v:unknown){const s=String(v);if(!/^(0|[1-9][0-9]*)([.][0-9]{1,6})?$/.test(s)||s.length>12)throw Error('Percentual contratual inválido.');const [a,b='']=s.split('.'),n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));if(n>100000000n)throw Error('Percentual acima de 100%.');return n;}
function checkedScenario(c:OperationalComposition,scenario:'ACL'|'ACR'){
 const rows=c.scenarios.filter(s=>s.scenario===scenario),s=rows[0];if(rows.length!==1||s.status!=='AVAILABLE'||s.blockers.length)throw Error(s?.blockers.join(' ')||'Composição operacional indisponível para '+scenario+'.');
 const values={DISTRIBUTOR:money(s.distributor),SUPPLIER:money(s.supplier),ADDITIONAL:money(s.additional),TAX:money(s.taxes)};
 if(new Set(s.entries.map(e=>e.id)).size!==s.entries.length||s.entries.some(e=>!e.id||!Number.isInteger(e.revision)||e.revision<1||!e.source?.trim()||!Object.prototype.hasOwnProperty.call(values,e.group)))throw Error('Fontes ou revisões inconsistentes na composição.');
 for(const group of Object.keys(values))if(s.entries.filter(e=>e.group===group).reduce((n,e)=>n+money(e.amount),0n)!==values[group as keyof typeof values])throw Error('Rubricas não conciliam com o subtotal do cenário.');
 const sum=Object.values(values).reduce((a,b)=>a+b,0n);if(money(s.subtotal)!==sum)throw Error('Subtotal operacional inconsistente.');return sum;
}
/** Explicitly preliminary: all currently registered customer units, no invoice, snapshot or publication. */
export function customerFinancialPreview(org:string,customerId:string,month:string,units:any[],inputs:CustomerUnitInput[],contracts:any[],rules:any[]):CustomerFinancialPreview{
 const period=monthPeriod(month);const out:CustomerFinancialPreview={formulaVersion:'customer-financial-preview-1.0',status:'BLOCKED',month,customerId,unitCount:units.length,acr:null,aclBeforeFees:null,savingsBeforeFees:null,fixedFee:null,variableFee:null,totalFees:null,aclAfterFees:null,savingsAfterFees:null,savingsPercent:null,contract:null,allocation:null,units:[],blockers:[],warnings:[
 'Prévia das rubricas revisadas de todas as unidades atualmente cadastradas neste cliente. Não exclui automaticamente unidades sem dados; qualquer pendência bloqueia o consolidado.',
 'Economia antes dos honorários = ACR − ACL operacional. No híbrido, percentual × máximo(economia consolidada, zero), antes de descontar qualquer fixo. O fixo é integral por unidade; somente o variável é rateado.',
 'Percentual arredondado uma vez em centavos; rateio pelo método dos maiores restos, com desempate pelo identificador da unidade. A soma das parcelas conserva todos os centavos.',
 'Valores após honorários são preliminares: ainda não constituem fechamento, cobrança ou economia publicada. Tributos específicos sobre honorários, conciliação documental e snapshots de aprovação/publicação não estão incluídos.',
 'Esta leitura não é uma transação congelada. Alterações de cadastros ou fontes exigem nova conferência; a publicação futura deverá preservar o conjunto de versões.'
 ]};
 const block=(message:string)=>{if(!out.blockers.includes(message))out.blockers.push(message);};
 if(!units.length){block('Nenhuma unidade cadastrada para consolidar.');return out;}
 if(units.some(u=>!u.id||u.organization_id!==org||u.customer_id!==customerId)||new Set(units.map(u=>u.id)).size!==units.length){block('Escopo das unidades inválido; nenhum valor foi emitido.');return out;}
 if(inputs.length!==units.length||new Set(inputs.map(i=>i.unitId)).size!==inputs.length||inputs.some(i=>i.month!==month||!units.some(u=>u.id===i.unitId)))block('A consulta não contém exatamente todas as unidades e a mesma competência.');
 const amounts=new Map<string,{acr:bigint;acl:bigint}>();
 for(const u of [...units].sort((a,b)=>a.id.localeCompare(b.id))){
  const i=inputs.find(i=>i.unitId===u.id);const row:CustomerFinancialPreview['units'][number]={id:u.id,name:u.name||'Unidade sem nome',acr:null,aclBeforeFees:null,fixedFee:null,variableFee:null,totalFees:null,aclAfterFees:null,savingsAfterFees:null,allocationPercent:null,checkedAt:i?.checkedAt??null,references:[],blockers:[]};out.units.push(row);
  try{if(!i||i.month!==month||!i.checkedAt||i.composition.formulaVersion!=='operational-composition-1.0'||i.composition.scenarios.length!==2)throw Error('Atualize a composição operacional desta unidade.');const acr=checkedScenario(i.composition,'ACR'),acl=checkedScenario(i.composition,'ACL');amounts.set(u.id,{acr,acl});row.references=i.composition.scenarios.flatMap(s=>s.entries.map(e=>({id:e.id,revision:e.revision,group:e.group,scenario:s.scenario,source:e.source})));}catch(e){row.blockers.push(e instanceof Error?e.message:'Unidade indisponível.');block('Revise a unidade '+row.name+'.');}
 }
 try{
  const matches=contracts.filter(c=>c.organization_id===org&&c.customer_id===customerId&&c.status==='ACTIVE'&&(!day(c.start_date)||!day(c.end_date)||c.start_date<=period.end&&c.end_date>=period.start));
  if(matches.length!==1)throw Error('É necessário um único contrato de honorários ativo para o cliente na competência.');
  const c=matches[0];if(!c.id||!day(c.start_date)||!day(c.end_date)||c.start_date>period.start||c.end_date<period.end||!['FIXED','HYBRID'].includes(c.remuneration_model))throw Error('O contrato de honorários deve cobrir o mês inteiro e usar modelo fixo ou híbrido.');
  const fixed=feeCents(c.fixed_fee_monthly),percent=rate(c.savings_percentage);
  const relevant=rules.filter(a=>a.organization_id===org&&a.customer_id===customerId&&a.contract_id===c.id&&a.month===month);
  if(relevant.some(a=>!Number.isInteger(a.version)||a.version<1))throw Error('Histórico da regra mensal contém versão inválida.');
  const sorted=[...relevant].sort((a,b)=>b.version-a.version),a=sorted[0];if(!a||!a.id||a.fixed_fee_basis!=='PER_UNIT'||!a.source?.trim()||sorted.filter(r=>r.version===a.version).length!==1||!Array.isArray(a.allocations))throw Error('Confirme a regra mensal: fixo por unidade e rateio somente da parcela variável.');
  out.contract={id:c.id,number:c.contract_number,model:c.remuneration_model,percentage:String(c.savings_percentage)};out.allocation={id:a.id,version:a.version,source:a.source};
  if(c.remuneration_model==='FIXED'){if(percent!==0n||a.allocations.length)throw Error('Modelo fixo exige percentual zero e nenhuma divisão do valor fixo.');}
  else{allocateFee('0',a.allocations);if(a.allocations.length!==units.length||a.allocations.some((r:any)=>!units.some(u=>u.id===r.consumerUnitId)))throw Error('O rateio variável precisa conter exatamente todas as unidades do cliente, inclusive participação zero quando aplicável.');}
  if(out.blockers.length)return out;
  const acr=[...amounts.values()].reduce((n,v)=>n+v.acr,0n),acl=[...amounts.values()].reduce((n,v)=>n+v.acl,0n),base=acr-acl;
  const variable=c.remuneration_model==='HYBRID'&&base>0n?(base*percent+50000000n)/100000000n:0n;
  const shares=c.remuneration_model==='HYBRID'?allocateFee(feeMoney(variable),a.allocations):units.map(u=>({consumerUnitId:u.id,percentage:'0',amount:'0.00'}));
  const totalFixed=fixed*BigInt(units.length),fees=totalFixed+variable,after=acl+fees,savings=acr-after;
  // Compute every value before exposing totals; invalid allocation never leaks a partial consolidated value.
  const calculated=out.units.map(u=>{const v=amounts.get(u.id)!,share=shares.find(s=>s.consumerUnitId===u.id)!;const variableUnit=feeCents(share.amount),unitFees=fixed+variableUnit;return {...u,acr:feeMoney(v.acr),aclBeforeFees:feeMoney(v.acl),fixedFee:feeMoney(fixed),variableFee:share.amount,totalFees:feeMoney(unitFees),aclAfterFees:feeMoney(v.acl+unitFees),savingsAfterFees:feeMoney(v.acr-v.acl-unitFees),allocationPercent:c.remuneration_model==='HYBRID'?share.percentage:null};});
  if(calculated.reduce((n,u)=>n+feeCents(u.totalFees),0n)!==fees)throw Error('O rateio não conservou o total dos honorários.');
  const absolute=savings<0n?-savings:savings,percentage=acr===0n?null:feeMoney((savings<0n?-1n:1n)*((absolute*10000n+acr/2n)/acr));
  Object.assign(out,{status:'AVAILABLE',acr:feeMoney(acr),aclBeforeFees:feeMoney(acl),savingsBeforeFees:feeMoney(base),fixedFee:feeMoney(totalFixed),variableFee:feeMoney(variable),totalFees:feeMoney(fees),aclAfterFees:feeMoney(after),savingsAfterFees:feeMoney(savings),savingsPercent:percentage,units:calculated});
 }catch(e){block(e instanceof Error?e.message:'Revise honorários e rateio antes de consolidar.');}
 return out;
}
