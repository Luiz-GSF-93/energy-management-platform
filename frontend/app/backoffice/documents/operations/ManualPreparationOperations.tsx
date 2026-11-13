'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {apiRequest} from '@/app/lib/api/client';
import {createOperationalRefresh,RefreshState} from '../../../lib/read-only-refresh';
import styles from './page.module.css';

type State='QUEUED'|'RUNNING'|'UNKNOWN'|'FAILED'|'SUCCEEDED';
type Row={id:string;customerId:string;consumerUnitId:string;customer:string|null;unit:string|null;month:string;scopeKind:'UNIT'|'CUSTOMER';state:State;recordedState:State;attempts:number;attention:boolean;delayed:boolean;leaseExpired:boolean;createdAt:string;updatedAt:string;heartbeatAt:string|null;nextAttemptAt:string|null;elapsedSeconds:number;closingId:string|null;errorCode:string|null};
type Data={enabled:boolean;accepting:boolean;organizationId:string;generatedAt:string;windowDays:number;pageSize:number;total:number;attentionThresholdSeconds:number;summary:{queued:number;running:number;uncertain:number;failed:number;succeeded:number;attention:number;delayed:number};rows:Row[]};
const states:Record<State,string>={QUEUED:'Na fila',RUNNING:'EVA preparando',UNKNOWN:'Resultado a reconferir',FAILED:'Preparação não iniciada',SUCCEEDED:'Preparação registrada'};
const filters=[['ALL','Todas'],['ACTIVE','Na fila e em execução'],['ATTENTION','Precisam de atenção'],['SUCCEEDED','Preparações registradas']];
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export function validateManualOperations(r:Data,org:string){
 if(r?.enabled===false)return;
 if(!r?.enabled||r.organizationId!==org||!Number.isFinite(Date.parse(r.generatedAt))||r.pageSize!==25||!Number.isInteger(r.total)||r.total<0||!r.summary||(['queued','running','uncertain','failed','succeeded','attention','delayed'] as const).some(k=>!Number.isInteger(r.summary[k])||r.summary[k]<0)||!Array.isArray(r.rows)||r.rows.length>25||r.rows.some(x=>!uuid(x.id)||!uuid(x.consumerUnitId)||typeof x.customerId!=='string'||!x.customerId||!Object.prototype.hasOwnProperty.call(states,x.state)||!['UNIT','CUSTOMER'].includes(x.scopeKind)||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(x.month)||!Number.isFinite(x.elapsedSeconds)||x.elapsedSeconds<0))throw Error('Manual preparation response outside selected organization');
}
function duration(seconds:number){if(seconds<60)return 'menos de 1 min';if(seconds<3600)return Math.floor(seconds/60)+' min';if(seconds<86400)return Math.floor(seconds/3600)+' h';return Math.floor(seconds/86400)+' dia(s)';}
function guidance(r:Row){
 if(r.state==='UNKNOWN')return 'O resultado da gravação precisa de reconferência técnica pelo administrador. Não repita a preparação nem reenvie os documentos. Justificativas e fontes permanecem preservadas.';
 if(r.leaseExpired)return 'O contato da execução anterior expirou. Acompanhe a recuperação do processador antes de repetir qualquer ação.';
 if(r.state==='FAILED')return 'A preparação não chegou a iniciar os cálculos. Confira o acesso e as fontes no fechamento antes de solicitar novamente.';
 if(r.state==='SUCCEEDED')return 'Confira a proposta e as fontes pendentes no fechamento. Preparação registrada não significa aprovação nem publicação financeira.';
 if(r.delayed)return 'A solicitação espera há mais de 5 minutos. Confira a disponibilidade dos serviços e o histórico; não reenvie os documentos.';
 if(r.errorCode==='PREPARATION_SLOT_BUSY')return 'Outra preparação deste cliente e competência está em andamento. Este protocolo aguarda sua vez, com as respostas preservadas.';
 return r.state==='RUNNING'?'A EVA trabalha em segundo plano. Você pode continuar usando o sistema e voltar para acompanhar este protocolo.':'Solicitação recebida. Aguarde o processador; fechar a página não cancela o pedido.';
}
export default function ManualPreparationOperations({organizationId}:{organizationId:string}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[filter,setFilter]=useState('ALL'),[page,setPage]=useState(0);
 const [state,setState]=useState<RefreshState>({mode:'updating',delayMs:0});const refresh=useRef<(()=>void)|null>(null),busy=state.mode==='updating';
 useEffect(()=>{
  let live=true;
  const loop=createOperationalRefresh<Data>({canRead:()=>document.visibilityState==='visible'&&navigator.onLine!==false,
   read:signal=>apiRequest<Data>('/api/v1/eva-assisted-closing/preparation-requests/operations?filter='+filter+'&page='+page,{cache:'no-store',signal}),
   result:r=>{validateManualOperations(r,organizationId);if(live){setData(r);setError('');}},
   error:e=>{if(live){if([401,403].includes((e as {status?:number})?.status??0))setData(null);setError('Não foi possível atualizar as preparações. A falha da consulta não cancela os protocolos. Confira a data da última consulta e não reenvie os documentos.');}},
   state:s=>{if(live)setState(s);}});
  refresh.current=loop.refresh;document.addEventListener('visibilitychange',loop.refresh);window.addEventListener('online',loop.refresh);window.addEventListener('offline',loop.refresh);
  return()=>{live=false;refresh.current=null;loop.stop();document.removeEventListener('visibilitychange',loop.refresh);window.removeEventListener('online',loop.refresh);window.removeEventListener('offline',loop.refresh);};
 },[organizationId,filter,page]);
 if(data?.enabled===false&&!error)return null;
 return <section aria-label="Preparações manuais da EVA" aria-busy={busy}>
  <h2>Preparações manuais da EVA</h2><p>Pedidos de preparação feitos em Contratos. Cada protocolo representa uma preparação; os documentos recebidos aparecem na seção seguinte.</p>
  <div className={styles.toolbar}><button type="button" disabled={busy} onClick={()=>refresh.current?.()}>{busy?'Consultando preparações…':'Atualizar preparações'}</button>{data?.generatedAt&&<span>Consulta das preparações: {new Date(data.generatedAt).toLocaleString('pt-BR')}</span>}</div>
  {error&&<p role="alert">{error}</p>}
  {state.mode==='paused'&&<p role="status">Consulta pausada enquanto a página está oculta ou sem conexão. O processamento continua independente desta tela.</p>}
  {data?.enabled&&<>
   {data.accepting===false&&<p role="status">Novas preparações estão pausadas. Os protocolos existentes continuam disponíveis para acompanhamento.</p>}
   <div className={styles.cards}>{[['Na fila',data.summary.queued],['Em execução',data.summary.running],['Resultado a reconferir',data.summary.uncertain],['Não iniciadas · 30 dias',data.summary.failed],['Preparações registradas · 30 dias',data.summary.succeeded]].map(([label,n])=><article key={label}><span>{label}</span><strong>{n}</strong></article>)}</div>
   {data.summary.attention>0&&<p className={styles.manualWarning} role="status">{data.summary.attention} preparação(ões) precisa(m) de atenção, incluindo {data.summary.delayed} com espera superior a 5 minutos. Filtre “Precisam de atenção” para conferir a causa e o próximo passo. Esse aviso não repete o cálculo.</p>}
   <p>Histórico dos últimos {data.windowDays} dias e solicitações ainda na fila, em execução ou com resultado incerto, inclusive antigas. O tempo de espera é um alerta de acompanhamento, não uma previsão de conclusão.</p>
   <label>Mostrar preparações <select aria-label="Filtrar preparações manuais" value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);setData(null);}}>{filters.map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
   <p>{data.total} protocolo(s) neste filtro · página {page+1}</p>
   {!data.rows.length?<p>Nenhuma preparação neste filtro.</p>:<div className={styles.list}>{data.rows.map(r=><article key={r.id} className={styles.item} data-category={r.attention?'TECHNICAL':r.state==='SUCCEEDED'?'DONE':'PROCESSING'}>
    <header><h3>{r.customer??'Cliente do protocolo'}</h3><strong>{states[r.state]}</strong></header>
    <p>{r.unit??'Unidade do protocolo'} · {r.month} · {r.scopeKind==='CUSTOMER'?'Consolidado do cliente':'Esta unidade'}</p>
    <p><b>Próximo passo:</b> {guidance(r)}</p><p>{['SUCCEEDED','FAILED'].includes(r.state)?'Tempo até o resultado registrado: ':'Tempo desde a solicitação: '}{duration(r.elapsedSeconds)} · {r.attempts} tentativa(s) de execução. Este acompanhamento não envia documentos nem solicita nova leitura OCR.</p>
    {r.state==='RUNNING'&&r.heartbeatAt&&<p>Último contato do processador: {new Date(r.heartbeatAt).toLocaleString('pt-BR')}. Contato não confirma a conclusão do cálculo.</p>}
    <p>Protocolo: {r.id}</p><div className={styles.links}><Link href="/backoffice/contracts">Abrir Contratos para conferir esta unidade e competência</Link></div>
    <details><summary>Histórico e referências para suporte</summary><p>Recebido: {new Date(r.createdAt).toLocaleString('pt-BR')} · Última etapa registrada: {new Date(r.updatedAt).toLocaleString('pt-BR')}{r.errorCode?' · Código: '+r.errorCode:''}{r.closingId?' · Fechamento: '+r.closingId:''}</p>{r.leaseExpired&&<p>Contato anterior expirado. O painel apenas consulta; a recuperação usa o protocolo existente.</p>}</details>
   </article>)}</div>}
   <nav className={styles.toolbar} aria-label="Páginas das preparações manuais"><button type="button" disabled={busy||page===0} onClick={()=>{setPage(p=>p-1);setData(null);}}>Preparações anteriores</button><button type="button" disabled={busy||(page+1)*data.pageSize>=data.total} onClick={()=>{setPage(p=>p+1);setData(null);}}>Próximas preparações</button></nav>
  </>}
 </section>;
}
