import {BackofficeAiService,assistantAiEvidence,financialAiEvidence} from './backoffice-ai.service';
describe('ACL cancellation evidence for AI',()=>{
 it('explains verified zero pairs separately from supplier taxes and omits unreconciled pairs',()=>{
  const financial={state:'RECONCILED',aclCancellation:[{period:'OFF_PEAK',charge:'100.00',credit:'-100.00',balance:'0.00',sources:['tables[0].row1','tables[0].row2'],icmsState:'NOT_SHOWN'}]};
  const plan:any={unitName:'Unit',month:'2026-08',counts:{blockers:0,reviews:0},records:{measurements:{status:'VALIDATED'},costs:{status:'VALIDATED'}},operations:[{invoiceAdjustments:financial}]};
  const evidence=assistantAiEvidence(plan).find(e=>e.id==='acl-cancellation-OFF_PEAK');expect(evidence?.value).toContain('saldo R$ 0,00');expect(evidence?.value).toContain('nota do fornecedor');expect(evidence?.value).toContain('não declara isenção geral');expect(evidence?.source).toContain('row2');
  financial.state='REVIEW_REQUIRED';expect(assistantAiEvidence(plan).some(e=>e.id.startsWith('acl-cancellation-'))).toBe(false);
 });
});
import {PERMISSIONS as P} from '../../common/constants/permissions';
const tenant:any={scope:'organization',organizationId:'org-a',userId:'actor',role:'operacional',permissions:[P.INTELLIGENCE_AI_USE]};
const evidence=[{id:'e1',label:'Consumo',value:'123',source:'p1'}];
const generated={supported:true,answer:'Confira o consumo.',citations:['e1'],fields:[],doubts:[],model:'test',promptVersion:'v1',usage:{inputTokens:100,outputTokens:20}};
function fixture(){const connector={available:jest.fn(()=>true),interpret:jest.fn(async()=>generated)},audit={logCreate:jest.fn(async()=>{})};const budget={reserve:jest.fn(async()=>({id:'r'})),settle:jest.fn(async()=>{})};return {connector,audit,budget,service:new BackofficeAiService(connector as any,audit as any,budget as any)};}
describe('Backoffice generative authorization and audit',()=>{
 it.each(['cliente','consulta','admin_platform'])('rejects %s before transmission',async role=>{const f=fixture();const r=await f.service.interpret({...tenant,role},'Pergunta',evidence);expect(r.state).toBe('NOT_AUTHORIZED');expect(f.connector.interpret).not.toHaveBeenCalled();expect(f.audit.logCreate).not.toHaveBeenCalled();});
 it('rejects missing permission, global scope and disabled configuration',async()=>{const f=fixture();expect((await f.service.interpret({...tenant,permissions:[]},'Pergunta',evidence)).state).toBe('NOT_AUTHORIZED');expect((await f.service.interpret({...tenant,scope:'global'},'Pergunta',evidence)).state).toBe('NOT_AUTHORIZED');f.connector.available.mockReturnValue(false);expect((await f.service.interpret(tenant,'Pergunta',evidence)).state).toBe('NOT_CONFIGURED');expect(f.connector.interpret).not.toHaveBeenCalled();});
 it('records actor, source hash, model, prompt version and result; never approves or writes financial records',async()=>{const f=fixture(),r=await f.service.interpret(tenant,'Pergunta',evidence,'doc');expect(r.state).toBe('READY');expect(f.audit.logCreate).toHaveBeenCalledTimes(2);const entry=(f.audit.logCreate.mock.calls as any[][])[1][0];expect(entry.organizationId).toBe('org-a');expect(entry.userId).toBe('actor');expect(entry.after.documentId).toBe('doc');expect(entry.after.evidenceHash).toHaveLength(64);expect(entry.after.model).toBe('test');expect(entry.after.answer).toBe(generated.answer);expect(JSON.stringify(entry)).not.toContain('synthetic-key');});
 it('does not transmit when monthly reservation fails',async()=>{const f=fixture();f.budget.reserve.mockRejectedValueOnce(Error('budget'));expect((await f.service.interpret(tenant,'Pergunta',evidence)).state).toBe('FAILED');expect(f.connector.interpret).not.toHaveBeenCalled();});
 it('does not transmit when durable audit cannot record intent',async()=>{const f=fixture();f.audit.logCreate.mockRejectedValueOnce(Error('database'));expect((await f.service.interpret(tenant,'Pergunta',evidence)).state).toBe('FAILED');expect(f.connector.interpret).not.toHaveBeenCalled();});
 it('limits repeated requests per actor and does not share limits/results with other organizations',async()=>{const f=fixture();for(let i=0;i<6;i++)await f.service.interpret(tenant,'Pergunta',evidence);expect((await f.service.interpret(tenant,'Pergunta',evidence)).state).toBe('FAILED');expect((await f.service.interpret({...tenant,organizationId:'org-b'},'Pergunta',evidence)).state).toBe('READY');});
 it('builds an allowlisted evidence pack without raw files, storage URLs or configuration secrets',()=>{const plan:any={unitName:'Unit',month:'2026-08',counts:{blockers:1,reviews:0},fieldTasks:[],findings:[],comparisons:[],configurations:[],records:{measurements:{status:'DRAFT'},costs:{status:'DRAFT'}},raw:'SECRET',signedUrl:'https://private.test/token',credentials:'SECRET'};const e=assistantAiEvidence(plan);expect(JSON.stringify(e)).not.toContain('SECRET');expect(JSON.stringify(e)).not.toContain('private.test');});
 it('includes scoped calculated amounts and pending status without turning subtotals into published savings',()=>{
  const evidence=financialAiEvidence({supplier:{status:'PENDING',formulaVersion:'contract-supplier-1.0',contract:{number:'C1',start:'2026-01-01',end:'2026-12-31',privateNotes:'SECRET'},pricePerMwh:'250.00',invoiceDifference:'-10.00',totalAmount:null,raw:'SECRET'},managementFees:{status:'VARIABLE_PENDING',fixedUnit:'100.00',totalFee:'999.00',formulaVersion:'management-per-unit-1.0'},distributor:{formulaVersion:'distributor-subtotal-1.2',scenarios:[{scenario:'ACL',status:'AVAILABLE',subtotal:'300.00'},{scenario:'ACR',status:'BLOCKED',subtotal:'400.00'}]}});
  expect(evidence.find(e=>e.id==='supplier-invoiceDifference')?.value).toBe('-10.00');
  expect(evidence.find(e=>e.id==='supplier-invoiceDifference')?.source).toContain('PENDING');
  expect(evidence.find(e=>e.id==='management-pending')?.value).toContain('consolidação');
  expect(evidence.some(e=>e.id==='management-total'||e.id==='distributor-ACR')).toBe(false);
  expect(evidence.find(e=>e.id==='distributor-ACL')?.source).toContain('não é custo total');
  expect(JSON.stringify(evidence)).not.toContain('SECRET');
 });
 it('excludes blocked calculation amounts and non-decimal values',()=>{
  expect(financialAiEvidence({supplier:{status:'BLOCKED',totalAmount:'100.00'},managementFees:{status:'BLOCKED',fixedUnit:'20.00'},distributor:{scenarios:[{scenario:'ACL',status:'AVAILABLE',subtotal:'NaN'}]}})).toEqual([]);
 });
});
