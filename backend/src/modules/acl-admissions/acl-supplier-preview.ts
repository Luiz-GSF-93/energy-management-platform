import {tariffProduct} from '../contracts/services/tariff-preview';
import {feeCents,feeMoney} from '../contracts/services/management-fee';
import {costPremises,AclCostPremises} from './acl-cost-premises';
import {validAclHistory,AclHistoryRow} from './acl-invoice-history';
export type AclDistributionScenario={peakBrlKwh:string;offPeakBrlKwh:string;demandBrlKw:string;discountPercent:string;source:string;checked:true};
export type AclEnergyBasis={baseBrlMwh:string;lossPercent:string;icmsPercent:string;method:'LOSS_UPLIFT_ICMS_INSIDE';checked:true};
export type AclSupplierProposal={supplier:string;energyBrlMwh:string;energyBasis?:AclEnergyBasis;costPremises?:AclCostPremises;startMonth:string;months:number;fixedMonthlyBrl:string;savingsPercent:string;estimatedMonthlyAclBrl:string;distribution:AclDistributionScenario|null;losses:'PENDING'|'INCLUDED'|'EXCLUDED';taxes:'PENDING'|'INCLUDED'|'EXCLUDED';source:string;checked:true};
const percentUnits=(s:string)=>{const [a,b='']=s.split('.');return BigInt(a)*10000n+BigInt(b.padEnd(4,'0'));};
/** A rational price avoids rounding a repeating ICMS rate before pricing the line. */
function energyBasis(value:unknown):AclEnergyBasis {
 const b=value as AclEnergyBasis;
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='baseBrlMwh,checked,icmsPercent,lossPercent,method'||b.checked!==true||b.method!=='LOSS_UPLIFT_ICMS_INSIDE'||typeof b.baseBrlMwh!=='string'||!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,9})?$/.test(b.baseBrlMwh))throw Error('Confira o preço-base, as perdas e o ICMS por dentro.');
 for(const key of ['lossPercent','icmsPercent'] as const)if(typeof b[key]!=='string'||!/^(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)$/.test(b[key])||(key==='icmsPercent'&&percentUnits(b[key])>=1000000n))throw Error('Perdas devem ficar entre 0% e 100%; ICMS deve ser inferior a 100%.');
 return {...b};
}
function basisRatio(b:AclEnergyBasis){const [a,f='']=b.baseBrlMwh.split('.');return {numerator:BigInt(a+f)*(1000000n+percentUnits(b.lossPercent)),denominator:10n**BigInt(f.length)*(1000000n-percentUnits(b.icmsPercent))};}
function basisRate(b:AclEnergyBasis){const q=basisRatio(b),n=(q.numerator*1000000000n+q.denominator/2n)/q.denominator,d=n.toString().padStart(10,'0');return (d.slice(0,-9)+'.'+d.slice(-9)).replace(/\.?0+$/,'')||'0';}
function basisEnergy(kwh:string,b:AclEnergyBasis){const q=basisRatio(b),[a,f='']=kwh.split('.'),n=BigInt(a+f)*q.numerator,den=10n**BigInt(f.length)*1000n*q.denominator;return {rounded:feeMoney((n*100n+den/2n)/den),exact:null,numerator:n.toString(),denominator:den.toString()};}
function distributionScenario(value:unknown):AclDistributionScenario|null {
 if(value===null)return null;const d=value as AclDistributionScenario;
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).sort().join(',')!=='checked,demandBrlKw,discountPercent,offPeakBrlKwh,peakBrlKwh,source'||d.checked!==true||typeof d.source!=='string'||d.source.trim().length<20||d.source.length>500||typeof d.discountPercent!=='string'||!/^(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)$/.test(d.discountPercent)||percentUnits(d.discountPercent)<500000n)throw Error('Confira a referência TUSD e um desconto entre 50% e 100%.');
 for(const key of ['peakBrlKwh','offPeakBrlKwh','demandBrlKw'] as const)if(typeof d[key]!=='string'||!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,9})?$/.test(d[key]))throw Error('Informe tarifas TUSD decimais não negativas, sem desconto aplicado.');
 return {...d,source:d.source.trim()};
}
/** Discount exact line value once, then HALF_UP to cents. Off-peak never calls this. */
function discountedLine(quantity:string,rate:string,percent:string){
 const base=tariffProduct(quantity,rate),[w,f='']=base.exact.split('.'),numerator=BigInt(w+f)*(1000000n-percentUnits(percent))*100n,denominator=10n**BigInt(f.length)*1000000n;
 const amount=feeMoney((numerator+denominator/2n)/denominator);
 return {amount,undiscounted:base.rounded,discount:feeMoney(feeCents(base.rounded)-feeCents(amount)),exactUndiscounted:base.exact};
}
export function supplierProposal(value:unknown):AclSupplierProposal {
 const p=value as AclSupplierProposal;
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).filter(k=>!['energyBasis','costPremises'].includes(k)).sort().join(',')!=='checked,distribution,energyBrlMwh,estimatedMonthlyAclBrl,fixedMonthlyBrl,losses,months,savingsPercent,source,startMonth,supplier,taxes'||p.checked!==true||typeof p.supplier!=='string'||p.supplier.trim().length<2||p.supplier.length>120||typeof p.source!=='string'||p.source.trim().length<20||p.source.length>500||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(p.startMonth)||!Number.isInteger(p.months)||p.months<1||p.months>12)throw Error('Confira fornecedor, fonte, início e vigência de até 12 meses.');
 if(typeof p.energyBrlMwh!=='string'||!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,9})?$/.test(p.energyBrlMwh)||typeof p.fixedMonthlyBrl!=='string'||typeof p.savingsPercent!=='string'||!/^(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)$/.test(p.savingsPercent))throw Error('Informe preço em R$/MWh, fixo mensal e percentual entre 0 e 100.');
 feeCents(p.fixedMonthlyBrl);if(typeof p.estimatedMonthlyAclBrl!=='string')throw Error('Informe o custo ACL adicional estimado mensal.');feeCents(p.estimatedMonthlyAclBrl);
 if(!['PENDING','INCLUDED','EXCLUDED'].includes(p.losses)||!['PENDING','INCLUDED','EXCLUDED'].includes(p.taxes))throw Error('Informe a situação de perdas e tributos na proposta.');
 const basis=Object.prototype.hasOwnProperty.call(p,'energyBasis')?energyBasis(p.energyBasis):undefined;
 if(basis&&(p.losses!=='INCLUDED'||p.taxes!=='INCLUDED'||p.energyBrlMwh!==basisRate(basis)))throw Error('O preço efetivo deve corresponder às premissas estruturadas, com perdas e ICMS incluídos.');
 const costs=Object.prototype.hasOwnProperty.call(p,'costPremises')?costPremises(p.costPremises):undefined;
 return {...p,...(costs?{costPremises:costs}:{}),...(basis?{energyBasis:basis}:{}),distribution:distributionScenario(p.distribution),supplier:p.supplier.trim(),source:p.source.trim()};
}
/** The source month is a seasonal reference, never a forecast or actual billed volume. */
export function supplierPreview(history:{sourceDocumentId:string;rows:AclHistoryRow[]},value:unknown){
 if(!validAclHistory(history,[history.sourceDocumentId]))throw Error('Histórico aprovado de 12 meses indisponível.');
 const proposal=supplierProposal(value),[year,month]=proposal.startMonth.split('-').map(Number);
 const rows=Array.from({length:proposal.months},(_,i)=>{
  const date=new Date(Date.UTC(year,month-1+i,1)),source=history.rows.find(r=>Number(r.month.slice(5))===date.getUTCMonth()+1)!;
  // Combine kWh before rounding the single supplier energy line. No float arithmetic.
  const micros=(s:string)=>{const [a,b='']=s.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));};
  const total=micros(source.peakKwh)+micros(source.offPeakKwh),digits=total.toString().padStart(7,'0'),kwh=digits.slice(0,-6)+'.'+digits.slice(-6);
  const energy=proposal.energyBasis?basisEnergy(kwh,proposal.energyBasis):tariffProduct(kwh,proposal.energyBrlMwh,true);
  const d=proposal.distribution,tusd=d?{peak:discountedLine(source.peakKwh,d.peakBrlKwh,d.discountPercent),offPeak:tariffProduct(source.offPeakKwh,d.offPeakBrlKwh).rounded,measuredDemand:discountedLine(source.demandKw,d.demandBrlKw,d.discountPercent)}:null;
  const estimatedAdditional=feeMoney(feeCents(proposal.estimatedMonthlyAclBrl)),fixedFee=feeMoney(feeCents(proposal.fixedMonthlyBrl));
  const knownComponentsSubtotal=tusd?feeMoney([energy.rounded,fixedFee,estimatedAdditional,tusd.peak.amount,tusd.offPeak,tusd.measuredDemand.amount].reduce((a,v)=>a+feeCents(v),0n)):null;
  return {month:date.toISOString().slice(0,7),sourceMonth:source.month,referenceKwh:kwh,measuredDemandKw:source.demandKw,energy:energy.rounded,exactEnergy:energy.exact,...('numerator' in energy?{energyRational:{numerator:energy.numerator,denominator:energy.denominator}}:{}),fixedFee,estimatedAdditional,tusd,knownComponentsSubtotal,variableFee:null,page:source.page,source:source.source};
 });
 const sum=(values:string[])=>feeMoney(values.reduce((a,v)=>a+feeCents(v),0n));
 return {formulaVersion:proposal.costPremises?'acl-supplier-preview/4':proposal.energyBasis?'acl-supplier-preview/3':'acl-supplier-preview/2',mode:'SEASONAL_REFERENCE_ONLY',partial:true,proposal,rows,energySubtotal:sum(rows.map(r=>r.energy)),fixedFeeSubtotal:sum(rows.map(r=>r.fixedFee)),estimatedAdditionalSubtotal:sum(rows.map(r=>r.estimatedAdditional)),knownComponentsSubtotal:proposal.distribution?sum(rows.map(r=>r.knownComponentsSubtotal!)):null,variableFee:null,totalAclCost:null,savings:null,roi:null,payback:null,
  feeFormula:'Fixo mensal + percentual × máximo(0, custo ACR comparável − custo ACL antes dos honorários).',
  pending:[...(proposal.costPremises?['Encargos estimados sobre a fatura de referência não constituem histórico mensal de custos CCEE.','Créditos GD mensais e fluxo de caixa completo para ROI/payback ainda requerem revisão.']:[]),'Comparativo completo ACR/ACL, incluindo TUSD, demanda faturável, GD/créditos, encargos, CCEE e custos de migração.',...(proposal.losses==='INCLUDED'?[]:[proposal.losses==='PENDING'?'Confirmar se perdas estão incluídas no preço.':'Quantificar perdas excluídas do preço.']),...(proposal.taxes==='INCLUDED'?[]:[proposal.taxes==='PENDING'?'Confirmar se tributos estão incluídos no preço.':'Quantificar tributos excluídos do preço.']),'Economia positiva antes dos honorários para calcular a parcela variável.','Investimento e metodologia revisados para ROI/payback.'],
  warnings:['Meses projetados reutilizam o consumo do mesmo mês do histórico aprovado; não são previsão de consumo nem volume contratado.','O preço informado incide sobre a soma do consumo de ponta e fora de ponta, em kWh ÷ 1.000. Não há compensação automática de GD/BESS. Perdas e ICMS só são acrescidos quando informados nas premissas estruturadas; não são reaplicados à TUSD.','Desconto como premissa do cenário: TUSD ponta e demanda × (1 − desconto/100); TUSD fora de ponta integral. As tarifas-base devem ser anteriores ao desconto. Não comprova benefício contratual ou regulatório.','Demanda medida × tarifa é apenas estimativa; não substitui demanda faturável contratada/utilizada, ultrapassagem ou parcelas utilizada/não utilizada.','O custo ACL adicional é estimado por mês e somado uma vez. Não inclua nele energia, TUSD ou honorários já separados; descreva sua composição na fonte.','Prévia interna sem persistência, aprovação, publicação no portal, contratação ou alteração de apurações. A vigência mensal informada não confirma uma data de início de suprimento.']};
}

/** A single billed month may use exact billed kWh; rounded historical rows never replace it. */
export function supplierBilledEnergy(kwh:string,p:AclSupplierProposal){return p.energyBasis?basisEnergy(kwh,p.energyBasis).rounded:tariffProduct(kwh,p.energyBrlMwh,true).rounded;}
