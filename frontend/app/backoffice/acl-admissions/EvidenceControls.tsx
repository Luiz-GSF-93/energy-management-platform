'use client';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '@/app/lib/api/client';
import { Alert, Button } from '@/app/components/ui';
import type { WorkDetail } from './WorkControls';
type Page<T>={rows:T[];nextCursor:string|null};
type Source={id:string;name:string;type:string;month:string|null;version:number};
type Evidence={id:string;stageKey:string;kind:'COMPLETE'|'SKIP';note:string;actorName:string;documents:{id:string;version:number;type:string;month:string}[];review:null|{decision:string;reason:string;actorName:string}};
type Command={requestId:string;expectedRevision:number;action:string;checkedDocument:true;stageKey?:string;kind?:string;documentIds?:string[];facts?:Record<string,string>;note?:string;evidenceId?:string};
const names:Record<string,string>={registration:'Cadastro',invoices:'Faturas',feasibility:'Viabilidade',modality:'Modalidade',contracts:'Contratação',termination:'Denúncia',metering:'Medição',custody:'Conta e adesão',technical:'Habilitação técnica','contract-registration':'Registro de contratos',validation:'Validação',supply:'Início do suprimento'};
export default function EvidenceControls({detail,actorId,canWork,canApprove,onUpdated}:{detail:WorkDetail;actorId:string;canWork:boolean;canApprove:boolean;onUpdated:(v:WorkDetail)=>void}){
 const [sources,setSources]=useState<Page<Source>>({rows:[],nextCursor:null}),[evidences,setEvidences]=useState<Page<Evidence>>({rows:[],nextCursor:null});
 const [stageKey,setStageKey]=useState('registration'),[kind,setKind]=useState('COMPLETE'),[ids,setIds]=useState<string[]>([]),[evidenceId,setEvidenceId]=useState('');
 const [note,setNote]=useState(''),[checked,setChecked]=useState(false),[modality,setModality]=useState(''),[supplyDate,setSupplyDate]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(false),[cycle,setCycle]=useState(0);
 const alive=useRef(true),flight=useRef(false),pending=useRef<Command|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const base='/acl-admissions/'+encodeURIComponent(detail.id);
 useEffect(()=>{const abort=new AbortController();(async()=>{try{
  const [s,e]=await Promise.all([apiRequest<Page<Source>>(base+'/evidence-sources',{signal:abort.signal}),apiRequest<Page<Evidence>>(base+'/evidence',{signal:abort.signal})]);
  if(!abort.signal.aborted){setSources(s);setEvidences(e);}
 }catch(e){if(!abort.signal.aborted){setSources({rows:[],nextCursor:null});setEvidences({rows:[],nextCursor:null});setError(e instanceof Error?e.message:'Não foi possível consultar as evidências.');}}})();return()=>abort.abort();},[base,detail.revision,cycle]);
 const selected=detail.stages.find(s=>s.key===stageKey),chosen=evidences.rows.find(e=>e.id===evidenceId),chosenStage=detail.stages.find(s=>s.key===chosen?.stageKey);
 const ownRunning=selected?.status==='RUNNING'&&selected.active?.actorId===actorId;
 const conditional=['metering','custody','contract-registration'].includes(stageKey);
 const canSubmit=canWork&&(kind==='COMPLETE'?ownRunning:conditional&&selected?.status==='NOT_STARTED');
 function clearReview(){setChecked(false);setNote('');}
 async function send(body:Command){if(flight.current)return;flight.current=true;setBusy(true);setError('');setRetry(false);pending.current=body;
  try{const value=await apiRequest<{admission:WorkDetail;evidenceId:string}>(base+'/evidence',{method:'POST',body});if(alive.current){pending.current=null;clearReview();setIds([]);setEvidenceId(value.evidenceId);onUpdated(value.admission);setCycle(v=>v+1);}}
  catch(e){if(alive.current){setError(e instanceof Error?e.message:'Não foi possível confirmar a operação.');if(e instanceof ApiError&&e.status<500)pending.current=null;else setRetry(true);}}
  finally{flight.current=false;if(alive.current)setBusy(false);}}
 function submit(){const facts:Record<string,string>=kind==='SKIP'?{}:stageKey==='modality'?{modality}:stageKey==='supply'?{supplyDate}:{};
  void send({requestId:crypto.randomUUID(),expectedRevision:detail.revision,action:'SUBMIT',checkedDocument:true,stageKey,kind,documentIds:ids,note:note.trim(),facts});}
 function decide(action:string){if(!chosen)return;void send({requestId:crypto.randomUUID(),expectedRevision:detail.revision,action,checkedDocument:true,evidenceId:chosen.id,...(['APPROVE','REJECT'].includes(action)?{note:note.trim()}: {})});}
 async function refresh(){if(flight.current)return;flight.current=true;setBusy(true);setError('');try{const row=await apiRequest<WorkDetail>(base);if(alive.current){pending.current=null;setRetry(false);clearReview();onUpdated(row);setCycle(v=>v+1);}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Não foi possível atualizar.');}finally{flight.current=false;if(alive.current)setBusy(false);}}
 async function more(kind:'sources'|'evidences'){const p=kind==='sources'?sources:evidences;if(!p.nextCursor||flight.current)return;flight.current=true;setBusy(true);try{
  if(kind==='sources'){const v=await apiRequest<Page<Source>>(base+'/evidence-sources?after='+encodeURIComponent(p.nextCursor));if(alive.current)setSources(old=>({...v,rows:[...old.rows,...v.rows]}));}
  else{const v=await apiRequest<Page<Evidence>>(base+'/evidence?after='+encodeURIComponent(p.nextCursor));if(alive.current)setEvidences(old=>({...v,rows:[...old.rows,...v.rows]}));}
 }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Não foi possível carregar mais registros.');}finally{flight.current=false;if(alive.current)setBusy(false);}}
 const disabled=busy||retry,open=detail.status!=='COMPLETED';
 return <section aria-label="Evidências e conferência"><h3>Evidências e conferência</h3>{error?<Alert>{error}</Alert>:null}
 <p>Use documentos privados da mesma unidade. A conferência é manual e registra a responsabilidade do Consultor; não comprova assinatura digital nem substitui a integração CCEE.</p>
 <p><a href="/backoffice/documents">Consultar documentos</a>. Uma versão ou classificação alterada exige nova evidência e revisão.</p>
 {canWork&&open?<fieldset disabled={disabled}><legend>Registrar evidência</legend>
 <label htmlFor="acl-evidence-stage">Etapa</label><select id="acl-evidence-stage" value={stageKey} onChange={e=>{setStageKey(e.target.value);setKind('COMPLETE');setIds([]);clearReview();}}>{detail.stages.map(s=><option key={s.key} value={s.key}>{names[s.key]||s.key}</option>)}</select>
 <label htmlFor="acl-evidence-kind">Finalidade</label><select id="acl-evidence-kind" value={kind} onChange={e=>{setKind(e.target.value);clearReview();}}><option value="COMPLETE">Concluir com evidência</option>{conditional?<option value="SKIP">Solicitar dispensa justificada</option>:null}</select>
 <p>{kind==='COMPLETE'?'Inicie ou retome a etapa com seu usuário antes de registrar a evidência.':'Dispensas exigem aprovação. Custódia e registro somente admitem dispensa na modalidade varejista confirmada.'}</p>
 <div>{sources.rows.map(s=><label key={s.id}><input type="checkbox" checked={ids.includes(s.id)} disabled={!ids.includes(s.id)&&ids.length>=20} onChange={e=>{setIds(old=>e.target.checked?[...old,s.id]:old.filter(id=>id!==s.id));setChecked(false);}}/> {s.name} · versão {s.version}{s.month?' · '+s.month.slice(0,7):''}</label>)}</div>
 {!sources.rows.length?<p>Nenhum documento conferido e disponível para esta unidade.</p>:null}
 {stageKey==='invoices'&&kind==='COMPLETE'?<p>Selecione exatamente 12 faturas da distribuidora, de competências consecutivas, com conteúdo conferido. OCR bruto não representa aprovação.</p>:null}
 {stageKey==='contracts'&&kind==='COMPLETE'?<p>Inclua o contrato de energia e o de gestão. Confira o conteúdo e os documentos assinados recebidos.</p>:null}
 {stageKey==='modality'&&kind==='COMPLETE'?<><label htmlFor="acl-reviewed-modality">Modalidade conferida</label><select id="acl-reviewed-modality" value={modality} onChange={e=>{setModality(e.target.value);setChecked(false);}}><option value="">Selecione após conferir o fundamento aplicável</option><option value="RETAIL">Varejista</option><option value="OWN_AGENT">Agente próprio</option></select></>:null}
 {stageKey==='supply'&&kind==='COMPLETE'?<><label htmlFor="acl-confirmed-supply">Data confirmada de suprimento</label><input id="acl-confirmed-supply" type="date" value={supplyDate} onChange={e=>{setSupplyDate(e.target.value);setChecked(false);}}/></>:null}
 </fieldset>:null}
 {sources.nextCursor?<Button variant="secondary" disabled={disabled} onClick={()=>void more('sources')}>Mais documentos</Button>:null}
 <label htmlFor="acl-evidence-note">Conferência ou justificativa</label><textarea id="acl-evidence-note" maxLength={1000} value={note} disabled={disabled||!open} onChange={e=>{setNote(e.target.value);setChecked(false);}}/>
 <label><input type="checkbox" checked={checked} disabled={disabled||!open} onChange={e=>setChecked(e.target.checked)}/> Conferi os documentos, o conteúdo, as pré-condições e a aplicabilidade desta operação.</label>
 {canWork&&open?<Button disabled={disabled||!canSubmit||!checked||note.trim().length<20||ids.length<1||kind==='COMPLETE'&&stageKey==='modality'&&!modality||kind==='COMPLETE'&&stageKey==='supply'&&!supplyDate} onClick={submit}>Registrar para revisão</Button>:null}
 <h4>Evidências registradas</h4><label htmlFor="acl-recorded-evidence">Selecionar evidência</label><select id="acl-recorded-evidence" value={evidenceId} disabled={disabled} onChange={e=>{setEvidenceId(e.target.value);clearReview();}}><option value="">Selecione uma evidência</option>{evidences.rows.map(e=><option key={e.id} value={e.id}>{names[e.stageKey]} · {e.kind==='SKIP'?'Dispensa':'Conclusão'} · {e.review?.decision==='APPROVED'?'Aprovada':e.review?.decision==='REJECTED'?'Rejeitada':'Aguardando revisão'}</option>)}</select>
 {chosen?<article><p>{chosen.note}</p><p>Registrada por {chosen.actorName}. {chosen.documents.length} documento(s) versionado(s).</p>{chosen.review?<p>Revisão de {chosen.review.actorName}: {chosen.review.reason}</p>:null}</article>:null}
 {chosen&&!chosen.review&&canApprove&&open?<><Button disabled={disabled||!checked||note.trim().length<20} onClick={()=>decide('APPROVE')}>Aprovar evidência</Button><Button variant="secondary" disabled={disabled||!checked||note.trim().length<20} onClick={()=>decide('REJECT')}>Rejeitar evidência</Button></>:null}
 {chosen?.review?.decision==='APPROVED'&&open?<Button disabled={disabled||!checked||(chosen.kind==='SKIP'? !canApprove||chosenStage?.status!=='NOT_STARTED':!canWork||chosenStage?.status!=='RUNNING'||chosenStage?.active?.actorId!==actorId)} onClick={()=>decide(chosen.kind)}>{chosen.kind==='SKIP'?'Confirmar dispensa':'Concluir etapa'}</Button>:null}
 {evidences.nextCursor?<Button variant="secondary" disabled={disabled} onClick={()=>void more('evidences')}>Mais evidências</Button>:null}
 {retry?<Button disabled={busy} onClick={()=>void send(pending.current!)}>Repetir a mesma operação</Button>:null}
 <Button variant="secondary" disabled={busy} onClick={()=>void refresh()}>Atualizar evidências e processo</Button>
 </section>;
}
