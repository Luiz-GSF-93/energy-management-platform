'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {apiRequest} from '@/app/lib/api/client';
import {Button} from './ui/Button';
type Reminder={key:string;title:string;deadline:string;days:number;source:string;href:string};
type Agenda={organizationId:string;reminders:Reminder[];disclosure:string};
export default function BotEnergyAgenda({organizationId}:{organizationId:string}){
 const [data,setData]=useState<Agenda|null>(null),[error,setError]=useState(false),[open,setOpen]=useState(false);
 useEffect(()=>{
  const abort=new AbortController();let current=0;
  const load=async()=>{const generation=++current;try{const result=await apiRequest<Agenda>('/api/v1/documents/bot-energy/agenda',{signal:abort.signal});if(!abort.signal.aborted&&generation===current){if(result.organizationId!==organizationId)throw new Error('Escopo inválido');setData(result);setError(false);}}catch{if(!abort.signal.aborted&&generation===current){setData(null);setError(true);}}};
  void load();const timer=setInterval(()=>void load(),300000);const refresh=()=>void load();window.addEventListener('operations-updated',refresh);
  return()=>{abort.abort();clearInterval(timer);window.removeEventListener('operations-updated',refresh);};
 },[organizationId]);
 if(!error&&!data?.reminders.length)return null;
 return <section aria-label="Avisos de agenda Bot-Energy" style={{width:320,maxWidth:'calc(100vw - 32px)',background:'#101b2c',color:'#f0f5ff',border:'1px solid #405873',borderRadius:12,padding:10,marginBottom:8}}>
  <Button variant="secondary" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{error?'Agenda: consulta indisponível':'Bot-Energy · '+data!.reminders.length+' prazos de clientes'}</Button>
  {open&&<>{error?<p>Não foi possível conferir os avisos. Consulte a agenda da organização.</p>:<><ul>{data!.reminders.map(r=><li key={r.key}><Link href={r.href}>{r.title}</Link><p>{new Date(r.deadline).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} · {r.days<0?'Prazo vencido':r.days===0?'Hoje':'Em '+r.days+' dia(s)'}</p><small>{r.source}</small></li>)}</ul><small>{data!.disclosure}</small></>}<Link href="/backoffice/operation/agenda">Abrir agenda</Link></>}
 </section>;
}
