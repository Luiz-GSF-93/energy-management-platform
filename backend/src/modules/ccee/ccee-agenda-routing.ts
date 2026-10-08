import {createHash} from 'node:crypto';
import {CceeBinding,CceeNormalizedRecord} from './ccee-normalizer';
import {validateCceeRecord} from './ccee-validation';
import {OperationWriteDto} from '../operations/operations.dto';

// Provider adapters call this only after resolving the private unit authorization.
// The resulting drafts still pass through OperationsService.save (RBAC, plan,
// customer/unit ownership, responsible membership, audit and idempotency).
export function cceeAgendaDrafts(record:CceeNormalizedRecord,binding:CceeBinding,responsibleId:string):OperationWriteDto[]{
 const validated=validateCceeRecord(record,binding);
 if(record.kind!=='AGENDA'||validated.state!=='READY_FOR_REVIEW'||!responsibleId)throw new Error('CCEE_AGENDA_REVIEW_REQUIRED');
 return record.lines.map(line=>{
  if(line.type!=='AGENDA'||line.title.length>160||Date.parse(line.endsAt)<=Date.parse(line.startsAt))throw new Error('CCEE_INVALID_AGENDA');
  const hex=createHash('sha256').update(JSON.stringify([binding,record.evidence.externalId,record.evidence.revision,record.evidence.sourceHash,line.code])).digest('hex');
  const requestId=hex.slice(0,8)+'-'+hex.slice(8,12)+'-5'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
  return {requestId,revision:0,reason:'Agenda CCEE conferida para acompanhamento do fechamento mensal.',title:line.title,description:'Fonte CCEE: '+record.evidence.service+' · registro '+record.evidence.externalId+' · revisão '+record.evidence.revision+' · competência '+record.evidence.month+' · hash '+record.evidence.sourceHash+'. Confirmar o cumprimento do prazo no sistema de origem; o aviso não comprova fechamento.',priority:'HIGH',customerId:binding.customerId,unitId:binding.unitId,responsibleId,startsAt:line.startsAt,endsAt:line.endsAt,dueAt:line.endsAt};
 });
}
