'use client';
import {FormEvent,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import {Alert,Button,Card,Input} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
import {useAuth} from '@/app/providers';

type Contract={id:string;customer_id:string;consumer_unit_id:string;contract_number:string;contract_type:string;contracted_volume_mwh:number;current_price:number;start_date:string;end_date:string;status:string;supplier_id?:string;energy_source?:string;adjustment_index?:string;adjustment_frequency?:string;notes?:string};
type Customer={id:string;company_name:string};
type Unit={id:string;customer_id:string;name:string;consumer_unit_number:string};
const P={view:'60f9690a-145b-4dba-b23f-9f945baca296',create:'beb6ec90-8ba8-40ce-a156-aeef6cc75cce',update:'fd8a932f-87c0-4f86-8389-9f30c50e95b7',customers:'cbb2e904-0718-4eec-9396-dba899118cdd',units:'b142bd7b-05a3-45ee-befd-e593066c2775'};
const statuses:Record<string,string>={DRAFT:'Rascunho',ACTIVE:'Ativo',APPROVED:'Aprovado',PAUSED:'Pausado',TERMINATED:'Encerrado',EXPIRED:'Expirado'};
const types:Record<string,string>={ENERGY_PURCHASE:'Compra de energia',ENERGY_SALE:'Venda de energia',MANAGEMENT:'Gestão',INTERMEDIATION:'Intermediação',OTHER:'Outro'};
const frequencies:Record<string,string>={ANNUAL:'Anual',SEMIANNUAL:'Semestral',QUARTERLY:'Trimestral',MONTHLY:'Mensal',CUSTOM:'Personalizado'};
const date=(value:string)=>value?.slice(0,10).split('-').reverse().join('/')||'—';
const number=(value:number)=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:6});
function Contracts(){
 const {hasPermission}=useAuth();
 const view=hasPermission(P.view),create=hasPermission(P.create),update=hasPermission(P.update),viewCustomers=hasPermission(P.customers),viewUnits=hasPermission(P.units);
 const [rows,setRows]=useState<Contract[]>([]),[customers,setCustomers]=useState<Customer[]>([]),[units,setUnits]=useState<Unit[]>([]);
 const [loadFailed,setLoadFailed]=useState(false);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[lookupError,setLookupError]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0);
 const [busy,setBusy]=useState(false),[editing,setEditing]=useState<Contract|null>(null),[activating,setActivating]=useState<string|null>(null);
 const [customer,setCustomer]=useState(''),[filter,setFilter]=useState(''),[query,setQuery]=useState('');
 const pending=useRef(false);
 useEffect(()=>{let cancelled=false;if(!view)return;
 apiRequest<Contract[]>('/api/v1/contracts').then(data=>{if(!cancelled){setRows(data);setLoadFailed(false);}}).catch(e=>{if(!cancelled){setError(e.message);setLoadFailed(true);}}).finally(()=>{if(!cancelled)setLoading(false);});
 return()=>{cancelled=true;};},[view,revision]);
 useEffect(()=>{let cancelled=false;
 Promise.all([viewCustomers?apiRequest<Customer[]>('/api/v1/customers'):Promise.resolve([]),viewUnits?apiRequest<Unit[]>('/api/v1/consumer-units'):Promise.resolve([])]).then(([c,u])=>{if(!cancelled){setCustomers(c);setUnits(u);}}).catch(()=>{if(!cancelled)setLookupError('Não foi possível carregar clientes e unidades. Atualize a lista para tentar novamente.');});
 return()=>{cancelled=true;};},[viewCustomers,viewUnits,revision]);
 async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(pending.current)return;
 const form=event.currentTarget,f=new FormData(form);const text=(key:string)=>String(f.get(key)||'').trim();
 const start=editing?.start_date.slice(0,10)||text('startDate'),end=text('endDate');
 if(end<start){setError('O término deve ser igual ou posterior ao início da vigência.');return;}
 const volume=Number(text('contractedVolumeMwh')),price=Number(text('currentPrice'));
 if(!Number.isFinite(volume)||!Number.isFinite(price)||volume<0||price<0){setError('Informe volume e preço válidos, iguais ou maiores que zero.');return;}
 const body:Record<string,unknown>={endDate:end,contractedVolumeMwh:volume,currentPrice:price,notes:text('notes')};
 if(!editing){if(!units.some(u=>u.id===text('consumerUnitId')&&u.customer_id===customer)){setError('Selecione uma unidade do cliente informado.');return;}
 Object.assign(body,{consumerUnitId:text('consumerUnitId'),contractNumber:text('contractNumber'),contractType:text('contractType'),startDate:start,status:'DRAFT'});
 for(const key of ['supplierId','energySource','adjustmentIndex','adjustmentFrequency','adjustmentDate'])if(text(key))body[key]=text(key);}
 pending.current=true;setBusy(true);setError('');setMessage('');
 try{const row=await apiRequest<Contract>('/api/v1/contracts'+(editing?'/'+encodeURIComponent(editing.id):''),{method:editing?'PUT':'POST',body});
 setRows(old=>[row,...old.filter(c=>c.id!==row.id)]);setMessage(editing?'Rascunho atualizado.':'Contrato salvo como rascunho. Revise os dados antes de ativar.');setEditing(null);setCustomer('');form.reset();}
 catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{pending.current=false;setBusy(false);}}
 async function activate(row:Contract){if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');
 try{const result=await apiRequest<Contract>('/api/v1/contracts/'+encodeURIComponent(row.id),{method:'PUT',body:{status:'ACTIVE'}});setRows(old=>old.map(c=>c.id===result.id?result:c));setActivating(null);setMessage('Contrato ativado. Os dados foram preservados para consulta.');}
 catch(e){setError(e instanceof Error?e.message:'Não foi possível ativar.');}finally{pending.current=false;setBusy(false);}}
 if(!view)return <p>Acesso não autorizado aos contratos.</p>;
 const visible=rows.filter(c=>(!filter||c.customer_id===filter)&&(!query||(c.contract_number+' '+(c.supplier_id||'')).toLocaleLowerCase().includes(query.toLocaleLowerCase())));
 return <section className="backoffice-page"><h1>Contratos de energia</h1><p>Contratos da organização ativa, vinculados a clientes e unidades consumidoras. O acesso exige licença vigente com Gestão do Mercado Livre.</p>
 {error?<Alert variant="error">{error}</Alert>:null}{message?<Alert>{message}</Alert>:null}{lookupError?<Alert variant="error">{lookupError}</Alert>:null}
 <Button variant="secondary" disabled={busy||loading} onClick={()=>{setLoading(true);setError('');setLookupError('');setRevision(v=>v+1);}}>Atualizar lista</Button>
 {(create||editing)&&!loading&&!loadFailed?<Card title={editing?'Editar rascunho '+editing.contract_number:'Novo contrato'}>
 {!editing&&(!viewCustomers||!viewUnits)?<p>O cadastro requer permissão de consulta de clientes e unidades consumidoras.</p>:<form key={editing?.id||'new'} onSubmit={save} className="organizations-create__form">
 {!editing?<><label>Cliente<select className="ds-input" required value={customer} disabled={busy} onChange={e=>setCustomer(e.target.value)}><option value="">Selecione</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
 <label>Unidade consumidora<select key={customer} className="ds-input" name="consumerUnitId" required disabled={busy||!customer} defaultValue=""><option value="">Selecione</option>{units.filter(u=>u.customer_id===customer).map(u=><option key={u.id} value={u.id}>{u.name} — {u.consumer_unit_number}</option>)}</select></label>
 {!customers.length||!units.length?<p>Cadastre primeiro o <Link href="/backoffice/setup">cliente e a unidade consumidora</Link>.</p>:null}
 <Input label="Número do contrato" name="contractNumber" maxLength={50} required disabled={busy}/>
 <Input label="Fornecedor / comercializadora" name="supplierId" maxLength={255} disabled={busy}/>
 <label>Tipo de contrato<select className="ds-input" name="contractType" disabled={busy}>{Object.entries(types).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 <Input label="Início da vigência" name="startDate" type="date" required disabled={busy}/></>:<p>Início: {date(editing.start_date)}. O número, o cliente e a unidade são preservados.</p>}
 <Input label="Término da vigência" name="endDate" type="date" defaultValue={editing?.end_date.slice(0,10)} required disabled={busy}/>
 <Input label="Quantidade contratada (MWh)" name="contractedVolumeMwh" type="number" min="0" step="any" defaultValue={editing?.contracted_volume_mwh} required disabled={busy}/>
 <Input label="Preço contratado (R$/MWh)" name="currentPrice" type="number" min="0" step="any" defaultValue={editing?.current_price} required disabled={busy}/>
 {!editing?<><Input label="Fonte de energia" name="energySource" maxLength={50} disabled={busy}/><Input label="Índice de reajuste" name="adjustmentIndex" maxLength={50} disabled={busy}/>
 <label>Periodicidade do reajuste<select className="ds-input" name="adjustmentFrequency" disabled={busy}>{Object.entries(frequencies).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 <Input label="Data-base do reajuste" name="adjustmentDate" type="date" disabled={busy}/></>:null}
 <label>Condições comerciais e observações<textarea className="ds-input" name="notes" maxLength={4096} defaultValue={editing?.notes||''} disabled={busy}/></label>
 <Button type="submit" disabled={busy||(!editing&&(!customer||!!lookupError))}>{busy?'Salvando...':'Salvar rascunho'}</Button>
 {editing?<Button variant="secondary" type="button" disabled={busy} onClick={()=>setEditing(null)}>Cancelar edição</Button>:null}</form>}</Card>:null}
 <Card title="Contratos cadastrados"><div className="organizations-create__form"><Input label="Buscar número ou fornecedor" value={query} onChange={e=>setQuery(e.target.value)}/>
 {viewCustomers?<label>Filtrar por cliente<select className="ds-input" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Todos os clientes</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>:null}</div>
 {loading?<p>Carregando contratos...</p>:!visible.length?<p>{loadFailed?'A consulta não foi concluída.':'Nenhum contrato encontrado.'}</p>:visible.map(c=><article key={c.id} className="ds-card"><h3>{c.contract_number} · {statuses[c.status]||c.status}</h3>
 <p>{customers.find(x=>x.id===c.customer_id)?.company_name||'Cliente vinculado'} · {units.find(u=>u.id===c.consumer_unit_id)?.name||'Unidade vinculada'}</p>
 <p>{types[c.contract_type]||c.contract_type}{c.supplier_id?' · '+c.supplier_id:''}</p><p>Vigência: {date(c.start_date)} a {date(c.end_date)}</p>
 <p>{number(c.contracted_volume_mwh)} MWh · R$ {number(c.current_price)}/MWh</p>
 <details><summary>Condições do contrato</summary><p>Fonte: {c.energy_source||'Não informada'}</p><p>Reajuste: {c.adjustment_index||'Não informado'} · {frequencies[c.adjustment_frequency||'']||'Não informado'}</p><p style={{whiteSpace:'pre-wrap'}}>{c.notes||'Sem observações.'}</p></details>
 {c.status==='DRAFT'&&update?<><Button variant="secondary" disabled={busy} onClick={()=>{setEditing(c);setActivating(null);setError('');setMessage('');window.scrollTo({top:0,behavior:'smooth'});}}>Editar rascunho</Button>
 {activating===c.id?<div><p>Ativar o contrato {c.contract_number}? Após a ativação, os dados não poderão ser sobrescritos nesta tela. Confira a vigência, o volume e o preço antes de confirmar.</p><Button disabled={busy} onClick={()=>void activate(c)}>Confirmar ativação</Button><Button variant="secondary" disabled={busy} onClick={()=>setActivating(null)}>Cancelar</Button></div>:<Button disabled={busy||!!editing} onClick={()=>setActivating(c.id)}>Ativar contrato</Button>}</>:<p>Contrato preservado para consulta.</p>}
 </article>)}</Card></section>;
}
export default function Page(){const {context}=useAuth();const id=context&&context.scope!=='global'?context.currentOrganization.id:'';return <ProtectedRoute><BackofficeShell>{id?<Contracts key={id}/>:<p>Selecione uma organização para operar contratos.</p>}</BackofficeShell></ProtectedRoute>;}
