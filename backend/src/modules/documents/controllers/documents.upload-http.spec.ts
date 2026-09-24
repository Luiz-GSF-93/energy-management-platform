import { Module, INestApplication } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { AddressInfo } from 'net';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from '../services/documents.service';
import { RoleGuard } from '../../../common/guards/role.guard';
import { PERMISSIONS } from '../../../common/constants/permissions';
const upload=jest.fn();
@Module({controllers:[DocumentsController],providers:[{provide:DocumentsService,useValue:{upload}}]}) class TestModule {}
describe('Multipart document HTTP boundary',()=>{
 let app:INestApplication,base:string,permitted=true;
 beforeAll(async()=>{
  app=await NestFactory.create(TestModule,{logger:false});
  app.useGlobalGuards({canActivate:ctx=>{ctx.switchToHttp().getRequest().tenantContext={scope:'organization',organizationId:'org-a',userId:'actor-a',permissions:permitted?[PERMISSIONS.DOCUMENTS_UPLOAD]:[]};return true;}},new RoleGuard(app.get(Reflector)));
  await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
 });
 afterAll(async()=>{await app?.close();});
 beforeEach(()=>{permitted=true;upload.mockReset().mockResolvedValue({id:'saved'});});
 function form(bytes=Buffer.from('%PDF-1.4\n%%EOF')) {const f=new FormData();f.set('customerId','customer');f.set('consumerUnitId','unit');f.set('documentType','OTHER');f.set('referenceMonth','2026-09-01');f.set('file',new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),'invoice.pdf');return f;}
 it('parses multipart and attributes organization/uploader from context',async()=>{
  expect((await fetch(base+'/documents/upload',{method:'POST',body:form()})).status).toBe(201);
  expect(upload).toHaveBeenCalledWith(expect.objectContaining({customerId:'customer'}),expect.objectContaining({buffer:expect.any(Buffer),originalname:'invoice.pdf'}),'org-a','actor-a');
 });
 it('checks permission before upload',async()=>{permitted=false;expect((await fetch(base+'/documents/upload',{method:'POST',body:form()})).status).toBe(403);expect(upload).not.toHaveBeenCalled();});
 it('rejects files over 10 MiB before the service',async()=>{expect((await fetch(base+'/documents/upload',{method:'POST',body:form(Buffer.alloc(10*1024*1024+1))})).status).toBe(413);expect(upload).not.toHaveBeenCalled();});
 it('rejects a second file',async()=>{const f=form();f.append('file',new Blob(['extra']),'extra.pdf');expect((await fetch(base+'/documents/upload',{method:'POST',body:f})).status).toBe(400);expect(upload).not.toHaveBeenCalled();});
});
