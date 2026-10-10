import {Request} from 'express';
import {salesRequesterIp} from './sales-intake.ingress';
import {PublicSalesController} from './sales-intake.controller';
import {SalesIntakeService} from './sales-intake.service';

const host='energy-management-platform-production.up.railway.app';
function request(patch:Record<string,string|string[]|undefined>={}):Request {
 const headers={host,'x-real-ip':'203.0.113.7','x-railway-edge':'us-west1','x-railway-request-id':'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee','x-forwarded-proto':'https',...patch};
 return {headers,rawHeaders:Object.entries(headers).filter(([,v])=>v!==undefined).flatMap(([k,v])=>[k,String(v)]),socket:{remoteAddress:'100.64.0.1'},ip:'100.64.0.1'} as unknown as Request;
}
describe('Sales intake public ingress',()=>{
 const env={...process.env};
 beforeEach(()=>{process.env.NODE_ENV='production';process.env.SALES_INTAKE_IP_SOURCE='railway-public';process.env.SALES_INTAKE_PUBLIC_HOST=host;process.env.RAILWAY_PROJECT_ID='configured-project';});
 afterEach(()=>{process.env={...env};});
 test('uses edge IP instead of shared socket and ignores spoofable alternate headers',()=>{
  expect(salesRequesterIp(request({'x-forwarded-for':'198.51.100.99','cf-connecting-ip':'192.0.2.99',forwarded:'for=192.0.2.88'}))).toBe('203.0.113.7');
 });
 test.each(['127.0.0.1','service.railway.internal','www.expertenergy.com.br',host+':3001','evil.example'])('rejects non-public destination %s',value=>expect(()=>salesRequesterIp(request({host:value}))).toThrow());
 test.each(['','203.0.113.7, 198.51.100.1','203.0.113.7\n','unknown','1.2.3.999','fe80::1%eth0'])('rejects invalid edge IP %s',value=>expect(()=>salesRequesterIp(request({'x-real-ip':value}))).toThrow());
 test.each(['x-real-ip','x-railway-edge','x-railway-request-id','x-forwarded-proto','host'])('requires a single ingress header %s',name=>{
  expect(()=>salesRequesterIp(request({[name]:undefined}))).toThrow();
  const req=request();req.rawHeaders.push(name,String(req.headers[name]));expect(()=>salesRequesterIp(req)).toThrow();
 });
 test('rejects header arrays, HTTP and malformed edge markers',()=>{
  for(const patch of [{'x-real-ip':['203.0.113.7']},{'x-forwarded-proto':'http'},{'x-railway-edge':'edge,other'},{'x-railway-request-id':'short'}])expect(()=>salesRequesterIp(request(patch))).toThrow();
 });
 test('normalizes equivalent IPv6 and IPv4-mapped addresses for the same quota',()=>{
  expect(salesRequesterIp(request({'x-real-ip':'2001:0DB8:0:0:0:0:0:1'}))).toBe('2001:db8::1');
  expect(salesRequesterIp(request({'x-real-ip':'::ffff:203.0.113.7'}))).toBe('203.0.113.7');
 });
 test('production fails closed without source, host or Railway configuration',()=>{
  for(const key of ['SALES_INTAKE_IP_SOURCE','SALES_INTAKE_PUBLIC_HOST','RAILWAY_PROJECT_ID']){const old=process.env[key];delete process.env[key];expect(()=>salesRequesterIp(request())).toThrow();process.env[key]=old;}
 });
 test('local direct mode never trusts forwarded headers',()=>{
  process.env.NODE_ENV='test';delete process.env.SALES_INTAKE_IP_SOURCE;expect(salesRequesterIp(request())).toBe('100.64.0.1');
 });
 test('disabled intake remains 404 and never reaches persistence without ingress headers',async()=>{
  process.env.SALES_INTAKE_ENABLED='false';const rpc=jest.fn();const service=new SalesIntakeService({getClient:()=>({rpc})} as any);
  await expect(new PublicSalesController(service).submit(null,undefined,{} as Request)).rejects.toMatchObject({status:404});expect(rpc).not.toHaveBeenCalled();
 });
 test('invalid ingress cannot call persistence even when enabled',()=>{
  process.env.SALES_INTAKE_ENABLED='true';const submit=jest.fn();const controller=new PublicSalesController({submit} as any);
  expect(()=>controller.submit(null,undefined,request({host:'service.railway.internal'}))).toThrow();expect(submit).not.toHaveBeenCalled();
 });
});
