import {resolvePortalUnits} from '../../common/services/portal-selected-units';
import {normalizePublishedDetail} from '../portal-insights/portal-legacy-detail';
import {BadRequestException,ConflictException,ForbiddenException,Injectable,InternalServerErrorException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {LicensesService} from '../licenses/services/licenses.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {EnergyPriceQueryDto,EnergyPricePublishDto} from './energy-price.dto';
import {energyPriceDashboard} from './energy-price-dashboard';
import {baselineFromStudy} from './energy-price-score';
import {clientPublishedInsight} from '../portal-insights/portal-insights.model';
@Injectable()
export class EnergyPriceService{
 constructor(private readonly db:SupabaseService,private readonly licenses:LicensesService){}
 private async scope(t:TenantContext,portal:boolean){if(!t.organizationId||!t.userId||!t.roleId||(t.scope as string)==='global'||portal&&(t.role!=='consulta'||t.accessMode))throw new ForbiddenException('Selecione o contexto autorizado.');await this.licenses.requireEntitlement(t.organizationId,'free_market_management');}
 private fail(e:any){if(!e)return;if(e.code==='42501')throw new ForbiddenException('Acesso ao indicador não autorizado.');if(e.code==='40001')throw new ConflictException('A fonte foi alterada. Atualize o estudo.');throw new InternalServerErrorException('Indicador indisponível; nenhum valor foi presumido.');}
 async read(input:unknown,t:TenantContext,portal=false){await this.scope(t,portal);const d=await validateWriteDto(EnergyPriceQueryDto,input as EnergyPriceQueryDto);if(portal&&d.customerId)throw new BadRequestException('O cliente é resolvido pelo vínculo de acesso.');
 if(d.unitIds&&(!portal||d.unitId))throw new BadRequestException('Recorte múltiplo exclusivo do Portal, sem filtro unitário simultâneo.');
 const selection=await resolvePortalUnits(this.db.getClient(),t,d.unitIds);
 const r=await this.db.getClient().rpc(process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED==='true'?'energy_price_read_workspace':'energy_price_read',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_portal:portal,p_year:Number(d.year),p_customer:d.customerId??null,p_unit:d.unitId??null});this.fail(r.error);
 if(r.data?.customerId){const modern=await this.db.getClient().rpc(process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED==='true'?'read_portal_financial_components_v2':'read_eva_published_components',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_portal:portal,p_from:d.year+'-01',p_to:d.year+'-12',p_customer:r.data.customerId});this.fail(modern.error);if(!Array.isArray(modern.data)||modern.data.some((x:any)=>x.customerId!==r.data.customerId||!r.data.units.some((u:any)=>u.id===x.unitId)))throw new ConflictException('Escopo das fontes de preço divergente.');r.data.workspaceV2=process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED==='true';r.data.evaDetails=modern.data.map((r:any)=>clientPublishedInsight(normalizePublishedDetail(r,t.organizationId),process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED==='true'));}
 if(selection){for(const key of ['units','studies','baselines','financial','evaDetails','submarkets'])if(Array.isArray(r.data?.[key]))r.data[key]=r.data[key].filter((x:any)=>selection.includes(key==='units'?x.id:x.unitId));}
 try{return energyPriceDashboard(t.organizationId,Number(d.year),r.data,portal);}catch{throw new ConflictException('Fontes ou escopo do indicador exigem conferência.');}
 }
 async publish(input:unknown,t:TenantContext){await this.scope(t,false);const d=await validateWriteDto(EnergyPricePublishDto,input as EnergyPricePublishDto);
 // Gateway read resolves relationship and live authorization before loading any study.
 // A study cannot be selected through a global admission-less read. Resolve the admission in an org-bounded lookup and require the existing read gateway.
 const lookup=await this.db.getClient().from('acl_economic_studies').select('admission_id').eq('organization_id',t.organizationId).eq('id',d.studyId).maybeSingle();this.fail(lookup.error);if(!lookup.data)throw new ForbiddenException('Estudo indisponível.');
 const r=await this.db.getClient().rpc('acl_economic_study_read',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_id:lookup.data.admission_id,p_after:null});this.fail(r.error);
 const study=(Array.isArray(r.data)?r.data:[]).find((s:any)=>s.id===d.studyId);if(!study||study.hash!==d.hash||!study.financialReview)throw new ConflictException('Estudo exige revisão independente antes de publicar.');
 let baseline:any;try{baseline=baselineFromStudy(study.body.result);}catch{throw new ConflictException('Referência de preço não conciliada.');}if(baseline.state!=='AVAILABLE')throw new ConflictException(baseline.reason);
 const saved=await this.db.getClient().rpc('energy_price_publish',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_platform:t.accessMode==='platform_operation',p_study:d.studyId,p_hash:d.hash,p_request:d.requestId,p_payload:baseline});this.fail(saved.error);return saved.data;
 }
}
