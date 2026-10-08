import {BadRequestException,ConflictException,ForbiddenException,Injectable,InternalServerErrorException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {IsIn,IsInt,IsISO8601,IsOptional,IsString,IsUUID,Matches,MaxLength,Min,MinLength} from 'class-validator';
import {registrationReadiness} from './ccee-registration-readiness';
export const CCEE_REGISTRATION_PERMISSIONS={view:'f5364101-4486-42c2-a90f-807937ac3001',manage:'f5364101-4486-42c2-a90f-807937ac3002',approve:'f5364101-4486-42c2-a90f-807937ac3003'} as const;
export class CceeRegistrationDraftDto {
 @IsUUID() id!:string;
 @IsUUID() requestId!:string;
 @IsInt() @Min(0) revision!:number;
 @IsString() @MinLength(3) @MaxLength(500) reason!:string;
 @IsString() @MinLength(1) @MaxLength(200) customerId!:string;
 @IsString() @MinLength(1) @MaxLength(200) unitId!:string;
 @IsOptional() @IsUUID() agendaId?:string;
 @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!:string;
 @IsIn(['REGISTER_CONTRACT','VALIDATE_AMOUNTS']) operation!:string;
 @IsString() @MinLength(3) @MaxLength(160) title!:string;
 @IsString() @MinLength(3) @MaxLength(6000) notes!:string;
 @IsISO8601({strict:true}) deadline!:string;
 @IsString() @MinLength(3) @MaxLength(500) evidenceReference!:string;
}
export class CceeRegistrationTransitionDto {
 @IsUUID() requestId!:string;
 @IsInt() @Min(1) revision!:number;
 @IsIn(['DRAFT','REVIEW','APPROVED','CANCELLED']) status!:string;
 @IsString() @MinLength(3) @MaxLength(500) reason!:string;
}
@Injectable()
export class CceeRegistrationService {
 constructor(private db:SupabaseService,private licenses:LicensesService){}
 private async allowed(t:TenantContext,action:keyof typeof CCEE_REGISTRATION_PERMISSIONS='view'){
  if(!t?.organizationId||!t.userId||(t.scope as string)==='global'||(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation')||(t.accessMode!=='platform_operation'&&![CCEE_REGISTRATION_PERMISSIONS.view,CCEE_REGISTRATION_PERMISSIONS[action]].every(p=>t.permissions?.includes(p)))||(action==='approve'&&!['admin_org','gestor'].includes(t.role)&&t.accessMode!=='platform_operation'))throw new ForbiddenException('Registros CCEE exige organização ativa e permissão própria do módulo.');
  try{await this.licenses.requireEntitlement(t.organizationId,'ccee_registrations');}catch(e){if(e instanceof ForbiddenException)throw new ForbiddenException('O módulo avulso Registros CCEE precisa estar contratado na licença vigente desta organização.');throw e;}
 }
 private fail(e:any){if(!e)return;if(e.code==='42501')throw new ForbiddenException('Confira módulo contratado, permissões, cliente, unidade, agenda e revisão independente.');if(e.code==='40001')throw new ConflictException('A revisão mudou ou está protegida. Atualize antes de continuar.');if(['22023','23514','23502','22P02','22007'].includes(e.code))throw new BadRequestException('Revise os campos e a transição do registro.');throw new InternalServerErrorException('Não foi possível conferir o registro CCEE.');}
 async list(t:TenantContext){await this.allowed(t);const r=await this.db.getClient().rpc('read_ccee_registrations',{p_org:t.organizationId,p_actor:t.userId});this.fail(r.error);if(!Array.isArray(r.data)||r.data.some((v:any)=>v.organization_id!==t.organizationId))throw new InternalServerErrorException('Resposta fora do escopo.');return {organizationId:t.organizationId,rows:r.data,canManage:t.accessMode==='platform_operation'||t.permissions.includes(CCEE_REGISTRATION_PERMISSIONS.manage),canApprove:t.accessMode==='platform_operation'||t.permissions.includes(CCEE_REGISTRATION_PERMISSIONS.approve)&&['admin_org','gestor'].includes(t.role),transmissionEnabled:false,disclosure:'Preparação e revisão interna. Transmissão CCEE ainda não homologada. Aprovação interna não registra contratos nem confirma fechamento na CCEE.'};}
 async history(id:string,t:TenantContext){await this.allowed(t);this.id(id);const r=await this.db.getClient().rpc('read_ccee_registrations',{p_org:t.organizationId,p_actor:t.userId,p_id:id,p_history:true});this.fail(r.error);return r.data;}
 async readiness(id:string,t:TenantContext){await this.allowed(t);this.id(id);const r=await this.db.getClient().rpc('read_ccee_registration_readiness',{p_org:t.organizationId,p_actor:t.userId,p_id:id});this.fail(r.error);if(!r.data||r.data.organizationId!==t.organizationId||r.data.record?.id!==id)throw new InternalServerErrorException('Resposta fora do escopo.');try{return registrationReadiness(r.data);}catch{throw new InternalServerErrorException('Não foi possível conferir os requisitos CCEE.');}}
 private id(id:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw new BadRequestException('Identificador inválido.');}
 async save(input:unknown,t:TenantContext){await this.allowed(t,'manage');const d=await validateWriteDto(CceeRegistrationDraftDto,input as CceeRegistrationDraftDto);const {id,requestId,revision,reason,...data}=d;const r=await this.db.getClient().rpc('save_ccee_registration',{p_org:t.organizationId,p_actor:t.userId,p_id:id,p_request:requestId,p_revision:revision,p_status:'DRAFT',p_reason:reason,p_data:data});this.fail(r.error);return r.data;}
 async transition(id:string,input:unknown,t:TenantContext){this.id(id);const d=await validateWriteDto(CceeRegistrationTransitionDto,input as CceeRegistrationTransitionDto);await this.allowed(t,d.status==='APPROVED'?'approve':'manage');const r=await this.db.getClient().rpc('save_ccee_registration',{p_org:t.organizationId,p_actor:t.userId,p_id:id,p_request:d.requestId,p_revision:d.revision,p_status:d.status,p_reason:d.reason,p_data:null});this.fail(r.error);return r.data;}
}
