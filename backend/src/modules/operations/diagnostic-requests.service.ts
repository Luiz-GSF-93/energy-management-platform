import {createHash} from 'node:crypto';
import {BadRequestException,ConflictException,ForbiddenException,Injectable} from '@nestjs/common';
import {IsIn,IsISO8601,IsString,IsUUID,Length,Matches} from 'class-validator';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {validateWriteDto} from '../../common/validation/validate-write-dto';
import {OcrAssistantService} from '../ocr/ocr-assistant.service';
import {OperationsService} from './operations.service';

export class DiagnosticRequestDto {
 @IsUUID() requestId!:string;
 @IsString() @Matches(/^[a-f0-9]{64}$/) token!:string;
 @IsString() @Matches(/^[a-f0-9]{64}$/) findingKey!:string;
 @IsString() @Length(1,100) responsibleId!:string;
 @IsISO8601({strict:true}) dueAt!:string;
 @IsIn(['LOW','NORMAL','HIGH','URGENT']) priority!:string;
 @IsString() @Length(3,500) reason!:string;
}
type Finding={code:string;section:string;severity:string;message:string};
export function findingKey(f:Finding){return createHash('sha256').update(JSON.stringify([f.code,f.section,f.severity,f.message])).digest('hex');}
const areas:Record<string,string>={'Medições':'monthly','Custos mensais':'costs','Unidade':'distributor','Parâmetros':'parameters','Tributos':'parameters','Bases tributárias':'parameters','Bases operacionais':'parameters','Fornecedor':'supply','Preços':'supply','Volumes':'supply','Honorários':'management','Custos adicionais':'services'};
@Injectable()
export class DiagnosticRequestsService {
 constructor(private operations:OperationsService,private assistant:OcrAssistantService){}
 private allowed(t:TenantContext,write=false){
  if(!t?.organizationId||!t.userId||(t.scope as string)==='global'||(!['admin_org','gestor','operacional'].includes(t.role)&&t.accessMode!=='platform_operation')||![P.OPERACAO_REQUESTS_VIEW,P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,...(write?[P.OPERACAO_REQUESTS_MANAGE]:[])].every(p=>t.permissions?.includes(p)))throw new ForbiddenException('Vincular diagnóstico exige acesso backoffice a solicitações, documentos e contratos da organização ativa.');
 }
 async inspect(document:string,t:TenantContext){
  this.allowed(t);
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(document))throw new BadRequestException('Documento inválido.');
  const plan=await this.assistant.inspect(document,t);
  if(plan.documentId!==document)throw new ConflictException('O vínculo da fatura mudou. Atualize o diagnóstico.');
  const result=await this.operations.list('requests',t,{customerId:plan.customerId});
  return {documentId:plan.documentId,customerId:plan.customerId,unitId:plan.unitId,unitName:plan.unitName,month:plan.month,token:plan.token,checkedAt:plan.checkedAt,
   findings:plan.findings.filter(f=>['BLOCKER','REVIEW'].includes(f.severity)).map(f=>({...f,key:findingKey(f),href:'/backoffice/contracts?ocrDocument='+encodeURIComponent(document)+'&area='+(areas[f.section]??'preparation')})),
   requests:result.rows.filter((r:any)=>r.document_id===document),
   canManage:t.permissions.includes(P.OPERACAO_REQUESTS_MANAGE),message:'Diagnóstico atual consultado. Criar ou concluir uma solicitação não corrige a origem nem aprova a apuração.'};
 }
 async create(document:string,input:DiagnosticRequestDto,t:TenantContext){
  this.allowed(t,true);const d=await validateWriteDto(DiagnosticRequestDto,input);
  const plan=await this.inspect(document,t);
  if(plan.token!==d.token)throw new ConflictException('O diagnóstico mudou. Atualize as pendências antes de salvar.');
  const finding=plan.findings.find(f=>f.key===d.findingKey);
  if(!finding)throw new ConflictException('A pendência não está no diagnóstico atual. Nenhuma solicitação foi criada.');
  // The source text is generated server-side and preserved in the existing immutable history.
  return this.operations.save('requests',null,{requestId:d.requestId,revision:0,title:('Revisar '+finding.section+' · '+plan.unitName+' · '+plan.month).slice(0,160),
   description:`[OCR diagnóstico ${finding.key}]\n${finding.severity==='BLOCKER'?'Bloqueio':'Revisão'} · ${finding.section}\n${finding.message}\n\nUnidade: ${plan.unitName}\nCompetência: ${plan.month}\nDocumento: ${document}\nVersão das fontes: ${plan.token}\n\nO estado da solicitação é operacional. Consulte novamente o diagnóstico para verificar a correção; aprovação financeira exclusiva do gestor/administrador.`,
   priority:d.priority,responsibleId:d.responsibleId,dueAt:d.dueAt,reason:d.reason,customerId:plan.customerId,unitId:plan.unitId,documentId:document,requestType:'VALIDATION'},t);
 }
}
