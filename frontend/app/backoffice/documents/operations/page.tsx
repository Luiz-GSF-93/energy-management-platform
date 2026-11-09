'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import BackofficeShell from '@/app/components/BackofficeShell';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import styles from './page.module.css';

type Row={id:string;filename:string;state:string;group:string;note:string;month:string|null;customer:string|null;unit:string|null;documentId:string|null;closingId:string|null;updatedAt:string;nextAttemptAt:string|null;attempts:number;idleSeconds:number;leaseExpired:boolean;stage:string|null;code:string|null;requiredInputs:string[];identityDecision:{decision:string;at:string}|null;explanationState:string|null};
type Data={enabled:boolean;generatedAt:string;windowDays:number;total:number;pageSize:number;automationConfigured:boolean;summary:{received30d:number;prepared30d:number;technical:number;human:number;sources:number;processing:number};rows:Row[]};
const groups=[['ALL','Todos'],['TECHNICAL','Conferência técnica'],['HUMAN','Decisão humana'],['SOURCES','Fontes pendentes'],['PROCESSING','Em processamento'],['DONE','Preparados e encerrados']];
const states:Record<string,string>={RECEIVING:'Recebendo original',RECOGNIZING:'Identificando documento',OCR_QUEUED:'Na fila de leitura',OCR_SUBMITTING:'Confirmando envio à leitura',OCR_POLLING:'Aguardando provedor de leitura',LINKING:'Vinculando documento',WAITING_OCR:'Conferindo leitura preservada',PREPARING:'Preparando rascunhos e fechamento',AWAITING_SOURCES:'Aguardando fontes complementares',PROPOSAL_READY:'Proposta pronta para revisão',REVIEW_REQUIRED:'Conferência necessária',UNKNOWN:'Resultado técnico a reconciliar',PUBLISHED:'Publicado',SOURCE_READY:'Fonte disponível',DISMISSED:'Envio encerrado'};
function elapsed(seconds:number){if(seconds<60)return 'menos de 1 minuto';if(seconds<3600)return Math.floor(seconds/60)+' min';if(seconds<86400)return Math.floor(seconds/3600)+' h';return Math.floor(seconds/86400)+' dia(s)';}
function nextStep(r:Row){if(r.state==='RECEIVING')return 'Aguardar confirmação do armazenamento. Se a etapa não avançar, conferir o envio antes de repetir.';if(r.group==='TECHNICAL')return 'Conferir o histórico e reconciliar o resultado preservado antes de repetir qualquer operação.';if(r.group==='HUMAN')return 'Abrir a conferência do documento. Revisar identidade, vínculo e autorização; continuar com justificativa ou descontinuar quando solicitado.';if(r.group==='SOURCES')return 'Completar somente as fontes indicadas em Contratos ou Registros CCEE. A EVA mantém os campos preenchidos e retoma quando as fontes mudarem.';if(r.group==='PROCESSING')return r.leaseExpired?'Execução anterior expirou. Aguardar reconciliação técnica; não reenviar o arquivo.':'Aguardar a etapa em andamento. O original está preservado; não é necessário reenviar.';return r.state==='PROPOSAL_READY'?'Revisar a proposta no fluxo de fechamento antes de aprovar.':'Consultar o resultado e o histórico existentes.';}
function Panel(){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[group,setGroup]=useState('ALL'),[page,setPage]=useState(0),[revision,setRevision]=useState(0);
 useEffect(()=>{const id=setInterval(()=>{if(document.visibilityState==='visible')setRevision(n=>n+1);},30000);return()=>clearInterval(id);},[]);
 useEffect(()=>{const abort=new AbortController();let live=true;setBusy(true);const timeout=setTimeout(()=>abort.abort(),15000);apiRequest<Data>('/api/v1/portal/workspace/automatic-intakes/operations?group='+group+'&page='+page,{cache:'no-store',signal:abort.signal}).then(r=>{if(live){setData(r);setError('');}}).catch(()=>{if(live)setError('Não foi possível atualizar o painel. Os últimos dados exibidos permanecem identificados pela hora da consulta.');}).finally(()=>{clearTimeout(timeout);if(live)setBusy(false);});return()=>{live=false;clearTimeout(timeout);abort.abort();};},[group,page,revision]);
 const cards=data?.summary;
 return <section className={'backoffice-page '+styles.page} aria-busy={busy}>
  <header><Link href="/backoffice/documents">← Documentos</Link><h1>Painel operacional da EVA</h1><p>Acompanhe a etapa real, a causa da espera e o próximo passo. Processamento, conferência e aprovação financeira são situações diferentes.</p></header>
  <div className={styles.toolbar}><button onClick={()=>setRevision(n=>n+1)} disabled={busy}>{busy?'Atualizando…':'Atualizar painel'}</button>{data?.generatedAt&&<span>Consulta: {new Date(data.generatedAt).toLocaleString('pt-BR')} · atualização a cada 30 s com a página visível</span>}</div>
  {error&&<p role="alert">{error}</p>}{data&&!data.enabled?<p>Recebimento automático temporariamente desligado nesta implantação.</p>:null}
  {data?.enabled&&<>
   {!data.automationConfigured&&<p role="alert">A delegação de automação ainda precisa ser configurada pelo administrador desta organização. Os módulos contratados e as permissões continuam obrigatórios.</p>}
   <div className={styles.cards}>{[['Recebidos · 30 dias',cards?.received30d],['Com proposta · recebidos em 30 dias',cards?.prepared30d],['Em processamento',cards?.processing],['Conferência técnica',cards?.technical],['Decisão humana',cards?.human],['Fontes pendentes',cards?.sources]].map(([label,value])=><article key={String(label)}><span>{label}</span><strong>{value??'—'}</strong></article>)}</div>
   <p>O acompanhamento inclui pendências antigas. Contagens de recebimento e propostas usam os documentos recebidos nos últimos 30 dias. Explicação da IA é opcional e não bloqueia o preenchimento.</p>
   <label>Mostrar <select value={group} onChange={e=>{setGroup(e.target.value);setPage(0);setData(null);}}>{groups.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <p>{data.total} envio(s) neste filtro · página {page+1}</p>
   {!data.rows.length?<p>Nenhum envio neste filtro.</p>:<div className={styles.list}>{data.rows.map(r=><article className={styles.item} key={r.id} data-category={r.group}>
    <header><h2>{r.filename}</h2><strong>{states[r.state]??r.state}</strong></header>
    <p>{r.customer??'Cliente em identificação'} · {r.unit??'Unidade em identificação'} · {r.month??'Competência em identificação'}</p>
    <p><b>Situação:</b> {r.note||states[r.state]}</p><p><b>Próximo passo:</b> {nextStep(r)}</p>
    {r.requiredInputs?.length>0&&<details open><summary>Fontes necessárias para concluir os valores</summary><ul>{r.requiredInputs.slice(0,30).map((v,n)=><li key={n}>{v}</li>)}</ul></details>}
    <p>Sem atualização há {elapsed(r.idleSeconds)} · {r.attempts} consulta(s) da fila. Consultas não representam novas leituras pagas.</p>
    {['PROCESSING','SOURCES'].includes(r.group)&&r.nextAttemptAt&&<p>Próxima verificação prevista: {new Date(r.nextAttemptAt).toLocaleString('pt-BR')}{new Date(r.nextAttemptAt).getTime()<Date.now()?' · aguardando disponibilidade do serviço':''}.</p>}
    {r.identityDecision&&<p>Decisão de identidade registrada: {r.identityDecision.decision==='STOP'?'descontinuar':r.identityDecision.decision==='ADDRESS'?'endereço justificado':'continuar com justificativa'} · {new Date(r.identityDecision.at).toLocaleString('pt-BR')}.</p>}
    {r.explanationState&&<p>Explicação opcional da IA: {({QUEUED:'aguardando',RUNNING:'em andamento',SUCCEEDED:'concluída',FAILED:'indisponível; proposta preservada',UNKNOWN:'confirmação pendente; proposta preservada'} as Record<string,string>)[r.explanationState]??r.explanationState}.</p>}
    <div className={styles.links}>{r.documentId&&<Link href={'/backoffice/documents#ocr-'+encodeURIComponent(r.documentId)}>Conferir documento e histórico</Link>}{['SOURCES','DONE'].includes(r.group)&&<Link href="/backoffice/contracts">Conferir fontes e fechamento em Contratos</Link>}</div>
    <details><summary>Referências para suporte</summary><p>Envio: {r.id}{r.closingId?' · Fechamento: '+r.closingId:''}</p>{r.stage&&<p>Etapa registrada: {r.stage}{r.code?' · Código: '+r.code:''}</p>}</details>
   </article>)}</div>}
   <nav className={styles.toolbar} aria-label="Páginas do acompanhamento"><button disabled={busy||page===0} onClick={()=>{setPage(n=>n-1);setData(null);}}>Anterior</button><button disabled={busy||(page+1)*data.pageSize>=data.total} onClick={()=>{setPage(n=>n+1);setData(null);}}>Próxima</button></nav>
  </>}
 </section>;
}
export default function EvaOperationsPage(){const {context,hasPermission}=useAuth();const org=context?.scope==='organization'?context.currentOrganization.id:'';const allowed=!!org&&hasPermission('8f105b02-4443-49de-b188-847e0284e7ed')&&hasPermission('8f3ff5eb-157a-468a-91af-6f89d92e23a7')&&context?.scope==='organization'&&(['admin_org','gestor','operacional'].includes(context.currentOrganization.role)||context.accessMode==='platform_operation');return <ProtectedRoute><BackofficeShell>{allowed?<Panel key={org+':'+context?.user.id}/>:<p role="alert">Selecione uma organização e entre com as permissões de consulta e envio de documentos para acessar o painel.</p>}</BackofficeShell></ProtectedRoute>;}
