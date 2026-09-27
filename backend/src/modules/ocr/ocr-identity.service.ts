import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {OcrQueueService} from './ocr-queue.service';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {identityPreview} from './identity-preview';
@Injectable()
export class OcrIdentityService {
 constructor(private db:SupabaseService,private queue:OcrQueueService){}
 async context(org:string,id:string){
 const source=await this.queue.reviewSource(org,id),doc=source.doc,db=this.db.getClient();
 const [customer,unit,duplicates]=await Promise.all([
 db.from('customers').select('company_name,document').eq('organization_id',org).eq('id',doc.customer_id).is('deleted_at',null).maybeSingle(),
 db.from('consumer_units').select('consumer_unit_number,address,free_market').eq('organization_id',org).eq('id',doc.consumer_unit_id).eq('customer_id',doc.customer_id).maybeSingle(),
 db.from('documents').select('id').eq('organization_id',org).eq('consumer_unit_id',doc.consumer_unit_id).eq('reference_month',doc.reference_month).eq('document_type','INVOICE_DISTRIBUTOR').neq('id',doc.id).limit(1)]);
 if(customer.error||unit.error||duplicates.error||!Array.isArray(duplicates.data))throw new ServiceUnavailableException('Não foi possível consultar o cadastro atual. A conferência histórica permanece preservada.');
 return {source,registration:{customer:customer.data,unit:unit.data},preview:{...identityPreview(extractCpflPaulistaLayout(source.raw),{customer:customer.data,unit:unit.data,referenceMonth:String(doc.reference_month??'').slice(0,7),otherDocumentInPeriod:duplicates.data.length>0}),checkedAt:new Date().toISOString(),historicalCheckedAt:source.assessment.checkedAt}};
 }
 async preview(org:string,id:string){return (await this.context(org,id)).preview;}
}
