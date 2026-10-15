import {ConfigService} from '@nestjs/config';
import {knowledgeTextHash} from './bot-energy-knowledge';
import {CorpusClaim,CorpusSource,corpusRemoteMatches,validateCorpusSources,corpusVersionConflict} from './eva-corpus.model';
import {EvaCorpusPublicationService} from './eva-corpus-publication.service';
import {EvaPublishedRagService} from './eva-published-rag.service';
import {EvaSearchConnector} from './eva-search.connector';
import {searchDocumentId} from './eva-search.model';
import {BotEnergyService} from './bot-energy.service';
import {EvaKnowledgeRagService} from './eva-knowledge-rag.service';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q={periodStart:'2026-10-01',periodEnd:'2026-10-31',market:'ACL' as const};
const text='3.1 Regra e condição. 3.1.1 Exceção preservada.',h=knowledgeTextHash(text),vector=Array(1536).fill(.125);
const source=():CorpusSource=>({publicationId:id(1),publicationEventId:id(2),releaseId:id(3),revisionId:id(4),documentId:id(5),title:'PdC CCEE',version:'1.0',url:'https://www.ccee.org.br/test.pdf',family:'CCEE_PROCEDURES',authority:'CCEE',markets:['ACL'],validFrom:'2025-01-01',validTo:null,topic:'ACL: condições e exclusões conferidas.',fileHash:'a'.repeat(64),reviewedAt:'2026-10-01T10:00:00Z',reviewedBy:id(6),chunkTotal:1});
const claim=():CorpusClaim=>({id:id(1),releaseId:id(3),revisionId:id(4),leaseId:id(7),readOnly:false,chunks:[{id:h,text,contentHash:h,vector}]});
const remote=(published=false)=>({id:searchDocumentId(id(3),h),chunkId:h,releaseId:id(3),revisionId:id(4),contentHash:h,scope:'OFFICIAL_PUBLIC',audience:'PLATFORM',published,text,vector});
const config=(over:Record<string,string>={})=>new ConfigService({EVA_CORPUS_PUBLICATION_ENABLED:'true',EVA_CORPUS_PUBLICATION_CALLS_ENABLED:'true',EVA_SEARCH_INDEX_CALLS_ENABLED:'true',EVA_SEARCH_QUERY_CALLS_ENABLED:'true',EVA_SEARCH_EMBEDDING_CALLS_ENABLED:'true',EVA_SEARCH_RAG_ENABLED:'true',EVA_SEARCH_RAG_ORGANIZATIONS:'org_default',EVA_SEARCH_INDEX:'eva-official-pilot-v1',...over});
describe('Controlled publication integrity',()=>{
 it.each([{published:true},{revisionId:id(9)},{contentHash:'f'.repeat(64)},{text:'changed'},{vector:[.1]},{scope:'TENANT'},{audience:'PORTAL'},{vector:Array(1536).fill(.2)}])('rejects mismatched immutable record %j',patch=>{const c=claim();expect(corpusRemoteMatches(c,c.chunks[0],{...remote(),...patch},false)).toBe(false)});
 it('accepts only complete matching vector and visibility',()=>{const c=claim();expect(corpusRemoteMatches(c,c.chunks[0],remote(),false)).toBe(true);expect(corpusRemoteMatches(c,c.chunks[0],remote(true),true)).toBe(true)});
 it.each([{url:'https://evil.invalid/x'},{authority:'ANEEL'},{validFrom:'2026-02-30'},{markets:['GD']},{fileHash:'bad'},{reviewedBy:''}])('rejects invalid official metadata %j',patch=>expect(()=>validateCorpusSources([{...source(),...patch}],q)).toThrow());
 it('abstains on crossing dates and conflicting document revisions',()=>{expect(corpusVersionConflict([{...source(),validFrom:'2026-10-15'}],q)).toBe(true);expect(corpusVersionConflict([source(),{...source(),releaseId:id(9),version:'2'}],q)).toBe(true)});
 it('preserves unknown state after a provider failure and never retries a merge',async()=>{
  const rpc=jest.fn(async(..._args:any[])=>({data:{},error:null})),search:any={lookup:jest.fn(async()=>remote()),publish:jest.fn(async()=>{throw Error('timeout')})};
  const s=new EvaCorpusPublicationService({getClient:()=>({rpc})} as any,config(),search);await s.perform(id(8),claim());expect(search.publish).toHaveBeenCalledTimes(1);expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_action:'finish',p_body:{confirmed:false}});
 });
 it('reconciles only by GET and refuses missing records',async()=>{
  const rpc=jest.fn(async(..._args:any[])=>({data:{},error:null})),search:any={lookup:jest.fn(async()=>remote(true)),publish:jest.fn()};
  const s=new EvaCorpusPublicationService({getClient:()=>({rpc})} as any,config(),search);await s.perform(id(8),{...claim(),readOnly:true});expect(search.publish).not.toHaveBeenCalled();expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_body:{confirmed:true}});
  search.lookup.mockResolvedValue(null);await s.perform(id(8),{...claim(),readOnly:true});expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_body:{confirmed:false}});
 });
 it('does not start another worker on an idempotent replay',async()=>{
  const rpc=jest.fn(async()=>({data:{id:id(1),replayed:true},error:null})),s=new EvaCorpusPublicationService({getClient:()=>({rpc})} as any,config(),{} as any),perform=jest.spyOn(s,'perform');
  await s.command(id(8),id(1),'publish',{requestId:id(7),expectedEventId:id(2),justification:'Owner verifies the complete reviewed publication.'});expect(perform).not.toHaveBeenCalled();
 });
 it('refuses all external work when delivered disabled',async()=>{
  const rpc=jest.fn(),s=new EvaCorpusPublicationService({getClient:()=>({rpc})} as any,config({EVA_CORPUS_PUBLICATION_CALLS_ENABLED:'false'}),{} as any);
  await expect(s.command(id(8),id(1),'publish',{requestId:id(7),expectedEventId:id(2),justification:'Owner verifies the complete reviewed publication.'})).rejects.toThrow('desligadas');expect(rpc).not.toHaveBeenCalled();
 });
 it('uses merge rather than upload and only the publication bit',async()=>{
  const c=new EvaSearchConnector(config());const request=jest.spyOn(c as any,'request').mockResolvedValue({value:[{key:searchDocumentId(id(3),h),status:true}]});await c.publish(id(3),h);
  expect(request).toHaveBeenCalledWith('INDEX','index',{value:[{'@search.action':'merge',id:searchDocumentId(id(3),h),published:true}]});
 });
});
function ragFixture(over:Record<string,string>={}){
 const t:any={organizationId:'org_default',userId:id(8),roleId:id(9),role:'admin_org',permissions:['62443ab1-9187-42e4-a932-a7cf54f76250']};
 const rpc=jest.fn(async(_name:string,a:any)=>({error:null,data:a.p_action==='sources'?[source()]:a.p_action==='hydrate'?[{...source(),chunkId:h,text,textHash:h,page:22,heading:'3.1',context:'Tabela integral'}]:{valid:true,recorded:true}}));
 const embeddings:any={embed:jest.fn(async()=>({tokens:8,vector}))},budget:any={reserve:jest.fn(async()=>({prices:{input:.02,output:0}})),settle:jest.fn(async()=>{})};
 const search:any={query:jest.fn(async()=>[{id:h,indexId:searchDocumentId(id(3),h),revisionId:id(4),contentHash:h,ranking:'RRF',score:.032}])};
 const s=new EvaPublishedRagService({getClient:()=>({rpc})} as any,config(over),search,embeddings,budget);return {t,rpc,embeddings,budget,search,s};
}
describe('Published RAG pilot',()=>{
 it('suppresses a normative answer that cites only generic product rules',async()=>{
  const f=ragFixture(),retrieved=await f.s.retrieve(f.t,'Qual regra de GD?',q),ai:any={available:async()=>true,interpret:jest.fn(async()=>({state:'READY',answer:'Uncited legal claim',evidence:[{id:'rule-0',label:'Generic',value:'x',source:'product'}]}))};
  const bot=new BotEnergyService({authorize:async()=>{}} as any,{} as any,ai,undefined,{retrieve:async()=>retrieved,revalidate:async()=>{}} as any);
  const r=await bot.answer(f.t,{question:'Qual regra de GD?'});expect(r.status).toBe('NO_EVIDENCE');expect(r.answer).not.toContain('Uncited legal claim');expect(r.sources).toEqual([]);
 });
 it('returns the actual page and official URL only for cited evidence',async()=>{
  const f=ragFixture(),retrieved=await f.s.retrieve(f.t,'Qual regra de GD?',q),ai:any={available:async()=>true,interpret:jest.fn(async()=>({state:'READY',answer:'Conferir a regra citada.',evidence:retrieved.evidence,model:'test',promptVersion:'test'}))};
  const bot=new BotEnergyService({authorize:async()=>{}} as any,{} as any,ai,undefined,{retrieve:async()=>retrieved,revalidate:async()=>{}} as any);
  const r=await bot.answer(f.t,{question:'Qual regra de GD?'});expect(r.status).toBe('SUPPORTED');expect(r.sources[0]).toMatchObject({url:source().url});expect(r.sources[0].reference).toContain('página 22');
 });
 it('preserves legacy and portal routing and validates pilot permissions/licence before retrieval',async()=>{
  const f=ragFixture(),legacy:any={retrieve:jest.fn(async()=>({state:'NO_EVIDENCE',evidence:[],sources:[]})),retrieveClient:jest.fn(async()=>({state:'NO_EVIDENCE',evidence:[],sources:[]}))},licenses:any={available:jest.fn(async()=>true)};
  const facade=new EvaKnowledgeRagService(legacy,f.s,licenses);
  await facade.retrieve({...f.t,organizationId:'other'},'Qual regra?',q);expect(legacy.retrieve).toHaveBeenCalledTimes(1);
  await facade.retrieveClient({...f.t,role:'consulta'},'Qual regra?',q,id(99));expect(legacy.retrieveClient).toHaveBeenCalledTimes(1);
  await expect(facade.retrieve({...f.t,permissions:[]},'Qual regra?',q)).rejects.toThrow('autorizado');expect(f.rpc).not.toHaveBeenCalled();
  licenses.available.mockResolvedValueOnce(false);await expect(facade.retrieve(f.t,'Qual regra?',q)).rejects.toThrow('licença');expect(f.rpc).not.toHaveBeenCalled();
  expect((await facade.retrieve(f.t,'Qual regra?',q)).state).toBe('READY');expect(legacy.retrieve).toHaveBeenCalledTimes(1);
 });
 it('revalidates before generation and suppresses an answer quarantined during generation',async()=>{
  const f=ragFixture(),retrieved=await f.s.retrieve(f.t,'Qual regra de GD?',q),revalidate=jest.fn(async()=>{});
  revalidate.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('Publication revoked'));
  const ai:any={available:async()=>true,interpret:jest.fn(async()=>({state:'READY',answer:'Must never be released',evidence:retrieved.evidence,model:'test',promptVersion:'test'}))};
  const bot=new BotEnergyService({authorize:async()=>{}} as any,{} as any,ai,undefined,{retrieve:async()=>retrieved,revalidate} as any);
  await expect(bot.answer(f.t,{question:'Qual regra de GD?'})).rejects.toThrow('Publication revoked');expect(revalidate).toHaveBeenCalledTimes(2);expect(ai.interpret).toHaveBeenCalledTimes(1);
 });
 it('does not call generation after the publication is already revoked',async()=>{
  const f=ragFixture(),retrieved=await f.s.retrieve(f.t,'Qual regra de GD?',q),ai:any={available:async()=>true,interpret:jest.fn()};
  const bot=new BotEnergyService({authorize:async()=>{}} as any,{} as any,ai,undefined,{retrieve:async()=>retrieved,revalidate:async()=>{throw Error('Publication revoked')}} as any);
  await expect(bot.answer(f.t,{question:'Qual regra de GD?'})).rejects.toThrow('Publication revoked');expect(ai.interpret).not.toHaveBeenCalled();
 });
 it('keeps all calls off by default and does not use the new path outside the pilot',async()=>{
  const f=ragFixture({EVA_SEARCH_RAG_ENABLED:'false'});expect((await f.s.retrieve(f.t,'Qual regra?',q)).state).toBe('NOT_CONFIGURED');expect(f.rpc).not.toHaveBeenCalled();
  expect(f.s.enabledFor({...f.t,organizationId:'other'})).toBe(false);expect(f.s.enabledFor({...f.t,role:'consulta'})).toBe(false);
 });
 it('does not pay for absent sources or ambiguous validity',async()=>{
  const f=ragFixture();f.rpc.mockResolvedValueOnce({data:[],error:null});expect((await f.s.retrieve(f.t,'Qual regra?',q)).state).toBe('NO_EVIDENCE');
  f.rpc.mockResolvedValueOnce({data:[{...source(),validFrom:'2026-10-15'}],error:null});expect((await f.s.retrieve(f.t,'Qual regra?',q)).state).toBe('VERSION_CONFLICT');expect(f.embeddings.embed).not.toHaveBeenCalled();
 });
 it('recognizes the CCEE corpus without an explicit ACL keyword, only inside the new path',async()=>{
  const f=ragFixture();await f.s.retrieve(f.t,'Quais os requisitos do varejista na CCEE?',{...q,market:'COMMON'});expect(f.rpc.mock.calls[0][1]).toMatchObject({p_action:'sources',p_body:{market:'ACL'}});
 });
 it('abstains on missing CCEE evidence in the pilot before generation',async()=>{
  const f=ragFixture(),ai:any={available:async()=>true,interpret:jest.fn()};
  const bot=new BotEnergyService({authorize:async()=>{}} as any,{} as any,ai,undefined,{publishedPilot:()=>true,retrieve:async()=>({state:'NO_EVIDENCE',evidence:[],sources:[]})} as any);
  const r=await bot.answer(f.t,{question:'Quais os requisitos do varejista na CCEE?'});expect(r.status).toBe('NO_EVIDENCE');expect(ai.interpret).not.toHaveBeenCalled();
 });
 it('reserves quota before embedding and hydrates canonical chunks without treating RRF as cosine',async()=>{
  const f=ragFixture(),r=await f.s.retrieve(f.t,'Qual regra?',q);expect(r.state).toBe('READY');expect(r.evidence[0].value).toBe(text);expect(r.sources[0]).toMatchObject({page:22,version:'1.0',url:source().url});expect(r.publicationProofs).toEqual([{publicationId:id(1),eventId:id(2)}]);
  expect(f.budget.reserve.mock.invocationCallOrder[0]).toBeLessThan(f.embeddings.embed.mock.invocationCallOrder[0]);expect(f.budget.settle).toHaveBeenCalledTimes(1);
  expect(f.rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_action:'finish',p_body:{state:'READY',embeddingCostMicroUsd:1,inputTokens:8,searchRequests:1}});
  expect(JSON.stringify(f.rpc.mock.calls.filter(x=>['begin','finish'].includes(x[1].p_action)))).not.toContain('Qual regra?');
 });
 it('never generates evidence from forged text or another revision',async()=>{
  const f=ragFixture(),original=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(n,a)=>a.p_action==='hydrate'?{data:[{...source(),chunkId:h,text:'forged',textHash:h,page:1,heading:'x',context:'x'}],error:null}:original(n,a));
  await expect(f.s.retrieve(f.t,'Qual regra?',q)).rejects.toThrow('evidências oficiais');expect(f.rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_body:{state:'FAILED'}});
 });
 it('rechecks live publications and does not cache retrieved sources',async()=>{
  const f=ragFixture();await f.s.retrieve(f.t,'Qual regra?',q);await f.s.retrieve(f.t,'Qual regra?',q);expect(f.embeddings.embed).toHaveBeenCalledTimes(2);await f.s.revalidate(f.t,[{publicationId:id(1),eventId:id(2)}]);
  f.rpc.mockResolvedValueOnce({data:null,error:{code:'23505'}} as any);await expect(f.s.revalidate(f.t,[{publicationId:id(1),eventId:id(2)}])).rejects.toThrow('alterada');
 });
 it('limits repeated paid requests per actor',async()=>{
  const f=ragFixture();for(let i=0;i<6;i++)await f.s.retrieve(f.t,'Qual regra?',q);await expect(f.s.retrieve(f.t,'Qual regra?',q)).rejects.toThrow('Aguarde');expect(f.embeddings.embed).toHaveBeenCalledTimes(6);
 });
});
