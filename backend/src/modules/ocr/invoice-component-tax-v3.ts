import {invoiceComparisonV2} from './invoice-comparison-v2';
import {globalModelLayout} from './eva-global-model';
import type {InvoiceComparison} from './eva-tariff-workbench.model';

const S=1000000n,R=100000000n;
const norm=(s:unknown)=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const dec=(s:unknown)=>{if(typeof s!=='string'||!/^\d{1,12}(\.\d{1,6})?$/.test(s))throw Error('Quantidade ou tarifa sem fonte decimal.');const [a,b='']=s.split('.');return BigInt(a)*S+BigInt(b.padEnd(6,'0'));};
const cents=(s:string)=>{if(!/^-?\d{1,12}\.\d{2}$/.test(s))throw Error('Valor sem conciliação.');return BigInt(s.replace('.',''));};
const fixed=(n:bigint,p=2)=>{const s=(n<0n?-n:n).toString().padStart(p+1,'0');return (n<0n?'-':'')+s.slice(0,-p)+'.'+s.slice(-p);};
const round=(n:bigint,d:bigint)=>{if(d<=0n)throw Error('Base tributária inválida.');return (n<0n?-1n:1n)*(((n<0n?-n:n)+d/2n)/d);};
export function demandConsumptionRule(contracted:string,measured:string){
 const c=dec(contracted),m=dec(measured);if(c<=0n)throw Error('Demanda contratada sem valor positivo.');
 return {contracted,measured,unused:fixed(c>m?c-m:0n,6),limit:fixed(c*105n/100n,6),tolerancePercent:'5.00',exceedsTolerance:m*100n>c*105n,excess:fixed(m*100n>c*105n?m-c:0n,6),method:'REN1000_ART301_CONSUMPTION_5_PERCENT'};
}
/** A common rational gross-up, independent of distributor name and without binary money arithmetic. */
export function componentGross(n:bigint,d:bigint,rates:{icms:string;pis:string;cofins:string},icms=true){
 const i=icms?dec(rates.icms):0n,p=dec(rates.pis),c=dec(rates.cofins);if(i>=R||p+c>=R)throw Error('Alíquota incompatível com cálculo por dentro.');
 const gn=n*R*R,gd=d*(R-i)*(R-p-c),gross=round(gn*100n,gd),net=round(n*100n,d),icmsValue=round(gn*i*100n,gd*R),pis=round(gn*(R-i)*p*100n,gd*R*R),cofins=gross-net-icmsValue-pis;
 return {amount:fixed(gross),netAmount:fixed(net),taxes:{icmsAmount:fixed(icmsValue),pisAmount:fixed(pis),cofinsAmount:fixed(cofins)},roundingAdjustment:fixed(cofins-round(gn*(R-i)*c*100n,gd*R*R)),proof:{netNumerator:n.toString(),netDenominator:d.toString(),grossNumerator:gn.toString(),grossDenominator:gd.toString(),rates:{...rates,icms:icms?rates.icms:'0'},method:'ICMS_INSIDE_PIS_COFINS_EXCLUDE_ICMS',rounding:'HALF_UP_GROSS_AND_TAX_CENTS_WITH_DISCLOSED_RESIDUAL'}};
}
function rational(line:any){
 const quantity=dec(line.quantity);if(line.proportional){const proof=line.proportional;if(!Number.isInteger(proof.days)||proof.days<1||!Array.isArray(proof.segments)||proof.segments.reduce((n:number,s:any)=>n+s.days,0)!==proof.days)throw Error('Ciclo tarifário inválido.');const weighted=proof.segments.reduce((n:bigint,s:any)=>n+dec(s.rate)*BigInt(s.days),0n);if(weighted.toString()!==proof.weightedMicroRateDays)throw Error('Memória de vigência alterada.');return [quantity*weighted,S*S*BigInt(proof.days)*(line.measure==='BRL_MWH'?1000n:1n)];}
 return [quantity*dec(line.value),S*S*(line.measure==='BRL_MWH'?1000n:1n)];
}
export function repriceComponentGross(line:any,quantity:string,rateOverride?:string){const candidate={...line,quantity,...(rateOverride!==undefined?{value:rateOverride,proportional:undefined}:{})},[n,d]=rational(candidate);return componentGross(n,d,line.proof.rates,line.component!=='TUSD_DEMAND_UNUSED').amount;}
function ratesOf(base:InvoiceComparison){
 const get=(code:string)=>{const found=base.taxes?.filter(t=>t.code===code&&t.printedRate?.value!=null);if(found?.length!==1||!found[0].printedRate.source)throw Error('Alíquota e fonte da competência não demonstradas: '+code);dec(found[0].printedRate.value);return found[0].printedRate.value;};
 return {icms:get('icmsAmount'),pis:get('pisAmount'),cofins:get('cofinsAmount')};
}
/** The unchanged V2 first verifies identity, invoice total, tax extraction and library validity.
 * V3 then builds a separate ACR fiscal base; it never rewrites the original invoice or OCR. */
