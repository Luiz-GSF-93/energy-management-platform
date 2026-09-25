import type {TaxMemory} from './tax-memory';
type Line=TaxMemory['lines'][number];
const RATE=100000000n,SCALE=10n**15n;
const gcd=(a:bigint,b:bigint):bigint=>{while(b){const c=a%b;a=b;b=c;}return a;};
const fraction=(n:bigint,d:bigint)=>{const g=gcd(n,d);return {n:n/g,d:d/g};};
const add=(a:{n:bigint;d:bigint},b:{n:bigint;d:bigint})=>fraction(a.n*b.d+b.n*a.d,a.d*b.d);
const money=(n:bigint,d:bigint)=>{const s=((n*100n+d/2n)/d).toString().padStart(3,'0');return s.slice(0,-2)+'.'+s.slice(-2);};
/** Resolve only explicitly selected, approved predecessors, retaining rational precision. */
export function composeTaxes(result:TaxMemory,taxes:any[]):TaxMemory{
 const seeds=new Map(result.lines.map(l=>[l.id,l])),resolved=new Map<string,Line>(),failed=new Set<string>(),visiting=new Set<string>();
 function resolve(id:string,depth=0):Line|undefined{
  if(failed.has(id))return;if(resolved.has(id))return resolved.get(id);
  const line=seeds.get(id),p=taxes.find(t=>t.id===id);if(!line||!p)return;
  const reject=(reason:string)=>{if(!failed.has(id))result.pending.push({id,label:line.label,scenario:line.scenario,reason});failed.add(id);return undefined;};
  if(visiting.has(id)||depth>32)return reject('Composição tributária circular ou com mais de 32 níveis. Revise as dependências.');
  const refs=p.tax_basis?.taxes;
  if(refs!=null&&(!Array.isArray(refs)||refs.length>20||refs.some((r:any)=>!r||typeof r.parameterId!=='string'||!Number.isInteger(r.revision)||r.revision<1)||new Set(refs.map((r:any)=>r.parameterId)).size!==refs.length))return reject('Referências tributárias inválidas ou duplicadas.');
  if(p.tax_basis?.interaction!=='SEQUENTIAL'){
   if(refs?.length)return reject('Tributos na base exigem declaração de composição sequencial.');
   resolved.set(id,line);return line;
  }
  if(!refs?.length)return reject('Selecione ao menos um tributo aprovado para a composição sequencial.');
  visiting.add(id);
  try{
   let base=fraction(BigInt(line.exactBase.replace('.','')),SCALE);const sources:NonNullable<Line['taxReferences']>=[];
   for(const ref of refs){const matches=taxes.filter(t=>t.id===ref.parameterId),dep=matches[0];
    if(matches.length!==1||dep.id===p.id||dep.organization_id!==p.organization_id||dep.customer_id!==p.customer_id||dep.consumer_unit_id!==p.consumer_unit_id||dep.scenario!==p.scenario||dep.component_code===p.component_code||dep.status!=='APPROVED'||dep.revision!==ref.revision||dep.start_date>p.start_date||dep.end_date<p.end_date||!['INDEPENDENT','SEQUENTIAL'].includes(dep.tax_basis?.interaction))return reject('Tributo referenciado indisponível, alterado ou fora da vigência. Revise a composição.');
    const value=resolve(dep.id,depth+1);if(!value)return reject('Um tributo da composição possui pendência; nenhum valor foi emitido para esta regra.');
    base=add(base,{n:BigInt(value.numerator),d:BigInt(value.denominator)});
    sources.push({id:dep.id,revision:dep.revision,code:dep.component_code,amount:value.amount,numerator:value.numerator,denominator:value.denominator});
   }
   const [whole,decimal='']=line.rate.split('.'),rate=BigInt(whole)*1000000n+BigInt(decimal.padEnd(6,'0'));
   const total=fraction(base.n*rate,base.d*(line.treatment==='INSIDE'?RATE-rate:RATE));
   const value={...line,exactBase:base.n.toString()+' / '+base.d.toString(),baseNumerator:base.n.toString(),baseDenominator:base.d.toString(),base:money(base.n,base.d),amount:money(total.n,total.d),numerator:total.n.toString(),denominator:total.d.toString(),taxReferences:sources};resolved.set(id,value);return value;
  }finally{visiting.delete(id);}
 }
 result.lines=result.lines.map(l=>resolve(l.id)).filter((l):l is Line=>!!l);return result;
}
