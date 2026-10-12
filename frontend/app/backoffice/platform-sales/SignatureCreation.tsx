'use client';
import SignatureLifecycle from './SignatureLifecycle';
import SignatureRecovery from './SignatureRecovery';
import SignatureOriginal from './SignatureOriginal';
import SignatureAbsence from './SignatureAbsence';
import {useState} from 'react';
import {Alert,Button,Input} from '@/app/components/ui';
import {apiRequest,ApiError} from '@/app/lib/api/client';
type Creation={nextOrdinal:number;completed:boolean;blocked:boolean;callsEnabled:boolean;attempts:{lease:string;step:string;actor_name:string|null;currentActorName:string|null;justification:string;events:{version:number;state:string}[]}[]};
const labels:Record<string,string>={CLAIMED:'Preparada',RESERVED:'Envio reservado',ABORTED:'Encerrada sem recurso reconhecido — consultar evidência',UNKNOWN:'Resultado incerto — reconferência necessária',VERIFIED:'Recurso verificado'};
const steps=['Envelope','Documento','Signatário da prestadora','Signatário da contratante','Qualificação da prestadora','Autenticação da prestadora','Qualificação da contratante','Autenticação da contratante'];
export default function SignatureCreation({id}:{id:string}){
 const [value,setValue]=useState<Creation|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 const url='/api/v1/admin/sales/signatures';
 async function read(){setBusy(true);setError('');try{setValue(await apiRequest<Creation>(url+'/'+encodeURIComponent(id)+'/creation'));}catch(e){setValue(null);setError(e instanceof ApiError&&e.status===503?'Criação sandbox desligada; preparação privada preservada.':'Consulta não concluída.');}finally{setBusy(false);}}
 async function next(){if(!value||busy||value.blocked||!value.callsEnabled)return;const ordinal=value.nextOrdinal;setBusy(true);setError('');try{await apiRequest(url+'/creation/next',{method:'POST',body:{id,expectedOrdinal:ordinal,justification:note}});setNote('');}catch{setError('Consulte o histórico antes de continuar. Um resultado incerto bloqueia nova criação.');}finally{setValue(null);setBusy(false);}}
 return <details><summary>Criação controlada do envelope sandbox</summary><p>Cada comando cria somente o próximo recurso. Ativação, notificações e evidências são acompanhadas no fluxo de assinatura, com habilitações separadas.</p><Button variant="secondary" disabled={busy} onClick={()=>void read()}>Consultar criação</Button>{error?<Alert>{error}</Alert>:null}{value?<><p>{value.completed?'Recursos configurados; consulte o fluxo de assinatura':value.blocked?'Criação bloqueada para reconferência':'Próximo passo: '+steps[value.nextOrdinal-1]}</p>{!value.callsEnabled?<p>Chamadas externas desligadas.</p>:null}{!value.completed&&!value.blocked&&value.callsEnabled?<><Input label="Justificativa do passo sandbox" minLength={20} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/><Button disabled={busy||note.trim().length<20} onClick={()=>void next()}>Criar próximo recurso de teste</Button></>:null}<SignatureLifecycle key={'lifecycle-'+id} id={id}/><SignatureOriginal id={id} attempts={value.attempts}/><SignatureAbsence id={id} attempts={value.attempts}/><SignatureRecovery key={id} id={id} attempts={value.attempts}/><details><summary>Histórico de tentativas</summary>{value.attempts.map(a=><div key={a.lease}><p>{a.step} · {a.justification}<br/>Nome registrado: {a.actor_name??'Nome não disponível'}<br/>Nome atual: {a.currentActorName??'Nome não disponível'}</p>{a.events.map(e=><p key={e.version}>{e.version} · {labels[e.state]}</p>)}</div>)}</details></>:null}</details>;
}
