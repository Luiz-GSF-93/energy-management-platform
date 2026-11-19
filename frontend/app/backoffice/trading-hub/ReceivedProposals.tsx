'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button} from '@/app/components/ui';
import TradingAttachments from './TradingAttachments';
import {CommercialTermsSummary} from '@/app/components/TradingCommercialTerms';
import {UnitOffersSummary} from '@/app/components/TradingSupplyFields';
import {validityLabel} from '@/app/lib/trading-supply';
export default function ReceivedProposals({opportunityId,rows,invitations,onDone,onClose}:{opportunityId:string;rows:any[];invitations:any[];onDone:()=>void;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null),lock=useRef(false),intent=useRef(new Map<string,string>());const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const opportunity=rows.find(o=>o.id===opportunityId);
 const received=rows.filter(p=>p.parent_id===opportunityId&&p.kind==='proposal'&&['RECEIVED','ANALYSIS'].includes(p.status)&&invitations.some(i=>i.opportunity_id===opportunityId&&i.supplier_id===p.data.supplierId&&i.state==='RESPONDED'));
 useEffect(()=>{ref.current?.showModal();},[]);
 async function register(p:any){if(lock.current)return;lock.current=true;setBusy(true);setError('');const requestId=intent.current.get(p.id)??crypto.randomUUID();intent.current.set(p.id,requestId);
  try{await apiRequest('/api/v1/trading-approvals/'+p.id+'/action',{method:'POST',body:{action:'REGISTER',revision:p.revision,requestId,reason:'Resposta recebida conferida e vinculada à proposta existente.',data:{}}});onDone();onClose();}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}
 }
 return <dialog ref={ref} aria-label="Registrar proposta recebida" onCancel={e=>{e.preventDefault();if(!busy)onClose();}} style={{width:'min(1000px,94vw)',maxHeight:'90vh',overflow:'auto'}}><h2>{opportunity?.data.title} · respostas dos fornecedores</h2><p>Cotação: {opportunityId}</p><p>Selecione uma resposta com status Respondida. A validação aproveita a proposta existente; não cria outra cotação ou duplica valores.</p>{error?<Alert variant="error">{error}</Alert>:null}{received.length===0?<p>Nenhuma resposta pendente deste recorte. Consulte as propostas já registradas em Acompanhamento de aprovação das propostas.</p>:received.map(p=><article className="ds-card" key={p.id}><h3>{rows.find(s=>s.kind==='supplier'&&s.id===p.data.supplierId)?.data.tradeName??'Fornecedor'} · Respondida</h3><p>Proposta: {p.id}</p><p>Preço: R$ {Number(p.data.priceBrlMwh).toLocaleString('pt-BR')}/MWh · validade: {validityLabel(p.data.validUntil)}</p><UnitOffersSummary data={p.data} opportunity={opportunity?.data}/><p>{p.data.conditions}</p><CommercialTermsSummary data={p.data}/><TradingAttachments proposal={p} context={(opportunity?.data.title??'Cotação')+' · '+opportunityId.slice(0,8)}/><p>Flexibilidade: {p.data.flexibility} · modulação: {p.data.modulation} · garantias: {p.data.guarantees}</p><Button disabled={busy} onClick={()=>void register(p)}>Conferir e registrar esta proposta</Button></article>)}<Button variant="secondary" disabled={busy} onClick={onClose}>Fechar</Button></dialog>;
}
