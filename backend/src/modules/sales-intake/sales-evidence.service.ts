import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {randomUUID} from 'node:crypto';
import {SupabaseService} from '../../services/supabase.service';
import {commercialInput} from './sales-commercial.service';
import {SalesEvidenceAdapter} from './sales-evidence.adapter';
import {failedEvidence} from './sales-evidence-diagnostics';
@Injectable()
export class SalesEvidenceService {
 constructor(private readonly db:SupabaseService,private readonly config:ConfigService,private readonly adapter:SalesEvidenceAdapter){}
 private async rpc(actor:string,action:string,body:unknown):Promise<any>{
  if(this.config.get('SALES_EVIDENCE_ENABLED')!=='true')throw new ServiceUnavailableException('Evidências financeiras desligadas.');
  let r:any;try{r=await this.db.getClient().rpc('platform_sales_evidence_action',{p_actor:actor,p_action:action,p_body:body});}catch{throw new ServiceUnavailableException('Evidências indisponíveis.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Perfil sem autorização.');if(r.error.code==='P3690')throw new NotFoundException('Origem não localizada.');if(['P3691','23505'].includes(r.error.code))throw new ConflictException('Evidência divergente ou consulta em andamento.');if(['22023','22P02','22003','23514'].includes(r.error.code))throw new BadRequestException('Dados inválidos.');throw new ServiceUnavailableException('Evidências indisponíveis.');}return r.data;
 }
 private origin(kind:string,id:string){commercialInput({id},['id'],['id']);if(!['ONCE','CYCLE'].includes(kind))throw new BadRequestException('Origem inválida.');return {kind,id};}
 read(actor:string,kind:string,id:string,q:Record<string,unknown>){const origin=this.origin(kind,id);if(Object.entries(q).some(([k,v])=>k!=='page'||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000)throw new BadRequestException('Página inválida.');return this.rpc(actor,'read',{...origin,page:Number(q.page??0)}).then(r=>({...r,externalCallsEnabled:this.config.get('SALES_EVIDENCE_CALLS_ENABLED')==='true'}));}
 async check(actor:string,kind:string,id:string,body:unknown){const origin=this.origin(kind,id),b=commercialInput(body,['justification'],[]);if(typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>500)throw new BadRequestException('Justificativa inválida.');if(this.config.get('SALES_EVIDENCE_CALLS_ENABLED')!=='true')throw new ServiceUnavailableException('Consultas externas de evidências desligadas.');
  const lease=randomUUID(),claim=await this.rpc(actor,'claim',{...origin,lease,justification:b.justification});let evidence;
  try{evidence=await this.adapter.evidence(claim.source);}catch(error){await this.rpc(actor,'finish',{lease,evidence:failedEvidence(error)});throw new ServiceUnavailableException('Consulta não concluída; tentativa preservada.');}
  return this.rpc(actor,'finish',{lease,evidence});
 }
}
