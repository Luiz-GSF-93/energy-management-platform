import {TariffPreview} from './tariff-preview';
import {TaxMemory} from './tax-memory';
import {monthPeriod} from './preparation';
export type DistributorEntry={id:string;revision:number;kind:'TARIFF'|'TAX';label:string;amount:string;source:string;treatment?:string;embeddedTaxCodes?:string[]};
export type DistributorScenario={scenario:'ACR'|'ACL';status:'AVAILABLE'|'BLOCKED';tariffs:string|null;taxes:string|null;subtotal:string|null;embeddedTaxCodes?:string[];entries:DistributorEntry[];blockers:string[]};
export type DistributorSubtotal={formulaVersion:'distributor-subtotal-1.1';rounding:'SUM_ROUNDED_LINES';scenarios:DistributorScenario[];warnings:string[]};
const cents=(v:string)=>{if(typeof v!=='string'||v.length>80||!/^(0|[1-9][0-9]*)[.][0-9]{2}$/.test(v))throw Error('Valor monetário inválido');return BigInt(v.replace('.',''));};
const money=(v:bigint)=>{const s=v.toString().padStart(3,'0');return s.slice(0,-2)+'.'+s.slice(-2);};
const date=(v:unknown):v is string=>typeof v==='string'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
/** Sum of reviewed distributor components, never the total ACL/ACR cost or savings. */
export function distributorSubtotal(unit:any,month:string,parameters:any[],tariffs:TariffPreview,taxes:TaxMemory):DistributorSubtotal{
 const period=monthPeriod(month),scoped=parameters.filter(p=>p.organization_id===unit.organization_id&&p.customer_id===unit.customer_id&&p.consumer_unit_id===unit.id&&['TARIFF','TAX'].includes(p.kind)&&['APPROVED','DRAFT'].includes(p.status)&&(!date(p.start_date)||!date(p.end_date)||p.start_date<=period.end&&p.end_date>=period.start));
 const result:DistributorSubtotal={formulaVersion:'distributor-subtotal-1.1',rounding:'SUM_ROUNDED_LINES',scenarios:[],warnings:[
  'Subtotal das rubricas da distribuidora conferidas nesta consulta; não representa a fatura completa ou o custo total do cenário.',
  'Subtotal = soma das tarifas aprovadas (líquidas ou com tributos inclusos) + tributos calculados a acrescentar. Cada rubrica conserva seu arredondamento em centavos; as bases e referências dos tributos não são somadas novamente.',
  'Tarifas brutas só entram com os códigos embutidos conciliados com declarações aprovadas de tributo já incluído. Cada tributo classifica todas as tarifas na base ou nas exclusões, ou possui isenção/não aplicação aprovada. Os valores dos impostos embutidos não são extraídos nem somados outra vez.',
  'Fornecedor, custos adicionais, honorários, ultrapassagem e demanda não utilizada não são integrados neste subtotal. Não há cálculo de economia ou publicação financeira.'
 ]};
 for(const scenario of ['ACR','ACL'] as const){
  const out:DistributorScenario={scenario,status:'BLOCKED',tariffs:null,taxes:null,subtotal:null,embeddedTaxCodes:[],entries:[],blockers:[]};result.scenarios.push(out);
  const block=(m:string)=>{if(!out.blockers.includes(m))out.blockers.push(m);};
  const own=scoped.filter(p=>p.scenario===scenario),approved=own.filter(p=>p.status==='APPROVED'),tp=approved.filter(p=>p.kind==='TARIFF'),xp=approved.filter(p=>p.kind==='TAX');
  const lines=tariffs.lines.filter(l=>l.scenario===scenario),taxLines=taxes.lines.filter(l=>l.scenario===scenario),declarations=taxes.declarations.filter(l=>l.scenario===scenario);
  if(scoped.some(p=>!['ACR','ACL'].includes(p.scenario)))block('Há parâmetro com cenário inválido. Revise o cadastro.');
  if(own.some(p=>p.status==='DRAFT'))block('Há parâmetros em rascunho no período. Conclua a revisão antes de consolidar.');
  if(!tariffs.measurement)block('A competência precisa de medições validadas.');
  if(!tp.length)block('Cadastre tarifas aprovadas para este cenário.');
  if(approved.some(p=>!date(p.start_date)||!date(p.end_date)||p.start_date>period.start||p.end_date<period.end||!Number.isInteger(p.revision)||p.revision<1))block('As fontes precisam de revisão válida e cobertura integral do mês.');
  for(const p of tariffs.pending.filter(p=>p.scenario===scenario))block('Tarifa '+p.label+': '+p.reason);
  for(const p of taxes.pending.filter(p=>p.scenario===scenario))block('Tributo '+p.label+': '+p.reason);
  for(const code of ['ICMS','PIS','COFINS','IOF'])if(xp.filter(p=>p.component_code===code).length!==1)block('Informe uma configuração aprovada de '+code+', inclusive isenção ou não aplicação justificada.');
  if(lines.some(l=>!tp.some(p=>p.id===l.parameterId&&p.revision===l.revision))||taxLines.some(l=>!xp.some(p=>p.id===l.id&&p.revision===l.revision))||declarations.some(l=>!xp.some(p=>p.id===l.id)))block('A memória contém fontes sem correspondência no cadastro desta unidade.');
  if(new Set(approved.map(p=>p.id)).size!==approved.length)block('Fontes duplicadas no cadastro. Revise antes de consolidar.');
  let tariffSum=0n,taxSum=0n;
  for(const p of tp){const candidates=lines.filter(l=>l.parameterId===p.id&&l.revision===p.revision),l=candidates[0];
   if(candidates.length!==1){block('Tarifa '+p.label+': memória ausente ou duplicada.');continue;}
   const codes=p.embedded_tax_codes??[],lc=l.embeddedTaxCodes;
   if(!['NET','GROSS'].includes(p.treatment)||p.treatment!==l.treatment||!Array.isArray(codes)||!Array.isArray(lc)||new Set(codes).size!==codes.length||new Set(lc).size!==lc.length||codes.length!==lc.length||codes.some((c:any)=>typeof c!=='string'||!/^(ICMS|PIS|COFINS|IOF|OTHER_[A-Z0-9_]+)$/.test(c)||!lc.includes(c))||p.treatment==='NET'&&codes.length||p.treatment==='GROSS'&&!codes.length){block('Tarifa '+p.label+': concilie tratamento e códigos de tributos embutidos.');continue;}
   for(const code of codes){const configured=xp.filter(t=>t.component_code===code);if(configured.length!==1||configured[0].treatment!=='INCLUDED')block('Tarifa '+p.label+': o tributo embutido '+code+' precisa de uma declaração aprovada de já incluído.');}
   out.embeddedTaxCodes=[...new Set([...out.embeddedTaxCodes!,...codes])].sort();
   if(!l.source?.trim()){block('Tarifa '+p.label+': fonte ausente.');continue;}
   try{tariffSum+=cents(l.amount);out.entries.push({id:p.id,revision:p.revision,kind:'TARIFF',label:l.label,amount:l.amount,source:l.source,treatment:l.treatment,embeddedTaxCodes:[...l.embeddedTaxCodes]});}catch{block('Tarifa '+p.label+': valor inválido.');}
  }
  for(const p of xp){const ls=taxLines.filter(l=>l.id===p.id&&l.revision===p.revision),ds=declarations.filter(l=>l.id===p.id);
   if(ls.length+ds.length!==1){block('Tributo '+p.label+': memória ou declaração ausente/duplicada.');continue;}
   if(ds.length){const d=ds[0];
    if(!['EXEMPT','NOT_APPLICABLE','INCLUDED'].includes(p.treatment)||d.treatment!==p.treatment||!d.source?.trim())block('Tributo '+p.label+': declaração incompatível.');
    if(p.treatment==='INCLUDED'){
     const refs=d.references;
     if(d.revision!==p.revision||!Array.isArray(refs)||refs.length!==tp.length||tp.some(t=>{const rs=refs.filter(r=>r.id===t.id&&r.revision===t.revision);return rs.length!==1||rs[0].operation!==(t.treatment==='GROSS'&&Array.isArray(t.embedded_tax_codes)&&t.embedded_tax_codes.includes(p.component_code)?'INCLUDE':'EXCLUDE');})||refs.some(r=>!tp.some(t=>t.id===r.id&&t.revision===r.revision))||!refs.some(r=>r.operation==='INCLUDE'))block('Tributo '+p.label+': concilie cada tarifa bruta ou líquida com a declaração de já incluído e sua revisão.');
    }
    continue;
   }
   const l=ls[0];
   if(!['INSIDE','OUTSIDE'].includes(l.treatment)||p.treatment!==l.treatment||!l.source?.trim()){block('Tributo '+p.label+': tratamento ou fonte incompatível.');continue;}
   if(tp.some(t=>{const refs=l.references.filter(r=>r.id===t.id&&r.revision===t.revision&&['INCLUDE','EXCLUDE'].includes(r.operation));return refs.length!==1;})){block('Tributo '+p.label+': classifique cada tarifa do cenário na base ou nas exclusões.');continue;}
   if(l.references.some(r=>!tp.some(t=>t.id===r.id&&t.revision===r.revision))){block('Tributo '+p.label+': a base contém rubricas fora da distribuidora. Consulte a memória tributária; a composição entre fornecedor, custos e tarifas aguarda consolidação geral.');continue;}
   try{taxSum+=cents(l.amount);out.entries.push({id:p.id,revision:p.revision,kind:'TAX',label:l.label,amount:l.amount,source:l.source});}catch{block('Tributo '+p.label+': valor inválido.');}
  }
  out.entries.sort((a,b)=>(a.kind+':'+a.id).localeCompare(b.kind+':'+b.id));
  if(!out.blockers.length){out.status='AVAILABLE';out.tariffs=money(tariffSum);out.taxes=money(taxSum);out.subtotal=money(tariffSum+taxSum);}
 }
 return result;
}
