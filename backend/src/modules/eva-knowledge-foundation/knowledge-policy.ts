import {PERMISSIONS as P} from '../../common/constants/permissions';
import {Eligibility,EligibilityReason,KnowledgeCapability,KnowledgeReadContext,KnowledgeRequest,KnowledgeRevision,ProviderHit} from './knowledge-contracts';

const hash=(value:string)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function knowledgeDay(value:string){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
const stamp=(value:string|null)=>!!value&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));
const result=(reason:EligibilityReason):Eligibility=>({eligible:reason==='ELIGIBLE',reason});

/** Pure preview of future evidence admission; it grants no runtime capability. */
export function previewKnowledgeEligibility(actor:KnowledgeReadContext,query:KnowledgeRequest,revision:KnowledgeRevision):Eligibility{
 if(!actor?.verified||!actor.actorId?.trim()||!['BACKOFFICE','PORTAL','PLATFORM'].includes(actor.audience)||
  !Array.isArray(actor.permissions)||!Array.isArray(actor.licensedModules))return result('INVALID_CONTEXT');
 if(!knowledgeDay(query.periodStart)||!knowledgeDay(query.periodEnd)||query.periodStart>query.periodEnd)return result('INVALID_PERIOD');
 if(!actor.permissions.includes(P.INTELLIGENCE_AI_USE))return result('PERMISSION_DENIED');
 if(actor.audience!=='PLATFORM'&&(!actor.organizationId?.trim()||!actor.licenseCurrent||!actor.licensedModules.includes('bot_energy_rag')))return result('LICENSE_REQUIRED');
 if(!revision.audiences.includes(actor.audience))return result('AUDIENCE_DENIED');
 if(actor.audience==='PLATFORM'&&(!['OWNER','ADMINISTRATOR','FINANCE','SUPPORT'].includes(actor.platformProfile??'')||!revision.allowedPlatformProfiles.includes(actor.platformProfile!)))return result('PLATFORM_PROFILE_DENIED');
 if(revision.state!=='PUBLISHED'||!stamp(revision.publishedAt))return result('NOT_PUBLISHED');
 if(!revision.version.trim()||!revision.sourceId.trim()||!revision.section.trim()||!hash(revision.hash)||!hash(revision.contentHash)||
  !revision.reviewedBy?.trim()||!stamp(revision.reviewedAt)||!stamp(revision.publishedAt)||
  Date.parse(revision.reviewedAt!)>Date.parse(revision.publishedAt!)||
  !knowledgeDay(revision.validFrom)||revision.validTo!==null&&(!knowledgeDay(revision.validTo)||revision.validTo<=revision.validFrom)||
  revision.page!==null&&(!Number.isSafeInteger(revision.page)||revision.page<1))return result('INVALID_PROVENANCE');
 if(revision.validFrom>query.periodStart||revision.validTo!==null&&revision.validTo<=query.periodEnd)return result('VALIDITY_CONFLICT');
 if(revision.requiredPermissions.some(permission=>!actor.permissions.includes(permission)))return result('PERMISSION_DENIED');
 if(revision.requiredModules.some(module=>!actor.licensedModules.includes(module)))return result('MODULE_DENIED');
 if(revision.sourceKind==='PRODUCT_GUIDE'){
  if(!['PRODUCT','PLATFORM_INTERNAL'].includes(revision.scope))return result('INVALID_PROVENANCE');
  if(!revision.productRelease||revision.productRelease!==query.productRelease)return result('PRODUCT_VERSION_MISMATCH');
 }else if(revision.productRelease!==null)return result('INVALID_PROVENANCE');
 if(actor.audience==='PORTAL'){
  const binding=actor.unitBinding;
  if(!binding?.verified||!binding.customerId.trim()||!query.unitId||!binding.unitIds.includes(query.unitId))return result('UNIT_DENIED');
 }
 const hasPrivateScope=!!revision.organizationId||!!revision.customerId||!!revision.unitId;
 if(revision.scope==='OFFICIAL_PUBLIC'){
  if(revision.sourceKind!=='OFFICIAL'||hasPrivateScope||revision.productRelease!==null)return result('INVALID_PROVENANCE');
 }else if(revision.scope==='PRODUCT'){
  if(revision.sourceKind!=='PRODUCT_GUIDE'||hasPrivateScope)return result('INVALID_PROVENANCE');
  if(!revision.productRelease||revision.productRelease!==query.productRelease)return result('PRODUCT_VERSION_MISMATCH');
 }else if(revision.scope==='PLATFORM_INTERNAL'){
  if(actor.audience!=='PLATFORM'||!['OWNER','ADMINISTRATOR','FINANCE','SUPPORT'].includes(actor.platformProfile??'')||hasPrivateScope||revision.audiences.some(a=>a!=='PLATFORM'))return result('PLATFORM_PROFILE_DENIED');
 }else if(revision.scope==='ORGANIZATION'){
  if(!revision.organizationId||revision.customerId!==null||revision.unitId!==null||revision.audiences.includes('PORTAL'))return result('INVALID_PROVENANCE');
  if(actor.organizationId!==revision.organizationId||actor.audience!=='BACKOFFICE')return result('TENANT_DENIED');
 }else if(revision.scope==='CLIENT_UNIT'){
  if(!revision.organizationId||!revision.customerId||!revision.unitId)return result('INVALID_PROVENANCE');
  if(actor.organizationId!==revision.organizationId)return result('TENANT_DENIED');
  if(query.unitId!==revision.unitId)return result('UNIT_DENIED');
  if(actor.audience==='PLATFORM')return result('AUDIENCE_DENIED');
  if(!actor.unitBinding?.verified||actor.unitBinding.customerId!==revision.customerId||!actor.unitBinding.unitIds.includes(revision.unitId))return result('UNIT_DENIED');
 }else return result('INVALID_PROVENANCE');
 if(revision.sourceKind==='OPERATIONAL'&&revision.scope!=='CLIENT_UNIT'&&revision.scope!=='ORGANIZATION')return result('INVALID_PROVENANCE');
 return result('ELIGIBLE');
}

