'use client';
import {ocrNavigationRequest,ocrNavigationContext} from './ocr-navigation';
import {useEffect,useRef,useState} from 'react';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import {Alert,Button,Input} from '@/app/components/ui';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import EntryWizard from './EntryWizard';
import WorkflowModal from './WorkflowModal';
import ContractReadiness from './ContractReadiness';
import SupplyContracts from './SupplyContracts';
import CalculationParameters from './CalculationParameters';
import CalculationPreparation from './CalculationPreparation';
import MonthlyInputs from './MonthlyInputs';
import MonthlyCosts from './MonthlyCosts';
import Distributor from './Distributor';
import CommercialTerms from './CommercialTerms';
import {Customer,Unit,PERM} from './types';
import {CorrectionContext} from './preparation-navigation';
const tabs=[['distributor','Distribuidora e unidades'],['supply','Fornecedor Mercado Livre'],['management','Honorários da gestão'],['services','Intermediação e outros'],['parameters','Parâmetros de cálculo'],['preparation','Preparar apuração'],['monthly','Dados mensais'],['costs','Custos mensais']] as const;
function Workspace(){const {hasPermission}=useAuth();const [customers,setCustomers]=useState<Customer[]>([]),[units,setUnits]=useState<Unit[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0),[customerId,setCustomer]=useState(''),[tab,setTab]=useState<string>(''),[dirty,setDirty]=useState(false),[search,setSearch]=useState('');
 const [ocrLoading,setOcrLoading]=useState(false),[ocrError,setOcrError]=useState('');const ocrNavigation=useRef(false);
 const destination=useRef<HTMLDivElement>(null);
 const [correction,setCorrection]=useState<CorrectionContext|null>(null);
 const [entryActive,setEntryActive]=useState(false),[listVersion,setListVersion]=useState(0);
 const [pendingChange,setPendingChange]=useState<(()=>void)|null>(null);
 const canView=hasPermission(PERM.view),viewCustomers=hasPermission('cbb2e904-0718-4eec-9396-dba899118cdd'),viewUnits=hasPermission('b142bd7b-05a3-45ee-befd-e593066c2775');
 useEffect(()=>{let cancelled=false;if(!canView)return;Promise.all([apiRequest('/api/v1/contracts'),viewCustomers?apiRequest<Customer[]>('/api/v1/customers'):Promise.resolve([]),viewUnits?apiRequest<Unit[]>('/api/v1/consumer-units'):Promise.resolve([])]).then(([,c,u])=>{if(!cancelled){setCustomers(c);setUnits(u);setLoading(false);}}).catch(e=>{if(!cancelled){setError(e.message);setLoading(false);}});return()=>{cancelled=true;};},[canView,viewCustomers,viewUnits,revision]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 useEffect(()=>{if(correction){destination.current?.focus();destination.current?.scrollIntoView({block:"start"});}},[correction,tab,customerId]);
 useEffect(()=>{if(loading||error||!canView||ocrNavigation.current)return;let active=true;
 let request:ReturnType<typeof ocrNavigationRequest>;try{request=ocrNavigationRequest(window.location.search);}catch(e){setOcrError(e instanceof Error?e.message:'Link da fatura inválido.');ocrNavigation.current=true;return;}
 if(!request){ocrNavigation.current=true;return;}setOcrLoading(true);setOcrError('');
 apiRequest<{documentId:string;customerId:string;unitId:string;month:string}>('/api/v1/documents/'+encodeURIComponent(request.id)+'/ocr/calculation-context').then(d=>{if(!active)return;const c=ocrNavigationContext(request!,d,customers,units);setCorrection(c);setCustomer(c.customerId);setTab(c.tab!);ocrNavigation.current=true;}).catch(e=>{if(active){ocrNavigation.current=true;setOcrError(e instanceof Error?e.message:'Não foi possível carregar o contexto da fatura.');}}).finally(()=>{if(active)setOcrLoading(false);});return()=>{active=false;};
 },[loading,error,canView,customers,units]);
 function change(action:()=>void){if(dirty){setPendingChange(()=>action);return;}action();}
 if(!canView)return <p>Acesso não autorizado aos contratos.</p>;
 return <section className="backoffice-page"><h1>Contratos e configuração energética</h1><p>Selecione um cliente para acompanhar as pendências ou use Inserir novo para iniciar um cadastro.</p>
 {pendingChange?<WorkflowModal title="Alterações não salvas" onClose={()=>setPendingChange(null)}><div role="alert" className="ds-card"><p>Há campos não salvos. Trocar de área ou cliente descartará esse preenchimento.</p><Button variant="secondary" onClick={()=>setPendingChange(null)}>Permanecer no formulário</Button><Button onClick={()=>{setDirty(false);pendingChange();setPendingChange(null);}}>Descartar e continuar</Button></div></WorkflowModal>:null}
 {error?<><Alert variant="error">{error}</Alert><Button onClick={()=>{setError('');setLoading(true);setRevision(v=>v+1);}}>Tentar novamente</Button></>:null}
 {ocrError?<Alert variant="error">{ocrError}</Alert>:null}
 {ocrLoading?<p role="status">Carregando cliente, unidade e competência da fatura…</p>:loading?<p>Carregando organização, licença e clientes...</p>:!error?<>
 <EntryWizard requestStart={change} customers={customers} units={units} filterCustomer={customerId} onDirty={setDirty} onActive={setEntryActive} onRegistered={()=>{setListVersion(v=>v+1);setRevision(v=>v+1);}}/>{!entryActive?<>
 <div className="ds-card" style={{display:'grid',gap:12}}><Input label="Buscar cliente" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome do cliente"/>
 <label>Cliente em operação<select className="ds-input" value={customerId} onChange={e=>change(()=>{setCorrection(null);setTab('');setCustomer(e.target.value);})}><option value="">Selecione o cliente</option>{customers.filter(c=>c.id===customerId||c.company_name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
 <strong>{customerId?customers.find(c=>c.id===customerId)?.company_name:'Escolha um cliente para continuar'}</strong><p>{customerId?'Os novos cadastros ficam vinculados a este cliente.':'As informações aparecerão somente após selecionar o cliente.'}</p></div>
 {customerId?<><ContractReadiness key={customerId} customerId={customerId} units={units} revision={listVersion} onOpen={c=>change(()=>{setCorrection(c);setTab(c.tab!);})}/><nav aria-label="Áreas de contratos" style={{display:'flex',flexWrap:'wrap',gap:8,margin:'16px 0'}}>{tabs.map(([id,label])=><Button key={id} variant={tab===id?'primary':'secondary'} aria-pressed={tab===id} onClick={()=>{change(()=>{setCorrection(null);setTab(id);});}}>{label}</Button>)}</nav>
 {tab?<WorkflowModal title={tabs.find(([id])=>id===tab)?.[1]||'Configuração'} onClose={()=>change(()=>{setTab('');setCorrection(null);setListVersion(v=>v+1);})}>{correction&&tab!=='preparation'?<Alert><p>Correção da conferência · {units.find(u=>u.id===correction.unitId)?.name} · {correction.month}</p><p>{correction.message}</p><p>Revise a vigência e o estado do registro. Rascunhos precisam de validação ou aprovação; abrir esta área não altera nenhum dado.</p><Button variant='secondary' onClick={()=>change(()=>{setListVersion(v=>v+1);setTab('preparation');})}>Voltar e atualizar diagnóstico</Button></Alert>:null}
 <div ref={destination} tabIndex={-1} key={customerId+'-'+tab+'-'+listVersion}>{tab==='distributor'?<Distributor allowNew={true} customerId={customerId} units={units} customers={customers} onUnits={setUnits} onDirty={setDirty}/>:tab==='supply'?<SupplyContracts onCorrect={c=>change(()=>{setCorrection(c);setCustomer(c.customerId);setTab(c.tab!);})} initialContext={correction?.tab===tab?correction:undefined} allowNew={true} customerId={customerId} onDirty={setDirty}/>:tab==='costs'?<MonthlyCosts initialContext={correction?.tab===tab?correction:undefined} customerId={customerId} units={units} onDirty={setDirty}/>:tab==='monthly'?<MonthlyInputs initialContext={correction?.tab===tab?correction:undefined} customerId={customerId} units={units} onDirty={setDirty}/>:tab==='preparation'?<CalculationPreparation customerId={customerId} units={units} initialContext={correction||undefined} onCorrect={c=>change(()=>{setCorrection(c);setCustomer(c.customerId);setTab(c.tab!);})}/>:tab==='parameters'?<CalculationParameters initialContext={correction?.tab===tab?correction:undefined} customerId={customerId} units={units} onDirty={setDirty}/>:<CommercialTerms initialContext={correction?.tab===tab?correction:undefined} allowNew={true} kind={tab as 'management'|'services'} customerId={customerId} units={units} customers={customers} onDirty={setDirty}/>}</div>{correction&&tab!=='preparation'?<Button variant='secondary' onClick={()=>change(()=>{setListVersion(v=>v+1);setTab('preparation');})}>Voltar e atualizar diagnóstico</Button>:null}</WorkflowModal>:null}</>:null}</>:null}
 </>:null}</section>;
}
export default function Page(){const {context}=useAuth();const id=context&&context.scope!=='global'?context.currentOrganization.id:'';return <ProtectedRoute><BackofficeShell>{id?<Workspace key={id}/>:<p>Selecione uma organização para operar.</p>}</BackofficeShell></ProtectedRoute>;}
