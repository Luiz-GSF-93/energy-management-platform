'use client';
import {usePortalUnitScope} from './PortalUnitScope';
import AnnualConsumptionComparison,{type AnnualPlanningView} from './AnnualConsumptionComparison';
import {usePublicationRefresh} from './usePublicationRefresh';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button,Card} from '@/app/components/ui';
import AnnualForecastPresentation,{type AnnualForecast} from '@/app/backoffice/reports/AnnualForecastPresentation';
type Planning={annualComparison?:AnnualPlanningView;forecastId:string;unitName?:string;sourceOrigins?:{month:string;kind:string}[];state:string;calculatedAt?:string;sourceFingerprint?:string;sourceMonths?:string[];notice:string;forecast?:Published};
type Published=AnnualForecast&{id:string;unitName:string;publishedAt:string;version:number};
export default function PublishedForecastDashboard(){
 const publicationRevision=usePublicationRefresh(),scope=usePortalUnitScope(),scopeUnits=JSON.stringify(scope?.unitIds??null);
 const scopeRef=useRef(scopeUnits);
 const [consolidated,setConsolidated]=useState<AnnualPlanningView|null>(null);
 const [planning,setPlanning]=useState<Planning[]>([]);
 const [rows,setRows]=useState<Published[]|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[selected,setSelected]=useState('');
 useEffect(()=>{
  const abort=new AbortController();let cancelled=false;
  if(scopeRef.current!==scopeUnits){scopeRef.current=scopeUnits;setRows(null);setPlanning([]);setConsolidated(null);setError('');}
  apiRequest<{rows:Published[];currentPlanning?:Planning[];consolidatedAnnual?:AnnualPlanningView|null}>('/api/v1/portal/energy-forecasts'+(scope?.unitIds?'?unitIds='+encodeURIComponent(scope.unitIds.join(',')):''),{cache:'no-store',signal:abort.signal}).then(data=>{
   if(cancelled)return;setConsolidated(data.consolidatedAnnual??null);setPlanning(data.currentPlanning??[]);setRows(data.rows);setError('');setSelected(old=>data.rows.some(r=>r.id===old)||data.currentPlanning?.some(p=>p.forecastId===old)?old:data.currentPlanning?.[0]?.forecastId??data.rows[0]?.id??'');
  }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Não foi possível consultar a previsão.');});
  return()=>{cancelled=true;abort.abort();};
 },[revision,publicationRevision,scopeUnits]);
 const forecast=rows?.find(r=>r.id===selected),current=planning.find(p=>p.forecastId===selected);
 const choices=[...(rows??[]).map(r=>({id:r.id,label:r.unitName+' · '+r.asOfMonth+' · v'+r.version})),...planning.filter(p=>!rows?.some(r=>r.id===p.forecastId)).map(p=>({id:p.forecastId,label:(p.unitName??'Unidade')+' · planejamento atual'}))];
 return <Card><h2>Planejamento de consumo</h2><p>Projeção com prioridade para medições CCEE completas; na ausência, consumo publicado e histórico documentado da distribuidora.</p>
 <Button variant="secondary" disabled={rows===null&&!error} onClick={()=>{setRows(null);setError('');setRevision(n=>n+1);}}>Atualizar previsões</Button>
 {error?<Alert>{error}</Alert>:rows===null?<p role="status">Consultando previsões publicadas…</p>:!choices.length?<p>Nenhuma previsão publicada disponível. Versões em preparação ou somente validadas aguardam publicação pela equipe de gestão.</p>:<>
 {consolidated?.state==='AVAILABLE'?<AnnualConsumptionComparison planning={consolidated}/>:consolidated?<Alert>{consolidated.notice} {consolidated.pending.join(' ')}</Alert>:null}
 <label>Detalhamento por unidade e competência de corte<select value={selected} onChange={e=>setSelected(e.target.value)}>{choices.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
 {!consolidated&&current?.annualComparison?.state==='AVAILABLE'?<AnnualConsumptionComparison planning={current.annualComparison}/>:null}
 {current?.state==='AVAILABLE'&&current.forecast?<section aria-label="Planejamento atual com novas publicações"><h3>Planejamento atual · atualização automática</h3><p>{current.notice}</p><p>Atualizado em {new Date(current.calculatedAt!).toLocaleString('pt-BR')} · histórico utilizado: {current.sourceMonths?.join(', ')||'histórico aprovado'}</p>{current.sourceOrigins?.length?<p>Fontes utilizadas: {Array.from(new Set(current.sourceOrigins.map(s=>s.kind==='CCEE_FINAL'?'CCEE · medição final':s.kind==='PUBLISHED_CONSUMPTION'?'Consumo do fechamento publicado':s.kind==='PUBLISHED_INVOICE_HISTORY'?'Histórico da fatura publicada':'Histórico revisado'))).join('; ')}.</p>:null}<>{current.annualComparison?.state==='AVAILABLE'?<details><summary>Previsão pelo motor histórico e faixas contratuais</summary><AnnualForecastPresentation forecast={{...current.forecast,qualifications:[]}} preliminary/></details>:<AnnualForecastPresentation forecast={{...current.forecast,qualifications:[]}} preliminary/>}</><small style={{overflowWrap:'anywhere'}}>Referência das fontes: {current.sourceFingerprint}</small></section>:current?current.annualComparison?.state==='AVAILABLE'?<details><summary>Conferência da previsão pelo motor histórico</summary><Alert>{current.notice}</Alert></details>:<Alert>{current.notice}</Alert>:null}
 {forecast?<details open={!current?.forecast}><summary>Previsão histórica publicada · versão {forecast.version}</summary><p>Publicado em {new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(forecast.publishedAt))} · Versão {forecast.version}</p><AnnualForecastPresentation forecast={{...forecast,qualifications:[]}}/></details>:null}
 </>}
 </Card>;
}
