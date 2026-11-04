import {randomUUID} from 'crypto';
import {fileBatch,workflowBody,TradingWorkflowService} from './trading-workflow.service';
import * as mail from './trading-mail';
import {sendWorkflowNotice} from './trading-workflow-delivery';
import {TradingSupplierFileAuthorization} from './trading-workflow.controller';
describe('Trading approval identity, replay and file boundaries',()=>{
 it('rejects a revoked supplier session before multipart buffering starts',async()=>{const files=jest.fn().mockRejectedValue(new Error('Revoked')),handle=jest.fn();const guard=new TradingSupplierFileAuthorization({files} as any);await expect(guard.intercept({switchToHttp:()=>({getRequest:()=>({headers:{'x-trading-session':'invalid'}})})} as any,{handle} as any)).rejects.toThrow('Revoked');expect(handle).not.toHaveBeenCalled();expect(files).toHaveBeenCalledWith(null,null,'invalid','CONTEXT',null,{});});
 const id=randomUUID(),request=randomUUID(),input={action:'SEND_CLIENT',revision:1,requestId:request,reason:'Conferência da proposta',data:{recipientId:randomUUID(),hours:4,confirmed:true}};
 it('accepts 4/8 hours and denies unexpected fields, false confirmations and stale revisions',()=>{
  expect(workflowBody(input).data.hours).toBe(4);expect(workflowBody({...input,data:{...input.data,hours:8}}).data.hours).toBe(8);
  for(const b of [{...input,organizationId:'foreign'},{...input,revision:0},{...input,data:{...input.data,hours:5}},{...input,data:{...input.data,confirmed:false}},{...input,data:{...input.data,tokenHash:'x'}}])expect(()=>workflowBody(b)).toThrow();
 });
 it('separates portal decisions from internal approval even with extra DTO flags',()=>{expect(()=>workflowBody(input,true)).toThrow();const c={action:'CLIENT_APPROVE',revision:1,requestId:request,reason:'Conferência pelo cliente',data:{confirmed:true}};expect(workflowBody(c,true).action).toBe('CLIENT_APPROVE');expect(()=>workflowBody(c,false)).toThrow();expect(()=>workflowBody({...c,data:{confirmed:true,role:'admin_org'}},true)).toThrow();});
 it('identifies PDFs from bytes, sanitizes names and bounds the aggregate rather than each file independently',()=>{
  const pdf=Buffer.from('%PDF-1.7\nfixture\n%%EOF');const f=fileBatch([{originalname:'../../proposal.exe',buffer:pdf}])[0];expect(f.mime).toBe('application/pdf');expect(f.name).not.toContain('/');expect(f.name.endsWith('.pdf')).toBe(true);expect(f.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(()=>fileBatch([{buffer:Buffer.from('not a PDF file'),originalname:'invoice.pdf'}])).toThrow();
  expect(()=>fileBatch([{buffer:Buffer.alloc(11*1024*1024)},{buffer:Buffer.alloc(10*1024*1024)}])).toThrow(/20 MB/);
  expect(()=>fileBatch([])).toThrow();expect(()=>fileBatch(Array.from({length:21},()=>({buffer:pdf})))).toThrow();
 });
 it('does not trust an organization from the form and denies external users on the backoffice path',async()=>{
  const hub={allowed:jest.fn().mockRejectedValue(new Error('Denied'))},db={createAuthClient:jest.fn()};const s=new TradingWorkflowService(db as any,hub as any);
  await expect(s.act({organizationId:'org_default',userId:'external',role:'consulta'} as any,id,input)).rejects.toThrow('Denied');expect(db.createAuthClient).not.toHaveBeenCalled();
  await expect(s.act({organizationId:'foreign',userId:'a',role:'admin_org'} as any,id,input)).rejects.toThrow();
 });
 it('never sends the supplier email again when an ambiguous request is replayed',async()=>{
  const spy=jest.spyOn(mail,'sendTradingMail').mockResolvedValue('provider-test');jest.spyOn(mail,'tradingMailConfigured').mockReturnValue(true);
  const rpc=jest.fn().mockResolvedValue({data:{organizationId:'org_default',id,proposalId:id,state:'SUPPLIER_PENDING',replayed:true}}),s=new TradingWorkflowService({createAuthClient:()=>({rpc})} as any,{allowed:jest.fn()} as any);
  const result=await s.act({organizationId:'org_default',userId:'admin',role:'admin_org',roleId:'r'} as any,id,{action:'NOTIFY_SUPPLIER',revision:1,requestId:request,reason:'Confirmação do destinatário',data:{email:'supplier@example.test',confirmed:true}});
  expect(result.delivery.state).toBe('UNKNOWN');expect(spy).not.toHaveBeenCalled();expect(rpc.mock.calls[0][1].p_actor).toBe('admin');jest.restoreAllMocks();
 });
 it('does not download a file whose authenticated metadata points outside its workflow',async()=>{
  const storage=jest.fn(),s=new TradingWorkflowService({createAuthClient:()=>({rpc:jest.fn().mockResolvedValue({data:{path:'foreign/file',organization_id:'org_default',workflow_id:id}}),storage})} as any,{allowed:jest.fn()} as any);
  await expect(s.download({organizationId:'org_default',userId:'a',role:'admin_org'} as any,id,null,randomUUID())).rejects.toThrow();expect(storage).not.toHaveBeenCalled();
 });
 it('requires a verified WhatsApp template and preserves an uncertain provider outcome without retrying',async()=>{
  const transport=jest.fn(),d={id,channel:'WHATSAPP',destination:'+5516999999999',title:'Urgent',href:'/portal'};
  expect((await sendWorkflowNotice(d,undefined,transport)).state).toBe('FAILED');expect(transport).not.toHaveBeenCalled();
  transport.mockRejectedValueOnce(new Error('timeout'));const r=await sendWorkflowNotice(d,{configured:true,rows:[{name:'energyos_proposta_urgente',status:'APPROVED',parameterless:true}]} as any,transport);expect(r.state).toBe('UNKNOWN');expect(transport).toHaveBeenCalledTimes(1);
 });
});
