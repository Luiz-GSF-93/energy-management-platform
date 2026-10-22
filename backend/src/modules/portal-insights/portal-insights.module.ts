import {feeCents,feeMoney} from '../contracts/services/management-fee';
import {consolidatePublishedComposition} from './portal-composition-summary';
import {normalizePublishedDetail} from './portal-legacy-detail';
import {Module,Injectable,Controller,Get,Post,Body,Query,Header,ForbiddenException,BadRequestException,InternalServerErrorException,ConflictException} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {SupabaseService} from '../../services/supabase.service';
import {clientPublishedInsight} from './portal-insights.model';
@Injectable()
export class PortalInsightsService {
 constructor(private db:SupabaseService){}
 async read(t:TenantContext,from:string,to:string,unitId?:string,month?:string){
  if(t.role!=='consulta'||t.accessMode||!t.organizationId||!t.userId||!t.roleId)throw new ForbiddenException('Use o Portal do cliente.');
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(from??'')||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(to??'')||from>to||(Number(to.slice(0,4))-Number(from.slice(0,4)))*12+Number(to.slice(5))-Number(from.slice(5))>11)throw new BadRequestException('Selecione até 12 meses.');
  if(unitId&&!/^[A-Za-z0-9_-]{1,100}$/.test(unitId)||month&&(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||month<from||month>to))throw new BadRequestException('Filtro de composição inválido.');
  const db=this.db.getClient();const binding=await db.rpc('client_portal_entitlement',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_module:'reports'});
  if(binding.error||binding.data?.enabled!==true||binding.data.organizationId!==t.organizationId||!binding.data.customerId)throw new ForbiddenException('Licença ou vínculo indisponível.');
  const customer=binding.data.customerId,r=await db.rpc(process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED==='true'?'read_portal_financial_components_v2':'read_eva_published_components',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:false,p_portal:true,p_from:from,p_to:to,p_customer:customer});
  if(r.error||!Array.isArray(r.data))throw new InternalServerErrorException('Detalhes publicados indisponíveis.');
  if(r.data.some((x:any)=>x.customerId!==customer||x.month<from||x.month>to||typeof x.unitId!=='string'))throw new ForbiddenException('Escopo dos componentes divergente.');
  const rows=r.data.filter((x:any)=>(!unitId||x.unitId===unitId)&&(!month||x.month===month)).map((r:any)=>clientPublishedInsight(normalizePublishedDetail(r,t.organizationId),process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED==='true'));
  rows.forEach((r:any)=>{r.indicators=r.indicators.map((i:any,index:number)=>({...i,key:i.kind+':'+index}));});
  const corrections=await db.rpc('portal_waste_correction_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_action:'read',p_body:{from,to,...(unitId?{unitId}:{})}});
  if(corrections.error||!Array.isArray(corrections.data))throw new InternalServerErrorException('Histórico de correções indisponível.');
  let paymentDeclarations:any[]=[];
  if(process.env.PORTAL_PAYMENT_DECLARATIONS_ENABLED==='true'){
   const evidence=await db.rpc('portal_presentation_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_action:'payment_evidence',p_id:null,p_body:{from,to,...(unitId?{unitId}:{})}});
   if(evidence.error||!Array.isArray(evidence.data))throw new InternalServerErrorException('Declarações do cliente indisponíveis.');
   paymentDeclarations=evidence.data;
  }
  const visibleCorrections=corrections.data.filter((c:any)=>rows.some((r:any)=>r.publicationId===c.publicationId&&r.unitId===c.unitId&&r.sourceHash===c.sourceHash&&r.indicators.some((i:any)=>i.key===c.key&&i.amount===c.amount)));
  return {organizationId:t.organizationId,customerId:customer,from,to,rows,consolidated:consolidatePublishedComposition(rows),corrections:visibleCorrections,correctionTotal:feeMoney(visibleCorrections.filter((c:any)=>c.corrected===true).reduce((n:bigint,c:any)=>n+feeCents(c.amount),0n)),paymentDeclarations,paymentNotice:'Declaração do cliente com autoria/data; não é confirmação bancária, comprovante de quitação ou baixa financeira.'};
 }
 async correct(t:TenantContext,body:any){
  if(!body||Object.keys(body).some(k=>!['publicationId','unitId','sourceHash','key','month','corrected','revision','requestId'].includes(k))||typeof body.corrected!=='boolean'||!Number.isSafeInteger(body.revision)||body.revision<0||typeof body.key!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(body.month??'')||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(body.requestId??''))throw new BadRequestException('Confira a declaração de correção.');
  const current=await this.read(t,body.month,body.month,body.unitId),source=current.rows.find((r:any)=>r.publicationId===body.publicationId&&r.unitId===body.unitId&&r.sourceHash===body.sourceHash),indicator=source?.indicators.find((i:any)=>i.key===body.key);
  if(!indicator)throw new ConflictException('A fonte publicada mudou. Atualize antes de informar a correção.');
  const result=await this.db.getClient().rpc('portal_waste_correction_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_action:'save',p_body:{...body,label:indicator.label,amount:indicator.amount}});
  if(result.error?.code==='40001'||result.error?.code==='23505')throw new ConflictException('O registro mudou. Atualize antes de repetir.');
  if(result.error?.code==='42501')throw new ForbiddenException('Vínculo ou publicação indisponível.');
  if(result.error)throw new InternalServerErrorException('Registro não confirmado. Atualize o histórico antes de repetir.');
  return {recorded:true,notice:'Correção declarada pelo cliente. Valor potencial associado, sem comprovação de economia realizada.'};
 }
}
@Controller('portal/financial-details')
class PortalInsightsController {
 constructor(private service:PortalInsightsService){}
 @Get() @Header('Cache-Control','no-store') read(@Tenant() t:TenantContext,@Query() q:Record<string,string>){if(Object.keys(q).some(k=>!['from','to','unitId','month'].includes(k)))throw new BadRequestException('Filtros inválidos.');return this.service.read(t,q.from,q.to,q.unitId,q.month);}
 @Post('corrections') @Header('Cache-Control','no-store') correct(@Tenant()t:TenantContext,@Body()body:any){return this.service.correct(t,body);}
}
@Module({controllers:[PortalInsightsController],providers:[SupabaseService,PortalInsightsService],exports:[PortalInsightsService]})
export class PortalInsightsModule {}
