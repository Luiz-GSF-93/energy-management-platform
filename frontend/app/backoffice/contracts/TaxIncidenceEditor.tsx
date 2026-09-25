'use client';
import {useState} from 'react';
import {Button} from '@/app/components/ui';
import {Choice,IncidenceRule,decodeIncidence,encodeIncidence,taxTemplate} from './tax-incidence';
export default function TaxIncidenceEditor({tax,value,onChange}:{tax:string;value:string;onChange:(value:string)=>void}){
 const [replace,setReplace]=useState(false),[error,setError]=useState('');
 const parsed=decodeIncidence(value),rule:IncidenceRule=parsed??{tax,items:[],notes:value};
 function change(next:IncidenceRule){const text=encodeIncidence(next);if(text.length>4096){setError('Limite de 4096 caracteres atingido. Reduza as justificativas antes de acrescentar informações.');return;}setError('');onChange(text);}
 function model(){change({tax,items:taxTemplate(tax),notes:rule.notes});setReplace(false);}
 function item(index:number,patch:Partial<IncidenceRule['items'][number]>){change({...rule,items:rule.items.map((r,i)=>i===index?{...r,...patch}:r)});}
 function option(index:number,field:'incidence'|'exclusion',v:Choice){item(index,{[field]:v,...(v==='YES'?{[field==='incidence'?'exclusion':'incidence']:'NO'}:{})});}
 return <fieldset className='organizations-create__form'><legend>Base de incidência, exclusões e justificativa</legend>
 <p>Use um modelo e revise as escolhas para esta unidade, cenário e vigência. As justificativas e os componentes podem ser alterados.</p>
 {taxTemplate(tax).length>0?<Button type='button' variant='secondary' onClick={()=>rule.items.length?setReplace(true):model()}>Usar modelo de {tax==='COFINS'?'Cofins':tax}</Button>:null}
 {replace?<div role='alert'><p>Substituir os componentes preenchidos pelo modelo de {tax}? As observações serão mantidas.</p><Button type='button' onClick={model}>Substituir componentes</Button><Button type='button' variant='secondary' onClick={()=>setReplace(false)}>Manter componentes</Button></div>:null}
 {error?<p role='alert'>{error}</p>:null}
 {parsed&&parsed.tax!==tax?<div role='alert'><p>Este modelo pertence a {parsed.tax}. Revise os componentes para {tax} antes de salvar.</p><Button type='button' variant='secondary' onClick={()=>change({...rule,tax})}>Confirmar componentes revisados para {tax}</Button></div>:null}
 {rule.items.map((r,i)=><fieldset key={i} className='ds-card'><legend>Componente {i+1}</legend>
 <label>Componente {i+1}<input className='ds-input' required maxLength={100} value={r.component} onChange={e=>item(i,{component:e.target.value})}/></label>
 <label>Base de incidência — componente {i+1}<select className='ds-input' required value={r.incidence} onChange={e=>option(i,'incidence',e.target.value as Choice)}><option value=''>Definir</option><option value='YES'>Sim</option><option value='NO'>Não</option></select></label>
 <label>Exclusão — componente {i+1}<select className='ds-input' required value={r.exclusion} onChange={e=>option(i,'exclusion',e.target.value as Choice)}><option value=''>Definir</option><option value='YES'>Sim</option><option value='NO'>Não</option></select></label>
 <label>Justificativa — componente {i+1}<textarea className='ds-input' required maxLength={500} value={r.reason} onChange={e=>item(i,{reason:e.target.value})}/></label>
 <Button type='button' variant='secondary' onClick={()=>change({...rule,items:rule.items.filter((_,n)=>n!==i)})}>Remover componente {i+1}</Button></fieldset>)}
 <Button type='button' variant='secondary' disabled={rule.items.length>=12} onClick={()=>change({...rule,items:[...rule.items,{component:'',incidence:'',exclusion:'',reason:''}]})}>Adicionar componente</Button>
 <label>Observações e fundamentação complementar<textarea className='ds-input' required={rule.items.length===0} maxLength={4096} value={rule.notes} onChange={e=>parsed?change({...rule,notes:e.target.value}):onChange(e.target.value)}/></label>
 <p>As escolhas registram a justificativa do cadastro. Nas rubricas abaixo, vincule os parâmetros aprovados que efetivamente compõem a base de cálculo.</p>
 </fieldset>;
}
