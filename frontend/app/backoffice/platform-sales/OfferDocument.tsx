'use client';
import {useEffect,useState} from 'react';
import {Alert,Button} from '@/app/components/ui';
import {apiRequest,ApiError} from '@/app/lib/api/client';
type Model={id:string;receipt:string;title:string;notice:string;sections:{title:string;rows:{label:string;value:string}[]}[]};
export default function OfferDocument({id,revision}:{id:string;revision:number}){
 const [model,setModel]=useState<Model|null>(null),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setModel(null);setVisible(false);setError('');},[id,revision]);
 const endpoint='/api/v1/admin/sales/commercial/proposals/'+id+'/conditions/'+revision;
 const run=async(pdf:boolean)=>{setBusy(true);setError('');try{
  if(pdf){const blob=await apiRequest<Blob>(endpoint+'/pdf',{responseType:'blob',cache:'no-store'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='energyos-condicoes-'+id+'-r'+revision+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  else{setModel(await apiRequest<Model>(endpoint+'/preview',{cache:'no-store'}));setVisible(true);}
 }catch(e){setError(e instanceof ApiError?e.message:'Documento interno indisponível. Tente novamente.');}finally{setBusy(false);}};
 return <><div style={{display:'flex',gap:12,flexWrap:'wrap',margin:'16px 0'}}><Button variant="secondary" disabled={busy} onClick={()=>void run(false)}>Prévia consolidada · revisão {revision}</Button><Button disabled={busy} onClick={()=>void run(true)}>{busy?'Preparando documento…':'PDF interno com condições'}</Button>{visible?<Button variant="secondary" onClick={()=>setVisible(false)}>Recolher prévia</Button>:null}</div>{error?<Alert>{error}</Alert>:null}{visible&&model?<article aria-label="Prévia consolidada das condições comerciais internas" style={{background:'#fff',color:'#06264B',borderRadius:16,padding:24,overflowWrap:'anywhere'}}><img src="/brand/energyos-logo-horizontal-color.svg" alt="EnergyOS" width="220"/><p style={{fontSize:12,marginTop:0}}>Powered by Expert Energy</p><h2>{model.title}</h2>{model.sections.map(section=><section key={section.title}><h3 style={{color:'#0868DC'}}>{section.title}</h3><dl>{section.rows.map((row,index)=><div key={index} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,padding:'10px 0',borderBottom:'1px solid #dce5ec'}}><dt>{row.label}</dt><dd style={{margin:0}}>{row.value}</dd></div>)}</dl></section>)}<p style={{fontSize:12}}>{model.notice}</p></article>:null}</>;
}
