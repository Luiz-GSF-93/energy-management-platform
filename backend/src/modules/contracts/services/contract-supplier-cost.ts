import {monthPeriod} from './preparation';
import {prepareMeasurements} from './preparation-measurements';
import {monthlyCostLedger} from './monthly-cost-ledger';
import {supplierToday} from './supplier-cycle';
import {supplierVolumeLimits} from './supplier-volume-limits';
const SCALE=10n**12n;
function dec(v:unknown,p=12):bigint {const s=String(v);if(!new RegExp('^(0|[1-9][0-9]{0,11})([.][0-9]{1,'+p+'})?$').test(s))throw Error('Decimal inválido');const [a,b='']=s.split('.');return BigInt(a)*10n**BigInt(p)+BigInt(b.padEnd(p,'0'));}
function signed(v:unknown,p=6){const s=String(v);return s.startsWith('-')?-dec(s.slice(1),p):dec(s,p);}
function fixed(v:bigint,p=12){const negative=v<0n,n=negative?-v:v,s=n.toString().padStart(p+1,'0');return (negative?'-':'')+s.slice(0,-p)+'.'+s.slice(-p);}
function round(n:bigint,d:bigint){return (n+d/2n)/d;}
const day=(v:any)=>String(v??'').slice(0,10);
const amount=(v:bigint,p:bigint)=>round(v*p*100n,SCALE*SCALE);
/** Contractual supplier energy only. NF is evidence for reconciliation, never a second cost. */
export function contractSupplierCost(unit:any,month:string,contracts:any[],prices:any[],rules:any[],inputs:any[],costRows:any[],now=new Date()){
 const period=monthPeriod(month),r:any={formulaVersion:'contract-supplier-1.0',status:'BLOCKED',month,contract:null,rule:null,measurements:null,contractedMwh:null,consumedMwh:null,minMwh:null,maxMwh:null,billedMwh:null,minimumUnusedMwh:null,extraMwh:null,pricePerMwh:null,taxTreatment:null,regularAmount:null,minimumAmount:null,extraAmount:null,totalAmount:null,invoiceAmount:null,invoiceDifference:null,bands:[],requirements:[],warnings:[
  'Mínimo = volume contratado × percentual mínimo / 100. Máximo = volume contratado × (100 + tolerância superior) / 100. Compra extra somente acima desse máximo.',
  'Volume faturável regular = mínimo(máximo(consumo, mínimo contratual), máximo contratual). Excedente exige compra extra com valor e fonte validados.',
  'Energia de ponta e fora ponta usa o mesmo preço; a cobertura contratual é distribuída proporcionalmente ao consumo medido dos postos. O mínimo não consumido é destacado separadamente.',
  'Energia por posto, mínimo e compra extra compõem o mesmo custo do fornecedor. Não somar novamente a nota fiscal nem repetir esses valores no subtotal da distribuidora.',
  'Reajuste acumulado explícito sobre o preço-base é aplicado uma vez. Preço final já reajustado não recebe novo índice. Regras textuais não são interpretadas automaticamente.',
  'A consulta produz resultado preliminar. A apuração geral depende dos demais custos, tributos e honorários, da validação do gestor e da publicação versionada.'
 ]};
 const need=(code:string,message:string,tab:string)=>r.requirements.push({code,message,tab});
 const matches=contracts.filter(c=>c.organization_id===unit.organization_id&&c.customer_id===unit.customer_id&&c.consumer_unit_id===unit.id&&c.contract_type==='ENERGY_PURCHASE'&&['ACTIVE','APPROVED'].includes(c.status)&&day(c.start_date)<=period.end&&day(c.end_date)>=period.start);
 if(unit.free_market!==true){need('MARKET','Confirme o enquadramento da unidade no Mercado Livre.','distributor');return r;}
 if(matches.length!==1){need('CONTRACT','É necessário um único contrato ativo/aprovado do fornecedor para o mês.','supply');return r;}
 const c=matches[0];r.contract={id:c.id,number:c.contract_number,start:day(c.start_date),end:day(c.end_date)};
 if(day(c.start_date)>period.start||day(c.end_date)<period.end){need('PARTIAL_CONTRACT','Contrato com vigência parcial: a alocação por dias precisa ser definida.','supply');return r;}
 const applicable=rules.filter(a=>a.organization_id===unit.organization_id&&a.customer_id===unit.customer_id&&a.consumer_unit_id===unit.id&&a.contract_id===c.id&&day(a.start_date)<=period.end&&day(a.end_date)>=period.start).sort((a,b)=>b.version-a.version),a=applicable[0];
 if(!a){need('BILLING_RULE','Confirme as condições de faturamento: volume mensal, mínimo, máximo, preço e tributos.','supply');return r;}
 if(day(a.start_date)>period.start||day(a.end_date)<period.end||!Number.isInteger(a.version)||a.version<1||applicable.filter(v=>v.version===a.version).length!==1||!a.source?.trim()){need('PARTIAL_RULE','A condição mais recente não cobre todo o mês ou é inconsistente. Não há divisão automática por dias.','supply');return r;}
 r.rule={id:a.id,version:a.version,source:a.source,indexSource:a.index_source};r.taxTreatment=a.tax_treatment;
 let volume:bigint,price:bigint,min:bigint,max:bigint;
 try{
  if(a.volume_basis==='MONTHLY')volume=dec(c.contracted_volume_mwh,6)*1000000n;
  else if(a.volume_basis==='SEASONAL'){
   const schedules=Array.isArray(c.seasonal_volumes)?c.seasonal_volumes.filter((s:any)=>s.year===Number(month.slice(0,4))):[];
   if(!['MONTHLY','BOTH'].includes(c.seasonality_mode)||schedules.length!==1)throw Error('Cadastre a distribuição sazonal explícita do ano.');
   const s=schedules[0],ps=s.monthlyPercentages?.map((v:any)=>dec(v,4));if(!ps||ps.length!==12||ps.some((v:bigint)=>v>1000000n)||ps.reduce((v:bigint,n:bigint)=>v+n,0n)!==1000000n)throw Error('Os percentuais sazonais devem somar exatamente 100%.');
   volume=dec(s.annualVolumeMwh,6)*ps[Number(month.slice(5))-1];
  }else throw Error('Confirme se o volume contratado é mensal ou sazonal.');
  const limits=supplierVolumeLimits(volume,a.min_percent,a.max_tolerance_percent);min=limits.min;max=limits.max;
  const history=prices.filter(p=>p.contract_id===c.id&&day(p.start_date)<=period.end&&day(p.end_date)>=period.start);
  const table=Array.isArray(c.annual_prices)?c.annual_prices.filter((p:any)=>day(p.startDate)<=period.end&&day(p.endDate)>=period.start):[];
  if(history.length&&table.length)throw Error('Concilie a tabela de preços e o histórico: há duas fontes na competência.');
  const options=history.length?history.map(p=>({start:day(p.start_date),end:day(p.end_date),value:p.price_per_mwh,status:'FINAL',source:'Histórico '+p.id})):table.map((p:any)=>({start:day(p.startDate),end:day(p.endDate),value:p.pricePerMwh,status:p.priceStatus,source:'Tabela contratual por vigência'}));
  if(!options.length&&!(c.annual_prices?.length)&&!prices.some(p=>p.contract_id===c.id))options.push({start:day(c.start_date),end:day(c.end_date),value:c.current_price,status:c.pricing_mode==='FIXED'?'FINAL':'BASE',source:'Preço-base cadastrado no contrato'});
  if(options.length!==1||options[0].start>period.start||options[0].end<period.end)throw Error('Informe um único preço cobrindo a competência inteira.');
  const p=options[0],base=dec(p.value,6);
  if(a.price_mode==='FINAL'){if(p.status!=='FINAL'||a.index_percent!=null)throw Error('Confirme o preço final vigente ou registre o índice do preço-base.');price=base*1000000n;}
  else if(a.price_mode==='BASE_PLUS_INDEX'){if(p.status!=='BASE'||!a.index_source?.trim())throw Error('O reajuste exige preço-base e fonte. Preço final não recebe índice novamente.');const index=signed(a.index_percent);if(index<=-100000000n||index>9999000000n)throw Error('Índice acumulado inválido.');price=round(base*(100000000n+index),100n);}
  else throw Error('Confirme a forma de aplicação do preço.');
  if(!['NET','GROSS'].includes(a.tax_treatment))throw Error('Informe o tratamento tributário do preço contratual.');
  r.contractedMwh=fixed(volume);r.minMwh=fixed(min);r.maxMwh=fixed(max);r.pricePerMwh=fixed(price);r.priceSource=p.source;
 }catch(e){need('CONDITIONS',e instanceof Error?e.message:'Revise as condições contratuais.','supply');return r;}
 const measured=prepareMeasurements(unit,month,inputs);r.measurements=measured.validatedVersion;
 if(measured.status!=='VALIDATED'||measured.findings.some(f=>f.severity==='BLOCKER')){for(const f of measured.findings.filter(f=>f.severity==='BLOCKER'))need(f.code,f.message,'monthly');if(!r.requirements.length)need('MONTHLY_VOLUME','Registre e valide o volume do mês em Dados mensais.','monthly');return r;}
 if(supplierToday(now)<=period.end)need('CYCLE_OPEN','O ciclo ainda não terminou. A conferência é preliminar; aguarde o encerramento do mês.','monthly');
 try{
  const m=measured.validatedVersion!.measurements,consumed=dec(m.consumptionTotal,6)*1000n,peak=dec(m.consumptionPeak,6)*1000n,off=dec(m.consumptionOffPeak,6)*1000n;
  if(peak+off!==consumed)throw Error('Ponta e fora ponta devem totalizar o consumo medido.');
  const covered=consumed>max?max:consumed,billed=covered<min?min:covered,gap=billed-covered,extra=consumed-covered;
  const regular=amount(billed,price),minimumAmount=amount(gap,price),energy=regular-minimumAmount,peakCents=consumed?round(energy*peak,consumed):0n,peakVolume=consumed?round(covered*peak,consumed):0n;
  r.consumedMwh=fixed(consumed);r.billedMwh=fixed(billed);r.minimumUnusedMwh=fixed(gap);r.extraMwh=fixed(extra);r.regularAmount=fixed(regular,2);r.minimumAmount=fixed(minimumAmount,2);
  r.bands=[{timeBand:'PEAK',volumeMwh:fixed(peakVolume),amount:fixed(peakCents,2)},{timeBand:'OFF_PEAK',volumeMwh:fixed(covered-peakVolume),amount:fixed(energy-peakCents,2)}];
  const ledger=monthlyCostLedger(unit,month,costRows,'SUPPLIER');r.costVersion=ledger.version;
  if(ledger.status==='BLOCKED'&&costRows.some(v=>v.organization_id===unit.organization_id&&v.consumer_unit_id===unit.id&&v.customer_id===unit.customer_id&&v.month===month))need('COST_REVIEW','Revise e valide os custos desta competência antes de concluir a conferência.','costs');
  const groups=ledger.status==='AVAILABLE'?ledger.groups.filter(g=>g.scenario==='ACL'):[],expectedTreatment=a.tax_treatment==='GROSS'?'INCLUDED':'EXCLUDED';
  const extraLines=groups.flatMap(g=>g.lines.filter(l=>l.category==='SUPPLIER_EXTRA_ENERGY').map(l=>({...l,taxTreatment:g.taxTreatment})));
  let extraCents:bigint|null=extra===0n?0n:null;
  if(extra>0n){if(!extraLines.some(l=>l.effect==='COST'))need('EXTRA_PURCHASE','Compra extra necessária: '+fixed(extra)+' MWh. Registre o valor e a fonte em Custos mensais, categoria Compra extra de energia, e valide a versão.','costs');
   else if(extraLines.some(l=>l.taxTreatment!==expectedTreatment))need('EXTRA_TAX','Compra extra e preço contratual têm tratamentos tributários diferentes. Concilie antes de totalizar.','costs');
   else {extraCents=extraLines.reduce((v,l)=>v+(l.effect==='CREDIT'?-dec(l.amount,2):dec(l.amount,2)),0n);if(extraCents<0n){extraCents=null;need('EXTRA_CREDIT','Créditos da compra extra excedem os custos. Confira os lançamentos.','costs');}}
  }else if(extraLines.length)need('UNEXPECTED_EXTRA','Há compra extra registrada sem excedente contratual calculado. Concilie o lançamento para evitar duplicidade.','costs');
  if(costRows.some(v=>v.organization_id===unit.organization_id&&v.consumer_unit_id===unit.id&&v.customer_id===unit.customer_id&&v.month===month&&v.status==='DRAFT'))need('COST_DRAFT','Existe versão de custos em rascunho; valide a correção antes do fechamento.','costs');
  const invoice=groups.flatMap(g=>g.lines.filter(l=>l.category==='SUPPLIER_INVOICE').map(l=>({...l,taxTreatment:g.taxTreatment})));
  if(invoice.length){if(invoice.some(l=>l.taxTreatment!==expectedTreatment))need('INVOICE_TAX','NF e preço contratual têm tratamentos diferentes. A NF é conferência, não um segundo custo.','costs');else {const nf=invoice.reduce((v,l)=>v+(l.effect==='CREDIT'?-dec(l.amount,2):dec(l.amount,2)),0n);r.invoiceAmount=fixed(nf,2);r.invoiceDifference=fixed(nf-regular,2);if(nf!==regular)need('INVOICE_DIFFERENCE','A NF regular diverge do valor contratual calculado. Confira volume, preço, tributos e créditos antes do fechamento.','costs');}}
  r.extraAmount=extraCents===null?null:fixed(extraCents,2);r.totalAmount=extraCents===null?null:fixed(regular+extraCents,2);r.status=r.requirements.length?'PENDING':'READY';
 }catch(e){need('VOLUME',e instanceof Error?e.message:'Revise os volumes mensais.','monthly');}
 return r;
}
