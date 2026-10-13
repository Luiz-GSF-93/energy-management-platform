import {PERMISSIONS as P} from '../../common/constants/permissions';
import {foundationRetrievalPlan,FOUNDATION_RUNTIME,KnowledgeReadContext,KnowledgeRevision} from './knowledge-contracts';
import {previewKnowledgeEligibility as admit,previewKnowledgeManagement as manage,validProviderHit,knowledgeDay} from './knowledge-policy';
import {MODULE_GUIDE_CATALOG,MODULE_CATALOG_RELEASE} from './module-catalog';
import {SOURCE_CATALOG,knownOfficialDiscoveryUrl} from './source-catalog';
import {existsSync,readFileSync,readdirSync} from 'fs';
import {resolve} from 'path';
const actor:KnowledgeReadContext={verified:true,actorId:'operator',audience:'BACKOFFICE',organizationId:'org-a',permissions:[P.INTELLIGENCE_AI_USE],licensedModules:['bot_energy_rag'],licenseCurrent:true};
const query={periodStart:'2026-10-01',periodEnd:'2026-10-31',productRelease:'release-a',unitId:'unit-a'};
const revision:KnowledgeRevision={id:'rev-a',sourceKind:'OFFICIAL',scope:'OFFICIAL_PUBLIC',organizationId:null,customerId:null,unitId:null,audiences:['BACKOFFICE','PORTAL'],allowedPlatformProfiles:[],state:'PUBLISHED',version:'v1',hash:'a'.repeat(64),contentHash:'b'.repeat(64),reviewedBy:'reviewer',reviewedAt:'2026-09-01T00:00:00Z',publishedAt:'2026-09-02T00:00:00Z',validFrom:'2026-01-01',validTo:null,productRelease:null,requiredPermissions:[],requiredModules:[],sourceId:'aneel',section:'article 1',page:1};
const privateRevision:KnowledgeRevision={...revision,scope:'CLIENT_UNIT',sourceKind:'OPERATIONAL',organizationId:'org-a',customerId:'customer-a',unitId:'unit-a'};
const bound:KnowledgeReadContext={...actor,unitBinding:{verified:true,customerId:'customer-a',unitIds:['unit-a']}};
const portal:KnowledgeReadContext={...bound,audience:'PORTAL'};
describe('EVA knowledge Phase 0 preview isolation',()=>{
 it('stays disabled without any side effect port',()=>{expect(FOUNDATION_RUNTIME).toEqual({enabled:false,externalCalls:false,ingestion:false,productionMigration:false});expect(foundationRetrievalPlan()).toMatchObject({state:'DISABLED',externalRequests:0,databaseWrites:0,selectedRevisionIds:[]});});
 it('accepts official published applicable evidence',()=>expect(admit(actor,query,revision).eligible).toBe(true));
 it.each(['DRAFT','REVIEWED','QUARANTINED','RETIRED'] as const)('rejects %s',state=>expect(admit(actor,query,{...revision,state}).reason).toBe('NOT_PUBLISHED'));
 it.each([
  ['forged context',{verified:false},'INVALID_CONTEXT'],['missing AI permission',{permissions:[]},'PERMISSION_DENIED'],
  ['expired license',{licenseCurrent:false},'LICENSE_REQUIRED'],['module disabled',{licensedModules:[]},'LICENSE_REQUIRED'],
  ['missing tenant',{organizationId:null},'LICENSE_REQUIRED'],
 ] as const)('rejects %s',(_name,patch,reason)=>expect(admit({...actor,...patch},query,revision).reason).toBe(reason));
 it.each([
  ['bad hash',{hash:'invalid'}],['missing reviewer',{reviewedBy:null}],['missing section',{section:''}],['invalid page',{page:0}],
  ['review after publication',{reviewedAt:'2026-10-02T00:00:00Z'}],['invalid validity',{validFrom:'2026-02-30'}],
  ['public classified private',{organizationId:'org-a'}],['operational public',{sourceKind:'OPERATIONAL'}],
 ] as const)('blocks provenance %s',(_name,patch)=>expect(admit(actor,query,{...revision,...patch}).reason).toBe('INVALID_PROVENANCE'));
 it.each([{periodStart:'2026-02-30'},{periodStart:'2026-11-01'},{periodEnd:'2026-02-01'}])('rejects invalid query dates %j',patch=>expect(admit(actor,{...query,...patch},revision).reason).toBe('INVALID_PERIOD'));
 it('rejects a version that does not cover the entire historical period',()=>{expect(admit(actor,query,{...revision,validFrom:'2026-10-15'}).reason).toBe('VALIDITY_CONFLICT');expect(admit(actor,query,{...revision,validTo:'2026-10-31'}).reason).toBe('VALIDITY_CONFLICT');expect(admit(actor,query,{...revision,validTo:'2026-11-01'}).eligible).toBe(true);});
 it('requires matching reviewed product release',()=>{const r:KnowledgeRevision={...revision,sourceKind:'PRODUCT_GUIDE',scope:'PRODUCT',productRelease:'release-b'};expect(admit(actor,query,r).reason).toBe('PRODUCT_VERSION_MISMATCH');expect(admit(actor,query,{...r,productRelease:'release-a'}).eligible).toBe(true);});
 it('checks the release of private platform product guides too',()=>{const r:KnowledgeRevision={...revision,sourceKind:'PRODUCT_GUIDE',scope:'PLATFORM_INTERNAL',audiences:['PLATFORM'],allowedPlatformProfiles:['OWNER'],productRelease:'release-b'};const owner:KnowledgeReadContext={...actor,audience:'PLATFORM',platformProfile:'OWNER'};expect(admit(owner,query,r).reason).toBe('PRODUCT_VERSION_MISMATCH');expect(admit(owner,query,{...r,productRelease:'release-a'}).eligible).toBe(true);});
 it('does not bypass additional resource permission or license',()=>{expect(admit(actor,query,{...revision,requiredPermissions:['resource-permission']}).reason).toBe('PERMISSION_DENIED');expect(admit(actor,query,{...revision,requiredModules:['trading_hub']}).reason).toBe('MODULE_DENIED');});
 it('requires verified binding even in backoffice',()=>{expect(admit(actor,query,privateRevision).reason).toBe('UNIT_DENIED');expect(admit(bound,query,privateRevision).eligible).toBe(true);});
 it('isolates organizations',()=>expect(admit({...bound,organizationId:'org-b'},query,privateRevision).reason).toBe('TENANT_DENIED'));
 it.each(['BACKOFFICE','PORTAL'] as const)('isolates customers and units in %s',audience=>{
  expect(admit({...bound,audience,unitBinding:{verified:true,customerId:'customer-b',unitIds:['unit-a']}},query,privateRevision).reason).toBe('UNIT_DENIED');
  expect(admit({...bound,audience,unitBinding:{verified:true,customerId:'customer-a',unitIds:['unit-b']}},query,privateRevision).reason).toBe('UNIT_DENIED');
  expect(admit({...bound,audience,unitBinding:{verified:false,customerId:'customer-a',unitIds:['unit-a']}},query,privateRevision).reason).toBe('UNIT_DENIED');
 });
 it('admits only published scoped portal data',()=>{expect(admit(portal,query,privateRevision).eligible).toBe(true);expect(admit(portal,query,{...privateRevision,state:'REVIEWED'}).eligible).toBe(false);expect(admit({...portal,unitBinding:undefined},query,revision).reason).toBe('UNIT_DENIED');});
 it('never exposes organization manuals to portal',()=>expect(admit(portal,query,{...revision,sourceKind:'SPECIALIST',scope:'ORGANIZATION',organizationId:'org-a',audiences:['BACKOFFICE']}).reason).toBe('AUDIENCE_DENIED'));
 it('requires known and explicitly allowed platform profile for internal evidence',()=>{const r:KnowledgeRevision={...revision,scope:'PLATFORM_INTERNAL',sourceKind:'SPECIALIST',audiences:['PLATFORM'],allowedPlatformProfiles:['SUPPORT']};expect(admit(actor,query,r).eligible).toBe(false);expect(admit({...actor,audience:'PLATFORM',platformProfile:'SUPPORT'},query,r).eligible).toBe(true);expect(admit({...actor,audience:'PLATFORM',platformProfile:'ROOT' as any},query,r).reason).toBe('PLATFORM_PROFILE_DENIED');expect(admit({...actor,audience:'PLATFORM',platformProfile:'SUPPORT'},query,{...r,allowedPlatformProfiles:['OWNER']}).reason).toBe('PLATFORM_PROFILE_DENIED');});
 it.each(['OWNER','ADMINISTRATOR','FINANCE','SUPPORT'] as const)('limits management for %s',platformProfile=>{
  const a:KnowledgeReadContext={...actor,audience:'PLATFORM',organizationId:null,platformProfile};
  expect(manage(a,'SOURCE_PUBLISH','PLATFORM',null)).toBe(platformProfile==='OWNER');
  expect(manage(a,'COST_READ','PLATFORM',null)).toBe(['OWNER','FINANCE'].includes(platformProfile));
  expect(manage(a,'SOURCE_REVIEW','PLATFORM',null)).toBe(platformProfile==='OWNER');
 });
 it('existing AI_MANAGE cannot confer global curation',()=>expect(manage({...actor,permissions:[P.INTELLIGENCE_AI_MANAGE]},'SOURCE_REVIEW','PLATFORM',null)).toBe(false));
 it('delegation is explicit, active, tenant-bound and cannot grant publication',()=>{
  const d={actorId:'operator',scope:'ORGANIZATION' as const,organizationId:'org-a',active:true,capabilities:['SOURCE_REVIEW' as const],grantedByOwner:'owner'};
  expect(manage(actor,'SOURCE_REVIEW','ORGANIZATION','org-a',d)).toBe(true);
  expect(manage(actor,'SOURCE_REVIEW','ORGANIZATION','org-b',d)).toBe(false);
  expect(manage(actor,'SOURCE_REVIEW','ORGANIZATION','org-a',{...d,active:false})).toBe(false);
  expect(manage(actor,'SOURCE_PUBLISH','ORGANIZATION','org-a',{...d,capabilities:['SOURCE_PUBLISH']})).toBe(false);
 });
 it.each([['RRF',0.03,true],['COSINE',0.03,true],['COSINE',1.1,false],['SEMANTIC_RERANK',4,true],['SEMANTIC_RERANK',4.1,false],['RRF',NaN,false],['DETERMINISTIC',null,true],['DETERMINISTIC',1,false]] as const)('keeps native ranking %s %s', (ranking,score,expected)=>expect(validProviderHit({revisionId:'r',contentHash:'a'.repeat(64),ranking,score})).toBe(expected));
 it('requires actual calendar days',()=>{expect(knowledgeDay('2024-02-29')).toBe(true);expect(knowledgeDay('2025-02-29')).toBe(false);});
 it('catalog includes every backend module with draft guide and preserves blockers',()=>{
  const repo=resolve(__dirname,'../../../..');
  const modules=readdirSync(resolve(repo,'backend/src/modules'),{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name!=='eva-knowledge-foundation').map(d=>d.name).sort();
  expect(MODULE_GUIDE_CATALOG.filter(g=>g.backendPath).map(g=>g.key).sort()).toEqual(modules);
  for(const g of MODULE_GUIDE_CATALOG){expect(g.reviewed).toBe(false);expect(g.guideState).toBe('DRAFT');if(g.backendPath)expect(existsSync(resolve(repo,g.backendPath))).toBe(true);}
  expect(MODULE_CATALOG_RELEASE).toMatch(/^[a-f0-9]{40}$/);
  expect(MODULE_GUIDE_CATALOG.find(g=>g.key==='gd')?.implementationState).toBe('PLANNED');
  expect(MODULE_GUIDE_CATALOG.find(g=>g.key==='ccee')?.implementationState).toBe('EXTERNAL_BLOCKER');
  expect(readFileSync(resolve(repo,'backend/src/app.module.ts'),'utf8')).not.toContain('eva-knowledge-foundation');
 });
 it('source portals remain discovery references, not indexed evidence',()=>{expect(SOURCE_CATALOG.length).toBeGreaterThanOrEqual(12);expect(knownOfficialDiscoveryUrl('ANEEL','https://www.gov.br/aneel/pt-br')).toBe(true);expect(knownOfficialDiscoveryUrl('ANEEL','https://www.gov.br/evil')).toBe(false);expect(knownOfficialDiscoveryUrl('CCEE','https://www.ccee.org.br.evil.test/')).toBe(false);expect(knownOfficialDiscoveryUrl('CCEE','https://user:secret@www.ccee.org.br/')).toBe(false);});
});
