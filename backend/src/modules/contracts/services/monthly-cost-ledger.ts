import {prepareCosts} from './preparation-costs';

type Treatment='INCLUDED'|'EXCLUDED'|'NOT_APPLICABLE';
type Scenario='ACL'|'ACR';
export type CostLedgerLine={id:string;label:string;category:string;effect:string;amount:string;signedAmount:string;source:string};
export type CostLedgerGroup={scenario:Scenario;taxTreatment:Treatment;count:number;costs:string;credits:string;balance:string;lines:CostLedgerLine[]};
export type CostLedger={mode:'MONTHLY_COST_LEDGER';formulaVersion:'monthly-costs-1.0';status:'BLOCKED'|'AVAILABLE'|'NO_COSTS_DECLARED';version:{id:string;version:number;revision:number;validatedAt:string;source:string}|null;groups:CostLedgerGroup[];blockers:string[];warnings:string[]};
function cents(value:string){const [whole,fraction='']=value.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));}
function money(value:bigint){const absolute=value<0n?-value:value;const text=absolute.toString().padStart(3,'0');return (value<0n?'-':'')+text.slice(0,-2)+'.'+text.slice(-2);}
/** Read-only reconciliation aid, not a total energy cost or a publishable settlement. */
export function monthlyCostLedger(unit:any,month:string,rows:any[]):CostLedger{
 const checked=prepareCosts(unit,month,rows),v=checked.validatedVersion;
 const result:CostLedger={mode:'MONTHLY_COST_LEDGER',formulaVersion:'monthly-costs-1.0',status:'BLOCKED',version:v?{id:v.id,version:v.version,revision:v.revision,validatedAt:v.validatedAt,source:v.source}:null,groups:[],blockers:checked.findings.filter(f=>f.severity==='BLOCKER').map(f=>f.message),warnings:[
  'Saldo dos lançamentos = custos menos créditos, calculado em centavos no servidor. Saldo negativo significa créditos maiores que os custos deste grupo.',
  'Os grupos não são somados entre si: tributos incluídos, excluídos e não aplicáveis permanecem separados. Não há aplicação de tributos nesta conferência.',
  'Concilie cada lançamento com documentos, contratos e tarifas antes da apuração para evitar duplicidade. A validação do cadastro não substitui essa conciliação.',
  'Estes valores não representam custo total ACL/ACR, economia ou base definitiva dos honorários. Não foram adicionados à memória de tarifas.',
  'Consulta somente leitura, sem cobrança ou publicação. Uma futura apuração deve preservar as fontes e suas versões de forma imutável.'
 ]};
 if(!v||result.blockers.length||!['VALIDATED','NO_COSTS_DECLARED'].includes(checked.status))return result;
 // prepareCosts verifies shape, exact decimal strings, classification, sources and scope.
 // A corrupted historical revision must not become a calculation reference.
 if(!Number.isInteger(v.revision)||v.revision<1){result.blockers.push('Revisão dos custos inválida. Solicite revisão administrativa.');return result;}
 if(v.costs.noCosts){result.status='NO_COSTS_DECLARED';return result;}
 result.status='AVAILABLE';
 for(const scenario of ['ACR','ACL'] as Scenario[]){
  for(const taxTreatment of ['INCLUDED','EXCLUDED','NOT_APPLICABLE'] as Treatment[]){
   const items=v.costs.items.filter(i=>i.scenario===scenario&&i.taxTreatment===taxTreatment).sort((a,b)=>a.id.localeCompare(b.id));
   if(!items.length)continue;
   let costs=0n,credits=0n;
   const lines=items.map(i=>{const value=cents(i.amount);if(i.effect==='CREDIT')credits+=value;else costs+=value;return {id:i.id,label:i.label,category:i.category,effect:i.effect,amount:money(value),signedAmount:money(i.effect==='CREDIT'?-value:value),source:i.source};});
   result.groups.push({scenario,taxTreatment,count:items.length,costs:money(costs),credits:money(credits),balance:money(costs-credits),lines});
  }
 }
 return result;
}