export function invoiceComponentTaxV3(c:any,p:any,libraries:any[]):InvoiceComparison{
 const expanded=libraries.map(lib=>!Array.isArray(lib?.profile?.items)?lib:({...lib,profile:{...lib.profile,items:[...lib.profile.items,...lib.profile.items.filter((i:any)=>i.component==='TUSD_DEMAND_USED'&&!lib.profile.items.some((x:any)=>x.component==='TUSD_DEMAND_UNUSED'&&x.band===i.band)).map((i:any)=>({...i,component:'TUSD_DEMAND_UNUSED',label:'Demanda não utilizada · mesma TUSD líquida'}))]}}));
 const base=invoiceComparisonV2(c,p,expanded),r:InvoiceComparison={...base,method:'COMPONENT_TAXES_V3',amount:null,lines:[],retained:[],taxes:base.taxes,observations:['ACR recalculado por componente: ICMS por dentro na parcela utilizada; demanda não utilizada sem ICMS. PIS/Cofins calculados sobre a base sem ICMS. Valores ACL da fatura preservados.'],missing:[...base.missing]};
 if(base.amount===null||base.missing.length)return r;
 try{
  const rates=ratesOf(base),layout=globalModelLayout(c.source.raw),rows=layout.operations.filter(row=>['CHARGE','CREDIT'].includes(row.role)),demand=rows.filter(row=>row.role==='CHARGE'&&['DEMAND_BILLED','DEMAND_UNUSED'].includes(row.component));
  const adjusted:any[]=[];
  for(const line of base.lines){
   if(!['TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED'].includes(line.component)){adjusted.push({...line});continue;}
   if(line.component==='TUSD_DEMAND_UNUSED')continue;
   const band=line.band,ds=demand.filter(row=>(row.period==='UNSPECIFIED'?'ALL':row.period)===band);
   const explicitUnused=ds.filter(row=>row.component==='DEMAND_UNUSED'||/DEMANDA\s+NAO\s+UTILIZADA/.test(norm(row.fields.description.text)));
   let used=ds.filter(row=>!explicitUnused.includes(row)),unused=explicitUnused;
   if(!unused.length&&ds.length===2){
    const taxed=ds.filter(row=>row.fields.icmsAmount?.decimal&&dec(row.fields.icmsAmount.decimal)>0n),contract=c.unit[band==='PEAK'?'contracted_demand_peak':band==='OFF_PEAK'?'contracted_demand_off_peak':'contracted_demand'];
    if(taxed.length!==1||contract==null||ds.reduce((n,row)=>n+dec(row.fields.quantity.decimal),0n)!==dec(String(contract)))throw Error('Conferir a partição da demanda faturada contra a demanda contratada: '+band);
    used=taxed;unused=ds.filter(row=>row!==taxed[0]);
    if(dec(unused[0].fields.quantity.decimal)!==dec(String(contract))-dec(used[0].fields.quantity.decimal))throw Error('Demanda não utilizada diverge de contratada menos utilizada.');
   }
   if(!used.length||used.length>1||unused.length>1)throw Error('Parcelas de demanda ambíguas: '+band);
   for(const [component,group] of [['TUSD_DEMAND_USED',used],['TUSD_DEMAND_UNUSED',unused]] as const){if(!group.length)continue;const q=group[0].fields.quantity.decimal;if(!q)throw Error('Quantidade faturada da demanda ausente.');adjusted.push({...line,component,label:component==='TUSD_DEMAND_USED'?'Demanda utilizada':'Demanda não utilizada',quantity:q,quantitySource:group[0].source,partitionMethod:explicitUnused.length?'EXPLICIT_BILLED_COMPONENT':'CONTRACT_TOTAL_MINUS_POSITIVE_ICMS_BILLED_SHARE'});}
   const contract=c.unit[band==='PEAK'?'contracted_demand_peak':band==='OFF_PEAK'?'contracted_demand_off_peak':'contracted_demand'];
   if(contract!=null){const proof=demandConsumptionRule(String(contract),used[0].fields.quantity.decimal!);(r as any).demandRules=[...((r as any).demandRules??[]),{band,...proof,source:used[0].source}];}
  }
  const flag=tariffFlag(c,p,layout,base);
  for(const line of [...adjusted,...flag]){const [n,d]=rational(line),gross=componentGross(n,d,rates,line.component!=='TUSD_DEMAND_UNUSED');r.lines.push({...line,...gross,taxTreatment:'GROSS',netRate:line.value});}
  const excluded=new Set(['TE','TUSD_ENERGY','DEMAND_BILLED','DEMAND_UNUSED','ACL_DISTRIBUTOR_INFORMATION','ACL_ENERGY_DISCOUNT','TARIFF_SUBSIDY','SUBSIDY_CREDIT','CDE_WATER_SCARCITY','CDE_COVID','TARIFF_FLAG']);
  for(const row of rows){if(excluded.has(row.component))continue;const amount=row.fields.amount.decimal!;cents(amount);r.retained.push({kind:row.component==='REACTIVE_ENERGY'?'REACTIVE':'INVOICE_CHARGE',label:row.component==='DEMAND_EXCESS'?'Ultrapassagem de demanda · '+row.fields.description.text:row.fields.description.text,amount,source:row.source,quantity:row.fields.quantity?.decimal??null,note:'Valor final conciliado da fatura; mantido uma vez, sem novos tributos.'});}
  const keys=['icmsAmount','pisAmount','cofinsAmount'];
  r.acrTaxes=keys.map(code=>({code,scenario:'ACR',amount:fixed(r.lines.reduce((n,line)=>n+cents(line.taxes[code]),0n)),printedRate:base.taxes!.find(t=>t.code===code).printedRate,method:'RECALCULATED_COMPONENT_INSIDE',summarySource:'Memória fiscal ACR V3',cells:r.lines.map(line=>({source:line.source,amount:line.taxes[code],component:line.component})),note:'Imposto já incluído nos valores brutos das linhas; não somar novamente.'}));
  r.supplierIcms=supplierInside(p,rates.icms,base.taxes!.find(t=>t.code==='icmsAmount').printedRate.source);
  r.amount=fixed(r.lines.reduce((n,line)=>n+cents(line.amount),0n)+r.retained.reduce((n,row)=>n+cents(row.amount),0n));
  if(cents(r.amount)<0n)throw Error('ACR total negativo.');
  r.observations.push('Bandeira incluída somente no ACR com fonte e vigência. Descontos de energia ACL, subvenções e encargos específicos do ACL não são transferidos ao ACR. Reativos e ultrapassagem faturados são desperdícios já contidos no fechamento.');
 }catch(e){r.amount=null;r.missing.push(e instanceof Error?e.message:'Composição fiscal por componente indisponível.');}
 return r;
}
function supplierInside(p:any,rate:string,source:string){
 const treatment=p.fields?.find((f:any)=>f.key==='supplier:tax'&&f.state==='FILLED')?.value;
 const amount=p.operational?.supplier?.amount;if(!amount)throw Error('Valor do fornecedor ausente.');
 if(['GROSS','INCLUDED','EXEMPT','NOT_APPLICABLE','COMPONENTS_CONFIRMED'].includes(treatment))return {method:'PRESERVED_CONFIRMED_TREATMENT',base:amount,icmsAmount:'0.00',amount,additional:false,source,treatment};
 const base=cents(amount),i=dec(rate);if(i>=R)throw Error('ICMS fornecedor inválido.');const gross=round(base*R,R-i);
 return {method:'ICMS_INSIDE',base:amount,rate,icmsAmount:fixed(gross-base),amount:fixed(gross),additional:true,source,treatment:'NET_WITH_ICMS_INSIDE',note:'Política de fechamento solicitada pelo responsável: ICMS por dentro sobre energia líquida; PIS/Cofins não reaplicados. Não declara pagamento.'};
}
function tariffFlag(c:any,p:any,layout:any,base:InvoiceComparison){
 const texts=(layout.blocks??[]).filter((b:any)=>b.kind==='FLAGS_GD').map((b:any)=>({text:norm(b.rows.flatMap((r:any)=>r.cells.map((cell:any)=>cell.value.text)).join(' ')),source:b.source}));
 const matches=texts.flatMap((b:any)=>[...b.text.matchAll(/\b(VERDE|AMARELA|VERMELHA(?:\s+(?:PATAMAR\s+)?[12]))\s+(\d{1,2})\s+DIAS\b/g)].map((m:any)=>({color:m[1],days:Number(m[2]),source:b.source})));
 const fields=layout.fields??[],cycleDays=Number(fields.find((f:any)=>f.name==='billingDays')?.value?.text);
 const registered=(c.captured?.parameters??[]).filter((x:any)=>x.kind==='TARIFF'&&x.component_code==='TARIFF_FLAG'&&x.scenario==='ACR'&&x.organization_id===c.unit.organization_id&&x.consumer_unit_id===c.unit.id&&x.customer_id===c.unit.customer_id&&x.status==='APPROVED'&&x.treatment==='NET'&&x.source?.trim()&&x.start_date<=c.month+'-01'&&x.end_date>=c.month+'-'+String(new Date(Number(c.month.slice(0,4)),Number(c.month.slice(5)),0).getDate()));
 let rate:string,source:string;
 if(registered.length){return base.lines.filter(line=>line.component==='TE').map(line=>{const matches=registered.filter((x:any)=>x.time_band==='ALL'||x.time_band===line.band);if(matches.length!==1||!['BRL_KWH','BRL_MWH'].includes(matches[0].measure))throw Error('Bandeira ACR: conferir tarifa única para o posto '+line.band);const record=matches[0];if(!Number.isInteger(record.revision)||record.revision<1||!record.unit_context||['distributor','tariff_group','tariff_subgroup','tariff_modality','state','consumption_class','free_market'].some(key=>(record.unit_context[key]??null)!==(c.unit[key]??null)))throw Error('Bandeira ACR: contexto cadastral ou revisão da tarifa mudou.');dec(record.amount_text);return {component:'TARIFF_FLAG',label:'Adicional de bandeira tarifária',band:line.band,measure:record.measure,value:record.amount_text,quantity:line.quantity,quantitySource:line.quantitySource,source:'Parâmetro '+record.id+' r'+record.revision+' · '+record.source};});}
 else {
  if(matches.length!==1||!Number.isInteger(cycleDays)||matches[0].days!==cycleDays)throw Error('Bandeira ACR: conferir cor, dias e tarifa vigente; CDE não substitui bandeira.');
  // A dated public evidence set, not an indefinitely extended regulatory constant.
  if(c.month<'2024-04'||c.month>'2026-05')throw Error('Bandeira ACR: cadastre a tarifa vigente e sua fonte para esta competência.');
  rate=({VERDE:'0.000000',AMARELA:'0.018850','VERMELHA 1':'0.044630','VERMELHA 2':'0.078770'} as any)[matches[0].color.replace('PATAMAR ','')];if(!rate)throw Error('Patamar da bandeira não identificado.');
  source='CCEE boletim público nº97 maio/2026, tabela2 / REH3306/2024 · '+matches[0].source+' · '+matches[0].days+' dias';
 }
 const record=registered[0],measure=record?.measure??'BRL_KWH';dec(rate!);
 return base.lines.filter(line=>line.component==='TE').map(line=>({component:'TARIFF_FLAG',label:'Adicional de bandeira tarifária',band:line.band,measure,value:rate!,quantity:line.quantity,quantitySource:line.quantitySource,source}));
}
