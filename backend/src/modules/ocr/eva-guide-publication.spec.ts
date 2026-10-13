import {ForbiddenException,ServiceUnavailableException,BadRequestException,ConflictException} from '@nestjs/common';
import {EvaGuidePublicationService,hydrateGuidePublication,EVA_GUIDE_OWNER} from './eva-guide-publication.service';
import {EvaGuidePublicationController} from './eva-guide-publication.controller';
import {PRODUCT_GUIDE_DRAFTS} from './eva-product-guides';
import {EvaProductGuideService} from './eva-product-guide.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',g=PRODUCT_GUIDE_DRAFTS[0];
const seed={key:g.key,content:g.content,roles:g.roles,permissions:g.permissions,modules:g.modules,codeSnapshots:g.codeSnapshots};
const row=()=>({id,actor_id:other,guide_key:g.key,version:g.revision.version,release:g.revision.productRelease,document_hash:g.revision.hash,content_hash:g.revision.contentHash,snapshot:structuredClone(seed),created_at:'2026-10-12T12:00:00Z',state:'PUBLISHED',event_id:id});
function fixture(enabled=true){const rpc=jest.fn(async()=>({data:[],error:null} as any));return {rpc,service:new EvaGuidePublicationService({getClient:()=>({rpc})} as any,{get:()=>enabled?'true':'false'} as any)};}
const body={requestId:id,expectedEventId:null,expectedDocumentHash:g.revision.hash,justification:'Conferência sintética dos textos e limites.'};
describe('EVA authenticated publication boundary',()=>{
 it('ships drafts and does not manufacture approval on enablement',async()=>{const f=fixture();expect(await f.service.resolve(g)).toBeNull();expect(PRODUCT_GUIDE_DRAFTS.every(g=>g.revision.state==='DRAFT')).toBe(true)});
 it('does not access the database while disabled',async()=>{const f=fixture(false);await expect(f.service.list(id)).rejects.toBeInstanceOf(ServiceUnavailableException);await expect(f.service.command(id,g.key,'publish',body)).rejects.toBeInstanceOf(ServiceUnavailableException);expect(await f.service.resolve(g)).toBeNull();expect(f.rpc).not.toHaveBeenCalled()});
 it.each(['42501','23505','22023','XX000'])('sanitizes %s from the database',async code=>{const f=fixture();f.rpc.mockResolvedValue({error:{code,message:'private secret'}});await expect(f.service.list(id)).rejects.toThrow(code==='42501'?ForbiddenException:code==='23505'?ConflictException:code==='22023'?BadRequestException:ServiceUnavailableException)});
 it.each([{actorId:other},{profile:'OWNER'},{snapshot:{}},{documentHash:'a'.repeat(64)},{organizationId:other}])('rejects forged fields %j',async extra=>{const f=fixture();await expect(f.service.command(id,g.key,'publish',{...body,...extra})).rejects.toBeInstanceOf(BadRequestException);expect(f.rpc).not.toHaveBeenCalled()});
 it('pins the hash seen by the Owner',async()=>{const f=fixture();await expect(f.service.command(id,g.key,'publish',{...body,expectedDocumentHash:'a'.repeat(64)})).rejects.toBeInstanceOf(BadRequestException);expect(f.rpc).not.toHaveBeenCalled()});
 it('derives snapshot and authenticated author server-side',async()=>{const f=fixture();await f.service.command(other,g.key,'publish',body);expect(f.rpc).toHaveBeenCalledWith('eva_product_guide_admin_action',{p_actor:other,p_action:'publish',p_body:expect.objectContaining({snapshot:seed,documentHash:g.revision.hash})})});
 it.each([{page:'-1'},{page:'1001'},{search:'x'.repeat(101)},{state:'DELETED'},{actor:id}])('rejects filters %j',async q=>{const f=fixture();await expect(f.service.list(id,q)).rejects.toBeInstanceOf(BadRequestException);expect(f.rpc).not.toHaveBeenCalled()});
 it('paginates and filters the catalog without exposing full text in rows',async()=>{const f=fixture();const first=await f.service.list(id);expect(first.total).toBe(8);expect(first.rows).toHaveLength(5);expect(first.rows[0]).not.toHaveProperty('content');expect((await f.service.list(id,{page:'1'})).rows).toHaveLength(3);expect((await f.service.list(id,{state:'PUBLISHED'})).total).toBe(0)});
 it('marks stale records instead of admitting old text',async()=>{const f=fixture();f.rpc.mockResolvedValue({data:[{...row(),document_hash:'a'.repeat(64)}],error:null});expect((await f.service.list(id)).rows[0].state).toBe('STALE')});
 it('accepts jsonb object reordering without changing arrays',()=>{const value=row();value.snapshot=JSON.parse(JSON.stringify(value.snapshot,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));expect(hydrateGuidePublication(g,value)?.revision.reviewedBy).toBe(other);value.snapshot.content.steps=[...value.snapshot.content.steps].reverse();expect(hydrateGuidePublication(g,value)).toBeNull()});
 it.each(['state','actor_id','id','guide_key','version','release','document_hash','content_hash','snapshot'])('rejects corrupted %s',field=>{const r:any=row();r[field]=field==='snapshot'?{...seed,permissions:[]}:field==='state'?'QUARANTINED':'invalid';expect(hydrateGuidePublication(g,r)).toBeNull()});
 it('keeps SQL publication failures closed at response time',async()=>{
  const t:any={scope:'organization',role:'admin_org',userId:id,organizationId:other,permissions:Object.values(P)};
  const licenses:any={resolveEffectiveLicense:jest.fn(async()=>({organization_id:other,active:true,status:'active',start_date:'2026-01-01',end_date:null,bot_energy_rag:true,document_management:true,free_market_management:true}))};
  const resolve=jest.fn(async()=>{throw Error('secret')});const service=new EvaProductGuideService(licenses,{enabled:true,organizations:[other]},undefined,()=>new Date('2026-10-13T12:00:00Z'),{resolve});
  expect(await service.topics(t)).toEqual([]);const reply=await service.answer(t,{topic:g.key});expect(reply?.status).toBe('UNAVAILABLE');expect(JSON.stringify(reply)).not.toContain('secret');expect(reply?.sources).toEqual([]);
  const blocked=new EvaProductGuideService(licenses,{enabled:false,organizations:[other]},undefined,undefined,{resolve});resolve.mockClear();expect(await blocked.answer(t,{topic:g.key})).toBeNull();expect(resolve).not.toHaveBeenCalled();
 });
 it('requires Owner on every method and uses the authenticated ID',async()=>{
  for(const name of ['list','detail','publish','quarantine'])expect(Reflect.getMetadata('permissions_required',EvaGuidePublicationController.prototype[name as keyof EvaGuidePublicationController])).toEqual([EVA_GUIDE_OWNER]);
  const service:any={command:jest.fn()};new EvaGuidePublicationController(service).publish({authenticatedUser:{userId:other}} as any,g.key,body);expect(service.command).toHaveBeenCalledWith(other,g.key,'publish',body);
 });
});
