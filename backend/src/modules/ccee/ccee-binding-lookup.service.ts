import {BadRequestException,Body,Controller,Get,Header,Injectable,Param,Post} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {CceeDataService} from './ccee-data.service';
import {CceeMarketConnector} from './ccee-market.connector';
import {cceeConfig,CceeConfig,soapRequest} from './ccee-config';
import {cceeObject,cceeUuid} from './ccee-data.model';
import {CceeReadingError,privateEnvelope,privateSoap} from './ccee-private.connector';

const list=(v:any):any[]=>v==null||v===''?[]:Array.isArray(v)?v:[v];
const code=(v:unknown)=>typeof v==='string'&&/^\d{1,12}$/.test(v);
export function bindingProfileRequest(config:CceeConfig,agent:string,page:number){
 if(!code(agent))throw new CceeReadingError('INVALID_PARTICIPANT');
 return soapRequest(config,'profile',page).replace('<mh:quantidadeItens>2</mh:quantidadeItens>','<mh:quantidadeItens>20</mh:quantidadeItens>').replace(/<soapenv:Body>[\s\S]*?<\/soapenv:Body>/,`<soapenv:Body><bm:listarPerfilParticipanteMercadoRequest><bm:perfilParticipanteMercado><bo:participanteMercado><bo:codigo>${agent}</bo:codigo></bo:participanteMercado></bm:perfilParticipanteMercado></bm:listarPerfilParticipanteMercadoRequest></soapenv:Body>`);
}
export function bindingProfiles(xml:string,agent:string,page:number){
 const parsed=privateEnvelope(xml,2,'listarPerfilParticipanteMercadoResponse',['vigencia']);
 const pages=Number(parsed.pagination?.totalPaginas),total=Number(parsed.pagination?.quantidadeTotalItens);
 if(Number(parsed.pagination?.numero)!==page||!Number.isInteger(pages)||pages<1||pages>2||!Number.isInteger(total)||total<0||total>20)throw new CceeReadingError('PROFILE_CATALOG_LIMIT');
 const profiles=list(parsed.body?.perfis?.perfil).map(p=>{
  if(!code(p.codigo)||p.participanteMercado?.codigo!==agent)throw new CceeReadingError('PROFILE_PARTICIPANT_MISMATCH');
  return {code:p.codigo,agentCode:agent,name:String(p.sigla??p.nome??p.codigo).slice(0,200),principal:p.perfilPrincipal==='true',validFrom:p.periodoVigencia?.inicio?.slice(0,10)??null,validTo:p.periodoVigencia?.fim?.slice(0,10)??null,submarket:p.submercado?.nome??null};
 });
 return {...parsed,profiles,pages,total};
}
export function bindingPoints(xml:string,profile:string,page:number){
 const parsed=privateEnvelope(xml,2,'listarPontoMedicaoResponse');
 const pages=Number(parsed.pagination?.totalPaginas),total=Number(parsed.pagination?.quantidadeTotalItens);
 if(Number(parsed.pagination?.numero)!==page||!Number.isInteger(pages)||pages<1||pages>3||!Number.isInteger(total)||total<0||total>100)throw new CceeReadingError('POINT_CATALOG_LIMIT');
 const points=list(parsed.body?.pontosMedicao?.pontoMedicao).map(p=>{
  if(typeof p.codigo!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(p.codigo))throw new CceeReadingError('POINT_ID_MISSING');
  const meters=list(p.medidores?.medidor).map(m=>m.codigo).filter(m=>typeof m==='string'&&/^[-A-Za-z0-9_]{1,100}$/.test(m));
  return {code:p.codigo,profileCode:profile,name:String(p.nome??p.sigla??p.descricao??p.codigo).slice(0,250),meters:[...new Set(meters)]};
 });
 return {...parsed,points,pages,total};
}

