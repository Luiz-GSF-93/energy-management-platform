'use client';
import {Button} from './ui/Button';

export type EvaGuideTopic={key:string;question:string;version:string};
const keys=new Set(['guide-client-units','guide-documents','guide-ocr','guide-investments','guide-reports','guide-portal','guide-environment','guide-eva']);
/** Defensive presentation only. Authorization and publication belong to the backend. */
export function safeEvaGuideTopics(value:unknown):EvaGuideTopic[]{
 if(!Array.isArray(value))return [];
 const seen=new Set<string>();
 return value.filter((row):row is EvaGuideTopic=>{
  if(!row||typeof row!=='object'||!keys.has(row.key)||seen.has(row.key)||
   typeof row.question!=='string'||!row.question.trim()||row.question.length>200||
   typeof row.version!=='string'||!row.version.trim()||row.version.length>40)return false;
  seen.add(row.key);return true;
 }).slice(0,8);
}
export default function EvaProductGuides({topics,busy,canAsk,onSelect}:{topics:readonly EvaGuideTopic[];busy:boolean;canAsk:boolean;onSelect:(key:string)=>void}){
 if(!canAsk||!topics.length)return null;
 return <details aria-label="Guias do EnergyOS" style={{marginTop:12}}>
  <summary>Guias do EnergyOS</summary>
  <p>Orientações de uso disponíveis para o seu perfil.</p>
  <div style={{display:'grid',gap:8}}>{topics.map(topic=><Button key={topic.key} variant="secondary" disabled={busy} onClick={()=>onSelect(topic.key)} style={{width:'100%',whiteSpace:'normal',textAlign:'left',justifyContent:'space-between',gap:8}}><span style={{flex:1,minWidth:0}}>{topic.question}</span><small style={{flexShrink:0,whiteSpace:'nowrap'}}>v{topic.version}</small></Button>)}</div>
 </details>;
}
