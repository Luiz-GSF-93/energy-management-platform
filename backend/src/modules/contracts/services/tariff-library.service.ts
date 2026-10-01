import {Injectable,BadRequestException,ConflictException,NotFoundException,InternalServerErrorException,UnauthorizedException} from '@nestjs/common';
import {createHash} from 'crypto';
import {SupabaseService} from '../../../services/supabase.service';
import {LicensesService} from '../../licenses/services/licenses.service';
import {validateWriteDto} from '../../../common/validation/validate-write-dto';
import {LibraryWriteDto,LibraryApplyDto} from '../dto/tariff-library.dto';
import {libraryPlan,validateProfile} from './tariff-library-plan';
import {auditAuthorNames} from './audit-author-names';
import {elektroTariffSeed} from './tariff-library-seed';
@Injectable()
export class TariffLibraryService {
 constructor(private db:SupabaseService,private licenses:LicensesService){}
 private async allowed(org:string){await this.licenses.requireEntitlement(org,'free_market_management');}
 private fail(e:any){if(!e)return;if(e.code==='P1353')throw new NotFoundException('Registro indisponível nesta organização.');if(['P1352','23505'].includes(e.code))throw new ConflictException('A versão mudou. Atualize a biblioteca.');if(e.code==='P1354')throw new ConflictException('Já existem parâmetros ou custos adicionais no período deste lote. Revise os registros existentes; nenhum lançamento foi duplicado.');if(['P1351','P3301','23514','22P02'].includes(e.code))throw new BadRequestException('Confira os valores, bases e vigências.');throw new InternalServerErrorException('Não foi possível acessar a biblioteca tarifária.');}
 private actor(actor:string){if(!actor)throw new UnauthorizedException('Autor não identificado.');}
 async list(org:string){await this.allowed(org);const r=await this.db.getClient().from('tariff_library_versions').select('*').eq('organization_id',org).order('created_at',{ascending:false});this.fail(r.error);return auditAuthorNames(this.db.getClient(),org,(r.data??[]).map((x:any)=>({...x,actor_id:x.created_by})));}
 async seed(org:string){await this.allowed(org);return elektroTariffSeed;}
 async save(input:LibraryWriteDto,org:string,actor:string){await this.allowed(org);this.actor(actor);const d=await validateWriteDto(LibraryWriteDto,input);validateProfile(d);const {previousId,reason,...profile}=d;const r=await this.db.getClient().rpc('save_tariff_library',{p_org:org,p_actor:actor,p_profile:profile,p_reason:reason,p_previous:previousId??null});this.fail(r.error);return r.data;}
 private async prepare(id:string,input:LibraryApplyDto,org:string){await this.allowed(org);const d=await validateWriteDto(LibraryApplyDto,input);const a=await this.db.getClient().from('tariff_library_versions').select('*').eq('id',id).eq('organization_id',org).maybeSingle();this.fail(a.error);if(!a.data)throw new NotFoundException('Tabela não encontrada.');const q=await this.db.getClient().from('consumer_units').select('*').eq('id',d.consumerUnitId).eq('organization_id',org).maybeSingle();this.fail(q.error);if(!q.data)throw new NotFoundException('Unidade não encontrada.');const plan=libraryPlan(a.data,d,q.data,new Date().toISOString().slice(0,10));return{d,unit:q.data,...plan};}
 async preview(id:string,d:LibraryApplyDto,org:string){const p=await this.prepare(id,d,org);return {rows:p.rows,monthlyCosts:p.monthlyCosts,notes:p.notes};}
 async apply(id:string,input:LibraryApplyDto,org:string,actor:string){this.actor(actor);const p=await this.prepare(id,input,org);const context=Object.fromEntries(['distributor','tariff_group','tariff_subgroup','tariff_modality','state','consumption_class','free_market'].map(k=>[k,p.unit[k]??null]));const hash=createHash('sha256').update(JSON.stringify({id,settings:p.d})).digest('hex');const r=await this.db.getClient().rpc('apply_tariff_library',{p_org:org,p_actor:actor,p_library:id,p_unit:p.d.consumerUnitId,p_hash:hash,p_settings:p.d,p_rows:p.rows,p_context:context,p_costs:p.monthlyCosts});this.fail(r.error);return r.data;}
}
