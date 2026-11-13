'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from './ui';
import {createOperationalRefresh,RefreshState} from '../lib/read-only-refresh';
import {serviceAvailability,Availability} from '../backoffice/documents/operations/service-availability';
const label=(v:string)=>v==='up'?'disponível':v==='down'?'indisponível':'consulta indisponível';
export default function ServiceAvailabilityPanel(){
 const [value,setValue]=useState<Availability>({database:'unknown',auth:'unknown',checkedAt:null});
 const [refresh,setRefresh]=useState<RefreshState>({mode:'updating',delayMs:0});
 const action=useRef<(()=>void)|null>(null);
 useEffect(()=>{
  const poll=createOperationalRefresh({read:serviceAvailability,canRead:()=>document.visibilityState!=='hidden'&&navigator.onLine!==false,result:setValue,error:()=>setValue(v=>({...v,database:'unknown',auth:'unknown'})),state:setRefresh});
  action.current=poll.refresh;const wake=()=>poll.refresh();document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);window.addEventListener('offline',wake);
  return()=>{action.current=null;poll.stop();document.removeEventListener('visibilitychange',wake);window.removeEventListener('online',wake);window.removeEventListener('offline',wake);};
 },[]);
 return <section aria-label="Disponibilidade dos serviços"><h2>Disponibilidade dos serviços</h2>
  <p>Banco de dados: <strong>{label(value.database)}</strong></p><p>Acesso e autenticação: <strong>{label(value.auth)}</strong></p>
  <p>Última verificação: {value.checkedAt?new Date(value.checkedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'ainda não confirmada'}</p>
  <p role="status">{refresh.mode==='updating'?'Consultando disponibilidade…':refresh.mode==='paused'?'Consulta pausada com a página oculta ou sem conexão.':'Atualização a cada 30 segundos com a página aberta e conectada.'}</p>
  <Button disabled={refresh.mode==='updating'} onClick={()=>action.current?.()}>Atualizar disponibilidade</Button>
 </section>;
}
