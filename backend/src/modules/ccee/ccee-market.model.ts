import {BadRequestException} from '@nestjs/common';
import {createHash} from 'node:crypto';
export const MARKET_VERSION='CCEE_MARKET_1';
export const markets=['SE_CO','S','NE','N'] as const;
export type Market=typeof markets[number];
export const marketView='966188be-1b54-4594-bcd1-596ba5ac8fde';
export function marketDay(v:unknown){if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v||v<'2021-01-01')throw new BadRequestException('Data inválida; use uma data a partir de 2021.');return v;}
export function marketQuery(q:Record<string,unknown>){
 if(Object.keys(q).some(k=>!['from','to','submarkets','granularity','origin','page'].includes(k)))throw new BadRequestException('Filtro de preço desconhecido.');
 const from=marketDay(q.from),to=marketDay(q.to),granularity=q.granularity??'MONTH',origin=q.origin??'ALL',page=Number(q.page??0);
 const selected=typeof q.submarkets==='string'&&q.submarkets?q.submarkets.split(','):Array.from(markets);
 if(from>to||Date.parse(to)-Date.parse(from)>731*86400000||!['MONTH','DAY','HOUR'].includes(String(granularity))||granularity==='HOUR'&&Date.parse(to)-Date.parse(from)>31*86400000||!['ALL','SOAP','OFFICIAL_MONTHLY'].includes(String(origin))||!selected.length||selected.length>4||new Set(selected).size!==selected.length||selected.some(v=>!markets.includes(v as Market))||!Number.isInteger(page)||page<0||page>10000)throw new BadRequestException('Confira período, submercados e paginação. Consulta horária limitada a 32 dias.');
 return {from,to,granularity:String(granularity),origin:String(origin),submarkets:selected,page};
}
export type DailyPrice={day:string;value:string;hours:number};
/** Descriptive statistics, never an instruction to buy or a financial settlement. */
export function marketTrend(input:DailyPrice[]){
 const rows=[...input].sort((a,b)=>a.day.localeCompare(b.day));const seen=new Set<string>();
 for(const r of rows){marketDay(r.day);if(seen.has(r.day)||!/^\d{1,8}(\.\d{1,6})?$/.test(r.value)||!Number.isInteger(r.hours)||r.hours<1||r.hours>25)throw new Error('INVALID_MARKET_HISTORY');seen.add(r.day);}
 const complete=rows.filter(r=>r.hours===24),latest=rows.at(-1)?.day;
 const pending={state:'INSUFFICIENT_HISTORY',formulaVersion:MARKET_VERSION,observations:complete.length,asOf:latest??null,shortAverage:null,longAverage:null,changePercent:null,volatility:null,direction:'UNAVAILABLE',seasonality:'INSUFFICIENT_HISTORY',forecast:[] as {day:string;value:string}[],forecastState:'NOT_VALIDATED',backtest:{comparisons:0,modelMae:null as string|null,persistenceMae:null as string|null},notice:'São necessários 30 dias consecutivos com cobertura horária completa para avaliar a tendência. Ausência não é zero.'};
 if(!latest)return pending;
 const end=Date.parse(latest+'T00:00:00Z');const window=complete.filter(r=>end-Date.parse(r.day+'T00:00:00Z')<30*86400000);
 if(window.length!==30||window.some((r,i)=>Date.parse(r.day+'T00:00:00Z')!==end-(29-i)*86400000))return pending;
 const values=window.map(r=>Number(r.value)),mean=(a:number[])=>a.reduce((n,v)=>n+v,0)/a.length,short=mean(values.slice(-7)),long=mean(values),variation=long>0?(short-long)/long*100:null;
 const volatility=Math.sqrt(mean(values.map(v=>(v-long)**2)));
 // Year-on-year seasonality needs two genuinely covered years; no extrapolated records.
 const recent=complete.filter(r=>end-Date.parse(r.day+'T00:00:00Z')<731*86400000),months=new Map<string,number>();for(const r of recent)months.set(r.day.slice(0,7),(months.get(r.day.slice(0,7))??0)+1);
 const fullMonths=[...months].filter(([m,count])=>count===new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5)),0)).getUTCDate());
 // Rolling-origin backtest: every seven-day scenario uses only the preceding
 // seven daily prices. Compare the same horizons against last-price persistence.
 const local=(a:number[])=>{const base=mean(a),slope=a.reduce((n,v,i)=>n+(i-3)*(v-base),0)/28;return Array.from({length:7},(_,i)=>Math.max(0,base+slope*(4+i)));};
 let modelError=0,baselineError=0,comparisons=0;
 const past=complete.filter(r=>end-Date.parse(r.day+'T00:00:00Z')<56*86400000),contiguous=past.length>=28&&past.every((r,i)=>!i||Date.parse(r.day)-Date.parse(past[i-1].day)===86400000);
 if(contiguous){const v=past.map(r=>Number(r.value));for(let i=7;i<=v.length-7;i++){const predicted=local(v.slice(i-7,i));for(let j=0;j<7;j++){modelError+=Math.abs(predicted[j]-v[i+j]);baselineError+=Math.abs(v[i-1]-v[i+j]);comparisons++;}}}
 const improved=comparisons>0&&modelError<baselineError;
 const forecast=improved?local(values.slice(-7)).map((v,i)=>({day:new Date(end+(i+1)*86400000).toISOString().slice(0,10),value:v.toFixed(6)})):[];
 return {...pending,state:'AVAILABLE',shortAverage:short.toFixed(6),longAverage:long.toFixed(6),changePercent:variation===null?null:variation.toFixed(2),volatility:volatility.toFixed(6),direction:variation===null?'UNAVAILABLE':variation>=5?'RISING':variation<=-5?'FALLING':'STABLE',seasonality:fullMonths.length>=24?'HISTORY_ELIGIBLE':'INSUFFICIENT_HISTORY',weeklySeasonality:past.length>=56&&contiguous?'HISTORY_ELIGIBLE':'INSUFFICIENT_HISTORY',forecast,forecastState:improved?'BACKTEST_IMPROVED':comparisons?'PERSISTENCE_NOT_IMPROVED':'INSUFFICIENT_HISTORY',backtest:{comparisons,modelMae:comparisons?(modelError/comparisons).toFixed(6):null,persistenceMae:comparisons?(baselineError/comparisons).toFixed(6):null},notice:'Tendência observada: média de 7 frente a 30 dias; alerta a partir de 5%. Cenário local de até 7 dias somente se seu erro retrospectivo for menor que repetir o último preço. Não é garantia de preço futuro nem ordem de compra; sem faixa regulatória comprovada, não presume piso ou teto.'};
}
export function marketDigest(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export const serviceCatalogue=[
 {key:'PLD_HOURLY',group:'Preços',name:'PLD horário e histórico',operation:'listarPLD',mode:'READ',implemented:true},
 {key:'POINTS',group:'Ativos e cadastros',name:'Perfis e pontos de medição',operation:'listarPontoMedicao',mode:'READ',implemented:true},
 {key:'MEASUREMENTS',group:'Medição',name:'Medidas finais, consolidadas e faltantes',operation:'listarMedida',mode:'READ',implemented:true},
 {key:'MEASUREMENTS_5M',group:'Medição',name:'Medidas consistidas de cinco minutos',operation:'listarMedidaCincoMinutos',mode:'READ',implemented:true},
 {key:'DRI_EVENTS',group:'DRI',name:'Eventos contábeis',operation:'listarDivulgacaoEventoContabil',mode:'READ',implemented:true},
 {key:'DRI_REPORTS',group:'DRI',name:'Catálogo de relatórios e quadros',operation:'listarRelatorio',mode:'READ',implemented:true},
 {key:'DRI_RESULTS',group:'DRI',name:'Resultados contábeis por agente',operation:'listarResultadoRelatorio',mode:'READ',implemented:true},
 {key:'CONTRACT_READ',group:'Contratos',name:'Contratos ACL e montantes · homologação por vínculo',operation:'listarContrato / listarMontanteEnergia',mode:'READ',implemented:true},
 {key:'CONTRACT_WRITE',group:'Contratos',name:'Registro e alterações ACL/CCEAR',operation:null,mode:'EXPLICIT_OPERATOR_ACTION',implemented:false},
 {key:'MEASUREMENT_WRITE',group:'Medição',name:'Envio de coletas',operation:'informarColetaMedicao',mode:'EXPLICIT_OPERATOR_ACTION',implemented:false},
 {key:'WEBHOOK',group:'Notificações',name:'Eventos da plataforma',operation:null,mode:'CONFIGURATION_REQUIRED',implemented:false},
] as const;
