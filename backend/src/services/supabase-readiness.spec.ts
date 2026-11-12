import {ServiceUnavailableException} from '@nestjs/common';
import {createClient} from '@supabase/supabase-js';
import {SupabaseService} from './supabase.service';
import {AppService} from '../app.service';
jest.mock('@supabase/supabase-js',()=>({createClient:jest.fn()}));
describe('dependency readiness, distinct from process liveness',()=>{
 const config={get:(key:string)=>key==='SUPABASE_URL'?'https://example.invalid':'test-service-key'} as any;
 afterEach(()=>jest.restoreAllMocks());
 it('coalesces and caches probes without exposing credentials or tenant data',async()=>{
  const rpc=jest.fn(()=>({abortSignal:async()=>({data:{database:true}})}));(createClient as jest.Mock).mockReturnValue({rpc});const transport=jest.spyOn(global,'fetch').mockResolvedValue(new Response('{}'));
  const s=new SupabaseService(config),[a,b]=await Promise.all([s.readiness(),s.readiness()]);expect(a).toEqual(b);expect((await new AppService(s).readiness()).status).toBe('ready');expect(rpc).toHaveBeenCalledTimes(1);expect(transport).toHaveBeenCalledTimes(1);expect(JSON.stringify(a)).not.toContain('test-service-key');
 });
 it('reports unavailable authentication as 503 even while the API process runs',async()=>{
  (createClient as jest.Mock).mockReturnValue({rpc:()=>({abortSignal:async()=>({data:{database:true}})})});jest.spyOn(global,'fetch').mockResolvedValue(new Response('',{status:503}));
  const app=new AppService(new SupabaseService(config));expect(app.getHello()).toContain('Backend');await expect(app.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);await expect(app.readiness()).rejects.toMatchObject({response:{status:'degraded',dependencies:{database:'up',auth:'down'}}});
 });
 it('reports unavailable database separately from authentication',async()=>{
  (createClient as jest.Mock).mockReturnValue({rpc:()=>({abortSignal:async()=>({error:{code:'57014'}})})});jest.spyOn(global,'fetch').mockResolvedValue(new Response('{}'));
  await expect(new AppService(new SupabaseService(config)).readiness()).rejects.toMatchObject({response:{dependencies:{database:'down',auth:'up'}}});
 });
});
