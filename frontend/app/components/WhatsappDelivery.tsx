'use client';
import {useEffect,useState} from 'react';
import {Card,Alert,Button} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
import WhatsappTemplates from './WhatsappTemplates';
type Data={configured:boolean;events:{message_id:string;status:string;event_at:string;error_codes:number[];received_at:string}[]};
const labels:Record<string,string>={sent:'Enviada',delivered:'Entregue',read:'Lida',failed:'Falhou'};
export default function WhatsappDelivery(){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[version,setVersion]=useState(0);
 useEffect(()=>{let active=true;const load=()=>apiRequest<Data>('/api/v1/admin/dashboard/whatsapp-delivery').then(d=>{if(active){setData(d);setError('');}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Consulta indisponível');});void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},60000);return()=>{active=false;clearInterval(timer);};},[version]);
 return <Card title="Entrega das mensagens WhatsApp"><p>Retornos da Meta para o número da plataforma. Aceitação pela API não confirma entrega. Cada mensagem pode gerar vários eventos.</p>{error?<Alert variant="error">{error}</Alert>:null}{data&&!data.configured?<Alert>Webhook pendente de configuração no Railway e na Meta.</Alert>:null}{data?.configured?<p>Configurações locais presentes. A conexão com a Meta será comprovada quando chegar um evento assinado.</p>:null}{data?.events.length?<div style={{overflowX:'auto'}}><table><thead><tr><th>Data do evento</th><th>Status</th><th>Identificador</th><th>Erros Meta</th></tr></thead><tbody>{data.events.map(e=><tr key={e.message_id+e.status+e.event_at}><td>{new Date(e.event_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</td><td>{labels[e.status]}</td><td title={e.message_id}>{e.message_id.slice(-12)}</td><td>{e.error_codes.join(', ')||'—'}</td></tr>)}</tbody></table></div>:<p>Nenhum retorno de entrega registrado. Eventos anteriores à conexão podem não estar disponíveis.</p>}<Button variant="secondary" onClick={()=>setVersion(v=>v+1)}>Atualizar entregas</Button><WhatsappTemplates/></Card>;
}
