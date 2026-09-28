'use client';
import {FormEvent,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Alert,Button,Input} from '@/app/components/ui';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
export const invoicePermissions={upload:'8f3ff5eb-157a-468a-91af-6f89d92e23a7',view:'8f105b02-4443-49de-b188-847e0284e7ed'};
export type InvoiceContract={id:string;customer_id:string;consumer_unit_id:string;start_date:string;end_date:string};
type InvoiceDocument={id:string;organization_id:string;customer_id:string;consumer_unit_id:string;energy_contract_id?:string|null;document_type:string;reference_month:string;original_filename:string;file_verified:boolean;created_at?:string};
export function checkInvoice(file:File,month:string,start:string,end:string){
 if(!file.size)throw Error('Selecione a nota fiscal.');
 if(file.size>10*1024*1024)throw Error('A nota deve ter no máximo 10 MB.');
 if(!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month)||month<start.slice(0,7)||month>end.slice(0,7))throw Error('Informe uma competência dentro da vigência do cadastro.');
}
export async function uploadSupplierInvoice(contract:InvoiceContract,file:File,month:string){
 checkInvoice(file,month,contract.start_date,contract.end_date);
 const body=new FormData();body.set('file',file);body.set('customerId',contract.customer_id);body.set('consumerUnitId',contract.consumer_unit_id);body.set('energyContractId',contract.id);body.set('documentType','INVOICE_SUPPLIER');body.set('referenceMonth',month+'-01');
 return apiRequest<InvoiceDocument>('/api/v1/documents/upload',{method:'POST',body});
}
export default function SupplierInvoices({contract,onDirty}:{contract:InvoiceContract;onDirty:(dirty:boolean)=>void}){
 const {context,hasPermission}=useAuth(),org=context&&context.scope!=='global'?context.currentOrganization.id:'',canView=hasPermission(invoicePermissions.view),canUpload=hasPermission(invoicePermissions.upload);
 const [rows,setRows]=useState<InvoiceDocument[]>([]),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
 const current=useRef(org+':'+contract.id),pending=useRef(false);
 useEffect(()=>{let cancelled=false;const scope=org+':'+contract.id;current.current=scope;setRows([]);setError('');setLoading(true);
 if(!org||!canView){setLoading(false);return;}
 apiRequest<InvoiceDocument[]>('/api/v1/documents').then(data=>{if(!cancelled)setRows(data.filter(d=>d.organization_id===org&&d.customer_id===contract.customer_id&&d.consumer_unit_id===contract.consumer_unit_id&&d.document_type==='INVOICE_SUPPLIER'&&(d.energy_contract_id===contract.id||!d.energy_contract_id&&d.reference_month.slice(0,7)>=contract.start_date.slice(0,7)&&d.reference_month.slice(0,7)<=contract.end_date.slice(0,7))));}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;current.current='';};
 },[org,canView,contract.id,contract.customer_id,contract.consumer_unit_id,contract.start_date,contract.end_date,attempt]);
 async function send(e:FormEvent<HTMLFormElement>){e.preventDefault();if(pending.current)return;const form=e.currentTarget,f=new FormData(form),file=f.get('file'),month=String(f.get('month')||'');if(!file||typeof file==='string'){setError('Selecione a nota fiscal.');return;}
 const scope=current.current;pending.current=true;setBusy(true);setError('');setMessage('');try{const saved=await uploadSupplierInvoice(contract,file,month);if(current.current!==scope)return;setRows(old=>[saved,...old.filter(d=>d.id!==saved.id)]);form.reset();onDirty(false);setMessage('Nota enviada, vinculada ao cadastro e armazenada em Documentos. O envio não valida o conteúdo nem aprova a apuração.');}catch(e){if(current.current===scope)setError(e instanceof Error?e.message:'Falha ao enviar a nota.');}finally{pending.current=false;if(current.current===scope)setBusy(false);}}
 async function preview(id:string){const scope=current.current,viewer=window.open('about:blank','_blank');if(!viewer){setError('Permita abrir uma nova aba para consultar a nota.');return;}viewer.opener=null;try{const r=await apiRequest<{url:string}>('/api/v1/documents/'+encodeURIComponent(id)+'/preview');if(current.current!==scope){viewer.close();return;}if(!viewer.closed)viewer.location.replace(r.url);}catch(e){viewer.close();if(current.current===scope)setError(e instanceof Error?e.message:'Nota indisponível.');}}
 if(!org||!canView)return <p>É necessária permissão de consulta de documentos para acessar as notas.</p>;
 return <section aria-label='Notas fiscais do fornecedor'><h4>Notas fiscais do fornecedor</h4><p>Arquivos privados em <Link href='/backoffice/documents'>Documentos</Link>. Novos envios ficam vinculados a este cadastro, cliente e unidade.</p>{error?<Alert variant='error'>{error}</Alert>:null}{message?<p role='status'>{message}</p>:null}<Button variant='secondary' disabled={busy||loading} onClick={()=>setAttempt(n=>n+1)}>Atualizar notas</Button>
 {loading?<p>Carregando notas...</p>:rows.length?<ul>{rows.map(d=><li key={d.id}><strong>{d.original_filename}</strong> · {d.reference_month.slice(0,7)} · {d.energy_contract_id===contract.id?'Vinculada a este cadastro':'Já armazenada na unidade, sem vínculo a este contrato'}{d.file_verified?<Button type='button' variant='secondary' onClick={()=>void preview(d.id)}>Consultar nota {d.original_filename}</Button>:<span>Arquivo ainda não verificado</span>}</li>)}</ul>:<p>Nenhuma nota disponível para este cadastro e período.</p>}
 {canUpload?<form onSubmit={send} onChange={()=>onDirty(true)}><fieldset disabled={busy}><legend>Enviar nota fiscal</legend><Input label='Competência da nota fiscal' name='month' type='month' min={contract.start_date.slice(0,7)} max={contract.end_date.slice(0,7)} defaultValue={contract.start_date.slice(0,7)===contract.end_date.slice(0,7)?contract.start_date.slice(0,7):''} required/><label>Nota fiscal — PDF, JPEG ou PNG, até 10 MB<input name='file' type='file' accept='.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png' required/></label><Button type='submit'>{busy?'Enviando nota...':'Enviar e vincular nota fiscal'}</Button></fieldset></form>:null}</section>;
}
