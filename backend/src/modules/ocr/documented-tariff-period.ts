import {validateProfile} from '../contracts/services/tariff-library-plan';
import {tariffProduct} from '../contracts/services/tariff-preview';

export const documentedSettlementEnabled=()=>process.env.EVA_DOCUMENTED_SETTLEMENTS_ENABLED==='true';
const dayMs=86400000;
const normalize=(x:unknown)=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^COMERCIAL$/,'COMMERCIAL');
const date=(s:unknown)=>{if(typeof s!=='string')throw Error('Data de leitura sem fonte.');const v=/^\d{2}\/\d{2}\/\d{4}$/.test(s)?s.slice(6)+'-'+s.slice(3,5)+'-'+s.slice(0,2):s;if(!/^(20|21)\d{2}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('Data de leitura inválida.');return v;};
const micro=(s:unknown)=>{if(typeof s!=='string'||!/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(s))throw Error('Tarifa/quantidade inválida.');const [a,b='']=s.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));};
const fixed=(n:bigint,p:number)=>{const s=n.toString().padStart(p+1,'0');return s.slice(0,-p)+'.'+s.slice(-p);};
export type TariffPeriod={start:string;end:string;days:number;readingSources:string[];segments:{start:string;end:string;days:number;record:any}[]};
/** Previous reading is excluded, current reading included: D is elapsed days.
 * Only the tariff is weighted (REN1000 art173§2), never invented daily kWh. */
export function documentedTariffPeriod(rows:any[],unit:any,month:string,layout:any):TariffPeriod|null{
 const fields=layout.fields??[],find=(key:string)=>fields.filter((f:any)=>f.name===key);
 const starts=find('previousReading'),ends=find('currentReading');
 if(!starts.length&&!ends.length)return null;
 if(starts.length!==1||ends.length!==1||[...starts,...ends].some(f=>!f.source||!f.value?.text?.trim()||f.value.issues?.some((i:string)=>i!=='MISSING_CONFIDENCE')))throw Error('Datas do ciclo ausentes, ambíguas ou sem fonte íntegra.');
 const previous=date(starts[0].value.text.trim()),end=date(ends[0].value.text.trim()),a=Date.parse(previous+'T00:00:00Z'),b=Date.parse(end+'T00:00:00Z'),days=(b-a)/dayMs;
 if(!Number.isInteger(days)||days<1||days>62||end.slice(0,7)!==month)throw Error('Ciclo de leitura incompatível com a competência.');
 const printed=find('billingDays');if(printed.length>1||printed.length===1&&(!/^\d+$/.test(printed[0].value?.text?.trim()??'')||Number(printed[0].value.text.trim())!==days))throw Error('Dias impressos divergem das datas de leitura.');
 const scoped=rows.filter(r=>r.organization_id===unit.organization_id),heads=scoped.filter(r=>!scoped.some(n=>n.previous_id===r.id));
 const eligible=heads.filter(r=>{const p=r.profile;try{validateProfile(p);date(p.startDate);date(p.endDate);}catch{return false;}return p.taxTreatment==='NET'&&p.source?.trim()&&normalize(p.distributor).replace(/^NEOENERGIAELEKTRO$/,'ELEKTRO')===normalize(unit.distributor).replace(/^NEOENERGIAELEKTRO$/,'ELEKTRO')&&normalize(p.group)===normalize(unit.tariff_group)&&normalize(p.subgroup)===normalize(unit.tariff_subgroup)&&p.modality===unit.tariff_modality&&(p.consumptionClass==='GENERAL'||normalize(p.consumptionClass)===normalize(unit.consumption_class));});
 const segments:TariffPeriod['segments']=[];
 for(let at=a+dayMs;at<=b;at+=dayMs){const d=new Date(at).toISOString().slice(0,10),matches=eligible.filter(r=>r.profile.startDate<=d&&r.profile.endDate>=d);if(matches.length!==1)throw Error('Tarifa líquida única não demonstrada para '+d+'. Confira lacunas, sobreposições e origem fiscal.');const record=matches[0],last=segments[segments.length-1];if(last?.record.id===record.id&&last.record.version===record.version){last.end=d;last.days++;}else segments.push({start:d,end:d,days:1,record});}
 return {start:new Date(a+dayMs).toISOString().slice(0,10),end,days,readingSources:[starts[0].source,ends[0].source,...printed.map((f:any)=>f.source)],segments};
}
export function proportionalTariff(period:TariffPeriod,item:any,quantity:string){
 let weighted=0n;const proofs:any[]=[];
 for(const s of period.segments){const matches=s.record.profile.items.filter((i:any)=>i.component===item.component&&i.band===item.band);if(matches.length!==1||matches[0].measure!==item.measure)throw Error('Componente/posto/unidade mudou no ciclo tarifário.');const r=matches[0];weighted+=micro(r.value)*BigInt(s.days);proofs.push({id:s.record.id,version:s.record.version,source:s.record.profile.source,start:s.start,end:s.end,days:s.days,rate:r.value,measure:r.measure});}
 const denominator=1000000000000n*BigInt(period.days)*(item.measure==='BRL_MWH'?1000n:1n),n=micro(quantity)*weighted*100n;
 return {amount:fixed((n+denominator/2n)/denominator,2),displayRate:fixed((weighted+BigInt(period.days)/2n)/BigInt(period.days),6),proof:{method:'REN1000_ART173_2',weightedMicroRateDays:weighted.toString(),days:period.days,rounding:'HALF_UP_PER_LINE_AFTER_WEIGHTING',readingSources:period.readingSources,segments:proofs}};
}
/** Subsequent study edits retain the exact rational tariff unless explicitly repriced. */
export function documentedLineAmount(line:any,quantity:string,rateOverride?:string){
 if(rateOverride!==undefined||!line.proportional)return tariffProduct(quantity,rateOverride??line.value,line.measure==='BRL_MWH').rounded;
 const p=line.proportional;if(p.method!=='REN1000_ART173_2'||!Array.isArray(p.segments)||!p.segments.length||!Number.isInteger(p.days)||p.days<1||p.days>62)throw Error('Memória proporcional inválida.');
 let days=0,weighted=0n;for(const s of p.segments){if(!s.id||!s.source?.trim()||!Number.isInteger(s.version)||s.version<1||!Number.isInteger(s.days)||s.days<1||s.measure!==line.measure)throw Error('Fonte da tarifa proporcional inválida.');days+=s.days;weighted+=micro(s.rate)*BigInt(s.days);}
 if(days!==p.days||weighted.toString()!==p.weightedMicroRateDays)throw Error('A memória proporcional mudou.');
 const denominator=1000000000000n*BigInt(days)*(line.measure==='BRL_MWH'?1000n:1n);return fixed((micro(quantity)*weighted*100n+denominator/2n)/denominator,2);
}
