import {Body,Controller,ForbiddenException,Get,Injectable,Param,Post,BadRequestException,ConflictException} from '@nestjs/common';
import {Tenant} from '../../common/decorators/tenant.decorator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS} from '../../common/constants/permissions';
import {MonthlyCostsService} from '../contracts/services/monthly-costs.service';
import {CceeDriService} from './ccee-dri.service';
import {cceeMonth,cceeObject,cceeText} from './ccee-data.model';
import {contractHash} from './ccee-contract-api.model';
export function driMcpCandidate(value:any){
 const j=value?.job,b=value?.binding,d=j?.result?.data;
 if(!j||j.kind!=='DRI_RESULTS'||j.state!=='SUCCEEDED'||j.result?.complete!==true||d?.reportId!=='114'||d?.frameId!=='451'||d?.participantTaxId!==b?.dri_tax_id||d?.rows?.length!==1||!/^\d{14}$/.test(d.participantTaxId)||!/^[a-f0-9]{64}$/.test(d.sourceHash))throw new BadRequestException('Este quadro ainda não tem rubrica financeira homologada para preparação.');
 const row=d.rows[0],columns=row.columns,cells=row.cells;
 if(!Array.isArray(columns)||!Array.isArray(cells)||columns.length!==cells.length)throw new BadRequestException('Estrutura financeira mudou.');
 const indexes=columns.map((s:string,i:number)=>({s,i})).filter((x:any)=>/^VALOR A LIQUIDAR PELO AGENTE - V_TOT_LIQUI .*,M - \(R\$\)$/.test(x.s));
 const tax=columns.indexOf('CNPJ DO AGENTE');if(indexes.length!==1||tax<0||String(cells[tax]).replace(/\D/g,'')!==b.dri_tax_id)throw new BadRequestException('Coluna ou participante exige revisão.');
 const signed=cells[indexes[0].i];if(typeof signed!=='string'||!/^[-+]?\d{1,12}(?:\.\d{1,8})?$/.test(signed))throw new BadRequestException('Valor de liquidação ausente.');
 const [whole,fraction='']=signed.replace(/^[-+]/,'').split('.');if(/[1-9]/.test(fraction.slice(2)))throw new BadRequestException('A fonte possui frações de centavo; conferir arredondamento.');
 const amount=BigInt(whole).toString()+'.'+fraction.padEnd(2,'0').slice(0,2);
 return{mapVersion:'CCEE_SUM001_Q4_MCP_1',jobId:j.id,authorizationId:j.authorization_id,unitId:b.consumer_unit_id,customerId:b.customer_id,accountingMonth:d.month,eventCode:d.eventCode,reportId:d.reportId,frameId:d.frameId,sourceHash:d.sourceHash,sourceColumn:columns[indexes[0].i],signedValue:signed,amount,suggestedEffect:signed.startsWith('-')?'COST':'CREDIT',notice:'Valor a liquidar no escopo do agente. Confirme unidade, competência de desembolso, natureza e composição; não comprova pagamento nem todos os encargos CCEE.'};
}
@Injectable()
export class CceeDriCostService{
 constructor(private dri:CceeDriService,private costs:MonthlyCostsService){}
 async candidate(t:TenantContext,id:string){const source=await this.dri.job(t,id);return{organizationId:t.organizationId,candidate:driMcpCandidate(source)};}
 async prepare(t:TenantContext,id:string,input:unknown){
  if(t.accessMode!=='platform_operation'&&!t.permissions.includes(PERMISSIONS.ORGANIZATION_CONTRACTS_UPDATE))throw new ForbiddenException('Preparar custos exige permissão de contratos.');
  const b=cceeObject(input,['month','effect','sourceHash','reason','confirmed']);cceeMonth(b.month);cceeText(b.reason,700,30);
  if(b.confirmed!==true||!['COST','CREDIT'].includes(b.effect))throw new BadRequestException('Confirme a alocação e o valor final.');
  const source=await this.dri.job(t,id),c=driMcpCandidate(source),binding=source.binding;
  if(b.sourceHash!==c.sourceHash)throw new ConflictException('A fonte mudou.');
  if(binding.valid_from>b.month+'-01'||binding.valid_to&&binding.valid_to<new Date(Date.UTC(Number(b.month.slice(0,4)),Number(b.month.slice(5,7)),0)).toISOString().slice(0,10))throw new BadRequestException('Competência fora da representação conferida.');
  const hash=contractHash(JSON.stringify([t.organizationId,c.authorizationId,c.eventCode,c.reportId,c.frameId,c.unitId,b.month]));
  const itemId=hash.slice(0,8)+'-'+hash.slice(8,12)+'-5'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
  const provenance=`CCEE DRI · ${c.eventCode} · relatório 114/quadro 451 · ${c.mapVersion} · SHA-256 ${c.sourceHash} · ${b.reason}`;
  const query={consumerUnitId:c.unitId,month:b.month},listed=await this.costs.list(query,t),latest=listed.rows[0],old=latest?.costs?.items??[];
  const duplicate=old.find((i:any)=>i.id===itemId);
  if(duplicate){if(duplicate.amount===c.amount&&duplicate.effect===b.effect&&duplicate.source===provenance)return{organizationId:t.organizationId,cost:latest,reused:true};throw new ConflictException('O mesmo fato contábil já foi alocado; concilie a revisão existente.');}
  if(old.some((i:any)=>i.category==='CCEE'&&/MCP|MERCADO DE CURTO PRAZO/i.test(i.label)))throw new ConflictException('Já existe liquidação MCP nesta competência. Confira a correspondência antes de importar para evitar duplicidade.');
  const costs={noCosts:false,items:[...old,{id:itemId,label:'CCEE · liquidação MCP · evento '+c.eventCode,category:'CCEE',scenario:'ACL',effect:b.effect,amount:c.amount,source:provenance,taxTreatment:'INCLUDED'}]};
  const body:any={...query,costs,sourceReference:provenance,notes:'Fonte CCEE com alocação confirmada pelo operador. Demais custos preservados. Não comprova quitação nem cobertura de todos os encargos.',correctionReason:b.reason,...(latest?.status!=='DRAFT'&&latest?{previousId:latest.id}:{})};
  const saved=latest?.status==='DRAFT'?await this.costs.update(latest.id,{...body,previousId:latest.previous_id??null,revision:latest.revision},t):await this.costs.create(body,t);
  return{organizationId:t.organizationId,cost:saved,reused:false,notice:'Custo preparado em rascunho para a EVA. Nenhum fechamento aprovado foi substituído.'};
 }
}
@Controller('ccee-data/dri/costs')
export class CceeDriCostController{
 constructor(private service:CceeDriCostService){}
 @Get(':id') candidate(@Tenant()t:TenantContext,@Param('id')id:string){return this.service.candidate(t,id);}
 @Post(':id') prepare(@Tenant()t:TenantContext,@Param('id')id:string,@Body()b:unknown){return this.service.prepare(t,id,b);}
}
