import {reviewDigest} from '../contracts/services/review-snapshots.service';
import {tariffProduct} from '../contracts/services/tariff-preview';
import {feeCents} from '../contracts/services/management-fee';
/** Recover only the NET TE already included in this verified immutable settlement. */
function legacyPublishedTe(prep:any){
 try{
  const preview=prep?.tariffPreview,acr=prep?.operationalComposition?.scenarios?.find((s:any)=>s.scenario==='ACR');
  if(preview?.mode!=='TARIFF_COMPONENT_PREVIEW'||!Array.isArray(preview.pending)||preview.pending.length||acr?.status!=='AVAILABLE'||!Array.isArray(acr.blockers)||acr.blockers.length)return [];
  const lines=(preview.lines??[]).filter((l:any)=>l.scenario==='ACR'&&l.component==='TE');
  if(lines.length!==2||new Set(lines.map((l:any)=>l.timeBand)).size!==2||new Set(lines.map((l:any)=>l.parameterId)).size!==2)return [];
  return lines.map((l:any)=>{
   if(!['PEAK','OFF_PEAK'].includes(l.timeBand)||!['BRL_KWH','BRL_MWH'].includes(l.measure)||l.treatment!=='NET'||l.quantityUnit!=='kWh'||!Array.isArray(l.embeddedTaxCodes)||l.embeddedTaxCodes.length||!l.parameterId||!Number.isInteger(l.revision)||l.revision<1||typeof l.source!=='string'||!l.source.trim())throw Error();
   const entries=(acr.entries??[]).filter((e:any)=>e.id===l.parameterId);
   if(entries.length!==1||entries[0].group!=='DISTRIBUTOR'||entries[0].amount!==l.amount||entries[0].revision!==l.revision||entries[0].source!==l.source||tariffProduct(l.quantity,l.rate,l.measure==='BRL_MWH').rounded!==l.amount||feeCents(l.amount)<0n)throw Error();
   return {component:'TE',band:l.timeBand,measure:l.measure,quantity:l.quantity,rate:l.rate,amount:l.amount,netAmount:l.amount};
  });
 }catch{return [];}
}
/** Private payload is consumed locally; returned object is an explicit allowlist. */
export function normalizePublishedDetail(row:any,organizationId:string){
 if(!row.legacyPayload)return row;
 const p=row.legacyPayload,unit=p.financial?.units?.find((u:any)=>u.id===row.unitId),prep=p.preparations?.[row.unitId];
 if(p.formatVersion!=='financial-settlement-1.0'||reviewDigest(p)!==row.legacyHash||p.sources?.organizationId!==organizationId||p.sources?.customerId!==row.customerId||p.sources?.month!==row.month||p.financial?.status!=='AVAILABLE'||!unit)throw Error('Historical publication integrity unavailable');
 const unitSource=p.sources?.tables?.consumer_units?.find((u:any)=>u.id===row.unitId&&u.organization_id===organizationId);
 const composition=prep?.operationalComposition?.scenarios?.find((s:any)=>s.scenario==='ACL'&&s.status==='AVAILABLE');
 const m=prep?.measurements?.validatedVersion?.measurements;
 const tariffLines=legacyPublishedTe(prep);
 return {publicationId:row.publicationId,sourceHash:row.legacyHash,publishedAt:row.publishedAt,customerId:row.customerId,month:row.month,unitId:row.unitId,name:row.name,origin:'LEGACY_PUBLISHED',unitContext:{freeMarket:unitSource?.free_market,state:unitSource?.state,tariffGroup:unitSource?.tariff_group,tariffSubgroup:unitSource?.tariff_subgroup,tariffModality:unitSource?.tariff_modality,voltage:unitSource?.voltage},invoice:composition?.distributor??null,supplier:composition?.supplier??null,financial:{acr:unit.acr,aclBeforeFees:unit.aclBeforeFees,aclAfterFees:unit.aclAfterFees,fees:unit.totalFees},fields:[...['consumptionTotal','consumptionPeak','consumptionOffPeak'].map(key=>({key,value:m?.[key]})),{key:'supplier:tax',value:prep?.contractSupplierCost?.taxTreatment??'UNKNOWN'}],publishedCostItems:(composition?.entries??[]).filter((e:any)=>['ADDITIONAL','TAX'].includes(e.group)).map((e:any)=>({id:e.id,category:e.group==='TAX'?'TAX':/\bCCEE\b/.test(String(e.label).toUpperCase())?'CCEE':'OTHER',label:e.label,amount:String(e.amount).replace(/^-/,'') ,effect:String(e.amount).startsWith('-')?'CREDIT':'COST',source:e.source})),invoiceTaxes:[],tariffLines,retained:[],cceeCosts:[],method:'LEGACY_PUBLISHED'};
}
