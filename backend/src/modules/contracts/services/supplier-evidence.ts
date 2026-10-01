export type SupplierEvidence={kind:'WITHOUT_INVOICE';reason:string;reference:string;paymentTerms:string};
const text=(s:unknown,min:number,max:number)=>typeof s==='string'&&s.trim().length>=min&&s.length<=max;
export function validSupplierEvidence(e:unknown):e is SupplierEvidence {
 if(!e||typeof e!=='object'||Array.isArray(e))return false;
 const v=e as SupplierEvidence;
 return Object.keys(e).length===4&&v.kind==='WITHOUT_INVOICE'&&text(v.reason,50,1000)&&text(v.reference,20,1000)&&text(v.paymentTerms,5,200);
}
/** Exception applies only to an audited, validated purchase with no volume or price discrepancy. */
export function supplierEvidenceException(s:any){
 const i=s.invoiceSources?.[0],v=s.costVersion;
 return !!(s.formulaVersion==='spot-supplier-1.0'&&s.invoiceSources?.length===1&&validSupplierEvidence(i?.supplierEvidence)&&i.category==='SUPPLIER_INVOICE'&&i.effect==='COST'&&i.taxTreatment==='RESERVED'&&s.taxTreatment==='RESERVED'&&s.invoiceDifference==='0.00'&&/^0[.]0+$/.test(s.volumeDifferenceMwh||'')&&v?.id&&Number.isInteger(v.revision)&&v.revision>0&&v.validatedAt&&s.taxReservation?.createdBy&&s.taxReservation?.createdAt&&text(s.taxReservation?.reason,20,2000));
}
