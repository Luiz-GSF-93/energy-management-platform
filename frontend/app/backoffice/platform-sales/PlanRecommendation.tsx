'use client';
import {useRef,useState,useEffect} from 'react';
import {Alert,Button,Card} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
type Result={receipt:string;evaluatedAt:string;engineVersion:string;status:string;selectionRule:string;requiredModules:string[];reasons:string[];warnings:string[];plan:{id:string;name:string;version:number;maxUnits:number;maxUsers:number}|null};
const modules:Record<string,string>={document_management:'Documentos',advanced_analytics:'Análises avançadas',report_generation:'Relatórios',free_market_management:'Gestão do mercado livre',bot_energy_rag:'Bot-Energy + RAG',trading_hub:'Trading Hub'};
export default function PlanRecommendation({receipt,page,search}:{receipt:string;page:number;search:string}){
 const [result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const evaluate=async()=>{setBusy(true);setResult(null);setError('');try{
  const data=await apiRequest<Result>('/api/v1/admin/sales/recommendation?receipt='+encodeURIComponent(receipt)+'&page='+page+'&search='+encodeURIComponent(search));
  if(live.current){if(data.receipt!==receipt)throw new Error('Seleção incompatível');setResult(data);}
 }catch{if(live.current)setError('Não foi possível avaliar esta seleção. Atualize a lista ou confira o catálogo.');}
 finally{if(live.current)setBusy(false);}};
 return <Card title="Avaliar plano para esta solicitação"><p>Confira a compatibilidade com o catálogo atual antes de preparar uma proposta comercial.</p><Button variant="secondary" disabled={busy} onClick={evaluate}>{busy?'Avaliando…':'Avaliar plano'}</Button>{error?<Alert>{error}</Alert>:null}{result?<div style={{marginTop:16}}>
  <h3>{result.plan?result.plan.name:'Revisão comercial necessária'}</h3>
  {result.plan?<p>Versão {result.plan.version} · Até {result.plan.maxUnits} unidades · Até {result.plan.maxUsers} usuários</p>:null}
  <p><strong>Módulos necessários:</strong> {result.requiredModules.map(m=>modules[m]||m).join(', ')||'Conferir necessidades no atendimento.'}</p>
  <ul>{result.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
  {result.warnings.map(warning=><p key={warning}>{warning}</p>)}
  <details><summary>Critério e rastreabilidade da consulta</summary><p>{result.selectionRule}</p><p>Motor: {result.engineVersion} · Consulta em {new Date(result.evaluatedAt).toLocaleString('pt-BR')}</p><p>Esta consulta usa o catálogo atual e não é uma proposta preservada. Reavaliar após alterações de plano.</p></details>
 </div>:null}</Card>;
}
