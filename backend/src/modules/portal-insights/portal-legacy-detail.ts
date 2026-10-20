import {reviewDigest} from '../contracts/services/review-snapshots.service';
/** Private payload is consumed locally; returned object is an explicit allowlist. */
export function normalizePublishedDetail(row:any,organizationId:string){
 if(!row.legacyPayload)return row;
 const p=row.legacyPayload,unit=p.financial?.units?.find((u:any)=>u.id===row.unitId),prep=p.preparations?.[row.unitId];
 if(p.formatVersion!=='financial-settlement-1.0'||reviewDigest(p)!==row.legacyHash||p.sources?.organizationId!==organizationId||p.sources?.customerId!==row.customerId||p.sources?.month!==row.month||p.financial?.status!=='AVAILABLE'||!unit)throw Error('Historical publication integrity unavailable');
 const composition=prep?.operationalComposition?.scenarios?.find((s:any)=>s.scenario==='ACL'&&s.status==='AVAILABLE');
 const m=prep?.measurements?.validatedVersion?.measurements;
 return {publicationId:row.publicationId,sourceHash:row.legacyHash,publishedAt:row.publishedAt,customerId:row.customerId,month:row.month,unitId:row.unitId,name:row.name,origin:'LEGACY_PUBLISHED',invoice:composition?.distributor??null,supplier:composition?.supplier??null,financial:{acr:unit.acr,aclBeforeFees:unit.aclBeforeFees,aclAfterFees:unit.aclAfterFees,fees:unit.totalFees},fields:[...['consumptionTotal','consumptionPeak','consumptionOffPeak'].map(key=>({key,value:m?.[key]})),{key:'supplier:tax',value:prep?.contractSupplierCost?.taxTreatment??'UNKNOWN'}],invoiceTaxes:[],tariffLines:[],retained:[],cceeCosts:[],method:'LEGACY_PUBLISHED'};
}
