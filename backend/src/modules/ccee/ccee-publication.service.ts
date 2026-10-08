import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {CceeService} from './ccee.service';
import {pldReviewDigest} from './ccee-publication';
import {AccessContext} from '../../common/interfaces/tenant-context.interface';
@Injectable()
export class CceePublicationService {
 constructor(private readonly ccee:CceeService,private readonly db:SupabaseService){}
 async publish(input:unknown,actor:AccessContext|undefined){
  if(actor?.scope!=='global'||!actor.userId)throw new ForbiddenException('Administrador da plataforma requerido.');
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='digest,month,requestId')throw new BadRequestException('Publicação exige a prévia conferida.');
  const d=input as Record<string,unknown>;
  if(typeof d.digest!=='string'||! /^[a-f0-9]{64}$/.test(d.digest)||typeof d.requestId!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(d.requestId))throw new BadRequestException('Referência de publicação inválida.');
  // No browser-supplied prices, organization, profile or SOAP content can be persisted.
  const fresh=await this.ccee.preview({month:d.month});
  if(pldReviewDigest(fresh)!==d.digest)throw new ConflictException('A prévia CCEE mudou. Consulte e confira novamente.');
  const result=await this.db.getClient().rpc('ccee_publish_pld_month',{p_org:fresh.organizationId,p_actor:actor.userId,p_request:d.requestId,p_payload:fresh});
  if(result.error){if(result.error.code==='42501')throw new ForbiddenException('Publicação CCEE não autorizada.');if(result.error.code==='40001')throw new ConflictException('O mês já possui outra publicação. Nenhum preço foi substituído.');throw new ServiceUnavailableException('Publicação CCEE não concluída. Nenhum preço foi presumido.');}
  return result.data;
 }
}
