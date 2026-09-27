import {Injectable,ForbiddenException,ConflictException} from '@nestjs/common';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrQueueService} from './ocr-queue.service';
import {CalculationPreparationService} from '../contracts/services/preparation.service';
/** Uses the same preparation rules as Contracts; a diagnosis never imports or approves records. */
@Injectable()
export class OcrCalculationContextService {
 constructor(private queue:OcrQueueService,private preparation:CalculationPreparationService){}
 async inspect(document:string,t:TenantContext){
  if(!t?.userId||!t.organizationId||![P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW].every(p=>t.permissions?.includes(p)))throw new ForbiddenException('A consulta exige acesso aos documentos e contratos da organização.');
  const source=await this.queue.reviewSource(t.organizationId,document),month=String(source.doc.reference_month).slice(0,7);
  const result=await this.preparation.inspect({consumerUnitId:source.doc.consumer_unit_id,month},t.organizationId);
  if(result.unit.id!==source.doc.consumer_unit_id||result.unit.customerId!==source.doc.customer_id||result.month!==month)throw new ConflictException('O vínculo da fatura mudou. Atualize a consulta.');
  const version=(v:any)=>v?{id:v.id,version:v.version,revision:v.revision}:null;
  return {documentId:document,customerId:result.unit.customerId,unitId:result.unit.id,unitName:result.unit.name,month,checkedAt:result.checkedAt,canImport:false as const,homologated:false as const,
   counts:result.counts,findings:result.findings,
   measurements:{status:result.measurements.status,draftCount:result.measurements.draftCount,validatedCount:result.measurements.validatedCount,validatedVersion:version(result.measurements.validatedVersion)},
   costs:{status:result.costs.status,draftCount:result.costs.draftCount,validatedCount:result.costs.validatedCount,validatedVersion:version(result.costs.validatedVersion)},
   message:'Situação atual dos registros da unidade e competência, consultada com as regras de Preparar apuração. Cadastro existente não comprova importação desta fatura. Esta consulta não grava nem aprova valores.'};
 }
}
