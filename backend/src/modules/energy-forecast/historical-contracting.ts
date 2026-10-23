import {assertEvidence,decimal,quantity,Observation,Scope} from './consumption-forecast';
import {monthDates} from './contract-exposure';
const scale=1000000n;
const divide=(a:bigint,b:bigint)=>a<0n?-((-a+b/2n)/b):(a+b/2n)/b;
const gcd=(a:bigint,b:bigint):bigint=>b===0n?a:gcd(b,a%b);
/** Advisory only: observed range is never represented as an active contract. */
export function historicalContractingScenario(scope:Scope,observations:Observation[],future:{month:string;predictedKwh:string}[],cutoff:string,at:string){
 const pending=(notice:string)=>({state:'SOURCE_PENDING' as const,formulaVersion:'HISTORICAL_CONTRACTING_1',notice,rows:[]});
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(cutoff)||!Number.isFinite(Date.parse(at))||future.length>12||new Set(future.map(f=>f.month)).size!==future.length)throw Error('Cenário de contratação inválido.');
 const eligible=observations.filter(o=>o.month<=cutoff).sort((a,b)=>a.month.localeCompare(b.month));
 if(new Set(eligible.map(o=>o.month)).size!==eligible.length)throw Error('Histórico duplicado.');
 for(const o of eligible){assertEvidence(scope,o.evidence);monthDates(o.month);quantity(o.consumptionKwh);}
 const rows=eligible.filter(o=>Number.isInteger(o.billedDays)&&o.billedDays>0&&o.billedDays<=62).slice(-12);
 if(!rows.length)return pending('Sem registros reais com dias documentados para calcular a faixa histórica.');
 let numerator=0n,denominator=1n,weights=0n,min=rows[0],max=rows[0];
 rows.forEach((o,i)=>{const q=quantity(o.consumptionKwh),days=BigInt(o.billedDays),w=BigInt(i+1),common=denominator/gcd(denominator,days)*days;numerator=numerator*(common/denominator)+q*w*(common/days);denominator=common;weights+=w;if(q*BigInt(min.billedDays)<quantity(min.consumptionKwh)*days)min=o;if(q*BigInt(max.billedDays)>quantity(max.consumptionKwh)*days)max=o;});
 if(numerator<=0n)return pending('Histórico sem consumo positivo suficiente para uma referência de contratação.');
 const result=future.map(f=>{
  if(f.month<=cutoff)throw Error('Horizonte deve ser posterior ao histórico.');const {hours}=monthDates(f.month),days=hours/24n,predicted=quantity(f.predictedKwh);
  const low=quantity(min.consumptionKwh)*days,high=quantity(max.consumptionKwh)*days,highDays=BigInt(max.billedDays),delta=high-predicted*highDays,excess=delta<0n?-delta:0n;
  return {month:f.month,predictedMwh:decimal(divide(predicted,1000n)),baseMwh:decimal(divide(numerator*days,denominator*weights*1000n)),minimumMwh:decimal(divide(low,BigInt(min.billedDays)*1000n)),maximumMwh:decimal(divide(high,highDays*1000n)),marginMwh:decimal(divide(delta,highDays*1000n)),excessMwh:decimal(divide(excess,highDays*1000n)),excessPercent:high>0n?decimal(divide(excess*100n*scale,high)):null,minimumPercent:decimal(divide(quantity(min.consumptionKwh)*denominator*weights*100n*scale,BigInt(min.billedDays)*numerator)),maximumPercent:decimal(divide(quantity(max.consumptionKwh)*denominator*weights*100n*scale,highDays*numerator)),status:delta<0n?'ABOVE_HISTORICAL_RANGE':predicted*BigInt(min.billedDays)<low?'BELOW_HISTORICAL_RANGE':'WITHIN_HISTORICAL_RANGE'};
 });
 return {state:'AVAILABLE' as const,formulaVersion:'HISTORICAL_CONTRACTING_1',calculatedAt:at,historyFrom:rows[0].month,historyTo:rows[rows.length-1].month,historyMonths:rows.length,sourceMonths:rows.map(o=>o.month),notice:'Cenário estimado para assessoria de contratação. Base ponderada por recência; mínimo e máximo observados por dia faturado, ajustados aos dias futuros. Não são limites contratados, volume comprado ou faixa de confiança.',qualifications:[...(rows.length<12?['Amostra reduzida: '+rows.length+' meses elegíveis.']:[]),...(eligible.some(o=>!Number.isInteger(o.billedDays)||o.billedDays<=0||o.billedDays>62)?['Registros sem dias documentados foram excluídos.']:[]),'Eventos excepcionais podem ampliar a faixa histórica; conferir antes de negociar.'],rows:result};
}
