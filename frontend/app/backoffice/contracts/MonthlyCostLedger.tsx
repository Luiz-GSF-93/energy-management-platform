'use client';
import {Alert,Card} from '@/app/components/ui';
export type MonthlyCostLedgerData={formulaVersion:string;status:'BLOCKED'|'AVAILABLE'|'NO_COSTS_DECLARED';version:{id:string;version:number;revision:number;validatedAt:string;source:string}|null;groups:{scenario:string;taxTreatment:string;count:number;costs:string;credits:string;balance:string;lines:{id:string;label:string;category:string;effect:string;amount:string;signedAmount:string;source:string}[]}[];blockers:string[];warnings:string[]};
const treatments:Record<string,string>={INCLUDED:'Tributos incluídos',EXCLUDED:'Tributos ainda não incluídos',NOT_APPLICABLE:'Tributos não aplicáveis'};
const categories:Record<string,string>={CCEE:'CCEE',EXPOSURE:'Exposição / curto prazo',CHARGE:'Encargos',OTHER:'Outros ajustes'};
const money=(value:string)=>value.startsWith('-')?'− R$ '+value.slice(1).replace('.',','):'R$ '+value.replace('.',',');
export default function MonthlyCostLedger({data}:{data?:MonthlyCostLedgerData}){
 return <Card title='Consolidação dos custos e créditos mensais'>
 {!data?<p>A consolidação ainda não está disponível nesta resposta. Atualize a conferência após a publicação da API.</p>:<>
 <Alert>Subtotais dos lançamentos mensais, separados por cenário e tratamento tributário. Não representam o custo total ACL/ACR nem a economia.</Alert>
 {data.version?<p>Fonte: {data.version.source} · versão {data.version.version} · revisão {data.version.revision}</p>:null}
 {data.status==='BLOCKED'?<><p><strong>Consolidação bloqueada. Nenhum subtotal foi emitido.</strong></p><ul>{data.blockers.map((message,i)=><li key={i}>{message}</li>)}</ul></>:data.status==='NO_COSTS_DECLARED'?<p>Ausência de custos e créditos adicionais declarada e validada nesta competência. Isso não significa que o custo de energia seja zero.</p>:data.groups.map(g=><article className='ds-card' key={g.scenario+'-'+g.taxTreatment}><h3>{g.scenario} · {treatments[g.taxTreatment]||g.taxTreatment}</h3><p>{g.count} lançamento(s)</p><dl><div><dt>Custos lançados</dt><dd>{money(g.costs)}</dd></div><div><dt>Créditos lançados</dt><dd>{money(g.credits)}</dd></div><div><dt>Saldo do grupo — custos menos créditos</dt><dd><strong>{money(g.balance)}</strong></dd></div></dl>{g.balance.startsWith('-')?<p>Os créditos superam os custos deste grupo. O sinal foi preservado; esse valor não representa economia do cliente.</p>:null}{g.taxTreatment==='EXCLUDED'?<p>Os tributos aplicáveis ainda precisam ser calculados. Este saldo não é um valor final com impostos.</p>:null}<details><summary>Conferir lançamentos e fontes</summary><ul>{g.lines.map(l=><li key={l.id}><strong>{l.label}</strong> · {categories[l.category]||l.category} · {l.effect==='CREDIT'?'Crédito (dedução)':'Custo'} · {money(l.amount)}<p>Fonte: {l.source}</p></li>)}</ul></details></article>)}
 <details><summary>Fórmula e limites da consolidação</summary><ul>{data.warnings.map(w=><li key={w}>{w}</li>)}</ul><p>Versão da fórmula: {data.formulaVersion}.</p></details>
 </>}
 </Card>;
}
