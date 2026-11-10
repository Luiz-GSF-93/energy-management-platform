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
