import {createHash} from 'node:crypto';
import type {MonthlyCostDto} from '../contracts/dto/monthly-costs.dto';
import type {MonthlyInputDto} from '../contracts/dto/monthly-inputs.dto';
import type {CceeBinding,CceeNormalizedRecord} from './ccee-normalizer';
import {validateCceeRecord} from './ccee-validation';

const identity=(value:unknown)=>{const h=createHash('sha256').update(JSON.stringify(value)).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
// This is a draft adapter for the existing monthly readers/validators/engine.
// It never calculates savings, adds taxes/losses, or writes approved versions.
export function cceeCalculationDraft(record:CceeNormalizedRecord,binding:CceeBinding):{type:'COSTS';draft:MonthlyCostDto}|{type:'MEASUREMENTS';draft:MonthlyInputDto}{
 const validated=validateCceeRecord(record,binding);
 if(validated.state!=='READY_FOR_REVIEW')throw new Error('CCEE_CALCULATION_REVIEW_REQUIRED');
 const e=record.evidence,source='CCEE · '+e.service+' · '+e.externalId+' · revisão '+e.revision+' · hash '+e.sourceHash;
 const base={consumerUnitId:binding.unitId,month:e.month,sourceReference:source,notes:'Importação CCEE para conferência. Preservar versões existentes e conciliar com documentos manuais antes de validar.',correctionReason:'Dados da fonte CCEE recebidos para revisão.'};
 if(record.kind==='AGENDA')throw new Error('CCEE_AGENDA_NOT_FINANCIAL');
 if(record.kind==='CONSUMPTION'){
  const measurements:MonthlyInputDto['measurements']={};
  for(const line of record.lines){
   if(line.type!=='CONSUMPTION'||line.includesLosses!==false)throw new Error('CCEE_MEASUREMENT_LOSSES_REQUIRE_REVIEW');
   const key=line.timeBand==='ALL'?'consumptionTotal':line.timeBand==='PEAK'?'consumptionPeak':'consumptionOffPeak';
   if(measurements[key]!==undefined)throw new Error('CCEE_DUPLICATE_TIME_BAND');
   measurements[key]=line.quantityKwh;
  }
  // Never infer a missing peak/off-peak partition from total consumption.
  return {type:'MEASUREMENTS',draft:{...base,measurements}};
 }
 if(record.lines.length>100)throw new Error('CCEE_COST_BATCH_TOO_LARGE');
 const items=record.lines.map(line=>{
  if(line.type!=='MONEY'||line.taxTreatment!=='GROSS')throw new Error('CCEE_GROSS_COST_REQUIRED');
  return {id:identity([binding,e.externalId,e.revision,e.sourceHash,line.code]),label:line.code,category:line.category,scenario:'ACL',effect:line.effect==='CREDIT'?'CREDIT':'COST',amount:line.amountBrl,source,taxTreatment:'INCLUDED'};
 });
 return {type:'COSTS',draft:{...base,costs:{items,noCosts:false}}};
}
