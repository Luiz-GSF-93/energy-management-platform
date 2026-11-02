 'use client';
import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
export default function AuditPresence(){const pathname=usePathname();const {context}=useAuth();const key=context?.scope==='global'?'global':context?.scope==='organization'?context.currentOrganization.id:null;
 useEffect(()=>{if(!context||!key||context.scope==='organization'&&context.currentOrganization.role==='consulta')return;const controller=new AbortController();const endpoint=context.scope==='global'?'/api/v1/admin/audit/presence':'/api/v1/audit/presence';let visit=true;const ping=()=>{if(document.visibilityState==='visible'){void apiRequest(endpoint,{method:'POST',body:{module:pathname,visit},signal:controller.signal}).catch(()=>{});visit=false;}};ping();const timer=setInterval(ping,60000);document.addEventListener('visibilitychange',ping);return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',ping);};},[key,context?.user.id,pathname,context?.scope==='organization'?context.currentOrganization.role:context?.scope]);return null;
}
