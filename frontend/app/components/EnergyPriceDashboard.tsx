'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import EnergyPriceChart,{EnergyPriceMonth} from './EnergyPriceChart';
import {Alert,Button} from './ui';
import styles from './EnergyPriceDashboard.module.css';
type Unit={id:string;name:string;customerId:string;customerName:string};
type Baseline={unitId:string;published:boolean;baseline:{state:string;reason?:string;from?:string;to?:string;disclosure?:string};study:{id:string;hash:string;version:number;reviewed:boolean}|null};
type Data={organizationId:string;audience:string;customerId:string|null;year:number;units:Unit[];baselines:Baseline[];months:EnergyPriceMonth[];acrAverage:string|null;aclAverage:string|null;indicative:{value:string|null;notice:string;reason:string;basis?:string};canPublish:boolean;disclosure:string;footer:string};
const display=(v:string|null)=>v===null?'Aguardando referência':'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'/MWh';
export default function EnergyPriceDashboard({organizationId,audience='backoffice'}:{organizationId:string;audience?:'backoffice'|'client'}){
 const [year,setYear]=useState(new Date().getFullYear()),[customer,setCustomer]=useState(''),[unit,setUnit]=useState(''),[options,setOptions]=useState<Unit[]>([]),[data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0),[publishing,setPublishing]=useState(false),[checked,setChecked]=useState<string[]>([]);
 useEffect(()=>{
  const abort=new AbortController();let current=true;
  setData(null);setError('');setLoading(true);setChecked([]);
  const query=new URLSearchParams({year:String(year)});if(audience==='backoffice'&&customer)query.set('customerId',customer);if(unit)query.set('unitId',unit);
  apiRequest<Data>('/api/v1/'+(audience==='client'?'portal/':'')+'energy-prices?'+query,{signal:abort.signal,cache:'no-store'}).then(result=>{
   if(result.organizationId!==organizationId||result.audience!==audience||result.year!==year||audience==='backoffice'&&customer!==''&&result.customerId!==customer||audience==='client'&&!result.customerId||unit&&result.units.some(u=>u.id!==unit)||result.customerId&&result.units.some(u=>u.customerId!==result.customerId))throw Error('Escopo do indicador alterado; atualize a consulta.');
   if(!current)return;if(audience==='backoffice'&&!customer&&result.customerId){setCustomer(result.customerId);setOptions(result.units);return;}setData(result);if(!unit&&(audience==='client'||!customer))setOptions(result.units);
  }).catch(e=>{if(current)setError(e instanceof Error?e.message:'Indicador indisponível.');}).finally(()=>{if(current)setLoading(false);});
  return()=>{current=false;abort.abort();};
 },[organizationId,audience,year,customer,unit,revision]);
 const customers=Array.from(new Map(options.map(u=>[u.customerId,{id:u.customerId,name:u.customerName}])).values());
 const select=(key:'year'|'customer'|'unit',value:string)=>{setData(null);setError('');setLoading(true);if(key==='year')setYear(Number(value));if(key==='customer'){setCustomer(value);setUnit('');}if(key==='unit')setUnit(value);};
 const publish=async(b:Baseline)=>{
  if(!b.study||!checked.includes(b.unitId)||publishing)return;setPublishing(true);setError('');
  try{await apiRequest('/api/v1/energy-prices/publish',{method:'POST',body:{studyId:b.study.id,hash:b.study.hash,requestId:crypto.randomUUID(),checked:true}});setRevision(v=>v+1);}catch(e){setError(e instanceof Error?e.message:'Publicação indisponível.');}finally{setPublishing(false);}
 };
 return <section className={styles.panel} aria-label="Dashboard de preço da energia"><h2>Mercado Livre de Energia</h2><p>Compare os perfis ACR, ACL do fornecedor e mercado em R$/MWh. Os spreads de 5%, 10% e 15% são cenários estimados.</p>
  <div className={styles.filters}><label>Ano <select value={year} disabled={publishing} onChange={e=>select('year',e.target.value)}>{Array.from({length:101},(_,i)=>2000+i).map(y=><option key={y} value={y}>{y}</option>)}</select></label>
   {audience==='backoffice'?<label>Cliente <select value={customer} disabled={publishing} onChange={e=>select('customer',e.target.value)}><option value="">Selecione um cliente</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>:null}
   <label>Unidades <select disabled={publishing||audience==='backoffice'&&!customer} value={unit} onChange={e=>select('unit',e.target.value)}><option value="">Consolidar unidades do cliente</option>{options.filter(u=>audience==='client'||u.customerId===customer).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
   <Button variant="secondary" disabled={loading||publishing} onClick={()=>setRevision(v=>v+1)}>Atualizar</Button></div>
  {loading?<p role="status">Conferindo referências e publicações…</p>:null}{error?<Alert variant="error">{error}</Alert>:null}
  {data?.customerId&&!loading?<><div className={styles.cards}><article><span>Antes da adesão · TE ACR</span><strong>{display(data.acrAverage)}</strong><small>Referência anual; confira período e estimativas abaixo.</small></article><article><span>Perfil ACL · energia do fornecedor</span><strong>{display(data.aclAverage)}</strong><small>Somente energia do fornecedor; exclui distribuidora, demanda e honorários. Confira a base tributária publicada.</small></article><article><span>PLD mensal · CCEE</span><strong>{display([...data.months].reverse().find(m=>m.pld!==null)?.pld??null)}</strong><small>Referência do mês e submercado. Spreads estimados disponíveis no gráfico.</small></article></div>
   <div className={styles.layout}><EnergyPriceChart months={data.months} footer={data.footer}/><aside className={styles.strategy}><h3>Preço indicativo de compra</h3><strong>{display(data.indicative.value)}</strong><p className={styles.notice}>{data.indicative.notice}</p><p>{data.indicative.reason}</p><p>Compare propostas com a mesma vigência, volume, perdas e flexibilidade. Confirme a estratégia com seu Consultor.</p></aside></div>
   <p className={styles.disclosure}>{data.disclosure}</p>
   {data.baselines.map(b=><article className={styles.reference} key={b.unitId}><strong>{data.units.find(u=>u.id===b.unitId)?.name}</strong><p>{b.published?'Referência publicada':audience==='backoffice'?'Prévia interna — ainda não publicada':'Referência ainda não publicada'}{b.baseline.from?' · '+b.baseline.from+' a '+b.baseline.to:''}</p><small>{b.baseline.disclosure||b.baseline.reason}</small>
    {!b.published&&data.canPublish&&b.study?.reviewed&&b.baseline.state==='AVAILABLE'?<div><label><input type="checkbox" checked={checked.includes(b.unitId)} onChange={e=>setChecked(v=>e.target.checked?[...v,b.unitId]:v.filter(id=>id!==b.unitId))}/> Conferi a referência anual e as estimativas da versão {b.study.version} revisada independentemente.</label><Button disabled={!checked.includes(b.unitId)||publishing} onClick={()=>publish(b)}>Publicar referência no Portal</Button></div>:null}
   </article>)}
  </>:!loading&&!error?<p>Selecione um cliente para visualizar suas unidades. O consolidado reúne apenas unidades desse cliente.</p>:null}
 </section>;
}
