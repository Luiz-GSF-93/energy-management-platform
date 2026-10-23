'use client';
import {useId,useState} from 'react';
import styles from './EnergyPriceChart.module.css';

export type EnergyPriceMonth={month:string;acr:string|null;acl:string|null;pld:string|null;pldSpread5?:string|null;pldSpread10?:string|null;pldSpread15?:string|null;scorePercent:string|null;taxBasis?:string;priceNotice?:string;aclVsPldPercent?:string|null;comparisons?:{key:string;label:string;percent:string|null;basis:string}[]};
const series=[{key:'acr',label:'Perfil ACR · referência TE',color:'#fbbf24'},{key:'pld',label:'PLD · CCEE',color:'#38bdf8'},{key:'acl',label:'Perfil ACL · valor contratado',color:'#4ade80'},{key:'pldSpread5',label:'Mercado · PLD + 5% estimado',color:'#a78bfa'},{key:'pldSpread10',label:'Mercado · PLD + 10% estimado',color:'#fb923c'},{key:'pldSpread15',label:'Mercado · PLD + 15% estimado',color:'#f472b6'}] as const;
const monthNames=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const price=(value:string|null)=>value===null?'Não disponível':'R$ '+Number(value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'/MWh';

/** Values arrive calculated and scoped by the API. SVG numbers only position marks. */
export default function EnergyPriceChart({months,footer}:{months:EnergyPriceMonth[];footer:string}){
 const id=useId(),[selectedMonth,setSelectedMonth]=useState<string|null>(null),[hover,setHover]=useState<number|null>(null),[hidden,setHidden]=useState<string[]>([]);
 const selectedIndex=months.findIndex(m=>m.month===selectedMonth),active=hover??(selectedIndex<0?null:selectedIndex);
 const visible=series.filter(s=>!hidden.includes(s.key));
 const values=months.flatMap(m=>visible.flatMap(s=>m[s.key]==null?[]:[Number(m[s.key])]));
 const ceiling=Math.max(100,...values)*1.15,width=900,height=320,left=70,right=20,top=25,bottom=45;
 const x=(i:number)=>left+(width-left-right)*i/Math.max(1,months.length-1);
 const y=(n:number)=>top+(height-top-bottom)*(1-n/ceiling);
 const paths=(key:typeof series[number]['key'])=>{
  let connected=false;
  return months.map((m,i)=>{if(m[key]==null){connected=false;return '';}
   const d=(connected?'L':'M')+x(i).toFixed(2)+','+y(Number(m[key])).toFixed(2);connected=true;return d;
  }).join(' ');
 };
 const selected=active===null?null:months[active];
 return <figure className={styles.chart} aria-labelledby={id}>
  <figcaption id={id}>Preço específico da energia <span>R$/MWh</span></figcaption>
  <div role="group" aria-label="Séries visíveis no gráfico"><ul className={styles.legend}>{series.map(s=><li key={s.key}><label><input type="checkbox" checked={!hidden.includes(s.key)} onChange={()=>setHidden(old=>old.includes(s.key)?old.filter(key=>key!==s.key):[...old,s.key])}/><span style={{background:s.color}} aria-hidden="true"/>{s.label}</label></li>)}</ul><div className={styles.controls}><button type="button" onClick={()=>setHidden([])}>Mostrar todas</button><button type="button" onClick={()=>setHidden(series.map(s=>s.key))}>Ocultar todas</button></div></div>
  <p className={styles.sources}>Perfil ACL: preço médio efetivo da energia faturada, incluindo compras avulsas; não necessariamente o preço-base de um contrato regular. Marque as séries que deseja comparar.</p>
  {!visible.length?<p role="status">Selecione uma série para visualizar o gráfico. Os valores e comparações continuam disponíveis por mês.</p>:null}
  <div className={styles.plot}>
   <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Comparativo mensal em R$/MWh: referência TE ACR, fornecedor ACL, PLD e spreads estimados de 5%, 10% e 15%. Valores disponíveis nos botões dos meses abaixo.">
    {Array.from({length:5},(_,i)=>{const n=ceiling*i/4;return <g key={i}><line x1={left} x2={width-right} y1={y(n)} y2={y(n)} stroke="#334155"/><text x={left-10} y={y(n)+4} textAnchor="end" fill="#cbd5e1" fontSize="13">{Math.round(n)}</text></g>;})}
    {visible.map(s=><path key={s.key} d={paths(s.key)} fill="none" stroke={s.color} strokeWidth="3" strokeDasharray={s.key.startsWith('pldSpread')?'6 4':undefined}/>)}
    {months.map((m,i)=><g key={m.month}>
     {visible.map(s=>m[s.key]==null?null:<circle key={s.key} cx={x(i)} cy={y(Number(m[s.key]))} r={active===i?5:3} fill={s.color}/>)}
     <text x={x(i)} y={height-15} textAnchor="middle" fill="#cbd5e1" fontSize="14">{monthNames[Number(m.month.slice(5,7))-1]}</text>
     <rect x={x(i)-(width-left-right)/Math.max(1,months.length-1)/2} y={top} width={(width-left-right)/Math.max(1,months.length-1)} height={height-top-bottom} fill="transparent" onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)}/>
    </g>)}
    {active===null?null:<line x1={x(active)} x2={x(active)} y1={top} y2={height-bottom} stroke="#94a3b8" strokeDasharray="4 4" pointerEvents="none"/>}
   </svg>
   <div className={styles.months} aria-label="Consultar valores por mês">{months.map((m,i)=><button key={m.month} type="button" onFocus={()=>setSelectedMonth(m.month)} onClick={()=>setSelectedMonth(m.month)} aria-label={`Valores de ${m.month}`} aria-pressed={active===i}>{monthNames[Number(m.month.slice(5,7))-1]}</button>)}</div>
   <div className={styles.tooltip} aria-live="polite">{selected?<><strong>{selected.month} · {selected.taxBasis==='NET'?'TE ACR e ACL sem tributos demonstrados':selected.taxBasis==='UNKNOWN'?'preço observado · base tributária pendente':'referências com tributos demonstrados'}</strong>{series.map(s=><span key={s.key}>{s.label}: {price(selected[s.key]??null)}</span>)}<span>Score de preço: {selected.scorePercent===null?'Não disponível':selected.scorePercent.replace('.',',')+'%'}</span>{selected.aclVsPldPercent!=null?<span>TE ACL em relação ao PLD: {selected.aclVsPldPercent.replace('.',',')}% · (ACL − PLD) ÷ PLD × 100. PLD é referência de mercado.</span>:null}<span>{selected.priceNotice}</span></>:<span>Passe o cursor ou selecione um mês para conferir os valores. Lacunas indicam dados indisponíveis.</span>}</div>
  </div>
  {selected?.comparisons?<section aria-label="Performance percentual do preço ACL"><h4>Preço contratado em relação às referências · {selected.month}</h4><p>Variação = (ACL − referência) ÷ referência × 100. Negativo: abaixo da referência; positivo: acima. Comparação nominal de preços, não economia realizada.</p><table className={styles.comparisons}><thead><tr><th>Referência</th><th>Variação do ACL</th><th>Base da comparação</th></tr></thead><tbody>{selected.comparisons.map(c=><tr key={c.key}><td>{c.label}</td><td>{c.percent===null?'Sem referência':c.percent.replace('.',',')+'%'}</td><td>{c.basis==='NET_COMPARABLE'?'Preços sem tributos demonstrados':c.basis==='GROSS_COMPARABLE'?'Preços com tributos demonstrados':'Comparação nominal; bases tributárias distintas ou não comprovadas'}</td></tr>)}</tbody></table></section>:null}
  <p className={styles.sources}>{footer}</p>
 </figure>;
}
