import {calculateConsumptionForecast, decimal, monthIndex, quantity, type ForecastInput} from './consumption-forecast';
import {monthlyAverage} from './monthly-average';
import type {ClimateHistory} from './climate-forecast';

type Forecast = ReturnType<typeof calculateConsumptionForecast>;
type Scenario = 'PREVIOUS_YEAR' | 'HISTORICAL_MONTH_MEAN';
type Model = {coefficients:number[];center:number;scale:number};
export type ReadingPeriod = {month:string;previousReading:string;currentReading:string;evidenceId:string;page:number};
export type ClimateCycleOptions = {sensitivity?:'LOW'|'UNKNOWN';readingPeriods?:ReadingPeriod[]};
const days = (month:string) => new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
const scaled = (v:number) => {
 const n=Math.round(v*1e6);
 if(!Number.isFinite(v)||v<0||!Number.isSafeInteger(n))throw Error('CLIMATE_VALUE_INVALID');
 return decimal(BigInt(n));
};
const dot = (a:number[],b:number[]) => a.reduce((s,v,i)=>s+v*b[i],0);
const features = (i:number,m:string,t:number,model:Pick<Model,'center'|'scale'>) => {
 const phase=(Number(m.slice(5))-1)*Math.PI/6;
 return [1,i/12,Math.sin(phase),Math.cos(phase),(t-model.center)/model.scale];
};
function fit(months:string[],values:number[],temperatures:number[]):Model|null {
 const center=temperatures.reduce((s,t)=>s+t,0)/temperatures.length;
 const scale=Math.sqrt(temperatures.reduce((s,t)=>s+(t-center)**2,0)/temperatures.length);
 if(scale<0.1)return null;
 const matrix=months.map((m,i)=>features(i,m,temperatures[i],{center,scale}));
 const q:number[][]=[],r=Array.from({length:5},()=>Array(5).fill(0) as number[]);
 for(let j=0;j<5;j++){
  const c=matrix.map(row=>row[j]),original=Math.sqrt(dot(c,c));
  for(let pass=0;pass<2;pass++)for(let k=0;k<j;k++){
   const projection=dot(q[k],c);r[k][j]+=projection;c.forEach((v,i)=>{c[i]=v-projection*q[k][i];});
  }
  const norm=Math.sqrt(dot(c,c));if(!Number.isFinite(norm)||norm<Math.max(1,original)*1e-7)return null;
  r[j][j]=norm;q.push(c.map(v=>v/norm));
 }
 const coefficients=Array(5).fill(0) as number[],rhs=q.map(c=>dot(c,values));
 for(let j=4;j>=0;j--)coefficients[j]=(rhs[j]-r[j].slice(j+1).reduce((s,v,k)=>s+v*coefficients[j+k+1],0))/r[j][j];
 return coefficients.every(Number.isFinite)?{coefficients,center,scale}:null;
}
function temperatureScenario(months:string[],temperatures:number[],target:string,scenario:Scenario){
 const selected=months.flatMap((m,i)=>m.slice(5)===target.slice(5)?[i]:[]);
 if(!selected.length)throw Error('CLIMATE_SCENARIO_UNAVAILABLE');
 const indexes=scenario==='PREVIOUS_YEAR'?[selected[selected.length-1]]:selected;
 return {temperatureC:indexes.reduce((s,i)=>s+temperatures[i],0)/indexes.length,sourceMonths:indexes.map(i=>months[i])};
}
function prediction(model:Model,index:number,month:string,t:number){return dot(model.coefficients,features(index,month,t,model));}
// Scenario selection is nested inside the training data. Outer test temperatures are never predictors.
function chooseScenario(months:string[],values:number[],temperatures:number[],billedDays:number[]):Scenario{
 let selected:Scenario='HISTORICAL_MONTH_MEAN',best=Infinity;
 for(const scenario of ['HISTORICAL_MONTH_MEAN','PREVIOUS_YEAR'] as Scenario[]){
  let error=0,count=0,valid=true;
  for(let origin=months.length-6;origin<months.length;origin++){
   const m=fit(months.slice(0,origin),values.slice(0,origin),temperatures.slice(0,origin));if(!m){valid=false;break;}
   for(let target=origin;target<Math.min(months.length,origin+6);target++){
    const t=temperatureScenario(months.slice(0,origin),temperatures.slice(0,origin),months[target],scenario).temperatureC;
    const predicted=prediction(m,target,months[target],t);
    if(!Number.isFinite(predicted)||predicted<0){valid=false;break;}
    error+=Math.abs(predicted-values[target])*billedDays[target];count++;
   }
   if(!valid)break;
  }
  if(valid&&count&&error/count<best){best=error/count;selected=scenario;}
 }
 return selected;
}
function baseline(values:number[],months:string[],target:string,method:string){
 const n=values.length,h=monthIndex(target)-monthIndex(months[n-1]);
 if(method==='MONTHLY_MEAN_DAILY')return monthlyAverage(values,months,target).daily;
 if(method==='SEASONAL_DAILY')return values[n-12+h-1];
 const mean=values.reduce((s,v)=>s+v,0)/n,center=(n-1)/2;
 let covariance=0,variance=0;values.forEach((v,i)=>{covariance+=(i-center)*(v-mean);variance+=(i-center)**2;});
 return mean+covariance/variance*(n-1+h-center);
}
function date(s:string){
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(s))throw Error('READING_DATE_INVALID');
 const d=new Date(s+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw Error('READING_DATE_INVALID');return d.getTime();
}
/** Previous reading is exclusive; current reading is inclusive. No inferred dates become evidence. */
export function cycleWeatherRange(input:ForecastInput,periods:ReadingPeriod[]=[]){
 const rows=[...input.observations].sort((a,b)=>monthIndex(a.month)-monthIndex(b.month));
 if(!periods.length)return {from:rows[0].month+'-01',to:rows[rows.length-1].month+'-'+String(days(rows[rows.length-1].month)).padStart(2,'0'),documented:false};
 if(periods.length!==rows.length||new Set(periods.map(p=>p.month)).size!==rows.length)throw Error('READING_PERIODS_INCOMPLETE');
 const ordered=rows.map(r=>{
  const p=periods.find(p=>p.month===r.month);
  if(!p||p.evidenceId!==r.evidence.id||!Number.isInteger(p.page)||p.page<1||p.page>1000)throw Error('READING_EVIDENCE_INVALID');
  const start=date(p.previousReading),end=date(p.currentReading);
  if((end-start)/86400000!==r.billedDays||p.currentReading.slice(0,7)!==r.month)throw Error('READING_DAYS_INVALID');
  return {p,start,end};
 });
 if(ordered.some((r,i)=>i>0&&r.start!==ordered[i-1].end))throw Error('READING_PERIOD_GAP_OR_OVERLAP');
 return {from:new Date(ordered[0].start+86400000).toISOString().slice(0,10),to:ordered[ordered.length-1].p.currentReading,documented:true};
}
/** Isolated annual policy; legacy snapshots and policy 1.0 remain untouched. */
export function applyClimateCycle(input:ForecastInput,base:Forecast,weather:ClimateHistory,options:ClimateCycleOptions={}){
 if(['organizationId','customerId','unitId','asOfMonth'].some(k=>input[k as keyof ForecastInput]!==base[k as keyof Forecast]))throw Error('CLIMATE_SCOPE_INVALID');
 const reject=(reason:string,comparison:unknown=null,context:unknown=null)=>({...base,climateAssessment:{version:'climate-cycle/2.0',applied:false,reason,comparison,context},qualifications:[...base.qualifications,`Ajuste climático não aplicado: ${reason}.`]});
 const rows=base.actual,months=rows.map(r=>r.month);
 if(rows.length!==36)return reject('ciclo anual de teste exige 36 meses: 24 iniciais de treinamento e 12 origens cronológicas');
 if(base.future.length>6)return reject('horizonte até dezembro excede os seis meses avaliados');
 if(weather.provider!=='NASA_POWER'||weather.parameter!=='T2M'||weather.unit!=='°C'||weather.timeStandard!=='UTC'||!/^[a-f0-9]{64}$/.test(weather.sourceHash))return reject('metadados meteorológicos inválidos');
 const range=cycleWeatherRange(input,options.readingPeriods);
 if(weather.from!==range.from||weather.to!==range.to)return reject('período meteorológico incompatível com os períodos de leitura');
 const dailyWeather=weather.daily;
 if(!dailyWeather||new Set(dailyWeather.map(r=>r.date)).size!==dailyWeather.length)return reject('temperaturas diárias ausentes ou duplicadas');
 const temperatures:number[]=[],lookup=new Map(dailyWeather.map(r=>[r.date,r.temperatureC]));
 for(const row of rows){
  const p=options.readingPeriods?.find(p=>p.month===row.month);
  if(!p&&row.billedDays!==days(row.month))return reject('dias faturados diferem do mês civil; documente as datas reais de leitura');
  const start=p?date(p.previousReading)+86400000:date(row.month+'-01'),end=p?date(p.currentReading):start+(row.billedDays-1)*86400000;
  let sum=0;
  for(let d=start;d<=end;d+=86400000){const t=lookup.get(new Date(d).toISOString().slice(0,10));if(t===null||t===undefined||!Number.isFinite(t)||t< -90||t>65)return reject('temperaturas diárias incompletas; ausência não representa zero');sum+=t;}
  temperatures.push(sum/row.billedDays);
 }
 const context={readingAlignment:range.documented?'DOCUMENTED':'CALENDAR_APPROXIMATION',sensitivity:options.sensitivity??'UNKNOWN',temperature:months.map((month,i)=>({month,temperatureC:Number(temperatures[i].toFixed(6))})),variable:'T2M',scenarioMeaning:'Cenário histórico, não previsão meteorológica',degreeDaysStatus:options.sensitivity==='LOW'?'NOT_APPLICABLE_LOW_SENSITIVITY':'REQUIRES_DOCUMENTED_THERMAL_ACTIVITY'};
 const values=rows.map(r=>Number(quantity(r.consumptionKwh))/1e6/r.billedDays),billing=rows.map(r=>r.billedDays);
 const methods=['MONTHLY_MEAN_DAILY','LINEAR_DAILY','SEASONAL_DAILY'];
 type Target={origin:string;month:string;horizon:number;climateError:number;errors:number[]};
 const targets:Target[]=[],origins:{origin:string;scenario:Scenario}[]=[];
 for(let origin=24;origin<36;origin++){
  const trainMonths=months.slice(0,origin),trainValues=values.slice(0,origin),trainTemps=temperatures.slice(0,origin);
  const model=fit(trainMonths,trainValues,trainTemps);if(!model)return reject('temperatura não identificável separadamente de tendência e sazonalidade',null,context);
  const scenario=chooseScenario(trainMonths,trainValues,trainTemps,billing.slice(0,origin));origins.push({origin:months[origin-1],scenario});
  for(let target=origin;target<Math.min(36,origin+6);target++){
   const t=temperatureScenario(trainMonths,trainTemps,months[target],scenario).temperatureC;
   const climate=prediction(model,target,months[target],t)*billing[target],actual=values[target]*billing[target];
   try{scaled(climate);}catch{return reject('previsão climática inválida no teste anual',null,context);}
   const errors=methods.map(method=>{const v=baseline(trainValues,trainMonths,months[target],method)*billing[target];return Number.isFinite(v)&&v>=0?Math.abs(v-actual):Infinity;});
   targets.push({origin:months[origin-1],month:months[target],horizon:target-origin+1,climateError:Math.abs(climate-actual),errors});
  }
 }
 const baselineScores=methods.map((method,i)=>({method,mae:targets.reduce((s,t)=>s+t.errors[i],0)/targets.length})).filter(r=>Number.isFinite(r.mae));
 if(!baselineScores.length)return reject('referências sem clima indisponíveis',null,context);
 const best=baselineScores.reduce((a,b)=>b.mae<a.mae?b:a),bestIndex=methods.indexOf(best.method),mae=targets.reduce((s,t)=>s+t.climateError,0)/targets.length;
 const group=(list:Target[])=>({predictions:list.length,climateMaeKwh:scaled(list.reduce((s,t)=>s+t.climateError,0)/list.length),baselineMaeKwh:scaled(list.reduce((s,t)=>s+t.errors[bestIndex],0)/list.length)});
 const comparedOrigins=origins.map(o=>({...o,...group(targets.filter(t=>t.origin===o.origin))}));
 const wins=comparedOrigins.filter(o=>Number(o.climateMaeKwh)<Number(o.baselineMaeKwh)).length;
 const comparison={climateMaeKwh:scaled(mae),bestBaselineMaeKwh:scaled(best.mae),baselineMethod:best.method,predictions:targets.length,originCount:12,winningOrigins:wins,minimumWinningOrigins:8,minimumImprovementPercent:10,improvementPercent:best.mae>0?Number(((best.mae-mae)/best.mae*100).toFixed(6)):null,origins:comparedOrigins,byHorizon:Array.from({length:6},(_,i)=>({horizon:i+1,...group(targets.filter(t=>t.horizon===i+1))})),testMonths:months.slice(24),baselineScores:baselineScores.map(s=>({method:s.method,maeKwh:scaled(s.mae)})),selection:'NESTED_TRAINING_ONLY',statisticalSignificance:false};
 if(best.mae<=0||mae>=best.mae*0.9||wins<8)return reject('ganho fora da amostra insuficiente para substituir a referência sem clima',comparison,context);
 if(!range.documented)return reject('ganho candidato requer datas de leitura documentadas antes de aplicar clima',comparison,context);
 const model=fit(months,values,temperatures)!,scenario=chooseScenario(months,values,temperatures,billing);
 const scenarios:{month:string;temperatureC:number;sourceMonths:string[]}[]=[];
 let future:Forecast['future'];
 try{future=base.future.map(row=>{
  const t=temperatureScenario(months,temperatures,row.month,scenario);scenarios.push({month:row.month,...t});
  const baselineKwh=scaled(prediction(model,monthIndex(row.month)-monthIndex(months[0]),row.month,t.temperatureC)*row.days);
  const {averageBasis,averageSourceMonths,...original}=row;
  return {...original,baselineKwh,predictedKwh:decimal(quantity(baselineKwh)+quantity(row.expansionKwh))};
 });}catch{return reject('previsão futura inválida; revisar cenário',comparison,context);}
 const total=future.reduce((s,r)=>s+quantity(r.predictedKwh),0n);
 return {...base,formulaVersion:'consumption-forecast/1.4',method:'CLIMATE_ANNUAL_CYCLE_DAILY',weatherApplied:true,future,futureKwh:decimal(total),estimatedYearKwh:decimal(quantity(base.observedYearKwh)+total),climateAssessment:{version:'climate-cycle/2.0',applied:true,reason:'ganho no ciclo anual e datas documentadas',comparison,context,scenario,scenarios,coefficients:model.coefficients,temperatureCenter:model.center,temperatureScale:model.scale,sourceHash:weather.sourceHash},qualifications:[...base.qualifications.filter(q=>!q.startsWith('Sem ajuste climático')),'Temperatura regional alinhada às datas documentadas: leitura anterior exclusiva e atual inclusiva. Projeção futura utiliza dias de calendário.','Cenário histórico escolhido apenas no treinamento; não é previsão meteorológica nem normal climatológica.',`Teste de 12 origens: ganho ${comparison.improvementPercent}% contra ${best.method}; ${wins}/12 origens melhores. Limiar >10% e pelo menos 8/12.`,`57 previsões sobrepostas não são 57 amostras independentes; não representam teste formal de significância. Sem intervalo calibrado.`, 'Ajuste não comprova causalidade; graus-dia exigem atividade térmica e temperatura-base documentadas.']};
}
