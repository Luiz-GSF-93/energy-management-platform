'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Card} from '@/app/components/ui';
const labels:Record<string,string>={PENDING:'Pendentes',SENDING:'Em envio',ACCEPTED:'Aceitos pelo provedor',DELIVERED:'Entregues',DELAYED:'Atrasados',FAILED:'Falhas',BOUNCED:'Devolvidos',COMPLAINED:'Reclamações',UNKNOWN:'Resultados incertos'};
export default function TeamNotificationMetrics({month}:{month:string}){
 const [data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;setData(null);void apiRequest<any>('/api/v1/admin/platform-team-notification-metrics?'+new URLSearchParams({month})).then(x=>{if(live){setData(x);setError('')}}).catch(e=>{if(live)setError(e.message??'Indicadores indisponíveis.')});return()=>{live=false}},[month]);
 return <Card title="Resend · avisos de acesso da equipe">{error&&<Alert>{error}</Alert>}{data&&<><p>{data.notifications} avisos criados na competência {data.month} · {data.reservations} reservas acumuladas desses avisos.</p><dl>{Object.entries(labels).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{data.states[key]??0}</dd></div>)}</dl><p>Reservas não confirmam envios faturáveis. Custo monetário e plano Resend não apurados; registre a fatura no catálogo de serviços. Nenhum valor desconhecido é tratado como zero.</p><p>Indicadores agregados para Owner e Financeiro. Identidades, destinatários, perfis individuais e histórico detalhado permanecem no ambiente exclusivo do Owner.</p></>}</Card>;
}
