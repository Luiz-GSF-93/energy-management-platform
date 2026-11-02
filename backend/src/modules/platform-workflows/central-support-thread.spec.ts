import {CentralSupportThreadService,supportFailure} from './central-support-thread.service';
import {BadRequestException,ForbiddenException} from '@nestjs/common';
describe('Support private attachments and closure worker',()=>{
 const rpc=jest.fn(),bucket={upload:jest.fn(),download:jest.fn(),createSignedUrl:jest.fn()},db:any={getClient:()=>({rpc,storage:{from:jest.fn(()=>bucket)}}),createAuthClient:()=>({rpc})};
 let s:CentralSupportThreadService;beforeEach(()=>{jest.clearAllMocks();s=new CentralSupportThreadService(db);});
 it('rejects oversized evidence before any storage or database operation',async()=>{await expect(s.upload({o:'org',a:'actor',p:false},'id',{buffer:Buffer.alloc(5242881),size:1,originalname:'x.pdf',mimetype:'application/pdf'})).rejects.toThrow(BadRequestException);expect(rpc).not.toHaveBeenCalled();});
 it('rejects renamed arbitrary bytes',async()=>{await expect(s.upload({o:'org',a:'actor',p:false},'id',{buffer:Buffer.from('not a pdf'),size:9,originalname:'x.pdf',mimetype:'application/pdf'})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();});
 it('checks ticket scope before generating any download',async()=>{rpc.mockResolvedValue({error:{code:'42501'}});await expect(s.download({o:'foreign',a:'actor',p:false},'id','file')).rejects.toThrow(ForbiddenException);expect(bucket.createSignedUrl).not.toHaveBeenCalled();});
 it('generates a short lived scoped URL without returning object path',async()=>{rpc.mockResolvedValue({data:{path:'private/object',filename:'evidence.pdf'}});bucket.createSignedUrl.mockResolvedValue({data:{signedUrl:'https://storage.test/signed'}});const r=await s.download({o:'org',a:'actor',p:false},'id','file');expect(r).toEqual({url:'https://storage.test/signed',expiresIn:60});expect(bucket.createSignedUrl).toHaveBeenCalledWith('private/object',60,{download:'evidence.pdf'});});
 it('runs closure checks even with email delivery disabled',async()=>{process.env.CENTRAL_SUPPORT_EMAIL_ENABLED='false';rpc.mockResolvedValue({data:{closed:0}});await s.tick();expect(rpc).toHaveBeenCalledWith('central_support_close_due',{p_limit:50});});
 it('shows a specific missing deadline error without SQL details',()=>{expect(()=>supportFailure({code:'22023',message:'SC_DEADLINE',details:'private'})).toThrow('Informe o prazo');});
});
