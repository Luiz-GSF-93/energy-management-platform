import {OcrQueueService} from './ocr-queue.service';
import {OcrController} from './ocr.controller';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
import 'reflect-metadata';
const requestId='10000000-0000-4000-8000-000000000001';
const t:any={organizationId:'org',userId:'actor',roleId:'role',role:'admin_org',permissions:[P.DOCUMENTS_VIEW,P.ENERGIA_OCR_PROCESS]};
function setup(){
 const proof={state:'MATCH',fileHash:'a'.repeat(64),checks:{unit:'MATCH',taxId:'MATCH',address:'MATCH',period:'MATCH'}};
 const capture={eligible:true,customerId:'customer',unitId:'unit',registration:{unitNumber:'16873262'},job:{id:'job',fileHash:proof.fileHash,updatedAt:'2026-01-01'}};
 const rpc=jest.fn(async(_name:string,args:any):Promise<any>=>({data:args.p_action==='inspect'?structuredClone(capture):{jobId:'job',state:'QUEUED'},error:null}));
 const licenses={requireEntitlement:jest.fn(async()=>{})},connector={isConfigured:jest.fn(()=>true),submit:jest.fn()},source={invoiceIdentity:jest.fn(async()=>structuredClone(proof))};
 const service=new OcrQueueService({getClient:()=>({rpc})} as any,licenses as any,connector as any,source as any);
 return {service,rpc,licenses,connector,source,capture,proof};
}
describe('audited pre-submission identity resume',()=>{
 beforeEach(()=>{process.env.OCR_IDENTITY_RESUME_ENABLED='true';});
 afterEach(()=>{delete process.env.OCR_IDENTITY_RESUME_ENABLED;});
 it('is off by default without reading sources or calling providers',async()=>{delete process.env.OCR_IDENTITY_RESUME_ENABLED;const s=setup();expect(await s.service.identityResumePreview('doc',t)).toEqual({enabled:false,eligible:false});await expect(s.service.identityResume('doc',t,{})).rejects.toThrow();expect(s.rpc).not.toHaveBeenCalled();expect(s.source.invoiceIdentity).not.toHaveBeenCalled();});
 it('requires OCR permission on both routes',()=>{expect(Reflect.getMetadata(PERMISSIONS_KEY,OcrController.prototype.identityResume)).toEqual([P.ENERGIA_OCR_PROCESS]);expect(Reflect.getMetadata(PERMISSIONS_KEY,OcrController.prototype.identityResumePreview)).toEqual([P.ENERGIA_OCR_PROCESS]);});
 it('denies external/view-only roles before accessing the source',async()=>{const s=setup();await expect(s.service.identityResumePreview('doc',{...t,role:'consulta'})).rejects.toThrow();await expect(s.service.identityResumePreview('doc',{...t,permissions:[P.DOCUMENTS_VIEW]})).rejects.toThrow();expect(s.rpc).not.toHaveBeenCalled();});
 it('stops when entitlement or provider configuration is unavailable',async()=>{const s=setup();s.connector.isConfigured.mockReturnValue(false);await expect(s.service.identityResumePreview('doc',t)).rejects.toThrow();expect(s.rpc).not.toHaveBeenCalled();});
 it('does not extract or offer resume for an ineligible job',async()=>{const s=setup();s.capture.eligible=false;expect((await s.service.identityResumePreview('doc',t)).eligible).toBe(false);expect(s.source.invoiceIdentity).not.toHaveBeenCalled();});
 it('requires a current complete MATCH with the original hash',async()=>{const s=setup();s.proof.checks.unit='REVIEW';expect((await s.service.identityResumePreview('doc',t)).eligible).toBe(false);s.proof.checks.unit='MATCH';s.proof.fileHash='b'.repeat(64);expect((await s.service.identityResumePreview('doc',t)).eligible).toBe(false);});
 it('previews without queueing, then recaptures and sends only the audited RPC',async()=>{const s=setup();const p=await s.service.identityResumePreview('doc',t);expect(p.eligible).toBe(true);expect(p).not.toHaveProperty('proof');expect(s.rpc.mock.calls[0][1]).toMatchObject({p_org:'org',p_actor:'actor',p_document:'doc',p_action:'inspect'});await s.service.identityResume('doc',t,{requestId,token:(p as any).token,reason:'Instalação corrigida por edição auditada.',acknowledge:true});expect(s.source.invoiceIdentity).toHaveBeenCalledTimes(2);expect(s.rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_action:'resume',p_request:requestId,p_proof:s.proof});expect(s.connector.submit).not.toHaveBeenCalled();});
 it('rejects stale snapshots and missing explicit confirmation',async()=>{const s=setup();const p:any=await s.service.identityResumePreview('doc',t);const b={requestId,token:p.token,reason:'Instalação corrigida por edição auditada.',acknowledge:true};await expect(s.service.identityResume('doc',t,{...b,acknowledge:false})).rejects.toThrow();s.capture.job.updatedAt='changed';await expect(s.service.identityResume('doc',t,b)).rejects.toThrow();expect(s.rpc.mock.calls.every(c=>c[1].p_action==='inspect')).toBe(true);});
 it('does not retry or disclose database errors after an uncertain RPC',async()=>{const s=setup();const p:any=await s.service.identityResumePreview('doc',t);s.rpc.mockImplementation(async(_n,args)=>args.p_action==='inspect'?{data:s.capture,error:null}:{data:null,error:{code:'08006',message:'private database detail'}});await expect(s.service.identityResume('doc',t,{requestId,token:p.token,reason:'Instalação corrigida por edição auditada.',acknowledge:true})).rejects.toThrow('Retomada não confirmada');expect(s.rpc.mock.calls.filter(c=>c[1].p_action==='resume')).toHaveLength(1);expect(s.connector.submit).not.toHaveBeenCalled();});
});
