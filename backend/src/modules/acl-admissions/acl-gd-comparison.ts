import type {CpflOperation} from '../ocr/cpfl-paulista-layout';
import {feeCents,feeMoney} from '../contracts/services/management-fee';
import {moneyPercent,discountedMoney} from './acl-cost-premises';
import {supplierBilledEnergy,type AclSupplierProposal} from './acl-supplier-preview';
type Kind='TUSD_PEAK'|'TUSD_OFF'|'DEMAND'|'TE'|'ACR_BAND'|'GD_CREDIT'|'SHARED';
type Line={kind:Kind;description:string;amount:string;quantity:string|null;grossRate:string|null;source:string;pages:number[]};
export type InvoiceCostReference={state:'AVAILABLE_REVIEW_REQUIRED'|'BLOCKED';documentId:string;month:string|null;billTotal:string|null;gdCredits:string|null;consumptionKwh:string|null;lines:Line[];excludedTotals:{source:string;amount:string;reason:string}[];pending:string[]};
const norm=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\b(TE|TUSD)(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*\d{2,4}\b/g,'$1').trim();
const cents=(v:string)=>v.startsWith('-')?-feeCents(v.slice(1)):feeCents(v);
const quantity=(v:string)=>{if(!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,9})?$/.test(v))throw Error('Quantidade faturada inválida.');const [a,f='']=v.split('.');return BigInt(a)*1000000000n+BigInt(f.padEnd(9,'0'));};
const qtyText=(n:bigint)=>{const d=n.toString().padStart(10,'0');return d.slice(0,-9)+'.'+d.slice(-9);};
function kind(r:CpflOperation):Kind|null {
 const d=norm(r.fields.description?.text??''),off=/\b(?:FPONTA|F PONTA|FORA PONTA|FORA DE PONTA)\b/.test(d);
 if(/^ENERGIA (?:ATV|ATIVA) (?:INJ|INJETADA)\b/.test(d)&&/\b(?:TE|TUSD)\b/.test(d))return 'GD_CREDIT';
 if(/^CRED (?:ADC|ADICIONAL) BAND\b/.test(d))return 'GD_CREDIT';
 if(/^ADICIONAL BAND\b/.test(d))return 'ACR_BAND';
 if(r.component==='TUSD_ENERGY')return off?'TUSD_OFF':/\bPONTA\b/.test(d)?'TUSD_PEAK':null;
 if(r.component==='TE')return 'TE';
 if(r.component==='DEMAND_BILLED'&&r.fields.unit?.text.trim().toLowerCase()==='kw')return 'DEMAND';
 if(r.component==='PUBLIC_LIGHTING'||/^(?:CONSUMO REATIVO EXC|RESSARCIMENTO DIC MENSAL)\b/.test(d))return 'SHARED';
 return null;
}
/** Documentary draft only: reconcile all detailed signed lines, never add subtotal rows twice. */
export function invoiceCostReference(layout:{layoutId:string|null;operations:CpflOperation[]},documentId:string,month:string|null):InvoiceCostReference {
 const result:InvoiceCostReference={state:'BLOCKED',documentId,month,billTotal:null,gdCredits:null,consumptionKwh:null,lines:[],excludedTotals:[],pending:[]};
 const stop=(message:string)=>{result.pending.push(message);return result;};
 if(layout.layoutId!=='cpfl-paulista-a'||!month||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return stop('Fatura de referência CPFL Grupo A e competência identificadas são necessárias.');
 const total=layout.operations.filter(r=>r.component==='TOTAL_A_PAGAR');if(total.length!==1)return stop('Total a pagar único não identificado na leitura.');
 const validField=(f:CpflOperation['fields'][string]|undefined)=>!!f&&f.spans.length>0&&f.pages.length>0&&!f.issues.some(i=>['UNVERIFIED_SOURCE','INVALID_DECIMAL','NON_BRL_CURRENCY'].includes(i));
 try {
  if(!validField(total[0].fields.amount)||!total[0].fields.amount.decimal)return stop('Total da fatura exige conferência da fonte.');
  const billed=feeCents(total[0].fields.amount.decimal),seen=new Set<string>();let sum=0n,gd=0n;
  const peak:CpflOperation[]=[],off:CpflOperation[]=[],te:CpflOperation[]=[];
  for(const row of layout.operations){
   const d=norm(row.fields.description?.text??'');
   if(row.role==='TOTAL'||/^TOTAL DE DEVOLUCOES\b/.test(d))continue;
   // A CPFL footer may repeat the grand total on the final adjacent row without a label.
   // Preserve its source; no other unlabeled amount is treated as a total.
   if(!d&&row===layout.operations[layout.operations.length-1]&&row.row===total[0].row+1&&row.source.replace(/row\[[0-9]+\]$/,'')===total[0].source.replace(/row\[[0-9]+\]$/,'')&&Object.entries(row.fields).every(([k,f])=>k==='amount'||!f.text.trim())&&validField(row.fields.amount)&&row.fields.amount.decimal===total[0].fields.amount.decimal&&!row.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i))){result.excludedTotals.push({source:row.source,amount:row.fields.amount.decimal!,reason:'Repetição isolada do Total a Pagar na linha final adjacente; excluída da soma de componentes e sujeita à conferência.'});continue;}

   if(row.role==='INFORMATION'||!validField(row.fields.description)||!validField(row.fields.amount)||!row.fields.amount.decimal||row.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i))||seen.has(row.source))return stop('Linha financeira sem fonte inequívoca ou duplicada: '+row.source);
   const k=kind(row);if(!k)return stop('Componente da fatura precisa de revisão para o comparativo: '+row.fields.description.text);
   const n=cents(row.fields.amount.decimal);if(k==='GD_CREDIT'?n>=0n:k!=='SHARED'&&n<0n)return stop('Sinal de débito/crédito precisa de revisão: '+row.source);
   if(k==='SHARED'&&/^RESSARCIMENTO/.test(d)&&n>=0n)return stop('Ressarcimento sem sinal de crédito comprovado.');
   if(k==='TUSD_PEAK')peak.push(row);if(k==='TUSD_OFF')off.push(row);if(k==='TE')te.push(row);
   seen.add(row.source);sum+=n;if(k==='GD_CREDIT')gd-=n;
   result.lines.push({kind:k,description:row.fields.description.text,amount:feeMoney(n),quantity:row.fields.quantity?.decimal??null,grossRate:validField(row.fields.grossRate)?row.fields.grossRate.decimal:null,source:row.source,pages:row.fields.amount.pages});
  }
  if(sum!==billed)return stop('Detalhes da fatura não conciliam exatamente com o total a pagar; diferença '+feeMoney(sum-billed)+'.');
  if(peak.length!==1||off.length!==1||te.length!==2||gd<=0n||!result.lines.some(l=>l.kind==='DEMAND'))return stop('Consumos ponta/fora ponta, demanda e créditos GD completos são necessários.');
  const consumptions=[peak[0],off[0]];
  for(const row of [...consumptions,...te])if(!validField(row.fields.quantity)||!validField(row.fields.unit)||row.fields.unit.text.trim().toLowerCase()!=='kwh'||!row.fields.quantity.decimal)return stop('Quantidade faturada e unidade kWh precisam de revisão.');
  const isOff=(r:CpflOperation)=>/\b(?:FPONTA|F PONTA|FORA PONTA|FORA DE PONTA)\b/.test(norm(r.fields.description.text));
  const teOff=te.filter(isOff),tePeak=te.filter(r=>!isOff(r)&&/\bPONTA\b/.test(norm(r.fields.description.text)));
  const qs=consumptions.map(v=>quantity(v.fields.quantity.decimal!));
  if(teOff.length!==1||tePeak.length!==1||quantity(tePeak[0].fields.quantity.decimal!)!==qs[0]||quantity(teOff[0].fields.quantity.decimal!)!==qs[1])return stop('Quantidades TE/TUSD por período divergentes.');
  result.billTotal=feeMoney(billed);result.gdCredits=feeMoney(gd);result.consumptionKwh=qtyText(qs[0]+qs[1]);result.state='AVAILABLE_REVIEW_REQUIRED';
  result.pending=['Conferência manual das linhas OCR e das premissas do cenário pelo Consultor.','Créditos de um mês não são histórico mensal de GD nem previsão anual.',...result.excludedTotals.map(t=>t.reason+' Fonte: '+t.source)];return result;
 }catch{return stop('Valores da fatura fora dos limites decimais do comparativo.');}
}
export function gdReferenceComparison(ref:InvoiceCostReference|null,p:AclSupplierProposal){
 const pending=(reason:string)=>({state:'BLOCKED',partial:true,month:ref?.month??null,pending:[reason],roi:null,payback:null});
 if(!p.costPremises)return pending('Informe encargos estimados, composição do custo adicional e investimento.');
 if(!ref||ref.state!=='AVAILABLE_REVIEW_REQUIRED'||!ref.billTotal||!ref.consumptionKwh||!ref.gdCredits)return pending(ref?.pending.join(' ')||'Fatura de referência indisponível.');
 if(!p.distribution||p.losses!=='INCLUDED'||p.taxes!=='INCLUDED')return pending('Desconto TUSD e tratamento de perdas/tributos devem ser conferidos.');
 const percentage=p.distribution.discountPercent,base=feeCents(ref.billTotal),ccee=moneyPercent(ref.billTotal,p.costPremises.cceePercent),energy=supplierBilledEnergy(ref.consumptionKwh,p);
 let acl=feeCents(energy)+feeCents(ccee)+feeCents(p.estimatedMonthlyAclBrl);const transformed=ref.lines.map(l=>{
  const n=cents(l.amount);let applied=n,reason='Parcela compartilhada mantida no mesmo mês.';
  if(['TE','ACR_BAND','GD_CREDIT'].includes(l.kind)){applied=0n;reason=l.kind==='GD_CREDIT'?'Crédito removido somente no cenário hipotético 100% ACL.':'Parcela ACR substituída pela energia do fornecedor.';}
  else if(['TUSD_PEAK','DEMAND'].includes(l.kind)){applied=feeCents(discountedMoney(l.amount,percentage));reason='Desconto informado aplicado à linha faturada, já tributada.';}
  if(!['TE','ACR_BAND','GD_CREDIT'].includes(l.kind))acl+=applied;
  return {...l,scenarioAmount:feeMoney(applied),reason};
 });
 const before=base-acl,variable=moneyPercent(feeMoney(before>0n?before:0n),p.savingsPercent),fixed=feeCents(p.fixedMonthlyBrl),after=acl+fixed+feeCents(variable);
 return {state:'REFERENCE_MONTH_DRAFT',partial:true,formulaVersion:'acl-gd-reference/1',month:ref.month,documentId:ref.documentId,consumptionKwh:ref.consumptionKwh,acrWithGd:ref.billTotal,gdCredits:ref.gdCredits,invoiceWithoutGd:feeMoney(base+feeCents(ref.gdCredits)),energy,ccee:{percent:p.costPremises.cceePercent,base:'REFERENCE_INVOICE_TOTAL',baseAmount:ref.billTotal,amount:ccee,estimated:true},associationOrAdditional:p.estimatedMonthlyAclBrl,additionalCostDescription:p.costPremises.additionalCostDescription,aclBeforeFees:feeMoney(acl),fixedFee:p.fixedMonthlyBrl,variableFee:variable,aclAfterFees:feeMoney(after),differenceBeforeFees:feeMoney(before),differenceAfterFees:feeMoney(base-after),migrationInvestment:p.costPremises.migrationInvestmentBrl,investmentEstimated:true,roi:null,payback:null,lines:transformed,pending:ref.pending,warnings:['Comparação hipotética restrita ao mês da fatura, usando quantidades faturadas; não reaproveita quantidades arredondadas do histórico.','Não confirma elegibilidade regulatória, contrato, cobrança real ou migração da unidade. TUSD/demanda seguem a premissa de desconto do cenário.','Encargos ERR+ERCAP são estimativa sobre o total da fatura de referência, podendo variar com sazonalidade e mercado. Não incidem sobre honorários nem sobre o investimento.','Despesas comuns e ressarcimentos deste mês são mantidos nos dois lados; não são repetidos automaticamente na projeção anual.','R$ de diferença positivos favorecem o cenário ACL; negativos indicam custo ACL maior neste mês. Não é economia publicada ou aprovada.','Investimento de homologação é separado dos custos mensais e permanece editável. Sem fluxo mensal completo e GD sazonal revisada, ROI/payback não são calculados.']};
}

