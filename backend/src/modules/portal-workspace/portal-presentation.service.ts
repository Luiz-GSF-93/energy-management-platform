import {selectedPortalUnits} from '../../common/services/portal-selected-units';
import {BadRequestException,ConflictException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {extractCpflPaulistaLayout} from '../ocr/cpfl-paulista-layout';
import {normalizePublishedDetail} from '../portal-insights/portal-legacy-detail';

const number=(v:unknown):number|null=>typeof v==='string'&&/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(v)&&Number.isFinite(Number(v))?Number(v):typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
export function invoiceDueDate(raw:any){
 if(!raw)return null;
 const layout=extractCpflPaulistaLayout(raw);if(layout.issues.includes('CONFLICTING_DUEDATE'))return null;
 const values=[...new Set(layout.fields.filter(f=>f.name==='dueDate').map(f=>f.value.text.trim()))];
 if(values.length!==1||!/^\d{2}\/\d{2}\/20\d{2}$/.test(values[0]))return null;
 const [d,m,y]=values[0].split('/'),iso=`${y}-${m}-${d}`,date=new Date(iso+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:null;
}
export function publishedUsage(rows:any[],org:string,unitIds:string[],from:string,to:string){
 const seen=new Set<string>();
 const sources=rows.map(r=>{
  const key=r.unitId+'|'+r.month;
  if(!unitIds.includes(r.unitId)||typeof r.month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(r.month)||r.month<from||r.month>to||seen.has(key))throw new ConflictException('Fontes publicadas divergentes.');seen.add(key);
  let fields:Record<string,unknown>;
  if(r.legacyPayload){normalizePublishedDetail(r,org);const p=r.legacyPayload,prep=p.preparations?.[r.unitId],m=prep?.measurements?.validatedVersion?.measurements,u=p.sources?.tables?.consumer_units?.find((u:any)=>u.id===r.unitId&&u.organization_id===org);
   fields={...m,'unit:contracted_demand':u?.contracted_demand,'unit:contracted_demand_peak':u?.contracted_demand_peak,'unit:contracted_demand_off_peak':u?.contracted_demand_off_peak};
  }else{fields={};for(const f of r.usageFields??[]){if(f.key in fields)throw new ConflictException('Medição publicada ambígua.');fields[f.key]=f.value;}}
  return {month:r.month,unitId:r.unitId,publicationId:r.publicationId,sourceHash:r.sourceHash??r.legacyHash,
   peak:number(fields.consumptionPeak),offPeak:number(fields.consumptionOffPeak),
   demand:number(fields.demandSingle),demandPeak:number(fields.demandPeak),demandOffPeak:number(fields.demandOffPeak),
   contracted:number(fields['unit:contracted_demand']),contractedPeak:number(fields['unit:contracted_demand_peak']),contractedOffPeak:number(fields['unit:contracted_demand_off_peak'])};
 });
 type UsageMonth={month:string;coveredUnits:number;expectedUnits:number}&Record<'peak'|'offPeak'|'demand'|'demandPeak'|'demandOffPeak'|'contracted'|'contractedPeak'|'contractedOffPeak',number|null>;
 const months:UsageMonth[]=[];let cursor=from;
 while(cursor<=to){const selected=sources.filter(r=>r.month===cursor),complete=selected.length===unitIds.length&&unitIds.length>0;
  const sum=(key:keyof typeof sources[number])=>complete&&selected.every(r=>typeof r[key]==='number')?selected.reduce((n,r)=>n+(r[key] as number),0):null;
  months.push({month:cursor,coveredUnits:selected.length,expectedUnits:unitIds.length,peak:sum('peak'),offPeak:sum('offPeak'),demand:sum('demand'),demandPeak:sum('demandPeak'),demandOffPeak:sum('demandOffPeak'),contracted:sum('contracted'),contractedPeak:sum('contractedPeak'),contractedOffPeak:sum('contractedOffPeak')});
  const d=new Date(cursor+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);cursor=d.toISOString().slice(0,7);
 }
 const cards=([['demand','contracted','Única'],['demandPeak','contractedPeak','Ponta'],['demandOffPeak','contractedOffPeak','Fora ponta']] as const).map(([measured,contracted,label])=>{
  const eligible=months.filter(m=>m[measured]!==null&&m[contracted]!==null&&m[contracted]!>0),last=[...months].reverse().find(m=>m[contracted]!==null);
  return {label,contracted:last?.[contracted]??null,contractedMonth:last?.month??null,months:eligible.length,totalMonths:months.length,
   utilization:eligible.length?eligible.reduce((n,m)=>n+m[measured]!,0)/eligible.reduce((n,m)=>n+m[contracted]!,0)*100:null};
 }).filter(c=>c.contracted!==null||c.months>0);
 return {months,cards,sources,notice:'Consumo em kWh; demanda medida e contratada em kW. Somente versões aprovadas e publicadas. Utilização ponderada = soma das demandas medidas / soma das demandas contratadas dos mesmos meses e unidades. Lacunas não representam zero. Demanda faturada não substitui demanda medida. Soma das demandas mensais das unidades não comprova pico simultâneo.'};
}
@Injectable()
export class PortalPresentationService{
 constructor(private db:SupabaseService){}
 async action(t:TenantContext,action:string,id:string|null=null,body:unknown={}){
  if(process.env.PORTAL_CLIENT_WORKSPACE_ENABLED!=='true')throw new ServiceUnavailableException('Portal indisponível.');
  if(t.accessMode||t.role!=='consulta'||!t.organizationId||!t.userId||!t.roleId||id&&!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))throw new ForbiddenException('Use o vínculo do cliente no Portal.');
  const r=await this.db.getClient().rpc('portal_presentation_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_action:action,p_id:id,p_body:body});
  if(r.error?.code==='42501')throw new ForbiddenException('Vínculo, licença, unidade ou documento indisponível.');
  if(['23505','40001'].includes(r.error?.code))throw new ConflictException('O registro mudou. Atualize antes de confirmar novamente.');
  if(r.error?.code==='22023')throw new BadRequestException('Confira os dados informados.');
  if(r.error)throw new ServiceUnavailableException('Este recurso aguarda disponibilidade do serviço. Nenhuma alteração foi confirmada.');
  return r.data;
 }
 async invoice(t:TenantContext,id:string){const r=await this.action(t,'invoice',id);return {id:r.id,dueDate:invoiceDueDate(r.raw),declaration:r.declaration,notice:'Pagamento informado pelo cliente; não equivale a confirmação bancária ou baixa financeira.'};}
 async declare(t:TenantContext,id:string,body:unknown){const r=await this.action(t,'declare',id,body);return {id:r.id,declaration:r.declaration};}
 async usage(t:TenantContext,q:Record<string,string>){
  if(Object.keys(q).some(k=>!['from','to','unitId','unitIds'].includes(k)))throw new BadRequestException('Filtros inválidos.');
  const identity=await this.action(t,'identity');
  const selection=selectedPortalUnits(q.unitIds,identity.units.map((u:any)=>u.id),q.unitId);
  const {unitIds:ignored,...legacyQuery}=q;
  const raw=await this.action(t,'usage',null,legacyQuery);
  if(identity.customerId!==raw.customerId||raw.organizationId!==t.organizationId||!Array.isArray(raw.rows)||raw.rows.some((r:any)=>r.customerId!==identity.customerId))throw new ForbiddenException('O vínculo mudou.');
  const ids=identity.units.filter((u:any)=>!selection||selection.includes(u.id)).map((u:any)=>u.id);
  return {organizationId:t.organizationId,customerId:identity.customerId,from:q.from,to:q.to,unitId:q.unitId??(q.unitIds&&ids.length===1?ids[0]:null),...publishedUsage(raw.rows.filter((r:any)=>ids.includes(r.unitId)),t.organizationId,ids,q.from,q.to)};
 }
}
