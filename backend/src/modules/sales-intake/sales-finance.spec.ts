import {SalesFinanceService,SALES_FINANCE_READ,SALES_OWNER} from './sales-finance.service';
import {SalesFinanceController} from './sales-finance.controller';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
import {Reflector} from '@nestjs/core';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('Financial sandbox read isolation',()=>{
 let rpc:jest.Mock,settings:Record<string,string>,service:SalesFinanceService;
 beforeEach(()=>{settings={SALES_ASAAS_SANDBOX_ENABLED:'true',SALES_ASAAS_FINANCE_READ_ENABLED:'true'};rpc=jest.fn().mockResolvedValue({data:{},error:null});service=new SalesFinanceService({getClient:()=>({rpc})} as any,{get:(k:string)=>settings[k]} as any);});
 it.each(['SALES_ASAAS_SANDBOX_ENABLED','SALES_ASAAS_FINANCE_READ_ENABLED'])('defaults off independently: %s',async key=>{delete settings[key];await expect(service.read(id,{})).rejects.toMatchObject({status:503});expect(rpc).not.toHaveBeenCalled();});
 it.each([{page:'-1'},{page:'1001'},{search:'x'.repeat(101)},{status:'PAID'},{from:'2026-02-30'},{to:'2026-13-01'},{from:'2026-10-10',to:'2026-10-09'},{environment:'PRODUCTION'},{actor:id},{search:[]}])('rejects unsafe filters before persistence',async q=>{await expect(service.read(id,q)).rejects.toMatchObject({status:400});expect(rpc).not.toHaveBeenCalled();});
 it('uses original authenticated ID, private RPC and no Asaas adapter',async()=>{await service.read(id,{page:'2',search:'Fixture'},id);expect(rpc).toHaveBeenCalledWith('read_platform_sales_finance',{p_actor:id,p_page:2,p_search:'Fixture',p_status:'',p_from:null,p_to:null,p_id:id});});
 it('rejects invalid detail ID',async()=>{await expect(service.read(id,{},'pay_guess')).rejects.toMatchObject({status:400});expect(rpc).not.toHaveBeenCalled();});
 it.each([['42501',403],['P3610',404],['22023',400],['XX000',503]])('sanitizes database error %s',async(code,status)=>{rpc.mockResolvedValue({error:{code,message:'private SQL secret'}});await expect(service.read(id,{})).rejects.toMatchObject({status});await expect(service.read(id,{})).rejects.not.toThrow('private SQL secret');});
 it('handles unavailable database without leaking errors',async()=>{rpc.mockRejectedValue(new Error('secret'));await expect(service.read(id,{})).rejects.toMatchObject({status:503});});
 it('exposes only GET methods with scoped reader permissions',()=>{const r=new Reflector();for(const method of ['list','detail'] as const)expect(r.get(PERMISSIONS_KEY,SalesFinanceController.prototype[method])).toEqual([SALES_OWNER,SALES_FINANCE_READ]);expect(Object.getOwnPropertyNames(SalesFinanceController.prototype)).toEqual(['constructor','list','detail']);});
});
