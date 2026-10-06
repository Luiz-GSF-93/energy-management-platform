'use client';
import dynamic from 'next/dynamic';
import {useEffect,useState} from 'react';
import {Building2,CheckCircle2,MapPinned,RefreshCw,Search,TriangleAlert} from 'lucide-react';
import {Alert,Button} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
import {locationLabels,precisionLabels} from './map-data';
import {PlatformMapResponse,PlatformMapRow,platformLocated,validPlatformMap} from './platform-map-data';
import styles from './map.module.css';
import TerritorySummary from './TerritorySummary';
const Canvas=dynamic(()=>import('./PlatformMapCanvas'),{ssr:false,loading:()=> <div className={styles.mapFrame}><p>Preparando mapa geral…</p></div>});
const states='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const statusLabel=(row:PlatformMapRow)=>row.hasUnit?locationLabels[row.locationStatus as keyof typeof locationLabels]:'Cliente sem unidade';
export default function PlatformEnergyMap(){
 const [data,setData]=useState<PlatformMapResponse|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0),[offset,setOffset]=useState(0);
 const [filters,setFilters]=useState({search:'',organizationId:'',state:'',market:'',location:''}),[selected,setSelected]=useState<PlatformMapRow|null>(null),[showMap,setShowMap]=useState(true);
 useEffect(()=>{const abort=new AbortController();setLoading(true);setError('');setSelected(null);setData(null);
  const timer=setTimeout(async()=>{try{const q=new URLSearchParams({limit:'200',offset:String(offset)});Object.entries(filters).forEach(([k,v])=>{if(v)q.set(k,v);});
   const result=await apiRequest<PlatformMapResponse>('/api/v1/admin/energy-map?'+q,{cache:'no-store',signal:abort.signal});
   if(abort.signal.aborted)return;if(!validPlatformMap(result)||filters.organizationId&&result.rows.some(r=>r.organizationId!==filters.organizationId))throw new Error('Resposta do mapa geral inválida.');setData(result);
  }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Mapa geral indisponível.');}finally{if(!abort.signal.aborted)setLoading(false);}},250);
  return()=>{clearTimeout(timer);abort.abort();};
 },[filters,offset,refresh]);
 function filter(key:keyof typeof filters,value:string){setOffset(0);setFilters(f=>({...f,[key]:value}));}
 return <section className={'backoffice-page '+styles.page}>
  <header className={styles.header}><div><div className={styles.eyebrow}><MapPinned size={16}/> VISÃO DA PLATAFORMA</div><h1>Mapa energético da plataforma</h1><p>Todos os clientes e unidades das organizações da plataforma.</p></div><Button variant="secondary" disabled={loading} onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={16}/> Atualizar</Button></header>
  {error?<Alert variant="error">{error}</Alert>:null}
  {data?<div className={styles.metrics}>{[[Building2,'Organizações',data.organizations,'Com clientes nesta seleção'],[Building2,'Clientes',data.customers,`${data.withoutUnits} sem unidade cadastrada`],[MapPinned,'Unidades',data.units,'Carteira filtrada'],[CheckCircle2,'Localizadas',data.confirmed,`${data.pending} aguardando conferência`]].map(([Icon,label,value,note],i)=>{const I=Icon as typeof Building2;return <div key={i} className={styles.metric}><I size={19}/><span>{String(label)}</span><strong>{String(value)}</strong><small>{String(note)}</small></div>;})}</div>:null}
  <div className={styles.filters}><label className={styles.search}><Search size={17}/><input aria-label="Pesquisar carteira da plataforma" placeholder="Cliente, organização, cidade ou distribuidora" maxLength={100} value={filters.search} onChange={e=>filter('search',e.target.value)}/></label>
   <select aria-label="Organização" value={filters.organizationId} onChange={e=>filter('organizationId',e.target.value)}><option value="">Todas as organizações</option>{data?.organizationOptions.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>
   <select aria-label="Estado" value={filters.state} onChange={e=>filter('state',e.target.value)}><option value="">Todos os estados</option>{states.map(s=><option key={s}>{s}</option>)}</select>
   <select aria-label="Mercado" value={filters.market} onChange={e=>filter('market',e.target.value)}><option value="">Todos os mercados</option><option value="ACL">Mercado livre · ACL</option><option value="ACR">Regulado · ACR</option><option value="UNKNOWN">Não informado / sem unidade</option></select>
   <select aria-label="Localização" value={filters.location} onChange={e=>filter('location',e.target.value)}><option value="">Todas as localizações</option>{Object.entries({...locationLabels,NO_UNIT:'Clientes sem unidade'}).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
  </div>
  {loading?<p role="status">Consultando carteira da plataforma…</p>:null}
  {data?<><TerritorySummary rows={data.rows} onState={state=>filter('state',state)}/><div className={styles.workspace}><div className={styles.mapColumn}><div className={styles.toolbar}><span><span className={styles.blueDot}/> ACL <span className={styles.liveDot}/> ACR <span className={styles.grayDot}/> Não informado</span><button onClick={()=>setShowMap(v=>!v)}>{showMap?'Usar somente lista':'Mostrar mapa'}</button></div>{showMap?<Canvas rows={data.rows} selected={selected} onSelect={id=>setSelected(data.rows.find(r=>r.id===id)??null)}/>:null}<div className={styles.coverage}><TriangleAlert size={15}/><span>{data.rows.filter(platformLocated).length} pontos nesta página. Clientes sem unidade e unidades sem coordenadas aparecem na lista.</span></div></div>
   <aside className={styles.details} aria-label="Detalhes da carteira global">{selected?<><div className={styles.eyebrow}>CARTEIRA DA PLATAFORMA</div><h2>{selected.customerName}</h2><p>{selected.organizationName}</p><span className={styles.badge}>{statusLabel(selected)}</span><dl><dt>Organização</dt><dd>{selected.organizationName}</dd><dt>Unidade</dt><dd>{selected.hasUnit?selected.name||selected.number:'Nenhuma unidade cadastrada'}</dd>{selected.hasUnit?<><dt>Unidade consumidora</dt><dd>{selected.number}</dd><dt>Distribuidora</dt><dd>{selected.distributor||'Não informada'}</dd><dt>Mercado</dt><dd>{selected.market==='UNKNOWN'?'Não informado':selected.market}</dd><dt>Endereço cadastral</dt><dd>{selected.address||'Não informado'}<br/>{[selected.city,selected.state].filter(Boolean).join(' / ')}</dd></>:null}{platformLocated(selected)?<><dt>Precisão declarada</dt><dd>{selected.precision?precisionLabels[selected.precision]:'Não informada'}</dd></>:null}</dl><p>Para alterar cadastros ou conferir localizações, opere a organização correspondente.</p><a href="/backoffice/organizations" className={styles.link}>Abrir organizações</a></>:<div className={styles.emptyDetail}><MapPinned size={36}/><h2>Explore a carteira geral</h2><p>Selecione um cliente ou unidade para consultar a organização e os detalhes.</p></div>}</aside>
  </div><div className={styles.listHeader}><h2>Clientes e unidades da plataforma</h2><span>{data.total?offset+1:0}–{Math.min(offset+data.rows.length,data.total)} de {data.total} registros</span></div>
  <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Organização</th><th>Cliente / unidade</th><th>Cidade</th><th>Mercado</th><th>Localização</th><th>Detalhes</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.id} data-selected={selected?.id===row.id}><td>{row.organizationName}</td><td><strong>{row.customerName}</strong><small>{row.hasUnit?`${row.name||'Unidade'} · ${row.number}`:'Sem unidade cadastrada'}</small></td><td>{row.city||'Não informada'}{row.state?' / '+row.state:''}</td><td>{row.hasUnit&&row.market!=='UNKNOWN'?row.market:'—'}</td><td><span className={styles.badge}>{statusLabel(row)}</span></td><td><button className={styles.rowButton} aria-label={'Ver detalhes de '+row.id} onClick={()=>setSelected(row)}>Ver detalhes</button></td></tr>)}</tbody></table></div>
  {!data.rows.length?<div className={styles.emptyList}><h3>Nenhum cliente nesta seleção</h3><p>Revise os filtros.</p></div>:null}
  <div className={styles.pagination}><span>Mapa da página atual · até 200 registros. Cada unidade ocupa uma linha; clientes sem unidade também são incluídos.</span><Button variant="secondary" disabled={loading||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-200))}>Anterior</Button><Button variant="secondary" disabled={loading||offset+data.rows.length>=data.total} onClick={()=>setOffset(v=>v+200)}>Próxima</Button></div></>:null}
 </section>;
}
