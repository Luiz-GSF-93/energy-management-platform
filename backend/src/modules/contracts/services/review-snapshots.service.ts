import {createHash} from 'node:crypto';
import {Injectable,BadRequestException,ConflictException,InternalServerErrorException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {SupabaseService} from '../../../services/supabase.service';
import {LicensesService} from '../../licenses/services/licenses.service';
import {TenantContext} from '../../../common/interfaces/tenant-context.interface';
import {validateWriteDto} from '../../../common/validation/validate-write-dto';
import {CalculationPreparationService} from './preparation.service';
import {auditAuthorNames} from './audit-author-names';
import {CreateReviewSnapshotDto,ReviewSnapshotQueryDto} from '../dto/review-snapshots.dto';
// PostgreSQL JSONB reorders keys. Canonicalize recursively before signing or verifying.
export function reviewDigest(value:unknown):string {
 const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
@Injectable()
export class ReviewSnapshotsService {
 constructor(private db:SupabaseService,private licenses:LicensesService,private preparation:CalculationPreparationService){}
 private table(){return this.db.getClient().from('calculation_review_snapshots');}
 private fail(error:any){if(error)throw new InternalServerErrorException('Não foi possível consultar ou preservar a revisão. Tente novamente com a mesma solicitação.');}
 private async allowed(t:TenantContext){if(!t.organizationId||!t.userId)throw new UnauthorizedException('Contexto organizacional ausente.');await this.licenses.requireEntitlement(t.organizationId,'free_market_management');}
 private async unit(id:string,t:TenantContext){const r=await this.db.getClient().from('consumer_units').select('id,customer_id').eq('id',id).eq('organization_id',t.organizationId).maybeSingle();this.fail(r.error);if(!r.data)throw new NotFoundException('Unidade não encontrada nesta organização.');const c=await this.db.getClient().from('customers').select('id').eq('id',r.data.customer_id).eq('organization_id',t.organizationId).is('deleted_at',null).maybeSingle();this.fail(c.error);if(!c.data)throw new NotFoundException('Cliente indisponível.');return r.data;}
 private async present(row:any,t:TenantContext):Promise<Record<string,any>>{if(!row||row.organization_id!==t.organizationId||reviewDigest(row.payload)!==row.payload_hash)throw new InternalServerErrorException('A integridade da revisão não pôde ser confirmada.');const named=(await auditAuthorNames(this.db.getClient(),t.organizationId,[row]))[0];const {payload,...meta}=named;return {...meta,result:payload.result,captureStartedAt:payload.captureStartedAt,captureFinishedAt:payload.captureFinishedAt,formulaVersion:payload.formatVersion};}
 async list(input:ReviewSnapshotQueryDto,t:TenantContext){await this.allowed(t);const d=await validateWriteDto(ReviewSnapshotQueryDto,input);await this.unit(d.consumerUnitId,t);let query=this.table().select('id,organization_id,customer_id,consumer_unit_id,month,version,status,note,created_by,created_at,payload_hash').eq('organization_id',t.organizationId).eq('consumer_unit_id',d.consumerUnitId).eq('month',d.month);if(d.beforeVersion)query=query.lt('version',Number(d.beforeVersion));const r=await query.order('version',{ascending:false}).range(0,20);this.fail(r.error);if(!Array.isArray(r.data))throw new InternalServerErrorException('Histórico indisponível.');return {rows:await auditAuthorNames(this.db.getClient(),t.organizationId,r.data.slice(0,20)),nextBeforeVersion:r.data.length>20?String(r.data[19].version):null};}
 async one(id:string,t:TenantContext){await this.allowed(t);const r=await this.table().select('*').eq('id',id).eq('organization_id',t.organizationId).maybeSingle();this.fail(r.error);if(!r.data)throw new NotFoundException('Revisão não encontrada nesta organização.');await this.unit(r.data.consumer_unit_id,t);return this.present(r.data,t);}
 async create(input:CreateReviewSnapshotDto,t:TenantContext){await this.allowed(t);const d=await validateWriteDto(CreateReviewSnapshotDto,input);d.note=d.note.trim();if(d.note.length<3)throw new BadRequestException('Descreva o motivo desta revisão.');const u=await this.unit(d.consumerUnitId,t);
 const lookup=async()=>{const r=await this.table().select('*').eq('organization_id',t.organizationId).eq('request_id',d.requestId).maybeSingle();this.fail(r.error);return r.data;};
 const replay=async(row:any)=>{if(row.consumer_unit_id!==u.id||row.month!==d.month||row.note!==d.note||row.created_by!==t.userId)throw new ConflictException('Esta solicitação já identifica outra revisão. Atualize o histórico.');return this.present(row,t);};
 const previous=await lookup();if(previous)return replay(previous);
 const captureStartedAt=new Date().toISOString();let sources:Record<string,unknown>|undefined;
 const result=await this.preparation.inspect({consumerUnitId:u.id,month:d.month},t.organizationId,s=>{sources=s;});
 if(!sources||result.unit.id!==u.id||result.month!==d.month)throw new InternalServerErrorException('Não foi possível preservar as fontes da revisão.');
 const payload=JSON.parse(JSON.stringify({formatVersion:'unit-review-snapshot-1.0',captureStartedAt,captureFinishedAt:new Date().toISOString(),consistency:'CAPTURED_INPUTS_NOT_TRANSACTIONAL',sources,result}));
 if(Buffer.byteLength(JSON.stringify(payload),'utf8')>2000000)throw new BadRequestException('Revisão muito extensa para preservação síncrona. Nenhuma versão foi criada.');
 const r=await this.table().insert([{organization_id:t.organizationId,customer_id:u.customer_id,consumer_unit_id:u.id,month:d.month,request_id:d.requestId,note:d.note,created_by:t.userId,payload,payload_hash:reviewDigest(payload)}]).select().single();
 if(r.error?.code==='23505'){const concurrent=await lookup();if(concurrent)return replay(concurrent);}this.fail(r.error);return this.present(r.data,t);
 }
}
