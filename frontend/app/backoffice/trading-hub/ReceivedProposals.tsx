'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button} from '@/app/components/ui';
export default function ReceivedProposals({opportunityId,rows,invitations,onDone,onClose}:{opportunityId:string;rows:any[];invitations:any[];onDone:()=>void;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null),lock=useRef(false),intent=useRef(new Map<string,string>());const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const received=rows.filter(p=>p.parent_id===opportunityId&&p.kind==='proposal'&&['RECEIVED','ANALYSIS'].includes(p.status)&&invitations.some(i=>i.opportunity_id===opportunityId&&i.supplier_id===p.data.supplierId&&i.state==='RESPONDED'));
 useEffect(()=>{ref.current?.showModal();},[]);
 async function register(p:any){if(lock.current)return;lock.current=true;setBusy(true);setError('');const requestId=intent.current.get(p.id)??crypto.randomUUID();intent.current.set(p.id,requestId);
  try{await apiRequest('/api/v1/trading-approvals/'+p.id+'/action',{method:'POST',body:{action:'REGISTER',revision:p.revision,requestId,reason:'Resposta recebida conferida e vinculada à proposta existente.',data:{}}});onDone();onClose();}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}
 }
 return <dialog ref={ref} aria-label="Registrar proposta recebida" onCancel={e=>{e.preventDefault();if(!busy)onClose();}} style={{width:'min(1000px,94vw)',maxHeight:'90vh',overflow:'auto'}}><h2>Respostas dos fornecedores · registrar proposta</h2><p>Selecione uma resposta com status Respondida. A validação aproveita a proposta existente; não cria outra cotação ou duplica valores.</p>{error?<Alert variant="error">{error}</Alert>:null}{received.length===0?<p>Nenhuma resposta pendente deste recorte. Consulte as propostas já registradas em Acompanhamento de aprovação das propostas.</p>:received.map(p=><article className="ds-card" key={p.id}><h3>Respondida · {p.id}</h3><p>Preço: R$ {Number(p.data.priceBrlMwh).toLocaleString('pt-BR')}/MWh · validade: {p.data.validUntil}</p><p>{p.data.conditions}</p><p>Flexibilidade: {p.data.flexibility} · modulação: {p.data.modulation} · garantias: {p.data.guarantees}</p><Button disabled={busy} onClick={()=>void register(p)}>Conferir e registrar esta proposta</Button></article>)}<Button variant="secondary" disabled={busy} onClick={onClose}>Fechar</Button></dialog>;
}
