'use client';
import {FormEvent,useEffect,useRef,useState} from 'react';
import {Alert,Button,Card} from '@/app/components/ui';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import {PERM} from './types';
import ScenarioComparison from './ScenarioComparison';
import type {Result} from './CalculationPreparation';
type Row={id:string;consumer_unit_id:string;month:string;version:number;status:'DRAFT';note:string;created_by_name?:string|null;created_at:string;payload_hash:string};
type Detail=Row&{result:Result;captureStartedAt:string;captureFinishedAt:string;formulaVersion:string};
type Props={unitId:string;month:string};
export default function ReviewSnapshots(props:Props){return <ScopedReviewSnapshots key={props.unitId+':'+props.month} {...props}/>;}
function ScopedReviewSnapshots({unitId,month}:Props){
 const {hasPermission}=useAuth();const canCreate=hasPermission(PERM.create);
 const [rows,setRows]=useState<Row[]|null>(null),[next,setNext]=useState<string|null>(null),[detail,setDetail]=useState<Detail|null>(null),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const sequence=useRef(0),pending=useRef<{id:string;note:string}|null>(null);
 useEffect(()=>()=>{sequence.current++;},[]);
 const scope=(r:Row)=>r.consumer_unit_id===unitId&&r.month===month;
 async function history(more=false){const seq=++sequence.current;setBusy(true);setError('');try{const r=await apiRequest<{rows:Row[];nextBeforeVersion:string|null}>('/api/v1/calculation-review-snapshots?consumerUnitId='+encodeURIComponent(unitId)+'&month='+encodeURIComponent(month)+(more&&next?'&beforeVersion='+next:''));if(sequence.current!==seq)return;if(!Array.isArray(r.rows)||!r.rows.every(scope))throw Error('O histórico não corresponde à unidade e competência.');setRows(old=>more?[...(old||[]),...r.rows]:r.rows);setNext(r.nextBeforeVersion);}catch(e){if(sequence.current===seq)setError(e instanceof Error?e.message:'Histórico indisponível.');}finally{if(sequence.current===seq)setBusy(false);}}
 async function open(id:string){const seq=++sequence.current;setBusy(true);setError('');setDetail(null);try{const r=await apiRequest<Detail>('/api/v1/calculation-review-snapshots/'+encodeURIComponent(id));if(sequence.current!==seq)return;if(!scope(r)||r.result.unit.id!==unitId||r.result.month!==month)throw Error('A revisão não corresponde à seleção.');setDetail(r);}catch(e){if(sequence.current===seq)setError(e instanceof Error?e.message:'Revisão indisponível.');}finally{if(sequence.current===seq)setBusy(false);}}
 async function save(e:FormEvent){e.preventDefault();if(!canCreate||busy)return;const clean=note.trim();if(clean.length<3)return;const seq=++sequence.current;setBusy(true);setError('');setMessage('');if(!pending.current||pending.current.note!==clean)pending.current={id:crypto.randomUUID(),note:clean};try{const r=await apiRequest<Detail>('/api/v1/calculation-review-snapshots',{method:'POST',body:JSON.stringify({consumerUnitId:unitId,month,requestId:pending.current.id,note:clean})});if(sequence.current!==seq)return;if(!scope(r)||r.result.unit.id!==unitId||r.result.month!==month)throw Error('A revisão não corresponde à seleção.');setDetail(r);setRows(null);setNext(null);setMessage('Revisão '+r.version+' preservada. Os cadastros atuais continuam independentes desta versão.');pending.current=null;setNote('');}catch(e){if(sequence.current===seq)setError(e instanceof Error?e.message:'Não foi possível confirmar a preservação. Tente novamente sem alterar o motivo.');}finally{if(sequence.current===seq)setBusy(false);}}
 return <Card title='Revisões preservadas da unidade'>
 <p>Guarde o diagnóstico, as memórias e as fontes desta competência para revisão interna. Novas correções geram outra versão; o histórico não é reescrito.</p>
 <Alert>Rascunho de revisão. Não aprova a apuração, não publica economia e não gera cobrança. O consolidado de honorários do cliente ainda não faz parte desta versão por unidade.</Alert>
 {canCreate?<form onSubmit={save} className='organizations-create__form'><label>Motivo da revisão<textarea className='ds-input' value={note} minLength={3} maxLength={500} required disabled={busy} onChange={e=>setNote(e.target.value)}/></label><p>Ao preservar, os dados serão consultados novamente. O registro guarda as fontes lidas durante esse intervalo; não representa um fechamento transacional do mês.</p><Button type='submit' disabled={busy||note.trim().length<3}>{busy?'Aguarde...':'Preservar revisão'}</Button></form>:null}
 <Button type='button' disabled={busy} onClick={()=>history()}>Consultar histórico de revisões</Button>
 {error?<Alert variant='error'>{error}</Alert>:null}{message?<p role='status'>{message}</p>:null}
 {rows?.length===0?<p>Nenhuma revisão preservada nesta competência.</p>:null}
 {rows?.map(row=><article className='ds-card' key={row.id}><h3>Revisão {row.version} · Rascunho preservado</h3><p>{row.note}</p><p>Autor: {row.created_by_name||'Nome não disponível'} · {new Date(row.created_at).toLocaleString('pt-BR')}</p><Button type='button' disabled={busy} onClick={()=>open(row.id)}>Abrir revisão {row.version}</Button></article>)}
 {next?<Button type='button' disabled={busy} onClick={()=>history(true)}>Carregar revisões anteriores</Button>:null}
 {detail?<section aria-label='Revisão preservada selecionada'><h3>Revisão {detail.version} · conteúdo preservado</h3><p>{detail.note}</p><p>Autor: {detail.created_by_name||'Nome não disponível'}</p><p>Leitura das fontes: {new Date(detail.captureStartedAt).toLocaleString('pt-BR')} até {new Date(detail.captureFinishedAt).toLocaleString('pt-BR')}.</p><p>{detail.result.counts.blockers} pendência(s) · {detail.result.counts.reviews} ponto(s) de revisão na data da captura.</p><ScenarioComparison key={detail.id} data={detail.result} findingsHref={'#review-findings-'+detail.id}/><details open id={'review-findings-'+detail.id}><summary>Pendências preservadas</summary><ul>{detail.result.findings.map((f,i)=><li key={i}>{f.section}: {f.message}</li>)}</ul></details><details><summary>Identificação de integridade</summary><p>{detail.formulaVersion}</p><p style={{overflowWrap:'anywhere'}}>SHA-256: {detail.payload_hash}</p></details><Button type='button' onClick={()=>setDetail(null)}>Fechar revisão</Button></section>:null}
 </Card>;
}
