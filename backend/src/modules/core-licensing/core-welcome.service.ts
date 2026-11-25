import {BadRequestException,ConflictException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {createHash,randomUUID} from 'node:crypto';
import {UsersService} from '../admin/users/services/users.service';
import {CoreLicenseService} from './core-license.service';
import {coreWelcomeEmail} from './core-welcome-email';
import {openCorePassword,sealCorePassword,temporaryCorePassword} from './core-welcome-crypto';

@Injectable()
export class CoreWelcomeService{
 constructor(private licenses:CoreLicenseService,private users:UsersService,private config:ConfigService){}
 async welcome(token:unknown,raw:unknown){
  const actor=this.licenses.authorize(token);
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==1||!('id'in raw)||typeof raw.id!=='string'||!/^[a-f0-9-]{36}$/i.test(raw.id))throw new BadRequestException('Protocolo de boas-vindas inválido.');
  const id=raw.id,command=(action:string,body:Record<string,unknown>={})=>this.licenses.rpc('platform_core_welcome_action',{p_actor:actor,p_action:action,p_body:{id,...body}});
  let job=await command('read');
  const result=()=>({id,state:job.state,retryAfterSeconds:job.state==='SENDING'?Math.min(1800,60*2**Math.max(0,job.mail_attempts-1)):60});
  if(['SENT','UNKNOWN','FAILED'].includes(job.state))return result();
  const secret=this.config.get<string>('SALES_CORE_WELCOME_ENCRYPTION_KEY')||'',mailKey=this.config.get<string>('RESEND_API_KEY'),url=this.config.get<string>('FRONTEND_URL')||'';
  const origin=new URL(url);if(origin.protocol!=='https:'||origin.username||origin.password||!mailKey)throw new ServiceUnavailableException('Primeiro acesso e envio de boas-vindas não configurados.');
  // Validate encryption before leasing or creating any identity.
  sealCorePassword(secret,id,'configuration-validation');
  if(job.state==='PREPARED'){
   const password=temporaryCorePassword(),leaseId=randomUUID(),expiresAt=new Date(Date.now()+24*3600000).toISOString();
   job=await command('lease',{leaseId,cipher:sealCorePassword(secret,id,password),expiresAt});
   if(job.state!=='PROVISIONING'||job.lease_id!==leaseId)return result();
   try{
    const identity=await this.users.invite({email:job.email,name:job.name,roleId:job.role_id,affiliationType:'internal'},{actorUserId:actor,organizationId:job.organization_id,platformOperation:true,userAgent:'Energy Core paid license onboarding'},{password,expiresAt,jobId:id});
    job=await command('identity',{leaseId,userId:identity.userId,membershipId:identity.membershipId,path:identity.provisioningPath});
   }catch{
    // Auth creation has no provider idempotency guarantee. Never repeat automatically.
    job=await command('unknown',{leaseId});return result();
   }
  }
  if(job.state==='PROVISIONING')return result();
  if(!['IDENTITY_READY','SENDING'].includes(job.state))return result();
  if(Date.parse(job.expires_at)<=Date.now()||job.mail_attempts>=5){job=await command('unknown',{leaseId:job.lease_id});return result();}
  const nextLeaseId=randomUUID();
  const message=coreWelcomeEmail({name:job.name,email:job.email,organization:job.organization_name,url,password:job.provisioning_path==='new_identity'?openCorePassword(secret,id,job.password_cipher):null,expiresAt:job.expires_at});
  const body=JSON.stringify({from:this.config.get<string>('MEMBERSHIP_EMAIL_FROM')||'EnergyOS <nao-responda@notificacoes.expertenergy.com.br>',to:[job.email],...message});
  try{job=await command('sending',{leaseId:job.lease_id,nextLeaseId,mailHash:createHash('sha256').update(body).digest('hex')});}catch(error){if(error instanceof ConflictException)return{id,state:'PENDING',retryAfterSeconds:60};throw error;}
  if(job.state==='SENT')return result();
  try{
   const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+mailKey,'Content-Type':'application/json','Idempotency-Key':'energyos-core-welcome/'+id},body,signal:AbortSignal.timeout(15000)});
   if(response.ok){const text=await response.text();if(text.length>5000)return result();const data=JSON.parse(text);if(typeof data.id==='string'&&data.id.length<=200){job=await command('sent',{leaseId:nextLeaseId,providerId:data.id});return result();}}
   else if(![408,409,429].includes(response.status)&&response.status<500){job=await command('unknown',{leaseId:nextLeaseId});return result();}
   // Retry only the identical mail, with the same provider idempotency key, within 24h.
  }catch{/* Preserve SENDING for bounded, identical-key confirmation. */}
  return result();
 }
}
