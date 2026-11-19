import {ProjectError,text,number} from './project-policy.mjs';
const fail=m=>{throw new ProjectError(m);};
const optional=(v,max=10000)=>String(v??'').trim().slice(0,max);
const date=(v,label)=>/^\d{4}-\d{2}-\d{2}$/.test(v??'')&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v?v:fail('Data inválida: '+label);
const list=(v,max,label)=>Array.isArray(v)&&v.length<=max?v:fail('Lista inválida: '+label);
export function validCnpj(raw){
 const x=String(raw??'').toUpperCase().replace(/[.\/-]/g,'');if(!/^[A-Z0-9]{12}\d{2}$/.test(x)||/^(.)\1{13}$/.test(x))return false;
 const dv=s=>{const weights=s.length===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];const r=[...s].reduce((n,c,i)=>n+(c.charCodeAt(0)-48)*weights[i],0)%11;return String(r<2?0:11-r);};
 return dv(x.slice(0,12))===x[12]&&dv(x.slice(0,13))===x[13];
}
export function parseLoadCurve(csv){
 if(typeof csv!=='string'||Buffer.byteLength(csv)>5_000_000||csv.includes('\0'))fail('CSV inválido ou acima de 5 MB.');
 const lines=csv.replace(/^\uFEFF/,'').trim().split(/\r?\n/);if(lines.shift()?.trim()!=='timestamp;consumo_kwh;demanda_kw'||lines.length<2||lines.length>100000)fail('Use timestamp;consumo_kwh;demanda_kw e entre 2 e 100.000 registros.');
 let total=0,peak=0,prior=null,first=null,last=null,step=null,gaps=0;const readings=[];
 for(let i=0;i<lines.length;i++){
  const cols=lines[i].split(';');if(cols.length!==3||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(cols[0]))fail('Linha '+(i+2)+': timestamp ISO com fuso horário obrigatório.');
  date(cols[0].slice(0,10),'linha '+(i+2));const ms=Date.parse(cols[0]);if(!Number.isFinite(ms)||prior!==null&&ms<=prior)fail('Linha '+(i+2)+': datas repetidas, inválidas ou fora de ordem.');
  const values=cols.slice(1).map(v=>/^\d+(?:[.,]\d+)?$/.test(v.trim())?Number(v.replace(',','.')):NaN);for(const n of values)number(n,'medição',0,1e9);
  if(prior!==null){const delta=ms-prior;if(step===null)step=delta;else if(delta!==step)gaps++;}prior=ms;first??=cols[0];last=cols[0];total+=values[0];peak=Math.max(peak,values[1]);
  if(readings.length<96)readings.push({timestamp:cols[0],consumo_kwh:values[0],demanda_kw:values[1]});
 }
 return {count:lines.length,first,last,energy_kwh:total,maximum_kw:peak,interval_minutes:step/60000,irregular_intervals:gaps,preview:readings,warning:gaps?'Há intervalos irregulares; revise lacunas e duração de cada leitura.':'Consumo observado no arquivo. A amostra não representa automaticamente o consumo anual.'};
}
export function validateMv(x={}){
 if(!['','A','B','C','D'].includes(x.option??''))fail('Escolha uma opção IPMVP de A a D.');
 const result={option:x.option??''};for(const k of ['boundary','baseline','baseline_start','baseline_end','post_start','post_end','variables','adjustments','instruments','calibration','sampling','uncertainty','savings_equation','responsible','verification_frequency'])result[k]=optional(x[k]);
 for(const k of ['baseline_start','baseline_end','post_start','post_end'])if(result[k])date(result[k],k);
 if(result.baseline_start&&result.baseline_end&&result.baseline_start>result.baseline_end)fail('Período de baseline invertido.');
 if(result.post_start&&result.post_end&&result.post_start>result.post_end)fail('Período pós-implantação invertido.');
 if(result.baseline_end&&result.post_start&&result.post_start<=result.baseline_end)fail('A medição pós-implantação deve suceder a linha de base.');
 return result;
}
export function mvIssues(m={}){
 const fields={option:'Opção IPMVP',boundary:'Fronteira de medição',baseline:'Caracterização da baseline',baseline_start:'Início da baseline',baseline_end:'Fim da baseline',post_start:'Início pós-implantação',post_end:'Fim pós-implantação',variables:'Variáveis independentes',adjustments:'Ajustes de rotina e não rotina',instruments:'Instrumentação',calibration:'Calibração',uncertainty:'Análise de incerteza',savings_equation:'Equação de economia',responsible:'Responsável pela M&V',verification_frequency:'Frequência de verificação'};
 const issues=Object.entries(fields).filter(([k])=>!m[k]?.trim()).map(([,v])=>v);
 if(m.option==='A'&&!m.sampling?.trim())issues.push('Justificativa dos parâmetros estimados e amostragem (opção A)');
 if(m.option==='D'&&!m.sampling?.trim())issues.push('Modelo de simulação e calibração (opção D)');return issues;
}
const cents=(v,label)=>Math.round(number(v,label,0,1e10)*100);
export function validateResources(rows=[]){return list(rows,200,'recursos').map((r,i)=>{
 const quantity=number(r.quantity,'quantidade',0.001,1e8),unit_cents=cents(r.unit_price,'preço unitário'),total_cents=Math.round(quantity*unit_cents),pee_cents=cents(r.pee,'recursos PEE'),own_cents=cents(r.own,'contrapartida'),other_cents=cents(r.other??0,'outras fontes');
 if(!Number.isSafeInteger(total_cents)||!Number.isSafeInteger(pee_cents+own_cents+other_cents))fail('Valor do item excede o limite seguro de cálculo em centavos.');
 if(pee_cents+own_cents+other_cents!==total_cents)fail('Item '+(i+1)+': as fontes devem totalizar o custo do item.');
 const life=number(r.life,'vida útil ou horizonte de anualização',1,60),annual_om_cents=cents(r.annual_om??0,'O&M anual'),annual_om_pee_cents=cents(r.annual_om_pee??0,'parcela PEE do O&M anual');if(annual_om_pee_cents>annual_om_cents)fail('O&M PEE superior ao O&M total.');
 return {id:optional(r.id,50)||String(i+1),name:text(r.name,'descrição do recurso',1000),category:text(r.category,'categoria',100),quantity,unit:optional(r.unit,30),unit_cents,total_cents,pee_cents,own_cents,other_cents,life,annual_om_cents,annual_om_pee_cents,supplier:optional(r.supplier,300),quotation:optional(r.quotation,500),eligibility_clause:optional(r.eligibility_clause,2000),eligibility_reviewed:r.eligibility_reviewed===true};
 });}
