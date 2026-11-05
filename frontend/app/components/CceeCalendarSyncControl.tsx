 'use client';
import {FormEvent,useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button} from './ui';
const base='/api/v1/admin/integrations/ccee-calendar-sync';
const date=(v:string)=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'não disponível';
export default function CceeCalendarSyncControl(){const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[year,setYear]=useState(new Date().getFullYear());
 async function read(){try{const r=await apiRequest<any>(base);setData(r);if(r.year)setYear(r.year);}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void read();},[]);
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const f=new FormData(e.currentTarget);try{await apiRequest(base,{method:'POST',body:{enabled:!data?.enabled,year,reason:String(f.get('reason')),requestId:crypto.randomUUID()}});await read();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section aria-label="Atualização diária do calendário oficial"><h3>Atualização diária da fonte oficial</h3><p>Até duas consultas públicas por dia, inicialmente na Expert Energy. Fonte alterada gera versão para revisão independente; a agenda não é alterada automaticamente.</p>{error&&<Alert variant="error">{error}</Alert>}{data&&<><p>Política: {data.enabled?'ativa':'pausada'} · worker: {data.serverEnabled?'habilitado':'aguardando configuração no servidor'}. Última tentativa {date(data.last_attempt_at)} · última coleta concluída {date(data.last_success_at)} · próxima {data.enabled&&data.serverEnabled?date(data.next_run_at):'não agendada'}. {data.last_error||''}</p><Button variant="secondary" disabled={busy} onClick={()=>void read()}>Atualizar status da coleta</Button>{data.serverEnabled&&<details><summary>Configurar coleta oficial com meu perfil Owner</summary><form onSubmit={save}><label>Ano<input type="number" min={2021} max={2099} value={year} onChange={e=>setYear(Number(e.target.value))}/></label><label>Justificativa<textarea name="reason" required minLength={10} maxLength={1000}/></label><Button type="submit" disabled={busy}>{data.enabled?'Pausar coleta diária':'Ativar coleta diária'}</Button></form></details>}</>}</section>;
}
