'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {useAuth} from '@/app/providers';
import {isOrganizationAuthContext} from '@/app/lib/auth/organization-context';
import {apiRequest} from '@/app/lib/api/client';
import type {OrganizationAuthContext,CurrentOrganizationContext} from '@/app/lib/api';
import {Alert,Button,Card} from '@/app/components/ui';
type Subscription=NonNullable<CurrentOrganizationContext['subscription']>;
export default function CoreSubscriptionBoundary({children}:{children:ReactNode}){
 const {context,logout,switchOrganization}=useAuth(),org=isOrganizationAuthContext(context)&&!context.accessMode?context.currentOrganization:null;
 const initial=org?.subscription,identity=(org?.id??'')+':'+JSON.stringify(initial??null),[value,setValue]=useState<Subscription|undefined>(initial),[error,setError]=useState(''),[busy,setBusy]=useState(false),[target,setTarget]=useState(''),currentOrg=useRef(org?.id);currentOrg.current=org?.id;
 useEffect(()=>{setValue(initial);setError('');setTarget('');setBusy(false);},[identity]);
 async function check(){if(!org)return;const id=org.id;setBusy(true);setError('');try{const r=await apiRequest<OrganizationAuthContext>('/api/v1/auth/context');if(currentOrg.current===id&&r.currentOrganization?.id===id)setValue(r.currentOrganization.subscription);}catch{if(currentOrg.current===id)setError('A consulta não foi confirmada. Sua sessão foi preservada; tente atualizar em instantes.');}finally{if(currentOrg.current===id)setBusy(false);}}
 useEffect(()=>{
  if(!org||!value?.managed)return;let cancelled=false;
  const delay=value.state==='active'?Math.max(1000,Math.min(86400000,Date.parse((value.oldestUnpaidDueOn??value.paidThrough??'')+'T00:00:00-03:00')+86400000-Date.now())):60000;
  const timer=window.setTimeout(()=>{if(!cancelled&&document.visibilityState==='visible')void check();},Number.isFinite(delay)?delay:86400000);
  return()=>{cancelled=true;window.clearTimeout(timer);};
 },[org?.id,value,busy]);
 if(!org||!value?.managed)return <>{children}</>;
 if(value.blocked)return <main className="auth-page"><Card title={org.name||'Assinatura EnergyOS'}><Alert variant="error">{value.notice||'Assinatura em atraso'}</Alert><p>O acesso da organização, de seus usuários e do Portal do cliente está suspenso. A liberação ocorrerá após a regularização ser conciliada no Asaas.</p><Button disabled={busy} onClick={()=>void check()}>{busy?'Conferindo…':'Conferir regularização'}</Button>{error&&<Alert variant="error">{error}</Alert>}{isOrganizationAuthContext(context)&&context.organizations.length>1&&<><label>Outra organização autorizada<select value={target} onChange={e=>setTarget(e.target.value)}><option value="">Selecione</option>{context.organizations.filter(o=>o.id!==org.id).map(o=><option key={o.id} value={o.id}>{o.name||o.id}</option>)}</select></label><Button disabled={!target||busy} onClick={()=>void switchOrganization(target)}>Entrar na organização selecionada</Button></>}<Button variant="secondary" onClick={logout}>Sair</Button></Card></main>;
 return <>{value.state==='grace'&&<Alert>{value.notice||'Assinatura em atraso'}{typeof value.overdueDays==='number'?' · '+value.overdueDays+' de 7 dias de tolerância.':''} Regularize para manter o acesso.</Alert>}{children}</>;
}
