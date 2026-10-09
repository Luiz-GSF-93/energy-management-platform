import {createHash} from 'node:crypto';
export type WeatherPoint={latitude:number;longitude:number};
function weatherPeriod(from:string,to:string){
 const dates=[from,to].map(s=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('WEATHER_PERIOD_INVALID');
  const d=new Date(s+'T00:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw Error('WEATHER_PERIOD_INVALID');
  return d.getTime();
 });
 if(dates[1]<dates[0]||(dates[1]-dates[0])/86400000>=1132)throw Error('WEATHER_PERIOD_INVALID');
 return dates;
}
export function nasaWeatherUrl(point:WeatherPoint,from:string,to:string){
 if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||point.latitude< -34||point.latitude>6||point.longitude< -74||point.longitude> -28)throw Error('BRAZIL_LOCATION_INVALID');
 weatherPeriod(from,to);
 const q=new URLSearchParams({parameters:'T2M',community:'RE',latitude:String(point.latitude),longitude:String(point.longitude),start:from.replace(/-/g,''),end:to.replace(/-/g,''),format:'JSON','time-standard':'UTC'});
 return 'https://power.larc.nasa.gov/api/temporal/daily/point?'+q;
}
export function normalizeNasaTemperature(raw:string,from:string,to:string){
 const [start,end]=weatherPeriod(from,to);
 if(raw.length>2000000)throw Error('WEATHER_RESPONSE_TOO_LARGE');
 const body=JSON.parse(raw), values=body?.properties?.parameter?.T2M;
 if(!values||typeof values!=='object'||Array.isArray(values)||!['C','°C'].includes(body?.parameters?.T2M?.units)||body?.header?.time_standard!=='UTC')throw Error('WEATHER_SCHEMA_INVALID');
 const daily:{date:string;temperatureC:number|null}[]=[], months=new Map<string,{sum:number;days:number;expected:number}>();
 for(let date=new Date(start);date.getTime()<=end;date.setUTCDate(date.getUTCDate()+1)){
  const key=date.toISOString().slice(0,10), value=values[key.replace(/-/g,'')];
  const valid=typeof value==='number'&&Number.isFinite(value)&&value!==body?.header?.fill_value&&value>= -90&&value<=65;
  daily.push({date:key,temperatureC:valid?value:null});
  const month=key.slice(0,7), m=months.get(month)??{sum:0,days:0,expected:0};m.expected++;if(valid){m.sum+=value;m.days++;}months.set(month,m);
 }
 if(!daily.length||daily.length>1132)throw Error('WEATHER_PERIOD_INVALID');
 return {provider:'NASA_POWER' as const,parameter:'T2M',unit:'°C',timeStandard:'UTC',sourceHash:createHash('sha256').update(raw).digest('hex'),from,to,
  monthly:[...months].map(([month,m])=>({month,temperatureC:m.days===m.expected?Number((m.sum/m.days).toFixed(6)):null,validDays:m.days,expectedDays:m.expected})),
  qualification:'Temperatura regional de modelo/reanálise, não medição no imóvel. Ausências não são zero. Atualizações da fonte exigem novo snapshot.'};
}
export async function loadNasaTemperature(point:WeatherPoint,from:string,to:string){
 const url=nasaWeatherUrl(point,from,to), controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
 try{
  const r=await fetch(url,{signal:controller.signal,redirect:'error'});if(!r.ok||!r.body)throw Error('WEATHER_UNAVAILABLE');
  const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0;
  for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>2000000){await reader.cancel();throw Error('WEATHER_RESPONSE_TOO_LARGE');}parts.push(chunk.value);}
  return {...normalizeNasaTemperature(Buffer.concat(parts).toString('utf8'),from,to),point,retrievedAt:new Date().toISOString()};
 }finally{clearTimeout(timeout);}
}
