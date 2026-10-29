'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest,ApiError} from '@/app/lib/api/client';
import {Button,Alert} from '@/app/components/ui';
import EvaProcessingStatus from '../../components/EvaProcessingStatus';

export default function SupplierInvoiceSetReview({plan,unitId,month,disabled,onSaved,onPlan}:{plan:any;unitId:string;month:string;disabled:boolean;onSaved:()=>void;onPlan:(p:any)=>void}){
 const draft=plan.contractDraft,source=draft.source,notes=source.invoices;
 const [busy,setBusy]=useState(false),[ack,setAck]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState<string|null>(null),[stale,setStale]=useState(false);
 const [coverage,setCoverage]=useState('FULL'),[reason,setReason]=useState('Conferi todas as notas deste conjunto e sua cobertura do faturamento da competência; valores fiscais individuais e diferença de medição preservados.'),[taxes,setTaxes]=useState<Record<string,string>>({});
 const live=useRef(true),working=useRef(false);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const query=new URLSearchParams({consumerUnitId:unitId,month}).toString();
 const extras=(plan.documentedSupplierOptions?.cost?.items??[]).filter((i:any)=>i.category==='SUPPLIER_EXTRA_ENERGY'&&!draft.consumedCostSources?.some((p:any)=>p.id===i.id));
 const unresolved=notes.filter((n:any)=>!['INCLUDED','NET_DESTINATION_ICMS'].includes(n.taxTreatment));
 async function save(){
  if(disabled||working.current||uncertain||stale||!ack||reason.trim().length<20||unresolved.some((n:any)=>!taxes[n.documentId]))return;
  working.current=true;setBusy(true);setError('');const requestId=crypto.randomUUID();let sent=false;
  try{
   const cost=plan.documentedSupplierOptions?.cost;
   const allocation={documentId:source.documentId,fileHash:source.fileHash,invoiceSetHash:source.invoiceSetHash,coverage,reason:reason.trim(),invoiceTaxes:notes.filter((n:any)=>taxes[n.documentId]||n.taxConfirmation).map((n:any)=>({documentId:n.documentId,fileHash:n.fileHash,treatment:taxes[n.documentId]??n.taxConfirmation.treatment,reason:reason.trim()})),...(coverage==='WITH_DOCUMENTED_EXTRA'&&cost?{costId:cost.id,costRevision:cost.revision,costsHash:cost.hash}:{})};
   const manual={...plan.manualOverrides,supplierSettlement:undefined,supplierPricePerMwh:undefined,supplierInvoiceAllocation:allocation};
   const preview=await apiRequest<any>('/api/v1/calculation-autofill/preview',{method:'POST',body:{consumerUnitId:unitId,month,manual}});
   if(!live.current)return;
   if(preview.unitId!==unitId||preview.month!==month||!preview.canPrepare||!preview.token||preview.contractDraft?.source?.invoiceSetHash!==source.invoiceSetHash)throw Error('O conjunto de notas mudou. Atualize as fontes antes de confirmar.');
   sent=true;const result=await apiRequest<any>('/api/v1/calculation-autofill',{method:'POST',body:{consumerUnitId:unitId,month,manual,requestId,token:preview.token}});
   if(!live.current)return;
   if(result.current?.unitId!==unitId||result.current?.month!==month||!['PREPARED','PARTIAL'].includes(result.run?.state))throw Error('Confirmação ainda não comprovada. Consulte o histórico antes de repetir.');
   onPlan(result.current);setAck(false);onSaved();
  }catch(e){if(live.current){const before=e instanceof ApiError&&e.status===409&&e.message==='Atualize as fontes antes de preparar.';if(sent&&!before)setUncertain(requestId);else setStale(true);setError(e instanceof Error?e.message:'Conferência indisponível.');}}
  finally{working.current=false;if(live.current)setBusy(false);}
 }
 async function refresh(){
  if(working.current)return;working.current=true;setBusy(true);
  try{
   if(uncertain){const history=await apiRequest<any>('/api/v1/calculation-autofill/history?'+query+'&page=0');if(!history.rows?.some((r:any)=>r.id===uncertain&&r.consumer_unit_id===unitId&&r.month===month&&['PREPARED','PARTIAL'].includes(r.state)))throw Error('A gravação ainda não está confirmada; não reenviar.');}
   const current=await apiRequest<any>('/api/v1/calculation-autofill?'+query);
   if(!live.current)return;if(current.unitId!==unitId||current.month!==month)throw Error('Fontes fora da seleção.');onPlan(current);setUncertain(null);setStale(false);setAck(false);setError('');
  }catch(e){if(live.current)setError(e instanceof Error?e.message:'Fontes indisponíveis.');}finally{working.current=false;if(live.current)setBusy(false);}
 }
 return <section aria-label='Notas do fornecedor consolidadas pela EVA' style={{minWidth:0,overflowWrap:'anywhere'}}>
  {busy?<EvaProcessingStatus floating detail='Validando o conjunto de notas e seus valores; aguarde…'/>:null}
  <h4>{notes.length} nota(s) do fornecedor · dados preenchidos pela EVA</h4>
  <p>Volume comprado: {draft.supplier.contractedMwh} MWh · soma dos valores fiscais: R$ {draft.supplier.totalAmount}. O ICMS adicional, quando devido, é calculado por nota na memória do fechamento.</p>
  <div style={{overflowX:'auto'}}><table><thead><tr><th>Nota / fonte</th><th>Volume (MWh)</th><th>Preço unitário (R$/MWh)</th><th>Valor fiscal (R$)</th><th>ICMS</th></tr></thead><tbody>{notes.map((n:any)=><tr key={n.documentId}><td>{plan.documentedSupplierOptions?.documents?.find((d:any)=>d.id===n.documentId)?.original_filename??n.documentId}<br/>{n.fiscalIdentity?.key??'Identidade fiscal a conferir no original'}</td><td>{n.quantityMwh}</td><td>{n.pricePerMwh}</td><td>{n.amount}</td><td>{n.taxTreatment==='INCLUDED'?'Já incluído · sem novo acréscimo':n.taxTreatment==='NET_DESTINATION_ICMS'?'Recolhimento no destino · por dentro':'Conferir tratamento'}</td></tr>)}</tbody></table></div>
  {!draft.requirements?.some((r:any)=>r.code==='SUPPLIER_INVOICE_SET_CONFLICT')&&source.documents.length>notes.length?<p>Cópias identificadas da mesma NF não foram somadas novamente.</p>:null}
  <p>Preço médio nominal: R$ {draft.supplier.pricePerMwh}/MWh. As bases tributárias individuais são preservadas; a média não altera os preços de cada NF.</p>
  {draft.differences?.map((d:string)=><p key={d}>{d}</p>)}
  {draft.requirements?.length?<ul>{draft.requirements.map((r:any,i:number)=><li key={i}>{r.message}</li>)}</ul>:<p role='status'>Conjunto conferido. Os valores permanecem sujeitos à aprovação financeira do fechamento.</p>}
  {error?<Alert variant='error'>{error}</Alert>:null}
  <fieldset disabled={disabled||busy||!!uncertain||stale} style={{minWidth:0}}><legend>Conferência do conjunto de notas</legend>
   {unresolved.map((n:any)=><label key={n.documentId} style={{display:'block',margin:'12px 0'}}>Tratamento fiscal da nota {plan.documentedSupplierOptions?.documents?.find((d:any)=>d.id===n.documentId)?.original_filename??n.documentId}<select style={{display:'block',width:'100%'}} value={taxes[n.documentId]??''} onChange={e=>{setTaxes({...taxes,[n.documentId]:e.target.value});setAck(false);}}><option value=''>Selecione após conferir a fonte</option><option value='INCLUDED'>Valor final com tributos incluídos</option><option value='NET_DESTINATION_ICMS'>Sem ICMS · acrescentar por dentro no destino</option></select><span>{n.taxEvidence?.source}</span></label>)}
   <label style={{display:'block',margin:'12px 0'}}>Cobertura do faturamento<select style={{display:'block',width:'100%'}} value={coverage} onChange={e=>{setCoverage(e.target.value);setAck(false);}}><option value='FULL'>Estas notas cobrem o faturamento da competência</option><option value='WITH_DOCUMENTED_EXTRA' disabled={!extras.length}>Estas notas e outra compra documentada em custos</option></select></label>
   <label style={{display:'block'}}>Justificativa e fontes da conferência<textarea style={{width:'100%',boxSizing:'border-box'}} maxLength={1000} value={reason} onChange={e=>{setReason(e.target.value);setAck(false);}}/></label>
   <label style={{display:'block',margin:'12px 0'}}><input type='checkbox' checked={ack} onChange={e=>setAck(e.target.checked)}/>Conferi as notas como documentos distintos, a cobertura e os tratamentos fiscais; a medição será preservada.</label>
   <Button disabled={!ack||reason.trim().length<20||unresolved.some((n:any)=>!taxes[n.documentId])} onClick={()=>void save()}>Confirmar conjunto e reconferir pela EVA</Button>
  </fieldset>
  {stale||uncertain?<Button disabled={busy} onClick={()=>void refresh()}>{uncertain?'Consultar confirmação da gravação':'Atualizar fontes do conjunto'}</Button>:null}
  <p>Confirmar o conjunto não aprova nem publica o fechamento. Novas notas exigem reconferência da cobertura do conjunto atualizado.</p>
 </section>;
}
