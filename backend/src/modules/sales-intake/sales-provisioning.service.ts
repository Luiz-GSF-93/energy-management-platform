import {BadRequestException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SalesCommercialService,commercialInput} from './sales-commercial.service';
@Injectable()
export class SalesProvisioningService {
 constructor(private readonly commercial:SalesCommercialService,private readonly config:ConfigService){}
 private call(actor:string,action:string,body:unknown){
  if(this.config.get('SALES_PROVISIONING_COMMANDS_ENABLED')!=='true')throw new ServiceUnavailableException('Provisionamento comercial desligado; aguardando homologação.');
  if(action==='execute'&&this.config.get('SALES_PROVISIONING_APPLICATION_ENABLED')!=='true')throw new ServiceUnavailableException('Aplicação de licença desligada.');
  return this.commercial.rpc('platform_sales_provisioning_action',{p_actor:actor,p_action:action,p_body:body});
 }
 list(actor:string,q:Record<string,unknown>){
  if(Object.entries(q).some(([k,v])=>!['page','search','status'].includes(k)||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??'0'))||Number(q.page??0)>1000||String(q.search??'').length>100||!['','PREPARED','AUTHORIZED','WITHDRAWN','APPLIED'].includes(String(q.status??'')))throw new BadRequestException('Filtros inválidos.');
  return this.call(actor,'list',{page:Number(q.page??0),search:q.search??'',status:q.status??''});
 }
 read(actor:string,id:string){return this.call(actor,'read',commercialInput({id},['id'],['id']));}
 preview(actor:string,body:unknown){const b=commercialInput(body,['id','complement'],['id']);this.complement(b.complement);return this.call(actor,'preview',b);}
 prepare(actor:string,body:unknown){const b=commercialInput(body,['id','activationId','payloadHash','complement','justification'],['id','activationId']);this.hash(b.payloadHash);this.complement(b.complement);this.note(b.justification);return this.call(actor,'prepare',b);}
 command(actor:string,action:'authorize'|'withdraw'|'execute',body:unknown){const b=commercialInput(body,['id','requestId','expectedVersion','payloadHash','justification'],['id','requestId'],['expectedVersion']);this.hash(b.payloadHash);this.note(b.justification);return this.call(actor,action,b);}
 private hash(v:unknown){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw new BadRequestException('Hash inválido.');}
 private note(v:unknown){if(typeof v!=='string'||v.trim().length<20||v.length>1000||/[\x00-\x1f\x7f]/.test(v))throw new BadRequestException('Informe justificativa de 20 a 1000 caracteres.');}
 private complement(v:any){
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['starts','ends','renews','aiMonthlyMicroUsd','contractConfirmed'].includes(k)))throw new BadRequestException('Complemento inválido.');
  for(const k of ['starts','ends','renews'])if(v[k]!=null&&(typeof v[k]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v[k])||!Number.isFinite(Date.parse(v[k]))||new Date(v[k]).toISOString().slice(0,10)!==v[k]))throw new BadRequestException('Data inválida.');
  if(v.aiMonthlyMicroUsd!=null&&(!Number.isSafeInteger(v.aiMonthlyMicroUsd)||v.aiMonthlyMicroUsd<0||v.aiMonthlyMicroUsd>9000000000000)||v.contractConfirmed!=null&&typeof v.contractConfirmed!=='boolean')throw new BadRequestException('Cota ou conferência inválida.');
 }
}
