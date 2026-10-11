import {SalesSignatureService} from './sales-signature.service';
import {SalesSignatureController} from './sales-signature.controller';
import {BadRequestException,ServiceUnavailableException} from '@nestjs/common';
import {Reflector} from '@nestjs/core';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
import {signatureEnvelope,signatureEnvelopeStatus,signatureWebhookHash,verifySignatureWebhook,signaturePdfHash,CLICKSIGN_SANDBOX_API} from './sales-signature-protocol';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const body={id,draftId:id,draftSha256:'a'.repeat(64),justification:'Private sandbox preparation fixture.'};
describe('Clicksign private sandbox preparation',()=>{
 let service:SalesSignatureService,rpc:jest.Mock;
 beforeEach(()=>{rpc=jest.fn().mockResolvedValue({id});service=new SalesSignatureService({rpc} as any,{get:()=> 'true'} as any);});
 it.each([undefined,'false','TRUE'])('defaults off: %s',flag=>{service=new SalesSignatureService({rpc} as any,{get:()=>flag} as any);expect(()=>service.prepare(id,body)).toThrow(ServiceUnavailableException);expect(()=>service.read(id,id)).toThrow(ServiceUnavailableException);expect(()=>service.list(id,{})).toThrow(ServiceUnavailableException);expect(rpc).not.toHaveBeenCalled();});
 it('uses authenticated actor and repeats exact original preparation',async()=>{await service.prepare(id,body);await service.prepare(id,body);expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);expect(rpc).toHaveBeenCalledWith('platform_sales_signature_action',{p_actor:id,p_action:'prepare',p_body:body});});
 it.each([{actor:id},{provider:'OTHER'},{environment:'PRODUCTION'},{signed:true},{draftSha256:'forged'},{justification:'\n'.repeat(30)}])('rejects spoofed source: %j',extra=>{expect(()=>service.prepare(id,{...body,...extra})).toThrow(BadRequestException);expect(rpc).not.toHaveBeenCalled();});
 it.each([{page:'-1'},{page:'1001'},{status:'SIGNED'},{search:{}},{actor:id}])('rejects forged filters %j',q=>expect(()=>service.list(id,q)).toThrow(BadRequestException));
 it('every route is Owner only and non-cacheable',()=>{const r=new Reflector();for(const key of ['list','read','prepare','withdraw','creation','next'] as const){expect(r.get(PERMISSIONS_KEY,SalesSignatureController.prototype[key])).toEqual(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']);expect(r.get('__headers__',SalesSignatureController.prototype[key])).toContainEqual({name:'Cache-Control',value:'no-store'});}});
});
describe('Clicksign protocol — simulated responses only',()=>{
 it('constructs explicit test envelope and has no production endpoint',()=>{expect(CLICKSIGN_SANDBOX_API).toBe('https://sandbox.clicksign.com/api/v3');expect(signatureEnvelope(id).data.attributes.name).toContain('HOMOLOGAÇÃO');expect(()=>signatureEnvelope('../credential')).toThrow();});
 it.each(['draft','running','closed','canceled'])('normalizes %s without declaring accepted signatures',status=>{const v=signatureEnvelopeStatus({data:{id,type:'envelopes',attributes:{status}}},id);expect(v).toEqual({externalId:id,status,environment:'SANDBOX',realActivationEligible:false});expect(v).not.toHaveProperty('signed');});
 it.each([{data:{id:'other',type:'envelopes',attributes:{status:'closed'}}},{data:{id,type:'documents',attributes:{status:'closed'}}},{data:{id,type:'envelopes',attributes:{status:'unknown'}}},null])('rejects divergent simulated response',v=>expect(()=>signatureEnvelopeStatus(v,id)).toThrow());
 it('validates HMAC against original bytes, not reparsed JSON',()=>{const raw=Buffer.from('{"event":"signed", "id":"fixture"}'),secret='fixture-secret-only';const header='sha256='+signatureWebhookHash(raw,secret);expect(verifySignatureWebhook(raw,header,secret)).toBe(true);expect(verifySignatureWebhook(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))),header,secret)).toBe(false);expect(verifySignatureWebhook(raw,header,secret+'x')).toBe(false);expect(verifySignatureWebhook(raw,header.replace(/.$/,'z'),secret)).toBe(false);expect(verifySignatureWebhook(raw,header,'')).toBe(false);expect(verifySignatureWebhook(Buffer.alloc(262145),header,secret)).toBe(false);});
 it('hashes exact PDF bytes and blocks invalid envelope',()=>{const pdf=Buffer.from('%PDF-1.7\n'+'.'.repeat(200)+'\n%%EOF');expect(signaturePdfHash(pdf)).toMatch(/^[a-f0-9]{64}$/);expect(signaturePdfHash(pdf)).not.toEqual(signaturePdfHash(Buffer.concat([pdf,Buffer.from(' ')])));expect(()=>signaturePdfHash(Buffer.from('html'))).toThrow();expect(()=>signaturePdfHash(Buffer.alloc(3145729))).toThrow();});
});
