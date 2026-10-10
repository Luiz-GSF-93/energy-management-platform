import {SalesCommercialService,commercialInput} from './sales-commercial.service';
import {SalesCommercialController} from './sales-commercial.controller';
import {BadRequestException,ConflictException,ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {Reflector} from '@nestjs/core';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('Isolated commercial API',()=>{
 const rpc=jest.fn();let service:SalesCommercialService;
 beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:{ok:true},error:null});service=new SalesCommercialService({getClient:()=>({rpc})} as any);});
 it('uses the authenticated actor, never a body actor',async()=>{await service.policy(id,{requestId:id,planId:id,planVersion:1,expectedVersion:0,definition:{}});expect(rpc).toHaveBeenCalledWith('save_platform_sales_policy',expect.objectContaining({p_actor:id}));});
 it.each([null,[],{}, {actor:id}, {requestId:id,planId:id,planVersion:1,expectedVersion:0,definition:{},actor:id}])('rejects malformed/extra body fields',body=>{expect(()=>service.policy(id,body)).toThrow(BadRequestException);expect(rpc).not.toHaveBeenCalled();});
 it('rejects spoofed input and amounts before database call',()=>{expect(()=>commercialInput({id:'not-uuid'},['id'],['id'])).toThrow();expect(()=>service.proposal(id,{id,receipt:id,planId:id,policyVersion:1,cycle:'MONTHLY',extras:[],justification:'Review',total:1})).toThrow();expect(rpc).not.toHaveBeenCalled();});
 it.each([['42501',ForbiddenException],['P3611',ConflictException],['unknown',ServiceUnavailableException]])('fails closed for %s',async(code,kind)=>{rpc.mockResolvedValue({data:null,error:{code,message:'private detail'}});await expect(service.read(id)).rejects.toBeInstanceOf(kind);});
 it('rejects invalid receipt before RPC',()=>{expect(()=>service.read(id,'bad')).toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('requires Owner permission on every handler',()=>{const reflector=new Reflector();for(const method of ['read','policy','proposal','review'] as const){expect(reflector.get(PERMISSIONS_KEY,SalesCommercialController.prototype[method])).toEqual(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841']);}});
});
