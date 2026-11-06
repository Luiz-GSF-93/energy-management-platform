import {applyOperationalCceeReview,operationalBindingState,operationalReviewReceipt} from './eva-operational-flow.model';
describe('operational closing scope and coverage',()=>{
 const run={organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',month:'2026-01'};
 const binding={id:'binding',organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',status:'APPROVED',revision:2,valid_from:'2025-01-01',valid_to:null,service_scope:['DRI_READ']};
 it('reuses only the same organization, customer, unit and whole-month authorization',()=>{
  expect(operationalBindingState(binding,null,run,{id:'unit'}).state).toBe('AUTHORIZED');
  for(const difference of [{organization_id:'other'},{customer_id:'other'},{consumer_unit_id:'other'},{status:'REVOKED'},{valid_from:'2026-01-02'},{valid_to:'2026-01-30'}])expect(operationalBindingState({...binding,...difference},null,run,{id:'unit'}).state).not.toBe('AUTHORIZED');
 });
 it('identifying a CNPJ is not private authorization and never blocks documents',()=>{
  const r=operationalBindingState(null,{state:'REPRESENTATION_PENDING',taxId:'12345678000100',result:{participant:{agentCode:'123'}}},run,{id:'unit'});
  expect(r.candidate?.requiresIndependentReview).toBe(true);expect(r.financialDocumentFlowAllowed).toBe(true);expect(r.state).not.toBe('AUTHORIZED');
 });
 it('reconciles a write only by exact invoice source and unit scope',()=>{
  const document={id:'doc',fileHash:'a'.repeat(64)},row={...run,organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',month:'2026-01',state:'INCOMPLETE',report:{scope:{kind:'UNIT'},unitIds:['unit'],units:[{id:'unit',documentId:'doc',sourceHash:document.fileHash}]}};
  expect(operationalReviewReceipt(row,run,document)).toBe(true);
  expect(operationalReviewReceipt({...row,organization_id:'other'},run,document)).toBe(false);
  expect(operationalReviewReceipt(row,run,{...document,fileHash:'b'.repeat(64)})).toBe(false);
  expect(operationalReviewReceipt({...row,report:{...row.report,unitIds:['unit','other']}},run,document)).toBe(false);
 });
 function coverage(){return{report:{scope:{kind:'UNIT'},month:'2026-01',units:[{id:'unit',name:'Unit',missing:[]}],missing:[],pendingActions:[],financial:{status:'AVAILABLE',acr:'100.00',aclBeforeFees:'80.00'},approvalEligible:true,completeness:'COMPLETE'},sources:{operationalFlow:{enabled:true,costAcks:[] as any[]},financial:{tables:{calculation_monthly_costs:[{id:'cost',consumer_unit_id:'unit',month:'2026-01',version:1,revision:2,costs:{items:[{category:'CCEE',source:'Política auditada de alocação automática: source'}]}}]}}}};}
 it('a partial mapped API cost cannot silently imply all charges are complete',()=>{const {report,sources}=coverage();applyOperationalCceeReview(report,sources);expect(report.approvalEligible).toBe(false);expect(report.financial.status).toBe('INCOMPLETE');expect(report.pendingActions).toEqual([expect.objectContaining({code:'CCEE_COVERAGE',unitId:'unit'})]);});
 it('a previous cost revision acknowledgment cannot authorize a changed amount',()=>{const {report,sources}=coverage();sources.operationalFlow.costAcks=[{unitId:'unit',ack:{costId:'cost',revision:1}}];applyOperationalCceeReview(report,sources);expect(report.approvalEligible).toBe(false);});
 it('accepts the explicit acknowledgment only for the current unit and cost revision',()=>{const {report,sources}=coverage();sources.operationalFlow.costAcks=[{unitId:'unit',ack:{costId:'cost',revision:2}}];applyOperationalCceeReview(report,sources);expect(report.approvalEligible).toBe(true);});
 it('preserves an acknowledgment after status-only validation, but not a changed financial digest',()=>{
  const {report,sources}=coverage();sources.operationalFlow.costAcks=[{unitId:'unit',ack:{costId:'cost',revision:1,costHash:'a'.repeat(64)}}];
  (sources.operationalFlow as any).costRows=[{id:'cost',unitId:'unit',costHash:'a'.repeat(64)}];applyOperationalCceeReview(report,sources);expect(report.approvalEligible).toBe(true);
  (sources.operationalFlow as any).costRows[0].costHash='b'.repeat(64);applyOperationalCceeReview(report,sources);expect(report.approvalEligible).toBe(false);
 });
 it('does not change legacy or consolidated calculations',()=>{const {report,sources}=coverage();report.scope.kind='CUSTOMER';const before=JSON.stringify(report);applyOperationalCceeReview(report,sources);expect(JSON.stringify(report)).toBe(before);});
});
