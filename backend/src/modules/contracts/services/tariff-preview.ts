import {billedDemandIssues} from './billed-demand';
import {prepareMeasurements} from './preparation-measurements';

// Money arithmetic uses integer coefficients, never binary floating point.
const SCALE=1000000n;
const RATE=/^(0|[1-9][0-9]{0,11})([.][0-9]{1,9})?$/;
const DECIMAL=/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/;
function coefficient(value:unknown):bigint {
 if(typeof value!=='string'||!DECIMAL.test(value))throw new Error('Decimal inválido');
 const [whole,fraction='']=value.split('.');return BigInt(whole)*SCALE+BigInt(fraction.padEnd(6,'0'));
}
function fixed(value:bigint,places:number){const text=value.toString().padStart(places+1,'0');return text.slice(0,-places)+'.'+text.slice(-places);}
export function tariffProduct(quantity:string,rate:string,perMwh=false){
 if(typeof rate==='string'&&RATE.test(rate)&&(rate.split('.')[1]?.length??0)>6){
  const [w,f='']=rate.split('.'),product=coefficient(quantity)*(BigInt(w)*1000000000n+BigInt(f.padEnd(9,'0'))),denominator=1000000000000000n*(perMwh?1000n:1n);
  return {exact:fixed(product,perMwh?18:15),rounded:fixed((product*100n+denominator/2n)/denominator,2)};
 }
 const product=coefficient(quantity)*coefficient(rate),denominator=SCALE*SCALE*(perMwh?1000n:1n);
 // HALF_UP to centavos; exact product is retained separately for future composition.
 const cents=(product*100n+denominator/2n)/denominator;
 return {exact:fixed(product,perMwh?15:12),rounded:fixed(cents,2)};
}
type Period={start:string;end:string};
export type TariffLine={parameterId:string;revision:number;label:string;scenario:string;component:string;timeBand:string;measure:string;rate:string;quantity:string;quantityUnit:string;measurementKey:string;exactAmount:string;amount:string;treatment:string;embeddedTaxCodes:string[];source:string;startDate:string;endDate:string;formula:string;quantitySource?:string};
export type TariffPreview={mode:'TARIFF_COMPONENT_PREVIEW';formulaVersion:'tariffs-1.4';rounding:'HALF_UP_PER_LINE';measurement:{id:string;version:number;revision:number;source:string}|null;lines:TariffLine[];pending:{parameterId:string;label:string;scenario:string;reason:string}[];warnings:string[]};
const validDay=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export function previewTariffs(unit:any,month:string,period:Period,parameters:any[],monthly:any[]):TariffPreview {
 const checked=prepareMeasurements(unit,month,monthly),v=checked.validatedVersion;
 const result:TariffPreview={mode:'TARIFF_COMPONENT_PREVIEW',formulaVersion:'tariffs-1.4',rounding:'HALF_UP_PER_LINE',measurement:v?{id:v.id,version:v.version,revision:v.revision,source:v.source}:null,lines:[],pending:[],warnings:[
  'Prévia por rubrica: não representa custo total, economia, cobrança ou resultado validado.',
  'Tributos não são acrescidos nem desmembrados. Cada linha conserva o tratamento cadastrado.',
  'Demanda faturável usa quantidade explícita validada por cenário; parcelas utilizada/não utilizada exigem quantidades explícitas e tarifas próprias. Não calcula ultrapassagem. Fornecedor, custos adicionais, rateios e honorários não estão totalizados.',
  'Consulta somente leitura. Fontes podem mudar após a consulta; esta memória não é um histórico financeiro imutável.'
 ]};
 const scoped=parameters.filter(p=>p.organization_id===unit.organization_id&&p.consumer_unit_id===unit.id&&p.customer_id===unit.customer_id&&p.kind==='TARIFF'&&p.status==='APPROVED');
 const candidates=scoped.filter(p=>!validDay(p.start_date)||!validDay(p.end_date)||p.start_date<=period.end&&p.end_date>=period.start).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 if(!candidates.length)result.warnings.push('Nenhuma tarifa aprovada encontrada para esta unidade e competência.');
 const measurementVersionReady=checked.status==='VALIDATED'&&v!==null;
 // Missing measured demand is independent of kWh-based component previews. All other
 // source/history/context/consumption checks remain mandatory, and prepareMonth keeps
 // MEASUREMENTS_DEMAND as a financial-closing blocker.
 let partialConsumptionPreview=false;
 for(const p of candidates){
  const reject=(reason:string)=>result.pending.push({parameterId:String(p.id),label:String(p.label||'Tarifa'),scenario:String(p.scenario||''),reason});
  const usesConsumption=['TE','TUSD_ENERGY','CDE_WATER_SCARCITY','TARIFF_FLAG'].includes(p.component_code)&&['BRL_KWH','BRL_MWH'].includes(p.measure);
  const demandCodes=['TUSD_DEMAND','TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED'];
  const usesBilling=demandCodes.includes(p.component_code)&&p.measure==='BRL_KW';
  const split=p.component_code==='TUSD_DEMAND_USED'||p.component_code==='TUSD_DEMAND_UNUSED';
  const relevantFindings=checked.findings.filter(f=>!((usesConsumption||split)&&f.code==='MEASUREMENTS_DEMAND'));
  if(!measurementVersionReady||relevantFindings.length){reject('Medições pendentes ou inconsistentes. Corrija e valide em Dados mensais.');continue;}
  if(unit.free_market!==true||!((unit.tariff_group==='A'&&['BLUE','GREEN'].includes(unit.tariff_modality))||(unit.tariff_group==='B'&&unit.tariff_modality==='CONVENTIONAL'))){reject('Enquadramento ou modalidade ainda não suportado por esta prévia.');continue;}
  if(!validDay(p.start_date)||!validDay(p.end_date)||p.start_date>period.start||p.end_date<period.end){reject('A tarifa não cobre o mês inteiro. É necessária medição segmentada, sem rateio automático por dias.');continue;}
  if(candidates.some(q=>q!==p&&q.scenario===p.scenario&&q.component_code===p.component_code&&(q.time_band===p.time_band||q.time_band==='ALL'||p.time_band==='ALL'))){reject('Há tarifas concorrentes ou combinação de todos os postos com ponta/fora ponta. Revise para evitar dupla contagem.');continue;}
  if(usesBilling&&candidates.some(q=>q!==p&&q.scenario===p.scenario&&demandCodes.includes(q.component_code)&&((p.component_code==='TUSD_DEMAND')!==(q.component_code==='TUSD_DEMAND')))){reject('Não combine demanda total com parcelas utilizada/não utilizada no mesmo cenário e período.');continue;}
  if(split&&!candidates.some(q=>q.scenario===p.scenario&&q.component_code===(p.component_code==='TUSD_DEMAND_USED'?'TUSD_DEMAND_UNUSED':'TUSD_DEMAND_USED')&&q.time_band==='ALL'&&q.measure==='BRL_KW'&&validDay(q.start_date)&&validDay(q.end_date)&&q.start_date<=period.start&&q.end_date>=period.end)){reject('Aprove as duas tarifas das parcelas para toda a competência.');continue;}
  if(!p.unit_context||['distributor','tariff_group','tariff_subgroup','tariff_modality','state','consumption_class','free_market'].some(k=>(p.unit_context[k]??null)!==(unit[k]??null))){reject('Cadastro elétrico diferente do contexto aprovado da tarifa. Cadastre e aprove a vigência corrigida.');continue;}
  if(!['ACL','ACR'].includes(p.scenario)||!Number.isInteger(p.revision)||p.revision<1||typeof p.source!=='string'||!p.source.trim()||p.direction!=='DEBIT'||!['NET','GROSS'].includes(p.treatment)||(p.treatment==='GROSS'&&(!Array.isArray(p.embedded_tax_codes)||!p.embedded_tax_codes.length))){reject('Fonte, revisão, natureza ou tratamento da tarifa exige revisão.');continue;}
  let key='',quantityUnit='kWh',explicitQuantity:string|undefined,quantitySource:string|undefined;
  if(['TE','TUSD_ENERGY','CDE_WATER_SCARCITY','TARIFF_FLAG'].includes(p.component_code)&&['BRL_KWH','BRL_MWH'].includes(p.measure)){
   key=({ALL:'consumptionTotal',PEAK:'consumptionPeak',OFF_PEAK:'consumptionOffPeak'} as Record<string,string>)[p.time_band]||'';
   if(unit.tariff_group==='A'&&p.time_band==='ALL'||unit.tariff_group==='B'&&p.time_band!=='ALL'){reject('Posto tarifário incompatível com a modalidade: grupo A exige ponta/fora ponta e convencional exige todos os postos.');continue;}
  }else if(p.component_code==='REACTIVE'&&p.measure==='BRL_KVARH'&&p.time_band==='ALL'){key='reactiveTotal';quantityUnit='kVArh';}
  else if(p.component_code==='REACTIVE'&&['BRL_KWH','BRL_MWH'].includes(p.measure)&&['PEAK','OFF_PEAK'].includes(p.time_band)&&unit.tariff_group==='A'){
   key=p.time_band==='PEAK'?'reactiveBilledPeakKwh':'reactiveBilledOffPeakKwh';quantitySource='Reativo faturado da versão mensal validada; mesma quantidade física nos cenários ACL e ACR, sem conversão para kVArh.';
  }
  else if(usesBilling){
   const d=v!.billedDemand?.[p.scenario];
   if(!d){reject('Informe a demanda faturável explícita deste cenário em Dados mensais; demanda medida não é demanda faturável.');continue;}
   if(billedDemandIssues({[p.scenario]:d},unit,true).length){reject('Demanda faturável incompleta ou incompatível com a modalidade. Corrija e valide os dados mensais.');continue;}
   if(unit.tariff_group!=='A'||unit.tariff_modality==='GREEN'&&p.time_band!=='ALL'||unit.tariff_modality==='BLUE'&&!['PEAK','OFF_PEAK'].includes(p.time_band)){reject('Posto da demanda faturável incompatível: verde exige única; azul exige ponta/fora ponta.');continue;}
   if(split&&(unit.tariff_modality!=='GREEN'||d.used==null||d.unused==null)){reject('Informe e valide as parcelas utilizadas e não utilizadas da demanda única deste cenário.');continue;}
   const field=split?(p.component_code==='TUSD_DEMAND_USED'?'used':'unused'):({ALL:'single',PEAK:'peak',OFF_PEAK:'offPeak'} as Record<string,string>)[p.time_band];
   key='billedDemand.'+p.scenario+'.'+field;explicitQuantity=d[field];quantitySource=d.source;quantityUnit='kW';
  }
  else {reject(p.measure==='BRL_KW'?'Demanda medida não é automaticamente demanda faturável. Regra contratada/medida e ultrapassagem ainda precisam de tratamento.':'Rubrica, unidade de medida ou posto ainda não suportado. Nenhuma fórmula foi inferida do texto.');continue;}
  const quantity=explicitQuantity??v!.measurements[key];
  if(!key||typeof quantity!=='string'||!DECIMAL.test(quantity)||typeof p.amount_text!=='string'||!(usesBilling?RATE:DECIMAL).test(p.amount_text)){reject('Quantidade ou tarifa decimal não informada/ inválida. Ausência não equivale a zero.');continue;}
  const product=tariffProduct(quantity,p.amount_text,p.measure==='BRL_MWH');
  if((usesConsumption||split)&&checked.findings.some(f=>f.code==='MEASUREMENTS_DEMAND'))partialConsumptionPreview=true;
  result.lines.push({parameterId:p.id,revision:p.revision,label:p.label,scenario:p.scenario,component:p.component_code,timeBand:p.time_band,measure:p.measure,rate:p.amount_text,quantity,quantityUnit,measurementKey:key,exactAmount:product.exact,amount:product.rounded,treatment:p.treatment,embeddedTaxCodes:Array.isArray(p.embedded_tax_codes)?p.embedded_tax_codes:[],source:p.source,startDate:p.start_date,endDate:p.end_date,...(quantitySource?{quantitySource}:{}),formula:p.measure==='BRL_KW'?'demanda faturável informada × tarifa':p.measure==='BRL_MWH'?'kWh × R$/MWh ÷ 1000':'quantidade × tarifa'});
 }
 // Split billing is indivisible: an invalid counterpart must not produce a partial charge.
 for(const scenario of ['ACL','ACR']){
  const pair=candidates.filter(p=>p.scenario===scenario&&['TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED'].includes(p.component_code));
  if(pair.some(p=>result.pending.some(f=>f.parameterId===String(p.id)))){
   const removed=result.lines.filter(l=>l.scenario===scenario&&['TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED'].includes(l.component));
   result.lines=result.lines.filter(l=>!removed.includes(l));
   for(const l of removed)result.pending.push({parameterId:l.parameterId,label:l.label,scenario,reason:'Uma das parcelas está pendente; revise o conjunto antes de calcular a demanda.'});
  }
 }
 if(partialConsumptionPreview)result.warnings.push('Prévia parcial: consumos e quantidades faturáveis usam as respectivas fontes validadas. A demanda medida continua pendente e impede o fechamento completo; seus valores não foram inferidos.');
 return result;
}
