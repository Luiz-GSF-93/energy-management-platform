import {createHash} from 'node:crypto';
import {KnowledgeReadContext, KnowledgeRevision, KnowledgeRequest} from '../eva-knowledge-foundation/knowledge-contracts';
import {previewKnowledgeEligibility} from '../eva-knowledge-foundation/knowledge-policy';

export const PRODUCT_GUIDE_RELEASE = 'energyos-product-guides-v1';
export type GuideContent = {
 title:string; questions:readonly string[]; steps:readonly string[]; limits:readonly string[];
 links:readonly {label:string;url:string}[];
};
export type GuideSeed = {
 key:string; content:GuideContent; roles:readonly string[];
 permissions:readonly string[]; modules:readonly string[];
 codeSnapshots:readonly {path:string;sha256:string}[];
};
export type ProductGuide = GuideSeed & {
 revision:KnowledgeRevision;
 review:null|{reference:string;documentHash:string;contentHash:string};
};
export const productGuideContentHash = (content:GuideContent) => createHash('sha256').update(JSON.stringify({
 title:content.title,questions:content.questions,steps:content.steps,limits:content.limits,links:content.links,
})).digest('hex');
export const productGuideDocumentHash = (guide:GuideSeed, version='1', release=PRODUCT_GUIDE_RELEASE, validFrom='2026-10-12', validTo:string|null=null) => createHash('sha256').update(JSON.stringify({
 key:guide.key,contentHash:productGuideContentHash(guide.content),roles:guide.roles,
 permissions:guide.permissions,modules:guide.modules,codeSnapshots:guide.codeSnapshots,version,release,validFrom,validTo,
})).digest('hex');

function freeze<T>(value:T):T {
 if(value && typeof value==='object'){
  Object.values(value).forEach(child=>freeze(child));
  Object.freeze(value);
 }
 return value;
}
/** Always creates a draft. There is no publication command or invented reviewer. */
export function draftProductGuide(seed:GuideSeed):ProductGuide {
 return freeze({...seed,review:null,revision:{
  id:seed.key+'-v1',sourceKind:'PRODUCT_GUIDE',scope:'PRODUCT',organizationId:null,customerId:null,unitId:null,
  audiences:['BACKOFFICE'],allowedPlatformProfiles:[],state:'DRAFT',version:'1',
  hash:productGuideDocumentHash(seed),contentHash:productGuideContentHash(seed.content),
  reviewedBy:null,reviewedAt:null,publishedAt:null,validFrom:'2026-10-12',validTo:null,
  productRelease:PRODUCT_GUIDE_RELEASE,requiredPermissions:seed.permissions,requiredModules:seed.modules,
  sourceId:'energyos-product-guides',section:seed.content.title,page:null,
 }});
}

const ROUTES = new Set([
 '/backoffice/setup','/backoffice/documents','/backoffice/ocr-audit','/backoffice/contracts',
 '/backoffice/reports/executive','/backoffice/reports/operational','/backoffice/reports/financial',
 '/backoffice/licenses','/backoffice/users','/backoffice/settings',
]);
export function readableProductGuide(guide:ProductGuide, actor:KnowledgeReadContext, role:string, request:KnowledgeRequest, now:Date):boolean {
 if(actor.audience!=='BACKOFFICE'||!guide.roles.includes(role)||!guide.review?.reference.trim())return false;
 if(guide.revision.scope!=='PRODUCT'||guide.revision.sourceKind!=='PRODUCT_GUIDE'||
  guide.revision.sourceId!=='energyos-product-guides'||guide.revision.section!==guide.content.title||guide.revision.id!==guide.key+'-v'+guide.revision.version||
  guide.revision.audiences.length!==1||guide.revision.audiences[0]!=='BACKOFFICE')return false;
 if(!guide.content.title.trim()||!guide.content.questions.length||!guide.content.steps.length||!guide.content.links.length||
  guide.content.links.some(link=>!ROUTES.has(link.url)||!link.label.trim()))return false;
 if(guide.revision.hash!==productGuideDocumentHash(guide,guide.revision.version,guide.revision.productRelease??'',guide.revision.validFrom,guide.revision.validTo)||
  guide.revision.contentHash!==productGuideContentHash(guide.content)||
  guide.review.documentHash!==guide.revision.hash||guide.review.contentHash!==guide.revision.contentHash)return false;
 if(JSON.stringify(guide.permissions)!==JSON.stringify(guide.revision.requiredPermissions)||
  JSON.stringify(guide.modules)!==JSON.stringify(guide.revision.requiredModules))return false;
 if(!guide.revision.publishedAt||Date.parse(guide.revision.publishedAt)>now.getTime())return false;
 return previewKnowledgeEligibility(actor,request,guide.revision).eligible;
}

export function normalizeGuideQuestion(value:string){
 return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[?!.]+$/,'').trim();
}
/** Exact procedural questions only. Never treats an invoice, norm or financial question as a manual. */
export function findProductGuide(guides:readonly ProductGuide[],input:{topic?:string;question?:string}){
 if(input.topic)return guides.find(guide=>guide.key===input.topic);
 if(!input.question?.trim()||input.question.length>500)return undefined;
 const question=normalizeGuideQuestion(input.question);
 const matches=guides.filter(guide=>guide.content.questions.some(q=>normalizeGuideQuestion(q)===question));
 return matches.length===1?matches[0]:undefined;
}
