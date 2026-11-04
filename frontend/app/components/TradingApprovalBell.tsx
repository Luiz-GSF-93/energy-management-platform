'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import EvaSymbol from './EvaSymbol';
export default function TradingApprovalBell({portal=false}:{portal?:boolean}){
 const {context,hasPermission}=useAuth();const org=context?.scope==='organization'?context.currentOrganization.id:'';const [count,setCount]=useState(0);const user=context?.user.id;
 const allowed=org==='org_default'&&hasPermission('60f9690a-145b-4dba-b23f-9f945baca296');
 useEffect(()=>{setCount(0);if(!allowed)return;let stop=false;const load=async()=>{if(document.visibilityState==='hidden')return;try{const r:any=await apiRequest((portal?'/api/v1/portal/trading-approvals':'/api/v1/trading-approvals')+'/tasks');if(!stop&&r.organizationId===org&&Number.isInteger(r.count))setCount(r.count);}catch{if(!stop)setCount(0);}};void load();const timer=setInterval(()=>void load(),60000);window.addEventListener('trading-updated',load);window.addEventListener('portal-customer-changed',load);return()=>{stop=true;clearInterval(timer);window.removeEventListener('trading-updated',load);window.removeEventListener('portal-customer-changed',load);};},[allowed,org,user,portal]);
 if(!allowed||!count)return null;return <Link className="operation-bell" href={portal?'/portal#aprovacoes-trading':'/backoffice/trading-hub#aprovacoes'}><EvaSymbol size={24}/> EVA · {count} proposta(s) aguardando ação</Link>;
}
