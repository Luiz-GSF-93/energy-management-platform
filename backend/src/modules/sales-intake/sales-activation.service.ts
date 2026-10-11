import {BadRequestException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SalesCommercialService,commercialInput} from './sales-commercial.service';
@Injectable()
export class SalesActivationService {
 constructor(private readonly commercial:SalesCommercialService,private readonly config:ConfigService){}
 private call(actor:string,action:string,body:unknown){
  if(this.config.get('SALES_ACTIVATION_PREPARATION_ENABLED')!=='true')throw new ServiceUnavailableException('Preparação de ativação desligada; aguardando homologação.');
  return this.commercial.rpc('platform_sales_activation_action',{p_actor:actor,p_action:action,p_body:body});
 }
 list(actor:string,q:Record<string,unknown>){
  if(Object.entries(q).some(([k,v])=>!['page','search','status'].includes(k)||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000||String(q.search??'').length>100||!['','PREPARED','CHECKED_INTERNAL','WITHDRAWN'].includes(String(q.status??'')))throw new BadRequestException('Filtros de ativação inválidos.');
  return this.call(actor,'list',{page:Number(q.page??0),search:q.search??'',status:q.status??''});
 }
 read(actor:string,id:string){return this.call(actor,'read',commercialInput({id},['id'],['id']));}
 prepare(actor:string,body:unknown){const b=commercialInput(body,['id','organizationId','proposalId','documentId','bindingId','justification'],['id','proposalId','documentId','bindingId']);
  if(typeof b.organizationId!=='string'||b.organizationId.trim()!==b.organizationId||!b.organizationId||b.organizationId.length>100||/[\x00-\x1f\x7f]/.test(b.organizationId))throw new BadRequestException('Organização inválida.');
  this.note(b.justification);return this.call(actor,'prepare',b);
 }
 review(actor:string,body:unknown){const b=commercialInput(body,['id','requestId','expectedVersion','sourceHash','status','checks','justification'],['id','requestId'],['expectedVersion']);
  const keys=['recipient','contract','payment','scope','fiscal'];
  if(!['CHECKED_INTERNAL','WITHDRAWN'].includes(b.status)||typeof b.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceHash)||!b.checks||typeof b.checks!=='object'||Array.isArray(b.checks)||Object.keys(b.checks).length!==keys.length||Object.keys(b.checks).some(k=>!keys.includes(k)||typeof b.checks[k]!=='boolean'))throw new BadRequestException('Conferência de ativação inválida.');
  this.note(b.justification);return this.call(actor,'review',b);
 }
 private note(v:unknown){if(typeof v!=='string'||v.trim().length<20||v.length>1000||/[\x00-\x1f\x7f]/.test(v))throw new BadRequestException('Informe justificativa de 20 a 1000 caracteres.');}
}
