'use client';
export type OperationalProposal={formatVersion:string;state:string;invoice:{amount:string|null;source:string;lines:{key:string;label:string;amount:string|null;source:string}[]};acr:{identifiedAmount:string|null;lines:{key:string;label:string;quantity:string;measure:string;rate:string;amount:string;source:string}[]};supplier:{amount:string|null;source:string};fixedFee:{amount:string|null;source:string};observations:string[];financialApproval:false;canPublish:false};
const brl=(v:string|null)=>v===null?'Não identificado':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v));
export default function OperationalProposalView({data}:{data:OperationalProposal}){
 return <section aria-label='Resultado proposto da fatura' id='eva-proposed-result' tabIndex={-1}>
  <h3>{data.state==='UNAVAILABLE'?'Fonte da proposta exige reconferência':'Resultado preparado para conferência'}</h3><p>Os valores abaixo usam a fatura e a biblioteca desta competência. Você pode conferir a proposta sem concluir as validações do fechamento.</p>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
   <article className='ds-card'><h4>Fatura da distribuidora</h4><strong>{brl(data.invoice.amount)}</strong><p>{data.invoice.amount===null?'Confira a observação sobre a conciliação da fatura.':'Total extraído e conciliado da fatura, com os créditos e tributos nela incluídos.'}</p></article>
   <article className='ds-card'><h4>Energia do fornecedor</h4><strong>{brl(data.supplier.amount)}</strong><p>Proposta com preço cadastrado ou referência identificada aplicada ao consumo atual.</p></article>
   <article className='ds-card'><h4>Rubricas ACR calculadas</h4><strong>{brl(data.acr.identifiedAmount)}</strong><p>Soma parcial das rubricas abaixo. Não é custo final ACR nem economia.</p></article>
  </div>
  <details><summary>Operações lidas da fatura ({data.invoice.lines.length})</summary><table><thead><tr><th>Rubrica</th><th>Valor</th><th>Fonte</th></tr></thead><tbody>{data.invoice.lines.map(l=><tr key={l.key}><td>{l.label}</td><td>{brl(l.amount)}</td><td>{l.source}</td></tr>)}</tbody></table><p>Total da fatura: {data.invoice.source||'Sem conciliação demonstrável'}. Subtotais e linhas informativas não são somados novamente.</p></details>
  <details><summary>Cálculo ACR pela biblioteca ({data.acr.lines.length} rubricas)</summary><table><thead><tr><th>Rubrica</th><th>Quantidade</th><th>Tarifa</th><th>Valor</th><th>Fonte</th></tr></thead><tbody>{data.acr.lines.map(l=><tr key={l.key}><td>{l.label}</td><td>{l.quantity}</td><td>{l.rate} {l.measure}</td><td>{brl(l.amount)}</td><td>{l.source}</td></tr>)}</tbody></table></details>
  <details><summary>Observações do cálculo e valores ainda não demonstrados</summary><ul>{data.observations.map((s,i)=><li key={i}>{s}</li>)}</ul></details>
  <p>Proposta preservada para o operador. Nenhum dado foi aprovado ou publicado automaticamente.</p>
 </section>;
}
