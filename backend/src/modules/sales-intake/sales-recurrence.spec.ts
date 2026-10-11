import {SalesRecurrenceService} from './sales-recurrence.service';
import {SalesRecurrenceController} from './sales-recurrence.controller';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
import {Reflector} from '@nestjs/core';
import {SALES_FINANCE_READ,SALES_OWNER} from './sales-finance.service';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('4F private preparation',()=>{
 let rpc:jest.Mock,s:SalesRecurrenceService,flag:string|undefined;
 const body={id,intentId:id,nextDueDate:'2026-11-20',justification:'Owner reviewed preserved first cycle.'};
 beforeEach(()=>{flag='true';rpc=jest.fn().mockResolvedValue({data:{id,externalCallsEnabled:false}});s=new SalesRecurrenceService({getClient:()=>({rpc})} as any,{get:()=>flag} as any);});
 it.each([undefined,'false','TRUE','1'])('defaults off for %s',async v=>{flag=v;await expect(s.prepare(id,body)).rejects.toMatchObject({status:503});expect(rpc).not.toHaveBeenCalled();});
 it.each([['42501',403],['P3660',404],['P3661',409],['23505',409],['22023',400],['XX000',503]])('sanitizes DB error %s',async(code,status)=>{rpc.mockResolvedValue({error:{code,message:'secret'}});await expect(s.prepare(id,body)).rejects.toMatchObject({status});});
 it('uses authenticated actor and never accepts price/customer/cycle override',async()=>{await s.prepare(id,body);expect(rpc.mock.calls[0][1]).toEqual({p_actor:id,p_action:'prepare',p_body:body});expect(()=>s.prepare(id,{...body,value:1})).toThrow();expect(()=>s.prepare(id,{...body,customer:'cus_other'})).toThrow();});
 it.each([{page:'-1'},{state:'ACTIVE'},{environment:'PRODUCTION'},{search:'x'.repeat(101)},{page:['0']}])('rejects invalid filters',q=>{expect(()=>s.list(id,q)).toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('bounded list and detail call private reader',async()=>{await s.list(id,{});await s.read(id,id);expect(rpc.mock.calls.map(x=>x[1].p_action)).toEqual(['list','read']);});
 it('requires explicit optimistic version and allowed transition',()=>{expect(()=>s.review(id,id,{requestId:id,expectedVersion:0,status:'CHECKED',justification:body.justification})).toThrow();expect(()=>s.review(id,id,{requestId:id,expectedVersion:1,status:'ACTIVE',justification:body.justification})).toThrow();});
 it('network errors do not disclose secrets',async()=>{rpc.mockRejectedValue(new Error('private credential'));await expect(s.read(id,id)).rejects.not.toThrow('credential');});
 it('Owner writes; existing Finance reads only',()=>{const r=new Reflector();for(const fn of ['prepare','review'] as const)expect(r.get(PERMISSIONS_KEY,SalesRecurrenceController.prototype[fn])).toEqual([SALES_OWNER]);for(const fn of ['read','list'] as const)expect(r.get(PERMISSIONS_KEY,SalesRecurrenceController.prototype[fn])).toEqual([SALES_OWNER,SALES_FINANCE_READ]);});
});
