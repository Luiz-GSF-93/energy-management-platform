import {applyOperationalCceeReview} from './eva-operational-flow.model';
const hash='a'.repeat(64),newHash='b'.repeat(64);
function fixture(){
 const report:any={scope:{kind:'UNIT'},month:'2026-10',units:[{id:'unit',name:'Unit',sources:{cceeLocal:{candidates:[{mapVersion:'MAP_1',eventCode:'event',sourceHash:newHash}]}},missing:[]}],missing:[],pendingActions:[],observations:[],preparationPolicy:{reservations:[]},financial:{status:'AVAILABLE',aclBeforeFees:'100.00'},approvalEligible:true,completeness:'COMPLETE'};
 const cost:any={id:'cost',consumer_unit_id:'unit',month:'2026-10',version:1,revision:8,costs:{items:[{category:'CCEE',amount:'100.00',source:'Política auditada de alocação automática: MAP_1 event '+hash}]}};
 const ack={costId:'cost',revision:8,costHash:hash,actor:'operator',at:'2026-11-24T20:00:00Z',reason:'Cobertura e valores conferidos nesta competência.'};
 const sources:any={financial:{tables:{calculation_monthly_costs:[cost]}},operationalFlow:{enabled:true,costAcks:[{unitId:'unit',ack}],costRows:[{id:'cost',unitId:'unit',costHash:hash}]}};
 return {report,cost,ack,sources};
}
describe('persisted CCEE review releases the same question',()=>{
 it('preserves the current human review when an API reference differs, without replacing a cost or approving',()=>{
  const x=fixture(),costBefore=JSON.stringify(x.cost),ackBefore=JSON.stringify(x.ack);applyOperationalCceeReview(x.report,x.sources);
  expect(x.report.missing).toEqual([]);expect(x.report.pendingActions).toEqual([]);expect(x.report.financial).toEqual({status:'AVAILABLE',aclBeforeFees:'100.00'});
  expect(x.report.units[0].sources.cceeCoverageReview).toMatchObject({...x.ack,apiReferenceChanged:true});
  expect(x.report.preparationPolicy.reservations).toEqual([expect.objectContaining({code:'CCEE_REVIEWED_API_REFERENCE',unitId:'unit'})]);
  expect(x.report.observations[0]).toContain('não houve atualização automática');
  expect(x.report.completeness).toBe('ESTIMATED');expect(x.report).not.toHaveProperty('automaticApproval',true);
  expect(JSON.stringify(x.cost)).toBe(costBefore);expect(JSON.stringify(x.ack)).toBe(ackBefore);
 });
 it('does not reuse a review after the actual cost revision/content changed',()=>{
  const x=fixture();x.cost.revision=9;x.sources.operationalFlow.costRows[0].costHash=newHash;applyOperationalCceeReview(x.report,x.sources);
  expect(x.report.pendingActions).toEqual([expect.objectContaining({code:'CCEE_COVERAGE'})]);expect(x.report.approvalEligible).toBe(false);expect(x.report.financial.status).toBe('INCOMPLETE');
 });
 it('accepts an unchanged cost hash when only nonfinancial row metadata advanced',()=>{
  const x=fixture();x.cost.revision=9;applyOperationalCceeReview(x.report,x.sources);expect(x.report.missing).toEqual([]);
 });
 it.each(['missing','other-cost','other-unit'])('never releases an unrelated or missing acknowledgement: %s',kind=>{
  const x=fixture();if(kind==='missing')x.sources.operationalFlow.costAcks=[];else if(kind==='other-cost')x.ack.costId='other';else x.sources.operationalFlow.costAcks[0].unitId='other';
  applyOperationalCceeReview(x.report,x.sources);expect(x.report.approvalEligible).toBe(false);expect(x.report.missing).toHaveLength(1);
 });
});
