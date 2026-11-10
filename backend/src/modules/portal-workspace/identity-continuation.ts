/** Chooses an existing audited decision; never changes the printed evidence. */
export function identityContinuation(review:any,role:string):'UC'|'ADDRESS'|null{
 const d=review?.diagnostic;
 if(d?.action==='CONTINUE_JUSTIFIED')return 'UC';
 const fields=d?.fields;
 if(role!=='admin_org'||!['INVOICE_SUPPLIER','INVOICE_DISTRIBUTOR'].includes(d?.documentType)||!Array.isArray(fields)||fields.length!==4)return null;
 const field=(key:string)=>fields.find((f:any)=>f.key===key);
 const address=field('address');
 if(d.documentType==='INVOICE_DISTRIBUTOR'&&field('unit')?.status!=='MATCH')return null;
 return field('taxId')?.status==='MATCH'&&field('period')?.status==='MATCH'&&field('unit')?.status!=='MISMATCH'&&address?.status==='MISMATCH'&&address.found?.length===1&&typeof address.found[0]==='string'&&address.found[0].length>=12?'ADDRESS':null;
}

/** An accepted source-bound decision resolves identity confidence only; amounts
 * and financial approval retain their independent checks downstream. */
export function acceptedIdentityContinuation(review:any,diagnostic:any){
 if(review?.accepted!==true||!Array.isArray(diagnostic?.fields))return false;
 const field=(key:string)=>diagnostic.fields.find((f:any)=>f.key===key);
 if(!['taxId','period'].every(key=>field(key)?.status==='MATCH'))return false;
 const unit=field('unit');
 if(review.unitCode){const compact=(v:string)=>v.replace(/[^0-9A-Z]/gi,'').toUpperCase();return field('address')?.status==='MATCH'&&['MATCH','MISMATCH'].includes(unit?.status)&&unit?.found?.some((v:string)=>compact(v)===compact(review.unitCode));}
 return !!review.address&&(unit?.status==='MATCH'||diagnostic.documentType==='INVOICE_SUPPLIER'&&unit?.status==='INCONCLUSIVE');
}
