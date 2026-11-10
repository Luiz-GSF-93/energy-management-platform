/** Select the rules applicable to this competence, never an expired percentage
 * merely retained in the customer's immutable contractual history. */
export function activeManagementContracts(rows:any[],month:string){
 const from=month+'-01',to=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
 return rows.filter(row=>row.status==='ACTIVE'&&String(row.start_date??'').slice(0,10)<=to&&String(row.end_date??'9999-12-31').slice(0,10)>=from);
}
export function sharedClosingRequired(sources:any,month:string){
 const tables=sources?.financial?.tables??{};
 return (tables.consumer_units??[]).filter((unit:any)=>unit.status==='ACTIVE').length>1&&activeManagementContracts(tables.management_contracts??[],month).some(row=>Number(row.savings_percentage)>0);
}

/** These are document requests, not an alternative financial validation engine. */
export function closingDocumentRequests(sources:any,month:string,unitIds:string[]){
 const tables=sources?.financial?.tables??{},documents=[...(tables.documents??[]),...(sources.documentedSupplierDocuments??[])];
 return (tables.consumer_units??[]).filter((unit:any)=>unitIds.includes(unit.id)).map((unit:any)=>{
  const has=(type:string)=>documents.some(document=>document.organization_id===unit.organization_id&&document.customer_id===unit.customer_id&&document.consumer_unit_id===unit.id&&document.document_type===type&&document.file_verified===true&&String(document.reference_month).slice(0,7)===month);
  const distributor=has('INVOICE_DISTRIBUTOR'),supplier=has('INVOICE_SUPPLIER');
  return {unitId:unit.id,name:unit.name??unit.id,unitNumber:unit.consumer_unit_number??null,month,distributor,supplier,supplierRequired:unit.free_market!==false,
   requests:[...(!distributor?['Envie a fatura da distribuidora desta UC e competência, em XML ou PDF.']:[]),...(!supplier&&unit.free_market!==false?['Envie a NF do fornecedor desta unidade e competência, em XML ou PDF; preserve o CNPJ fiscal da matriz.']:[])]};
 });
}