@Injectable()
export class CceeBindingLookupService{
 constructor(private data:CceeDataService,private transport:CceeMarketConnector,private db:SupabaseService){}
 async context(t:TenantContext,unit:string){
  const ws=await this.data.workspace(t);if(!ws.canManage)throw new BadRequestException('Permissão para preparar vínculos necessária.');
  cceeUuid(unit);return this.data.rpc('ccee_binding_context',{p_org:t.organizationId,p_actor:t.userId,p_unit:unit});
 }
 async discover(t:TenantContext,unit:string,input:unknown){
  if(process.env.CCEE_PRIVATE_READ_ENABLED!=='true')throw new BadRequestException('A consulta técnica privada CCEE está desabilitada. Dados anteriores foram preservados.');
  await this.context(t,unit);const b=cceeObject(input,['requestId'],['profileCode']);cceeUuid(b.requestId);
  if(b.profileCode&&!code(b.profileCode))throw new BadRequestException('Selecione um perfil recebido da CCEE.');
  const task=await this.data.rpc('ccee_reference_task',{p_org:t.organizationId,p_actor:t.userId,p_action:'lookup',p_id:null,p_lease:null,p_body:{unitId:unit,...b}});
  if(task.state==='SUCCEEDED')return {organizationId:t.organizationId,unitId:unit,...task.result};
  if(task.replayed&&task.state==='RUNNING')throw new BadRequestException('Esta busca ainda está em andamento. Aguarde a conclusão antes de solicitar outra.');
  if(task.state!=='RUNNING')throw new BadRequestException('Consulte o resultado anterior antes de repetir a busca.');
  let config:CceeConfig|undefined;let requests=0;const hashes:string[]=[],transactions:string[]=[];
  const action=async(name:string,body:any)=>{const r=await this.db.getClient().rpc('ccee_reference_task',{p_org:t.organizationId,p_actor:t.userId,p_action:name,p_id:task.id,p_lease:task.lease_id,p_body:body});if(r.error)throw new CceeReadingError(r.error.message?.includes('BUDGET')?'BUDGET_EXHAUSTED':'REFERENCE_CONTEXT_CHANGED');return r.data;};
  try{
   config=cceeConfig(process.env);if(config.organizationId!==t.organizationId)throw new CceeReadingError('ORGANIZATION_NOT_CONFIGURED');
   const agent=task.context.discovery?.participant?.agentCode??task.context.previousBinding?.dri_agent_code;
   const read=async(kind:'PROFILE'|'POINTS',payload:string,cfg=config!)=>{await action('reserve',{});requests++;const buffer=Buffer.from(payload);try{return await this.transport.fetch(cfg,kind,buffer);}finally{buffer.fill(0);}};
   const profiles:any[]=[];let pages=1,total=-1;
   for(let page=1;page<=pages;page++){
    const parsed=bindingProfiles(await read('PROFILE',bindingProfileRequest(config,agent,page)),agent,page);
    if(page>1&&(pages!==parsed.pages||total!==parsed.total))throw new CceeReadingError('PROFILE_CATALOG_CHANGED');
    pages=parsed.pages;total=parsed.total;profiles.push(...parsed.profiles);hashes.push(parsed.hash);if(parsed.transactionId)transactions.push(parsed.transactionId);
   }
   if(profiles.length!==total||new Set(profiles.map(p=>p.code)).size!==profiles.length)throw new CceeReadingError('PROFILE_COVERAGE_INCOMPLETE');
   let selected=b.profileCode??(profiles.length===1?profiles[0].code:task.context.previousBinding?.profile_code);
   if(selected&&!profiles.some(p=>p.code===selected)){if(b.profileCode)throw new CceeReadingError('PROFILE_NOT_IN_CATALOG');selected=undefined;}
   const points:any[]=[];
   if(selected){
    const cfg={...config,profile:selected};let count=-1;pages=1;
    for(let page=1;page<=pages;page++){
     const parsed=bindingPoints(await read('POINTS',privateSoap(cfg,'POINTS','','FINAL','','',null,page).replace('<mh:quantidadeItens>2</mh:quantidadeItens>','<mh:quantidadeItens>50</mh:quantidadeItens>'),cfg),selected,page);
     if(page>1&&(pages!==parsed.pages||count!==parsed.total))throw new CceeReadingError('POINT_CATALOG_CHANGED');
     pages=parsed.pages;count=parsed.total;points.push(...parsed.points);hashes.push(parsed.hash);if(parsed.transactionId)transactions.push(parsed.transactionId);
    }
    if(points.length!==count||new Set(points.map(p=>p.code)).size!==points.length)throw new CceeReadingError('POINT_COVERAGE_INCOMPLETE');
   }
   const result={profiles,points,hashes,transactions,requests,retrievedAt:new Date().toISOString(),agentCode:agent,selectedProfileCode:selected??null,notice:'Sugestões da API, sem concessão de representação. Confirme a instalação do ponto e o perfil principal SCDE antes de aprovar o vínculo.'};
   await action('finish',{result});return {organizationId:t.organizationId,unitId:unit,...result};
  }catch(e){
   const error=e instanceof CceeReadingError?e.code:'BINDING_LOOKUP_UNCONFIRMED';
   try{await action('finish',{error});}catch{/* An expired or changed context must not save provider data. */}
   throw new BadRequestException(error.includes('BUDGET')?'Limite de consultas atingido. As fontes anteriores foram preservadas.':'A CCEE não confirmou todos os dados desta busca. Confira a identificação do participante e a representação; os dados cadastrados foram preservados.');
  }finally{config?.pfx.fill(0);}
 }
}
@Controller('ccee-data/binding-context')
export class CceeBindingLookupController{
 constructor(private service:CceeBindingLookupService){}
 @Get(':unitId') @Header('Cache-Control','private, no-store') read(@Tenant()t:TenantContext,@Param('unitId')id:string){return this.service.context(t,id);}
 @Post(':unitId/discover') discover(@Tenant()t:TenantContext,@Param('unitId')id:string,@Body()body:unknown){return this.service.discover(t,id,body);}
}
