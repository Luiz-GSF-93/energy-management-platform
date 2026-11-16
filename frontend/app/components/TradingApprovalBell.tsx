'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import EvaSymbol from './EvaSymbol';
export default function TradingApprovalBell({portal=false}:{portal?:boolean}){
 const {context,hasPermission}=useAuth(),org=context?.scope==='organization'?context.currentOrganization.id:'',identity=org+':'+context?.user.id;
 const allowed=!!org&&hasPermission('60f9690a-145b-4dba-b23f-9f945baca296');
 const [value,setValue]=useState({identity:'',approvals:0,questions:0,urgent:0});
 useEffect(()=>{setValue({identity,approvals:0,questions:0,urgent:0});if(!allowed)return;let stopped=false,busy=false;let abort:AbortController|undefined;
  const load=async()=>{if(stopped||busy||document.visibilityState==='hidden'||navigator.onLine===false)return;busy=true;abort=new AbortController();
   try{const result=await Promise.allSettled([org==='org_default'?apiRequest<any>((portal?'/api/v1/portal/trading-approvals':'/api/v1/trading-approvals')+'/tasks',{signal:abort.signal}):Promise.resolve(null),!portal?apiRequest<any>('/api/v1/trading-hub/communications/tasks',{signal:abort.signal}):Promise.resolve(null)]);
    const safe=(r:PromiseSettledResult<any>,key:string)=>r.status==='fulfilled'&&r.value?.organizationId===org&&Number.isSafeInteger(r.value[key])&&r.value[key]>=0?r.value[key]:0;
    if(!stopped)setValue({identity,approvals:safe(result[0],'count'),questions:safe(result[1],'count'),urgent:safe(result[1],'urgent')});
   }finally{busy=false;}};
  void load();const wake=()=>void load(),customer=()=>{setValue({identity,approvals:0,questions:0,urgent:0});void load();};const timer=setInterval(wake,60000);window.addEventListener('trading-updated',wake);window.addEventListener('portal-customer-changed',customer);document.addEventListener('visibilitychange',wake);
  return()=>{stopped=true;abort?.abort();clearInterval(timer);window.removeEventListener('trading-updated',wake);window.removeEventListener('portal-customer-changed',customer);document.removeEventListener('visibilitychange',wake);};
 },[allowed,identity,org,portal]);
 if(!allowed||value.identity!==identity)return null;
 return <>{value.approvals?<Link className="operation-bell" href={portal?'/portal#aprovacoes-trading':'/backoffice/trading-hub#aprovacoes'}><EvaSymbol size={24}/> EVA · {value.approvals} proposta(s) aguardando ação</Link>:null}{!portal&&value.questions?<Link className="operation-bell" href="/backoffice/trading-hub#conversas"><EvaSymbol size={24}/> Trading · {value.questions} conversa(s) aguardando resposta{value.urgent?` · ${value.urgent} urgente(s)`:''}</Link>:null}</>;
}
