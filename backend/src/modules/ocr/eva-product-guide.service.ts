import {ForbiddenException,Injectable} from '@nestjs/common';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {LicensesService} from '../licenses/services/licenses.service';
import {KnowledgeReadContext} from '../eva-knowledge-foundation/knowledge-contracts';
import {knowledgeDay} from '../eva-knowledge-foundation/knowledge-policy';
import {ProductGuide,PRODUCT_GUIDE_RELEASE,findProductGuide,readableProductGuide} from './eva-product-guide-reader';
import {EvaGuidePublicationService} from './eva-guide-publication.service';
import {PRODUCT_GUIDE_DRAFTS} from './eva-product-guides';

export type ProductGuidePilot={enabled:boolean;organizations:readonly string[]};
export type ProductGuideTopic={key:string;question:string;version:string};
export type ProductGuideAnswer={
 name:'EVA';mode:'PRODUCT_GUIDE';checkedAt:string;canApprove:false;canPublish:false;
 status:'SUPPORTED'|'NO_EVIDENCE'|'UNAVAILABLE';answer:string;
 items:{label:string;value:string;source:string}[];sources:{label:string;reference:string;url:string}[];
 guide?:{key:string;version:string;release:string;contentHash:string};
};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MODULES=['bot_energy_rag','document_management','free_market_management','advanced_analytics','report_generation','client_portal'] as const;
export function productGuidePilotConfig(env:NodeJS.ProcessEnv):ProductGuidePilot {
 const organizations=(env.EVA_PRODUCT_GUIDES_ORGANIZATIONS??'').split(',').map(x=>x.trim()).filter(Boolean);
 return {enabled:env.EVA_PRODUCT_GUIDES_ENABLED==='true',organizations:organizations.every(x=>x==='org_default'||UUID.test(x))?[...new Set(organizations)]:[]};
}

@Injectable()
export class EvaProductGuideService {
 constructor(private licenses:Pick<LicensesService,'resolveEffectiveLicense'>,private pilot:ProductGuidePilot,
  private guides:readonly ProductGuide[]=PRODUCT_GUIDE_DRAFTS,private clock:()=>Date=()=>new Date(),private publications?:Pick<EvaGuidePublicationService,'resolve'>){}
 private enabled(t:TenantContext){return this.pilot.enabled&&this.pilot.organizations.includes(t?.organizationId);}
 private permitted(t:TenantContext){
  return !!t?.userId&&!!t.organizationId&&t.scope==='organization'&&!t.accessMode&&
   ['operacional','gestor','admin_org'].includes(t.role)&&Array.isArray(t.permissions)&&
   [P.INTELLIGENCE_AI_USE,P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW].every(p=>t.permissions.includes(p));
 }
 private async context(t:TenantContext,now:Date):Promise<KnowledgeReadContext|null>{
  if(!this.permitted(t))return null;
  // One fresh, server-side license snapshot. No quota reservation or generation/embedding port.
  const license=await this.licenses.resolveEffectiveLicense(t.organizationId,now.toISOString().slice(0,10));
  const day=now.toISOString().slice(0,10);
  if(!license||license.organization_id!==t.organizationId||license.active!==true||license.status?.toLowerCase()!=='active'||
   !license.start_date||!knowledgeDay(license.start_date)||license.start_date>day||
   license.end_date!==null&&(!knowledgeDay(license.end_date)||license.end_date<day))return null;
  const values=license as typeof license & {client_portal?:boolean};
  const modules=MODULES.filter(key=>values[key]===true);
  if(!['bot_energy_rag','document_management','free_market_management'].every(key=>modules.includes(key as typeof MODULES[number])))return null;
  return {verified:true,actorId:t.userId,audience:'BACKOFFICE',organizationId:t.organizationId,
   permissions:t.permissions,licensedModules:modules,licenseCurrent:true};
 }
 private readable(guide:ProductGuide,actor:KnowledgeReadContext,t:TenantContext,now:Date){
  const day=now.toISOString().slice(0,10);
  return readableProductGuide(guide,actor,t.role,{periodStart:day,periodEnd:day,productRelease:PRODUCT_GUIDE_RELEASE},now);
 }
 async topics(t:TenantContext):Promise<ProductGuideTopic[]>{
  if(!this.enabled(t)||!this.permitted(t))return [];
  const now=this.clock();let actor:KnowledgeReadContext|null;
  try{actor=await this.context(t,now);}catch{return [];}
  if(!actor)return [];
  try{const guides=await Promise.all(this.guides.map(g=>this.publications?this.publications.resolve(g):g));return guides.filter((g):g is ProductGuide=>!!g&&this.readable(g,actor!,t,now)).map(g=>({key:g.key,question:g.content.questions[0],version:g.revision.version}));}catch{return [];}
 }
 async answer(t:TenantContext,input:{topic?:string;question?:string}):Promise<ProductGuideAnswer|null>{
  if(!this.enabled(t))return null;
  let guide=findProductGuide(this.guides,input);
  if(!guide)return null;
  if(!this.permitted(t))throw new ForbiddenException('Guia de uso exige o contexto e as permissões atuais do Backoffice.');
  const now=this.clock();
  const base={name:'EVA' as const,mode:'PRODUCT_GUIDE' as const,checkedAt:now.toISOString(),canApprove:false as const,canPublish:false as const};
  let actor:KnowledgeReadContext|null;
  try{actor=await this.context(t,now);}catch{return {...base,status:'UNAVAILABLE',answer:'Não foi possível conferir a licença para consultar os guias. Tente novamente.',items:[],sources:[]};}
  try{if(actor&&this.publications)guide=await this.publications.resolve(guide)??undefined;}catch{return {...base,status:'UNAVAILABLE',answer:'Não foi possível conferir a publicação do guia. Tente novamente.',items:[],sources:[]};}
  if(!actor||!guide||!this.readable(guide,actor,t,now))return {...base,status:'NO_EVIDENCE',answer:'Não há guia publicado e autorizado para esta consulta. A orientação depende da revisão do conteúdo e dos acessos atuais.',items:[],sources:[]};
  return {...base,status:'SUPPORTED',answer:[guide.content.title,...guide.content.steps.map((step,i)=>`${i+1}. ${step}`),...guide.content.limits].join('\n\n'),
   guide:{key:guide.key,version:guide.revision.version,release:PRODUCT_GUIDE_RELEASE,contentHash:guide.revision.contentHash},
   items:[{label:'Tipo da fonte',value:'Guia de uso do EnergyOS',source:'Biblioteca de guias revisados do produto; sem consulta a dados operacionais ou norma oficial.'}],
   sources:guide.content.links.map(link=>({label:link.label,reference:'Guia EnergyOS · versão '+guide.revision.version+' · orientação de uso, sem execução de ações',url:link.url}))};
 }
}
