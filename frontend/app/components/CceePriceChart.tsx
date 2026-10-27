'use client';
import {useEffect,useRef,useState,type PointerEvent} from 'react';
import styles from './CceeMarketExplorer.module.css';
type Price={at:string;submarket:string;value:string;hours:number};
const markets=['SE_CO','S','NE','N'],names:Record<string,string>={SE_CO:'Sudeste/Centro-Oeste',S:'Sul',NE:'Nordeste',N:'Norte'},colors=['#51cfe8','#ffc629','#82e6b5','#cb9dff'];
const zone='America/Sao_Paulo',dayMs=86400000,hourMs=3600000;
const money=(v:number,digits=2)=>v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:digits});
const localDate=(at:string)=>/^\d{4}-\d{2}-\d{2}$/.test(at)?at:new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
export function priceBucket(at:string,grain:string){
 if(!Number.isFinite(Date.parse(at)))return NaN;
 const date=localDate(at);
 return grain==='MONTH'?Number(date.slice(0,4))*12+Number(date.slice(5,7))-1:grain==='DAY'?Date.parse(date+'T00:00:00Z')/dayMs:Math.floor(Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(at)?at+'T00:00:00-03:00':at)/hourMs);
}
function bucketDate(bucket:number,grain:string){return grain==='MONTH'?new Date(Date.UTC(Math.floor(bucket/12),bucket%12,1,3)):grain==='DAY'?new Date(bucket*dayMs+3*hourMs):new Date(bucket*hourMs);}
export function priceAxisLabel(bucket:number,grain:string){
 const date=bucketDate(bucket,grain);
 if(grain==='MONTH')return [date.toLocaleString('pt-BR',{timeZone:zone,month:'short'}).replace('.',''),String(date.getUTCFullYear())];
 const day=date.toLocaleDateString('pt-BR',{timeZone:zone,day:'2-digit',month:'2-digit'});
 return grain==='DAY'?[date.toLocaleDateString('pt-BR',{timeZone:zone,weekday:'short'}),day]:[day,date.toLocaleTimeString('pt-BR',{timeZone:zone,hour:'2-digit',minute:'2-digit'})];
}
export function priceTimeline(series:Price[],grain:string,from?:string,to?:string){
 const rows=series.filter(r=>Number.isFinite(Number(r.value))&&r.value.trim()!==''&&Number.isFinite(priceBucket(r.at,grain))).map(r=>({...r,bucket:priceBucket(r.at,grain)}));
 const first=from?priceBucket(from,grain):Math.min(...rows.map(r=>r.bucket));
 const last=to?priceBucket(to,grain)+(grain==='HOUR'?23:0):Math.max(...rows.map(r=>r.bucket));
 if(!Number.isFinite(first)||!Number.isFinite(last)||first>last||last-first>(grain==='MONTH'?25:grain==='DAY'?732:768))return {rows:[],slots:[] as number[]};
 return {rows:rows.filter(r=>r.bucket>=first&&r.bucket<=last).sort((a,b)=>a.bucket-b.bucket),slots:Array.from({length:last-first+1},(_,i)=>first+i)};
}
export default function CceePriceChart({series,visible,granularity,from,to}:{series:Price[];visible:string[];granularity:string;from?:string;to?:string}){
 const timeline=priceTimeline(series,granularity,from,to),factor=granularity==='HOUR'?24:1;
 const [days,setDays]=useState(granularity==='HOUR'?1:7);
 const span=granularity==='MONTH'?timeline.slots.length:Math.min(timeline.slots.length,days*factor);
 const latest=timeline.rows.at(-1)?.bucket??timeline.slots.at(-1)??0;
 const [offset,setOffset]=useState(()=>Math.max(0,timeline.slots.indexOf(latest)-span+1));
 const start=Math.max(0,Math.min(offset,Math.max(0,timeline.slots.length-span)));
 const slots=timeline.slots.slice(start,start+span),first=slots[0],last=slots.at(-1)??first;
 const [active,setActive]=useState<number|null>(null),[viewport,setViewport]=useState(950),plot=useRef<HTMLDivElement>(null);
 useEffect(()=>{const element=plot.current;if(!element)return;const measure=()=>{if(element.clientWidth)setViewport(element.clientWidth);};measure();if(typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();},[timeline.rows.length>0]);
 const values=timeline.rows.filter(r=>visible.includes(r.submarket)&&r.bucket>=first&&r.bucket<=last);
 const tickStep=granularity==='HOUR'?(span<=24?2:6):1;
 const ticks=slots.filter((bucket,i)=>!i||i===slots.length-1||granularity!=='HOUR'||Number(bucketDate(bucket,granularity).toLocaleTimeString('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}))%tickStep===0);
 const width=Math.max(viewport,ticks.length*(granularity==='MONTH'?60:58)+118),left=88,right=30,top=25,bottom=250;
 const min=Math.min(0,...values.map(r=>Number(r.value))),max=Math.max(1,...values.map(r=>Number(r.value)));
 const x=(bucket:number)=>left+(last===first?(width-left-right)/2:(bucket-first)/(last-first)*(width-left-right));
 const y=(value:number)=>bottom-(value-min)/(max-min)*(bottom-top);
 const selected=active!==null&&active>=first&&active<=last?active:null;
 const selectedRows=values.filter(r=>r.bucket===selected),fullDate=(bucket:number)=>bucketDate(bucket,granularity).toLocaleString('pt-BR',{timeZone:zone,...(granularity==='MONTH'?{month:'long',year:'numeric'}:granularity==='DAY'?{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'}:{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})});
 function point(event:PointerEvent<SVGSVGElement>){const bounds=event.currentTarget.getBoundingClientRect();if(!bounds.width)return;const px=(event.clientX-bounds.left)/bounds.width*width;const index=last===first?0:Math.round((px-left)/(width-left-right)*(slots.length-1));setActive(slots[Math.max(0,Math.min(slots.length-1,index))]??null);}
 if(!timeline.rows.length)return <p>Nenhum preço registrado nesta granularidade e período. Uma média mensal não representa preços diários ou horários; lacunas não são zero.</p>;
 const label=granularity==='MONTH'?'Mensal':granularity==='DAY'?'Diária':'Horária';
 return <div className={styles.priceChart}>
 <div className={styles.actions}><strong>{label} · horário de Brasília</strong>{granularity!=='MONTH'?<><label>Janela do gráfico<select value={days} onChange={e=>{const next=Number(e.target.value);setDays(next);setOffset(Math.max(0,start+span-next*factor));setActive(null);}}>{(granularity==='HOUR'?[1,3,7,32]:[7,31,90]).map(n=><option key={n} value={n}>{n} dia{n>1?'s':''}</option>)}</select></label><button disabled={start===0} onClick={()=>{setOffset(Math.max(0,start-span));setActive(null);}}>Período anterior</button><button disabled={start+span>=timeline.slots.length} onClick={()=>{setOffset(Math.min(timeline.slots.length-span,start+span));setActive(null);}}>Próximo período</button></>:null}</div>
 <p className={styles.priceHint}>Exibindo {slots.length?fullDate(first):'—'} a {slots.length?fullDate(last):'—'}. A tabela mantém o período pesquisado completo, com paginação.</p>
 <div ref={plot} className={styles.pricePlot} tabIndex={0} aria-label="Área do gráfico, com rolagem horizontal quando necessária">
 <svg viewBox={`0 0 ${width} 320`} style={{width,height:320,maxHeight:'none',maxWidth:'none'}} role="group" tabIndex={0} aria-label={`Gráfico PLD ${label.toLowerCase()}. Use as setas para consultar os períodos.`} onPointerMove={point} onPointerDown={point} onPointerLeave={e=>{if(e.pointerType!=='touch')setActive(null);}} onFocus={()=>setActive(p=>p??first??null)} onBlur={()=>setActive(null)} onKeyDown={e=>{if(e.key==='Escape'){setActive(null);return;}if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();setActive(e.key==='Home'?first:e.key==='End'?last:Math.max(first,Math.min(last,(selected??first)+(e.key==='ArrowLeft'?-1:1))));}}>
 {Array.from({length:5},(_,i)=>min+(max-min)*i/4).map(value=><g key={value}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} stroke="currentColor" opacity=".18"/><text x={left-10} y={y(value)+4} textAnchor="end" fill="currentColor" fontSize="12">{money(value)}</text></g>)}
 {ticks.map(bucket=>{const labels=priceAxisLabel(bucket,granularity);return <g key={bucket}><line x1={x(bucket)} x2={x(bucket)} y1={bottom} y2={bottom+5} stroke="currentColor"/><text x={x(bucket)} y={bottom+23} textAnchor="middle" fill="currentColor" fontSize="12"><tspan x={x(bucket)}>{labels[0]}</tspan><tspan x={x(bucket)} dy="17">{labels[1]}</tspan></text></g>;})}
 {markets.filter(m=>visible.includes(m)).map(m=>{const rows=values.filter(r=>r.submarket===m),color=colors[markets.indexOf(m)];return <g key={m} stroke={color}>{rows.map((row,i)=><g key={row.at}>{i>0&&row.bucket-rows[i-1].bucket===1?<line x1={x(rows[i-1].bucket)} y1={y(Number(rows[i-1].value))} x2={x(row.bucket)} y2={y(Number(row.value))}/>:null}<circle cx={x(row.bucket)} cy={y(Number(row.value))} r={selected===row.bucket?4.5:2.8} fill={color}><title>{names[m]} · {fullDate(row.bucket)} · R$ {money(Number(row.value),6)}/MWh · {row.hours} horas observadas</title></circle></g>)}</g>;})}
 {selected!==null?<line x1={x(selected)} x2={x(selected)} y1={top} y2={bottom} stroke="currentColor" strokeDasharray="4 4" opacity=".5"/>:null}
 </svg></div>
 {selected!==null?<div className={styles.priceTooltip} role="status" aria-live="polite"><strong>{fullDate(selected)} · PLD · R$/MWh</strong>{markets.filter(m=>visible.includes(m)).map(m=>{const row=selectedRows.find(r=>r.submarket===m);return <div key={m}><span style={{color:colors[markets.indexOf(m)]}}>{names[m]}</span><b>{row?`R$ ${money(Number(row.value),6)}`:'Sem referência'}</b></div>;})}</div>:null}
 {!values.length?<p>Nenhum preço observado nesta janela para os submercados marcados.</p>:null}
 <p className={styles.priceHint}>Passe o mouse, toque ou use as setas para consultar o período. Espaços sem linha indicam ausência de referência; role horizontalmente para ler todos os rótulos.</p>
 </div>;
}
