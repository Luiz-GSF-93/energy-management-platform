import {BadRequestException,Body,Controller,Get,Query,Post,Header} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {CceeMarketService} from '../ccee/ccee-market.service';
import {marketQuery} from '../ccee/ccee-market.model';
import {EvaKnowledgeRagService} from './eva-knowledge-rag.service';
/** Explicit operator request: reuse the existing licensed, budgeted and audited
 * retrieval. The hourly worker never triggers embeddings or general indexing. */
@Controller('ccee-market/guidance')
export class EvaMarketController{
 constructor(private market:CceeMarketService,private rag:EvaKnowledgeRagService){}
 @Get() @Header('Cache-Control','private, no-store') async local(@Tenant()t:TenantContext,@Query()body:Record<string,unknown>){
  marketQuery(body);const observed=await this.market.read(t,body);
  const knowledge=await this.rag.retrieveLocal(t,observed.assessmentAsOf);
  const current=await this.market.read(t,body);if(current.sourceFingerprint!==observed.sourceFingerprint)throw new BadRequestException('As fontes de preço mudaram. Atualize a análise.');
  if(knowledge.publicationProofs?.length)await this.rag.revalidateLocal(t,knowledge.publicationProofs);
  return {organizationId:t.organizationId,sourceFingerprint:observed.sourceFingerprint,asOf:observed.assessmentAsOf,mode:'LOCAL_TEXT',knowledge:{state:knowledge.state,evidence:knowledge.evidence,sources:knowledge.sources},notice:'Contexto documental vigente na data da análise, associado por busca textual local sem chamadas pagas. Associação não comprova causalidade nem garante preços futuros.'};
 }
 @Post() @Header('Cache-Control','private, no-store') async guidance(@Tenant()t:TenantContext,@Body()body:Record<string,unknown>){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['from','to','submarkets','granularity','origin','page'].includes(k)))throw new BadRequestException('Filtros inválidos.');
  const q=marketQuery(body),observed=await this.market.read(t,body);
  const question=`Quais fatores documentados explicam o contexto dos movimentos do PLD nos submercados ${q.submarkets.join(', ')} entre ${q.from} e ${q.to}, incluindo sazonalidade e riscos de contratação? Não atribua causalidade sem evidência nem recomende compra automática.`;
  const knowledge=await this.rag.retrieve(t,question,{periodStart:q.from,periodEnd:q.to,market:'ACL'});
  const current=await this.market.read(t,body);
  if(current.sourceFingerprint!==observed.sourceFingerprint)throw new BadRequestException('As fontes de preço mudaram durante a consulta. Atualize e consulte novamente.');
  if(knowledge.publicationProofs?.length)await this.rag.revalidate(t,knowledge.publicationProofs);
  return {organizationId:t.organizationId,sourceFingerprint:observed.sourceFingerprint,observed:observed.trends,knowledge:{state:knowledge.state,evidence:knowledge.evidence,sources:knowledge.sources},notice:'Movimentos observados e contexto documental são apresentados separadamente. Artigos não comprovam causalidade nem garantem preços futuros.'};
 }
}
