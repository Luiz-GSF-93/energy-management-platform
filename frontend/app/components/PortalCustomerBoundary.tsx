'use client';
import {ReactNode,useEffect,useState} from 'react';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import {portalSelection,selectPortalCustomer} from '@/app/lib/auth/portal-customer';
import {Alert,Button} from './ui';
type Choices={enabled:boolean;organizationId?:string;customerId?:string;customers?:{id:string;name:string}[]};
export default function PortalCustomerBoundary({children}:{children:ReactNode}){
 const {context}=useAuth(),org=context?.scope==='organization'?context.currentOrganization.id:'',user=context?.user.id??'';
 const [scope,setScope]=useState<Choices|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let live=true;const abort=new AbortController();setScope(null);setError('');
  apiRequest<Choices>('/api/v1/portal/customers',{cache:'no-store',signal:abort.signal}).then(r=>{
   if(!live)return;if(typeof r.enabled!=='boolean'||r.enabled&&(r.organizationId!==org||!Array.isArray(r.customers)||!r.customers.length||!r.customers.some(c=>c.id===r.customerId)))throw Error('Não foi possível confirmar os clientes autorizados.');
   const old=portalSelection(),id=r.enabled?(old?.organizationId===org&&old.userId===user&&r.customers!.some(c=>c.id===old.customerId)?old.customerId:r.customerId!):'';
   selectPortalCustomer(id?{organizationId:org,userId:user,customerId:id}:null);setSelected(id);setScope(r);
  }).catch(e=>{if(live)setError(e instanceof Error?e.message:'Acesso ao Portal indisponível.');});
  return()=>{live=false;abort.abort();};
 },[org,user,attempt]);
 useEffect(()=>{const deny=()=>{setScope(null);setAttempt(v=>v+1);};window.addEventListener('portal-scope-denied',deny);return()=>window.removeEventListener('portal-scope-denied',deny);},[]);
 if(error)return <Alert variant="error">{error}<Button onClick={()=>setAttempt(v=>v+1)}>Atualizar acessos</Button></Alert>;
 if(!scope)return <p role="status">Conferindo clientes e unidades autorizados…</p>;
 return <>{scope.enabled?<div className="ds-card" style={{margin:16,padding:16}}><label>Empresa no Portal<select className="ds-input" aria-label="Empresa no Portal" value={selected} onChange={e=>{const id=e.target.value;if(!scope.customers?.some(c=>c.id===id))return;selectPortalCustomer({organizationId:org,userId:user,customerId:id});setSelected(id);}}>{scope.customers!.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><p>Somente as unidades autorizadas pela gestão aparecem nos dados e filtros.</p><Button variant="secondary" onClick={()=>setAttempt(v=>v+1)}>Atualizar acessos</Button></div>:null}<div key={org+'|'+user+'|'+selected+'|'+attempt}>{children}</div></>;
}
