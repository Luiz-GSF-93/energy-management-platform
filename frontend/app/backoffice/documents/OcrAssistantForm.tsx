'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {useAuth} from '@/app/providers';
import {Customer,Unit} from '../contracts/types';
import {ocrNavigationContext,type OcrDestination} from '../contracts/ocr-navigation';
import type {CorrectionContext} from '../contracts/preparation-navigation';
import Distributor from '../contracts/Distributor';
import SupplyContracts from '../contracts/SupplyContracts';
import CommercialTerms from '../contracts/CommercialTerms';
import CalculationParameters from '../contracts/CalculationParameters';
import MonthlyInputs from '../contracts/MonthlyInputs';
import MonthlyCosts from '../contracts/MonthlyCosts';
import type {OcrAutofill} from '../contracts/ocr-autofill';

export default function OcrAssistantForm({id,area,onClose}:{id:string;area:OcrDestination;onClose:()=>void}){
 const {hasPermission}=useAuth();
 const [data,setData]=useState<{context:CorrectionContext;customers:Customer[];units:Unit[];autofill:OcrAutofill}|null>(null),[error,setError]=useState(''),[dirty,setDirty]=useState(false),[confirm,setConfirm]=useState(false);
 useEffect(()=>{let active=true;
  Promise.all([apiRequest<Customer[]>('/api/v1/customers'),apiRequest<Unit[]>('/api/v1/consumer-units'),apiRequest<{documentId:string;customerId:string;unitId:string;month:string}>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/calculation-context'),apiRequest<OcrAutofill>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/assistant/autofill')])
   .then(([customers,units,context,autofill])=>{if(active)setData({customers,units,autofill,context:ocrNavigationContext({id,tab:area},context,customers,units)});})
   .catch(e=>{if(active)setError(e instanceof Error?e.message:'Não foi possível carregar o formulário da unidade.');});
  return()=>{active=false;};
 },[id,area]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 return <section aria-label="Completar informações no assistente" style={{border:'1px solid #405873',borderRadius:12,padding:16}}>
  <button type="button" onClick={()=>dirty?setConfirm(true):onClose()}>Voltar à conferência</button>
  {confirm&&<div role="alert"><p>Há preenchimentos não salvos. Salve no formulário ou descarte antes de voltar.</p><button onClick={()=>setConfirm(false)}>Continuar preenchendo</button><button onClick={onClose}>Descartar preenchimentos e voltar</button></div>}
  {error?<p role="alert">{error}</p>:!data?<p role="status">Carregando formulário, unidade e competência…</p>:<>
   <p>{data.units.find(u=>u.id===data.context.unitId)?.name} · {data.context.month}. Salvar rascunho não aprova financeiramente.</p>
   {area==='distributor'&&<Distributor customers={data.customers} units={data.units} customerId={data.context.customerId} initialContext={data.context} onDirty={setDirty} onUnits={units=>setData(previous=>previous?{...previous,units}:null)}/>}
   {area==='supply'&&<SupplyContracts customerId={data.context.customerId} initialContext={data.context} onDirty={setDirty}/>}
   {area==='management'&&<CommercialTerms kind="management" customerId={data.context.customerId} units={data.units} customers={data.customers} initialContext={data.context} onDirty={setDirty}/>}
   {area==='parameters'&&<CalculationParameters customerId={data.context.customerId} units={data.units} initialContext={data.context} autofill={data.autofill} onDirty={setDirty}/>}
   {area==='monthly'&&<MonthlyInputs customerId={data.context.customerId} units={data.units} initialContext={data.context} autofill={data.autofill} onDirty={setDirty}/>}
   {area==='costs'&&<MonthlyCosts customerId={data.context.customerId} units={data.units} initialContext={data.context} autofill={data.autofill} onDirty={setDirty}/>}
   {!hasPermission('60f9690a-145b-4dba-b23f-9f945baca296')&&<p role="alert">Sem permissão para consultar contratos.</p>}
  </>}
 </section>;
}
