import {BadRequestException,ConflictException,ForbiddenException,InternalServerErrorException} from '@nestjs/common';
export async function checkPortalInvite(client:any,input:{customerId?:string;affiliationType:string},role:{name:string},org:string){
 if(!input.customerId)return;
 if(process.env.CLIENT_PORTAL_LICENSES_ENABLED!=='true')throw new ForbiddenException('Cadastro de usuário do Portal ainda não ativado.');
 if(input.affiliationType!=='external'||role.name!=='consulta')throw new BadRequestException('O Portal exige vínculo externo e função Consulta.');
 const now=new Date().toISOString().slice(0,10);
 const [customer,license,capacity,members]=await Promise.all([
 client.from('customers').select('id,organization_id,status,deleted_at').eq('id',input.customerId).eq('organization_id',org).maybeSingle(),
 client.from('client_portal_licenses').select('id,organization_id,customer_id,status,starts,ends,max_users').eq('organization_id',org).eq('customer_id',input.customerId).maybeSingle(),
 client.rpc('client_capacity',{org}),
 client.from('organization_members').select('id',{count:'exact',head:true}).eq('organization_id',org).eq('exclusive_customer_id',input.customerId).eq('status','active').eq('affiliation_type','external'),
 ]);
 if([customer,license,capacity,members].some(x=>x.error))throw new InternalServerErrorException('Não foi possível conferir as condições do Portal. Nenhum convite foi criado.');
 if(customer.data?.id!==input.customerId||customer.data?.organization_id!==org||customer.data?.status!=='ACTIVE'||customer.data?.deleted_at!==null)throw new ForbiddenException('Cliente ativo não encontrado nesta organização.');
 if(capacity.data?.portalContracted!==true||license.data?.organization_id!==org||license.data?.customer_id!==input.customerId||license.data?.status!=='ACTIVE'||typeof license.data.starts!=='string'||typeof license.data.ends!=='string'||license.data.starts>now||license.data.ends<now)throw new ForbiddenException('Ative e confira a licença deste cliente antes de convidar um usuário ao Portal.');
 if(!Number.isInteger(members.count)||members.count<0||!Number.isInteger(license.data.max_users))throw new InternalServerErrorException('Uso das vagas do cliente não confirmado.');
 if(members.count>=license.data.max_users)throw new ConflictException('O limite de usuários deste cliente foi atingido. Revise sua distribuição dentro do plano.');
 if(capacity.data?.configured!==true||capacity.data?.shared!==true||capacity.data?.resource!=='users'||!Number.isInteger(capacity.data?.available)||capacity.data.available<=0)throw new ConflictException('Sem vaga de usuário disponível no plano. Solicite revisão ao administrador da plataforma.');
 // The insertion carries the exclusive binding. Existing parent/child database quota triggers are the concurrent authority.
}
