'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import {createOperationalRefresh,RefreshState} from '@/app/lib/read-only-refresh';
import {Alert,Button} from '@/app/components/ui';

type Point={at:number;value:number};
export type OwnerMonitoringSnapshot={status:'AVAILABLE'|'PARTIAL'|'UNAVAILABLE'|'DISABLED';receivedAt:string;windowStart:number;windowEnd:number;roles:{role:'API'|'EVA_WORKER';state:'FRESH'|'STALE'|'MISSING';sampledAt:string|null;memoryMiB:Point[];cpuPercent:Point[];eventLoopMs:Point[]}[]};
const grafana='https://energyos-grafana-production.up.railway.app';
const number=(n:number)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(n);
const date=(v:string)=>new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
const labels={API:'API do EnergyOS',EVA_WORKER:'Worker da EVA'};
const grid={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,280px),1fr))',gap:16} as const;

function Metric({points,label,unit,show,start,end}:{points:Point[];label:string;unit:string;show:boolean;start:number;end:number}){
 const newest=points.at(-1),last=newest&&newest.at>=end-120?newest:undefined,max=Math.max(1,...points.map(p=>p.value));
 const parts:Point[][]=[];for(const point of points){const current=parts.at(-1);if(!current||point.at-current[current.length-1].at>120)parts.push([point]);else current.push(point);}
 return <figure style={{margin:'14px 0'}}><figcaption>{label}: <strong>{last?`${number(last.value)} ${unit}`:'Sem amostra'}</strong></figcaption>
  {show?<><svg viewBox="0 0 320 68" role="img" aria-label={`${label} nos últimos 30 minutos`} style={{display:'block',width:'100%',height:68,marginTop:6}}>
   <path d="M 4 60 H 316" fill="none" stroke="#31516c"/>
   {parts.map((part,i)=><polyline key={i} fill="none" stroke="#20cde4" strokeWidth="2" points={part.map(p=>`${4+312*(p.at-start)/Math.max(1,end-start)},${60-52*p.value/max}`).join(' ')}/>)}
  </svg><small>Últimos 30 minutos · lacunas indicam ausência de amostras.</small></>:null}
 </figure>;
}

export function OwnerMonitoringPanel({snapshot,compact=false,updating=false,error='',paused=false,onRefresh}:{snapshot?:OwnerMonitoringSnapshot;compact?:boolean;updating?:boolean;error?:string;paused?:boolean;onRefresh?:()=>void}){
 const [show,setShow]=useState(!compact),roles=snapshot?.roles??[];
 return <section className="ds-card" aria-label="Monitoramento Grafana no EnergyOS" style={{marginBottom:20}}>
  <h2>Monitoramento EnergyOS · Grafana</h2>
  <p>API e leitura pela EVA na mesma tela do Owner. Indicadores da mesma fonte usada no Grafana.</p><p>Os gráficos acompanham a execução mais recente da API e da EVA. O histórico completo fica no Grafana.</p>
  <p><a href={grafana} target="_blank" rel="noopener noreferrer">Abrir Grafana completo ↗</a> · <Link href="/backoffice/platform-stability">Ver fila e pendências da EVA</Link></p>
  <p>Os indicadores abaixo usam seu acesso Owner. O Grafana completo mantém o login técnico separado.</p>
  {error?<Alert variant="error">{error}</Alert>:null}
  {!snapshot?<p role="status">{updating?'Consultando monitoramento…':'Sem métricas confirmadas nesta consulta.'}</p>:null}
  {snapshot?.status==='DISABLED'?<Alert>Consulta de métricas pausada pela operação da plataforma.</Alert>:null}
  {snapshot?.status==='UNAVAILABLE'?<Alert>Sem métricas confirmadas. Confira a disponibilidade e a fila; a falta de amostras não confirma uma queda do serviço.</Alert>:null}
  {snapshot?.status==='PARTIAL'?<Alert>Há amostras antigas ou incompletas. Confira os horários antes de avaliar a estabilidade.</Alert>:null}
  {snapshot&&snapshot.status!=='DISABLED'?<div style={grid}>{roles.map(row=><article key={row.role} style={{border:'1px solid #31516c',borderRadius:12,padding:16}}>
   <h3>{labels[row.role]}</h3><p><strong>{paused?'Atualização pausada':row.state==='FRESH'&&row.sampledAt&&Date.now()-Date.parse(row.sampledAt)<=180000?'Métricas recentes':row.state==='STALE'||row.state==='FRESH'?'Amostra antiga':'Métricas incompletas'}</strong></p>
   <p>{row.sampledAt?`Última amostra: ${date(row.sampledAt)} · Brasília`:'Última amostra ainda não confirmada.'}</p>
   <Metric points={row.memoryMiB} label={`Memória · ${labels[row.role]}`} unit="MiB" show={show} start={snapshot.windowStart} end={snapshot.windowEnd}/>
   <Metric points={row.cpuPercent} label={`CPU · ${labels[row.role]}`} unit="%" show={show} start={snapshot.windowStart} end={snapshot.windowEnd}/>
   <Metric points={row.eventLoopMs} label={`Atraso de execução · ${labels[row.role]}`} unit="ms" show={show} start={snapshot.windowStart} end={snapshot.windowEnd}/>
  </article>)}</div>:null}
  <p><small>O atraso de execução é o p99 do event loop do processo; não representa o tempo total de leitura de uma fatura.</small></p>
  <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><Button variant="secondary" aria-expanded={show} onClick={()=>setShow(v=>!v)}>{show?'Recolher gráficos':'Ver gráficos dos últimos 30 minutos'}</Button>{onRefresh?<Button variant="secondary" disabled={updating} onClick={onRefresh}>Atualizar monitoramento</Button>:null}</div>
  {snapshot?<p><small>Consulta de métricas: {date(snapshot.receivedAt)} · atualização com esta página aberta e conectada.</small></p>:null}
 </section>;
}

