import {CostLedger} from './monthly-cost-ledger';
export type AdditionalCostSubtotal={formulaVersion:'additional-cost-subtotal-1.0';version:CostLedger['version'];scenarios:{scenario:'ACR'|'ACL';status:'AVAILABLE'|'BLOCKED'|'DECLARED_ZERO';costs:string|null;credits:string|null;balance:string|null;count:number;blockers:string[]}[];warnings:string[]};
const cents=(v:string)=>{if(typeof v!=='string'||v.length>80||!/^(0|[1-9][0-9]*)[.][0-9]{2}$/.test(v))throw Error();return BigInt(v.replace('.',''));};
const money=(v:bigint)=>{const s=(v<0n?-v:v).toString().padStart(3,'0');return (v<0n?'-':'')+s.slice(0,-2)+'.'+s.slice(-2);};
/** Consolidates reviewed additional costs only. Never incorporates a supplier reference. */
export function additionalCostSubtotal(ledger:CostLedger):AdditionalCostSubtotal{
 const result:AdditionalCostSubtotal={formulaVersion:'additional-cost-subtotal-1.0',version:ledger.version,scenarios:[],warnings:[
  'Saldo adicional = custos menos créditos. Não é custo total ACL/ACR, economia ou base definitiva de honorários.',
  'Somente valores com tributos incluídos ou não aplicáveis são consolidados. Tributos excluídos bloqueiam o cenário; não há gross-up automático.',
  'Ausência validada de custos é exibida como zero declarado. Um cenário sem lançamentos, sem essa declaração, permanece pendente.',
  'Concilie documentos e rateios para evitar duplicidade com distribuidora, fornecedor e honorários. Este subtotal não realiza essa conciliação automaticamente.'
 ]};
 const ids=ledger.groups.flatMap(g=>g.lines.map(l=>l.id));
 const invalid=ledger.groups.some(g=>!['ACR','ACL'].includes(g.scenario))||new Set(ids).size!==ids.length;
 for(const scenario of ['ACR','ACL'] as const){
  const out:AdditionalCostSubtotal['scenarios'][number]={scenario,status:'BLOCKED',costs:null,credits:null,balance:null,count:0,blockers:[]};result.scenarios.push(out);
  if(!ledger.version||!Number.isInteger(ledger.version.revision)||ledger.version.revision<1||!ledger.version.source?.trim()||!ledger.version.validatedAt){out.blockers.push('Valide os custos mensais e identifique sua fonte antes de consolidar.');continue;}
  if(ledger.status==='BLOCKED'||ledger.blockers.length){out.blockers.push(...(ledger.blockers.length?ledger.blockers:['Custos mensais aguardando revisão.']));continue;}
  if(invalid){out.blockers.push('A memória contém lançamentos duplicados ou cenários inválidos. Revise a origem.');continue;}
  if(ledger.status==='NO_COSTS_DECLARED'){
   if(ledger.groups.length){out.blockers.push('Declaração de ausência incompatível com os lançamentos.');continue;}
   Object.assign(out,{status:'DECLARED_ZERO',costs:'0.00',credits:'0.00',balance:'0.00'});continue;
  }
  if(ledger.status!=='AVAILABLE'){out.blockers.push('Memória de custos indisponível.');continue;}
  const groups=ledger.groups.filter(g=>g.scenario===scenario);
  if(!groups.length){out.blockers.push('Não há lançamentos nem declaração de ausência para este cenário. Confira os custos mensais.');continue;}
  if(groups.some(g=>g.taxTreatment==='EXCLUDED')){out.blockers.push('Há custos ou créditos sem tributos incluídos. Conclua o tratamento tributário antes de consolidar este cenário.');continue;}
  let costs=0n,credits=0n;
  try{
   for(const g of groups){
    if(!['INCLUDED','NOT_APPLICABLE'].includes(g.taxTreatment)||g.count!==g.lines.length||!g.lines.length)throw Error();
    let gc=0n,gr=0n;
    for(const line of g.lines){
     if(!line.id||!line.source?.trim()||!['COST','CREDIT'].includes(line.effect))throw Error();
     const n=cents(line.amount);if(line.effect==='COST')gc+=n;else gr+=n;
     if(line.signedAmount!==money(line.effect==='CREDIT'?-n:n))throw Error();
    }
    if(g.costs!==money(gc)||g.credits!==money(gr)||g.balance!==money(gc-gr))throw Error();
    costs+=gc;credits+=gr;out.count+=g.lines.length;
   }
   Object.assign(out,{status:'AVAILABLE',costs:money(costs),credits:money(credits),balance:money(costs-credits)});
  }catch{out.count=0;out.blockers.push('Valores, fontes ou classificações inconsistentes na memória. Nenhum saldo parcial foi emitido.');}
 }
 return result;
}
