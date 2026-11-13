'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import ServiceAvailabilityPanel from '@/app/components/ServiceAvailabilityPanel';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import {createOperationalRefresh,RefreshState} from '@/app/lib/read-only-refresh';
import {Alert,Button} from '@/app/components/ui';
const manage='82e7fc71-479a-4dd6-8b22-4fba6eaa6841';
type Row={organizationId:string;organizationName:string;activeLicenses:number;attention:boolean;closingReceipts:number;manual:{queued:number;running:number;uncertain:number;failed30d:number;succeeded30d:number;oldestQueueSeconds:number};intakes:{technical:number;human:number;sources:number;processing:number;proposals30d:number}};
type Data={responsible:string;generatedAt:string;total:number;pageSize:number;windowDays:number;rows:Row[];plan:{responsible:string;organizationRole:string;rolloutScope:string;ownerAccess:string;updatedOn:string;steps:{id:string;status:string;description:string}[]}};
function Workspace({actor}:{actor:string}){
 const [page,setPage]=useState(0),[search,setSearch]=useState(''),[draft,setDraft]=useState(''),[data,setData]=useState<Data|null>(null),[error,setError]=useState('');
 const [refresh,setRefresh]=useState<RefreshState>({mode:'updating',delayMs:0});const action=useRef<(()=>void)|null>(null);
 useEffect(()=>{
  let denied=false;setData(null);setError('');
  const poll=createOperationalRefresh<Data>({read:signal=>apiRequest<Data>('/api/v1/admin/platform-administration/stability?'+new URLSearchParams({page:String(page),search}),{signal}),canRead:()=>!denied&&document.visibilityState!=='hidden'&&navigator.onLine!==false,
   result:value=>{if(value.responsible!=='OWNER'||!Array.isArray(value.rows)){setData(null);setError('Resposta de acompanhamento inválida.');return;}setData(value);setError('');},
   error:e=>{setData(null);if([401,403].includes((e as any)?.status))denied=true;setError(e instanceof Error?e.message:'Acompanhamento temporariamente indisponível.');},state:setRefresh});
  action.current=poll.refresh;const wake=()=>poll.refresh();document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);window.addEventListener('offline',wake);
  return()=>{action.current=null;poll.stop();document.removeEventListener('visibilitychange',wake);window.removeEventListener('online',wake);window.removeEventListener('offline',wake);};
 },[actor,page,search]);
 return <section className="backoffice-page"><h1>Estabilidade EnergyOS · Plataforma</h1>
  <p>Responsável: Owner / Administrador da Plataforma. Acompanhe as organizações com licença ativa; correções gerais pertencem à operação da plataforma.</p>
  <p><Link href="/backoffice/platform-audit">Abrir Auditoria Global</Link> · <Link href="/backoffice/platform-costs">Custos e performance</Link></p>
  <ServiceAvailabilityPanel/><p><Link href="/status">Abrir disponibilidade sem depender do login</Link></p>
  <form onSubmit={e=>{e.preventDefault();setPage(0);setSearch(draft.trim());}}><label>Buscar organização<input value={draft} maxLength={150} onChange={e=>setDraft(e.target.value)}/></label><Button type="submit">Buscar</Button></form>
  <Button disabled={refresh.mode==='updating'} onClick={()=>action.current?.()}>Atualizar organizações</Button>
  <p role="status">{refresh.mode==='updating'?'Consultando organizações…':refresh.mode==='paused'?'Atualização pausada.':'Atualização automática com esta página aberta e conectada.'}</p>
  {error?<Alert variant="error">{error}</Alert>:null}
  {data?<><p>Consulta: {new Date(data.generatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} · {data.total} organização(ões) licenciada(s). Pedidos ativos antigos também são acompanhados.</p>
   <p>Fontes financeiras e decisões humanas pendentes são apresentadas separadamente das ocorrências técnicas. Contagens de propostas e preparações não significam aprovação financeira.</p>
   {data.rows.length?data.rows.map(r=><article key={r.organizationId} style={{padding:18,border:'1px solid #31516c',borderRadius:12,margin:'16px 0'}}><h2>{r.organizationName}</h2><p><strong>{r.attention?'Requer acompanhamento do Owner':'Sem alerta técnico neste recorte'}</strong> · {r.activeLicenses} licença(s) ativa(s)</p>
    <p>Preparações manuais: {r.manual.queued} na fila · {r.manual.running} em execução · {r.manual.uncertain} resultado(s) incerto(s).</p>
    <p>Maior espera na fila manual: {Math.floor(r.manual.oldestQueueSeconds/60)} min. Não iniciadas nos últimos 30 dias: {r.manual.failed30d}. Preparações registradas: {r.manual.succeeded30d}.</p>
    <p>Recibos de fechamento antigos a reconferir: {r.closingReceipts}. Tarefas com lease ativo correspondente são preservadas.</p>
    <p>Documentos: {r.intakes.processing} em processamento · {r.intakes.technical} conferência(s) técnica(s) · {r.intakes.human} decisão(ões) humana(s) · {r.intakes.sources} aguardando fontes financeiras.</p>
    {r.activeLicenses!==1?<p>Conferir a consistência das licenças ativas desta organização.</p>:null}<p><Link href="/backoffice/organizations">Abrir gestão das organizações</Link></p></article>):<p>Nenhuma organização com licença ativa neste filtro.</p>}
   <nav aria-label="Páginas da estabilidade"><Button disabled={page===0} onClick={()=>setPage(v=>v-1)}>Anteriores</Button><span> Página {page+1} </span><Button disabled={(page+1)*data.pageSize>=data.total} onClick={()=>setPage(v=>v+1)}>Próximas</Button></nav>
   <section aria-label="Plano de migração sem parada planejada"><h2>Plano de migração sem parada planejada</h2><p>{data.plan.organizationRole} {data.plan.rolloutScope}</p><p>{data.plan.ownerAccess}</p>
    {data.plan.steps.map(s=><article key={s.id}><h3>{s.id} · {s.status}</h3><p>{s.description}</p></article>)}
    <p>O acompanhamento técnico dentro do EnergyOS depende dos serviços disponíveis. Exportação e alertas externos contínuos permanecem na etapa D.</p>
   </section></>:null}
 </section>;
}
export default function Page(){const {context,hasPermission}=useAuth();return <ProtectedRoute><BackofficeShell>{context?.scope==='global'&&hasPermission(manage)?<Workspace key={context.user.id} actor={context.user.id}/>:<Alert>Acompanhamento global exclusivo do Owner da Plataforma. A organização acompanha sua estabilidade em Documentos.</Alert>}</BackofficeShell></ProtectedRoute>;}