export type CuratorDelegation={actorId:string;scope:'PLATFORM'|'ORGANIZATION';organizationId:string|null;active:boolean;
 capabilities:readonly KnowledgeCapability[];grantedByOwner:string};
/** Existing AI_MANAGE alone is deliberately insufficient for new global governance. */
export function previewKnowledgeManagement(actor:KnowledgeReadContext,capability:KnowledgeCapability,scope:'PLATFORM'|'ORGANIZATION',organizationId:string|null,delegation?:CuratorDelegation){
 if(!actor.verified||!actor.actorId.trim())return false;
 if(scope==='PLATFORM'&&organizationId!==null||scope==='ORGANIZATION'&&!organizationId?.trim())return false;
 if(actor.audience==='PLATFORM'&&actor.platformProfile==='OWNER'&&scope==='PLATFORM')return true;
 if(capability==='COST_READ')return actor.audience==='PLATFORM'&&['OWNER','FINANCE'].includes(actor.platformProfile??'')&&scope==='PLATFORM';
 if(capability==='SOURCE_PUBLISH'||capability==='INDEX_CONFIGURE')return false;
 if(!delegation?.active||delegation.actorId!==actor.actorId||!delegation.grantedByOwner.trim()||delegation.scope!==scope||
  delegation.organizationId!==organizationId||!delegation.capabilities.includes(capability))return false;
 return scope==='PLATFORM'?actor.audience==='PLATFORM'&&['OWNER','ADMINISTRATOR'].includes(actor.platformProfile??''):
  actor.audience==='BACKOFFICE'&&actor.organizationId===organizationId;
}

export function validProviderHit(hit:ProviderHit){
 if(!hit.revisionId?.trim()||!hash(hit.contentHash))return false;
 if(hit.ranking==='DETERMINISTIC')return hit.score===null;
 if(typeof hit.score!=='number'||!Number.isFinite(hit.score))return false;
 if(hit.ranking==='COSINE')return hit.score>=-1&&hit.score<=1;
 if(hit.ranking==='RRF')return hit.score>=0; // No cosine threshold or invented legal confidence.
 if(hit.ranking==='SEMANTIC_RERANK')return hit.score>=0&&hit.score<=4;
 return false;
}
