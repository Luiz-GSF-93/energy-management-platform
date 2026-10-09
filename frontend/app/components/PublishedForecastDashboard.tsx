'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button,Card} from '@/app/components/ui';
import AnnualForecastPresentation,{type AnnualForecast} from '@/app/backoffice/reports/AnnualForecastPresentation';
type Published=AnnualForecast&{id:string;unitName:string;publishedAt:string;version:number};
export default function PublishedForecastDashboard(){
 const [rows,setRows]=useState<Published[]|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[selected,setSelected]=useState('');
 useEffect(()=>{
  const abort=new AbortController();let cancelled=false;
  apiRequest<{rows:Published[]}>('/api/v1/portal/energy-forecasts',{cache:'no-store',signal:abort.signal}).then(data=>{
   if(cancelled)return;setRows(data.rows);setSelected(data.rows[0]?.id??'');
  }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Não foi possível consultar a previsão.');});
  return()=>{cancelled=true;abort.abort();};
 },[revision]);
 const forecast=rows?.find(r=>r.id===selected);
 return <Card><h2>Planejamento de consumo</h2><p>Previsões validadas e publicadas pela equipe de gestão para as suas unidades.</p>
 <Button variant="secondary" disabled={rows===null&&!error} onClick={()=>{setRows(null);setError('');setSelected('');setRevision(n=>n+1);}}>Atualizar previsões</Button>
 {error?<Alert>{error}</Alert>:rows===null?<p role="status">Consultando previsões publicadas…</p>:!rows.length?<p>Nenhuma previsão publicada disponível. Versões em preparação ou somente validadas aguardam publicação pela equipe de gestão.</p>:<>
 <label>Unidade e competência de corte<select value={selected} onChange={e=>setSelected(e.target.value)}>{rows.map(r=><option key={r.id} value={r.id}>{r.unitName} · {r.asOfMonth} · v{r.version}</option>)}</select></label>
 {forecast?<><p>Publicado em {new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(forecast.publishedAt))} · Versão {forecast.version}</p><AnnualForecastPresentation forecast={{...forecast,qualifications:[]}}/></>:null}
 </>}
 </Card>;
}
