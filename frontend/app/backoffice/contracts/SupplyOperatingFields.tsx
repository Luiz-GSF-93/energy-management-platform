'use client';
import {useState} from 'react';
import {Button,Input} from '@/app/components/ui';
export type SeasonalYear={year:number;annualVolumeMwh:number;monthlyPercentages:number[]};
export type OperatingTerms={flexibility_min_percent?:number|null;flexibility_max_percent?:number|null;modulation?:string|null;submarket?:string|null;seasonality_mode?:string|null;seasonality_rule?:string|null;seasonal_volumes?:SeasonalYear[]};
export const modulations:Record<string,string>={FLEX:'Flex',LOAD_FOLLOWING:'Conforme a carga'};
export const submarkets:Record<string,string>={S:'Sul',SE_CO:'Sudeste/Centro-Oeste (SE/CO)',NE:'Nordeste',N:'Norte'};
const months=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
export function readOperatingTerms(f:FormData){const mode=String(f.get('seasonalityMode')||'');const monthly=['MONTHLY','BOTH'].includes(mode);const value=(k:string)=>f.get(k)===''||f.get(k)===null?null:Number(f.get(k));return {flexibilityMinPercent:value('flexibilityMinPercent'),flexibilityMaxPercent:value('flexibilityMaxPercent'),modulation:String(f.get('modulation')||'')||null,submarket:String(f.get('submarket')||'')||null,seasonalityMode:mode||null,seasonalityRule:['RULE','BOTH'].includes(mode)?String(f.get('seasonalityRule')||'').trim():null,seasonalVolumes:monthly?JSON.parse(String(f.get('seasonalVolumes')||'[]')) as SeasonalYear[]:[]};}
export default function SupplyOperatingFields({value,busy,onDirty}:{value?:OperatingTerms|null;busy:boolean;onDirty:(dirty:boolean)=>void}){
 const [mode,setMode]=useState(value?.seasonality_mode||'');
 const [years,setYears]=useState<SeasonalYear[]>(value?.seasonal_volumes||[]);
 const monthly=['MONTHLY','BOTH'].includes(mode);
 const change=(i:number,patch:Partial<SeasonalYear>)=>{setYears(old=>old.map((r,n)=>n===i?{...r,...patch}:r));onDirty(true);};
 return <fieldset disabled={busy}><legend>Flexibilidade, modulação e sazonalidade</legend>
 <div className="organizations-create__form">
 <p>Campos informativos do cadastro original: ambos expressam percentuais totais do volume (por exemplo, 70% a 130%). Para o motor, após ativar o contrato, confirme em Faturamento automático o mínimo de 70% e a tolerância superior de 30%. Esses campos não substituem a condição de faturamento confirmada.</p>
 <Input label="Flexibilidade mínima (%)" name="flexibilityMinPercent" type="number" min="0" step="0.0001" defaultValue={value?.flexibility_min_percent??''}/>
 <Input label="Flexibilidade máxima informativa (% total do volume)" name="flexibilityMaxPercent" type="number" min="0" step="0.0001" defaultValue={value?.flexibility_max_percent??''}/>
 <label>Modulação<select className="ds-input" name="modulation" defaultValue={value?.modulation||''}><option value="">Não informada</option>{Object.entries(modulations).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 <label>Submercado<select className="ds-input" name="submarket" defaultValue={value?.submarket||''}><option value="">Não informado</option>{Object.entries(submarkets).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 <label>Sazonalidade<select className="ds-input" name="seasonalityMode" value={mode} onChange={e=>{setMode(e.target.value);onDirty(true);}}><option value="">Não informada</option><option value="RULE">Regra contratual</option><option value="MONTHLY">Distribuição mensal</option><option value="BOTH">Regra e distribuição mensal</option></select></label>
 {['RULE','BOTH'].includes(mode)?<label>Regra contratual de sazonalidade<textarea className="ds-input" name="seasonalityRule" maxLength={4096} required defaultValue={value?.seasonality_rule||''}/></label>:null}
 {monthly?<><p>Cadastre cada ano da vigência, com o volume anual e os 12 percentuais somando 100%. Nos meses fora da vigência, use zero. O volume anual é informado explicitamente, sem inferir a periodicidade da quantidade geral do contrato.</p>
 <input type="hidden" name="seasonalVolumes" value={JSON.stringify(years)}/>
 {years.map((row,i)=><fieldset key={i}><legend>Distribuição anual {i+1}</legend><div className="organizations-create__form">
 <Input label={'Ano da distribuição '+(i+1)} type="number" min="1900" max="9999" step="1" required value={row.year} onChange={e=>change(i,{year:Number(e.target.value)})}/>
 <Input label={'Volume anual (MWh) '+(i+1)} type="number" min="0" step="any" required value={row.annualVolumeMwh} onChange={e=>change(i,{annualVolumeMwh:Number(e.target.value)})}/>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:'12px'}}>{months.map((m,j)=><Input key={m} label={m+' (%) — '+row.year} type="number" min="0" max="100" step="0.0001" required value={row.monthlyPercentages[j]} onChange={e=>change(i,{monthlyPercentages:row.monthlyPercentages.map((v,k)=>k===j?Number(e.target.value):v)})}/>)}</div>
 <p role="status">Total: {row.monthlyPercentages.reduce((a,b)=>a+b,0).toLocaleString('pt-BR',{maximumFractionDigits:4})}% — deve somar 100%.</p>
 <Button variant="secondary" type="button" onClick={()=>{setYears(old=>old.filter((_,n)=>n!==i));onDirty(true);}}>Remover ano {row.year}</Button>
 </div></fieldset>)}
 <Button type="button" variant="secondary" disabled={years.length>=50} onClick={()=>{setYears(old=>[...old,{year:old.length?old[old.length-1].year+1:new Date().getFullYear(),annualVolumeMwh:0,monthlyPercentages:Array(12).fill(0)}]);onDirty(true);}}>Adicionar ano de sazonalidade</Button></>:null}
 </div></fieldset>;
}
export function OperatingSummary({value}:{value:OperatingTerms}){return <><p>Flexibilidade: {value.flexibility_min_percent==null?'Não informada':value.flexibility_min_percent+'% a '+value.flexibility_max_percent+'% do volume contratado'}</p><p>Modulação: {modulations[value.modulation||'']||'Não informada'} · Submercado: {submarkets[value.submarket||'']||'Não informado'}</p><p style={{whiteSpace:'pre-wrap'}}>Sazonalidade: {value.seasonality_rule||'Regra textual não informada'}</p>{value.seasonal_volumes?.map(r=><div key={r.year}><p>{r.year}: {Number(r.annualVolumeMwh).toLocaleString('pt-BR')} MWh/ano</p><p>{r.monthlyPercentages.map((v,i)=>months[i]+': '+v+'%').join(' · ')}</p></div>)}</>;}
