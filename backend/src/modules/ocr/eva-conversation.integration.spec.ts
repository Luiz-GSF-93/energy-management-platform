import {ConfigService} from '@nestjs/config';
import {AzureBackofficeAiConnector} from './azure-backoffice-ai.connector';
import {BackofficeAiService} from './backoffice-ai.service';
import {BotEnergyBudgetService} from './bot-energy-budget.service';
import {BotEnergyService} from './bot-energy.service';
import {EvaKnowledgeRagService} from './eva-knowledge-rag.service';
import {EvaPublishedRagService} from './eva-published-rag.service';
import {knowledgeTextHash} from './bot-energy-knowledge';
import {PERMISSIONS as P} from '../../common/constants/permissions';

// Reconstructed test material, not a new verification of the actual official PDF.
const text='Fixture sintético CCEE: validação do agente conectado em 5 dias úteis. Item 3.16.';
const hash=knowledgeTextHash(text),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={BOT_ENERGY_LICENSE_MODE:'true',BOT_ENERGY_AZURE_PRICES_VERIFIED:'true',BOT_ENERGY_AZURE_CHAT_INPUT_USD_PER_MILLION:'0.30',BOT_ENERGY_AZURE_CHAT_OUTPUT_USD_PER_MILLION:'1.00',BOT_ENERGY_AZURE_EMBEDDING_INPUT_USD_PER_MILLION:'0.03'};

function fixture(){
 const tenant:any={scope:'organization',organizationId:'org_default',userId:id(8),roleId:id(9),role:'operacional',permissions:[P.INTELLIGENCE_AI_USE]};
 const source={publicationId:id(1),publicationEventId:id(2),releaseId:id(3),revisionId:id(4),documentId:id(5),title:'PdC CCEE (fixture)',version:'1.0',url:'https://www.ccee.org.br/test.pdf',family:'CCEE_PROCEDURES',authority:'CCEE',markets:['ACL'],validFrom:'2025-01-01',validTo:null,topic:'Validação do agente conectado (sintético)',fileHash:'a'.repeat(64),reviewedAt:'2026-10-01T10:00:00Z',reviewedBy:id(6),chunkTotal:1};
 const control={sources:true,revoked:false,forge:false,settlementFails:false,output:'supported',timeout:false,revokeDuringGeneration:false};
 const ledger=new Map<string,{kind:string;state:string;reserved:number;actual?:number;settlements:number}>(),events:any[]=[];
 const rpc=jest.fn(async(name:string,a:any):Promise<any>=>{
  if(name==='reserve_bot_energy_ai_usage_v2'){
   expect(ledger.has(a.p_id)).toBe(false);ledger.set(a.p_id,{kind:a.p_kind,state:'RESERVED',reserved:a.p_reserved_micro_usd,settlements:0});return {data:true,error:null};
  }
  if(name==='settle_bot_energy_ai_usage'){
   const entry=ledger.get(a.p_id)!;
   if(control.settlementFails&&entry.kind==='conversation')return {data:false,error:null};
   expect(entry.state).toBe('RESERVED');entry.state='SETTLED';entry.actual=a.p_actual_micro_usd;entry.settlements++;return {data:true,error:null};
  }
  if(name!=='eva_corpus_rag')throw Error('Unexpected RPC '+name);
  events.push(a);
  switch(a.p_action){
   case 'sources':return {data:control.sources&&a.p_body.market==='ACL'?[source]:[],error:null};
   case 'hydrate':return {data:[{...source,chunkId:hash,text:control.forge?'forged':text,textHash:hash,page:7,heading:'3.16',context:'Fixture sintético'}],error:null};
   case 'revalidate':return {data:{valid:!control.revoked},error:null};
   case 'begin':case 'finish':return {data:{recorded:true},error:null};
   default:throw Error('Unexpected action');
  }
 });
 const db:any={getClient:()=>({rpc})},budget=new BotEnergyBudgetService(db),audit={logCreate:jest.fn(async()=>{})};
 const embeddings={embed:jest.fn(async()=>({tokens:8,vector:Array(1536).fill(.125)}))};
 const search={query:jest.fn(async()=>[{id:hash,revisionId:id(4),contentHash:hash,score:.032}])};
 const config=new ConfigService({EVA_SEARCH_RAG_ENABLED:'true',EVA_SEARCH_RAG_ORGANIZATIONS:'org_default',EVA_SEARCH_QUERY_CALLS_ENABLED:'true',EVA_SEARCH_EMBEDDING_CALLS_ENABLED:'true',EVA_SEARCH_INDEX:'eva-official-pilot-v1'});
 const published=new EvaPublishedRagService(db,config,search as any,embeddings as any,budget);
 const licenses={available:jest.fn(async(org:string)=>org==='org_default')};
 const legacy={retrieve:jest.fn(async()=>({state:'NO_EVIDENCE',sources:[],evidence:[]})),retrieveClient:jest.fn(async()=>({state:'NO_EVIDENCE',sources:[],evidence:[]}))};
 const rag=new EvaKnowledgeRagService(legacy as any,published,licenses as any);
 const transport=jest.fn(async(_url:any,init:any)=>{
  if(control.timeout)throw Object.assign(Error('synthetic timeout'),{name:'TimeoutError'});
  if(control.revokeDuringGeneration)control.revoked=true;
  const pack=JSON.parse(JSON.parse(init.body).messages[1].content),official=pack.evidence.find((e:any)=>e.id.startsWith('regulation-'));
  const result={supported:control.output!=='abstain',answer:control.output==='number'?'Prazo de 99999 dias.':control.output==='abstain'?'Preciso de mais contexto.':control.output==='documents'?'Confira o trecho oficial citado para o perfil informado.':'Prazo de 5 dias úteis.',citations:control.output==='abstain'?[]:[control.output==='generic'?'rule-0':official.id],fields:[],doubts:[]};
  return new Response(JSON.stringify({model:'synthetic-model',usage:control.output==='invalidUsage'?null:{prompt_tokens:80,completion_tokens:20},choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}));
 });
 const connector=new AzureBackofficeAiConnector({enabled:true,organizations:[],licenseMode:true,endpoint:'https://test.openai.azure.com',deployment:'test',key:'synthetic-key'},transport as any);
 const ai=new BackofficeAiService(connector,audit as any,budget,licenses as any);
 const bot=new BotEnergyService({authorize:jest.fn(async()=>{})} as any,{} as any,ai,undefined,rag);
 const ask=(question='Qual o prazo de validação do agente conectado na CCEE?',previousQuestion?:string)=>bot.answer(tenant,{question,...(previousQuestion?{previousQuestion}:{})});
 return {tenant,source,control,ledger,events,rpc,embeddings,search,licenses,legacy,rag,transport,audit,bot,ask};
}

