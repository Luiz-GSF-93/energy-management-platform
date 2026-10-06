'use client';
import {FormEvent,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {apiRequest,ApiError} from '@/app/lib/api/client';
import {Alert,Button} from '@/app/components/ui';
import EvidenceThread from '@/app/components/EvidenceThread';
import type {WorkDetail} from './WorkControls';
type Row={id:string;stageKey:string;requestRecordId:string;agendaRecordId:string;number:number;title:string;status:string;dueAt:string;responseCount:number};
type Page={rows:Row[];nextCursor:string|null};
const names:Record<string,string>={registration:'Cadastro',invoices:'Faturas',feasibility:'Viabilidade',modality:'Modalidade',contracts:'Contratação',termination:'Denúncia',metering:'Medição',custody:'Conta e adesão',technical:'Habilitação técnica','contract-registration':'Registro de contratos',validation:'Validação',supply:'Início do suprimento'};
const states:Record<string,string>={OPEN:'Aberta',IN_PROGRESS:'Em andamento',WAITING:'Aguardando',DONE:'Concluída',CANCELLED:'Cancelada'};
export default function RequestControls({detail,actorId,canCreate}:{detail:WorkDetail;actorId:string;canCreate:boolean}){
 const [page,setPage]=useState<Page>({rows:[],nextCursor:null}),[owners,setOwners]=useState<{id:string;name:string}[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0),[opened,setOpened]=useState(''),[editing,setEditing]=useState(false),[uncertain,setUncertain]=useState(false);
 const alive=useRef(true),flight=useRef(false),attempt=useRef<{key:string;body:Record<string,unknown>}|null>(null);
 const path='/api/v1/acl-admissions/'+encodeURIComponent(detail.id)+'/requests';
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{const abort=new AbortController();setLoading(true);setError('');void(async()=>{try{const [list,people]=await Promise.all([apiRequest<Page>(path,{signal:abort.signal}),canCreate?apiRequest<typeof owners>('/api/v1/operations/responsible',{signal:abort.signal}):Promise.resolve([])]);if(!abort.signal.aborted){setPage(list);setOwners(people);}}catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível consultar solicitações.');}finally{if(!abort.signal.aborted)setLoading(false);}})();return()=>abort.abort();},[path,canCreate,refresh]);
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(flight.current)return;
 let request=attempt.current;
 if(!uncertain){
 const f=new FormData(event.currentTarget),due=String(f.get('due'));if(!due||!Number.isFinite(Date.parse(due))){setError('Informe um prazo válido.');return;}
 const values={expectedRevision:detail.revision,stageKey:String(f.get('stage')),subject:String(f.get('subject')).trim(),body:String(f.get('body')).trim(),dueAt:new Date(due).toISOString(),responsibleId:String(f.get('responsible')),priority:String(f.get('priority')),requestType:String(f.get('type')),reason:String(f.get('reason')).trim(),checked:f.get('checked')==='on'},key=JSON.stringify(values);
 if(request&&request.key!==key){setError('Confira a tentativa anterior antes de alterar o pedido.');return;}
 request=request??{key,body:{...values,requestId:crypto.randomUUID()}};
 }
 if(!request)return;
 attempt.current=request;flight.current=true;setBusy(true);setError('');setNotice('');
 try{const result=await apiRequest<{requestRecordId:string}>(path,{method:'POST',body:request.body});if(alive.current){attempt.current=null;setUncertain(false);setEditing(false);setOpened(result.requestRecordId);setRefresh(v=>v+1);setNotice('Solicitação disponibilizada no portal e prazo registrado na Agenda. Nenhuma mensagem externa foi enviada.');window.dispatchEvent(new Event('operations-updated'));}}
 catch(e){if(alive.current){setError(e instanceof Error?e.message:'Não foi possível confirmar a solicitação.');if(e instanceof ApiError&&e.status<500){attempt.current=null;setUncertain(false);}else setUncertain(true);}}finally{flight.current=false;if(alive.current)setBusy(false);}
 }
 async function more(){if(!page.nextCursor||flight.current)return;flight.current=true;setBusy(true);setError('');try{const result=await apiRequest<Page>(path+'?after='+encodeURIComponent(page.nextCursor));if(alive.current)setPage(old=>({...result,rows:[...old.rows,...result.rows]}));}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Falha ao consultar mais solicitações.');}finally{flight.current=false;if(alive.current)setBusy(false);}}
 const available=detail.stages.filter(s=>!['COMPLETED','SKIPPED'].includes(s.status));
 return <section aria-label="Solicitações da adesão"><h3>Solicitações e prazos</h3><p>Solicite documentos ou informações na área de solicitações do portal. Respostas e arquivos ficam privados; o recebimento não aprova nem conclui uma etapa. Conclua ou cancele os pedidos e prazos vinculados antes de encerrar a adesão.</p><p>O prazo usa o horário do seu dispositivo e será exibido em Brasília no pedido. Para corrigir o conteúdo ou prazo já compartilhado, cancele os registros em Solicitações e Agenda e crie um novo pedido.</p>
 <Link href="/backoffice/operation/requests">Consultar Solicitações</Link>{' · '}<Link href="/backoffice/operation/agenda">Consultar Agenda</Link>
 {error?<Alert>{error}</Alert>:null}{notice?<p role="status">{notice}</p>:null}{loading?<p role="status">Consultando solicitações…</p>:null}
 {canCreate&&detail.status!=='COMPLETED'&&available.length>0&&!editing?<Button disabled={loading||busy} onClick={()=>{attempt.current=null;setNotice('');setEditing(true);}}>Solicitar ao cliente</Button>:null}
 {editing?<form onSubmit={submit}><fieldset disabled={busy}><legend>Nova solicitação no portal</legend><fieldset disabled={uncertain}>
 <label>Etapa da adesão<select name="stage" required>{available.map(s=><option key={s.key} value={s.key}>{names[s.key]}</option>)}</select></label>
 <label>Tipo<select name="type"><option value="DOCUMENT">Documento</option><option value="INFORMATION">Informação</option><option value="INVOICE">Complemento de fatura</option></select></label>
 <label>Assunto que o cliente verá<input name="subject" required minLength={3} maxLength={160}/></label>
 <label>Pedido que o cliente verá<textarea name="body" required minLength={10} maxLength={5000}/></label>
 <label>Prazo para resposta<input name="due" type="datetime-local" required/></label>
 <label>Responsável interno<select name="responsible" defaultValue={actorId}><option value={actorId}>Eu</option>{owners.filter(o=>o.id!==actorId).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
 <label>Prioridade<select name="priority" defaultValue="NORMAL"><option value="LOW">Baixa</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label>
 <label>Justificativa interna<textarea name="reason" required minLength={10} maxLength={500}/></label>
 <label><input name="checked" type="checkbox" required/>Conferi o destinatário, o texto e o prazo. Autorizo disponibilizar este pedido ao cliente no portal.</label>
 </fieldset><p>O cliente receberá somente o assunto, o pedido e o prazo. A justificativa interna permanece no backoffice. Não será enviado e-mail, SMS ou WhatsApp nesta operação.</p>
 <Button type="submit" disabled={busy}>{uncertain?'Confirmar a mesma tentativa':'Salvar e disponibilizar no portal'}</Button><Button type="button" variant="secondary" disabled={busy||uncertain} onClick={()=>{attempt.current=null;setEditing(false);}}>Cancelar edição</Button></fieldset></form>:null}
 {!loading&&!error&&!page.rows.length?<p>Nenhuma solicitação vinculada a esta adesão.</p>:null}
 {page.rows.length?<table><thead><tr><th>Pedido</th><th>Etapa</th><th>Status</th><th>Prazo</th><th>Respostas</th><th>Detalhes</th></tr></thead><tbody>{page.rows.map(r=><tr key={r.id}><td>#{r.number} · {r.title}</td><td>{names[r.stageKey]}</td><td>{states[r.status]||r.status}</td><td>{new Date(r.dueAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</td><td>{r.responseCount}</td><td><Button type="button" variant="secondary" onClick={()=>setOpened(r.requestRecordId)}>Ver pedido e respostas</Button></td></tr>)}</tbody></table>:null}
 {page.nextCursor?<Button disabled={busy} variant="secondary" onClick={()=>void more()}>Mais solicitações</Button>:null}<Button disabled={busy||loading} variant="secondary" onClick={()=>setRefresh(v=>v+1)}>Atualizar solicitações</Button>
 {opened?<><Button variant="secondary" onClick={()=>setOpened('')}>Fechar pedido</Button><EvidenceThread key={opened} id={opened} kind="requests" canUpload={false}/></>:null}
 </section>;
}
