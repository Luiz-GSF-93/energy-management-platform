import {SalesProvisioningService} from './sales-provisioning.service';
import {SalesProvisioningController} from './sales-provisioning.controller';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
describe('5B commercial provisioning',()=>{
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',hash='a'.repeat(64);
 const complement={starts:'2026-10-20',ends:'2027-10-19',renews:'2027-10-19',aiMonthlyMicroUsd:0,contractConfirmed:true};
 const prepare={id,activationId:id,payloadHash:hash,complement,justification:'Fixture preparation without external calls.'};
 const command={id,requestId:id,expectedVersion:2,payloadHash:hash,justification:'Fixture command without real license.'};
 let rpc:jest.Mock;let service:SalesProvisioningService;
 beforeEach(()=>{rpc=jest.fn().mockResolvedValue({id});service=new SalesProvisioningService({rpc} as any,{get:()=> 'true'} as any);});
 it.each([undefined,'false','TRUE','1'])('fails closed with commands flag %s',flag=>{const off=new SalesProvisioningService({rpc} as any,{get:()=>flag} as any);expect(()=>off.prepare(id,prepare)).toThrow();expect(()=>off.preview(id,{id,complement})).toThrow();expect(()=>off.list(id,{})).toThrow();expect(()=>off.read(id,id)).toThrow();expect(()=>off.command(id,'execute',command)).toThrow();expect(rpc).not.toHaveBeenCalled();});
 it.each([undefined,'false','TRUE','1'])('separately blocks application with flag %s',flag=>{const off=new SalesProvisioningService({rpc} as any,{get:(k:string)=>k==='SALES_PROVISIONING_COMMANDS_ENABLED'?'true':flag} as any);expect(()=>off.command(id,'execute',command)).toThrow();expect(rpc).not.toHaveBeenCalled();});
 it.each([{...prepare,actor:id},{...prepare,environment:'PRODUCTION'},{...prepare,license:{max_users:999}},{...prepare,activationId:'foreign'},{...prepare,justification:'short'},{...prepare,complement:{...complement,aiMonthlyMicroUsd:-1}},{...prepare,complement:{...complement,starts:'2026-02-30'}},{...prepare,complement:{...complement,aiMonthlyMicroUsd:'0'}},{...prepare,complement:{...complement,contractConfirmed:'true'}},{...prepare,complement:{...complement,modules:{client_portal:true}}}])('rejects arbitrary license, identity or malformed complement',v=>{expect(()=>service.prepare(id,v)).toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('keeps missing quota pending instead of inventing unlimited AI',async()=>{await service.preview(id,{id,complement:{}});expect(rpc).toHaveBeenCalledWith('platform_sales_provisioning_action',{p_actor:id,p_action:'preview',p_body:{id,complement:{}}});});
 it('forwards private preparation and authenticated actor',async()=>{await service.prepare(id,prepare);expect(rpc).toHaveBeenCalledWith('platform_sales_provisioning_action',{p_actor:id,p_action:'prepare',p_body:prepare});});
 it.each(['authorize','withdraw','execute'] as const)('preserves %s command identifiers',async action=>{await service.command(id,action,command);expect(rpc).toHaveBeenCalledWith('platform_sales_provisioning_action',{p_actor:id,p_action:action,p_body:command});});
 it.each([{page:'1001'},{page:['1']},{status:'ACTIVE'},{organizationId:'another'},{search:'a'.repeat(101)}])('rejects query substitutions',v=>{expect(()=>service.list(id,v as any)).toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('protects every handler with Owner capability',()=>{for(const k of ['list','read','preview','prepare','authorize','withdraw','execute'])expect(Reflect.getMetadata(PERMISSIONS_KEY,(SalesProvisioningController.prototype as any)[k])).toEqual(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']);});
});
