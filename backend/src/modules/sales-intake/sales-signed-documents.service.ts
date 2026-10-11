import {BadRequestException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {createHash} from 'node:crypto';
import {SalesCommercialService,commercialInput} from './sales-commercial.service';
export const SIGNED_DOCUMENT_LIMIT=3145728;
export type SignedUpload={buffer:Buffer;size:number;mimetype:string;originalname:string};
@Injectable()
export class SalesSignedDocumentsService {
 constructor(private readonly commercial:SalesCommercialService,private readonly config:ConfigService){}
 private enabled(){if(this.config.get('SALES_SIGNED_IMPORT_ENABLED')!=='true')throw new ServiceUnavailableException('Importação de assinatura externa desligada; aguardando homologação.');}
 private call(actor:string,action:string,body:unknown){this.enabled();return this.commercial.rpc('platform_sales_signed_document_action',{p_actor:actor,p_action:action,p_body:body});}
 list(actor:string,q:Record<string,unknown>){
  if(Object.entries(q).some(([k,v])=>!['page','search','status'].includes(k)||typeof v!=='string')||!/^\d{1,4}$/.test(String(q.page??0))||Number(q.page??0)>1000||String(q.search??'').length>100||!['','IMPORTED','CHECKED','ACCEPTED','REJECTED'].includes(String(q.status??'')))throw new BadRequestException('Filtros documentais inválidos.');
  return this.call(actor,'list',{page:Number(q.page??0),search:q.search??'',status:q.status??''});
 }
 read(actor:string,id:string){commercialInput({id},['id'],['id']);return this.call(actor,'read',{id});}
 import(actor:string,body:unknown,file?:SignedUpload){
  this.enabled();
  const b=commercialInput(body,['id','draftId','draftSha256','signedAt','supplierSignatory','customerSignatory','source','justification'],['id','draftId']);
  if(typeof b.draftSha256!=='string'||!/^[a-f0-9]{64}$/.test(b.draftSha256)||!file||!Buffer.isBuffer(file.buffer)||file.size!==file.buffer.length||file.size<100||file.size>SIGNED_DOCUMENT_LIMIT||file.mimetype!=='application/pdf'||!file.originalname.toLowerCase().endsWith('.pdf')||file.buffer.subarray(0,5).toString()!=='%PDF-'||!file.buffer.subarray(-1024).includes(Buffer.from('%%EOF')))throw new BadRequestException('Envie o PDF original assinado, de até 3 MB.');
  if(typeof b.signedAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.signedAt)||isNaN(Date.parse(b.signedAt))||new Date(b.signedAt).toISOString().slice(0,10)!==b.signedAt)throw new BadRequestException('Data da assinatura inválida.');
  for(const k of ['supplierSignatory','customerSignatory','source'])if(typeof b[k]!=='string'||b[k].trim().length<3||b[k].length>500||/[\x00-\x1f\x7f]/.test(b[k]))throw new BadRequestException('Informe signatários e origem do documento.');
  if(typeof b.justification!=='string'||b.justification.trim().length<10||b.justification.length>2000||/[\x00-\x1f\x7f]/.test(b.justification))throw new BadRequestException('Informe justificativa documental de 10 a 2000 caracteres.');
  // Preserve the bytes: downloading is attachment-only, with no inline preview or execution.
  return this.call(actor,'import',{id:b.id,draftId:b.draftId,draftSha256:b.draftSha256,filename:'energyos-assinatura-externa.pdf',hex:file.buffer.toString('hex'),metadata:{signedAt:b.signedAt,supplierSignatory:b.supplierSignatory,customerSignatory:b.customerSignatory,source:b.source},justification:b.justification});
 }
 review(actor:string,body:unknown){const b=commercialInput(body,['id','requestId','expectedVersion','status','checks','justification'],['id','requestId'],['expectedVersion']);return this.call(actor,'review',b);}
 async pdf(actor:string,id:string){
  commercialInput({id},['id'],['id']);const data=await this.call(actor,'pdf',{id});
  if(typeof data?.hex!=='string'||data.hex.length>SIGNED_DOCUMENT_LIMIT*2||!/^[a-f0-9]+$/.test(data.hex)||data.hex.length%2||typeof data.sha256!=='string')throw new ServiceUnavailableException('Arquivo preservado indisponível.');
  const bytes=Buffer.from(data.hex,'hex');
  if(bytes.length<100||createHash('sha256').update(bytes).digest('hex')!==data.sha256||bytes.subarray(0,5).toString()!=='%PDF-')throw new ServiceUnavailableException('Integridade do arquivo não confirmada.');
  return bytes;
 }
}
