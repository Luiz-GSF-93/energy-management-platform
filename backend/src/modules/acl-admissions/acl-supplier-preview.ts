import {tariffProduct} from '../contracts/services/tariff-preview';
import {feeCents,feeMoney} from '../contracts/services/management-fee';
import {validAclHistory,AclHistoryRow} from './acl-invoice-history';
export type AclSupplierProposal={supplier:string;energyBrlMwh:string;startMonth:string;months:number;fixedMonthlyBrl:string;savingsPercent:string;losses:'PENDING'|'INCLUDED'|'EXCLUDED';taxes:'PENDING'|'INCLUDED'|'EXCLUDED';source:string;checked:true};
export function supplierProposal(value:unknown):AclSupplierProposal {
 const p=value as AclSupplierProposal;
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='checked,energyBrlMwh,fixedMonthlyBrl,losses,months,savingsPercent,source,startMonth,supplier,taxes'||p.checked!==true||typeof p.supplier!=='string'||p.supplier.trim().length<2||p.supplier.length>120||typeof p.source!=='string'||p.source.trim().length<20||p.source.length>500||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(p.startMonth)||!Number.isInteger(p.months)||p.months<1||p.months>12)throw Error('Confira fornecedor, fonte, início e vigência de até 12 meses.');
 if(typeof p.energyBrlMwh!=='string'||!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,9})?$/.test(p.energyBrlMwh)||typeof p.fixedMonthlyBrl!=='string'||typeof p.savingsPercent!=='string'||!/^(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)$/.test(p.savingsPercent))throw Error('Informe preço em R$/MWh, fixo mensal e percentual entre 0 e 100.');
 feeCents(p.fixedMonthlyBrl);
 if(!['PENDING','INCLUDED','EXCLUDED'].includes(p.losses)||!['PENDING','INCLUDED','EXCLUDED'].includes(p.taxes))throw Error('Informe a situação de perdas e tributos na proposta.');
 return {...p,supplier:p.supplier.trim(),source:p.source.trim()};
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
  const energy=tariffProduct(kwh,proposal.energyBrlMwh,true);
  return {month:date.toISOString().slice(0,7),sourceMonth:source.month,referenceKwh:kwh,energy:energy.rounded,exactEnergy:energy.exact,fixedFee:feeMoney(feeCents(proposal.fixedMonthlyBrl)),variableFee:null,page:source.page,source:source.source};
 });
 const sum=(values:string[])=>feeMoney(values.reduce((a,v)=>a+feeCents(v),0n));
 return {formulaVersion:'acl-supplier-preview/1',mode:'SEASONAL_REFERENCE_ONLY',partial:true,proposal,rows,energySubtotal:sum(rows.map(r=>r.energy)),fixedFeeSubtotal:sum(rows.map(r=>r.fixedFee)),variableFee:null,totalAclCost:null,savings:null,roi:null,payback:null,
  feeFormula:'Fixo mensal + percentual × máximo(0, custo ACR comparável − custo ACL antes dos honorários).',
  pending:['Comparativo completo ACR/ACL, incluindo TUSD, demanda faturável, GD/créditos, encargos, CCEE e custos de migração.',...(proposal.losses==='INCLUDED'?[]:[proposal.losses==='PENDING'?'Confirmar se perdas estão incluídas no preço.':'Quantificar perdas excluídas do preço.']),...(proposal.taxes==='INCLUDED'?[]:[proposal.taxes==='PENDING'?'Confirmar se tributos estão incluídos no preço.':'Quantificar tributos excluídos do preço.']),'Economia positiva antes dos honorários para calcular a parcela variável.','Investimento e metodologia revisados para ROI/payback.'],
  warnings:['Meses projetados reutilizam o consumo do mesmo mês do histórico aprovado; não são previsão de consumo nem volume contratado.','O preço informado incide sobre a soma do consumo de ponta e fora de ponta, em kWh ÷ 1.000. Não há compensação automática de GD/BESS nem acréscimo de perdas ou tributos.','Prévia interna sem persistência, aprovação, publicação no portal, contratação ou alteração de apurações. A vigência mensal informada não confirma uma data de início de suprimento.']};
}
