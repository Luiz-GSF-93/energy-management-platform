'use client';
import {FormEvent,useEffect,useState} from 'react';
import {Alert,Button,Card} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
import AuditAuthor from './AuditAuthor';
type Row={id:string;scenario:string;version:number;absent:boolean;source_reference:string;reason:string;created_by:string;created_by_name?:string|null;created_at:string};
type Data={rows:Row[];active:{id:string}[];costId:string|null;costRevision:number|null;canValidate:boolean};
export default function ScenarioCostAbsence({unitId,month,canUpdate,refreshKey,onDirty}:{unitId:string;month:string;canUpdate:boolean;refreshKey:string;onDirty:(v:boolean)=>void}){
 const [data,setData]=useState<Data|null>(null),[scenario,setScenario]=useState('ACR'),[absent,setAbsent]=useState(true),[source,setSource]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const url='/api/v1/calculation-monthly-costs/absences';
 async function load(){const d=await apiRequest<Data>(url+'?consumerUnitId='+encodeURIComponent(unitId)+'&month='+encodeURIComponent(month));setData(d);}
 useEffect(()=>{let cancelled=false;setData(null);setError('');setMessage('');setSource('');setReason('');setConfirmed(false);apiRequest<Data>(url+'?consumerUnitId='+encodeURIComponent(unitId)+'&month='+encodeURIComponent(month)).then(d=>{if(!cancelled)setData(d);}).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Declarações indisponíveis.');});return()=>{cancelled=true;};},[unitId,month,refreshKey]);
 async function save(e:FormEvent){e.preventDefault();if(!data||busy||!confirmed)return;setBusy(true);setError('');setMessage('');try{const prior=data.rows.find(r=>r.scenario===scenario);await apiRequest(url,{method:'POST',body:{consumerUnitId:unitId,month,scenario,absent,previousId:prior?.id??null,costId:data.costId,costRevision:data.costRevision,sourceReference:source,reason}});await load();setConfirmed(false);setSource('');setReason('');onDirty(false);setMessage('Declaração salva no histórico. Atualize Preparar apuração para recalcular. Os rascunhos de custos mantêm seu estado.');}catch(e){setError(e instanceof Error?e.message:'Não foi possível registrar.');}finally{setBusy(false);}}
 const dirty=()=>{onDirty(true);setConfirmed(false);setMessage('');};
 return <Card title='Ausência de custos adicionais por cenário'>
 <p>Declare somente após conferir a unidade e a competência. A declaração não substitui tarifas, tributos, nota do fornecedor ou honorários, nem valida rascunhos. Uma alteração nos custos ou no cadastro elétrico exige nova conferência.</p>
 {error&&<Alert variant='error'>{error}</Alert>}{message&&<Alert>{message}</Alert>}
 {data&&canUpdate&&data.canValidate&&<form onSubmit={save}><fieldset disabled={busy} className='organizations-create__form'>
 <label>Cenário da declaração<select className='ds-input' value={scenario} onChange={e=>{setScenario(e.target.value);dirty();}}><option value='ACR'>ACR</option><option value='ACL'>ACL</option></select></label>
 <label>Declaração<select className='ds-input' value={absent?'ABSENT':'REVOKE'} onChange={e=>{setAbsent(e.target.value==='ABSENT');dirty();}}><option value='ABSENT'>Conferido: sem custos ou créditos adicionais neste cenário</option><option value='REVOKE'>Revogar declaração anterior: requer nova conferência</option></select></label>
 <label>Fonte da conferência<textarea className='ds-input' required maxLength={2000} value={source} onChange={e=>{setSource(e.target.value);dirty();}}/></label>
 <label>Justificativa da declaração<textarea className='ds-input' required minLength={20} maxLength={2000} value={reason} onChange={e=>{setReason(e.target.value);dirty();}}/></label>
 <label><input type='checkbox' checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);onDirty(true);}}/> Conferi a unidade, a competência e o cenário desta declaração.</label>
 <Button type='submit' disabled={busy||!confirmed}>{busy?'Salvando...':'Registrar declaração por cenário'}</Button>
 <Button type='button' disabled={busy} onClick={()=>{setSource('');setReason('');setConfirmed(false);onDirty(false);setError('');setMessage('Edição descartada. O histórico permanece preservado.');}}>Descartar edição da declaração</Button>
 </fieldset></form>}
 {data&&<details open><summary>Histórico das declarações ({data.rows.length})</summary>{!data.rows.length?<p>Nenhuma declaração por cenário registrada.</p>:data.rows.map(r=><article className='ds-card' key={r.id}><h4>{r.scenario} · versão {r.version} · {data.active.some(a=>a.id===r.id)?'Ausência confirmada':r.absent?'Histórico — requer nova conferência se necessário':'Declaração revogada'}</h4><p>{r.reason}</p><p>Fonte: {r.source_reference}</p><p>Autor: <AuditAuthor id={r.created_by} name={r.created_by_name} record={r} field="created_by"/> · {new Date(r.created_at).toLocaleString('pt-BR')}</p></article>)}</details>}
 </Card>;
}
