'use client';
import {ReactNode,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button,LoadingState} from '@/app/components/ui';
export default function BackofficeAudience({organizationId,children}:{organizationId:string;children:ReactNode}){
 const router=useRouter(),[state,setState]=useState<'checking'|'backoffice'|'client'|'error'>('checking'),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let cancelled=false;const abort=new AbortController();apiRequest<{organizationId:string;audience:string}>('/api/v1/portal/access',{cache:'no-store',signal:abort.signal}).then(result=>{
  if(result.organizationId!==organizationId||!['client','backoffice'].includes(result.audience))throw new Error('O contexto de acesso mudou. Atualize a página.');
  if(!cancelled){if(result.audience==='client'){setState('client');router.replace('/portal');}else setState('backoffice');}
 }).catch(e=>{if(!cancelled){setError(e instanceof Error?e.message:'Não foi possível conferir seu ambiente.');setState('error');}});return()=>{cancelled=true;abort.abort();};},[organizationId,router,revision]);
 if(state==='error')return <div><Alert variant="error">{error}</Alert><Button onClick={()=>{setState('checking');setRevision(v=>v+1);}}>Conferir acesso novamente</Button></div>;
 if(state!=='backoffice')return <LoadingState title="Abrindo seu ambiente EnergyOS" description="Conferindo o vínculo de acesso da sua organização."/>;
 return <>{children}</>;
}
