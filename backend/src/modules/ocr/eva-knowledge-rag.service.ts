import {ForbiddenException,Injectable} from '@nestjs/common';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {BotEnergyRagService} from './bot-energy-rag.service';
import {EvaPublishedRagService,PublishedRagResult} from './eva-published-rag.service';
import {BotEnergyLicenseService} from './bot-energy-license.service';
import {CorpusProof} from './eva-corpus.model';
import {KnowledgeQuery,selectKnowledge} from './bot-energy-knowledge';

/** Routing facade: preserve the reviewed legacy source and its published guide hashes. */
@Injectable()
export class EvaKnowledgeRagService{
 constructor(private legacy:BotEnergyRagService,private published:EvaPublishedRagService,private licenses:BotEnergyLicenseService){}
 publishedPilot(t:TenantContext){return this.published.enabledFor(t);}
 async retrieve(t:TenantContext,question:string,period:Pick<KnowledgeQuery,'periodStart'|'periodEnd'|'market'>):Promise<PublishedRagResult>{
  if(!this.publishedPilot(t))return this.legacy.retrieve(t,question,period);
  if(!t.organizationId||!t.userId||(t.scope as string)==='global'||!t.permissions.includes(P.INTELLIGENCE_AI_USE)||(!['operacional','gestor','admin_org'].includes(t.role)&&t.accessMode!=='platform_operation'))throw new ForbiddenException('Base disponível ao backoffice autorizado.');
  if(!await this.licenses.available(t.organizationId))throw new ForbiddenException('EVA + RAG exige licença vigente.');
  selectKnowledge([],{...period,embeddingModel:'text-embedding-3-small',embeddingVersion:'published-pilot-v1'});
  return this.published.retrieve(t,question,period);
 }
 private async assertLocal(t:TenantContext){if(!t.organizationId||!t.userId||(t.scope as string)==='global'||!t.permissions.includes(P.INTELLIGENCE_AI_USE)||(!['operacional','gestor','admin_org'].includes(t.role)&&t.accessMode!=='platform_operation')||!await this.licenses.available(t.organizationId))throw new ForbiddenException('Biblioteca da EVA exige licença e permissão vigente.');}
 async retrieveLocal(t:TenantContext,asOf:string){await this.assertLocal(t);return this.published.retrieveLocal(t,asOf);}
 async revalidateLocal(t:TenantContext,proofs:CorpusProof[]){await this.assertLocal(t);return this.published.revalidateLocal(t,proofs);}
 retrieveClient(t:TenantContext,question:string,period:Pick<KnowledgeQuery,'periodStart'|'periodEnd'|'market'>,unitId:string):Promise<PublishedRagResult>{return this.legacy.retrieveClient(t,question,period,unitId);}
 revalidate(t:TenantContext,proofs:CorpusProof[]){return this.published.revalidate(t,proofs);}
}
