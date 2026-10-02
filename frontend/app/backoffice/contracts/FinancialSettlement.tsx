'use client';
import {FormEvent,useCallback,useEffect,useRef,useState} from 'react';
import {Alert,Button,Card} from '@/app/components/ui';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import {PERM} from './types';
import type {Preview} from './CustomerFinancialPreview';
type Status='DRAFT'|'APPROVED'|'PUBLISHED';
type Row={id:string;consumerUnitId:string;customerId:string;month:string;version:number;status:Status;payloadHash:string;reservations:string[];note:string;approvalNote:string|null;publicationNote:string|null;createdBy:string;createdAt:string;approvedBy:string|null;approvedAt:string|null;publishedBy:string|null;publishedAt:string|null};
type Detail=Row&{unitIds:string[];financial:Preview;captureConsistency:string;canManage:boolean};
type Props={unitId:string;month:string;blockers:number};
const label:Record<Status,string>={DRAFT:'Preparada — aguardando aprovação',APPROVED:'Aprovada — aguardando publicação',PUBLISHED:'Publicada com ressalvas'};
const amount=(value:string|null)=>value===null?'Não informado':'R$ '+value.replace('.',',');
function checked(detail:Detail,unitId:string,month:string){if(!detail.unitIds?.includes(unitId)||detail.month!==month||!['DRAFT','APPROVED','PUBLISHED'].includes(detail.status)||detail.financial?.status!=='AVAILABLE'||!Array.isArray(detail.reservations)||!detail.reservations.length)throw Error('A versão financeira não corresponde à seleção ou está incompleta.');return detail;}
export default function FinancialSettlement(props:Props){return <ScopedSettlement key={props.unitId+':'+props.month} {...props}/>;}
function ScopedSettlement({unitId,month,blockers}:Props){
 const {hasPermission}=useAuth();const canPrepare=hasPermission(PERM.create);
 const [rows,setRows]=useState<Row[]>([]),[detail,setDetail]=useState<Detail|null>(null),[note,setNote]=useState(''),[decisionNote,setDecisionNote]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const sequence=useRef(0),pending=useRef<{id:string;note:string}|null>(null);
 const history=useCallback(async()=>{
  const seq=++sequence.current;setBusy(true);setError('');
  try{const r=await apiRequest<{rows:Row[];canManage:boolean}>('/api/v1/financial-settlements?consumerUnitId='+encodeURIComponent(unitId)+'&month='+encodeURIComponent(month));
   if(sequence.current!==seq)return;
   if(!Array.isArray(r.rows)||r.rows.some(row=>row.consumerUnitId!==unitId||row.month!==month))throw Error('Histórico financeiro fora da seleção.');
   setRows(r.rows);
   if(r.rows.length){const selected=checked(await apiRequest<Detail>('/api/v1/financial-settlements/'+r.rows[0].id),unitId,month);if(sequence.current!==seq)return;setDetail(selected);setDecisionNote(selected.note);setAck(false);}else setDetail(null);
  }catch(e){if(sequence.current===seq)setError(e instanceof Error?e.message:'Histórico financeiro indisponível.');}
  finally{if(sequence.current===seq)setBusy(false);}
 },[unitId,month]);
 const invalidateRequests=useCallback(()=>{sequence.current++;},[]);
 useEffect(()=>{let cancelled=false;void Promise.resolve().then(()=>{if(!cancelled)void history();});return()=>{cancelled=true;invalidateRequests();};},[history,invalidateRequests]);
 function saved(value:Detail){setDetail(value);setDecisionNote(value.note);setAck(false);setRows(old=>[{...value,consumerUnitId:unitId},...old.filter(row=>row.id!==value.id)].sort((a,b)=>b.version-a.version));}
 async function open(row:Row){const seq=++sequence.current;setBusy(true);setError('');setMessage('');try{const value=checked(await apiRequest<Detail>('/api/v1/financial-settlements/'+row.id),unitId,month);if(sequence.current===seq){setDetail(value);setDecisionNote(value.note);setAck(false);}}catch(e){if(sequence.current===seq)setError(e instanceof Error?e.message:'Versão indisponível.');}finally{if(sequence.current===seq)setBusy(false);}}
 async function prepare(e:FormEvent){
  e.preventDefault();if(busy||!canPrepare||blockers>0)return;const clean=note.trim();if(clean.length<20)return;
  const seq=++sequence.current;setBusy(true);setError('');setMessage('');
  if(!pending.current||pending.current.note!==clean)pending.current={id:crypto.randomUUID(),note:clean};
  try{const value=checked(await apiRequest<Detail>('/api/v1/financial-settlements',{method:'POST',body:{consumerUnitId:unitId,month,requestId:pending.current.id,note:clean}}),unitId,month);
   if(sequence.current!==seq)return;saved(value);pending.current=null;setNote('');setMessage('Versão '+value.version+' preparada com as fontes e o consolidado do cliente. Confira os valores e as ressalvas antes de aprovar.');
  }catch(e){if(sequence.current===seq)setError(e instanceof Error?e.message:'Preparação não confirmada. Tente novamente com a mesma justificativa.');}finally{if(sequence.current===seq)setBusy(false);}
 }
 async function decide(action:'approve'|'publish'){
  if(!detail||!detail.canManage||!ack||busy||decisionNote.trim().length<20)return;const selected=detail,seq=++sequence.current;setBusy(true);setError('');setMessage('');
  try{const value=checked(await apiRequest<Detail>('/api/v1/financial-settlements/'+selected.id+'/'+action,{method:'POST',body:{payloadHash:selected.payloadHash,note:decisionNote.trim(),acknowledgeReservations:ack}}),unitId,month);
   if(sequence.current!==seq)return;saved(value);setMessage(action==='publish'?'Apuração publicada com ressalvas explícitas. Evidências posteriores da CCEE exigem outra versão, mantendo esta publicação no histórico.':'Versão aprovada com ressalvas. Confira a justificativa para publicar.');
  }catch(e){if(sequence.current===seq)setError(e instanceof Error?e.message:'Decisão financeira não confirmada. Atualize o histórico.');}finally{if(sequence.current===seq)setBusy(false);}
 }
 return <section id='financial-settlement'><Card title='Fechamento financeiro e publicação'>
  <p>Prepare a apuração com as fontes atuais, confira os valores e aprove antes de publicar. O fechamento inclui todas as unidades cadastradas no cliente e o rateio dos honorários.</p>
  {error?<Alert variant='error'>{error}</Alert>:null}{message?<p role='status'>{message}</p>:null}
  <Button type='button' disabled={busy} onClick={()=>void history()}>Atualizar histórico financeiro</Button>
  {!rows.length&&!busy?<p>Nenhuma apuração financeira preparada nesta competência.</p>:null}
  {rows.length>0?<details><summary>Histórico de versões financeiras</summary>{rows.map(row=><p key={row.id}><Button type='button' disabled={busy} onClick={()=>void open(row)}>Versão {row.version} · {label[row.status]}</Button>{row.publishedAt?' · '+new Date(row.publishedAt).toLocaleString('pt-BR'):null}</p>)}</details>:null}
  {detail?<article className='ds-card'><h3>Versão {detail.version} · {label[detail.status]}</h3><p>Competência {detail.month} · {detail.financial.unitCount} unidade(s) · fontes preservadas na preparação.</p>
   <dl><div><dt>Custo ACR</dt><dd>{amount(detail.financial.acr)}</dd></div><div><dt>Custo ACL antes dos honorários</dt><dd>{amount(detail.financial.aclBeforeFees)}</dd></div><div><dt>Honorários consolidados</dt><dd>{amount(detail.financial.totalFees)}</dd></div><div><dt>Custo ACL após honorários</dt><dd>{amount(detail.financial.aclAfterFees)}</dd></div><div><dt>Economia após honorários</dt><dd>{amount(detail.financial.savingsAfterFees)} · {detail.financial.savingsPercent===null?'Percentual não informado':detail.financial.savingsPercent.replace('.',',')+'%'}</dd></div></dl>
   {detail.approvedAt?<p>Aprovada em {new Date(detail.approvedAt).toLocaleString('pt-BR')} · responsável {detail.approvedBy}. Justificativa: {detail.approvalNote}</p>:null}<h4>Ressalvas preservadas nesta versão</h4><ul>{detail.reservations.map((reservation,i)=><li key={i}>{reservation}</li>)}</ul>
   <details><summary>Fontes do consolidado e rateio por unidade</summary>{detail.financial.units.map(unit=><article key={unit.id}><h4>{unit.name}</h4><p>ACR {amount(unit.acr)} · ACL após honorários {amount(unit.aclAfterFees)} · honorários {amount(unit.totalFees)}</p><ul>{unit.references.map((reference,i)=><li key={i}>{reference.scenario} · {reference.group} · revisão {reference.revision} · {reference.source}</li>)}</ul></article>)}<p>Identificador da versão: {detail.id}</p><p>Integridade: {detail.payloadHash}</p></details>
   {detail.status==='PUBLISHED'?<><p>Publicada em {detail.publishedAt?new Date(detail.publishedAt).toLocaleString('pt-BR'):'Data indisponível'} · responsável {detail.publishedBy}.</p><p>Justificativa da publicação: {detail.publicationNote}</p><Alert>Publicação financeira com ressalvas. A compra sem NF e os tributos não confirmados permanecem explicitamente sujeitos à revisão quando aplicáveis. A evidência da CCEE será conciliada em nova versão. Esta publicação não gera cobrança ou pagamento automático.</Alert></>:detail.canManage&&detail.version===rows[0]?.version?<fieldset disabled={busy}><label>Justificativa da {detail.status==='DRAFT'?'aprovação':'publicação'}<textarea className='ds-input' minLength={20} maxLength={2000} value={decisionNote} onChange={e=>setDecisionNote(e.target.value)}/></label><label><input type='checkbox' checked={ack} onChange={e=>setAck(e.target.checked)}/> Conferi os valores, as fontes e todas as ressalvas desta versão. Confirmo o fechamento com essas ressalvas explícitas e a revisão posterior, preservando o histórico.</label><Button type='button' disabled={!ack||decisionNote.trim().length<20||busy} onClick={()=>void decide(detail.status==='DRAFT'?'approve':'publish')}>{detail.status==='DRAFT'?'Aprovar versão com ressalvas':'Publicar apuração com ressalvas'}</Button></fieldset>:<p>Para aprovar ou publicar, selecione a versão mais recente. A decisão exige Gestor ou Administrador com permissão de edição.</p>}
  </article>:null}
  {canPrepare?<form onSubmit={prepare} className='organizations-create__form'><fieldset disabled={busy||blockers>0}><label>Justificativa e ressalvas para {rows.length?'uma nova versão':'preparar a apuração'}<textarea className='ds-input' value={note} onChange={e=>setNote(e.target.value)} required minLength={20} maxLength={2000}/></label><p>Descreva as evidências aceitas e o que será revisto depois. A preparação consulta novamente as fontes; a versão publicada permanece preservada.</p><Button type='submit' disabled={busy||blockers>0||note.trim().length<20}>{busy?'Conferindo fontes...':'Preparar apuração financeira'}</Button></fieldset>{blockers>0?<p>Resolva os {blockers} bloqueio(s) no painel Resolver pendências para preparar.</p>:null}</form>:null}
 </Card></section>;
}
