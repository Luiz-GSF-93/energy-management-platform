import {decimal,quantity} from './consumption-forecast';

export type ExposureScope={organizationId:string;customerId:string;unitId:string};
export type ContractTerm=ExposureScope & {
 contractId:string;revision:string;sourceHash:string;source:string;from:string;to:string;
 mode:'REGULAR'|'SPOT'|'INTERRUPTED';confirmed:boolean;
 basis?:'MONTHLY_MWH'|'MW_AVERAGE'|'SEASONAL_MWH';volume?:string;
 /** Total percentages of baseline: e.g. 50 and 140, never 40 as the upper limit. */
 minimumPercent?:string;maximumPercent?:string;monthlyPercentages?:string[];
};
export type ExposureStatus='PROJECTED_EXCESS'|'AT_LIMIT'|'WITHIN_LIMIT'|'BELOW_MINIMUM'|'SPOT_PURCHASE'|'NO_REGULAR_COVERAGE'|'SOURCE_PENDING';
export type ExposureRow={month:string;predictedMwh:string;status:ExposureStatus;baseMwh:string|null;minimumMwh:string|null;maximumMwh:string|null;marginMwh:string|null;excessMwh:string|null;excessPercent:string|null;guidance:string;cost:null;contractId?:string;revision?:string;sourceHash?:string;source?:string};
export type ContractExposure={formulaVersion:'CONTRACT_EXPOSURE_1';calculatedAt:string;rows:ExposureRow[];disclosure:string};
const scale=1000000n;
const divide=(a:bigint,b:bigint)=>a<0n?-((-a+b/2n)/b):(a+b/2n)/b;
export function monthDates(month:string){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Competência inválida.');
 const days=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
 return {first:month+'-01',last:month+'-'+String(days).padStart(2,'0'),hours:BigInt(days*24)};
}
export function validateTerm(t:ContractTerm){
 const validDate=(v:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 if(!validDate(t.from)||!validDate(t.to)||t.to<t.from||!t.contractId||!t.revision||!t.source||!(/^[a-f0-9]{64}$/).test(t.sourceHash))throw new Error('Fonte contratual incompleta.');
 if(!['REGULAR','SPOT','INTERRUPTED'].includes(t.mode))throw new Error('Cobertura inválida.');
 if(t.mode!=='REGULAR')return;
 if(!['MONTHLY_MWH','MW_AVERAGE','SEASONAL_MWH'].includes(t.basis??''))throw new Error('Base de volume não confirmada.');
 if(quantity(t.volume??'')<=0n)throw new Error('Volume inválido.');
 const lower=quantity(t.minimumPercent??''),upper=quantity(t.maximumPercent??'');
 if(lower>100n*scale||upper<100n*scale||upper>1000n*scale)throw new Error('Flexibilidade inválida.');
 if(t.basis==='SEASONAL_MWH'){
  if(!t.monthlyPercentages||t.monthlyPercentages.length!==12||t.monthlyPercentages.reduce((n,v)=>n+quantity(v),0n)!==100n*scale||t.from.slice(0,4)!==t.to.slice(0,4))throw new Error('Sazonalização anual incompleta.');
 }
}
export function calculateContractExposure(scope:ExposureScope,future:{month:string;predictedKwh:string}[],terms:ContractTerm[],calculatedAt:string,unavailable=false):ContractExposure{
 if(future.length>12||new Set(future.map(v=>v.month)).size!==future.length)throw new Error('Projeção contratual inválida.');
 for(const t of terms){if(t.organizationId!==scope.organizationId||t.customerId!==scope.customerId||t.unitId!==scope.unitId)throw new Error('Fonte fora da organização, empresa ou unidade.');validateTerm(t);}
 const rows=future.map(f=>{
  const {first,last,hours}=monthDates(f.month),rawKwh=quantity(f.predictedKwh),predicted=divide(rawKwh,1000n);
  const r:ExposureRow={month:f.month,predictedMwh:decimal(predicted),status:'SOURCE_PENDING',baseMwh:null,minimumMwh:null,maximumMwh:null,marginMwh:null,excessMwh:null,excessPercent:null,guidance:'Eu, EVA, preciso que o backoffice confira a vigência, o volume e a flexibilidade nas fontes antes de concluir a exposição.',cost:null};
  const overlap=terms.filter(t=>t.from<=last&&t.to>=first);
  // A pending declaration or a partial-month change must not silently fall back to the old contract.
  if(unavailable||overlap.some(t=>!t.confirmed||t.from>first||t.to<last))return r;
  const interrupted=new Set(overlap.filter(t=>t.mode==='INTERRUPTED'||t.mode==='SPOT').map(t=>t.contractId));
  const regular=overlap.filter(t=>t.mode==='REGULAR'&&!interrupted.has(t.contractId));
  if(regular.length>1)return r;
  const spot=overlap.filter(t=>t.mode==='SPOT');
  if(!regular.length){r.status=spot.length?'SPOT_PURCHASE':'NO_REGULAR_COVERAGE';r.guidance=spot.length?'Eu, EVA, identifiquei compra avulsa. Confira o volume coberto pela nota e planeje a cobertura dos próximos meses com o consultor; a flexibilidade do contrato interrompido não foi aplicada.':'Eu, EVA, não encontrei cobertura regular comprovada para este mês. Solicite ao consultor a conferência da contratação e das compras necessárias.';return r;}
  const t=regular[0];let base=quantity(t.volume!);
  if(t.basis==='MW_AVERAGE')base*=hours;
  if(t.basis==='SEASONAL_MWH')base=divide(base*quantity(t.monthlyPercentages![Number(f.month.slice(5))-1]),100n*scale);
  const minimum=divide(base*quantity(t.minimumPercent!),100n*scale),maximum=divide(base*quantity(t.maximumPercent!),100n*scale),rawExcess=rawKwh>maximum*1000n?rawKwh-maximum*1000n:0n,excess=divide(rawExcess,1000n);
  Object.assign(r,{contractId:t.contractId,revision:t.revision,sourceHash:t.sourceHash,source:t.source,baseMwh:decimal(base),minimumMwh:decimal(minimum),maximumMwh:decimal(maximum),marginMwh:decimal(divide(maximum*1000n-rawKwh,1000n)),excessMwh:decimal(excess),excessPercent:maximum>0n?decimal(divide(rawExcess*100n*scale,maximum*1000n)):null});
  r.status=rawExcess>0n?'PROJECTED_EXCESS':rawKwh===maximum*1000n?'AT_LIMIT':rawKwh<minimum*1000n?'BELOW_MINIMUM':'WITHIN_LIMIT';
  r.guidance=r.status==='PROJECTED_EXCESS'?'Eu, EVA, projetei consumo acima do limite vigente. Avalie com o consultor a programação da carga, a sazonalização permitida, o ajuste contratual ou uma cotação autorizada para cobertura. Isso não executa compra nem comprova multa.':r.status==='AT_LIMIT'?'Eu, EVA, projetei consumo exatamente no limite, sem margem. Acompanhe a carga com o consultor; igualdade não é excedente.':r.status==='BELOW_MINIMUM'?'Eu, EVA, projetei consumo abaixo do mínimo. Confira as cláusulas de volume mínimo e a sazonalização com o consultor antes de estimar efeitos financeiros.':'Eu, EVA, projetei consumo dentro dos limites comprovados. Continue acompanhando a carga e as revisões contratuais.';
  return r;
 });
 return {formulaVersion:'CONTRACT_EXPOSURE_1',calculatedAt,rows,disclosure:'Projeção em MWh, distinta de demanda em kW e de excedente realizado. Não comprova consumo, prejuízo, quitação ou obrigação de compra. Custos dependem de preço e tratamento tributário comprovados; indisponível não significa zero.'};
}
/** Deliberate public projection: never spread source objects or internal event descriptions. */
export function publicContractExposure(value:any):ContractExposure|null{
 if(!value)return null;
 if(value.formulaVersion!=='CONTRACT_EXPOSURE_1'||!Array.isArray(value.rows)||value.rows.length>12)throw new Error('Exposição contratual incompatível.');
 return {formulaVersion:value.formulaVersion,calculatedAt:value.calculatedAt,disclosure:value.disclosure,rows:value.rows.map((r:ExposureRow)=>({month:r.month,predictedMwh:r.predictedMwh,status:r.status,baseMwh:r.baseMwh,minimumMwh:r.minimumMwh,maximumMwh:r.maximumMwh,marginMwh:r.marginMwh,excessMwh:r.excessMwh,excessPercent:r.excessPercent,guidance:r.guidance,cost:null}))};
}
