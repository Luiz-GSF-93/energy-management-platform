'use client';
import dynamic from 'next/dynamic';
import {FormEvent,useEffect,useRef,useState} from 'react';
import {MapPinned,Search,ArrowUpRight,MapPin,RefreshCw,Building2,CheckCircle2,LocateFixed,TriangleAlert} from 'lucide-react';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import {Alert,Button,Card,Input} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
import {useAuth} from '@/app/providers';
import {MapResponse,MapUnit,located,locationLabels,precisionLabels} from './map-data';
import styles from './map.module.css';
import TerritorySummary from './TerritorySummary';
import PlatformEnergyMap from './PlatformEnergyMap';
import GeocodingReview from './GeocodingReview';
const Canvas=dynamic(()=>import('./MapCanvas'),{ssr:false,loading:()=> <div className={styles.mapFrame}><div className={styles.mapNotice}>Preparando mapa…</div></div>});
type History={revision:number;reason:string;actor_id:string;recorded_at:string;location:{precision:keyof typeof precisionLabels}};
const states='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

function EnergyMap({organizationId}:{organizationId:string}) {
 const [data,setData]=useState<MapResponse|null>(null),[access,setAccess]=useState<{enabled:boolean}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [filters,setFilters]=useState({search:'',state:'',market:'',location:'',status:''}),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
 const [selected,setSelected]=useState<MapUnit|null>(null),[editing,setEditing]=useState<MapUnit|null>(null),[history,setHistory]=useState<History[]>([]),[busy,setBusy]=useState(false),[saveError,setSaveError]=useState('');
 const [showMap,setShowMap]=useState(true),[requestId,setRequestId]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true),saveAbort=useRef<AbortController|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;saveAbort.current?.abort();};},[]);
 useEffect(()=>{
  const abort=new AbortController();setLoading(true);setError('');setSelected(null);setHistory([]);
  const timer=setTimeout(async()=>{try{
   const a=await apiRequest<{enabled:boolean;organizationId:string}>('/api/v1/energy-map/access',{signal:abort.signal,cache:'no-store'});
   if(abort.signal.aborted)return;if(a.organizationId!==organizationId)throw new Error('Atualize a organização selecionada.');setAccess(a);
   if(!a.enabled)return;
   const q=new URLSearchParams({offset:String(offset),limit:'200'});Object.entries(filters).forEach(([k,v])=>{if(v)q.set(k,v);});
   const result=await apiRequest<MapResponse>('/api/v1/energy-map/units?'+q,{signal:abort.signal,cache:'no-store'});
   if(abort.signal.aborted)return;if(result.organizationId!==organizationId||result.rows.some(u=>u.organizationId!==organizationId))throw new Error('Atualize a organização selecionada.');setData(result);
  }catch(e){if(!abort.signal.aborted){setData(null);setAccess(null);setError(e instanceof Error?e.message:'Consulta indisponível.');}}
  finally{if(!abort.signal.aborted)setLoading(false);}},250);
  return()=>{clearTimeout(timer);abort.abort();};
 },[organizationId,filters,offset,refresh]);
 useEffect(()=>{if(!selected)return;const a=new AbortController();setHistory([]);apiRequest<History[]>('/api/v1/energy-map/units/'+encodeURIComponent(selected.id)+'/history',{signal:a.signal,cache:'no-store'}).then(h=>{if(!a.signal.aborted)setHistory(h);}).catch(()=>{});return()=>a.abort();},[selected]);
 function filter(key:keyof typeof filters,value:string){setOffset(0);setFilters(f=>({...f,[key]:value}));}
 function openEdit(u:MapUnit){setSaveError('');setEditing(u);setRequestId(crypto.randomUUID());dialog.current?.showModal();}
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!editing||busy)return;const form=new FormData(e.currentTarget);setBusy(true);setSaveError('');const a=new AbortController();saveAbort.current=a;
  try{await apiRequest('/api/v1/energy-map/units/'+encodeURIComponent(editing.id)+'/location',{method:'PUT',signal:a.signal,cache:'no-store',body:{latitude:Number(form.get('latitude')),longitude:Number(form.get('longitude')),precision:form.get('precision'),reason:form.get('reason'),checkedAddress:form.get('checkedAddress')==='on',addressHash:editing.addressHash,revision:editing.revision,requestId}});
   if(!alive.current||a.signal.aborted)return;dialog.current?.close();setEditing(null);setRefresh(v=>v+1);
  }catch(e){if(alive.current&&!a.signal.aborted)setSaveError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{if(alive.current&&!a.signal.aborted)setBusy(false);}
 }
 return <section className={'backoffice-page '+styles.page}>
  <header className={styles.header}><div><div className={styles.eyebrow}><MapPinned size={16}/> INTELIGÊNCIA TERRITORIAL</div><h1>Mapa energético</h1><p>Uma visão da sua carteira, unidade por unidade.</p></div><Button variant="secondary" onClick={()=>setRefresh(v=>v+1)} disabled={loading||busy}><RefreshCw size={16}/> Atualizar</Button></header>
  {error?<Alert variant="error">{error}</Alert>:null}
  {!loading&&access&&!access.enabled?<Card><h2>Mapa em implantação</h2><p>A funcionalidade será disponibilizada para esta organização após a validação do piloto.</p></Card>:null}
  {data?<>
   <div className={styles.metrics}>{[
    [Building2,'Clientes',data.customers,'Na seleção atual'],[MapPinned,'Unidades',data.total,'Carteira filtrada'],[CheckCircle2,'Localizadas',data.confirmed,'Coordenadas conferidas'],[TriangleAlert,'Pendências',data.pending+data.stale,'Localizar ou revisar'],
   ].map(([Icon,label,value,note],i)=>{const I=Icon as typeof Building2;return <div key={i} className={styles.metric}><I size={19}/><span>{String(label)}</span><strong>{String(value)}</strong><small>{String(note)}</small></div>;})}</div>
  </>:null}
  {access?.enabled?<>
   <div className={styles.filters}><label className={styles.search}><Search size={17}/><input aria-label="Pesquisar carteira" placeholder="Cliente, unidade, cidade ou distribuidora" value={filters.search} maxLength={100} onChange={e=>filter('search',e.target.value)}/></label>
    <select aria-label="Estado" value={filters.state} onChange={e=>filter('state',e.target.value)}><option value="">Todos os estados</option>{states.map(s=><option key={s}>{s}</option>)}</select>
    <select aria-label="Mercado" value={filters.market} onChange={e=>filter('market',e.target.value)}><option value="">Todos os mercados</option><option value="ACL">Mercado livre · ACL</option><option value="ACR">Regulado · ACR</option><option value="UNKNOWN">Mercado não informado</option></select>
    <select aria-label="Localização" value={filters.location} onChange={e=>filter('location',e.target.value)}><option value="">Todas as localizações</option>{Object.entries(locationLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
    <select aria-label="Status da unidade" value={filters.status} onChange={e=>filter('status',e.target.value)}><option value="">Todos os status</option>{Object.entries({ACTIVE:'Ativa',INACTIVE:'Inativa',MIGRATED:'Migrada',CHURN:'Encerrada',SEASONAL:'Sazonal'}).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
   </div>
   {data&&!loading?<TerritorySummary rows={data.rows} organizationId={organizationId} onState={state=>filter('state',state)}/>:null}
   <div className={styles.workspace}>
    <div className={styles.mapColumn}><div className={styles.toolbar}><span><span className={styles.blueDot}/> ACL <span className={styles.liveDot}/> ACR <span className={styles.grayDot}/> Não informado</span><button type="button" onClick={()=>setShowMap(v=>!v)}>{showMap?'Usar somente lista':'Mostrar mapa'}</button></div>
     {showMap&&data?<Canvas rows={data.rows} organizationId={organizationId} selected={selected} onSelect={id=>setSelected(data.rows.find(u=>u.id===id)??null)}/>:null}
     <div className={styles.coverage}><MapPin size={15}/><span>{data?.rows.filter(located).length??0} pontos nesta página. Apenas localizações conferidas aparecem no mapa; precisão aproximada é indicada nos detalhes.</span></div>
    </div>
    <aside className={styles.details} aria-label="Detalhes da unidade">{selected?<>
     <div className={styles.eyebrow}>UNIDADE SELECIONADA</div><h2>{selected.name||'UC '+selected.number}</h2><p>{selected.customerName}</p><span className={styles.badge}>{locationLabels[selected.locationStatus]}</span>
     <dl><dt>Unidade consumidora</dt><dd>{selected.number}</dd><dt>Distribuidora</dt><dd>{selected.distributor}</dd><dt>Mercado</dt><dd>{selected.market==='UNKNOWN'?'Não informado':selected.market}</dd><dt>Endereço cadastral</dt><dd>{selected.address||'Não informado'}<br/>{[selected.city,selected.state].filter(Boolean).join(' / ')}</dd><dt>Grupo</dt><dd>{selected.group||'Não informado'}</dd>
      {selected.precision?<><dt>Precisão declarada</dt><dd>{precisionLabels[selected.precision]}</dd></>:null}{located(selected)?<><dt>Coordenadas</dt><dd>{selected.latitude?.toFixed(6)}, {selected.longitude?.toFixed(6)}</dd></>:null}
     </dl>{selected.locationStatus==='STALE'?<Alert>O cadastro mudou após a conferência. Revise a localização antes de recolocá-la no mapa.</Alert>:null}
     {data?.canManage?<Button onClick={()=>openEdit(selected)}><LocateFixed size={16}/>{selected.revision?'Revisar localização':'Localizar unidade'}</Button>:null}
     {data?.canManage?<GeocodingReview key={selected.id+selected.addressHash+selected.revision} unit={selected} onConfirmed={()=>setRefresh(v=>v+1)}/>:null}<a className={styles.link} href="/backoffice/setup">Abrir clientes e unidades <ArrowUpRight size={15}/></a>
     {history.length?<details><summary>Histórico de localização ({history.length})</summary>{history.map(h=><p key={h.revision}><strong>Versão {h.revision}</strong><br/>{new Date(h.recorded_at).toLocaleString('pt-BR')}<br/>{h.reason}</p>)}</details>:null}
    </>:<div className={styles.emptyDetail}><MapPinned size={36}/><h2>Explore sua carteira</h2><p>Escolha uma unidade no mapa ou na lista para ver seus detalhes e conferir a localização.</p></div>}</aside>
   </div>
   <div className={styles.listHeader}><h2>Unidades da carteira</h2><span>{loading?'Atualizando…':data?`${data.total?offset+1:0}–${Math.min(offset+data.rows.length,data.total)} de ${data.total}`:'Consulta indisponível'}</span></div>
   <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Cliente / unidade</th><th>Cidade</th><th>Distribuidora</th><th>Mercado</th><th>Localização</th><th>Detalhes</th></tr></thead><tbody>{data?.rows.map(u=><tr key={u.id} data-selected={selected?.id===u.id}><td><strong>{u.customerName}</strong><small>{u.name||'Unidade consumidora'} · {u.number}</small></td><td>{u.city||'Não informada'}{u.state?' / '+u.state:''}</td><td>{u.distributor}</td><td>{u.market==='UNKNOWN'?'Não informado':u.market}</td><td><span className={styles.badge} data-status={u.locationStatus}>{locationLabels[u.locationStatus]}</span></td><td><button type="button" className={styles.rowButton} onClick={()=>setSelected(u)} aria-label={'Ver detalhes de '+u.number}>Ver unidade <ArrowUpRight size={15}/></button></td></tr>)}</tbody></table></div>
   {!loading&&data&&!data.rows.length?<div className={styles.emptyList}><MapPin size={28}/><h3>Nenhuma unidade nesta seleção</h3><p>Revise os filtros ou cadastre uma unidade em Clientes e unidades.</p></div>:null}
   <div className={styles.pagination}><span>O mapa acompanha as unidades desta página · até 200 por consulta.</span><Button variant="secondary" disabled={loading||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-200))}>Anterior</Button><Button variant="secondary" disabled={loading||!data||offset+data.rows.length>=data.total} onClick={()=>setOffset(v=>v+200)}>Próxima</Button></div>
  </>:loading?<p role="status">Consultando acesso ao mapa…</p>:null}
  <dialog ref={dialog} className={styles.dialog} aria-labelledby="location-title" onCancel={e=>{if(busy)e.preventDefault();}} onClose={()=>setEditing(null)}><div className={styles.header}><h2 id="location-title">Conferir localização</h2><Button variant="secondary" disabled={busy} onClick={()=>dialog.current?.close()}>Fechar</Button></div>{saveError?<Alert variant="error">{saveError}</Alert>:null}{editing?<form key={editing.id} onSubmit={save}><p><strong>{editing.customerName} · {editing.name||editing.number}</strong><br/>{editing.address||'Endereço não informado'}<br/>{editing.city} / {editing.state}</p><p>Use coordenadas verificadas da unidade. Localização por cidade ou CEP deve ser identificada como aproximada.</p><div className={styles.coordinates}><Input name="latitude" label="Latitude" type="number" step="any" min={-90} max={90} required disabled={busy} defaultValue={editing.latitude??''}/><Input name="longitude" label="Longitude" type="number" step="any" min={-180} max={180} required disabled={busy} defaultValue={editing.longitude??''}/></div><label>Precisão da localização<select name="precision" required disabled={busy} defaultValue={editing.precision??'ADDRESS'}>{Object.entries(precisionLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><Input name="reason" label="Fonte da conferência / justificativa" required minLength={3} maxLength={500} disabled={busy}/><label className={styles.check}><input type="checkbox" name="checkedAddress" required disabled={busy}/> Conferi que as coordenadas correspondem ao endereço desta unidade, com a precisão indicada.</label><Button type="submit" disabled={busy}>{busy?'Salvando…':'Salvar localização conferida'}</Button></form>:null}</dialog>
 </section>;
}
export default function Page(){const {context}=useAuth();return <ProtectedRoute><BackofficeShell>{context?.scope==='organization'?<EnergyMap key={context.currentOrganization.id} organizationId={context.currentOrganization.id}/>:context?.scope==='global'&&context.role==='admin_platform'?<PlatformEnergyMap key={'platform-'+context.user.id}/>:<section className="backoffice-page"><h1>Mapa energético</h1><p>Selecione uma organização para explorar a carteira autorizada.</p></section>}</BackofficeShell></ProtectedRoute>;}
