'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Button} from './ui';
type Data={revision:number;body:Record<'EMAIL'|'SMS'|'WHATSAPP',boolean>};
export default function PortalCommunicationPreferences(){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{const abort=new AbortController();apiRequest<Data>('/api/v1/portal/workspace/preferences',{signal:abort.signal,cache:'no-store'}).then(d=>{if(!abort.signal.aborted)setData(d);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[revision]);
 async function save(){if(!data||busy)return;setBusy(true);setNotice('');setError('');try{await apiRequest('/api/v1/portal/workspace/preferences',{method:'POST',body:data});setNotice('Preferências registradas. Os envios dependem dos contatos autorizados, da configuração da organização e da disponibilidade do canal.');setRevision(v=>v+1);}catch(e){setError(e instanceof Error?e.message:'Não foi possível confirmar.');}finally{setBusy(false);}}
 return <details><summary>Como receber avisos</summary><p>Os detalhes continuam no Portal. Mensagens externas não incluem valores financeiros ou documentos.</p>{error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}{data?<>{(['EMAIL','SMS','WHATSAPP'] as const).map(channel=><label key={channel}><input type="checkbox" checked={data.body[channel]===true} disabled={busy} onChange={e=>setData({...data,body:{...data.body,[channel]:e.target.checked}})}/>{channel==='EMAIL'?'E-mail':channel==='SMS'?'SMS':'WhatsApp'}</label>)}<Button disabled={busy} onClick={()=>void save()}>Salvar preferências</Button></>:null}</details>;
}
