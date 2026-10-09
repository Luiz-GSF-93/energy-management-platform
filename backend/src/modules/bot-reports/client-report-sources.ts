import {InternalServerErrorException} from '@nestjs/common';
import {reviewDigest} from '../contracts/services/review-snapshots.service';
import {financialAnalytics} from '../contracts/services/financial-analytics';
export function clientReportAnalytics(data:any,org:string,period:{from:string;to:string},unit:string){
 const fail=()=>{throw new InternalServerErrorException('Integridade das publicações indisponível.');};
 if(!data?.customerId||!Array.isArray(data.units)||!data.units.some((u:any)=>u.id===unit)||!Array.isArray(data.groups)||data.groups.length>12)fail();
 const pubs=[];const months=new Set<string>();
 for(const group of data.groups){
  const rows=group?.rows;
  if(group?.consistent!==true)fail();
  if(!Array.isArray(rows)||!rows.length||rows.length>100)fail();const first=rows[0],b=group.payload;
  const month=String(first.month).slice(0,7);
  if(month<period.from||month>period.to||months.has(month)||b?.formatVersion!=='financial-settlement-1.0'||b.sources?.organizationId!==org||b.sources?.customerId!==data.customerId||b.sources?.month!==month||b.financial?.status!=='AVAILABLE'||!Array.isArray(b.financial.units)||b.financial.units.length!==rows.length||reviewDigest(b)!==first.financial_hash)fail();months.add(month);
  const ids=new Set<string>();
  for(const row of rows){if(row.organization_id!==org||row.customer_id!==data.customerId||row.status!=='PUBLISHED'||row.validation_status!=='VALIDATED'||!row.approved_at||!row.published_at||!row.published_by||row.financial_format!=='financial-settlement-1.0'||row.financial_group_id!==first.financial_group_id||row.version_number!==first.version_number||row.financial_hash!==first.financial_hash||row.month!==first.month||ids.has(row.consumer_unit_id)||!b.financial.units.some((u:any)=>u.id===row.consumer_unit_id))fail();ids.add(row.consumer_unit_id);}
  pubs.push({meta:{id:first.financial_group_id,customerId:data.customerId,month,version:first.version_number,payloadHash:first.financial_hash,publishedAt:first.published_at,publicationNote:''},financial:b.financial,preparations:b.preparations,customerName:'Cliente vinculado',reservations:b.reservations});
 }
 return financialAnalytics(org,period,pubs,unit);
}
