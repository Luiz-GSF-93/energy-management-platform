import {monthPeriod} from './preparation';
import {reviewedComponentSubtotal} from './distributor-subtotal';
import type {TariffPreview} from './tariff-preview';
import type {TaxMemory} from './tax-memory';
import type {OperationalTaxBases} from './operational-tax-bases';
import type {CostLedger} from './monthly-cost-ledger';
export type OperationalComposition={formulaVersion:'operational-composition-1.0';rounding:'SUM_ROUNDED_LINES';scenarios:{scenario:'ACR'|'ACL';status:'AVAILABLE'|'BLOCKED';distributor:string|null;supplier:string|null;additional:string|null;taxes:string|null;subtotal:string|null;entries:{id:string;revision:number;label:string;group:'DISTRIBUTOR'|'SUPPLIER'|'ADDITIONAL'|'TAX';amount:string;source:string}[];blockers:string[]}[];warnings:string[]};
const labels:Record<string,string>={SUPPLIER_ENERGY:'energia contratual consumida',SUPPLIER_MINIMUM:'mínimo não consumido',SUPPLIER_EXTRA:'compra extra validada',MONTHLY_CCEE:'CCEE',MONTHLY_EXPOSURE:'exposição',MONTHLY_CHARGE:'encargos',MONTHLY_OTHER:'outros custos'};
const cents=(v:unknown)=>{if(typeof v!=='string'||v.length>80||!/^(0|[1-9][0-9]*)[.][0-9]{2}$/.test(v))throw Error('Valor monetário inválido.');return BigInt(v.replace('.',''));};
const money=(v:bigint)=>{if(v<0n)throw Error('Composição negativa não suportada.');const s=v.toString().padStart(3,'0');return s.slice(0,-2)+'.'+s.slice(-2);};
const validRevision=(v:any)=>!!v?.id&&Number.isInteger(v.revision)&&v.revision>0&&typeof v.source==='string'&&!!v.source.trim();
/** Read-only composition of reviewed components, before management fees. No savings or settlement publication. */
export function operationalComposition(unit:any,month:string,parameters:any[],tariffs:TariffPreview,taxes:TaxMemory,operational:OperationalTaxBases,supplier:any,costs:CostLedger,findings:{severity:string;message:string}[]=[]):OperationalComposition{
 const period=monthPeriod(month),touches=(p:any)=>!p.start_date||!p.end_date||p.start_date<=period.end&&p.end_date>=period.start;
 const scoped=parameters.filter(p=>p.organization_id===unit.organization_id&&p.customer_id===unit.customer_id&&p.consumer_unit_id===unit.id&&['APPROVED','DRAFT'].includes(p.status)&&touches(p));
 const combined=reviewedComponentSubtotal(unit,month,parameters,tariffs,taxes,operational);
 const result:OperationalComposition={formulaVersion:'operational-composition-1.0',rounding:'SUM_ROUNDED_LINES',scenarios:[],warnings:[
  'Composição das rubricas revisadas: tarifas da distribuidora + energia contratual, mínimo e compra extra + custos mensais + tributos a acrescentar. Não é fechamento financeiro nem economia publicada.',
  'Bases tributárias referenciam as mesmas despesas e não são somadas outra vez. Tributos já incluídos, bases de cálculo, impostos referenciados e NF regular do fornecedor não geram nova cobrança.',
  'Honorários fixos e variáveis ainda não integram este subtotal. Créditos, custos manuais sem origem conciliada, tratamentos mistos e vigências parciais exigem revisão antes de consolidar.',
  'A conferência não substitui a conciliação documental nem afirma completude da fatura. Não há gravação de resultados ou publicação para o cliente.'
 ]};
 for(const s of combined.scenarios){
  const out:OperationalComposition['scenarios'][number]={scenario:s.scenario,status:'BLOCKED',distributor:null,supplier:null,additional:null,taxes:null,subtotal:null,entries:[],blockers:[...s.blockers]};result.scenarios.push(out);
  const block=(message:string)=>{if(!out.blockers.includes(message))out.blockers.push(message);};
  for(const f of findings.filter(f=>f.severity==='BLOCKER'))block(f.message);
  const own=scoped.filter(p=>p.scenario===s.scenario),auto=own.filter(p=>p.kind==='COST'&&p.monetary_source&&p.status==='APPROVED');
  if(!own.some(p=>p.kind==='TARIFF'&&p.status==='APPROVED'))block('Cadastre tarifas aprovadas da distribuidora para o cenário.');
  if(own.some(p=>p.kind==='COST'&&!p.monetary_source))block('Há custo manual sem origem conciliada. Vincule aos custos mensais ou ao fornecedor para evitar duplicidade.');
  if(own.some(p=>p.status==='DRAFT'))block('Conclua os rascunhos da competência antes de consolidar.');
  const expected=new Map<string,{amount:bigint;itemIds?:string[]}>();
  try{
   if(unit.free_market!==true)throw Error('A comparação exige unidade confirmada no Mercado Livre.');
   if(s.scenario==='ACL'){
    if(supplier?.status!=='READY'||supplier.month!==month||supplier.requirements?.length||!supplier.contract?.id||!supplier.rule?.id||!Number.isInteger(supplier.rule.version)||supplier.rule.version<1||!supplier.rule.source?.trim()||!validRevision(supplier.measurements)||supplier.measurements.id!==tariffs.measurement?.id||supplier.measurements.revision!==tariffs.measurement?.revision)throw Error('Fornecedor e medições precisam estar concluídos e usar a mesma revisão da competência.');
    const regular=cents(supplier.regularAmount),minimum=cents(supplier.minimumAmount),extra=cents(supplier.extraAmount);
    if(minimum>regular||cents(supplier.totalAmount)!==regular+extra)throw Error('Os componentes do fornecedor não conciliam com seu total.');
    expected.set('SUPPLIER_ENERGY',{amount:regular-minimum});
    if(minimum>0n||auto.some(p=>p.monetary_source==='SUPPLIER_MINIMUM'))expected.set('SUPPLIER_MINIMUM',{amount:minimum});
    if(extra>0n||auto.some(p=>p.monetary_source==='SUPPLIER_EXTRA'))expected.set('SUPPLIER_EXTRA',{amount:extra});
   }
   if(!validRevision(costs.version)||!costs.version?.validatedAt||costs.blockers.length||!['AVAILABLE','NO_COSTS_DECLARED'].includes(costs.status))throw Error('Valide os custos mensais ou a declaração explícita de ausência.');
   if(costs.status==='NO_COSTS_DECLARED'){
    if(costs.groups.length)throw Error('Declaração de ausência incompatível com os lançamentos.');
    for(const p of auto.filter(p=>p.monetary_source.startsWith('MONTHLY_')))expected.set(p.monetary_source,{amount:0n,itemIds:[]});
   }else{
    const groups=costs.groups.filter(g=>g.scenario===s.scenario),allIds=costs.groups.flatMap(g=>g.lines.map(l=>l.id));
    if(!groups.length)throw Error('Sem custos adicionais ou declaração de ausência para este cenário.');
    if(new Set(allIds).size!==allIds.length||costs.groups.some(g=>!['ACR','ACL'].includes(g.scenario)))throw Error('Lançamentos duplicados ou com cenário inválido.');
    for(const g of groups){
     if(!['INCLUDED','EXCLUDED'].includes(g.taxTreatment)||g.count!==g.lines.length||!g.lines.length)throw Error('Revise o tratamento dos custos. Não aplicação tributária exige origem compatível antes da consolidação.');
     let sum=0n;
     for(const l of g.lines){
      if(!['CCEE','EXPOSURE','CHARGE','OTHER'].includes(l.category)||l.effect!=='COST'||!l.id||!l.source?.trim()||l.signedAmount!==l.amount)throw Error('Créditos ou rubricas não conciliadas exigem tratamento específico; nenhum saldo parcial foi emitido.');
      const n=cents(l.amount),key='MONTHLY_'+l.category,previous=expected.get(key);sum+=n;
      expected.set(key,{amount:(previous?.amount??0n)+n,itemIds:[...(previous?.itemIds??[]),l.id]});
     }
     if(cents(g.costs)!==sum||g.credits!=='0.00'||cents(g.balance)!==sum)throw Error('Saldo dos custos diverge dos lançamentos validados.');
    }
   }
   if(new Set(auto.map(p=>p.monetary_source)).size!==auto.length)throw Error('Mais de um parâmetro aprovado para a mesma origem.');
   for(const [source,value] of expected){
    const ps=auto.filter(p=>p.monetary_source===source),p=ps[0],ls=operational.lines.filter(l=>l.scenario===s.scenario&&l.monetarySource===source),l=ls[0];
    if(ps.length!==1||ls.length!==1||l.parameterId!==p.id||l.revision!==p.revision||cents(l.amount)!==value.amount)throw Error('Configure e aprove a origem '+(labels[source]||source)+' e concilie seu valor na memória operacional.');
    if(value.itemIds){const refs=l.references.filter(r=>r.kind==='MONTHLY_COST_ITEM');if(refs.length!==value.itemIds.length||refs.some(r=>!value.itemIds!.includes(r.id)||r.revision!==costs.version!.revision)||!l.references.some(r=>r.kind==='MONTHLY_COSTS'&&r.id===costs.version!.id&&r.revision===costs.version!.revision))throw Error('A origem automática não corresponde à versão e aos itens dos custos.');}
   }
   if(auto.some(p=>!expected.has(p.monetary_source)))throw Error('Há origem automática sem componente correspondente no cenário.');
  }catch(e){block(e instanceof Error?e.message:'Fontes operacionais indisponíveis.');}
  for(const e of s.entries){const p=own.find(p=>p.id===e.id);out.entries.push({id:e.id,revision:e.revision,label:e.label,group:e.kind==='TAX'?'TAX':e.kind==='TARIFF'?'DISTRIBUTOR':p?.monetary_source?.startsWith('SUPPLIER_')?'SUPPLIER':'ADDITIONAL',amount:e.amount,source:e.source});}
  if(!out.blockers.length&&s.status==='AVAILABLE'){
   const sum=(group:string)=>out.entries.filter(e=>e.group===group).reduce((n,e)=>n+cents(e.amount),0n);
   const d=sum('DISTRIBUTOR'),f=sum('SUPPLIER'),c=sum('ADDITIONAL'),t=sum('TAX');
   Object.assign(out,{status:'AVAILABLE',distributor:money(d),supplier:money(f),additional:money(c),taxes:money(t),subtotal:money(d+f+c+t)});
  }
 }
 return result;
}
