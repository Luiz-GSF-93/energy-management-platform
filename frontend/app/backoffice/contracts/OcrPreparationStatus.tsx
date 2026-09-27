'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {ocrContractLink} from './ocr-navigation';
type Review={author:string;createdAt:string;version:number;decision:string};
type Progress={canImport:false;homologated:false;checkedAt:string;groups:{key:string;title:string;confirmed:number;total:number;complete:boolean;rows:{key:string;label:string;state:string;review:Review|null}[]}[]};
type Monthly={state:string;month:string;existingStatus:string|null;message:string;values:{label:string;decimal:string|null;unit:string}[]};
type Demand={state:string;month:string|null;message:string;usedKw:string|null;unusedKw:string|null};
type Data={progress:Progress;monthly:Monthly;demand:Demand};
const states:Record<string,string>={CONFIRMED:'Conferência salva',PENDING:'Conferência pendente',BLOCKED:'Campo indisponível ou divergente',STALE:'Evidência alterada — conferir novamente',NEEDS_CORRECTION:'Correção solicitada'};
const integrationStates:Record<string,string>={INTEGRATED:'Integração registrada',READY:'Conferido — integração pendente',EXISTING_RECORD:'Registro mensal existente — preservado',RECORD_PRESERVED:'Registro mensal preservado',REVIEWS_PENDING:'Conferências pendentes',CONSUMPTION_REQUIRED:'Integração dos consumos necessária',UNSUPPORTED:'Enquadramento ainda não contemplado'};
const number=(value:string|null)=>value===null?'Não informado':value.replace('.',',');
/** Read-only view: reuse the same scoped review and integration endpoints as Documents. */
export default function OcrPreparationStatus({documentId,month}:{documentId:string;month:string}){
 const [refresh,setRefresh]=useState(0),[result,setResult]=useState<{key:string;data:Data|null;error:string}|null>(null);
 const key=JSON.stringify([documentId,month,refresh]);const current=result?.key===key;const data=current?result.data:null,error=current?result.error:'',busy=!current;
 useEffect(()=>{let active=true;const base='/api/v1/documents/'+encodeURIComponent(documentId)+'/ocr/';
  Promise.all([apiRequest<Progress>(base+'homologation'),apiRequest<Monthly>(base+'monthly-integration'),apiRequest<Demand>(base+'demand-integration')]).then(([progress,monthly,demand])=>{
   if(progress.canImport!==false||progress.homologated!==false||!Array.isArray(progress.groups)||!Array.isArray(monthly.values)||monthly.month!==month||(demand.month!==null&&demand.month!==month))throw Error('Invalid review context');
   if(active)setResult({key,data:{progress,monthly,demand},error:''});
  }).catch(()=>{if(active)setResult({key,data:null,error:'Não foi possível consultar as conferências e integrações atuais. Atualize a situação; a extração original não confirma o estado dos registros.'});});
  return()=>{active=false;};
 },[documentId,month,key]);
 return <section aria-label="Conferências e integrações atuais" style={{border:'1px solid #405873',borderRadius:12,padding:20,margin:'16px 0'}}>
  <h3>Conferências e integrações atuais</h3><button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Atualizar situação da fatura</button>
  {busy&&<p role="status">Consultando conferências salvas e integrações…</p>}{error&&<p role="alert">{error}</p>}
  {data&&<><p>Conferências da evidência atual · {new Date(data.progress.checkedAt).toLocaleString('pt-BR')}</p>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))',gap:16}}>{data.progress.groups.map(g=><article key={g.key}><h4>{g.title}</h4><p><strong>{g.confirmed} de {g.total} conferências salvas</strong></p><p>{g.complete?'Conferência concluída':g.total?'Há campos pendentes ou alterados':'Sem campos disponíveis neste layout'}</p><details><summary>Campos, autores e versões — {g.title}</summary><ul>{g.rows.map(r=><li key={r.key}><strong>{r.label}</strong>: {states[r.state]??'Conferência pendente'}{r.review&&<p>Último registro: {r.review.author} · {new Date(r.review.createdAt).toLocaleString('pt-BR')} · versão {r.review.version}{r.review.decision==='USED'?' · Demanda utilizada':r.review.decision==='UNUSED'?' · Demanda não utilizada':''}</p>}</li>)}</ul></details></article>)}</div>
   <h4>Integrações nos dados mensais</h4><p>O registro de integração preserva o que foi enviado ao rascunho. Conferências alteradas posteriormente continuam indicadas acima e precisam ser resolvidas.</p>
   <article><h5>Consumos</h5><p><strong>{integrationStates[data.monthly.state]??'Situação a conferir'}</strong></p><p>{data.monthly.message}</p><details><summary>Consumos da evidência atual</summary><ul>{data.monthly.values.map(v=><li key={v.label}>{v.label}: {number(v.decimal)} {v.unit}</li>)}</ul></details></article>
   <article><h5>Demanda faturada</h5><p><strong>{integrationStates[data.demand.state]??'Situação a conferir'}</strong></p><p>{data.demand.message}</p><p>Parcela utilizada: {number(data.demand.usedKw)} kW · Não utilizada: {number(data.demand.unusedKw)} kW</p></article>
   <p>O fechamento usa os dados mensais validados. A integração de consumos e demanda faturada não valida demanda medida, reativo ou a apuração financeira.</p>
   <a href={ocrContractLink(documentId,'monthly')}>Abrir dados mensais desta fatura</a>
  </>}
 </section>;
}
