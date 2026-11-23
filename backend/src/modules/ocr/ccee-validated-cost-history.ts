import {ConflictException,ServiceUnavailableException} from '@nestjs/common';
import {readDeadline} from '../../common/services/read-deadline';
/** Read-only, tenant-bound observations. Drafts are retained to prevent silently
 * falling back to an older version when the latest monthly record is unvalidated. */
export async function validatedCceeCostHistory(db:any,organizationId:string,customerId:string,unitId:string,month:string,months:string[]){
 const result=await readDeadline('ccee:validated-cost-history',async()=>await db.from('calculation_monthly_costs').select('id,organization_id,customer_id,consumer_unit_id,month,status,version,revision,costs,validated_at,validated_by').eq('organization_id',organizationId).eq('customer_id',customerId).eq('consumer_unit_id',unitId).gte('month',months[months.length-1]).lt('month',month).order('version',{ascending:false}).limit(101),10000);
 if(result.error||!Array.isArray(result.data)||result.data.length>100)throw new ServiceUnavailableException('Histórico de custos CCEE indisponível; nenhuma média parcial foi aplicada.');
 if(result.data.some((r:any)=>r.organization_id!==organizationId||r.customer_id!==customerId||r.consumer_unit_id!==unitId||!months.includes(String(r.month).slice(0,7))))throw new ConflictException('Histórico CCEE fora da unidade e competência autorizadas.');
 return result.data.map((r:any)=>({...r,month:String(r.month).slice(0,7),version_number:r.version,evidenceFormat:'VALIDATED_MONTHLY_COST'}));
}