export function resourceSummary(rows=[]){return rows.reduce((t,r)=>{for(const k of ['total_cents','pee_cents','own_cents','other_cents'])t[k]+=r[k];return t;},{total_cents:0,pee_cents:0,own_cents:0,other_cents:0});}
export function fundingEconomy(project,economy){
 if(!economy)return null;const rows=project.resources??[],base={...economy,rcb_total:economy.rcb,rcb_pee:null,annual_cost_pee:null,funding_status:'awaiting_budget'};
 if(!rows.length||rows.some(r=>!Number.isFinite(r.life)||r.life<1||!Number.isSafeInteger(r.total_cents)))return base;
 const totals=resourceSummary(rows);if(Math.abs(totals.total_cents-Math.round(economy.investment*100))>1)return {...base,funding_status:'budget_not_reconciled'};
 const rate=number(project.economics?.discount_rate,'taxa de desconto',0,100)/100,crf=n=>rate===0?1/n:rate/(1-(1+rate)**-n);
 const total=rows.reduce((s,r)=>s+r.total_cents/100*crf(r.life)+(r.annual_om_cents??0)/100,0),pee=rows.reduce((s,r)=>s+r.pee_cents/100*crf(r.life)+(r.annual_om_pee_cents??0)/100,0);
 return {...base,rcb_total:total/economy.annual_benefit,rcb_pee:pee/economy.annual_benefit,annual_cost:total,annual_cost_pee:pee,funding_status:'budget_reconciled',rcb:total/economy.annual_benefit};
}
export function solvency({current_assets,long_term_receivables,total_assets,current_liabilities,long_term_liabilities}){
 for(const [k,v]of Object.entries({current_assets,long_term_receivables,total_assets,current_liabilities,long_term_liabilities}))number(v,k);
 const liabilities=current_liabilities+long_term_liabilities;return {ilg:liabilities>0?(current_assets+long_term_receivables)/liabilities:null,ilc:current_liabilities>0?current_assets/current_liabilities:null,isg:liabilities>0?total_assets/liabilities:null,warning:'Indicadores calculados a partir dos dados declarados. Aplicação e limites dependem do edital; não substituem avaliação financeira ou de crédito.'};
}
export function validateSchedule(rows=[]){
 const out=list(rows,100,'cronograma').map((r,i)=>({id:optional(r.id,50)||String(i+1),name:text(r.name,'etapa do cronograma',500),start:date(r.start,'início'),end:date(r.end,'fim'),responsible:text(r.responsible,'responsável',300),amount_cents:cents(r.amount??0,'desembolso'),depends_on:list(r.depends_on??[],100,'dependências').map(x=>text(x,'referência',50)),evidence:optional(r.evidence,1000)}));
 if(new Set(out.map(r=>r.id)).size!==out.length)fail('Identificadores duplicados no cronograma.');
 const byId=new Map(out.map(r=>[r.id,r])),visiting=new Set(),done=new Set();
 function visit(r){if(visiting.has(r.id))fail('Dependência circular no cronograma.');if(done.has(r.id))return;visiting.add(r.id);if(r.end<r.start)fail('A etapa termina antes de começar.');for(const id of r.depends_on){const p=byId.get(id);if(!p)fail('Dependência não encontrada.');visit(p);if(r.start<p.end)fail('A etapa começa antes do término da dependência.');}visiting.delete(r.id);done.add(r.id);}out.forEach(visit);return out;
}
export function scoreProject(criteria,answers={}){
 let weight=0,earned=0;const items=list(criteria??[],100,'pontuação').map(r=>{const w=number(r.weight,'peso',0,100),max=number(r.maximum,'máximo',0.001,1e9),value=number(answers[r.id]??0,'pontuação',0,max);weight+=w;earned+=w*value/max;return {id:r.id,label:r.label,weight:w,maximum:max,value,source:r.source};});
 return {items,total_weight:weight,estimated_score:weight?earned/weight*100:null,warning:'Pontuação calculada com critérios cadastrados e evidências revisáveis; não é probabilidade de aprovação.'};
}
