'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/app/providers';
import { apiRequest } from '@/app/lib/api/client';
import { Alert, Button } from '@/app/components/ui';
import styles from './workspace.module.css';
type Page<T>={rows:T[];nextCursor:string|null};
type Candidate={unitId:string;customerId:string;unitName:string;customerName:string};
type Registry={id:string;customerName:string;unitName:string;status:string;revision:number};
type Detail={id:string;status:string;revision:number;stages:{key:string;status:string;elapsedMs:number}[]};
type Access={enabled:boolean;canWork:boolean;canApprove:boolean};
const stageNames:Record<string,string>={registration:'Cadastro',invoices:'Faturas',feasibility:'Viabilidade',modality:'Modalidade',contracts:'Contratação',termination:'Denúncia',metering:'Medição',custody:'Conta e adesão',technical:'Habilitação técnica','contract-registration':'Registro de contratos',validation:'Validação',supply:'Início do suprimento'};
const statuses:Record<string,string>={DRAFT:'Registrada',IN_PROGRESS:'Em andamento',COMPLETED:'Concluída',NOT_STARTED:'Não iniciada',RUNNING:'Em atividade',PAUSED:'Pausada',SKIPPED:'Dispensada'};
function Workspace(){
 const [access,setAccess]=useState<Access|null>(null),[records,setRecords]=useState<Page<Registry>>({rows:[],nextCursor:null}),[candidates,setCandidates]=useState<Page<Candidate>>({rows:[],nextCursor:null});
 const [selection,setSelection]=useState(''),[detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const request=useRef<{selection:string;id:string}|null>(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;const abort=new AbortController();(async()=>{
  try{const a=await apiRequest<Access>('/acl-admissions/access',{signal:abort.signal});if(abort.signal.aborted)return;setAccess(a);
   if(a.enabled){const [r,c]=await Promise.all([apiRequest<Page<Registry>>('/acl-admissions',{signal:abort.signal}),apiRequest<Page<Candidate>>('/acl-admissions/candidates',{signal:abort.signal})]);if(!abort.signal.aborted){setRecords(r);setCandidates(c);}}
  }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível consultar as adesões.');}
 })();return()=>{mounted.current=false;abort.abort();};},[]);
 async function create(){const selected=candidates.rows.find(c=>c.unitId===selection);if(!selected||busy||!access?.canWork)return;setBusy(true);setError('');
  if(!request.current||request.current.selection!==selection)request.current={selection,id:crypto.randomUUID()};
  try{const result=await apiRequest<Detail>('/acl-admissions',{method:'POST',body:{requestId:request.current.id,customerId:selected.customerId,unitId:selected.unitId}});
   if(!mounted.current)return;request.current=null;setSelection('');setDetail(result);
   const [r,c]=await Promise.all([apiRequest<Page<Registry>>('/acl-admissions'),apiRequest<Page<Candidate>>('/acl-admissions/candidates')]);if(mounted.current){setRecords(r);setCandidates(c);}
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Não foi possível registrar a adesão.');}finally{if(mounted.current)setBusy(false);}}
 async function open(id:string){setBusy(true);setError('');setDetail(null);try{const value=await apiRequest<Detail>('/acl-admissions/'+encodeURIComponent(id));if(mounted.current)setDetail(value);}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Não foi possível consultar o processo.');}finally{if(mounted.current)setBusy(false);}}
 async function more(kind:'records'|'candidates'){const page=kind==='records'?records:candidates;if(!page.nextCursor||busy)return;setBusy(true);setError('');
  try{if(kind==='records'){const v=await apiRequest<Page<Registry>>('/acl-admissions?after='+encodeURIComponent(page.nextCursor));if(mounted.current)setRecords(old=>({...v,rows:[...old.rows,...v.rows]}));}
   else{const v=await apiRequest<Page<Candidate>>('/acl-admissions/candidates?after='+encodeURIComponent(page.nextCursor));if(mounted.current)setCandidates(old=>({...v,rows:[...old.rows,...v.rows]}));}
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Não foi possível consultar mais unidades.');}finally{if(mounted.current)setBusy(false);}}
 return <section className={styles.workspace}><header><h1>Adesão ACL</h1><p>Acompanhe a migração das unidades para o Mercado Livre de Energia.</p></header>
 {error?<Alert>{error}</Alert>:null}
 {!access&&!error?<p role="status">Carregando adesões…</p>:null}
 {access&&!access.enabled?<Alert>Adesão ACL indisponível nesta organização. Consulte a equipe de gestão.</Alert>:null}
 {access?.enabled?<>
 {access.canWork?<section className={styles.panel}><h2>Inserir adesão</h2><label htmlFor="acl-unit">Cliente e unidade</label><select id="acl-unit" value={selection} disabled={busy} onChange={e=>{setSelection(e.target.value);request.current=null;}}><option value="">Selecione uma unidade elegível</option>{candidates.rows.map(c=><option key={c.unitId} value={c.unitId}>{c.customerName} — {c.unitName}</option>)}</select>
 <Button disabled={busy||!selection} onClick={()=>void create()}>{busy?'Aguarde…':'Inserir adesão'}</Button>{candidates.nextCursor?<Button variant="secondary" disabled={busy} onClick={()=>void more('candidates')}>Mais unidades disponíveis</Button>:null}
 <p>Selecione uma unidade cadastrada em ACR, do Grupo A e sem adesão registrada.</p></section>:null}
 <section className={styles.panel}><h2>Adesões registradas</h2>{!records.rows.length?<p>Nenhuma adesão registrada neste escopo.</p>:<div className={styles.table}><table><thead><tr><th>Cliente</th><th>Unidade</th><th>Status</th><th>Processo</th></tr></thead><tbody>{records.rows.map(r=><tr key={r.id}><td>{r.customerName}</td><td>{r.unitName}</td><td>{statuses[r.status]||r.status}</td><td><Button variant="secondary" disabled={busy} onClick={()=>void open(r.id)}>Ver processo</Button></td></tr>)}</tbody></table></div>}{records.nextCursor?<Button variant="secondary" disabled={busy} onClick={()=>void more('records')}>Ver mais adesões</Button>:null}</section>
 {detail?<section className={styles.panel}><h2>Fluxo da adesão</h2><p>Status: {statuses[detail.status]||detail.status} · Versão {detail.revision}</p><ol className={styles.stages}>{detail.stages.map(s=><li key={s.key}><strong>{stageNames[s.key]||s.key}</strong><span>{statuses[s.status]||s.status}</span><small>Tempo ativo: {Math.floor(s.elapsedMs/60000)} min</small></li>)}</ol></section>:null}
 </>:null}</section>;
}
export default function AclAdmissionsPage(){const {context}=useAuth();if(!context||context.scope!=='organization')return <Alert>Selecione uma organização para consultar as adesões.</Alert>;
 return <Workspace key={JSON.stringify([context.user.id,context.currentOrganization.id,context.currentOrganization.role,context.currentOrganization.permissions,context.accessMode])}/>;}
