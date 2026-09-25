import {TariffPreview} from './tariff-preview';
import {monthPeriod} from './preparation';
const SCALE=10n**15n,RATE=100000000n;
const day=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const fixed=(n:bigint,p:number)=>{const s=n.toString().padStart(p+1,'0');return s.slice(0,-p)+'.'+s.slice(-p);};
function exact(v:unknown,p:number){if(typeof v!=='string'||!new RegExp('^(0|[1-9][0-9]*)([.][0-9]{1,'+p+'})?$').test(v)||v.length>80)throw Error('Decimal inválido');const [a,b='']=v.split('.');return BigInt(a)*10n**BigInt(p)+BigInt(b.padEnd(p,'0'));}
const rounded=(n:bigint,d:bigint)=>fixed((n*100n+d/2n)/d,2);
export type TaxMemory={formulaVersion:'tax-memory-1.1';lines:{id:string;revision:number;label:string;code:string;scenario:string;treatment:string;rate:string;exactBase:string;base:string;amount:string;numerator:string;denominator:string;source:string;interaction?:string;peers?:{id:string;revision:number;code:string}[];references:{id:string;revision:number;label:string;operation:string;exactAmount:string|null}[]}[];declarations:{id:string;label:string;scenario:string;treatment:string;source:string}[];pending:{id:string;label:string;scenario:string;reason:string}[];warnings:string[]};
/** Isolated configured tax only. No legal inference, aggregate tax stack or settlement. */
export function taxMemory(unit:any,month:string,parameters:any[],tariffs:TariffPreview):TaxMemory{
 const period=monthPeriod(month),scoped=parameters.filter(p=>p.organization_id===unit.organization_id&&p.customer_id===unit.customer_id&&p.consumer_unit_id===unit.id);
 const touches=(p:any)=>!day(p.start_date)||!day(p.end_date)||p.start_date<=period.end&&p.end_date>=period.start;
 const taxes=scoped.filter(p=>p.kind==='TAX'&&p.status==='APPROVED'&&touches(p)).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const result:TaxMemory={formulaVersion:'tax-memory-1.1',lines:[],declarations:[],pending:[],warnings:[
 'Memória isolada por tributo conforme a configuração aprovada; não comprova enquadramento fiscal e não representa custo total ou economia.',
 'Por fora: tributo = base líquida × alíquota. Por dentro: tributo = base líquida × alíquota ÷ (1 − alíquota). A alíquota percentual é dividida por 100.',
 'Exclusões não entram na soma da base; não são descontadas novamente. Nenhuma regra é inferida das justificativas em texto.',
 'Rubricas compartilhadas exigem declaração aprovada de cálculo independente em todos os tributos envolvidos. Cada cálculo usa apenas sua própria base; não há incidência de um tributo sobre outro. Valores já tributados não recebem novo acréscimo.',
 'Somente rubricas tarifárias calculadas e referenciadas estão disponíveis nesta etapa. Custos, fornecedor e demanda sem memória monetária compatível não são presumidos.',
 'Os valores não são somados à memória tarifária. Consulta somente leitura, sem publicação; a apuração final deverá preservar as fontes e versões.'
 ]};
 if(!taxes.length)result.warnings.push('Nenhum tributo aprovado encontrado para esta unidade e competência.');
 for(const p of taxes){const reject=(reason:string)=>result.pending.push({id:String(p.id),label:String(p.label||p.component_code),scenario:String(p.scenario),reason});
 if(!day(p.start_date)||!day(p.end_date)||p.start_date>period.start||p.end_date<period.end){reject('A vigência do tributo não cobre o mês inteiro. Não há segmentação automática.');continue;}
 if(!['ACL','ACR'].includes(p.scenario)||p.measure!=='PERCENT'||p.direction!=='DEBIT'||!Number.isInteger(p.revision)||p.revision<1||typeof p.source!=='string'||!p.source.trim()||typeof p.base_rule!=='string'||!p.base_rule.trim()){reject('Revise fonte, justificativa, revisão, cenário e natureza do tributo.');continue;}
 if(!p.unit_context||['distributor','tariff_group','tariff_subgroup','tariff_modality','state','consumption_class','free_market'].some(k=>(p.unit_context[k]??null)!==(unit[k]??null))){reject('O contexto elétrico difere do tributo aprovado. Revise sua vigência.');continue;}
 if(scoped.some(q=>q!==p&&q.kind==='TAX'&&['DRAFT','APPROVED'].includes(q.status)&&q.component_code===p.component_code&&q.scenario===p.scenario&&touches(q))){reject('Há tributos concorrentes ou rascunho pendente para este código e cenário.');continue;}
 if(['EXEMPT','NOT_APPLICABLE'].includes(p.treatment)){if(p.amount_text!=null){reject('Isenção ou não aplicação deve ser registrada sem alíquota.');continue;}result.declarations.push({id:p.id,label:p.label,scenario:p.scenario,treatment:p.treatment,source:p.source});continue;}
 if(!['INSIDE','OUTSIDE'].includes(p.treatment)){reject('Tratamento já incluído ou desmembramento ainda não suportado nesta memória. Nenhum imposto foi acrescido.');continue;}
 let rate:bigint;try{rate=exact(p.amount_text,6);if(rate>RATE||p.treatment==='INSIDE'&&rate===RATE)throw Error();}catch{reject('Alíquota inválida: use de 0 a 100%; por dentro exige menos de 100%.');continue;}
 const items=p.tax_basis?.items;if(p.tax_basis?.version!==1||!Array.isArray(items)||!items.length||items.length>100||items.some(i=>!i||typeof i!=='object')||!items.some(i=>i.operation==='INCLUDE')||new Set(items.map(i=>i.parameterId)).size!==items.length||items.some(i=>!['INCLUDE','EXCLUDE'].includes(i.operation)||!Number.isInteger(i.revision)||i.revision<1)){reject('Base estruturada ausente, duplicada ou inválida.');continue;}
 const peers=taxes.filter(q=>q!==p&&q.scenario===p.scenario&&!['EXEMPT','NOT_APPLICABLE'].includes(q.treatment)&&Array.isArray(q.tax_basis?.items)&&q.tax_basis.items.some((j:any)=>j?.operation==='INCLUDE'&&items.some(i=>i.operation==='INCLUDE'&&i.parameterId===j.parameterId)));
 if(p.tax_basis.interaction!=null&&p.tax_basis.interaction!=='INDEPENDENT'){reject('Regra de interação tributária não suportada.');continue;}
 if(peers.length&&[p,...peers].some(q=>q.tax_basis?.interaction!=='INDEPENDENT'||!['INSIDE','OUTSIDE'].includes(q.treatment))){reject('Há outros tributos na mesma rubrica. Declare e aprove o cálculo independente em todos os envolvidos, somente se essa for a regra aplicável. Outras composições ainda não estão disponíveis.');continue;}
 let base=0n,error='';const references:TaxMemory['lines'][number]['references']=[];
 for(const item of items){const refs=scoped.filter(r=>r.id===item.parameterId&&r.scenario===p.scenario&&r.kind!=='TAX');const ref=refs[0];
 if(refs.length!==1||ref.status!=='APPROVED'||ref.revision!==item.revision||!day(ref.start_date)||!day(ref.end_date)||ref.start_date>p.start_date||ref.end_date<p.end_date){error='Uma referência foi alterada, retirada ou não cobre a vigência do tributo.';break;}
 if(item.operation==='EXCLUDE'){references.push({id:ref.id,revision:ref.revision,label:ref.label,operation:'EXCLUDE',exactAmount:null});continue;}
 const lines=tariffs.lines.filter(l=>l.parameterId===ref.id&&l.revision===ref.revision&&l.scenario===p.scenario);const line=lines[0];
 if(ref.kind!=='TARIFF'||ref.treatment!=='NET'||ref.direction!=='DEBIT'||lines.length!==1||line.treatment!=='NET'||line.startDate>period.start||line.endDate<period.end||tariffs.pending.some(l=>l.parameterId===ref.id)){error='Uma rubrica incluída não possui memória líquida válida para esta competência. Revise tarifas, medições e tratamento tributário.';break;}
 try{base+=exact(line.exactAmount,15);}catch{error='Valor exato da rubrica inválido.';break;}
 references.push({id:ref.id,revision:ref.revision,label:ref.label,operation:'INCLUDE',exactAmount:line.exactAmount});
 }
 if(error){reject(error);continue;}
 const numerator=base*rate,denominator=SCALE*(p.treatment==='INSIDE'?RATE-rate:RATE);
 result.lines.push({id:p.id,revision:p.revision,label:p.label,code:p.component_code,scenario:p.scenario,treatment:p.treatment,rate:p.amount_text,exactBase:fixed(base,15),base:rounded(base,SCALE),amount:rounded(numerator,denominator),numerator:numerator.toString(),denominator:denominator.toString(),source:p.source,interaction:p.tax_basis.interaction,peers:peers.map(q=>({id:q.id,revision:q.revision,code:q.component_code})),references});
 }
 return result;
}
