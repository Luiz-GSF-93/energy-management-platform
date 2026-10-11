import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {request} from 'node:http';
import {SalesSignatureWebhookController} from './sales-signature-lifecycle.controller';
import {SalesSignatureLifecycleService} from './sales-signature-lifecycle.service';
import {signatureWebhookHash} from './sales-signature-protocol';
const key='11111111-1111-4111-8111-111111111111',secret='fixture-secret-not-real';
describe('Clicksign HMAC HTTP boundary — loopback only',()=>{
 let app:any,port:number,rpc:jest.Mock;
 beforeAll(async()=>{
  rpc=jest.fn().mockResolvedValue({accepted:true});const values:Record<string,string>={SALES_SIGNATURE_PREPARATION_ENABLED:'true',SALES_SIGNATURE_LIFECYCLE_ENABLED:'true',SALES_SIGNATURE_WEBHOOK_ENABLED:'true',SALES_CLICKSIGN_SANDBOX_WEBHOOK_SECRET:secret,SALES_CLICKSIGN_SANDBOX_ACCOUNT_KEY:key};
  const service=new SalesSignatureLifecycleService({rpc} as any,{get:(k:string)=>values[k]} as any);
  @Module({controllers:[SalesSignatureWebhookController],providers:[{provide:SalesSignatureLifecycleService,useValue:service}]})class Fixture{}
  app=await NestFactory.create(Fixture,{rawBody:true,logger:false});await app.listen(0,'127.0.0.1');port=app.getHttpServer().address().port;
 });
 afterAll(async()=>{await app?.close();});beforeEach(()=>rpc.mockClear());
 function send(raw:Buffer,hmac:string){return new Promise<number>((resolve,reject)=>{const req=request({host:'127.0.0.1',port,path:'/public/sales/clicksign-sandbox/webhook',method:'POST',headers:{'Content-Type':'application/json','Content-Length':raw.length,'Content-Hmac':hmac}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);req.end(raw);});}
 function body(){return Buffer.from(JSON.stringify({document:{key,account_key:key},event:{name:'document_closed',occurred_at:new Date().toISOString(),data:{account:{key}}},ignored:'acentuação'},null,2));}
 it('authenticates exact original UTF8 bytes despite parsed-body normalization',async()=>{const raw=body();expect(await send(raw,'sha256='+signatureWebhookHash(raw,secret))).toBe(200);expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0][0]).toBe('platform_sales_signature_receive_event');expect(JSON.stringify(rpc.mock.calls)).not.toContain('acentuação');});
 it('rejects HMAC over reserialized JSON, before any database call',async()=>{const raw=body(),normalized=Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))));expect(await send(raw,'sha256='+signatureWebhookHash(normalized,secret))).toBe(401);expect(rpc).not.toHaveBeenCalled();});
 it('rejects missing or forged authentication',async()=>{expect(await send(body(),'sha256='+'0'.repeat(64))).toBe(401);expect(rpc).not.toHaveBeenCalled();});
 it('retains the existing parser body limit rather than widening global limits',async()=>{const raw=Buffer.from(JSON.stringify({...JSON.parse(body().toString()),ignored:'x'.repeat(150000)}));expect(await send(raw,'sha256='+signatureWebhookHash(raw,secret))).toBe(413);expect(rpc).not.toHaveBeenCalled();});
});
