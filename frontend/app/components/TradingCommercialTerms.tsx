'use client';
import {Input} from '@/app/components/ui';

export const quotationGuidance='Procure se aproximar ou melhorar sua oferta com base na referência de preço desejado ACL indicada para cada ano de fornecimento. Aguardamos seu melhor preço e agradecemos sua participação.';
export function referencePeriods(start:string,months:number){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(start)||!Number.isInteger(months)||months<1||months>600)return [];
 const first=Number(start.slice(0,4))*12+Number(start.slice(5))-1;
 const month=(n:number)=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;
 return Array.from({length:Math.ceil(months/12)},(_,i)=>({year:Number(start.slice(0,4))+i,start:month(first+i*12),end:month(first+Math.min(months,(i+1)*12)-1)}));
}
const grid={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))',gap:16} as const;
export function CommercialTermsInputs({data={},disabled=false}:{data?:Record<string,any>;disabled?:boolean}){
 return <fieldset style={{gridColumn:'1/-1',border:'1px solid #31516c',borderRadius:10,padding:16}}><legend>Condições de fornecimento</legend><div style={grid}>
  <Input label="Flexibilidade maior (%) *" name="flexibilityUpperPercent" placeholder="Ex.: +40%" required maxLength={16} defaultValue={data.flexibilityUpperPercent==null?'':`+${data.flexibilityUpperPercent}%`} disabled={disabled}/>
  <Input label="Flexibilidade menor (%) *" name="flexibilityLowerPercent" placeholder="Ex.: -20%" required maxLength={16} defaultValue={data.flexibilityLowerPercent==null?'':`${data.flexibilityLowerPercent}%`} disabled={disabled}/>
  <Input label="Sazonalidade *" name="seasonality" placeholder="Ex.: flat ou conforme perfil de consumo" required maxLength={1000} defaultValue={data.seasonality??''} disabled={disabled}/>
  <Input label="Índice de correção aplicado *" name="correctionIndex" placeholder="Ex.: IPCA, IGPM" required maxLength={1000} defaultValue={data.correctionIndex??''} disabled={disabled}/>
  <Input label="Condição de faturamento *" name="billingTerms" placeholder="Ex.: 5DU após NF" required maxLength={1000} defaultValue={data.billingTerms??''} disabled={disabled}/>
 </div>{data.flexibility&&data.flexibilityUpperPercent==null?<p>Flexibilidade do registro anterior: {data.flexibility}. Informe os dois limites para atualizar as condições.</p>:null}</fieldset>;
}
export function AnnualReferenceInputs({start,months,data={},disabled=false}:{start:string;months:number;data?:Record<string,any>;disabled?:boolean}){
 const years=referencePeriods(start,months);
 return <fieldset style={{gridColumn:'1/-1',border:'1px solid #31516c',borderRadius:10,padding:16}}><legend>Referência de preço desejado ACL (R$/MWh)</legend><p>{quotationGuidance}</p><p>Um preço para cada ano de fornecimento, em períodos de até 12 meses. Todas as referências são obrigatórias antes de enviar aos fornecedores; o rascunho pode ser completado depois.</p>{!years.length?<p>Informe o início e o prazo para cadastrar as referências anuais.</p>:<div style={grid}>{years.map(p=><Input key={p.year} label={`Referência ${p.year} · ${p.start} a ${p.end}`} name={`annualReference_${p.year}`} type="number" min="0.0001" max="10000000" step="0.0001" placeholder="Ex.: 220,00 R$/MWh" defaultValue={data.annualReferencePrices?.find((r:any)=>r.year===p.year)?.priceBrlMwh??''} disabled={disabled}/>)}</div>}</fieldset>;
}
export function readCommercialTerms(form:FormData){
 const result:Record<string,any>={commercialTermsVersion:2};
 for(const key of ['flexibilityUpperPercent','flexibilityLowerPercent']){const raw=String(form.get(key)??'').trim();if(!/^[+-]?\d+(?:[.,]\d+)?%?$/.test(raw))throw Error('Informe a flexibilidade em percentual, por exemplo +40% e -20%.');result[key]=Number(raw.replace('%','').replace(',','.'));}
 for(const key of ['seasonality','correctionIndex','billingTerms'])result[key]=String(form.get(key)??'').trim();return result;
}
export function readAnnualReferences(form:FormData,start:string,months:number){return referencePeriods(start,months).flatMap(({year})=>{const raw=String(form.get(`annualReference_${year}`)??'').trim();if(!raw)return [];const value=Number(raw.replace(',','.'));if(!Number.isFinite(value)||value<=0)throw Error('Informe referências positivas em R$/MWh.');return [{year,priceBrlMwh:value}];});}
export function CommercialTermsSummary({data}:{data:Record<string,any>}){
 return <dl style={grid}>{[['Flexibilidade maior',data.flexibilityUpperPercent==null?'Não informada':`+${data.flexibilityUpperPercent}%`],['Flexibilidade menor',data.flexibilityLowerPercent==null?'Não informada':`${data.flexibilityLowerPercent}%`],['Sazonalidade',data.seasonality],['Índice de correção',data.correctionIndex],['Condição de faturamento',data.billingTerms]].map(([label,value])=><div key={label}><dt>{label}</dt><dd style={{margin:0,overflowWrap:'anywhere'}}>{value||'Não informado'}</dd></div>)}</dl>;
}
export function AnnualReferenceSummary({data}:{data:Record<string,any>}){
 return <section aria-label="Referências desejadas de preço ACL"><h3>Referência de preço desejado ACL · R$/MWh</h3><p>{quotationGuidance}</p>{data.annualReferencePrices?.length?<ul>{referencePeriods(data.startMonth,data.months).map(p=>{const price=data.annualReferencePrices.find((r:any)=>r.year===p.year)?.priceBrlMwh;return <li key={p.year}>{p.year} · {p.start} a {p.end}: <strong>{typeof price==='number'?price.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:4})+' R$/MWh':'Não cadastrada'}</strong></li>;})}</ul>:<p>Referência ainda não cadastrada pelo backoffice.</p>}</section>;
}