/** User-approved statistical scenario. Ratio uses documented off-peak GD/consumption;
 * application uses total historical consumption, explicitly not metered compensation. */
export function gdHistoryEstimate(ref:InvoiceCostReference|null,p:AclSupplierProposal,rows:{month:string;sourceMonth:string;referenceKwh:string}[]){
 const blocked=(reason:string)=>({state:'BLOCKED',pending:[reason]});
 const method=p.costPremises?.gdHistoryEstimate;if(!method)return null;
 if(!ref||ref.state!=='AVAILABLE_REVIEW_REQUIRED')return blocked('Conferir fatura de referência antes de estimar GD histórica.');
 try {
  const off=ref.lines.find(l=>l.kind==='TUSD_OFF'),credits=ref.lines.filter(l=>l.kind==='GD_CREDIT'&&/^ENERGIA /.test(norm(l.description))),bands=ref.lines.filter(l=>l.kind==='GD_CREDIT'&&/^CRED /.test(norm(l.description)));
  if(!off?.quantity||credits.length!==2||credits.some(l=>!l.quantity||!l.grossRate||!/^ENERGIA .* FPONTA (?:TUSD|TE)/.test(norm(l.description))))return blocked('Quantidade e tarifas de GD fora de ponta precisam de conferência.');
  const injected=quantity(credits[0].quantity!),den=quantity(off.quantity);
  if(!injected||!den||injected>den||credits.some(l=>quantity(l.quantity!)!==injected))return blocked('Proporção de GD fora dos limites ou quantidades divergentes.');
  const rounded=(n:bigint,d:bigint)=>feeMoney((n*100n+d/2n)/d);
  const projected=rows.map(h=>{
   if(h.sourceMonth===ref.month)return {...h,estimated:false,sourceKind:'DOCUMENTED_REFERENCE',gdKwh:qtyText(injected),credits:ref.gdCredits!,lines:ref.lines.filter(l=>l.kind==='GD_CREDIT').map(l=>({description:l.description,rate:l.grossRate,amount:feeMoney(-cents(l.amount)),source:l.source}))};
   const consumption=quantity(h.referenceKwh),referenceTotal=quantity(ref.consumptionKwh!);let ratioN=injected,ratioD=den;
   if(method==='REFERENCE_RATIO_TOTAL_CONSERVATIVE_CAP'&&consumption*den<injected*referenceTotal){ratioN=consumption;ratioD=referenceTotal;}
   if(method==='REFERENCE_RATIO_TOTAL_PROPORTIONAL'&&consumption<referenceTotal){ratioN=injected*consumption;ratioD=den*referenceTotal;}
   if(method==='REFERENCE_RATIO_TOTAL_POINT_REDUCTION'&&consumption<referenceTotal){ratioN=injected*referenceTotal-den*(referenceTotal-consumption);ratioD=den*referenceTotal;if(ratioN<0n)ratioN=0n;}
   const estimate=consumption*ratioN,gdKwh=qtyText((estimate+ratioD/2n)/ratioD),appliedPercent=(Number(ratioN)*100/Number(ratioD)).toFixed(6),consumptionPercent=(Number(consumption)*100/Number(referenceTotal)).toFixed(6);
   const lines=credits.map(l=>{const [a,f='']=l.grossRate!.split('.');return {description:l.description,rate:l.grossRate,amount:rounded(estimate*BigInt(a+f),ratioD*1000000000n*10n**BigInt(f.length)),source:l.source};});
   // Band credit has no unit tariff printed: proportional amount explicitly estimated.
   for(const l of bands)lines.push({description:l.description+' — proporcional estimado',rate:null,amount:feeMoney((estimate*(-cents(l.amount))+ratioD*injected/2n)/(ratioD*injected)),source:l.source});
   return {...h,estimated:true,sourceKind:'STATISTICAL_ESTIMATE',appliedPercent,consumptionPercent,gdKwh,credits:feeMoney(lines.reduce((v,l)=>v+feeCents(l.amount),0n)),lines};
  });
  return {state:'STATISTICAL_ESTIMATE',formulaVersion:method==='REFERENCE_RATIO_TOTAL'?'acl-gd-history/1':'acl-gd-history/2',method,referenceTotalKwh:ref.consumptionKwh,referenceMonth:ref.month,documentId:ref.documentId,numeratorKwh:credits[0].quantity,denominatorOffPeakKwh:off.quantity,ratioPercent:(Number(injected)*100/Number(den)).toFixed(6),applicationBasis:'TOTAL_HISTORICAL_KWH',rows:projected,creditsSubtotal:feeMoney(projected.reduce((v,h)=>v+feeCents(h.credits),0n)),warnings:['GD histórica estimada para comparação econômica; não representa créditos registrados, disponíveis ou garantidos.',method==='REFERENCE_RATIO_TOTAL_POINT_REDUCTION'?'GD aplicada = máximo(0, percentual GD da referência menos a queda percentual do consumo total mensal em relação ao total faturado da referência). Percentual limitado ao da referência.':method==='REFERENCE_RATIO_TOTAL_CONSERVATIVE_CAP'?'Limite mensal: menor entre percentual GD da referência e consumo total do mês dividido pelo consumo total faturado da referência. Meses maiores não aumentam o percentual GD.':method==='REFERENCE_RATIO_TOTAL_PROPORTIONAL'?'Redução proporcional: percentual GD da referência × menor entre 1 e consumo total do mês / consumo total faturado da referência.':'Sem ajuste mensal adicional de percentual.',
 'Proporção exata GD/consumo fora de ponta da fatura aplicada ao consumo total de cada mês, por premissa do usuário. A fatura comprova compensação somente fora de ponta.','Mesmas tarifas de crédito GD da referência; crédito de bandeira proporcional estimado, sem prever bandeiras futuras.','Reduzir créditos GD torna o benefício GD estimado menor, podendo favorecer o cenário ACL no comparativo; não significa conservadorismo universal da decisão de migração.',
 'Não altera o histórico aprovado, o cadastro, apurações publicadas ou aprovação de viabilidade. ROI/payback continuam pendentes.']};
 }catch{return blocked('Quantidades ou tarifas GD fora dos limites do cálculo estatístico.');}
}
