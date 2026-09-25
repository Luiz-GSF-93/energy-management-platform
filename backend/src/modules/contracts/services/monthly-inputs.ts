import {MonthlyMeasurementsDto} from '../dto/monthly-inputs.dto';
export const measurementKeys=["consumptionTotal","consumptionPeak","consumptionOffPeak","demandSingle","demandPeak","demandOffPeak","reactiveTotal"] as const;
export function normalizeMeasurements(m:MonthlyMeasurementsDto){return Object.fromEntries(measurementKeys.map(k=>[k,m[k]??null])) as Record<typeof measurementKeys[number],string|null>;}
function scaled(s:string){const [whole,frac='']=s.split('.');return BigInt(whole)*BigInt(1000000)+BigInt(frac.padEnd(6,'0'));}
export function measurementIssues(m:MonthlyMeasurementsDto,validating=false){
 const issues:string[]=[];const total=m.consumptionTotal,peak=m.consumptionPeak,off=m.consumptionOffPeak;
 if(total!=null&&peak!=null&&off!=null&&scaled(total)!==scaled(peak)+scaled(off))issues.push('O consumo total deve ser igual à soma de ponta e fora ponta.');
 if(validating&&total==null&&(peak==null||off==null))issues.push('Informe consumo total ou os consumos de ponta e fora ponta para validar.');
 if(validating&&((peak==null)!==(off==null)))issues.push('Complete os dois postos de consumo ou deixe ambos não informados.');
 if(m.demandSingle!=null&&(m.demandPeak!=null||m.demandOffPeak!=null))issues.push('Informe demanda única ou demanda por posto, evitando duas interpretações da medição.');
 return issues;
}
