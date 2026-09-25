'use client';
import {FormEvent,useEffect,useRef,useState} from 'react';
import PriceHistory from './PriceHistory';
import SupplyOperatingFields,{OperatingTerms,OperatingSummary,readOperatingTerms} from './SupplyOperatingFields';
import SupplyTermsFields,{SupplyTerms,guarantees,readSupplyTerms} from './SupplyTermsFields';
import Link from 'next/link';
import {Alert,Button,Card,Input} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
import {useAuth} from '@/app/providers';

import {CorrectionContext} from './preparation-navigation';
type Contract=SupplyTerms & OperatingTerms & {id:string;customer_id:string;consumer_unit_id:string;contract_number:string;contract_type:string;contracted_volume_mwh:number;current_price:number;start_date:string;end_date:string;status:string;supplier_id?:string;energy_source?:string;adjustment_index?:string;adjustment_frequency?:string;notes?:string};
type Customer={id:string;company_name:string};
type Unit={id:string;customer_id:string;name:string;consumer_unit_number:string};
const P={view:'60f9690a-145b-4dba-b23f-9f945baca296',create:'beb6ec90-8ba8-40ce-a156-aeef6cc75cce',update:'fd8a932f-87c0-4f86-8389-9f30c50e95b7',customers:'cbb2e904-0718-4eec-9396-dba899118cdd',units:'b142bd7b-05a3-45ee-befd-e593066c2775'};
const statuses:Record<string,string>={DRAFT:'Rascunho',ACTIVE:'Ativo',APPROVED:'Aprovado',PAUSED:'Pausado',TERMINATED:'Encerrado',EXPIRED:'Expirado'};
const types:Record<string,string>={ENERGY_PURCHASE:'Compra de energia',ENERGY_SALE:'Venda de energia',MANAGEMENT:'Gestão',INTERMEDIATION:'Intermediação',OTHER:'Outro'};
const frequencies:Record<string,string>={ANNUAL:'Anual',SEMIANNUAL:'Semestral',QUARTERLY:'Trimestral',MONTHLY:'Mensal',CUSTOM:'Personalizado'};
const date=(value:string)=>value?.slice(0,10).split('-').reverse().join('/')||'—';
const number=(value:number)=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:6});
export default function SupplyContracts({customerId,onDirty,allowNew=true,initialContext}:{initialContext?:CorrectionContext;allowNew?:boolean;customerId:string;onDirty:(dirty:boolean)=>void}){
 const {hasPermission}=useAuth();
 const view=hasPermission(P.view),create=hasPermission(P.create),update=hasPermission(P.update),viewCustomers=hasPermission(P.customers),viewUnits=hasPermission(P.units);
 const [rows,setRows]=useState<Contract[]>([]),[customers,setCustomers]=useState<Customer[]>([]),[units,setUnits]=useState<Unit[]>([]);
 const [loadFailed,setLoadFailed]=useState(false);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[lookupError,setLookupError]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0);
 const [busy,setBusy]=useState(false),[editing,setEditing]=useState<Contract|null>(null),[activating,setActivating]=useState<string|null>(null);
 const customer=customerId,filter=customerId;const [query,setQuery]=useState(''),[priceId,setPriceId]=useState<string|null>(null);
 const pending=useRef(false);const [formVersion,setFormVersion]=useState(0),[hasSchedule,setHasSchedule]=useState(false);
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
 const terms=readSupplyTerms(f),operating=readOperatingTerms(f);
 if((operating.flexibilityMinPercent===null)!==(operating.flexibilityMaxPercent===null)||Number(operating.flexibilityMinPercent)>Number(operating.flexibilityMaxPercent)){setError('Informe os dois limites de flexibilidade, com mínimo igual ou menor que o máximo.');return;}
 if(['MONTHLY','BOTH'].includes(operating.seasonalityMode||'')){
 const first=Number(start.slice(0,4)),last=Number(end.slice(0,4)),seen=new Set<number>();
 if(operating.seasonalVolumes.length!==last-first+1){setError('Cadastre a distribuição sazonal de todos os anos da vigência.');return;}
 for(const y of operating.seasonalVolumes){if(seen.has(y.year)||y.year<first||y.year>last||y.monthlyPercentages.length!==12||Math.abs(y.monthlyPercentages.reduce((a,b)=>a+b,0)-100)>0.0001||y.monthlyPercentages.some((v,i)=>v<0||v>100||(v!==0&&((y.year===first&&i+1<Number(start.slice(5,7)))||(y.year===last&&i+1>Number(end.slice(5,7))))))){setError('Revise a sazonalidade: cada ano deve ser único e somar 100%, com zero nos meses fora da vigência.');return;}seen.add(y.year);}
 }
 const volume=Number(text('contractedVolumeMwh')),price=terms.annualPrices.length?terms.annualPrices[0].pricePerMwh:Number(text('currentPrice'));
 if(terms.annualPrices.length){let next=start;for(const p of terms.annualPrices){if(p.startDate!==next||p.endDate<p.startDate||p.endDate>end||!Number.isFinite(p.pricePerMwh)||p.pricePerMwh<0){setError('A tabela deve cobrir toda a vigência em ordem, sem lacunas ou sobreposições, com preços válidos.');return;}const d=new Date(p.endDate+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);next=d.toISOString().slice(0,10);}if(terms.annualPrices[terms.annualPrices.length-1].endDate!==end){setError('O último período deve terminar na data final do contrato.');return;}}
 if(!Number.isFinite(volume)||!Number.isFinite(price)||volume<0||price<0){setError('Informe volume e preço válidos, iguais ou maiores que zero.');return;}
 const body:Record<string,unknown>={...terms,...operating,endDate:end,contractedVolumeMwh:volume,currentPrice:price,notes:text('notes')};
 if(!editing){if(!units.some(u=>u.id===text('consumerUnitId')&&u.customer_id===customer)){setError('Selecione uma unidade do cliente informado.');return;}
 Object.assign(body,{consumerUnitId:text('consumerUnitId'),contractNumber:text('contractNumber'),contractType:text('contractType'),startDate:start,status:'DRAFT'});
 for(const key of ['supplierId','energySource'])if(text(key))body[key]=text(key);}
 pending.current=true;setBusy(true);setError('');setMessage('');
 try{const row=await apiRequest<Contract>('/api/v1/contracts'+(editing?'/'+encodeURIComponent(editing.id):''),{method:editing?'PUT':'POST',body});
 setRows(old=>[row,...old.filter(c=>c.id!==row.id)]);setMessage(editing?'Rascunho atualizado.':'Contrato salvo como rascunho. Revise os dados antes de ativar.');setEditing(null);form.reset();setFormVersion(v=>v+1);setHasSchedule(false);onDirty(false);}
 catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{pending.current=false;setBusy(false);}}
 async function activate(row:Contract){if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');
 try{const result=await apiRequest<Contract>('/api/v1/contracts/'+encodeURIComponent(row.id),{method:'PUT',body:{status:'ACTIVE'}});setRows(old=>old.map(c=>c.id===result.id?result:c));setActivating(null);setMessage('Contrato ativado. Os dados foram preservados para consulta.');}
 catch(e){setError(e instanceof Error?e.message:'Não foi possível ativar.');}finally{pending.current=false;setBusy(false);}}
 if(!view)return <p>Acesso não autorizado aos contratos.</p>;
 const legacy=rows.filter(c=>!['ENERGY_PURCHASE','ENERGY_SALE'].includes(c.contract_type)&&(!filter||c.customer_id===filter));
 const visible=rows.filter(c=>(!initialContext||c.consumer_unit_id===initialContext.unitId)&&(!initialContext?.recordId||c.id===initialContext.recordId)&&['ENERGY_PURCHASE','ENERGY_SALE'].includes(c.contract_type)&&(!filter||c.customer_id===filter)&&(!query||(c.contract_number+' '+(c.supplier_id||'')).toLocaleLowerCase().includes(query.toLocaleLowerCase())));
 return <section className="backoffice-page"><h2>Fornecedor Mercado Livre</h2><p>Contratos da organização ativa, vinculados a clientes e unidades consumidoras. O acesso exige licença vigente com Gestão do Mercado Livre.</p>
 {error?<Alert variant="error">{error}</Alert>:null}{message?<Alert>{message}</Alert>:null}{lookupError?<Alert variant="error">{lookupError}</Alert>:null}
 <Button variant="secondary" disabled={busy||loading} onClick={()=>{setLoading(true);setError('');setLookupError('');setRevision(v=>v+1);}}>Atualizar lista</Button>
 {((allowNew&&create&&!!customerId)||editing)&&!loading&&!loadFailed?<Card title={editing?'Editar rascunho '+editing.contract_number:'Novo contrato'}>
 {!editing&&(!viewCustomers||!viewUnits)?<p>O cadastro requer permissão de consulta de clientes e unidades consumidoras.</p>:<form key={(editing?.id||'new')+formVersion} onSubmit={save} onChange={()=>onDirty(true)} className="organizations-create__form">
 {!editing?<>
 <label>Unidade consumidora<select key={customer} className="ds-input" name="consumerUnitId" required disabled={busy||!customer} defaultValue=""><option value="">Selecione</option>{units.filter(u=>u.customer_id===customer).map(u=><option key={u.id} value={u.id}>{u.name} — {u.consumer_unit_number}</option>)}</select></label>
 {!customers.length||!units.length?<p>Cadastre primeiro o <Link href="/backoffice/setup">cliente e a unidade consumidora</Link>.</p>:null}
 <Input label="Número do contrato" name="contractNumber" maxLength={50} required disabled={busy}/>
 <Input label="Fornecedor / comercializadora" name="supplierId" maxLength={255} disabled={busy}/>
 <label>Tipo de contrato<select className="ds-input" name="contractType" disabled={busy}>{Object.entries(types).filter(([v])=>['ENERGY_PURCHASE','ENERGY_SALE'].includes(v)).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 <Input label="Início da vigência" name="startDate" type="date" required disabled={busy}/></>:<p>Início: {date(editing.start_date)}. O número, o cliente e a unidade são preservados.</p>}
 <Input label="Término da vigência" name="endDate" type="date" defaultValue={editing?.end_date.slice(0,10)} required disabled={busy}/>
 <Input label="Quantidade contratada (MWh)" name="contractedVolumeMwh" type="number" min="0" step="any" defaultValue={editing?.contracted_volume_mwh} required disabled={busy}/>
 <Input label="Preço único (R$/MWh), quando não houver tabela anual" name="currentPrice" type="number" min="0" step="any" defaultValue={editing?.current_price} required={!hasSchedule} disabled={busy||hasSchedule}/>
 {!editing?<Input label="Fonte de energia" name="energySource" maxLength={50} disabled={busy}/>:null}
 <SupplyOperatingFields value={editing} busy={busy} onDirty={onDirty}/>
 <SupplyTermsFields value={editing} busy={busy} onDirty={onDirty} onSchedule={setHasSchedule}/>
 <label>Condições comerciais e observações<textarea className="ds-input" name="notes" maxLength={4096} defaultValue={editing?.notes||''} disabled={busy}/></label>
 <Button type="submit" disabled={busy||(!editing&&(!customer||!!lookupError))}>{busy?'Salvando...':'Salvar rascunho'}</Button>
 {editing?<Button variant="secondary" type="button" disabled={busy} onClick={()=>{setEditing(null);setHasSchedule(false);setFormVersion(v=>v+1);onDirty(false);}}>Cancelar edição</Button>:null}</form>}</Card>:null}
 <Card title="Contratos cadastrados"><div className="organizations-create__form"><Input label="Buscar número ou fornecedor" value={query} onChange={e=>setQuery(e.target.value)}/>
 </div>
 {loading?<p>Carregando contratos...</p>:!visible.length?<p>{loadFailed?'A consulta não foi concluída.':'Nenhum contrato encontrado.'}</p>:visible.map(c=><article key={c.id} className="ds-card"><h3>{c.contract_number} · {statuses[c.status]||c.status}</h3>
 <p>{customers.find(x=>x.id===c.customer_id)?.company_name||'Cliente vinculado'} · {units.find(u=>u.id===c.consumer_unit_id)?.name||'Unidade vinculada'}</p>
 <p>{types[c.contract_type]||c.contract_type}{c.supplier_id?' · '+c.supplier_id:''}</p><p>Vigência: {date(c.start_date)} a {date(c.end_date)}</p>
 <p>{number(c.contracted_volume_mwh)} MWh · R$ {number(c.current_price)}/MWh</p>
 {c.annual_prices?.length?<details open><summary>Preços por ano / período</summary>{c.annual_prices.map((p,i)=><p key={i}>{date(p.startDate)} a {date(p.endDate)}: R$ {number(Number(p.pricePerMwh))}/MWh · {p.priceStatus==='BASE'?'Preço-base, reajuste pendente':'Preço final'}</p>)}</details>:null}
 <details><summary>Condições do contrato</summary><OperatingSummary value={c}/><p>Garantia: {guarantees[c.guarantee_type||'']||'Não informada'}{c.guarantee_type?' · R$ '+number(c.guarantee_amount||0)+' · '+c.guarantee_institution:''}</p><p>{c.guarantee_description}</p><p>Data-base: {date(c.adjustment_date||'')}</p><p>{c.adjustment_rule}</p><p>Fonte: {c.energy_source||'Não informada'}</p><p>Reajuste: {c.adjustment_index||'Não informado'} · {frequencies[c.adjustment_frequency||'']||'Não informado'}</p><p style={{whiteSpace:'pre-wrap'}}>{c.notes||'Sem observações.'}</p></details>
 {c.status==='DRAFT'&&update&&['ENERGY_PURCHASE','ENERGY_SALE'].includes(c.contract_type)?<><Button variant="secondary" disabled={busy} onClick={()=>{setEditing(c);setHasSchedule(!!c.annual_prices?.length);setFormVersion(v=>v+1);setActivating(null);setError('');setMessage('');window.scrollTo({top:0,behavior:'smooth'});}}>Editar rascunho</Button>
 {activating===c.id?<div><p>Ativar o contrato {c.contract_number}? Após a ativação, os dados não poderão ser sobrescritos nesta tela. Confira a vigência, o volume e o preço antes de confirmar.</p><Button disabled={busy} onClick={()=>void activate(c)}>Confirmar ativação</Button><Button variant="secondary" disabled={busy} onClick={()=>setActivating(null)}>Cancelar</Button></div>:<Button disabled={busy||!!editing} onClick={()=>setActivating(c.id)}>Ativar contrato</Button>}</>:<p>Contrato preservado para consulta.</p>}
 {['ENERGY_PURCHASE','ENERGY_SALE'].includes(c.contract_type)&&['ACTIVE','APPROVED'].includes(c.status)?<><Button variant="secondary" onClick={()=>setPriceId(priceId===c.id?null:c.id)}>Histórico de preços</Button>{priceId===c.id?<PriceHistory id={c.id} start={c.start_date} end={c.end_date} canWrite={update} onDirty={onDirty}/>:null}</>:null}</article>)}</Card>{legacy.length?<Card title="Outros contratos cadastrados anteriormente">{legacy.map(c=><article key={c.id}><h3>{c.contract_number}</h3><p>{types[c.contract_type]||c.contract_type} · {statuses[c.status]||c.status}</p><p>{date(c.start_date)} a {date(c.end_date)}</p><p>{c.notes}</p><p>Registro preservado para consulta.</p></article>)}</Card>:null}</section>;
}
