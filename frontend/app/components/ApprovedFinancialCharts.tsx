'use client';
import styles from './ApprovedFinancialCharts.module.css';
export type FinancialChartMonth={month:string;acr:string|null;acl:string|null;savings:string|null;cumulative:string|null;widths:{acr:string|null;acl:string|null;savings:string|null;cumulative:string|null}};
const money=(v:string)=>{const [w,d]=v.split('.');return 'R$ '+w.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+d;};
const width=(v:string|null)=>v!==null&&/^(100|[0-9]{1,2})\.\d{2}$/.test(v)&&Number(v)<=100?v+'%':'0%';
/** Only server-calculated display widths and approved/public monetary values. */
export default function ApprovedFinancialCharts({months}:{months:FinancialChartMonth[]}){
 const chart=(title:string,keys:('acr'|'acl'|'savings'|'cumulative')[])=><figure className={styles.chart}><figcaption>{title}</figcaption>{months.map(m=><div className={styles.month} key={m.month}><strong>{m.month}</strong>{m.acr===null?<p>Sem resultado disponibilizado</p>:keys.map(k=><div key={k}><span>{({acr:'ACR',acl:'ACL com honorários',savings:'Economia mensal',cumulative:'Economia acumulada'})[k]}: {m[k]===null?'Não disponível':money(m[k]!)}</span><div className={styles.track} role='img' aria-label={m.month+' '+k+': '+(m[k]===null?'não disponível':money(m[k]!))}><span className={k==='acr'?styles.acr:m[k]?.startsWith('-')?styles.negative:styles.value} style={{width:width(m.widths[k])}}/></div></div>)}</div>)}</figure>;
 return <section aria-label='Gráficos dos resultados disponibilizados'><p>Valores das versões aprovadas e disponibilizadas. O acumulado considera somente meses com resultado; lacunas não representam zero.</p><div className={styles.grid}>{chart('Mercado Regulado × Mercado Livre',['acr','acl'])}{chart('Economia mensal',['savings'])}{chart('Economia acumulada',['cumulative'])}</div></section>;
}
