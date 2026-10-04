'use client';
import { FormEvent, useCallback, useEffect, useState, useRef } from 'react';
import DocumentDialog from './DocumentDialog';
import DocumentCatalog,{documentTags,type CatalogDocument} from './DocumentCatalog';
import DocumentEvidenceWorkspace from '@/app/components/DocumentEvidenceWorkspace';
import OcrDocumentStatus from './OcrDocumentStatus';
import AssistantInbox from './AssistantInbox';
import {inboxScope,readInbox,writeInbox,type InboxEntry,type InboxUpdate} from './assistant-inbox';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import { useAuth } from '@/app/providers';
import { apiRequest } from '@/app/lib/api/client';

type Customer = { id: string; company_name: string };
type Unit = { id: string; customer_id: string; name?: string; consumer_unit_number: string };
type Document = CatalogDocument & {intake_state?:string;processing_status:string};
const types = [['INVOICE_DISTRIBUTOR','Fatura da distribuidora'],['INVOICE_SUPPLIER','Fatura do fornecedor'],['CONTRACT_ENERGY','Contrato de energia'],['CONTRACT_MANAGEMENT','Contrato de gestão'],['CCEE_SETTLEMENT','Liquidação CCEE'],['CCEE_CHARGES','Encargos CCEE'],['TAX_DOCUMENT','Documento fiscal'],['COMPLIANCE_REPORT','Relatório de conformidade'],['OTHER','Evidências / outros (inclui Excel e CSV)']];
const uploadPermission = '8f3ff5eb-157a-468a-91af-6f89d92e23a7';
const viewPermission = '8f105b02-4443-49de-b188-847e0284e7ed';
function DocumentsContent() {
  const { context, hasPermission } = useAuth();
  const organizationId = context && context.scope !== 'global' ? context.currentOrganization.id : '';
  const [customers,setCustomers] = useState<Customer[]>([]);
  const [units,setUnits] = useState<Unit[]>([]);
  const [documents,setDocuments] = useState<Document[]>([]);
  const [dropFile,setDropFile]=useState<File|null>(null);
  const [customer,setCustomer] = useState('');
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [attempt,setAttempt] = useState(0);
  const [inbox,setInbox]=useState<InboxEntry[]>([]),[inboxLoaded,setInboxLoaded]=useState(false);
  const [updates,setUpdates]=useState<Record<string,InboxUpdate>>({}),[activated,setActivated]=useState<string[]>([]);
  const [showUpload,setShowUpload]=useState(false),[previousDocument,setPreviousDocument]=useState<Document|null>(null),[ocrId,setOcrId]=useState(''),[uploadTag,setUploadTag]=useState('DRAFT');
  const [opened,setOpened]=useState<{id:string;request:number}|null>(null);
  const scope=inboxScope(context);
  const currentOrg = useRef(organizationId);

  const canUpload = hasPermission(uploadPermission);
  const canView = hasPermission(viewPermission);
  const canAssist=!!context&&context.scope!=='global'&&(['operacional','gestor','admin_org'].includes(context.currentOrganization.role)||context.accessMode==='platform_operation')&&hasPermission('92e1b670-ab10-483a-b825-c6e16799496d')&&hasPermission('60f9690a-145b-4dba-b23f-9f945baca296')&&canView;
  useEffect(()=>{
    let active=true;
    queueMicrotask(()=>{if(active){let saved:InboxEntry[]=[];try{saved=readInbox(window.sessionStorage,scope);}catch{/* Storage is optional. */}setInbox(saved);setInboxLoaded(true);}});
    return()=>{active=false;};
  },[scope]);
  useEffect(()=>{if(inboxLoaded){try{writeInbox(window.sessionStorage,scope,inbox);}catch{/* Storage is optional. */}}},[scope,inbox,inboxLoaded]);
  const updateAssistant=useCallback((id:string,update:InboxUpdate)=>setUpdates(old=>JSON.stringify(old[id])===JSON.stringify(update)?old:{...old,[id]:update}),[]);
  useEffect(()=>{
    if(!canAssist||!inboxLoaded)return;
    const eligible=inbox.filter(item=>documents.some(d=>d.id===item.id&&d.file_verified&&d.document_type==='INVOICE_DISTRIBUTOR'));
    const running=activated.filter(id=>eligible.some(item=>item.id===id)&&(!updates[id]||['WAITING','PREPARING'].includes(updates[id].state))).length;
    const next=eligible.filter(item=>!activated.includes(item.id)).slice(0,Math.max(0,2-running)).map(item=>item.id);
    if(next.length){let active=true;queueMicrotask(()=>{if(active)setActivated(old=>[...old,...next.filter(id=>!old.includes(id))]);});return()=>{active=false;};}
  },[canAssist,inboxLoaded,inbox,documents,activated,updates]);
  function track(id:string){setUpdates(old=>({...old,[id]:{state:'WAITING',message:'Aguardando leitura OCR e conferência automática.'}}));setInbox(old=>old.some(item=>item.id===id)?old:[...old,{id,addedAt:Date.now()}].slice(-32));}
  function remove(id:string){setInbox(old=>old.filter(item=>item.id!==id));setActivated(old=>old.filter(value=>value!==id));setOpened(old=>old?.id===id?null:old);}
  useEffect(() => {
    let cancelled=false;
    currentOrg.current = organizationId;
    if (!organizationId || !canView) return;
    apiRequest<{documents:Document[];customers:Customer[];units:Unit[]}>('/api/v1/document-catalog').then(({documents:d,customers:c,units:u})=>{if(!Array.isArray(d)||!Array.isArray(c)||!Array.isArray(u))throw new Error('Resposta do catálogo indisponível. Nenhum conjunto parcial foi exibido.');if(!cancelled){setDocuments(d);setCustomers(c);setUnits(u);}})
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Não foi possível carregar os dados. Tente novamente.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled=true; currentOrg.current=''; };
  },[organizationId,canUpload,canView,attempt]);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form=event.currentTarget; const data=new FormData(form); const file=dropFile??data.get('file');if(dropFile)data.set('file',dropFile);
    if (!(file instanceof File) || !file.size) { setError('Selecione um arquivo.'); return; }
    if (file.size>10*1024*1024) { setError('O arquivo deve ter no máximo 10 MB.'); return; }
    data.set('referenceMonth',String(data.get('referenceMonth'))+'-01');
    if(previousDocument){data.set('previousDocumentId',previousDocument.id);data.set('customerId',previousDocument.customer_id);data.set('consumerUnitId',previousDocument.consumer_unit_id);data.set('referenceMonth',previousDocument.reference_month.slice(0,7)+'-01');data.set('documentType',previousDocument.document_type);}
    const requestedTag=String(data.get('catalogTag')??(previousDocument?'REVIEWED':'DRAFT')),tagReason=String(data.get('catalogReason')??''),tagChecked=data.get('catalogChecked')==='on';data.delete('catalogTag');data.delete('catalogReason');data.delete('catalogChecked');
    const org=organizationId;setBusy(true);setError('');setNotice('');
    try {
      const saved=await apiRequest<Document>('/api/v1/documents/upload',{method:'POST',body:data});
      if (currentOrg.current!==org) return;
      let ocrNotice='';let classificationNotice='';
      if(requestedTag!==(previousDocument?'REVIEWED':'DRAFT')){try{await apiRequest('/api/v1/document-catalog/'+encodeURIComponent(saved.id),{method:'PUT',body:{revision:1,tag:requestedTag,reason:tagReason,checkedDocument:tagChecked}});classificationNotice=' Classificação documental salva.';}catch{classificationNotice=' Arquivo salvo; classificação não confirmada. Consulte o registro na biblioteca antes de tentar novamente.';}}
      if(saved.document_type==='INVOICE_DISTRIBUTOR'&&saved.file_verified&&hasPermission('92e1b670-ab10-483a-b825-c6e16799496d')){
        try{await apiRequest('/api/v1/documents/'+encodeURIComponent(saved.id)+'/ocr',{method:'POST'});ocrNotice=' Leitura OCR iniciada automaticamente. O andamento será atualizado nesta tela.';}
        catch{ocrNotice=' O arquivo foi salvo, mas não foi possível iniciar o OCR automaticamente. Consulte a leitura para verificar a disponibilidade.';}
      }
      if(currentOrg.current!==org)return;
      if(saved.document_type==='INVOICE_DISTRIBUTOR'&&saved.file_verified&&canAssist)track(saved.id);
      setAttempt(n=>n+1);setDropFile(null);form.reset();setCustomer('');setShowUpload(false);setPreviousDocument(null);setNotice(classificationNotice+(ocrNotice||(saved.document_type==='INVOICE_DISTRIBUTOR'?'Fatura recebida em quarentena, sem liberação para apuração. A conferência do conteúdo ainda é necessária.':'Arquivo enviado e armazenado com acesso privado.')));
    } catch (e) { if (currentOrg.current===org) setError(e instanceof Error ? e.message : 'Não foi possível enviar o arquivo.'); }
    finally { setBusy(false); }
  }
  async function preview(id: string) {
    const org=organizationId;setError('');
    const viewer=window.open('about:blank','_blank');
    if (!viewer) { setError('Permita abrir uma nova aba para visualizar o documento.'); return; }
    viewer.opener=null;
    viewer.document.title='Carregando documento — Expert Energy';
    try {
      const result=await apiRequest<{url:string}>('/api/v1/documents/'+encodeURIComponent(id)+'/preview');
      if (currentOrg.current!==org) { viewer.close(); return; }
      if (!viewer.closed) viewer.location.replace(result.url);
    } catch (e) {
      viewer.close();
      if (currentOrg.current===org) setError(e instanceof Error ? e.message : 'Não foi possível visualizar o arquivo.');
    }
  }
  async function download(id: string) {
    const org=organizationId;setError('');
    try {
      const result=await apiRequest<{url:string}>('/api/v1/documents/'+encodeURIComponent(id)+'/download');
      if (currentOrg.current===org) { const link=document.createElement('a');link.href=result.url;link.rel='noopener noreferrer';link.click(); }
    } catch (e) { if (currentOrg.current===org) setError(e instanceof Error ? e.message : 'Arquivo indisponível.'); }
  }
  if (!organizationId || !canView) return <p role="alert">Selecione uma organização com permissão para consultar documentos.</p>;
  return <section className="backoffice-page">
    <header className="backoffice-page__header"><h1 className="backoffice-page__title">Documentos</h1><p>Gerencie faturas, contratos, notas e modelos por cliente, unidade, classificação e versão.</p></header>
    {error && <div><p role="alert">{error}</p><button type="button" disabled={busy} onClick={()=>{setError('');setAttempt(n=>n+1);}}>Tentar carregar novamente</button></div>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Carregando documentos…</p> : <>
      <DocumentCatalog documents={documents} types={types} canUpload={canUpload} canEdit={hasPermission('613b71d0-67db-4761-9e11-61fdf63ac8d5')} canApprove={!!context&&context.scope!=='global'&&(['gestor','admin_org'].includes(context.currentOrganization.role)||context.accessMode==='platform_operation')} onNew={()=>{setDropFile(null);setError('');setPreviousDocument(null);setUploadTag('DRAFT');setCustomer('');setShowUpload(true);}} onVersion={d=>{setDropFile(null);setError('');setPreviousDocument(d as Document);setUploadTag('REVIEWED');setCustomer(d.customer_id);setShowUpload(true);}} onReload={()=>setAttempt(n=>n+1)} onPreview={id=>void preview(id)} onDownload={id=>void download(id)} onOcr={id=>{if(canAssist&&!inbox.some(v=>v.id===id))track(id);setOcrId(id);setOpened(old=>({id,request:(old?.request??0)+1}));}}/>
      {canUpload && showUpload && <DocumentDialog label="Inserir documento" busy={busy} onClose={()=>setShowUpload(false)}><button disabled={busy} onClick={()=>setShowUpload(false)} autoFocus>Fechar cadastro</button><form key={organizationId} onInvalidCapture={e=>{let d=(e.target as HTMLElement).closest('details');while(d){d.open=true;d=d.parentElement?.closest('details')??null;}}} onSubmit={send} style={{display:'grid',gap:16,maxWidth:680,padding:24,border:'1px solid var(--color-border)',borderRadius:12,background:'var(--color-surface)',color:'var(--color-text)'}}>
        <h2>{previousDocument?'Nova versão de '+previousDocument.original_filename:'Inserir novo documento'}</h2>{error?<p role="alert">{error}</p>:null}{previousDocument?<p>O sistema mantém cliente, unidade, tipo e competência da versão original e atribui a próxima versão. O retorno começa como Revisado, sem aprovação financeira.</p>:null}<details open><summary>1. Cliente, unidade e competência</summary>
        <p>Selecione o cliente, a unidade e o mês de referência da fatura. Após o envio, somente a fatura de energia da distribuidora segue para OCR e bot-energy. A leitura é iniciada automaticamente quando habilitada e permitida. A integração depende das validações do conteúdo e do cadastro.</p>
        <label>Cliente<select name="customerId" required value={customer} disabled={busy||!!previousDocument} onChange={e=>setCustomer(e.target.value)} style={{display:'block',width:'100%',padding:10}}><option value="">Selecione</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
        <label>Unidade consumidora<select key={customer+(previousDocument?.id??'')} name="consumerUnitId" required disabled={busy || !customer || !!previousDocument} defaultValue={previousDocument?.consumer_unit_id??''} style={{display:'block',width:'100%',padding:10}}><option value="">Selecione</option>{units.filter(u=>u.customer_id===customer).map(u=><option key={u.id} value={u.id}>{u.name || u.consumer_unit_number} — {u.consumer_unit_number}</option>)}</select></label>
        <label>Competência<input name="referenceMonth" type="month" required defaultValue={previousDocument?.reference_month.slice(0,7)} disabled={busy||!!previousDocument} style={{display:'block',padding:10}} /></label>
        </details><details><summary>2. Arquivo e descrição</summary><label>Tipo de documento<select name="documentType" required defaultValue={previousDocument?.document_type} disabled={busy||!!previousDocument} style={{display:'block',width:'100%',padding:10}}>{types.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <div className="evidence-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy){if(e.dataTransfer.files.length!==1)setError('Envie um arquivo por cadastro.');else setDropFile(e.dataTransfer.files[0]);}}}><p>Arraste e solte o arquivo. Documentos diversos aceitam PDF, JPEG, PNG, CSV UTF-8 e Excel XLSX sem macros. Faturas fiscais aceitam PDF e imagens. Apenas fatura da distribuidora entra no OCR.</p><label>Arquivo — até 10 MB<input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx" required={!dropFile} disabled={busy} onChange={()=>setDropFile(null)} style={{display:'block',padding:10}} /></label>{dropFile?<p>{dropFile.name} <button type="button" onClick={()=>setDropFile(null)}>Retirar arquivo</button></p>:null}</div>
        <label>Descrição (opcional)<textarea name="description" maxLength={4096} disabled={busy} style={{display:'block',width:'100%',padding:10}} /></label>
        </details><details open><summary>3. Conferir e enviar</summary><label>Tag inicial<select className="ds-input" name="catalogTag" value={uploadTag} disabled={busy||!hasPermission('613b71d0-67db-4761-9e11-61fdf63ac8d5')} onChange={e=>setUploadTag(e.target.value)}>{documentTags.filter(([v])=>['DRAFT','MODEL','SIGNING','REVIEWED'].includes(v)).map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>{uploadTag!==(previousDocument?'REVIEWED':'DRAFT')?<><label>Motivo da classificação<textarea name="catalogReason" className="ds-input" minLength={20} maxLength={1000} required disabled={busy}/></label><label><input type="checkbox" name="catalogChecked" required disabled={busy}/> Conferi o arquivo e a classificação documental escolhida.</label></>:null}<p>O arquivo fica privado e recebe a tag Rascunho (ou Revisado no retorno). Classifique-o na biblioteca após conferir. A classificação não o disponibiliza automaticamente ao cliente.</p><button type="submit" disabled={busy || !customer} style={{padding:12,background:'var(--color-primary)',color:'white',borderRadius:8}}>{busy?'Enviando…':'Enviar arquivo'}</button></details>
      </form></DocumentDialog>}
      {Object.values(['cb949e2a-e01d-4cf0-8c69-6ca74fe4d627','1479c0b7-9608-4e95-bd83-7e6899255a78','489e6387-d5fc-4cb0-81f9-d7a76269dca5']).some(hasPermission)?<DocumentEvidenceWorkspace hasPermission={hasPermission} documents={documents} canUpload={canUpload}/>:null}
      {canAssist&&inbox.length>0&&<details className="operation-panel"><summary>Fila bot-energy ({inbox.length})</summary><AssistantInbox items={inbox.flatMap(item=>{const d=documents.find(d=>d.id===item.id&&d.file_verified&&d.document_type==='INVOICE_DISTRIBUTOR');return d?[{id:d.id,name:d.original_filename,month:d.reference_month.slice(0,7),update:updates[d.id]}]:[];})} onOpen={id=>{setOcrId(id);setOpened(old=>({id,request:(old?.request??0)+1}));}} onRemove={remove}/></details>}
      {documents.filter(d=>d.file_verified&&d.document_type==='INVOICE_DISTRIBUTOR').map(d=><section key={organizationId+':'+d.id} hidden={ocrId!==d.id} className="operation-panel" aria-label={'OCR · '+d.original_filename}><header><h2>{d.original_filename} · OCR e bot-energy</h2><button onClick={()=>setOcrId('')}>Recolher conferência</button></header><OcrDocumentStatus id={d.id} autoAssist={canAssist&&activated.includes(d.id)} openRequest={opened?.id===d.id?opened.request:0} onAssistantUpdate={updateAssistant} canProcess={hasPermission('92e1b670-ab10-483a-b825-c6e16799496d')}/></section>)}
    </>}
  </section>;
}
export default function DocumentsPage() { const {context}=useAuth(); const key=inboxScope(context)||'none'; return <ProtectedRoute><BackofficeShell><DocumentsContent key={key} /></BackofficeShell></ProtectedRoute>; }
