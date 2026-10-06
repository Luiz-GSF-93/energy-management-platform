import {tariffProduct} from '../contracts/services/tariff-preview';
import {validAclHistory,AclHistoryRow} from './acl-invoice-history';
export type FixedHistoryTariffs={peakBrlKwh:string;offPeakBrlKwh:string;demandBrlKw:string;referenceMonth:string;source:string;checked:true};
export function fixedHistoryTariffs(value:unknown):FixedHistoryTariffs {
 const t=value as FixedHistoryTariffs;
 if(!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).sort().join(',')!=='checked,demandBrlKw,offPeakBrlKwh,peakBrlKwh,referenceMonth,source'||t.checked!==true||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(t.referenceMonth)||typeof t.source!=='string'||t.source.trim().length<10||t.source.length>500)throw Error('Confira a fonte, a competência e as tarifas da simulação.');
 for(const key of ['peakBrlKwh','offPeakBrlKwh','demandBrlKw'] as const){if(typeof t[key]!=='string'||!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,9})?$/.test(t[key]))throw Error('Informe tarifas decimais não negativas com até nove casas nas unidades indicadas.');}
 return {...t,source:t.source.trim()};
}
const money=(c:bigint)=>{const s=c.toString().padStart(3,'0');return s.slice(0,-2)+'.'+s.slice(-2);};
const sum=(v:string[])=>money(v.reduce((a,b)=>a+BigInt(b.replace('.','')),0n));
/** Fixed-price counterfactual, never a reconstruction of paid invoices. */
export function simulateFixedHistory(history:{sourceDocumentId:string;rows:AclHistoryRow[]},value:unknown){
 if(!validAclHistory(history,[history.sourceDocumentId]))throw Error('Histórico revisado de 12 meses indisponível.');
 const tariffs=fixedHistoryTariffs(value);
 const rows=history.rows.map(r=>{const peak=tariffProduct(r.peakKwh,tariffs.peakBrlKwh),offPeak=tariffProduct(r.offPeakKwh,tariffs.offPeakBrlKwh),demand=tariffProduct(r.demandKw,tariffs.demandBrlKw);return {month:r.month,peakKwh:r.peakKwh,offPeakKwh:r.offPeakKwh,measuredDemandKw:r.demandKw,peak:peak.rounded,offPeak:offPeak.rounded,measuredDemandEstimate:demand.rounded,subtotal:sum([peak.rounded,offPeak.rounded,demand.rounded]),exact:{peak:peak.exact,offPeak:offPeak.exact,measuredDemandEstimate:demand.exact},page:r.page,source:r.source};});
 return {mode:'FIXED_TARIFF_HISTORY_SIMULATION',formulaVersion:'acl-fixed-history-1.0',rounding:'HALF_UP_PER_LINE_SUM_ROUNDED_LINES',tariffs,rows,annualSubtotal:sum(rows.map(r=>r.subtotal)),paidCostHistory:false,partial:true,warnings:[
  'Mesmas tarifas informadas aplicadas aos 12 meses; não comprova custos pagos, vigências históricas, economia líquida ou ROI.',
  'Energia: kWh × R$/kWh. Demanda: kW medidos × R$/kW, hipótese de simulação; não equivale a demanda faturável e não inclui contratada, ultrapassagem ou parcelas utilizada/não utilizada.',
  'Sem novos tributos. Informe tarifas com o tratamento tributário desejado já incluído. GD/créditos, BESS, reativos, bandeiras, CIP, CCEE, fornecedor, gestão e investimentos não são calculados nesta prévia.',
  'Prévia interna de leitura, sem publicação no portal ou alteração de apurações e parâmetros. Fontes devem ser revistas antes de qualquer decisão.'
 ]};
}
