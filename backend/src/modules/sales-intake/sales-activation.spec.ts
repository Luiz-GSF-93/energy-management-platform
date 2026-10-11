import {SalesActivationService} from './sales-activation.service';
import {SalesActivationController} from './sales-activation.controller';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
describe('5A private activation preparation',()=>{
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';let rpc:jest.Mock;let service:SalesActivationService;
 const prepare={id,organizationId:'org-fixture',proposalId:id,documentId:id,bindingId:id,justification:'Private fixture preparation only.'};
 const review={id,requestId:id,expectedVersion:1,sourceHash:'a'.repeat(64),status:'CHECKED_INTERNAL',checks:{recipient:true,contract:true,payment:true,scope:true,fiscal:true},justification:'Private fixture review without license.'};
 beforeEach(()=>{rpc=jest.fn().mockResolvedValue({id});service=new SalesActivationService({rpc} as any,{get:()=> 'true'} as any);});
 it.each([undefined,'false','TRUE','1'])('fails closed with flag %s',v=>{const off=new SalesActivationService({rpc} as any,{get:()=>v} as any);expect(()=>off.prepare(id,prepare)).toThrow();expect(()=>off.list(id,{})).toThrow();expect(()=>off.read(id,id)).toThrow();expect(()=>off.review(id,review)).toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('passes actor and preserves original fields to private RPC',async()=>{await service.prepare(id,prepare);expect(rpc).toHaveBeenCalledWith('platform_sales_activation_action',{p_actor:id,p_action:'prepare',p_body:prepare});});
 it.each([{...prepare,environment:'PRODUCTION'},{...prepare,actor:id},{...prepare,organizationId:' '},{...prepare,bindingId:'pay_remote'},{...prepare,justification:'short'}])('rejects substituted authority and malformed sources',body=>{expect(()=>service.prepare(id,body)).toThrow();expect(rpc).not.toHaveBeenCalled();});
 it.each([{...review,checks:{...review.checks,owner:true}},{...review,checks:{...review.checks,payment:'true'}},{...review,status:'ACTIVATE'},{...review,expectedVersion:0.5},{...review,sourceHash:'raw'}])('rejects invalid review',body=>{expect(()=>service.review(id,body)).toThrow();expect(rpc).not.toHaveBeenCalled();});
 it.each([{page:'1001'},{status:'ACTIVE'},{organizationId:'another'},{page:['1']},{search:'x'.repeat(101)}])('rejects unsupported query',q=>{expect(()=>service.list(id,q as any)).toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('offers no execute/provision methods',()=>{expect((service as any).execute).toBeUndefined();expect((service as any).provision).toBeUndefined();});
 it('forwards valid review without changing flags or making external calls',async()=>{await service.review(id,review);expect(rpc).toHaveBeenCalledWith('platform_sales_activation_action',{p_actor:id,p_action:'review',p_body:review});});
 it('has only Owner controller capability',()=>{for(const k of ['list','read','prepare','review'])expect(Reflect.getMetadata(PERMISSIONS_KEY,(SalesActivationController.prototype as any)[k])).toEqual(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']);});
});
