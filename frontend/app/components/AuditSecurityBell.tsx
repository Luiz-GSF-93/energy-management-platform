 'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Bell} from 'lucide-react';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
export default function AuditSecurityBell(){const {context,hasPermission}=useAuth();const global=context?.scope==='global';const permission=global?'dbb580ca-d940-4e80-97fb-e9f9619a0004':'dbb580ca-d940-4e80-97fb-e9f9619a0001';const allowed=hasPermission(permission);const [count,setCount]=useState<number|null>(null);useEffect(()=>{setCount(null);if(!allowed)return;const c=new AbortController();let busy=false;const read=()=>{if(document.visibilityState!=='visible'||busy)return;busy=true;void apiRequest<{openAlertCount:number}>((global?'/api/v1/admin/audit':'/api/v1/audit')+'/alert-count',{signal:c.signal}).then(d=>{if(!c.signal.aborted)setCount(d.openAlertCount);}).catch(()=>{if(!c.signal.aborted)setCount(null);}).finally(()=>{busy=false;});};read();const timer=setInterval(read,60000);return()=>{c.abort();clearInterval(timer);};},[allowed,global,context?.user.id,context?.scope==='organization'?context.currentOrganization.id:'global']);return allowed&&count!==null?<Link className="operation-bell" href={global?'/backoffice/platform-audit':'/backoffice/audit'}><Bell size={18}/>{count} alertas de auditoria</Link>:null;}
