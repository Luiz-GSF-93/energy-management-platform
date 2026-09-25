import {monthPeriod} from './preparation';
const decimal=(v:unknown,places:number)=>{const s=typeof v==='number'&&Number.isFinite(v)?String(v):v;if(typeof s!=='string'||!new RegExp('^(0|[1-9][0-9]{0,11})([.][0-9]{1,'+places+'})?$').test(s))throw Error('Valor decimal inválido');const [a,b='']=s.split('.');return BigInt(a)*10n**BigInt(places)+BigInt(b.padEnd(places,'0'));};
const fixed=(n:bigint,p:number)=>{const s=n.toString().padStart(p+1,'0');return s.slice(0,-p)+'.'+s.slice(-p);};
const day=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export type SupplyReference={formulaVersion:'supply-reference-1.0';lines:{contractId:string;number:string;annualVolumeMwh:string;monthlyPercent:string;volumeMwh:string;pricePerMwh:string;exactAmount:string;amount:string;priceSource:string;priceStart:string;priceEnd:string;seasonalityMode:string}[];pending:{contractId:string;number:string;reason:string}[];warnings:string[]};
/** Contractual reference only; never a payable invoice or a published settlement. */
export function supplyReference(unit:any,month:string,contracts:any[],prices:any[]):SupplyReference{
 const period=monthPeriod(month),year=Number(month.slice(0,4)),index=Number(month.slice(5))-1;
 const result:SupplyReference={formulaVersion:'supply-reference-1.0',lines:[],pending:[],warnings:[
 'Referência contratual = volume anual × percentual do mês ÷ 100 × preço final por MWh. Não é valor faturável, custo total ACL ou economia.',
 'Não aplica flexibilidade, modulação, perdas, encargos, impostos, garantias ou honorários. Não soma valores aos demais componentes.',
 'Quando existir regra textual de sazonalidade, confira sua compatibilidade com a distribuição mensal. Não há interpretação automática da regra.',
 'Consulta somente leitura. Fontes podem mudar; esta memória não substitui uma apuração versionada e validada.'
 ]};
 const candidates=contracts.filter(c=>c.organization_id===unit.organization_id&&c.customer_id===unit.customer_id&&c.consumer_unit_id===unit.id&&c.contract_type==='ENERGY_PURCHASE'&&['ACTIVE','APPROVED'].includes(c.status)&&(!day(c.start_date)||!day(c.end_date)||c.start_date<=period.end&&c.end_date>=period.start)).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 if(!candidates.length)result.warnings.push('Nenhum contrato de compra ativo/aprovado encontrado para a competência.');
 for(const c of candidates){const reject=(reason:string)=>result.pending.push({contractId:String(c.id),number:String(c.contract_number||'Contrato'),reason});
 if(unit.free_market!==true){reject('Confirme o enquadramento da unidade no Mercado Livre.');continue;}
 if(candidates.length!==1){reject('Há contratos concorrentes no mês. A alocação deve ser definida antes de emitir uma referência.');continue;}
 if(!day(c.start_date)||!day(c.end_date)||c.start_date>period.start||c.end_date<period.end){reject('O contrato não cobre o mês inteiro. Não há rateio automático por dias.');continue;}
 if(!['MONTHLY','BOTH'].includes(c.seasonality_mode)||!Array.isArray(c.seasonal_volumes)){reject('Informe a distribuição mensal explícita do volume anual. O volume geral do contrato não será dividido por 12.');continue;}
 const years=c.seasonal_volumes.filter((v:any)=>v&&v.year===year);if(years.length!==1){reject('A distribuição do ano está ausente ou duplicada.');continue;}
 const schedule=years[0];let annual:bigint,percentage:bigint;
 try{annual=decimal(schedule.annualVolumeMwh,6);if(!Array.isArray(schedule.monthlyPercentages)||schedule.monthlyPercentages.length!==12)throw Error();const percentages=schedule.monthlyPercentages.map((v:unknown)=>decimal(v,4));if(percentages.some((v:bigint)=>v>1000000n)||percentages.reduce((a:bigint,b:bigint)=>a+b,0n)!==1000000n)throw Error();percentage=percentages[index];for(let m=0;m<12;m++){const mp=monthPeriod(String(year)+'-'+String(m+1).padStart(2,'0'));if((mp.end<c.start_date||mp.start>c.end_date)&&percentages[m]!==0n)throw Error();}}catch{reject('Revise o volume anual e os 12 percentuais: precisam somar exatamente 100%, com zero nos meses fora da vigência.');continue;}
 const history=prices.filter(p=>p.contract_id===c.id&&(!day(p.start_date)||!day(p.end_date)||p.start_date<=period.end&&p.end_date>=period.start));
 const annualPrices=Array.isArray(c.annual_prices)?c.annual_prices.filter((p:any)=>!p||!day(p.startDate)||!day(p.endDate)||p.startDate<=period.end&&p.endDate>=period.start):[];
 if(history.length&&annualPrices.length){reject('Histórico e tabela contratual possuem preços no mês. Concilie as fontes antes de calcular.');continue;}
 const options=history.length?history.map(p=>({start:p.start_date,end:p.end_date,price:p.price_per_mwh,final:true,source:'Histórico de preços · '+p.id})):annualPrices.map((p:any)=>({start:p?.startDate,end:p?.endDate,price:p?.pricePerMwh,final:p?.priceStatus==='FINAL',source:'Tabela contratual por vigência'}));
 if(options.length!==1){reject('É necessário um único preço final cobrindo todo o mês, sem lacunas ou sobreposição.');continue;}
 const price=options[0];if(!price.final||!day(price.start)||!day(price.end)||price.start>period.start||price.end<period.end){reject('Preço-base ou vigência parcial: confirme o preço final para todo o mês. Não há reajuste ou segmentação automática.');continue;}
 try{const rate=decimal(price.price,6),volume=annual*percentage,product=volume*rate;
 // annual:6dp × percent:4dp ÷ 100 => volume:12dp; × rate:6dp => amount:18dp.
 const denominator=10n**18n,cents=(product*100n+denominator/2n)/denominator;
 result.lines.push({contractId:String(c.id),number:String(c.contract_number),annualVolumeMwh:fixed(annual,6),monthlyPercent:fixed(percentage,4),volumeMwh:fixed(volume,12),pricePerMwh:fixed(rate,6),exactAmount:fixed(product,18),amount:fixed(cents,2),priceSource:price.source,priceStart:price.start,priceEnd:price.end,seasonalityMode:c.seasonality_mode});
 }catch{reject('Preço inválido ou com precisão não suportada (máximo 6 casas decimais).');}
 }
 return result;
}
