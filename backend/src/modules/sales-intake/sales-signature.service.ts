import {BadRequestException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SalesCommercialService,commercialInput} from './sales-commercial.service';
@Injectable()
export class SalesSignatureService {
 constructor(private readonly commercial:SalesCommercialService,private readonly config:ConfigService){}
 private call(actor:string,action:string,body:unknown){
  if(this.config.get('SALES_SIGNATURE_PREPARATION_ENABLED')!=='true')throw new ServiceUnavailableException('Preparação Clicksign sandbox desligada; aguardando homologação.');
  return this.commercial.rpc('platform_sales_signature_action',{p_actor:actor,p_action:action,p_body:body});
 }
 list(actor:string,q:Record<string,unknown>){
  if(Object.entries(q).some(([k,v])=>!['page','search','status'].includes(k)||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??0))||Number(q.page??0)>1000||String(q.search??'').length>100||!['','PREPARED','WITHDRAWN'].includes(String(q.status??'')))throw new BadRequestException('Filtros inválidos.');
  return this.call(actor,'list',{page:Number(q.page??0),search:q.search??'',status:q.status??''});
 }
 read(actor:string,id:string){return this.call(actor,'read',commercialInput({id},['id'],['id']));}
 prepare(actor:string,body:unknown){
  const b=commercialInput(body,['id','draftId','draftSha256','justification'],['id','draftId']);
  if(typeof b.draftSha256!=='string'||!/^[a-f0-9]{64}$/.test(b.draftSha256))throw new BadRequestException('Hash da minuta inválido.');
  this.note(b.justification);return this.call(actor,'prepare',b);
 }
 withdraw(actor:string,body:unknown){const b=commercialInput(body,['id','requestId','expectedVersion','justification'],['id','requestId'],['expectedVersion']);this.note(b.justification);return this.call(actor,'withdraw',b);}
 private note(v:unknown){if(typeof v!=='string'||v.trim().length<20||v.length>1000||/[\x00-\x1f\x7f]/.test(v))throw new BadRequestException('Informe justificativa de 20 a 1000 caracteres.');}
}
