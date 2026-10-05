'use client';


import {FormEvent,useEffect,useRef,useState} from 'react';


import BackofficeShell from '@/app/components/BackofficeShell';


import ProtectedRoute from '@/app/components/ProtectedRoute';


import {Alert,Button,Card,Input} from '@/app/components/ui';


import {apiRequest} from '@/app/lib/api/client';


import {useAuth} from '@/app/providers';


import styles from './trading.module.css';


type RecordRow={id:string;kind:'supplier'|'opportunity'|'proposal';parent_id:string|null;status:string;revision:number;data:Record<string,any>;created_at:string};


type Comparison={id:string;supplierId:string;rank:number;priceBrlMwh:number;energyMonthlyBrl:number;estimatedSavingBrl:number|null;npvBrl:number|null;paybackMonths:number|null;estimateBasis:string};


type State={rows:RecordRow[];canManage:boolean;canApprove:boolean;comparisons:{opportunityId:string;rows:Comparison[]}[]};


const money=(v:number|null)=>v==null?'Base não informada':v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});


const energyLabels:Record<string,string>={CONVENTIONAL:'Convencional',INCENTIVIZED_50:'Incentivada 50%',INCENTIVIZED_100:'Incentivada 100%'};


const statusLabels:Record<string,string>={DRAFT:'Rascunho',ACTIVE:'Ativo',INACTIVE:'Inativo',OPEN:'Aberta',ANALYSIS:'Em análise',RECEIVED:'Recebida',MANAGER_APPROVED:'Aprovada pelo gestor',CLIENT_APPROVED:'Aprovada pelo cliente',CONTRACTED:'Contratada',CLOSED:'Encerrada',DECLINED:'Não participa',REJECTED:'Rejeitada',CANCELLED:'Cancelada'};


