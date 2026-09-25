import type {TaxMemory} from './tax-memory';
const RATE=100000000n,SCALE=10n**15n;
const validCodes=(v:any):v is string[]=>Array.isArray(v)&&v.length>=2&&v.length<=20&&new Set(v).size===v.length&&v.every(c=>typeof c==='string'&&/^(ICMS|PIS|COFINS|IOF|OTHER_[A-Z0-9_]+)$/.test(c));
const signature=(items:any[])=>JSON.stringify(items.map(i=>[i.parameterId,i.revision,i.operation]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
const fixed=(n:bigint,p:number)=>{const s=n.toString().padStart(p+1,'0');return s.slice(0,-p)+'.'+s.slice(-p);};
const rate=(v:string)=>{const [a,b='']=v.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));};
/** Explicit common NET base and identical validity only; no fiscal inference. */
export function sharedInsideTaxes(result:TaxMemory,taxes:any[]):TaxMemory{
 const seeds=new Map(result.lines.map(l=>[l.id,l]));
 result.lines=result.lines.filter(line=>{
  const p=taxes.find(t=>t.id===line.id),codes=p?.tax_basis?.groupCodes;
  const reject=(reason:string)=>{result.pending.push({id:line.id,label:line.label,scenario:line.scenario,reason});return false;};
  if(p?.tax_basis?.interaction!=='SHARED_INSIDE')return codes?.length?reject('Códigos de grupo exigem a modalidade por dentro conjunta.'):true;
  if(p.treatment!=='INSIDE'||!validCodes(codes)||!codes.includes(p.component_code)||p.tax_basis.taxes?.length)return reject('Grupo por dentro inválido: inclua este código e ao menos outro, sem referências sequenciais.');
  const ownKey=signature(p.tax_basis.items),groupKey=[...codes].sort().join('|'),members:any[]=[];
  for(const code of [...codes].sort()){
   const candidates=taxes.filter(t=>t.component_code===code&&t.organization_id===p.organization_id&&t.customer_id===p.customer_id&&t.consumer_unit_id===p.consumer_unit_id&&t.scenario===p.scenario),q=candidates[0],value=q&&seeds.get(q.id);
   if(candidates.length!==1||!value||q.status!=='APPROVED'||q.treatment!=='INSIDE'||q.tax_basis?.interaction!=='SHARED_INSIDE'||!validCodes(q.tax_basis.groupCodes)||[...q.tax_basis.groupCodes].sort().join('|')!==groupKey||q.start_date!==p.start_date||q.end_date!==p.end_date||signature(q.tax_basis.items)!==ownKey||value.exactBase!==line.exactBase||q.tax_basis.taxes?.length)return reject('Grupo incompleto ou divergente: todos os tributos precisam estar aprovados, com os mesmos códigos, rubricas, revisões da base e vigência.');
   members.push(q);
  }
  const sum=members.reduce((n,q)=>n+rate(q.amount_text),0n);
  if(sum>=RATE)return reject('A soma das alíquotas do grupo por dentro deve ser menor que 100%.');
  const base=BigInt(line.exactBase.replace('.','')),numerator=base*rate(line.rate),denominator=SCALE*(RATE-sum);
  line.amount=fixed((numerator*100n+denominator/2n)/denominator,2);line.numerator=numerator.toString();line.denominator=denominator.toString();line.combinedRate=fixed(sum,6);line.divisor=fixed(RATE-sum,8);line.sharedGroup=members.map(q=>({id:q.id,revision:q.revision,code:q.component_code,rate:q.amount_text}));return true;
 });return result;
}
