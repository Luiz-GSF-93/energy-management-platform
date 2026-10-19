import {BadRequestException,ConflictException,ForbiddenException,Injectable,InternalServerErrorException} from '@nestjs/common';
import {createHash,randomUUID} from 'crypto';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {validateAvatar} from '../auth/avatar-png';
@Injectable()
export class OrganizationBrandingService {
 constructor(private readonly db:SupabaseService){}
 private async action(t:TenantContext,action:string,revision:number|null=null,body:unknown={}){
  if(!t.organizationId||!t.userId||!t.roleId||(t.scope as string)==='global')throw new ForbiddenException('Selecione uma organização autorizada.');
  const r=await this.db.getClient().rpc('organization_branding_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_action:action,p_revision:revision,p_body:body});
  if(r.error?.code==='42501')throw new ForbiddenException('Identidade visual não autorizada.');
  if(r.error?.code==='40001')throw new ConflictException('A identidade visual mudou. Atualize antes de salvar.');
  if(r.error||r.data?.organizationId!==t.organizationId)throw new InternalServerErrorException('Não foi possível confirmar a identidade visual.');
  return r.data;
 }
 async read(t:TenantContext){const b=await this.action(t,'read');let logo='';
  if(b.objectPath){
   if(!b.objectPath.startsWith(t.organizationId+'/')||b.objectPath.includes('..'))throw new InternalServerErrorException('Logomarca fora do escopo.');
   const file=await this.db.getClient().storage.from('organization-branding').download(b.objectPath);
   if(file.error||!file.data||file.data.size!==b.bytes||b.bytes>60000)throw new InternalServerErrorException('Logomarca indisponível.');
   const bytes=Buffer.from(await file.data.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==b.sha256)throw new InternalServerErrorException('Integridade da logomarca não confirmada.');
   logo=validateAvatar('data:image/png;base64,'+bytes.toString('base64'));
  }
  return {organizationId:b.organizationId,name:b.name,revision:b.revision,updatedAt:b.updatedAt,logo};
 }
 async save(t:TenantContext,input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('Confira a logomarca e a justificativa.');
  const d=input as Record<string,unknown>;
  if(Object.keys(d).sort().join()!=='logo,reason,revision'||!Number.isInteger(d.revision)||Number(d.revision)<0||typeof d.logo!=='string'||d.logo.length>82000||typeof d.reason!=='string'||d.reason.trim().length<10||d.reason.length>1000)throw new BadRequestException('Confira a logomarca e a justificativa.');
  const access=await this.action(t,'access');if(access.revision!==d.revision)throw new ConflictException('A identidade visual mudou. Atualize antes de salvar.');
  const safe=validateAvatar(d.logo);if(!safe)throw new BadRequestException('Selecione uma logomarca.');
  const bytes=Buffer.from(safe.slice(22),'base64'),objectPath=t.organizationId+'/'+randomUUID()+'.png';
  const upload=await this.db.getClient().storage.from('organization-branding').upload(objectPath,bytes,{contentType:'image/png',upsert:false});
  if(upload.error)throw new InternalServerErrorException('Não foi possível preservar a logomarca.');
  // Never delete on an ambiguous RPC outcome: the object may already be referenced by a committed version.
  await this.action(t,'save',Number(d.revision),{object_path:objectPath,sha256:createHash('sha256').update(bytes).digest('hex'),mime:'image/png',bytes:bytes.length,reason:d.reason.trim()});
  return this.read(t);
 }
}