describe('EVA offline response chain with real services and synthetic boundaries',()=>{
 const saved=new Map(Object.keys(env).map(k=>[k,process.env[k]]));
 beforeEach(()=>{Object.assign(process.env,env);jest.spyOn(globalThis,'fetch').mockImplementation(async()=>{throw Error('LIVE NETWORK FORBIDDEN');});});
 afterEach(()=>{try{expect(globalThis.fetch).not.toHaveBeenCalled();}finally{jest.restoreAllMocks();for(const [k,v] of saved)if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 it('answers a follow-up using fresh sources and settles embedding and generation once',async()=>{
  const f=fixture(),r=await f.ask('E o prazo?','Como funciona a validação do agente conectado na CCEE?');
  expect(r.status).toBe('SUPPORTED');expect(r.sources[0]).toMatchObject({url:f.source.url});expect(r.sources[0].reference).toContain('página 7');expect(r.sources[0].reference).toContain('Versão 1.0');expect(r.sources[0].label).toContain('3.16');
  const body=JSON.parse(f.transport.mock.calls[0][1].body),pack=JSON.parse(body.messages[1].content);
  expect(pack.question).toContain('Continuação: E o prazo?');expect(body.store).toBe(false);expect(body.tools).toBeUndefined();
  expect([...f.ledger.values()]).toEqual(expect.arrayContaining([expect.objectContaining({kind:'conversation',state:'SETTLED',actual:44,settlements:1}),expect.objectContaining({kind:'embeddings',state:'SETTLED',actual:1,settlements:1})]));
  expect(f.events.filter(e=>e.p_action==='revalidate')).toHaveLength(2);expect(globalThis.fetch).not.toHaveBeenCalled();
 });
 it('suppresses ungrounded numbers without refunding or settling generation',async()=>{
  const f=fixture();f.control.output='number';const r=await f.ask();
  expect(r.status).toBe('UNAVAILABLE');expect(JSON.stringify(r)).not.toContain('99999');
  expect([...f.ledger.values()].find(e=>e.kind==='conversation')).toMatchObject({state:'RESERVED',settlements:0});
  expect(f.audit.logCreate.mock.calls.flat().some((e:any)=>e.after.errorCode==='UNGROUNDED_NUMBER')).toBe(true);expect(f.transport).toHaveBeenCalledTimes(1);
 });
 it.each(['timeout','invalidUsage','settlement'])('preserves pending consumption after %s without retry',async failure=>{
  const f=fixture();f.control.timeout=failure==='timeout';f.control.output=failure==='invalidUsage'?'invalidUsage':'supported';f.control.settlementFails=failure==='settlement';
  expect((await f.ask()).status).toBe('UNAVAILABLE');expect([...f.ledger.values()].find(e=>e.kind==='conversation')).toMatchObject({state:'RESERVED',settlements:0});expect(f.transport).toHaveBeenCalledTimes(1);
 });
 it('distinguishes retrieved CCEE sources from a provider abstention and settles proved usage',async()=>{
  const f=fixture();f.control.output='abstain';const r=await f.ask();expect(r.status).toBe('CONTEXT_REQUIRED');expect(r.answer).toContain('Localizei trechos oficiais da CCEE');expect(r.sources[0].label).toContain('Trecho recuperado para conferência');expect([...f.ledger.values()].find(e=>e.kind==='conversation')).toMatchObject({state:'SETTLED',actual:44,settlements:1});expect(r.items).toEqual([]);
 });
 it('clarifies the exact reported question and resumes retrieval after a short profile answer',async()=>{
  const f=fixture(),question='quais documentos para ser agente na ccee';
  const clarification=await f.ask(question);expect(clarification.status).toBe('CONTEXT_REQUIRED');expect(clarification.answer).toContain('consumidor');expect(f.transport).not.toHaveBeenCalled();expect(f.ledger.size).toBe(0);
  f.control.output='documents';const result=await f.ask('consumidor',clarification.conversationQuestion);
  expect(result.status).toBe('SUPPORTED');const pack=JSON.parse(JSON.parse(f.transport.mock.calls[0][1].body).messages[1].content);expect(pack.question).toContain(question);expect(pack.question).toContain('Continuação: consumidor');expect(result.sources[0].url).toBe(f.source.url);
 });
 it.each(['Quais as regras oficiais de GD?','Qual o prazo da CCEE?'])('does not generate without applicable evidence: %s',async question=>{
  const f=fixture();f.control.sources=false;expect((await f.ask(question)).status).toBe('NO_EVIDENCE');expect(f.transport).not.toHaveBeenCalled();expect(f.embeddings.embed).not.toHaveBeenCalled();expect(f.ledger.size).toBe(0);
 });
 it('rejects a generic product citation for a normative answer',async()=>{
  const f=fixture();f.control.output='generic';const r=await f.ask();expect(r.status).not.toBe('SUPPORTED');expect(r.sources).toEqual([]);
 });
 it('suppresses an otherwise valid response revoked during generation, preserving proved usage',async()=>{
  const f=fixture();f.control.revokeDuringGeneration=true;await expect(f.ask()).rejects.toThrow('alterada');expect(f.transport).toHaveBeenCalledTimes(1);expect([...f.ledger.values()].find(e=>e.kind==='conversation')).toMatchObject({state:'SETTLED',settlements:1});
 });
 it('rejects forged canonical text before generation',async()=>{
  const f=fixture();f.control.forge=true;await expect(f.ask()).rejects.toThrow('evidências');expect(f.transport).not.toHaveBeenCalled();
 });
 it('does not generate when a publication has already been revoked',async()=>{
  const f=fixture();f.control.revoked=true;await expect(f.ask()).rejects.toThrow('alterada');expect(f.transport).not.toHaveBeenCalled();expect([...f.ledger.values()].some(e=>e.kind==='conversation')).toBe(false);
 });
 it('rechecks sources and keeps prior user numbers out of the evidence pack',async()=>{
  const f=fixture();f.control.output='number';await f.ask('E o prazo?','Na CCEE, seria 99999 dias?');
  expect(f.audit.logCreate.mock.calls.flat().some((e:any)=>e.after.errorCode==='UNGROUNDED_NUMBER')).toBe(true);
  const pack=JSON.parse(JSON.parse(f.transport.mock.calls[0][1].body).messages[1].content);expect(JSON.stringify(pack.evidence)).not.toContain('99999');
  f.control.sources=false;expect((await f.ask()).status).toBe('NO_EVIDENCE');expect(f.transport).toHaveBeenCalledTimes(1);
 });
 it('keeps other organizations and Portal on legacy routing and rejects missing rights/licence',async()=>{
  const f=fixture(),period={periodStart:'2026-10-15',periodEnd:'2026-10-15',market:'ACL' as const};
  await f.rag.retrieve({...f.tenant,organizationId:'other'},'CCEE',period);await f.rag.retrieveClient({...f.tenant,role:'consulta'},'CCEE',period,'unit');expect(f.legacy.retrieve).toHaveBeenCalledTimes(1);expect(f.legacy.retrieveClient).toHaveBeenCalledTimes(1);
  await expect(f.bot.answer({...f.tenant,permissions:[]},{question:'E o prazo?',previousQuestion:'CCEE'})).rejects.toThrow('permissão');
  f.licenses.available.mockResolvedValue(false);await expect(f.rag.retrieve(f.tenant,'CCEE',period)).rejects.toThrow('licença');
  expect(f.transport).not.toHaveBeenCalled();expect(f.embeddings.embed).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
 });
});
