import {ForbiddenException,Injectable} from '@nestjs/common';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {CceeDataService} from './ccee-data.service';
import {cceeDataEnabled,cceeUuid,cceeMonth} from './ccee-data.model';
import {driEnabled,driCommand} from './ccee-dri.model';
@Injectable()
export class CceeDriService{
 constructor(private data:CceeDataService){}
 private allowed(t:TenantContext){cceeDataEnabled('CCEE_DATA_WORKSPACE_ENABLED');driEnabled();if(!t?.organizationId||!t.userId||(t.scope as string)==='global')throw new ForbiddenException('Consulta DRI exige organização ativa.');}
 async list(t:TenantContext,authorizationId:string,month:string){this.allowed(t);cceeUuid(authorizationId);cceeMonth(month);return this.data.rpc('ccee_dri_action',{p_org:t.organizationId,p_actor:t.userId,p_action:'list',p_id:authorizationId,p_body:{month}});}
 async enqueue(t:TenantContext,input:unknown){this.allowed(t);const body=driCommand(input);return this.data.rpc('ccee_dri_action',{p_org:t.organizationId,p_actor:t.userId,p_action:'enqueue',p_id:body.authorizationId,p_body:body});}
 async job(t:TenantContext,id:string){this.allowed(t);const r=await this.data.rpc('ccee_dri_action',{p_org:t.organizationId,p_actor:t.userId,p_action:'job',p_id:cceeUuid(id),p_body:{}});const diagnostic=await this.data.rpc('ccee_dri_diagnostic_read',{p_org:t.organizationId,p_actor:t.userId,p_id:id,p_latest:false});return{...r,diagnostic};}
 async context(t:TenantContext,unitId:string,month:string){this.allowed(t);cceeUuid(unitId);cceeMonth(month);return this.data.rpc('ccee_dri_action',{p_org:t.organizationId,p_actor:t.userId,p_action:'context',p_id:unitId,p_body:{month}});}
}
