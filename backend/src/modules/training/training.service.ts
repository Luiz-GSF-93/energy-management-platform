import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {RequestWithTenant} from '../../common/interfaces/tenant-context.interface';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function input(b:unknown,keys:string[]){if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!keys.includes(k)))throw new BadRequestException('Dados de treinamento inválidos.');return b as Record<string,unknown>;}
function content(v:unknown){if(v!=='ccee-operations-v2')throw new BadRequestException('Versão de treinamento inválida.');return v;}
@Injectable()
export class TrainingService{
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService){}
 private actor(req:RequestWithTenant){const t=req.accessContext??req.tenantContext;
  if(!t||t.scope==='global'||t.accessMode||!['admin_org','gestor','operacional'].includes(t.role))throw new ForbiddenException('Treinamento exclusivo do backoffice da organização.');
  return {org:t.organizationId,actor:t.userId};}
 private enabled(){return this.config.get('CCEE_TRAINING_ENABLED')==='true';}
 private async rpc(name:string,args:Record<string,unknown>){const {data,error}=await this.db.getClient().rpc(name,args);
  if(error){if(error.code==='42501')throw new ForbiddenException('Treinamento não disponível para este acesso.');if(error.code==='22023')throw new BadRequestException('Revise o progresso informado.');if(error.code==='40001')throw new ConflictException('Outra aba está reproduzindo o treinamento. Feche o outro player e retome em até 45 segundos.');throw new ServiceUnavailableException('Não foi possível confirmar o progresso. O último registro salvo será preservado.');}return data;}
 async state(req:RequestWithTenant){const a=this.actor(req);if(!this.enabled())return {eligible:false};return this.rpc('training_state',{p_org:a.org,p_actor:a.actor,p_content:null});}
 async command(req:RequestWithTenant,b:unknown){const a=this.actor(req);if(!this.enabled())throw new ForbiddenException('Treinamento indisponível.');
  const d=input(b,['contentId','action','playerId','position','playing','visible']);const id=content(d.contentId);
  if(typeof d.action!=='string'||!['DEFER','OPEN','TICK','RELEASE'].includes(d.action)||d.action!=='DEFER'&&(typeof d.playerId!=='string'||!uuid.test(d.playerId))||d.position!==undefined&&(typeof d.position!=='number'||!Number.isFinite(d.position)||d.position<0||d.position>7202)||d.playing!==undefined&&typeof d.playing!=='boolean'||d.visible!==undefined&&typeof d.visible!=='boolean')throw new BadRequestException('Progresso de treinamento inválido.');
  return this.rpc('training_command',{p_org:a.org,p_actor:a.actor,p_content:id,p_action:d.action,p_player:d.action==='DEFER'?null:d.playerId,p_position:d.position??0,p_playing:d.playing??false,p_visible:d.visible??true});}
 async media(req:RequestWithTenant,b:unknown){const a=this.actor(req);if(!this.enabled())throw new ForbiddenException('Treinamento indisponível.');const d=input(b,['contentId']);const id=content(d.contentId);
  const state=await this.rpc('training_state',{p_org:a.org,p_actor:a.actor,p_content:id});if(!state?.eligible||state.content?.id!==id)throw new ForbiddenException('Mídia não disponível neste contexto.');
  const files=['video.mp4','legendas.vtt','poster.png','guia.pdf','transcricao.txt'];const urls:Record<string,string>={};
  for(const file of files){const {data,error}=await this.db.getClient().storage.from('energy-training-private').createSignedUrl('ccee/v2/'+file,900);if(error||!data?.signedUrl)throw new ServiceUnavailableException('Mídia de treinamento temporariamente indisponível.');urls[file]=data.signedUrl;}
  return {contentId:id,expiresAt:new Date(Date.now()+900000).toISOString(),urls};
 }
}
