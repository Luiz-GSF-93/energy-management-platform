import {CceePublicationService} from './ccee-publication.service';
import {pldReviewDigest} from './ccee-publication';
const requestId='da9f39ee-835e-4ba3-b33e-49c1dbbd709a';
function fixture(){const preview={organizationId:'org',months:[{month:'2026-08',submarket:'SE_CO',meanBrlMwh:'128.00'}],source:'official',method:'HOURLY_ARITHMETIC_MEAN',sourceHashes:['a'.repeat(64)]};const ccee={preview:jest.fn(async()=>preview)},rpc=jest.fn(async()=>({data:{published:true},error:null}));return {preview,ccee,rpc,s:new CceePublicationService(ccee as any,{getClient:()=>({rpc})} as any),actor:{scope:'global',userId:'admin'} as any,input:{month:'2026-08',digest:pldReviewDigest(preview),requestId}};}
describe('CCEE publication review',()=>{
 it('requeries provider values and passes only server-bound organization and trusted actor',async()=>{const f=fixture();await f.s.publish(f.input,f.actor);expect(f.ccee.preview).toHaveBeenCalledWith({month:'2026-08'});expect(f.rpc).toHaveBeenCalledWith('ccee_publish_pld_month',{p_org:'org',p_actor:'admin',p_request:requestId,p_payload:f.preview});});
 it('rejects organization or prices supplied by caller',async()=>{const f=fixture();await expect(f.s.publish({...f.input,organizationId:'other'},f.actor)).rejects.toMatchObject({status:400});expect(f.ccee.preview).not.toHaveBeenCalled();});
 it('blocks changed values before any persistence',async()=>{const f=fixture();f.preview.months[0].meanBrlMwh='129.00';await expect(f.s.publish(f.input,f.actor)).rejects.toMatchObject({status:409});expect(f.rpc).not.toHaveBeenCalled();});
 it('does not invalidate review for SOAP request metadata alone',()=>{const f=fixture();expect(pldReviewDigest({...f.preview,sourceHashes:['b'.repeat(64)]} as any)).toBe(f.input.digest);});
 it('rejects customer/organization context',async()=>{const f=fixture();await expect(f.s.publish(f.input,{scope:'organization',userId:'x'} as any)).rejects.toMatchObject({status:403});expect(f.ccee.preview).not.toHaveBeenCalled();});
});
