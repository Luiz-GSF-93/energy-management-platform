import {Card} from '@/app/components/ui';
import ConsumptionViews,{PublishedConsumption} from './ConsumptionViews';
import styles from './report-workspace.module.css';

type Totals={acr:string;aclAfterFees:string;savingsAfterFees:string;savingsPercent:string|null};
export type PublishedReport={
 roi?:{state:string;investment:string;from:string;to:string;roiPercent:string|null;paybackMonths:string|null;investmentVersion:number;formulaVersion:string;disclosure?:string}|null;
 totals:Totals;
 months:{month:string;totals:Totals|null;cumulative:string|null}[];
 invoices:{month:string;consumptionKwh:string|null;findings:{code:string;message:string}[];reservationCount:number}[];
 composition:{key:string;label:string;amount:string;percent:string;offset:string}[]|null;
};
const number=(value:string)=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:4});
const money=(value:string)=>`R$ ${Number(value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
function Metric({label,value}:{label:string;value:string}){return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>;}

export default function ReportPresentation({body,view,consumptionInvoices=body.invoices}:{body:PublishedReport;view:'OPERATIONAL'|'EXECUTIVE'|'FINANCIAL';consumptionInvoices?:PublishedConsumption[]}){
 const findings=body.invoices.flatMap(i=>i.findings.map(f=>({...f,month:i.month})));
 const composition=body.composition;
 const colors=['var(--brand-blue)','var(--brand-green)','#8067ad','#d69a30','#5a788b'];
 return <>
 {view==='OPERATIONAL'?<>
  <ConsumptionViews invoices={consumptionInvoices}/>
  <Card title="Medições da API CCEE"><p>Consumo diário e consumo total CCEE indisponíveis nesta versão. Dependem de dados autorizados, normalizados e validados pela integração CCEE independente.</p></Card>
  <Card title="Demandas · fatura OCR + IA e cadastro vigente"><p>Demanda medida e demanda faturada são informações distintas, extraídas da fatura e conferidas antes da publicação. A demanda contratada exige conferência com o cadastro ou contrato vigente; não é inferida pela soma das parcelas faturadas.</p><p>Esses valores e o percentual de utilização não estão incluídos nesta versão do relatório. Não são apresentados como dados da API CCEE.</p></Card>
 </>:null}
 {view==='EXECUTIVE'?<>
  <div className={styles.metrics}><Metric label="Economia acumulada no período publicado" value={money(body.totals.savingsAfterFees)}/><Metric label="Score de economia publicado" value={body.totals.savingsPercent===null?'Indisponível':number(body.totals.savingsPercent)+'%'}/><Metric label="ROI acumulado da migração" value={body.roi?.roiPercent!==null&&body.roi?.roiPercent!==undefined?number(body.roi.roiPercent)+'%':'Pendente'}/><Metric label="Payback simples" value={body.roi?.paybackMonths?number(body.roi.paybackMonths)+' meses':'Não recuperado ou pendente'}/><Metric label="Custo específico da energia" value="Indisponível"/></div>
  <Card title="Evolução dos resultados"><table className={styles.table}><caption>Economia por competência e acumulado fornecidos pelo motor</caption><thead><tr><th>Mês</th><th>Economia publicada</th><th>Acumulado no período</th></tr></thead><tbody>{body.months.map(m=><tr key={m.month}><td>{m.month}</td><td>{m.totals?money(m.totals.savingsAfterFees):'Sem publicação'}</td><td>{m.cumulative===null?'Indisponível':money(m.cumulative)}</td></tr>)}</tbody></table><p>O score publicado não é uma média aritmética dos percentuais mensais. Meses sem publicação não representam zero.</p></Card>
  <Card title="Investimentos e retorno da migração">{body.roi?<><p>Investimentos considerados: {money(body.roi.investment)} · versão {body.roi.investmentVersion}. Acompanhamento: {body.roi.from} a {body.roi.to}.</p><p>{body.roi.state==='CALCULATED'?body.roi.disclosure:body.roi.state==='ESTIMATED_INVESTMENT_PENDING'?'Existem investimentos estimados: conferir evidências e validar como realizados para calcular o retorno.':body.roi.state==='NO_INVESTMENT'?'Investimento zero: ROI e payback não são calculados.':body.roi.state==='BEFORE_TRACKING_START'?'O corte antecede o início do acompanhamento financeiro.':'Histórico publicado incompleto: meses ausentes não representam zero.'}</p><p>Fórmula: {body.roi.formulaVersion}. O horizonte financeiro pode começar antes do período selecionado no relatório.</p></>:<p>Cadastre e valide os investimentos em Contratos → Investimentos. Gere uma nova versão executiva após a validação. Versões antigas permanecem preservadas.</p>}</Card>
 </>:null}
 {view==='FINANCIAL'?<>
  <div className={styles.metrics}><Metric label="Economia acumulada no período publicado" value={money(body.totals.savingsAfterFees)}/><Metric label="Score de economia publicado" value={body.totals.savingsPercent===null?'Indisponível':number(body.totals.savingsPercent)+'%'}/><Metric label="Custo ACR no período" value={money(body.totals.acr)}/><Metric label="ACL com honorários no período" value={money(body.totals.aclAfterFees)}/></div>
  <Card title="Resultados financeiros por mês"><table className={styles.table}><caption>Valores publicados por competência</caption><thead><tr><th>Mês</th><th>Economia</th><th>ACR</th><th>ACL com honorários</th><th>Vencimento OCR</th></tr></thead><tbody>{body.months.map(m=><tr key={m.month}><td>{m.month}</td><td>{m.totals?money(m.totals.savingsAfterFees):'Sem publicação'}</td><td>{m.totals?money(m.totals.acr):'Indisponível'}</td><td>{m.totals?money(m.totals.aclAfterFees):'Indisponível'}</td><td>Indisponível nesta versão</td></tr>)}</tbody></table></Card>
  <Card title="Composição do custo ACL publicado"><p>Inclui honorários. Custos apurados não comprovam pagamento das faturas.</p>{composition?.length?<div className={styles.composition}><div className={styles.pie} aria-hidden="true" style={{background:`conic-gradient(${composition.map((c,index)=>`${colors[index%colors.length]} ${c.offset}% ${Number(c.offset)+Number(c.percent)}%`).join(',')})`}}/><table className={styles.table}><caption>Composição fornecida pelo motor</caption><thead><tr><th>Componente</th><th>Valor</th><th>Participação</th></tr></thead><tbody>{composition.map((c,index)=><tr key={c.key}><td><span className={styles.swatch} style={{background:colors[index%colors.length]}}/>{c.label}</td><td>{money(c.amount)}</td><td>{number(c.percent)}%</td></tr>)}</tbody></table></div>:<p>Composição indisponível nesta versão. Não foram estimadas parcelas.</p>}</Card>
 </>:null}
 {view!=='OPERATIONAL'?<details className={styles.auditDetails}><summary>Consumo e fontes · visão distribuidora e CCEE</summary><ConsumptionViews invoices={consumptionInvoices}/></details>:null}
 <Card title="Conferência e ressalvas publicadas"><p>Alertas preservados na apuração. Esta tela não executa nova interpretação de IA nem presume ausência de inconsistências cadastrais.</p>{findings.length?<ul>{findings.map((f,index)=><li key={`${f.month}-${f.code}-${index}`}><strong>{f.month} · {f.code}</strong> — {f.message}</li>)}</ul>:<p>Nenhum alerta de revisão incluído nesta versão; isso não comprova uma nova análise por IA.</p>}<p>Sugestões personalizadas de performance serão exibidas quando estiverem disponíveis em uma análise identificada e autorizada.</p></Card>
 </>;
}
