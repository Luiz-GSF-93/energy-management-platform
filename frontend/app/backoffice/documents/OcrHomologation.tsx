'use client';
import OcrReactiveIntegration from './OcrReactiveIntegration';
import OcrDemandTaxes from './OcrDemandTaxes';
import OcrSplitDemandIntegration from './OcrSplitDemandIntegration';
import OcrCipIntegration from './OcrCipIntegration';
import OcrCdeIntegration from './OcrCdeIntegration';
import OcrTusdTaxes from './OcrTusdTaxes';
import OcrTusdIntegration from './OcrTusdIntegration';
import OcrCalculationStatus from './OcrCalculationStatus';
import OcrMeasurementReadiness from './OcrMeasurementReadiness';
import OcrDemandIntegration from './OcrDemandIntegration';
import OcrMonthlyIntegration from './OcrMonthlyIntegration';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
type Row={key:string;label:string;state:string;review:null|{author:string;createdAt:string;version:number;decision:string}};
type Progress={canImport:false;homologated:false;checkedAt:string;state:string;message:string;groups:{key:string;title:string;confirmed:number;total:number;complete:boolean;rows:Row[]}[];integration:{key:string;title:string;state:string;message:string}[]};
const states:Record<string,string>={CONFIRMED:'Conferência salva',PENDING:'Conferência pendente',BLOCKED:'Campo indisponível ou divergente',STALE:'Evidência alterada — conferir novamente',NEEDS_CORRECTION:'Correção solicitada'};
const actions:Record<string,string>={identity:'Conferir identidade e competência',consumption:'Conferir consumo no PDF',demand:'Classificar parcelas de demanda'};
export default function OcrHomologation({id}:{id:string}){
 const [parameterVersion,setParameterVersion]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null),request=useRef(0);
 const [data,setData]=useState<Progress|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>()=>{request.current++;},[id]);
 async function load(){const version=++request.current;setData(null);setBusy(true);setError('');try{const next=await apiRequest<Progress>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/homologation');if(version===request.current)setData(next);}catch{if(version===request.current)setError('Não foi possível consultar todas as conferências. Atualize o painel; nenhum dado foi alterado.');}finally{if(version===request.current)setBusy(false);}}
 return <section><button type="button" onClick={()=>{dialog.current?.showModal();void load();}}>Acompanhar homologação</button><dialog ref={dialog} aria-label="Homologação da fatura" style={{width:'min(1100px,94vw)',maxHeight:'90vh',overflow:'auto',background:'#101b2c',color:'#f0f5ff',border:'1px solid #536984',borderRadius:16,padding:24}}>
 <button type="button" onClick={()=>dialog.current?.close()}>Fechar homologação</button><h2>Homologação da fatura</h2><p>Conferências salvas e etapas para integrar os dados da fatura.</p><button type="button" disabled={busy} onClick={()=>void load()}>Atualizar homologação</button>{busy&&<p role="status">Consultando conferências atuais…</p>}{error&&<p role="alert">{error}</p>}
 {data&&<><p role="status"><strong>{data.state==='REVIEWS_COMPLETE'?'Conferências concluídas — consulte as integrações abaixo':'Homologação pendente de conferências'}</strong></p><p>{data.message}</p><small>Consulta em {new Date(data.checkedAt).toLocaleString('pt-BR')}. Atualize após registrar uma conferência.</small>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,260px),1fr))',gap:16,marginTop:20}}>{data.groups.map(g=><article key={g.key} style={{border:'1px solid #405873',borderRadius:12,padding:16}}><h3>{g.title}</h3><p style={{fontSize:24,color:g.complete?'#6ee7b7':'#fcd34d'}}>{g.confirmed} de {g.total} conferências salvas</p>{!g.total&&<p>Não há parcelas disponíveis neste layout para classificar.</p>}<p>Para conferir: feche este painel e abra “{actions[g.key]}”.</p><ul>{g.rows.map(r=><li key={r.key} style={{marginBottom:16}}><strong>{r.label}</strong><p>{states[r.state]??'Conferência pendente'}</p>{r.review&&<small>Último registro: {r.review.author} · {new Date(r.review.createdAt).toLocaleString('pt-BR')} · Versão {r.review.version}{r.review.decision==='USED'?' · Demanda utilizada':r.review.decision==='UNUSED'?' · Demanda não utilizada':''}</small>}</li>)}</ul></article>)}</div>
 <OcrMonthlyIntegration id={id}/><OcrDemandIntegration id={id}/><OcrMeasurementReadiness id={id}/><OcrTusdIntegration id={id} onCreated={()=>setParameterVersion(v=>v+1)}/><OcrTusdTaxes id={id} onCreated={()=>setParameterVersion(v=>v+1)}/><OcrCdeIntegration id={id} onCreated={()=>setParameterVersion(v=>v+1)}/><OcrSplitDemandIntegration documentId={id} onIntegrated={async()=>{setParameterVersion(v=>v+1);}}/><OcrDemandTaxes documentId={id}/><OcrReactiveIntegration documentId={id} onIntegrated={async()=>{setParameterVersion(v=>v+1);}}/><OcrCipIntegration id={id} onCreated={()=>setParameterVersion(v=>v+1)}/><OcrCalculationStatus key={parameterVersion} id={id}/></>}
 </dialog></section>;
}