type QueueOverview={organizations:number;total:number;recordedAt:string;processing:number;technical:number;human:number;sources:number;queued:number;running:number;uncertain:number};
function queueOverview(data:any):QueueOverview|undefined{
 if(!Array.isArray(data.rows)||data.rows.length>25||!Number.isSafeInteger(data.total)||data.total<data.rows.length||typeof data.generatedAt!=='string'||!Number.isFinite(Date.parse(data.generatedAt)))return;
 const result:QueueOverview={organizations:data.rows.length,total:data.total,recordedAt:data.generatedAt,processing:0,technical:0,human:0,sources:0,queued:0,running:0,uncertain:0};
 for(const row of data.rows){for(const [group,keys] of [['intakes',['processing','technical','human','sources']],['manual',['queued','running','uncertain']]] as const){for(const key of keys){const value=row?.[group]?.[key];if(!Number.isSafeInteger(value)||value<0)return;result[key]+=value;}}}return result;
}

function Reader(){
 const [snapshot,setSnapshot]=useState<OwnerMonitoringSnapshot>(),[overview,setOverview]=useState<QueueOverview>(),[error,setError]=useState(''),[state,setState]=useState<RefreshState>({mode:'updating',delayMs:0}),refresh=useRef<()=>void>(()=>{});
 useEffect(()=>{
  let denied=false;
  const poll=createOperationalRefresh<{responsible:string;monitoring?:OwnerMonitoringSnapshot;rows?:unknown[];total?:number;generatedAt?:string}>({read:signal=>apiRequest<{responsible:string;monitoring?:OwnerMonitoringSnapshot;rows?:unknown[];total?:number;generatedAt?:string}>('/api/v1/admin/platform-administration/stability',{signal}),canRead:()=>!denied&&document.visibilityState!=='hidden'&&navigator.onLine!==false,
   result:r=>{if(r.responsible!=='OWNER'){setSnapshot(undefined);setOverview(undefined);setError('Monitoramento exclusivo do Owner da Plataforma.');denied=true;return;}setSnapshot(r.monitoring);setOverview(queueOverview(r));setError('');},
   error:e=>{setSnapshot(undefined);setOverview(undefined);if([401,403].includes((e as any)?.status))denied=true;setError('Não foi possível confirmar o monitoramento. Atualize a consulta.');},state:setState});
  refresh.current=poll.refresh;const wake=()=>poll.refresh();document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);window.addEventListener('offline',wake);
  return()=>{poll.stop();refresh.current=()=>{};document.removeEventListener('visibilitychange',wake);window.removeEventListener('online',wake);window.removeEventListener('offline',wake);};
 },[]);
 return <><OwnerMonitoringPanel snapshot={snapshot} compact updating={state.mode==='updating'} paused={state.mode==='paused'} error={error} onRefresh={()=>refresh.current()}/>
  {overview?<section className="ds-card" aria-label="Fila da EVA para o Owner" style={{marginBottom:20}}><h2>Fila da EVA · organizações acompanhadas</h2>
   <p>{overview.organizations} de {overview.total} organização(ões) nesta consulta. <Link href="/backoffice/platform-stability">Abrir todas as organizações e pendências</Link></p>
   <div style={grid}>{([['Documentos em processamento',overview.processing],['Documentos com ocorrência técnica',overview.technical],['Documentos em conferência humana',overview.human],['Documentos aguardando fontes financeiras',overview.sources]] as const).map(([label,value])=><p key={label}>{label}: <strong>{number(value)}</strong></p>)}</div>
   <p>Preparações manuais: {overview.queued} na fila · {overview.running} em execução · {overview.uncertain} resultado(s) incerto(s).</p>
   <p>Fontes financeiras e conferências humanas pendentes não significam uma queda da EVA. Os totais acima correspondem às organizações desta consulta.</p><small>Consulta da fila: {date(overview.recordedAt)} · Brasília</small>
  </section>:null}</>;
}
export default function OwnerMonitoring(){
 const {context,hasPermission}=useAuth();
 return context?.scope==='global'&&context.role==='admin_platform'&&hasPermission('82e7fc71-479a-4dd6-8b22-4fba6eaa6841')?<Reader key={context.user.id}/>:null;
}
