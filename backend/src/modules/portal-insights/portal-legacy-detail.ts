import {reviewDigest} from '../contracts/services/review-snapshots.service';
/** Private payload is consumed locally; returned object is an explicit allowlist. */
export function normalizePublishedDetail(row:any,organizationId:string){
 if(!row.legacyPayload)return row;
 const p=row.legacyPayload,unit=p.financial?.units?.find((u:any)=>u.id===row.unitId),prep=p.preparations?.[row.unitId];
 if(p.formatVersion!=='financial-settlement-1.0'||reviewDigest(p)!==row.legacyHash||p.sources?.organizationId!==organizationId||p.sources?.customerId!==row.customerId||p.sources?.month!==row.month||p.financial?.status!=='AVAILABLE'||!unit)throw Error('Historical publication integrity unavailable');
 const unitSource=p.sources?.tables?.consumer_units?.find((u:any)=>u.id===row.unitId&&u.organization_id===organizationId);
 const composition=prep?.operationalComposition?.scenarios?.find((s:any)=>s.scenario==='ACL'&&s.status==='AVAILABLE');
 const m=prep?.measurements?.validatedVersion?.measurements;
 return {publicationId:row.publicationId,sourceHash:row.legacyHash,publishedAt:row.publishedAt,customerId:row.customerId,month:row.month,unitId:row.unitId,name:row.name,origin:'LEGACY_PUBLISHED',unitContext:{freeMarket:unitSource?.free_market,state:unitSource?.state,tariffGroup:unitSource?.tariff_group,tariffSubgroup:unitSource?.tariff_subgroup,tariffModality:unitSource?.tariff_modality,voltage:unitSource?.voltage},invoice:composition?.distributor??null,supplier:composition?.supplier??null,financial:{acr:unit.acr,aclBeforeFees:unit.aclBeforeFees,aclAfterFees:unit.aclAfterFees,fees:unit.totalFees},fields:[...['consumptionTotal','consumptionPeak','consumptionOffPeak'].map(key=>({key,value:m?.[key]})),{key:'supplier:tax',value:prep?.contractSupplierCost?.taxTreatment??'UNKNOWN'}],publishedCostItems:(composition?.entries??[]).filter((e:any)=>['ADDITIONAL','TAX'].includes(e.group)).map((e:any)=>({id:e.id,category:e.group==='TAX'?'TAX':/\bCCEE\b/.test(String(e.label).toUpperCase())?'CCEE':'OTHER',label:e.label,amount:e.amount,effect:'COST',source:e.source})),invoiceTaxes:[],tariffLines:[],retained:[],cceeCosts:[],method:'LEGACY_PUBLISHED'};
}