function Hub(){


 const {context}=useAuth();const org=context?.scope==='organization'?context.currentOrganization.id:'';


 const [state,setState]=useState<State|null>(null),[tab,setTab]=useState('dashboard'),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[documents,setDocuments]=useState<any[]>([]),[customers,setCustomers]=useState<any[]>([]),[units,setUnits]=useState<any[]>([]),[customerId,setCustomerId]=useState(''),[unitId,setUnitId]=useState(''),[history,setHistory]=useState<any[]>([]),[period,setPeriod]=useState('month');


 const [invitations,setInvitations]=useState<any[]>([]),[inviteFor,setInviteFor]=useState<RecordRow|null>(null),[contractFor,setContractFor]=useState<RecordRow|null>(null);const contractDialog=useRef<HTMLDialogElement>(null);const inviteDialog=useRef<HTMLDialogElement>(null);


 const [editing,setEditing]=useState<{kind:RecordRow['kind'];row?:RecordRow;parentId?:string;readOnly?:boolean}|null>(null);const dialog=useRef<HTMLDialogElement>(null);


 async function load(){const [hub,inv]=await Promise.all([apiRequest<State>('/api/v1/trading-hub'),apiRequest<any[]>('/api/v1/trading-hub/invitations')]);setState(hub);setInvitations(inv);}


 useEffect(()=>{setState(null);setError('');let stop=false;Promise.all([apiRequest<State>('/api/v1/trading-hub'),apiRequest<any[]>('/api/v1/trading-hub/invitations')]).then(([v,i])=>{if(!stop){setState(v);setInvitations(i);}}).catch(e=>{if(!stop)setError(e.message);});return()=>{stop=true;};},[org]);


 useEffect(()=>{if(contractFor&&!contractDialog.current?.open)contractDialog.current?.showModal();},[contractFor]);
 useEffect(()=>{if(inviteFor&&!inviteDialog.current?.open)inviteDialog.current?.showModal();},[inviteFor]);


 useEffect(()=>{if(editing&&!dialog.current?.open)dialog.current?.showModal();},[editing]);


 async function open(kind:RecordRow['kind'],row?:RecordRow,parentId?:string){setError('');setHistory([]);setCustomerId(row?.data.customerId??'');setUnitId(row?.data.unitId??'');setEditing({kind,row,parentId,readOnly:!!row&&!(['DRAFT','RECEIVED'].includes(row.status)||(kind==='supplier'&&row.status==='ACTIVE'))});try{if(kind!=='supplier')setDocuments(await apiRequest<any[]>('/api/v1/trading-hub/documents'));if(kind==='opportunity')setCustomers(await apiRequest<any[]>('/api/v1/customers'));if(row)setHistory(await apiRequest<any[]>('/api/v1/trading-hub/'+row.id+'/history'));}catch(e){setError(e instanceof Error?e.message:'Falha na consulta.');}}


 useEffect(()=>{setUnits([]);if(!customerId)return;let stop=false;apiRequest<any[]>('/api/v1/consumer-units?customerId='+encodeURIComponent(customerId)).then(v=>{if(!stop)setUnits(v.filter(u=>u.customer_id===customerId));}).catch(e=>{if(!stop)setError(e.message);});return()=>{stop=true;};},[customerId]);


 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy||!editing)return;const f=new FormData(e.currentTarget),data:Record<string,any>={};f.forEach((v,k)=>{if(k!=='reason')data[k]=String(v).trim();});if(editing.kind==='supplier'){data.quotationContacts=String(data.quotationContacts).split('\n').filter(Boolean).map(line=>{const i=line.lastIndexOf(';');return {name:line.slice(0,i).trim(),email:line.slice(i+1).trim()};});}else{data.documents=f.getAll('documents').map(String);for(const k of ['averageMwhMonth','months','priceBrlMwh','acrMonthlyBrl','aclOtherMonthlyBrl','investmentBrl','discountAnnualPercent'])if(k in data){if(data[k]==='')delete data[k];else data[k]=Number(data[k]);}if(data.expiresAt)data.expiresAt=new Date(data.expiresAt).toISOString();}


  setBusy(true);setError('');try{await apiRequest('/api/v1/trading-hub/'+editing.kind+(editing.row?'/'+editing.row.id:''),{method:editing.row?'PUT':'POST',body:{data,revision:editing.row?.revision??0,parentId:editing.parentId??editing.row?.parent_id,reason:String(f.get('reason'))}});await load();dialog.current?.close();setEditing(null);setMessage('Registro salvo com histórico e auditoria.');}catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setBusy(false);}}


 async function transition(row:RecordRow,status:string,reason:string){if(busy)return;setBusy(true);setError('');try{await apiRequest('/api/v1/trading-hub/records/'+row.id+'/transition',{method:'POST',body:{revision:row.revision,status,reason}});await load();setMessage('Estado atualizado com auditoria.');}catch(e){setError(e instanceof Error?e.message:'Falha na transição.');}finally{setBusy(false);}}


 async function recordContract(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy||!contractFor)return;const f=new FormData(e.currentTarget);setBusy(true);setError('');try{await apiRequest('/api/v1/trading-hub/proposals/'+contractFor.id+'/contract',{method:'POST',body:{revision:contractFor.revision,documentId:String(f.get('documentId')),reference:String(f.get('reference')),reason:String(f.get('reason'))}});await load();contractDialog.current?.close();setMessage('Formalização registrada com evidência e auditoria.');}catch(e){setError(e instanceof Error?e.message:'Falha no registro.');}finally{setBusy(false);}}
 async function dispatch(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy||!inviteFor)return;const f=new FormData(e.currentTarget);setBusy(true);setError('');try{const r=await apiRequest<{results:{email:string;state:string}[]}>('/api/v1/trading-hub/opportunities/'+inviteFor.id+'/dispatch',{method:'POST',body:{supplierIds:f.getAll('supplierIds'),revision:inviteFor.revision}});await load();setMessage(r.results.map(v=>v.email+': '+(v.state==='ACCEPTED'?'aceito pelo Resend':v.state==='UNKNOWN'?'envio não confirmado; confira o histórico':'convite já existente')).join(' · '));inviteDialog.current?.close();}catch(e){setError(e instanceof Error?e.message:'Falha no envio.');}finally{setBusy(false);}}


 async function action(path:string){if(busy)return;setBusy(true);setError('');try{await apiRequest('/api/v1/trading-hub/'+path,{method:'POST'});await load();setMessage('Operação registrada. Consulte o estado do convite.');}catch(e){setError(e instanceof Error?e.message:'Falha na operação.');}finally{setBusy(false);}}


 async function downloadFile(id:string){setError('');try{const r=await apiRequest<{url:string}>('/api/v1/trading-hub/files/'+encodeURIComponent(id));const a=document.createElement('a');a.href=r.url;a.rel='noopener noreferrer';a.click();}catch(e){setError(e instanceof Error?e.message:'Arquivo indisponível.');}}


 const rows=state?.rows??[],suppliers=rows.filter(r=>r.kind==='supplier'),opportunities=rows.filter(r=>r.kind==='opportunity'),proposals=rows.filter(r=>r.kind==='proposal');


 const input=(key:string,label:string,type='text',required=true)=> <Input key={key} label={label} name={key} type={type} required={required} defaultValue={editing?.row?.data[key]??''} disabled={busy||editing?.readOnly} {...(type==='number'?{step:'any',min:0}:{maxLength:1000})}/>;


 const visible=rows.filter(r=>{const created=new Date(r.created_at),now=new Date();return period==='all'||created.getFullYear()===now.getFullYear()&&(period==='year'||period==='quarter'&&Math.floor(created.getMonth()/3)===Math.floor(now.getMonth()/3)||period==='month'&&created.getMonth()===now.getMonth());});


 return <section className="backoffice-page"><h1>Trading Hub</h1><p>Cotações ACL, fornecedores e comparação de propostas da organização ativa.</p>{error?<Alert variant="error">{error}</Alert>:null}{message?<Alert>{message}</Alert>:null}


 <div className={styles.actions}>{[['dashboard','Dashboard'],['supplier','Fornecedores ACL'],['opportunity','Cotações'],['proposal','Propostas e ranking']].map(([k,l])=><Button key={k} variant={tab===k?'primary':'secondary'} onClick={()=>setTab(k)}>{l}</Button>)}</div>


 {!state&&!error?<p>Carregando Trading Hub…</p>:null}


 {state&&tab==='dashboard'?<><label>Período<select className="ds-input" value={period} onChange={e=>setPeriod(e.target.value)}><option value="month">Mensal</option><option value="quarter">Trimestral</option><option value="year">Anual</option><option value="all">Cumulativo</option></select></label><div className={styles.grid}><Card title="Recebidas"><strong>{visible.filter(r=>r.kind==='proposal'&&r.status!=='DECLINED').length}</strong></Card><Card title="Cotações abertas"><strong>{visible.filter(r=>r.kind==='opportunity'&&r.status==='OPEN').length}</strong></Card><Card title="Não participam"><strong>{visible.filter(r=>r.status==='DECLINED').length}</strong></Card></div><Card title="Histórico de preços por fornecedor"><div className={styles.chart}>{suppliers.map(s=>{const prices=visible.filter(p=>p.kind==='proposal'&&p.data.supplierId===s.id&&p.data.priceBrlMwh>0).map(p=>Number(p.data.priceBrlMwh));if(!prices.length)return null;const min=Math.min(...prices);return <div key={s.id} className={styles.bar} style={{height:Math.max(40,200*min/Math.max(1,...visible.filter(p=>p.kind==='proposal').map(p=>Number(p.data.priceBrlMwh)||0)))}} title={'Menor preço: '+money(min)+'/MWh'}>{s.data.tradeName}<br/>{money(min)}</div>;})}</div><p className={styles.small}>Menores preços recebidos no período; condições comerciais e modalidade podem diferir. Ranking não autoriza contratação.</p></Card></>:null}


 {state&&tab==='supplier'?<>{state.canManage?<Button onClick={()=>void open('supplier')}>Cadastrar fornecedor ACL</Button>:null}<div className={styles.grid}>{suppliers.map(s=><Card key={s.id} title={s.data.tradeName}><p>{s.data.legalName}</p><p>CNPJ {s.data.cnpj} · {s.data.city}/{s.data.state}</p><p>{statusLabels[s.status]} · versão {s.revision}</p><Button variant="secondary" onClick={()=>void open('supplier',s)}>Abrir cadastro</Button>{state.canManage&&s.status==='DRAFT'?<Button disabled={busy} onClick={()=>void transition(s,'ACTIVE','Cadastro do fornecedor conferido pelo backoffice')}>Ativar fornecedor</Button>:null}</Card>)}</div></>:null}


 {state&&tab==='opportunity'?<>{state.canManage?<Button onClick={()=>void open('opportunity')}>Nova cotação</Button>:null}<div className={styles.grid}>{opportunities.map(o=><Card key={o.id} title={o.data.title}><p>Identificador: {o.id}</p><p>{o.data.distributor} · {o.data.submarket} · {o.data.averageMwhMonth} MWh/mês</p><p>{energyLabels[o.data.energyType]} · {o.data.months} meses a partir de {o.data.startMonth}</p><p>{statusLabels[o.status]} · expira {new Date(o.data.expiresAt).toLocaleString('pt-BR')}</p><Button variant="secondary" onClick={()=>void open('opportunity',o)}>Abrir cotação</Button>{state.canManage&&['DRAFT','OPEN'].includes(o.status)?<Button disabled={busy} onClick={()=>setInviteFor(o)}>Solicitar cotação aos fornecedores</Button>:null}{state.canManage&&['DRAFT','OPEN','ANALYSIS'].includes(o.status)?<Button disabled={busy} onClick={()=>void open('proposal',undefined,o.id)}>Registrar proposta recebida</Button>:null}</Card>)}</div></>:null}


 {state&&tab==='proposal'?<>{opportunities.map(o=><Card key={o.id} title={o.data.title}><p>Comparação de preços da mesma modalidade e propostas dentro da validade.</p><div style={{overflowX:'auto'}}><table className={styles.table}><thead><tr><th>Ranking</th><th>Fornecedor</th><th>R$/MWh</th><th>Energia/mês</th><th>Economia estimada</th><th>VPL</th><th>Payback</th></tr></thead><tbody>{state.comparisons.find(c=>c.opportunityId===o.id)?.rows.map(p=><tr key={p.id}><td>{p.rank}</td><td>{suppliers.find(s=>s.id===p.supplierId)?.data.tradeName??'Fornecedor'}</td><td>{money(p.priceBrlMwh)}</td><td>{money(p.energyMonthlyBrl)}</td><td>{money(p.estimatedSavingBrl)}</td><td>{money(p.npvBrl)}</td><td>{p.paybackMonths==null?'Não calculado':p.paybackMonths.toFixed(1)+' meses'}</td></tr>)}</tbody></table></div><p className={styles.small}>Simulação informativa; custos completos, tributos, garantias e condições devem ser conferidos antes da aprovação.</p></Card>)}{proposals.map(p=><Card key={p.id} title={suppliers.find(s=>s.id===p.data.supplierId)?.data.tradeName??'Proposta'}><p>{money(p.data.priceBrlMwh)}/MWh · {statusLabels[p.status]}</p><Button variant="secondary" onClick={()=>void open('proposal',p)}>Abrir proposta</Button>{state.canManage&&p.status==='RECEIVED'?<Button disabled={busy} onClick={()=>void transition(p,'ANALYSIS','Proposta encaminhada para análise comercial')}>Em análise</Button>:null}{state.canApprove&&p.status==='ANALYSIS'?<Button disabled={busy} onClick={()=>void transition(p,'MANAGER_APPROVED','Proposta revisada pelo gestor; aguardando decisão do cliente')}>Aprovação interna</Button>:null}</Card>)}</>:null}


 {state&&tab==='opportunity'?<Card title="Acompanhamento dos convites"><div style={{overflowX:'auto'}}><table className={styles.table}><thead><tr><th>Contato</th><th>Cotação</th><th>Resposta</th><th>Envio</th><th>Expiração</th><th>Ação</th></tr></thead><tbody>{invitations.map(i=><tr key={i.id}><td>{i.email}</td><td>{opportunities.find(o=>o.id===i.opportunity_id)?.data.title}</td><td>{({PENDING:'Pendente',RESPONDED:'Recebida',DECLINED:'Não participa',APPROVED:'Cliente aprovou',REVOKED:'Revogado'} as Record<string,string>)[i.state]}{i.state==='PENDING'&&Date.parse(i.expires_at)<=Date.now()?' · expirado':''}</td><td>{i.email_status==='ACCEPTED'?'Aceito pelo provedor':i.email_status==='UNKNOWN'?'Não confirmado':'Pendente'}</td><td>{new Date(i.expires_at).toLocaleString('pt-BR')}</td><td>{state.canManage&&i.state==='PENDING'?<Button variant="secondary" disabled={busy} onClick={()=>void action('invitations/'+i.id+'/revoke')}>Revogar</Button>:null}</td></tr>)}</tbody></table></div></Card>:null}


 <dialog ref={contractDialog} className={styles.dialog} onClose={()=>setContractFor(null)} onCancel={e=>{if(busy)e.preventDefault();}}><div className={styles.header}><h2>Registrar formalização da contratação</h2><Button variant="secondary" disabled={busy} onClick={()=>contractDialog.current?.close()}>Fechar</Button></div>{error?<Alert variant="error">{error}</Alert>:null}<p>Informe o documento verificado do contrato já formalizado, pertencente ao cliente e à unidade desta cotação.</p><form onSubmit={recordContract}><label>Documento do contrato<select name="documentId" className="ds-input" required disabled={busy}><option value="">Selecione</option>{documents.filter(d=>{const o=opportunities.find(o=>o.id===contractFor?.parent_id);return d.customer_id===o?.data.customerId&&d.consumer_unit_id===o?.data.unitId;}).map(d=><option key={d.id} value={d.id}>{d.original_filename}</option>)}</select></label><Input label="Referência do contrato" name="reference" required minLength={3} maxLength={200} disabled={busy}/><Input label="Justificativa para auditoria" name="reason" required minLength={3} maxLength={500} disabled={busy}/><Button type="submit" disabled={busy}>Registrar contratação formalizada</Button></form></dialog>
 <dialog ref={inviteDialog} className={styles.dialog} onClose={()=>setInviteFor(null)} onCancel={e=>{if(busy)e.preventDefault();}}><div className={styles.header}><h2>Solicitar cotação · {inviteFor?.data.title}</h2><Button variant="secondary" disabled={busy} onClick={()=>inviteDialog.current?.close()}>Fechar</Button></div>{error?<Alert variant="error">{error}</Alert>:null}<form onSubmit={dispatch}><p>Selecione fornecedores ativos. O convite será enviado aos contatos de cotação cadastrados, com acesso por e-mail verificado e prazo da oportunidade.</p>{suppliers.filter(s=>s.status==='ACTIVE').map(s=><label key={s.id} style={{display:'block',padding:8}}><input type="checkbox" name="supplierIds" value={s.id} disabled={busy}/> {s.data.tradeName} · {s.data.quotationContacts.map((c:any)=>c.email).join(', ')}</label>)}<Button type="submit" disabled={busy}>{busy?'Solicitando…':'Enviar convites de cotação'}</Button></form></dialog>


 <dialog ref={dialog} className={styles.dialog} aria-labelledby="trading-form-title" onCancel={e=>{if(busy)e.preventDefault();}} onClose={()=>{setEditing(null);setHistory([]);}}><div className={styles.header}><h2 id="trading-form-title">{editing?.kind==='supplier'?'Fornecedor ACL':editing?.kind==='opportunity'?'Cotação ACL':'Proposta comercial'}</h2><Button variant="secondary" disabled={busy} onClick={()=>dialog.current?.close()}>Fechar</Button></div>{error?<Alert variant="error">{error}</Alert>:null}{editing?<form key={editing.row?.id??editing.kind} className={styles.form} onSubmit={save}>


 {editing.kind==='supplier'?<>{[['legalName','Razão social'],['tradeName','Nome fantasia'],['cnpj','CNPJ'],['phone','Telefone'],['administrativeEmail','E-mail administrativo'],['administrativeContact','Contato administrativo'],['address','Endereço'],['city','Cidade'],['state','Estado']].map(([k,l])=>input(k,l,k==='administrativeEmail'?'email':'text'))}<label className={styles.wide}>Contatos de cotação — uma linha por contato: Nome; e-mail<textarea className="ds-input" name="quotationContacts" required maxLength={8000} rows={4} disabled={busy||editing.readOnly} defaultValue={editing.row?.data.quotationContacts?.map((c:any)=>c.name+'; '+c.email).join('\n')??''}/></label></>:<>


 {editing.kind==='opportunity'?<>{input('title','Título da oportunidade')}<label>Cliente<select className="ds-input" name="customerId" required value={customerId} disabled={busy||editing.readOnly} onChange={e=>{setCustomerId(e.target.value);setUnitId('');}}><option value="">Selecione</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label><label>Unidade consumidora<select className="ds-input" name="unitId" required value={unitId} onChange={e=>setUnitId(e.target.value)} disabled={busy||editing.readOnly}><option value="">Selecione</option>{units.map(u=><option key={u.id} value={u.id}>{u.name} · {u.consumer_unit_number}</option>)}</select></label>{input('distributor','Distribuidora')}<label>Submercado<select className="ds-input" name="submarket" defaultValue={editing.row?.data.submarket??'SE_CO'} disabled={busy||editing.readOnly}>{['SE_CO','S','NE','N'].map(v=><option key={v}>{v}</option>)}</select></label>{input('averageMwhMonth','Consumo médio (MWh/mês)','number')}{input('startMonth','Início do fornecimento','month')}{input('months','Prazo (meses)','number')}<Input label="Expiração do convite" name="expiresAt" type="datetime-local" required disabled={busy||editing.readOnly} defaultValue={editing.row?.data.expiresAt?new Date(Date.parse(editing.row.data.expiresAt)-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):''}/>{input('acrMonthlyBrl','Base mensal ACR (R$) — opcional','number',false)}{input('aclOtherMonthlyBrl','Demais custos ACL mensais (R$) — opcional','number',false)}{input('comparisonBasis','Fonte e premissas da comparação — opcional','text',false)}{input('investmentBrl','Investimento inicial (R$) — opcional','number',false)}{input('discountAnnualPercent','Taxa de desconto anual (%) — opcional','number',false)}</>:<><label>Fornecedor<select className="ds-input" name="supplierId" required defaultValue={editing.row?.data.supplierId??''} disabled={busy||editing.readOnly}><option value="">Selecione</option>{suppliers.filter(s=>s.status==='ACTIVE').map(s=><option key={s.id} value={s.id}>{s.data.tradeName}</option>)}</select></label>{input('priceBrlMwh','Preço de energia (R$/MWh)','number')}{[['flexibility','Flexibilidade'],['modulation','Modulação'],['guarantees','Garantias'],['conditions','Condições comerciais']].map(([k,l])=>input(k,l))}{input('validUntil','Validade da proposta','date')}</>}


 <label>Tipo de energia<select className="ds-input" name="energyType" defaultValue={editing.row?.data.energyType??'CONVENTIONAL'} disabled={busy||editing.readOnly}>{Object.entries(energyLabels).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label><label>Anexos verificados<select className="ds-input" name="documents" multiple defaultValue={editing.row?.data.documents??[]} disabled={busy||editing.readOnly}>{documents.filter(d=>{const o=editing.kind==='proposal'?opportunities.find(o=>o.id===(editing.parentId??editing.row?.parent_id)):null;return d.customer_id===(o?.data.customerId??customerId)&&d.consumer_unit_id===(o?.data.unitId??unitId);}).map(d=><option key={d.id} value={d.id}>{d.original_filename}</option>)}</select></label></>}


 {!editing.readOnly&&state?.canManage?<><Input label="Justificativa para auditoria" name="reason" required minLength={3} maxLength={500} disabled={busy}/><Button type="submit" disabled={busy}>{busy?'Salvando…':'Salvar registro'}</Button></>:null}</form>:null}{history.length?<details><summary>Histórico e auditoria ({history.length})</summary>{history.map(h=><p key={h.id}>Versão {h.revision} · {h.action} · {new Date(h.recorded_at).toLocaleString('pt-BR')} · {h.reason}</p>)}</details>:null}</dialog>


 </section>;


}


export default function Page(){const {context}=useAuth();return <ProtectedRoute><BackofficeShell>{context?.scope==='organization'?<Hub key={context.currentOrganization.id}/>:<section className="backoffice-page"><h1>Trading Hub</h1><p>Selecione uma organização pela operação administrativa. O módulo exige licença vigente com Trading Hub habilitado.</p></section>}</BackofficeShell></ProtectedRoute>;}


