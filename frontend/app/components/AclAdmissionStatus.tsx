'use client';
import { useEffect, useState } from 'react';
import { apiRequest } from '@/app/lib/api/client';
import { Alert, Button } from '@/app/components/ui';
type StatusRow={unitId:string;unitName:string;status:'NOT_STARTED'|'IN_PROGRESS'|'CONCLUDED';summary?:{modality:'RETAIL'|'OWN_AGENT';supplyDate:string;conclusion:string;publishedAt:string}};
type Page={enabled:boolean;rows:StatusRow[];nextCursor:string|null};
const labels={NOT_STARTED:'Adesão registrada',IN_PROGRESS:'Em andamento',CONCLUDED:'Concluída'};
export default function AclAdmissionStatus(){
 const [page,setPage]=useState<Page|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const abort=new AbortController();
  apiRequest<Page>('/api/v1/portal/acl-admissions',{signal:abort.signal}).then(value=>{if(!abort.signal.aborted)setPage(value);}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível consultar a adesão.');});
  return()=>abort.abort();
 },[]);
 async function more(){if(!page?.nextCursor||busy)return;setBusy(true);setError('');try{
  const value=await apiRequest<Page>('/api/v1/portal/acl-admissions?after='+encodeURIComponent(page.nextCursor));
  setPage(old=>old?{...value,rows:[...old.rows,...value.rows]}:value);
 }catch(e){setError(e instanceof Error?e.message:'Não foi possível consultar a adesão.');}finally{setBusy(false);}}
 if(page&&!page.enabled)return null;
 if(!page&&!error)return null;
 return <section aria-labelledby="acl-status-title" style={{margin:'24px 0'}}><h2 id="acl-status-title">Adesão ACL</h2>
 {error?<Alert>{error}</Alert>:null}
 {page?.enabled&&page.rows.length===0?<p>Não há adesões registradas para suas unidades.</p>:null}
 {page?.rows.map(row=><article key={row.unitId} style={{padding:18,margin:'12px 0',border:'1px solid #dce5e8',borderRadius:12}}>
  <h3>{row.unitName}</h3><p><strong>Status:</strong> {labels[row.status]}</p>
  {row.status==='CONCLUDED'&&row.summary?<div><h4>Resumo da adesão</h4><p>{row.summary.conclusion}</p><p>Modalidade: {row.summary.modality==='RETAIL'?'Varejista':'Agente próprio'}</p><p>Início do suprimento: {row.summary.supplyDate.split('-').reverse().join('/')}</p></div>:null}
 </article>)}
 {page?.nextCursor?<Button variant="secondary" disabled={busy} onClick={()=>void more()}>{busy?'Carregando…':'Ver mais unidades'}</Button>:null}
 </section>;
}
