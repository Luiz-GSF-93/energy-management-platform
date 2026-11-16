/** A deliberately small public projection: never return source records, contacts or files. */
export function clientMonitorSnapshot(raw:any){
 const o=raw.opportunity, d=o.data, now=Date.parse(raw.serverNow), today=new Date(now).toISOString().slice(0,10);
 const terms=['energyType','flexibilityUpperPercent','flexibilityLowerPercent','seasonality','correctionIndex','billingTerms'];
 const proposals=(raw.proposals??[]).filter((p:any)=>!['REJECTED','DECLINED','CANCELLED'].includes(p.status)&&p.data.validUntil>=today&&Number(p.data.priceBrlMwh)>0);
 const comparable=(p:any)=>terms.every(k=>d[k]!=null&&p.data[k]!=null&&String(d[k]).trim()===String(p.data[k]).trim());
 const eligible=proposals.filter(comparable).sort((a:any,b:any)=>Number(a.data.priceBrlMwh)-Number(b.data.priceBrlMwh)||a.id.localeCompare(b.id));
 const lowest=eligible.length?Number(eligible[0].data.priceBrlMwh):null;
 const rows=proposals.map((p:any)=>{
  const price=Number(p.data.priceBrlMwh),canCompare=comparable(p),rank=canCompare?eligible.findIndex((v:any)=>Number(v.data.priceBrlMwh)===price)+1:null;
  return {id:p.id,supplier:raw.suppliers?.find((s:any)=>s.id===p.data.supplierId)?.data?.tradeName??'Fornecedor',priceBrlMwh:price,rank,
   score:canCompare&&lowest!==null?Math.round(100*lowest/price):null,validUntil:p.data.validUntil,receivedAt:p.created_at,status:p.status,
   terms:Object.fromEntries(terms.map(k=>[k,p.data[k]??null])),conditions:p.data.conditions??null,
   explanation:canCompare?'Condições declaradas coincidem com a rodada. Ordem por preço nominal.':'Condições incompletas ou diferentes: sem ranking ou score comparável.'};
 }).sort((a:any,b:any)=>(a.rank??1e9)-(b.rank??1e9)||a.priceBrlMwh-b.priceBrlMwh);
 const pld=(raw.pld??[]).map((r:any)=>({month:r.month,priceBrlMwh:Number(r.mean_brl_mwh),source:r.source,publishedAt:r.published_at})).sort((a:any,b:any)=>a.month.localeCompare(b.month));
 const latest=pld[pld.length-1],previous=pld[pld.length-2];
 const month=(v:string)=>{const [y,m]=v.slice(0,7).split('-').map(Number);return y*12+m;};
 const currentMonth=month(new Date(now).toISOString()),fresh=!!latest&&month(latest.month)>=currentMonth-1;
 const variation=latest&&previous&&month(latest.month)-month(previous.month)===1&&previous.priceBrlMwh>0?(latest.priceBrlMwh/previous.priceBrlMwh-1)*100:null;
 const refs=(d.annualReferencePrices??[]).map((r:any)=>({year:r.year,priceBrlMwh:Number(r.priceBrlMwh)}));
 const notes=[lowest===null?'Não há propostas com condições declaradas equivalentes para indicar o menor preço comparável.':`Menor preço nominal comparável: R$ ${lowest.toFixed(2)}/MWh. Confira garantias, tributos e sazonalidade antes da decisão.`];
 for(const r of refs)if(lowest!==null&&Number.isFinite(r.priceBrlMwh))notes.push(`Referência desejada ${r.year}: R$ ${r.priceBrlMwh.toFixed(2)}/MWh; menor proposta ${lowest<=r.priceBrlMwh?'atinge ou melhora':'está acima da'} referência nominal.`);
 notes.push(!latest?'PLD sem referência publicada disponível.':!fresh?'Referência PLD atrasada. Não é possível avaliar a curva atual com estes dados.':variation===null?'PLD publicado disponível, sem dois meses consecutivos para calcular variação.':`PLD mensal variou ${variation.toFixed(2)}% no último par de meses publicados. Movimento histórico não prevê preços futuros.`);
 notes.push('PLD de liquidação e oferta contratual futura têm prazos e riscos diferentes. Estes sinais não comprovam uma boa curva futura nem recomendam contratação.');
 const safeIds=new Set(rows.map((r:any)=>r.id));
 return {serverNow:raw.serverNow,roundEndsAt:raw.roundEndsAt??raw.expiresAt,expiresAt:raw.expiresAt,updatedAt:raw.serverNow,title:d.title,customer:raw.customer,unit:raw.unit,startMonth:d.startMonth,months:d.months,submarket:d.submarket,
  references:refs,proposals:rows,history:(raw.history??[]).filter((h:any)=>safeIds.has(h.proposalId)&&Number(h.priceBrlMwh)>0).map((h:any)=>({proposalId:h.proposalId,at:h.at,priceBrlMwh:Number(h.priceBrlMwh)})),
  invitations:raw.counts,pld:{rows:pld,fresh,variationPercent:variation},eva:{method:'Análise por regras, sem nova leitura OCR ou chamada de IA',notes},
  scoreMethod:'Índice nominal de preço (0–100) = 100 × menor preço comparável ÷ preço da proposta. Não é score de crédito, garantia de economia ou probabilidade de negócio.'};
}
