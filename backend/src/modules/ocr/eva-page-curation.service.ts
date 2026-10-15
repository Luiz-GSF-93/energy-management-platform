import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SupabaseService} from '../../services/supabase.service';
import {pageCurationCommand,pageCurationFile} from './eva-page-curation.model';
import {uuid} from './eva-extraction.model';
@Injectable()
export class EvaPageCurationService{
 constructor(private db:SupabaseService,private config:ConfigService){}
 private enabled(){return this.config.get('EVA_PAGE_CURATION_ENABLED')==='true';}
 private async rpc(actor:string,action:string,id:string,body:unknown){
  if(!this.enabled())throw new ServiceUnavailableException('Curadoria por página desligada.');
  let r:any;try{r=await this.db.getClient().rpc('eva_page_curation_action',{p_actor:actor,p_action:action,p_job:id,p_body:body});}catch{throw new ServiceUnavailableException('Resultado não confirmado. Reconfira a versão antes de repetir.');}
  if(r.error){if(r.error.code==='42501')throw new ForbiddenException('Owner ativo e revisão independente obrigatórios.');if(r.error.code==='23505')throw new ConflictException('Versão ou origem alterada. Reconfira o histórico.');if(['22023','22P02','23514','22007','22008'].includes(r.error.code))throw new BadRequestException('Cobertura, metadados ou evidências incompletos.');throw new ServiceUnavailableException('Resultado não confirmado. Preserve a tentativa.');}return r.data;
 }
 detail(actor:string,id:string,q:Record<string,unknown>){if(!uuid(id)||Object.keys(q).some(k=>!['page','requestId'].includes(k))||q.requestId!==undefined&&!uuid(q.requestId)||typeof(q.page??'0')!=='string'||!/^\d{1,3}$/.test(String(q.page??'0')))throw new BadRequestException('Paginação inválida.');if(!this.enabled())return Promise.resolve({enabled:false});return this.rpc(actor,'detail',id,{page:Number(q.page??0),...(q.requestId===undefined?{}:{requestId:q.requestId})});}
 import(actor:string,id:string,command:unknown,file:{buffer:Buffer;size:number}|undefined){
  if(!this.enabled())throw new ServiceUnavailableException('Curadoria por página desligada.');
  if(!uuid(id)||!pageCurationCommand(command)||!file||!Buffer.isBuffer(file.buffer)||file.size!==file.buffer.length||file.size>2*1024*1024)throw new BadRequestException('Arquivo de curadoria inválido.');
  let data:unknown;try{const text=file.buffer.toString('utf8');if(!Buffer.from(text,'utf8').equals(file.buffer))throw Error();data=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new BadRequestException('Confira o JSON UTF-8.');}
  if(!pageCurationFile(data))throw new BadRequestException('Confira todas as páginas, segmentos e exclusões.');
  return this.rpc(actor,'prepare',id,{...command,...data});
 }
}
