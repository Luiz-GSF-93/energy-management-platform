import {BotEnergyRagService} from './bot-energy-rag.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
function fixture(){
 const t:any={organizationId:'org-a',userId:'user-a',scope:'organization',role:'operacional',permissions:[P.INTELLIGENCE_AI_USE]};
 const ready=jest.fn(async()=>({data:[{id:'reviewed'}],error:null}));
 const client:any={from:jest.fn(()=>({select:()=>({eq:()=>({limit:ready})})})),rpc:jest.fn(async()=>({data:[],error:null}))};
 const embeddings:any={available:jest.fn(()=>true),embed:jest.fn(async()=>({vectors:[[0.1,0.2]],inputTokens:10}))};
 const budget:any={reserve:jest.fn(async()=>({id:'reservation'})),settle:jest.fn(async()=>{})};
 const licenses:any={available:jest.fn(async()=>true)};
 return {t,ready,client,embeddings,budget,licenses,bot:new BotEnergyRagService({getClient:()=>client} as any,embeddings,budget,licenses),period:{periodStart:'2026-08-01',periodEnd:'2026-08-31',market:'COMMON' as const}};
}
describe('RAG query vector reuse with fresh authorization and sources',()=>{
 afterEach(()=>jest.restoreAllMocks());
 it('reuses only the vector, rechecks licence and corpus, and searches current sources every time',async()=>{
  const f=fixture();await f.bot.retrieve(f.t,'Qual regra de demanda?',f.period);await f.bot.retrieve(f.t,'Qual regra de demanda?',f.period);
  expect(f.embeddings.embed).toHaveBeenCalledTimes(1);expect(f.budget.reserve).toHaveBeenCalledTimes(1);
  expect(f.ready).toHaveBeenCalledTimes(2);expect(f.licenses.available).toHaveBeenCalledTimes(2);expect(f.client.rpc).toHaveBeenCalledTimes(2);
  f.client.rpc.mockResolvedValueOnce({data:null,error:{message:'unavailable'}});
  await expect(f.bot.retrieve(f.t,'Qual regra de demanda?',f.period)).rejects.toThrow('normas');
 });
 it('does not share query vectors between users or organizations',async()=>{
  const f=fixture();for(const t of [f.t,{...f.t,userId:'user-b'},{...f.t,organizationId:'org-b'}])await f.bot.retrieve(t,'Qual regra?',f.period);
  expect(f.embeddings.embed).toHaveBeenCalledTimes(3);
 });
 it('expires vectors after one minute and does not extend expiry on a hit',async()=>{
  let now=1000;jest.spyOn(Date,'now').mockImplementation(()=>now);const f=fixture();
  await f.bot.retrieve(f.t,'Qual regra?',f.period);now+=59000;await f.bot.retrieve(f.t,'Qual regra?',f.period);
  now+=1000;await f.bot.retrieve(f.t,'Qual regra?',f.period);expect(f.embeddings.embed).toHaveBeenCalledTimes(2);
 });
 it('does not use the cache to bypass revoked permissions, licence or reviewed corpus',async()=>{
  const f=fixture();await f.bot.retrieve(f.t,'Qual regra?',f.period);
  await expect(f.bot.retrieve({...f.t,permissions:[]},'Qual regra?',f.period)).rejects.toThrow('autorizado');
  f.licenses.available.mockResolvedValueOnce(false);await expect(f.bot.retrieve(f.t,'Qual regra?',f.period)).rejects.toThrow('licença');
  f.ready.mockResolvedValueOnce({data:[],error:null});expect((await f.bot.retrieve(f.t,'Qual regra?',f.period)).state).toBe('NO_EVIDENCE');
  expect(f.client.rpc).toHaveBeenCalledTimes(1);expect(f.embeddings.embed).toHaveBeenCalledTimes(1);
 });
 it('bounds memory and rejects invalid periods before any paid embedding',async()=>{
  const f=fixture();await expect(f.bot.retrieve(f.t,'Qual regra?',{...f.period,periodStart:'2026-02-30'})).rejects.toThrow();
  expect(f.embeddings.embed).not.toHaveBeenCalled();
  for(let i=0;i<129;i++)await f.bot.retrieve(f.t,'Pergunta '+i,f.period);
  await f.bot.retrieve(f.t,'Pergunta 0',f.period);expect(f.embeddings.embed).toHaveBeenCalledTimes(130);
 });
});

describe('Client RAG live boundary',()=>{
 it('keeps drafts out and does not pay to embed without a reviewed corpus',async()=>{const f=fixture();f.ready.mockResolvedValue({data:[],error:null});f.client.rpc.mockResolvedValue({data:{customerId:'client'},error:null});const t={...f.t,role:'consulta',roleId:'role',permissions:[P.INTELLIGENCE_AI_USE,P.DOCUMENTS_REPORTS_VIEW]};expect((await f.bot.retrieveClient(t,'Qual regra?',f.period,'unit')).state).toBe('NO_EVIDENCE');expect(f.client.rpc).toHaveBeenCalledWith('bot_energy_client_reports',expect.objectContaining({p_actor:'user-a',p_role:'role',p_unit:'unit'}));expect(f.embeddings.embed).not.toHaveBeenCalled();expect(f.budget.reserve).not.toHaveBeenCalled();});
 it('rejects revoked client linkage, platform access and missing permissions before paid retrieval',async()=>{const f=fixture();const t={...f.t,role:'consulta',roleId:'role',permissions:[P.INTELLIGENCE_AI_USE,P.DOCUMENTS_REPORTS_VIEW]};f.client.rpc.mockResolvedValue({data:null,error:{code:'42501'}});await expect(f.bot.retrieveClient(t,'Qual regra?',f.period,'unit')).rejects.toThrow();await expect(f.bot.retrieveClient({...t,accessMode:'platform_operation'},'Qual regra?',f.period,'unit')).rejects.toThrow();await expect(f.bot.retrieveClient({...t,permissions:[]},'Qual regra?',f.period,'unit')).rejects.toThrow();expect(f.embeddings.embed).not.toHaveBeenCalled();});
});
