'use client';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '@/app/lib/api/client';
import { Alert, Button } from '@/app/components/ui';
import type { WorkDetail } from './WorkControls';
type Reopen={requestId:string;expectedRevision:number;reason:string;checkedDocument:true};
export function ReopenControls({detail,canApprove,onUpdated}:{detail:WorkDetail;canApprove:boolean;onUpdated:(v:WorkDetail)=>void}){
 const [reason,setReason]=useState(''),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(false);
 const alive=useRef(true),flight=useRef(false),pending=useRef<Reopen|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function send(body:Reopen){if(flight.current)return;flight.current=true;pending.current=body;setBusy(true);setError('');setRetry(false);try{const value=await apiRequest<WorkDetail>('/acl-admissions/'+encodeURIComponent(detail.id)+'/reopen',{method:'POST',body});if(alive.current){pending.current=null;onUpdated(value);}}
 catch(e){if(alive.current){setError(e instanceof Error?e.message:'Não foi possível reabrir.');if(e instanceof ApiError&&e.status<500)pending.current=null;else setRetry(true);}}finally{flight.current=false;if(alive.current)setBusy(false);}}
 if(detail.status!=='COMPLETED'||!canApprove)return null;
 return <section aria-label="Reabertura"><h3>Reabrir com histórico preservado</h3>{error?<Alert>{error}</Alert>:null}<p>A reabertura cria um novo processo para esta unidade. Etapas, evidências e aprovações precisam de nova conferência. O processo fechado e seu desempenho serão preservados; o portal acompanhará a nova adesão.</p>
 <label htmlFor="acl-reopen-reason">Justificativa da reabertura</label><textarea id="acl-reopen-reason" value={reason} maxLength={1000} disabled={busy||retry} onChange={e=>{setReason(e.target.value);setChecked(false);}}/>
 <label><input type="checkbox" checked={checked} disabled={busy||retry} onChange={e=>setChecked(e.target.checked)}/> Conferi a necessidade de abrir um novo processo e reiniciar suas etapas.</label>
 <Button disabled={busy||retry||!checked||reason.trim().length<20} onClick={()=>void send({requestId:crypto.randomUUID(),expectedRevision:detail.revision,reason:reason.trim(),checkedDocument:true})}>Criar reabertura</Button>
 {retry?<Button disabled={busy} onClick={()=>void send(pending.current!)}>Repetir a mesma reabertura</Button>:null}</section>;
}
type Performance={id:string;admissionId:string;unitId:string;unitName:string;customerName:string;generation:number;version:number;closedAt:string;calendarMs:number;activeMs:number;responsibles:{actorId:string;actorName:string;activeMs:number}[]};
type Page={rows:Performance[];nextCursor:string|null};
const minutes=(ms:number)=>(ms/60000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' min';
export function PerformanceComparisons({refreshKey}:{refreshKey:string}){
 const [page,setPage]=useState<Page>({rows:[],nextCursor:null}),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const flight=useRef(false),alive=useRef(true),loadGeneration=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{loadGeneration.current++;const abort=new AbortController();setPage({rows:[],nextCursor:null});setSelected([]);setError('');(async()=>{try{const result=await apiRequest<Page>('/acl-admissions/performance',{signal:abort.signal});if(!abort.signal.aborted)setPage(result);}catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível consultar o desempenho.');}})();return()=>abort.abort();},[refreshKey]);
 async function more(){if(flight.current||!page.nextCursor)return;const generation=loadGeneration.current;flight.current=true;setBusy(true);try{const result=await apiRequest<Page>('/acl-admissions/performance?after='+encodeURIComponent(page.nextCursor));if(alive.current&&generation===loadGeneration.current)setPage(old=>({...result,rows:[...old.rows,...result.rows]}));}catch(e){if(alive.current&&generation===loadGeneration.current)setError(e instanceof Error?e.message:'Não foi possível carregar mais versões.');}finally{flight.current=false;if(alive.current)setBusy(false);}}
 const chosen=page.rows.filter(r=>selected.includes(r.id)).sort((a,b)=>a.generation-b.generation||a.version-b.version),before=chosen[0],after=chosen[1];
 return <section aria-label="Comparativos de desempenho"><h2>Comparativos de desempenho</h2><p>Compare duas versões fechadas da mesma unidade. Tempo ativo mede esforço registrado; duração total inclui pausas. Estes valores não representam produtividade individual ou economia financeira.</p>{error?<Alert>{error}</Alert>:null}
 {!page.rows.length&&!error?<p>Nenhuma versão de desempenho encerrada neste escopo.</p>:null}
 <table><thead><tr><th>Comparar</th><th>Cliente e unidade</th><th>Processo / versão</th><th>Tempo ativo</th><th>Duração total</th><th>Encerramento</th></tr></thead><tbody>{page.rows.map(r=><tr key={r.id}><td><input type="checkbox" aria-label={'Comparar '+r.unitName+', processo '+r.generation+', versão '+r.version} checked={selected.includes(r.id)} disabled={!selected.includes(r.id)&&(selected.length>=2||!!before&&before.unitId!==r.unitId)} onChange={e=>setSelected(old=>e.target.checked?[...old,r.id]:old.filter(id=>id!==r.id))}/></td><td>{r.customerName} · {r.unitName}</td><td>{r.generation} / {r.version}</td><td>{minutes(r.activeMs)}</td><td>{minutes(r.calendarMs)}</td><td>{new Date(r.closedAt).toLocaleString('pt-BR')}</td></tr>)}</tbody></table>
 {before&&after?<p>Variação de esforço entre os processos {before.generation} e {after.generation}: {minutes(after.activeMs-before.activeMs)}. Variação da duração total: {minutes(after.calendarMs-before.calendarMs)}.</p>:null}
 {chosen.map(r=><article key={r.id}><h3>{r.unitName} · processo {r.generation}</h3><ul>{r.responsibles.map(a=><li key={a.actorId}>{a.actorName}: {minutes(a.activeMs)} de atividade registrada.</li>)}</ul></article>)}
 {page.nextCursor?<Button variant="secondary" disabled={busy} onClick={()=>void more()}>Mais versões de desempenho</Button>:null}</section>;
}
