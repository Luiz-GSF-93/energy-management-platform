import {feeCents,feeMoney} from '../contracts/services/management-fee';
import {tariffProduct} from '../contracts/services/tariff-preview';
import {moneyPercent} from './acl-cost-premises';
import {gdReferenceComparison,gdHistoryEstimate,type InvoiceCostReference} from './acl-gd-comparison';
import type {AclSupplierProposal,supplierPreview} from './acl-supplier-preview';
export type FinancialBasis={method:'FIXED_TARIFFS_MEASURED_DEMAND';sharedMonthlyBrl:string;source:string;checked:true};
export function financialBasis(v:unknown):FinancialBasis {
 const b=v as FinancialBasis;
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='checked,method,sharedMonthlyBrl,source'||b.checked!==true||b.method!=='FIXED_TARIFFS_MEASURED_DEMAND'||typeof b.source!=='string'||b.source.trim().length<20||b.source.length>500||typeof b.sharedMonthlyBrl!=='string')throw Error('Confira a base financeira, a demanda estimada e os custos comuns mensais.');
 feeCents(b.sharedMonthlyBrl);return {...b,source:b.source.trim()};
}
export function financialDraft(ref:InvoiceCostReference|null){
 if(ref?.state!=='AVAILABLE_REVIEW_REQUIRED')return null;
 const positive=ref.lines.filter(l=>l.kind==='SHARED'&&!l.amount.startsWith('-'));
 return {method:'FIXED_TARIFFS_MEASURED_DEMAND' as const,sharedMonthlyBrl:feeMoney(positive.reduce((a,l)=>a+feeCents(l.amount),0n)),checked:false,source:'Fatura '+ref.documentId+': débitos comuns positivos repetidos como estimativa mensal; ressarcimentos eventuais não repetidos. Demanda medida e tarifas fixas exigem conferência.'};
}
const signed=(s:string)=>s.startsWith('-')?-feeCents(s.slice(1)):feeCents(s);
const percent=(n:bigint,d:bigint)=>{const negative=n<0n,numerator=negative?-n:n;return (negative?'-':'')+feeMoney((numerator*10000n+d/2n)/d);};
/** Complete modeled cash flow, never actual invoices or a regulatory conclusion. */
export function financialComparison(ref:InvoiceCostReference|null,p:AclSupplierProposal,preview:ReturnType<typeof supplierPreview>){
 const blocked=(message:string)=>({state:'BLOCKED' as const,pending:[message],roi:null,payback:null});
 if(!p.financialBasis)return null;
 if(!p.costPremises||!p.distribution||p.losses!=='INCLUDED'||p.taxes!=='INCLUDED')return blocked('Conferir energia, TUSD, encargos, investimento e GD antes do fluxo completo.');
 if(ref?.state!=='AVAILABLE_REVIEW_REQUIRED'||!ref.billTotal||!ref.consumptionKwh)return blocked('Fatura conciliada indisponível para a base ACR.');
 const gd=gdHistoryEstimate(ref,p,preview.rows),billed=gdReferenceComparison(ref,p);
 if(gd?.state!=='STATISTICAL_ESTIMATE'||!('rows' in gd)||billed.state!=='REFERENCE_MONTH_DRAFT'||!('aclBeforeFees' in billed))return blocked('Conferir créditos GD e comparação documental antes do fluxo financeiro.');
 const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 const te=ref.lines.filter(l=>l.kind==='TE'),off=(s:string)=>/FPONTA|F PONTA|FORA (?:DE )?PONTA/.test(norm(s));
 const tePeak=te.filter(l=>!off(l.description)),teOff=te.filter(l=>off(l.description));
 if(tePeak.length!==1||teOff.length!==1||[...tePeak,...teOff].some(l=>!l.grossRate||!l.quantity||(()=>{const delta=feeCents(tariffProduct(l.quantity!,l.grossRate!).rounded)-signed(l.amount);return delta>1n||delta< -1n;})()))return blocked('Tarifas TE ponta/fora ponta precisam de fonte única e conciliação para projetar ACR.');
 const invoiceTotal=feeCents(ref.billTotal),investment=feeCents(p.costPremises.migrationInvestmentBrl);
 const sourceRows=preview.rows;let cumulative=-investment,payback:string|null=null;
 const ratioMoney=(amount:bigint,kwh:string)=>{const micro=(s:string)=>{const [a,f='']=s.split('.');return BigInt(a)*1000000000n+BigInt(f.padEnd(9,'0'));};const n=amount*micro(kwh),d=micro(ref.consumptionKwh!);return feeMoney((n+d/2n)/d);};
 const bandBase=ref.lines.filter(l=>l.kind==='ACR_BAND').reduce((a,l)=>a+signed(l.amount),0n);
 const rows=sourceRows.map((r,i)=>{
  const history=gd.rows!.find(g=>g.month===r.month)!;
  const teEnergy=feeCents(tariffProduct(r.peakKwh,tePeak[0].grossRate!).rounded)+feeCents(tariffProduct(r.offPeakKwh,teOff[0].grossRate!).rounded);
  const acrTusd=feeCents(r.tusd!.peak.undiscounted)+feeCents(tariffProduct(r.offPeakKwh,p.distribution!.offPeakBrlKwh).rounded)+feeCents(r.tusd!.measuredDemand.undiscounted);
  const bands=ratioMoney(bandBase,r.referenceKwh),shared=p.financialBasis!.sharedMonthlyBrl,credit=history.credits;
  const reference=r.sourceMonth===ref.month;
  const reconstructed=teEnergy+acrTusd+feeCents(bands)+feeCents(shared)-feeCents(credit);
  if(reconstructed<0n)throw Error('Créditos excedem a base ACR estimada; ajuste as premissas, sem truncar o total.');
  const acr=reference?invoiceTotal:reconstructed;
  const ccee=moneyPercent(feeMoney(acr),p.costPremises!.cceePercent);
  const acl=reference?feeCents(billed.aclBeforeFees!):feeCents(r.energy)+feeCents(r.tusd!.peak.amount)+feeCents(r.tusd!.offPeak)+feeCents(r.tusd!.measuredDemand.amount)+feeCents(shared)+feeCents(p.estimatedMonthlyAclBrl)+feeCents(ccee);
  const before=acr-acl,variable=moneyPercent(feeMoney(before>0n?before:0n),p.savingsPercent),after=acl+feeCents(r.fixedFee)+feeCents(variable),saving=acr-after,prior=cumulative;cumulative+=saving;
  if(investment>0n&&prior<0n&&cumulative>=0n&&saving>0n)payback=feeMoney(BigInt(i)*100n+((-prior)*100n+saving/2n)/saving);
  if(cumulative<0n)payback=null;
  return {month:r.month,sourceMonth:r.sourceMonth,referenceKwh:r.referenceKwh,demandKw:r.measuredDemandKw,acr:feeMoney(acr),aclBeforeFees:feeMoney(acl),aclAfterFees:feeMoney(after),energy:r.energy,ccee,gdCredit:credit,fixedFee:r.fixedFee,variableFee:variable,additional:r.estimatedAdditional,shared,bands,te:feeMoney(teEnergy),tusdAcr:feeMoney(acrTusd),savingBeforeFees:feeMoney(before),saving:feeMoney(saving),cumulative:feeMoney(cumulative),referenceDocumentary:reference,source:r.source,page:r.page};
 });
 const sum=(key:'acr'|'aclAfterFees'|'saving'|'variableFee')=>rows.reduce((a,r)=>a+signed(r[key]),0n),net=sum('saving')-investment;
 return {state:'COMPLETE_SIMULATED' as const,formulaVersion:'acl-financial/1',estimated:true,reviewRequired:true,documentId:ref.documentId,referenceMonth:ref.month,rows,investment:feeMoney(investment),acrTotal:feeMoney(sum('acr')),aclTotal:feeMoney(sum('aclAfterFees')),operatingSavings:feeMoney(sum('saving')),variableFeeTotal:feeMoney(sum('variableFee')),netCash:feeMoney(net),roiPercent:investment>0n?percent(net,investment):null,paybackMonths:payback,paybackState:investment===0n?'NO_INVESTMENT':payback===null?'NOT_RECOVERED_IN_HORIZON':'RECOVERED_IN_HORIZON',horizonMonths:p.months,conclusion:sum('saving')>0n?'FAVORABLE_OPERATING':'UNFAVORABLE_OPERATING',pending:[],tariffSources:[...tePeak,...teOff].map(l=>({source:l.source,pages:l.pages,rate:l.grossRate,description:l.description})),warnings:['Comparativo completo das hipóteses de simulação; não é custo realizado, economia publicada ou aprovação regulatória.','ACR usa tarifas TE/TUSD da referência e demanda medida como aproximação da faturável. Meses históricos não comprovam custos pagos.','Bandeira ACR proporcional ao consumo; débitos comuns positivos repetidos conforme premissa editável. Ressarcimentos eventuais não são projetados.','GD histórica é estimativa estatística; no mês da referência usam-se fatura e quantidades faturadas. No cenário 100% ACL os créditos GD são removidos.','ERR+ERCAP estimados sobre o total ACR simulado de cada mês, sem circularidade; mês documental usa total da fatura.','Honorário variável = percentual × máximo(0, ACR − ACL antes de honorários). Fixo cobrado em todos os meses.','Investimento ocorre no instante zero. ROI do horizonte = (economia operacional acumulada − investimento) / investimento × 100; não é taxa anualizada.','Payback simples por saldo acumulado, interpolado no mês de recuperação, sem desconto financeiro e sem extrapolação além da vigência. Nova queda abaixo de zero invalida recuperação anterior.','Revisão independente deve confirmar hipóteses, demanda faturável, cobertura de custos, créditos e a decisão sobre o cenário.']};
}
