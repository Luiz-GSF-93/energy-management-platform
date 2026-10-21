import {AiEvidence} from '../ocr/azure-backoffice-ai.connector';
export const REPORT_BOT_FORMULA='published-report-analytics/1.0';
const numeric=(v:unknown):v is string=>typeof v==='string'&&/^\d{1,18}(\.\d{1,6})?$/.test(v);
const scaled=(v:string)=>{const [a,b='']=v.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));};
const decimal=(v:bigint)=>{const negative=v<0n;const a=negative?-v:v;return (negative?'-':'')+(a/1000000n)+'.'+(a%1000000n).toString().padStart(6,'0');};
export function reportEvidence(a:any,scope:{unitId:string;unitName:string;audience:string},forecast:any=null):AiEvidence[]{
 const out:AiEvidence[]=[];
 const add=(id:string,label:string,value:unknown,source=REPORT_BOT_FORMULA)=>out.push({id,label,value:typeof value==='string'?value:JSON.stringify(value),source});
 add('context','Unidade, público e período',{unit:scope.unitName,unitId:scope.unitId,audience:scope.audience,period:a.period,coverage:a.coverage});
 add('limits','Limites de interpretação','Somente resultados publicados. Fatura apurada não comprova pagamento. Ausência não é zero. Não calcular, simular expansão, converter kWh em demanda kW ou estimar tributos embutidos. Comparação ACR é cenário do motor, não uma fatura paga. Demanda mensal não identifica máxima diária.');
 if(scope.audience==='client'&&process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED==='true')add('client-next-steps','Próximos passos com o consultor','Reativo excedente: peça ao consultor e engenheiro responsável a avaliação do fator de potência por horário, perfil das cargas e funcionamento dos equipamentos de compensação. Ultrapassagem: peça análise de demanda contratada, demanda medida e simultaneidade das cargas. A solução depende de medição e avaliação técnica; não prescreva instalação, ajuste de banco de capacitores, valor contratual ou intervenção elétrica sem laudo. Compare meses publicados e explique diferenças observadas sem atribuir uma causa não demonstrada.');
 if(scope.audience==='client')add('client-consultant','Orientação ao cliente','Explique os resultados comprovados. Sem evidência suficiente, indique contato com o consultor da organização. Custos de reativo excedente ou ultrapassagem não comprovam causa técnica, falha de equipamento ou economia recuperável. Próximos passos são avaliações com o consultor e equipe técnica, não diagnóstico ou instrução de intervenção elétrica.');
 for(const r of a.clientInsights??[])if(r.unitId===scope.unitId&&r.month>=a.period.from&&r.month<=a.period.to)add('client-costs-'+r.month,'Composição da fatura e custos de reativo/ultrapassagem publicados · '+r.month,{month:r.month,composition:r.composition,compositionNotice:r.compositionNotice,indicators:r.indicators,indicatorNotice:r.indicatorNotice,...(process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED==='true'?{unitContext:r.unitContext,taxes:r.taxes,taxNotice:r.taxNotice,ccee:r.ccee,prices:r.prices}:{})},'Publicação '+r.publicationId+' · hash '+r.sourceHash);
 if(scope.audience==='client')for(const p of a.clientPaymentDeclarations??[])if(p.unitId===scope.unitId&&p.month>=a.period.from&&p.month<=a.period.to&&p.basis==='CLIENT_DECLARATION_NOT_BANK_CONFIRMATION')add('client-payment-'+p.id,'Pagamento informado pelo cliente · '+p.month,{state:p.state,revision:p.revision,actorId:p.actorId,declaredAt:p.declaredAt,notice:'Declaração do cliente; nunca afirmar quitação bancária, comprovante ou baixa financeira.'},'Histórico auditado da declaração do cliente');
 if(a.totals)add('totals','Totais publicados do período · valores monetários em BRL',a.totals,'Motor financeiro publicado; percentual ponderado pelo custo ACR');
 for(const m of a.months??[])if(m.totals)add('month-'+m.month,'Resultados publicados · '+m.month,{month:m.month,amounts:m.totals,cumulativeSavings:m.cumulative});
 const invoices=(a.invoices??[]).filter((i:any)=>i.unitId===scope.unitId);
 const series=new Map<string,{month:string;value:string;source:string}[]>();
 const labels:Record<string,string>={consumptionTotal:'Consumo total kWh',consumptionPeak:'Consumo ponta kWh',consumptionOffPeak:'Consumo fora ponta kWh',demandSingle:'Demanda medida única kW',demandPeak:'Demanda medida ponta kW',demandOffPeak:'Demanda medida fora ponta kW',reactiveBilledPeakKwh:'Energia reativa faturada ponta kWh',reactiveBilledOffPeakKwh:'Energia reativa faturada fora ponta kWh'};
 const seen=new Set<string>();
 for(const i of invoices){
  if(seen.has(i.month))throw new Error('AMBIGUOUS_UNIT_MONTH');seen.add(i.month);
  const source='Publicação '+i.groupId+' · versão '+i.version+' · hash '+i.payloadHash;
  const measurement=i.measurements?.measurements??{};
  for(const [key,label] of Object.entries(labels))if(numeric(measurement[key])){
   const items=series.get(key)??[];items.push({month:i.month,value:measurement[key],source});series.set(key,items);
   add('measurement-'+i.month+'-'+key,label+' · '+i.month,measurement[key],source);
  }
  const s=i.scenarios?.find((s:any)=>s.scenario==='ACL');
  if(s)add('composition-'+i.month,'Composição de custo ACL apurado · '+i.month,{distributor:s.distributor,supplier:s.supplier,additional:s.additional,additionalTaxes:s.taxes,subtotal:s.subtotal},source+' · tributos adicionais não representam todos os tributos embutidos na fatura');
  const row=(a.unitRows??[]).find((u:any)=>u.unitId===scope.unitId&&u.month===i.month);
  if(row&&numeric(measurement.consumptionTotal)&&scaled(measurement.consumptionTotal)>0n){
   const cost=scaled(row.amounts.aclAfterFees),consumption=scaled(measurement.consumptionTotal);
   add('specific-'+i.month,'Custo específico ACL com honorários R$/kWh · '+i.month,decimal((cost*1000000n+consumption/2n)/consumption),source+' · ACL com honorários / consumo total publicado');
  }
  if(i.reservations?.length||i.warnings?.length||i.findings?.length)add('reservation-'+i.month,'Ressalvas da publicação · '+i.month,'Publicação com ressalvas; solicite conferência à equipe de gestão.',source);
 }
 for(const [key,items] of series){
  const max=items.reduce((a,b)=>scaled(a.value)>=scaled(b.value)?a:b);
  const sum=items.reduce((n,x)=>n+scaled(x.value),0n);
  add('aggregate-'+key,labels[key]+' · resumo observado',{sum:key.startsWith('demand')?null:decimal(sum),average:decimal((sum+BigInt(items.length)/2n)/BigInt(items.length)),maximum:max.value,maximumMonth:max.month,observedMonths:items.length,requestedMonths:a.coverage?.requestedMonths,sourceMonths:items.map(x=>x.month)},REPORT_BOT_FORMULA+' · média somente dos meses com medição; demandas não somadas; máximo mensal');
 }
 const consumption=series.get('consumptionTotal');
 if(scope.audience==='client'&&process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED==='true'){
  const signed=(v:unknown):v is string=>typeof v==='string'&&/^-?\d{1,18}(\.\d{1,6})?$/.test(v);
  const value=(v:string)=>v.startsWith('-')?-scaled(v.slice(1)):scaled(v);
  const difference=(previous:string,current:string)=>{const before=value(previous),after=value(current),delta=after-before;return {previous,current,delta:decimal(delta),percent:before>0n?decimal(delta*100000000n/before):null};};
  const rows=(a.unitRows??[]).filter((u:any)=>u.unitId===scope.unitId).sort((a:any,b:any)=>a.month.localeCompare(b.month));
  for(let i=1;i<rows.length;i++){
   const previous=rows[i-1],current=rows[i],metrics:Record<string,unknown>={};
   for(const key of ['acr','aclAfterFees','savingsAfterFees'])if(signed(previous.amounts?.[key])&&signed(current.amounts?.[key]))metrics[key]=difference(previous.amounts[key],current.amounts[key]);
   const before=consumption?.find(m=>m.month===previous.month),after=consumption?.find(m=>m.month===current.month);
   if(before&&after)metrics.consumptionKwh=difference(before.value,after.value);
   if(Object.keys(metrics).length)add('published-difference-'+current.month,'Diferenças observadas de economia, custo e consumo · '+previous.month+' a '+current.month,{from:previous.month,to:current.month,metrics,notice:'Diferença entre publicações disponíveis; não preenche meses ausentes nem atribui causa. Percentual=(atual−anterior)/anterior×100; base anterior não positiva fica sem percentual.'},REPORT_BOT_FORMULA+' · somente unidade selecionada e fontes publicadas');
  }
 }
 if(consumption&&consumption.length===invoices.length&&a.totals){const sum=consumption.reduce((n,x)=>n+scaled(x.value),0n);if(sum>0n)add('specific-period','Custo específico ACL ponderado do período R$/kWh',decimal((scaled(a.totals.aclAfterFees)*1000000n+sum/2n)/sum),REPORT_BOT_FORMULA+' · custo total publicado / consumo publicado; inclui honorários');}
 if(forecast)add('published-forecast','Previsão publicada; estimativa, não medição',forecast,'Motor de previsão · versão publicada; não substituir por rascunho validado');
 return out;
}
