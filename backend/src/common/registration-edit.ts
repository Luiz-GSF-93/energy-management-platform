import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {auditAuthorNames} from '../modules/contracts/services/audit-author-names';
export function editEnvelope(body:any,actor:string){
 if(!actor)throw new ForbiddenException('Autor autenticado obrigatório.');
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['changes','reason','expectedVersion','requestId'].includes(k))||!body.changes||typeof body.changes!=='object'||Array.isArray(body.changes)||!Object.keys(body.changes).length||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.trim().length>1000||!Number.isInteger(body.expectedVersion)||body.expectedVersion<0||typeof body.requestId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId))throw new BadRequestException('Informe alterações, justificativa e versão atual do cadastro.');
 return body;
}
export async function saveRegistration(client:any,org:string,kind:string,id:string,actor:string,body:any,changes:any){
 const {data,error}=await client.rpc('edit_registration',{p_org:org,p_kind:kind,p_id:id,p_actor:actor,p_reason:body.reason.trim(),p_expected:body.expectedVersion,p_request:body.requestId,p_changes:changes});
 if(error){
  if(error.code==='42501')throw new ForbiddenException('Sem autorização para gerenciar estes usuários. Somente usuários externos de consulta, explicitamente exclusivos, podem ser vinculados.');
  if(error.code==='P3840')throw new NotFoundException('Cadastro não encontrado nesta organização.');
  if(['40001','P3231'].includes(error.code))throw new ConflictException('O cadastro mudou. Feche e abra a edição para conferir a versão atual.');
  if(error.code==='P3841')throw new BadRequestException('Nenhuma alteração identificada.');
  if(error.code==='23505')throw new ConflictException('Já existe cadastro com este documento ou unidade na organização.');
  if(['22023','23514','23502','22001','22P02','P3281'].includes(error.code))throw new BadRequestException('Dados inválidos. Confira os campos e os usuários exclusivos.');
  throw new ServiceUnavailableException('Não foi possível salvar o cadastro e sua auditoria. Nenhuma alteração foi confirmada.');
 }
 return data;
}
export async function registrationHistory(client:any,org:string,kind:string,id:string){
 const {data,error}=await client.from('registration_edits').select('*').eq('organization_id',org).eq('entity_kind',kind).eq('entity_id',id).order('created_at',{ascending:false}).limit(100);
 if(error)throw new ServiceUnavailableException('Histórico indisponível.');
 return auditAuthorNames(client,org,data||[]);
}
