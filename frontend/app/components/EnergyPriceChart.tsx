'use client';
import {useId,useState} from 'react';
import styles from './EnergyPriceChart.module.css';

export type EnergyPriceMonth={month:string;acr:string|null;acl:string|null;pld:string|null;scorePercent:string|null};
const series=[{key:'acr',label:'Antes da adesão · ACR',color:'#fbbf24'},{key:'pld',label:'PLD · CCEE',color:'#38bdf8'},{key:'acl',label:'Compra ACL publicada',color:'#4ade80'}] as const;
const monthNames=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const price=(value:string|null)=>value===null?'Não disponível':'R$ '+Number(value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'/MWh';

/** Values arrive calculated and scoped by the API. SVG numbers only position marks. */
export default function EnergyPriceChart({months,footer}:{months:EnergyPriceMonth[];footer:string}){
 const id=useId(),[active,setActive]=useState<number|null>(null);
 const values=months.flatMap(m=>series.flatMap(s=>m[s.key]===null?[]:[Number(m[s.key])]));
 const ceiling=Math.max(100,...values)*1.15,width=900,height=320,left=70,right=20,top=25,bottom=45;
 const x=(i:number)=>left+(width-left-right)*i/Math.max(1,months.length-1);
 const y=(n:number)=>top+(height-top-bottom)*(1-n/ceiling);
 const paths=(key:typeof series[number]['key'])=>{
  let connected=false;
  return months.map((m,i)=>{if(m[key]===null){connected=false;return '';}
   const d=(connected?'L':'M')+x(i).toFixed(2)+','+y(Number(m[key])).toFixed(2);connected=true;return d;
  }).join(' ');
 };
 const selected=active===null?null:months[active];
 return <figure className={styles.chart} aria-labelledby={id}>
  <figcaption id={id}>Preço específico da energia <span>R$/MWh</span></figcaption>
  <ul className={styles.legend}>{series.map(s=><li key={s.key}><span style={{background:s.color}} aria-hidden="true"/>{s.label}</li>)}</ul>
  <div className={styles.plot}>
   <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Comparativo mensal de TE ACR, PLD e compra ACL. Valores disponíveis nos botões dos meses abaixo.">
    {Array.from({length:5},(_,i)=>{const n=ceiling*i/4;return <g key={i}><line x1={left} x2={width-right} y1={y(n)} y2={y(n)} stroke="#334155"/><text x={left-10} y={y(n)+4} textAnchor="end" fill="#cbd5e1" fontSize="13">{Math.round(n)}</text></g>;})}
    {series.map(s=><path key={s.key} d={paths(s.key)} fill="none" stroke={s.color} strokeWidth="3"/>)}
    {months.map((m,i)=><g key={m.month}>
     {series.map(s=>m[s.key]===null?null:<circle key={s.key} cx={x(i)} cy={y(Number(m[s.key]))} r={active===i?5:3} fill={s.color}/>)}
     <text x={x(i)} y={height-15} textAnchor="middle" fill="#cbd5e1" fontSize="14">{monthNames[Number(m.month.slice(5,7))-1]}</text>
     <rect x={x(i)-(width-left-right)/Math.max(1,months.length-1)/2} y={top} width={(width-left-right)/Math.max(1,months.length-1)} height={height-top-bottom} fill="transparent" onMouseEnter={()=>setActive(i)} onMouseLeave={()=>setActive(null)}/>
    </g>)}
    {active===null?null:<line x1={x(active)} x2={x(active)} y1={top} y2={height-bottom} stroke="#94a3b8" strokeDasharray="4 4" pointerEvents="none"/>}
   </svg>
   <div className={styles.months} aria-label="Consultar valores por mês">{months.map((m,i)=><button key={m.month} type="button" onFocus={()=>setActive(i)} onBlur={()=>setActive(null)} onClick={()=>setActive(i)} aria-label={`Valores de ${m.month}`} aria-pressed={active===i}>{monthNames[Number(m.month.slice(5,7))-1]}</button>)}</div>
   <div className={styles.tooltip} aria-live="polite">{selected?<><strong>{selected.month}</strong>{series.map(s=><span key={s.key}>{s.label}: {price(selected[s.key])}</span>)}<span>Score de preço: {selected.scorePercent===null?'Não disponível':selected.scorePercent.replace('.',',')+'%'}</span></>:<span>Passe o cursor ou selecione um mês para conferir os valores. Lacunas indicam dados indisponíveis.</span>}</div>
  </div>
  <p className={styles.sources}>{footer}</p>
 </figure>;
}
