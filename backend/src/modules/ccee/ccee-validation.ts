import type {PldHour} from './ccee-response';
import type {CceeBinding,CceeNormalizedRecord} from './ccee-normalizer';
export function validateCceePld(rows:PldHour[],month:string){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new Error('CCEE_INVALID_MONTH');
 const [year,number]=month.split('-').map(Number),hours=new Date(Date.UTC(year,number,0)).getUTCDate()*24;
 const first=Date.parse(month+'-01T00:00:00-03:00');
 if(rows.length!==hours*4)throw new Error('CCEE_INCOMPLETE_MONTH');
 for(const submarket of ['SE_CO','S','NE','N'] as const){
  const selected=rows.filter(row=>row.submarket===submarket).sort((a,b)=>a.start.localeCompare(b.start));
  if(selected.length!==hours||selected.some((row,i)=>Date.parse(row.start)!==first+i*3600000||!Number.isFinite(row.value)||row.value<0))throw new Error('CCEE_INCOMPLETE_MONTH');
 }
 return rows;
}
export function validateCceeRecord(record:CceeNormalizedRecord,authorized:CceeBinding){
 const bindingKeys=['organizationId','customerId','unitId','profileCode','measurementPoint','authorizationId','authorizationRevision'];
 if(!record||record.schemaVersion!=='ccee-record/1'||!record.binding||!authorized||bindingKeys.some(key=>!Object.prototype.hasOwnProperty.call(authorized,key)||record.binding[key as keyof CceeBinding]!==authorized[key as keyof CceeBinding])||Object.values(authorized).some(v=>v===null||v===undefined||v==='')||!Number.isSafeInteger(authorized.authorizationRevision)||authorized.authorizationRevision<1)throw new Error('CCEE_BINDING_MISMATCH');
 if(!['CONSUMPTION','CHARGE','FEE','CREDIT','SHORT_TERM_MARKET','AGENDA','OTHER'].includes(record.kind))throw new Error('CCEE_UNSUPPORTED_KIND');
 const e=record.evidence;
 if(!e||e.provider!=='CCEE'||!e.externalId||!e.revision||!e.service||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.month)||! /^[a-f0-9]{64}$/.test(e.sourceHash)||!Number.isFinite(Date.parse(e.retrievedAt))||!['PROVISIONAL','FINAL'].includes(e.finality)||!Array.isArray(record.lines)||record.lines.length<1||record.lines.length>10000)throw new Error('CCEE_EVIDENCE_REQUIRED');
 const ids=new Set<string>();
 for(const line of record.lines){
  if(!line||record.kind==='AGENDA'&&line.type!=='AGENDA'||record.kind==='CONSUMPTION'&&line.type!=='CONSUMPTION'||['CHARGE','FEE','CREDIT','SHORT_TERM_MARKET'].includes(record.kind)&&line.type!=='MONEY'||record.kind==='CREDIT'&&line.type==='MONEY'&&line.effect!=='CREDIT')throw new Error('CCEE_LINE_KIND_MISMATCH');
  if(!line.code||ids.has(line.code))throw new Error('CCEE_DUPLICATE_LINE');ids.add(line.code);
  if(line.type==='CONSUMPTION'){if(!/^\d{1,15}(\.\d{1,6})?$/.test(line.quantityKwh)||!['PEAK','OFF_PEAK','ALL'].includes(line.timeBand)||![true,false,null].includes(line.includesLosses))throw new Error('CCEE_INVALID_CONSUMPTION');}
  else if(line.type==='MONEY'){if(!/^\d{1,12}(\.\d{1,2})?$/.test(line.amountBrl)||!['DEBIT','CREDIT'].includes(line.effect)||!['NET','GROSS','UNKNOWN'].includes(line.taxTreatment)||!['CCEE','CHARGE','EXPOSURE','OTHER'].includes(line.category))throw new Error('CCEE_INVALID_AMOUNT');}
  else if(line.type==='AGENDA'){if(line.timezone!=='America/Sao_Paulo'||!line.title||!Number.isFinite(Date.parse(line.startsAt))||Date.parse(line.endsAt)<Date.parse(line.startsAt)||!Number.isFinite(Date.parse(line.endsAt)))throw new Error('CCEE_INVALID_AGENDA');}
  else throw new Error('CCEE_UNSUPPORTED_LINE');
 }
 return {record,state:e.finality==='FINAL'&&!record.lines.some(l=>l.type==='MONEY'&&l.taxTreatment==='UNKNOWN')?'READY_FOR_REVIEW':'PENDING',calculationAllowed:false,requiresHumanReview:true};
}
