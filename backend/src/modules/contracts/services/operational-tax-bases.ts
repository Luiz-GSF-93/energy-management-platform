import {monthPeriod} from './preparation';
import type {TariffLine} from './tariff-preview';
import type {CostLedger} from './monthly-cost-ledger';
import type {contractSupplierCost} from './contract-supplier-cost';
export const MONETARY_SOURCES=["SUPPLIER_ENERGY","SUPPLIER_MINIMUM","SUPPLIER_EXTRA","MONTHLY_CCEE","MONTHLY_EXPOSURE","MONTHLY_CHARGE","MONTHLY_OTHER"] as const;
export type OperationalTaxBases={formulaVersion:'operational-bases-1.0';lines:(TariffLine&{monetarySource:string;references:{id:string;revision:number;kind:string;source:string}[]})[];pending:{parameterId:string;label:string;scenario:string;reason:string}[];warnings:string[]};
const date=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const cents=(v:unknown)=>{if(typeof v!=='string'||v.length>80||!/^(0|[1-9][0-9]*)[.][0-9]{2}$/.test(v))throw Error('Valor monetário indisponível ou inválido.');return BigInt(v.replace('.',''));};
const money=(v:bigint)=>{if(v<0n)throw Error('A origem possui saldo negativo e exige tratamento específico de créditos.');const s=v.toString().padStart(3,'0');return s.slice(0,-2)+'.'+s.slice(-2);};
/** References existing monetary components for taxation. Never add these bases as new costs. */
export function operationalTaxBases(unit:any,month:string,parameters:any[],supplier:ReturnType<typeof contractSupplierCost>,costs:CostLedger):OperationalTaxBases{
 const period=monthPeriod(month),touches=(p:any)=>!date(p.start_date)||!date(p.end_date)||p.start_date<=period.end&&p.end_date>=period.start;
 const scoped=parameters.filter(p=>p.organization_id===unit.organization_id&&p.customer_id===unit.customer_id&&p.consumer_unit_id===unit.id&&p.monetary_source!=null&&['APPROVED','DRAFT'].includes(p.status)&&touches(p));
 const result:OperationalTaxBases={formulaVersion:'operational-bases-1.0',lines:[],pending:[],warnings:['Bases reutilizam valores calculados do fornecedor e custos mensais validados. Não são novos custos e não devem ser somadas novamente.','O fornecedor exige ciclo encerrado, regras confirmadas e conciliação sem pendências. Créditos, tratamentos divergentes e ausência de lançamentos não são presumidos como zero.','A incidência depende de tributos aprovados que referenciem estas rubricas. Esta consulta não é fechamento ou publicação financeira.']};
 for(const p of scoped.filter(p=>p.status==='APPROVED').sort((a,b)=>String(a.id).localeCompare(String(b.id)))){
  const reject=(reason:string)=>result.pending.push({parameterId:String(p.id),label:String(p.label),scenario:String(p.scenario),reason});
  try{
   if(!MONETARY_SOURCES.includes(p.monetary_source)||p.kind!=='COST'||p.measure!=='BRL_MONTH'||p.time_band!=='ALL'||p.direction!=='DEBIT'||p.amount_text!=null||!['ACL','ACR'].includes(p.scenario)||!['NET','GROSS'].includes(p.treatment)||!Number.isInteger(p.revision)||p.revision<1||!p.source?.trim()||!p.base_rule?.trim())throw Error('Revise origem automática, tratamento, fonte e revisão do parâmetro.');
   if(!date(p.start_date)||!date(p.end_date)||p.start_date>period.start||p.end_date<period.end)throw Error('A origem automática precisa cobrir toda a competência; segmentação não é presumida.');
   if(scoped.some(q=>q!==p&&q.scenario===p.scenario&&q.monetary_source===p.monetary_source))throw Error('Há configuração concorrente ou rascunho para esta origem automática.');
   if(!p.unit_context||['distributor','tariff_group','tariff_subgroup','tariff_modality','state','consumption_class','free_market'].some(k=>(p.unit_context[k]??null)!==(unit[k]??null)))throw Error('O contexto elétrico mudou. Revise e aprove uma configuração atualizada.');
   const embedded=p.embedded_tax_codes??[];
   if(!Array.isArray(embedded)||new Set(embedded).size!==embedded.length||embedded.some(c=>typeof c!=='string'||!/^(ICMS|PIS|COFINS|IOF|OTHER_[A-Z0-9_]+)$/.test(c))||p.treatment==='GROSS'&&!embedded.length||p.treatment==='NET'&&embedded.length)throw Error('Declare os códigos embutidos somente para valores brutos.');
   let amount:bigint;const refs:OperationalTaxBases['lines'][number]['references']=[];
   if(p.monetary_source.startsWith('SUPPLIER_')){
    if(p.scenario!=='ACL'||supplier.month!==month||supplier.status!=='READY'||supplier.requirements.length||!supplier.contract||!supplier.rule||!supplier.measurements)throw Error('O faturamento do fornecedor ainda possui pendências; confira o card Fornecedor.');
    if(supplier.taxTreatment!==p.treatment)throw Error('O tratamento desta origem difere do faturamento contratual aprovado.');
    const regular=cents(supplier.regularAmount),minimum=cents(supplier.minimumAmount);if(minimum>regular)throw Error('Mínimo não consumido superior ao faturamento regular.');
    amount=p.monetary_source==='SUPPLIER_ENERGY'?regular-minimum:p.monetary_source==='SUPPLIER_MINIMUM'?minimum:cents(supplier.extraAmount);
    refs.push({id:supplier.rule.id,revision:supplier.rule.version,kind:'SUPPLIER_BILLING_RULE',source:supplier.rule.source},{id:supplier.contract.id,revision:supplier.rule.version,kind:'CONTRACT',source:'Contrato '+supplier.contract.number},{id:supplier.measurements.id,revision:supplier.measurements.revision,kind:'MEASUREMENTS',source:supplier.measurements.source});
    if(p.monetary_source==='SUPPLIER_EXTRA'){
     const items=supplier.extraSources;if(!Array.isArray(items)||new Set(items.map(i=>i.id)).size!==items.length||items.some(i=>i.effect!=='COST'||!i.id||!i.source?.trim()||i.taxTreatment!==(p.treatment==='NET'?'EXCLUDED':'INCLUDED')))throw Error('Compra extra exige fontes válidas, sem créditos nem tratamentos divergentes para esta base.');
     if(items.reduce((sum,i)=>sum+cents(i.amount),0n)!==amount)throw Error('A compra extra não concilia com os lançamentos de origem.');
     if(items.length){if(!supplier.costVersion)throw Error('Compra extra sem versão validada dos custos.');refs.push({id:supplier.costVersion.id,revision:supplier.costVersion.revision,kind:'MONTHLY_COSTS',source:supplier.costVersion.source},...items.map(i=>({id:i.id,revision:supplier.costVersion.revision,kind:'MONTHLY_COST_ITEM',source:i.source})));}
    }
   }else{
    if(!costs.version||!Number.isInteger(costs.version.revision)||costs.version.revision<1||!costs.version.validatedAt||!costs.version.source?.trim()||costs.blockers.length||!['AVAILABLE','NO_COSTS_DECLARED'].includes(costs.status))throw Error('Registre e valide os custos mensais antes de usar esta base.');
    refs.push({id:costs.version.id,revision:costs.version.revision,kind:'MONTHLY_COSTS',source:costs.version.source});
    amount=0n;
    if(costs.status==='NO_COSTS_DECLARED'){if(costs.groups.length)throw Error('Declaração de ausência de custos incompatível com os lançamentos.');}
    else{
     const category=p.monetary_source.slice('MONTHLY_'.length),rows=costs.groups.filter(g=>g.scenario===p.scenario).flatMap(g=>g.lines.filter(l=>l.category===category).map(l=>({...l,taxTreatment:g.taxTreatment})));
     if(!rows.length)throw Error('Nenhum lançamento validado para esta categoria e cenário. Ausência não equivale a zero.');
     if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Lançamentos repetidos na origem mensal.');
     for(const row of rows){if(row.effect!=='COST')throw Error('Esta categoria contém créditos; a incidência sobre créditos exige tratamento específico.');if(row.taxTreatment!==(p.treatment==='NET'?'EXCLUDED':'INCLUDED'))throw Error('Tratamento dos custos diverge do parâmetro; não combine valores líquidos, brutos ou não aplicáveis.');if(!row.id||!row.source?.trim())throw Error('Lançamento sem identificação ou fonte.');const v=cents(row.amount);if(row.signedAmount!==row.amount)throw Error('Sinal monetário incompatível com o custo.');amount+=v;refs.push({id:row.id,revision:costs.version.revision,kind:'MONTHLY_COST_ITEM',source:row.source});}
    }
   }
   if(refs.some(r=>!r.id||!Number.isInteger(r.revision)||r.revision<1||!r.source?.trim()))throw Error('Fonte operacional sem rastreabilidade válida.');
   const value=money(amount);
   result.lines.push({parameterId:p.id,revision:p.revision,label:p.label,scenario:p.scenario,component:p.component_code,timeBand:'ALL',measure:'BRL_MONTH',rate:'1',quantity:value,quantityUnit:'R$',measurementKey:p.monetary_source,exactAmount:value+'0000000000000',amount:value,treatment:p.treatment,embeddedTaxCodes:[...embedded],source:p.source,startDate:p.start_date,endDate:p.end_date,formula:'Valor da origem monetária validada; referência para tributação, sem novo lançamento.',monetarySource:p.monetary_source,references:refs});
  }catch(e){reject(e instanceof Error?e.message:'Origem operacional indisponível.');}
 }
 return result;
}
