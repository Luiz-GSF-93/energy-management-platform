import {supplierEvidenceException} from './supplier-evidence';
import {monthlyCostLedger} from './monthly-cost-ledger';
const SCALE=10n**12n;
const fixed=(v:bigint,p=12)=>{const sign=v<0n?'-':'',s=(v<0n?-v:v).toString().padStart(p+1,'0');return sign+s.slice(0,-p)+'.'+s.slice(-p);};
const cents=(v:string)=>{if(!/^(0|[1-9][0-9]*)[.][0-9]{2}$/.test(v))throw Error('Valor documental inválido.');return BigInt(v.replace('.',''));};
/** Explicit one-month spot purchase. No inferred minimum, tolerance or balancing trade. */
export function spotSupplierCost(r:any,unit:any,month:string,volume:bigint,price:bigint,costRows:any[]){
 const need=(code:string,message:string,tab='costs')=>r.requirements.push({code,message,tab});
 try{
  const m=r.measurements.measurements;
  // Measurement decimals have already been validated by prepareMeasurements.
  const kwh=(s:string)=>{const [a,b='']=s.split('.');return (BigInt(a)*1000000n+BigInt(b.padEnd(6,'0')))*1000n;};
  const consumed=kwh(m.consumptionTotal),peak=kwh(m.consumptionPeak),off=kwh(m.consumptionOffPeak);
  if(peak+off!==consumed)throw Error('Ponta e fora ponta devem totalizar o consumo medido.');
  if(volume<=0n)throw Error('Informe o volume positivo da compra pontual.');
  const expected=(volume*price*100n+SCALE*SCALE/2n)/(SCALE*SCALE);
  Object.assign(r,{consumedMwh:fixed(consumed),billedMwh:fixed(volume),volumeDifferenceMwh:fixed(consumed-volume),minimumUnusedMwh:null,extraMwh:null,minimumAmount:'0.00',extraAmount:'0.00',extraSources:[],regularAmount:fixed(expected,2),priceSource:r.priceSource});
  if(consumed!==volume)need('SPOT_VOLUME_DIFFERENCE','Consumo medido menos compra pontual: '+fixed(consumed-volume)+' MWh. Concilie a diferença com a documentação; nenhum ajuste de consumo ou compra adicional foi presumido.','monthly');
  const ledger=monthlyCostLedger(unit,month,costRows,'SUPPLIER');r.costVersion=ledger.version;
  if(ledger.status!=='AVAILABLE'||!ledger.version||ledger.blockers.length){need('SPOT_INVOICE','Registre e valide a nota da compra pontual em Custos mensais, categoria Fatura do fornecedor.');return r;}
  const rows=ledger.groups.filter(g=>g.scenario==='ACL').flatMap(g=>g.lines.map(l=>({...l,taxTreatment:g.taxTreatment})));
  if(rows.length!==1||rows[0].category!=='SUPPLIER_INVOICE'||rows[0].effect!=='COST'||!rows[0].source?.trim()){need('SPOT_INVOICE_SCOPE','Esta modalidade exige uma única nota da compra pontual, sem compras extras ou créditos concorrentes. Concilie os documentos.');return r;}
  const invoice=rows[0],expectedTreatment=r.taxTreatment==='RESERVED'?'RESERVED':r.taxTreatment==='GROSS'?'INCLUDED':'EXCLUDED';
  if(invoice.taxTreatment!==expectedTreatment){need('SPOT_TAX','O tratamento tributário da nota difere do preço confirmado. Não presuma isenção ou impostos embutidos.');return r;}
  if(r.taxTreatment==='RESERVED'){need('SPOT_TAX_RESERVATION','Conclua a conciliação com ressalva tributária e justificativa auditada.','supply');r.taxReservation={...r.taxReservation,invoiceReason:invoice.taxReservationReason};r.warnings.push('Tributos não confirmados não são acrescidos. Eventual ICMS confirmado será calculado separadamente na composição operacional. Não representa isenção, imposto zero ou tributo embutido. Justificativa: '+invoice.taxReservationReason);}
  const actual=cents(invoice.amount);r.invoiceAmount=fixed(actual,2);r.invoiceDifference=fixed(actual-expected,2);r.invoiceSources=[invoice];
  if(actual!==expected){need('INVOICE_DIFFERENCE','O valor da nota difere do volume comprado × preço final. Revise as fontes e eventuais ajustes.');return r;}
  if(supplierEvidenceException(r)){
   r.requirements=r.requirements.filter((q:any)=>q.code!=='SPOT_TAX_RESERVATION');
   r.warnings.push('Compra validada excepcionalmente sem nota fiscal: '+invoice.supplierEvidence!.reason+' Origem: '+invoice.supplierEvidence!.reference+' Condição de pagamento: '+invoice.supplierEvidence!.paymentTerms+'. Não comprova emissão da NF nem quitação. Tributos não confirmados permanecem com ressalva.');
  }
  // Allocate only reconciled energy; never relabel purchased volume as measured consumption.
  if(!r.requirements.length){const peakAmount=consumed?(actual*peak+consumed/2n)/consumed:0n;r.bands=[{timeBand:'PEAK',volumeMwh:fixed(peak),amount:fixed(peakAmount,2)},{timeBand:'OFF_PEAK',volumeMwh:fixed(off),amount:fixed(actual-peakAmount,2)}];r.totalAmount=fixed(actual,2);r.status='READY';}
 }catch(e){need('SPOT_CONDITIONS',e instanceof Error?e.message:'Revise a compra pontual.');}
 return r;
}
