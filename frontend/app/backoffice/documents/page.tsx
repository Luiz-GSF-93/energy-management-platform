'use client';
import { FormEvent, useEffect, useState, useRef } from 'react';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import { useAuth } from '@/app/providers';
import { apiRequest } from '@/app/lib/api/client';

type Customer = { id: string; company_name: string };
type Unit = { id: string; customer_id: string; name?: string; consumer_unit_number: string };
type Document = { id: string; original_filename: string; reference_month: string; file_verified: boolean; processing_status: string };
const types = [['INVOICE_DISTRIBUTOR','Fatura da distribuidora'],['INVOICE_SUPPLIER','Fatura do fornecedor'],['CONTRACT_ENERGY','Contrato de energia'],['CONTRACT_MANAGEMENT','Contrato de gestão'],['CCEE_SETTLEMENT','Liquidação CCEE'],['CCEE_CHARGES','Encargos CCEE'],['TAX_DOCUMENT','Documento fiscal'],['COMPLIANCE_REPORT','Relatório de conformidade'],['OTHER','Outro']];
const uploadPermission = '8f3ff5eb-157a-468a-91af-6f89d92e23a7';
const viewPermission = '8f105b02-4443-49de-b188-847e0284e7ed';
function DocumentsContent() {
  const { context, hasPermission } = useAuth();
  const organizationId = context && context.scope !== 'global' ? context.currentOrganization.id : '';
  const [customers,setCustomers] = useState<Customer[]>([]);
  const [units,setUnits] = useState<Unit[]>([]);
  const [documents,setDocuments] = useState<Document[]>([]);
  const [customer,setCustomer] = useState('');
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const currentOrg = useRef(organizationId);

  const canUpload = hasPermission(uploadPermission);
  const canView = hasPermission(viewPermission);
  useEffect(() => {
    let cancelled=false;
    currentOrg.current = organizationId;
    if (!organizationId || !canView) return;
    Promise.all([
      apiRequest<Document[]>('/api/v1/documents'),
      canUpload ? apiRequest<Customer[]>('/api/v1/customers') : Promise.resolve([]),
      canUpload ? apiRequest<Unit[]>('/api/v1/consumer-units') : Promise.resolve([]),
    ]).then(([d,c,u]) => { if (!cancelled) { setDocuments(d);setCustomers(c);setUnits(u); } })
      .catch(() => { if (!cancelled) setError('Não foi possível carregar os dados. Verifique sua licença e as permissões de documentos, clientes e unidades.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled=true; currentOrg.current=''; };
  },[organizationId,canUpload,canView]);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form=event.currentTarget; const data=new FormData(form); const file=data.get('file');
    if (!(file instanceof File) || !file.size) { setError('Selecione um arquivo.'); return; }
    if (file.size>10*1024*1024) { setError('O arquivo deve ter no máximo 10 MB.'); return; }
    data.set('referenceMonth',String(data.get('referenceMonth'))+'-01');
    const org=organizationId;setBusy(true);setError('');setNotice('');
    try {
      const saved=await apiRequest<Document>('/api/v1/documents/upload',{method:'POST',body:data});
      if (currentOrg.current!==org) return;
      setDocuments(old=>[saved,...old]);form.reset();setCustomer('');setNotice('Arquivo enviado e armazenado com acesso privado. A leitura automática ainda não está disponível.');
    } catch (e) { if (currentOrg.current===org) setError(e instanceof Error ? e.message : 'Não foi possível enviar o arquivo.'); }
    finally { setBusy(false); }
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
    <header className="backoffice-page__header"><h1 className="backoffice-page__title">Documentos</h1><p>Envie faturas e documentos para a unidade consumidora. Os arquivos ficam privados.</p></header>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Carregando documentos…</p> : <>
      {canUpload && <form key={organizationId} onSubmit={send} style={{display:'grid',gap:16,maxWidth:680,padding:24,border:'1px solid #dbe3ec',borderRadius:12,background:'white'}}>
        <h2>Enviar documento</h2>
        <label>Cliente<select name="customerId" required value={customer} disabled={busy} onChange={e=>setCustomer(e.target.value)} style={{display:'block',width:'100%',padding:10}}><option value="">Selecione</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
        <label>Unidade consumidora<select key={customer} name="consumerUnitId" required disabled={busy || !customer} defaultValue="" style={{display:'block',width:'100%',padding:10}}><option value="">Selecione</option>{units.filter(u=>u.customer_id===customer).map(u=><option key={u.id} value={u.id}>{u.name || u.consumer_unit_number} — {u.consumer_unit_number}</option>)}</select></label>
        <label>Competência<input name="referenceMonth" type="month" required disabled={busy} style={{display:'block',padding:10}} /></label>
        <label>Tipo de documento<select name="documentType" required disabled={busy} style={{display:'block',width:'100%',padding:10}}>{types.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Arquivo — PDF, JPEG ou PNG, até 10 MB<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required disabled={busy} style={{display:'block',padding:10}} /></label>
        <label>Descrição (opcional)<textarea name="description" maxLength={4096} disabled={busy} style={{display:'block',width:'100%',padding:10}} /></label>
        <button type="submit" disabled={busy || !customer} style={{padding:12,background:'#123c66',color:'white',borderRadius:8}}>{busy?'Enviando…':'Enviar arquivo'}</button>
      </form>}
      <h2>Arquivos cadastrados</h2>
      {!documents.length ? <p>Nenhum documento cadastrado.</p> : <div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left',borderSpacing:'0 16px'}}><thead><tr><th>Arquivo</th><th>Competência</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{documents.map(d=><tr key={d.id}><td>{d.original_filename}</td><td>{d.reference_month.slice(0,7)}</td><td>{d.file_verified?'Arquivo recebido':'Cadastro sem arquivo verificado'}</td><td>{d.file_verified && <button type="button" onClick={()=>void download(d.id)}>Baixar</button>}</td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}
export default function DocumentsPage() { const {context}=useAuth(); const key=context && context.scope!=='global' ? context.currentOrganization.id : 'none'; return <ProtectedRoute><BackofficeShell><DocumentsContent key={key} /></BackofficeShell></ProtectedRoute>; }
