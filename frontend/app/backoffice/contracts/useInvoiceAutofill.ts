'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import type {OcrAutofill} from './ocr-autofill';

/** Read-only, tenant-authorized source lookup. Never choose between duplicate invoices. */
export function useInvoiceAutofill(customerId:string,unitId:string,month:string,accepted?:OcrAutofill){
 const key=JSON.stringify([customerId,unitId,month]);
 const matches=(p:OcrAutofill)=>p.unitId===unitId&&p.month===month;
 const supplied=accepted&&matches(accepted)?accepted:undefined;
 const [result,setResult]=useState<{key:string;proposal?:OcrAutofill;error?:string}>();
 useEffect(()=>{
  if(supplied||!customerId||!unitId||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;
  const abort=new AbortController();
  void(async()=>{try{
   const r=await apiRequest<{documents:{id:string;customer_id:string;consumer_unit_id:string;reference_month:string}[]}>('/api/v1/documents/bot-energy/context',{signal:abort.signal});
   const sources=r.documents.filter(d=>d.customer_id===customerId&&d.consumer_unit_id===unitId&&d.reference_month.slice(0,7)===month);
   if(sources.length!==1)throw Error(sources.length?'Há mais de uma fatura nesta competência. Selecione a origem em “Preencher a partir da fatura”.':'Sem fatura OCR vinculada a esta unidade e competência.');
   const p=await apiRequest<OcrAutofill>('/api/v1/documents/'+encodeURIComponent(sources[0].id)+'/ocr/assistant/autofill',{signal:abort.signal});
   if(p.documentId!==sources[0].id||!matches(p))throw Error('A origem da fatura mudou. Atualize antes de preencher.');
   if(!abort.signal.aborted)setResult({key,proposal:p});
  }catch(e){if(!abort.signal.aborted)setResult({key,error:e instanceof Error?e.message:'Leitura indisponível; confira a fatura.'});}})();
  return()=>abort.abort();
 // The result is always scoped to this identity, including late responses.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,supplied]);
 return {proposal:supplied??(result?.key===key?result.proposal:undefined),error:result?.key===key?result.error:undefined,loading:!!customerId&&!!unitId&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&!supplied&&result?.key!==key};
}
