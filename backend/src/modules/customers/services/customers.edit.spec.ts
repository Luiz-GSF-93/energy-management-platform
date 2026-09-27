import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {CustomersService} from './customers.service';
import {editEnvelope,saveRegistration} from '../../../common/registration-edit';
describe('Audited customer edits',()=>{
 const actor='00000000-0000-4000-8000-000000000001';
 const envelope=(changes:any)=>({changes,reason:'Corrigir identificação',expectedVersion:0,requestId:'00000000-0000-4000-8000-000000000011'});
 let rpc:jest.Mock,service:CustomersService;
 beforeEach(()=>{rpc=jest.fn().mockResolvedValue({data:{id:'customer'},error:null});service=new CustomersService({getClient:()=>({rpc})} as any);});
 it('sends authenticated author, organization, reason and normalized data to one atomic function',async()=>{await service.update('customer','org',envelope({document:'11.222.333/0001-81',company_name:' Nome '}),actor);expect(rpc).toHaveBeenCalledWith('edit_registration',expect.objectContaining({p_org:'org',p_id:'customer',p_actor:actor,p_reason:'Corrigir identificação',p_expected:0,p_changes:{document:'11222333000181',company_name:'Nome'}}));});
 it.each([{organization_id:'other'},{company_name:''},{document:'123'},{status:'DELETED'},{exclusive_user_ids:['invalid']},{contact_email:'invalid'}])('rejects invalid changes %p',async changes=>{await expect(service.update('customer','org',envelope(changes),actor)).rejects.toBeInstanceOf(BadRequestException);expect(rpc).not.toHaveBeenCalled();});
 it.each([{reason:''},{expectedVersion:-1},{requestId:'invalid'},{created_by:'forged'},{changes:{}}])('requires complete audit metadata %p',async invalid=>{expect(()=>editEnvelope({...envelope({company_name:'New'}),...invalid},actor)).toThrow(BadRequestException);});
 it('requires an authenticated actor',()=>{expect(()=>editEnvelope(envelope({status:'INACTIVE'}),'')).toThrow(ForbiddenException);});
 it.each([['40001',ConflictException],['42501',ForbiddenException],['P3840',NotFoundException],['XX000',ServiceUnavailableException]])('sanitizes database failure %s',async(code,ErrorType)=>{rpc.mockResolvedValue({data:null,error:{code,message:'private details'}});await expect(saveRegistration({rpc},'org','customers','c',actor,envelope({status:'INACTIVE'}),{status:'INACTIVE'})).rejects.toBeInstanceOf(ErrorType as any);});
});
