'use client';
import {useId,useState} from 'react';
import {referencePeriods} from '@/app/components/TradingCommercialTerms';
import {monthIndex,monthValue,type Observation} from './trading-analysis';
const colors=['#38c4f4','#ff7cbd','#52d68a','#f6bb58','#b8a0ff','#8edee0','#fa9175','#bddb73'];
const money=(n:number)=>n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:4});
const month=(n:number)=>{const value=monthValue(n);return value.slice(5)+'/'+value.slice(0,4);};
export default function TradingPricePlot({rows,axis}:{rows:Observation[];axis:'received'|'supply'}){
 const tooltipId=useId(),[hover,setHover]=useState<{x:number;text:string}|null>(null);const shown=rows.slice(-250),points=shown.map(row=>({row,x:axis==='supply'?row.start:monthIndex(row.proposal.created_at.slice(0,7))!}));
 if(!points.length)return <p>Nenhum preço elegível neste recorte.</p>;
 const references=axis==='supply'?Array.from(new Map(shown.map(row=>[row.opportunity.id,row.opportunity])).values()).flatMap(o=>referencePeriods(o.data.startMonth,o.data.months).flatMap(p=>{const price=o.data.annualReferencePrices?.find((r:any)=>r.year===p.year)?.priceBrlMwh;return typeof price==='number'&&Number.isFinite(price)&&price>0?[{id:o.id+':'+p.year,title:o.data.title,start:monthIndex(p.start)!,end:monthIndex(p.end)!,price}]:[];})).slice(0,250):[];
 const low=Math.min(...points.map(p=>p.x),...references.map(p=>p.start)),high=Math.max(...points.map(p=>p.x),...references.map(p=>p.end)),peak=Math.max(...shown.map(r=>r.price),...references.map(r=>r.price))*1.12;
 const x=(n:number)=>high===low?440:85+(n-low)*690/(high-low),y=(n:number)=>235-180*n/peak,suppliers=Array.from(new Set(shown.map(r=>r.supplier.id)));
 const months=Array.from(new Set([...points.map(p=>p.x),...references.flatMap(p=>[p.start,p.end])])).sort((a,b)=>a-b),step=Math.max(1,Math.ceil(months.length/8));
 const priceLabel=(n:number)=>n.toLocaleString('pt-BR',{maximumFractionDigits:2});
 return <section aria-label="Gráfico de preços do Trading Hub"><div style={{position:'relative',paddingTop:64}}>
  {hover?<div id={tooltipId} role="tooltip" style={{position:'absolute',left:`${Math.max(0,Math.min(62,hover.x/880*100))}%`,top:0,maxWidth:300,pointerEvents:'none',background:'transparent',color:'var(--text,#fff)',textShadow:'0 1px 3px #061a2d,0 0 3px #061a2d',fontWeight:600,overflowWrap:'anywhere'}}>{hover.text}</div>:null}
  <svg viewBox="0 0 880 305" role="img" aria-label={`Preço em reais por MWh no eixo vertical e ${axis==='supply'?'fornecimento':'recebimento'} em mês e ano no eixo horizontal`} style={{width:'100%',minWidth:320,display:'block'}}>
   {Array.from({length:5},(_,i)=>peak*i/4).map(value=><g key={value}><line x1="85" y1={y(value)} x2="790" y2={y(value)} stroke="#31516c" strokeDasharray="3 4"/><text x="77" y={y(value)+4} fill="currentColor" textAnchor="end" fontSize="12">{priceLabel(value)}</text></g>)}
   <line x1="85" y1="55" x2="85" y2="235" stroke="currentColor"/><line x1="85" y1="235" x2="790" y2="235" stroke="currentColor"/>
   <text transform="translate(18 147) rotate(-90)" textAnchor="middle" fill="currentColor" fontSize="13">Preço · R$/MWh</text>
   {months.filter((_,i)=>i%step===0||i===months.length-1).map(t=><text key={t} x={x(t)} y="260" textAnchor="middle" fontSize="12" fill="currentColor">{month(t)}</text>)}
   <text x="440" y="292" textAnchor="middle" fill="currentColor" fontSize="13">Período · mês/ano ({axis==='supply'?'fornecimento':'recebimento'})</text>
   {references.map(r=>{const text=`Referência desejada · ${r.title} · ${month(r.start)} a ${month(r.end)} · R$ ${money(r.price)}/MWh`;return <line key={r.id} x1={x(r.start)-3} x2={x(r.end)+3} y1={y(r.price)} y2={y(r.price)} stroke="#f6d052" strokeWidth="3" strokeDasharray="7 4" tabIndex={0} aria-label={text} aria-describedby={hover?tooltipId:undefined} onMouseEnter={()=>setHover({x:x(r.start),text})} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover({x:x(r.start),text})} onBlur={()=>setHover(null)}/>;})}
   {points.map(p=>{const text=`${p.row.supplier.data.tradeName} · ${month(p.x)} · R$ ${money(p.row.price)}/MWh · ${p.row.opportunity.data.title}`;return <circle key={p.row.proposal.id} cx={x(p.x)} cy={y(p.row.price)} r="6" fill={colors[suppliers.indexOf(p.row.supplier.id)%colors.length]} tabIndex={0} aria-label={text} aria-describedby={hover?tooltipId:undefined} onMouseEnter={()=>setHover({x:x(p.x),text})} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover({x:x(p.x),text})} onBlur={()=>setHover(null)}/>;})}
  </svg></div><ul aria-label="Legenda dos fornecedores e referências" style={{listStyle:'none',padding:0,display:'grid',gap:8}}>{suppliers.map((id,i)=><li key={id}><span style={{color:colors[i%colors.length]}}>●</span> {shown.find(r=>r.supplier.id===id)!.supplier.data.tradeName}</li>)}{references.length?<li><span style={{color:'#f6d052'}}>┄</span> Referência desejada ACL por ano de fornecimento</li>:null}</ul>
  <p>Preços em R$/MWh; meses ausentes não são interpolados. Passe o mouse ou navegue pelos pontos com Tab para consultar fornecedor, período e preço. A referência desejada orienta a oferta e não comprova contratação ou economia.</p>{rows.length>shown.length?<p>O gráfico mostra as últimas 250 observações do recorte. A tabela mantém os registros elegíveis completos; refine os filtros para detalhar.</p>:null}
 </section>;
}
