'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button,Card,Input} from '@/app/components/ui';
import {Binding,BindingIdentity} from './BindingEvidence';
import DriCostPreparation from './DriCostPreparation';
const base='/api/v1/ccee-data/dri';
type Job={id:string;kind:string;state:string;created_at:string;error_code?:string;result?:{data:{rows:any[];sourceHash:string;financialState:string;providerRows?:number;repeatedRows?:number}};request_payload?:any};
type Scoped={organizationId:string;jobs?:Job[];job?:Job};
export default function DriWorkspace({organizationId,bindings,enabled,canManage}:{organizationId:string;bindings:Binding[];enabled:boolean;canManage:boolean}){
 const [binding,setBinding]=useState(''),[month,setMonth]=useState(''),[jobs,setJobs]=useState<Job[]>([]),[detail,setDetail]=useState<Job|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');const generation=useRef(0);
 useEffect(()=>{generation.current++;setBinding('');setMonth('');setJobs([]);setDetail(null);setError('');setMessage('');setBusy(false);return()=>{generation.current++;};},[organizationId]);
 function scope(value:Scoped){if(value.organizationId!==organizationId)throw Error('Resposta fora da organização ativa.');return value;}
 function change(){generation.current++;setJobs([]);setDetail(null);setError('');setMessage('');setBusy(false);}
 async function run(action:()=>Promise<void>){if(busy)return;const g=generation.current;setBusy(true);setError('');try{await action();}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Resultado não confirmado; confira o histórico.');}finally{if(g===generation.current)setBusy(false);}}
 async function load(){const g=generation.current;const v=scope(await apiRequest<Scoped>(base+'?authorizationId='+encodeURIComponent(binding)+'&month='+encodeURIComponent(month)));if(g===generation.current)setJobs(v.jobs??[]);}
 async function show(id:string){const g=generation.current;const v=scope(await apiRequest<Scoped>(base+'/jobs/'+id));if(g===generation.current)setDetail(v.job??null);}
 async function enqueue(kind:string,selection:Record<string,string>={}){const g=generation.current;scope(await apiRequest<Scoped>(base+'/jobs',{method:'POST',body:{requestId:crypto.randomUUID(),authorizationId:binding,month,kind,...selection}}));if(g===generation.current){setMessage('Consulta registrada. Atualize o histórico para acompanhar; nenhuma alteração financeira foi feita.');await load();}}
 const selected=bindings.find(b=>b.id===binding);
 return <Card title="Resultados contábeis CCEE · DRI"><p>Eventos, relatórios e quadros com fonte preservada. Valores do agente não são rateados por unidade nem adicionados automaticamente ao fechamento. Valor a liquidar não comprova pagamento.</p>
 {!enabled?<Alert>DRI implantada e desligada. Nenhuma consulta será iniciada.</Alert>:<>
 {error&&<Alert variant="error">{error}</Alert>}{message&&<p role="status">{message}</p>}
 <form onSubmit={e=>{e.preventDefault();void run(load);}} style={{display:'grid',gap:12,maxWidth:850}}>
 <label>Vínculo com escopo DRI revisado<select required value={binding} onChange={e=>{change();setBinding(e.target.value);}}><option value="">Selecione</option>{bindings.filter(b=>b.status==='APPROVED'&&b.service_scope.includes('DRI_READ')).map(b=><option key={b.id} value={b.id}>{b.customer_name||b.customer_id} · perfil {b.profile_code} · agente {b.dri_agent_code}</option>)}</select></label>
 {selected&&<p><BindingIdentity binding={selected}/> · Consulta no escopo do agente; unidade apenas identifica o vínculo autorizado.</p>}
 <Input label="Competência encerrada" type="month" value={month} onChange={e=>{change();setMonth(e.target.value);}} required/>
 <Button type="submit" disabled={busy||!binding||!month}>Atualizar consultas DRI</Button>
 {canManage&&<Button type="button" disabled={busy||!binding||!month} onClick={()=>void run(()=>enqueue('DRI_EVENTS'))}>Consultar eventos divulgados</Button>}</form>
 <p>Últimas 25 consultas deste vínculo e competência. Consultas maiores que os limites permanecem sem consolidação.</p>
 {jobs.map(j=><p key={j.id}>{j.kind} · {j.state} {j.error_code&&'· '+j.error_code} <Button variant="secondary" disabled={busy} onClick={()=>void run(()=>show(j.id))}>Conferir fonte e resultado</Button></p>)}
 {detail&&<section aria-label="Fonte DRI selecionada"><Button variant="secondary" onClick={()=>setDetail(null)}>Fechar resultado DRI</Button><h3>{detail.kind} · {detail.state}</h3><p>Consulta {detail.id}</p>
 {detail.error_code&&<Alert variant="error">Consulta não concluída: {detail.error_code}</Alert>}
 {detail.result&&<><p>SHA-256: <span style={{overflowWrap:'anywhere'}}>{detail.result.data.sourceHash}</span></p>
 {detail.kind==='DRI_EVENTS'&&detail.result.data.providerRows!==undefined&&<p>{detail.result.data.rows.length} eventos únicos · {detail.result.data.providerRows} linhas originais · {detail.result.data.repeatedRows??0} ocorrências integralmente iguais agrupadas. Hashes originais preservados; conteúdo divergente interrompe a leitura.</p>}
 {detail.kind==='DRI_EVENTS'&&detail.result.data.rows.map(e=><p key={e.code}>{e.name} · {e.month} {canManage&&detail.state==='SUCCEEDED'&&<Button disabled={busy} onClick={()=>void run(()=>enqueue('DRI_REPORTS',{parentJobId:detail.id,eventCode:e.code}))}>Consultar relatórios deste evento</Button>}</p>)}
 {detail.kind==='DRI_REPORTS'&&detail.result.data.rows.map(r=><details key={r.id}><summary>{r.name} · {r.id}</summary><p>{r.description} · Vigência {r.period.start} a {r.period.end??'sem término informado'}</p>{r.frames.map((f:any)=><div key={f.id}><p>{f.name} · {f.description} · Parâmetros: {f.parameters.join(', ')||'nenhum'}</p>{canManage&&<Button disabled={busy||detail.state!=='SUCCEEDED'||!f.parameters.includes('CODIGO_AGENTE')||f.parameters.some((p:string)=>!['CODIGO_AGENTE','CODIGO_EVENTO_CONTABIL'].includes(p))} onClick={()=>void run(()=>enqueue('DRI_RESULTS',{parentJobId:detail.id,eventCode:detail.request_payload.eventCode,reportId:r.id,frameId:f.id}))}>Consultar resultado deste quadro</Button>}</div>)}</details>)}
 {detail.kind==='DRI_RESULTS'&&<><Alert>Classificação financeira pendente para rubricas não homologadas. Dados no escopo do agente, sem incorporação automática ao fechamento. Campos vazios não significam zero.</Alert><p>{detail.result.data.rows.length} linhas preservadas. Exibindo até 50 nesta prévia.</p>{detail.result.data.rows.slice(0,50).map((r,i)=><details key={i}><summary>Linha {i+1} · relatório {r.reportId} · quadro {r.frameId}</summary><dl>{r.columns.map((c:string,k:number)=><div key={k}><dt>{c}</dt><dd style={{overflowWrap:'anywhere'}}>{r.cells[k]||'Não informado na fonte'}</dd></div>)}</dl></details>)}{canManage&&detail.state==='SUCCEEDED'&&detail.request_payload?.reportId==='114'&&detail.request_payload?.frameId==='451'&&<DriCostPreparation key={detail.id} organizationId={organizationId} jobId={detail.id}/>}</>}
 </>}
 </section>}
 </>}
 </Card>;
}
