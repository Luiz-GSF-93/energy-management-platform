/** Provenance only: no financial value, identity approval or OCR confidence is
 * inferred from a fiscal format. Called after the scoped source read. */
export function invoiceReadingContext(raw:any,document:any){
 const hash=document?.file_hash;
 if(typeof document?.id!=='string'||!document.id||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))return null;
 if(raw?.xml||raw?.contentUnit==='XML_FIELDS'||document.mime_type==='application/xml'){
  const xml=raw?.xml;
  if(raw?.contentUnit!=='XML_FIELDS'||xml?.version!=='fiscal-xml-1'||xml.sourceHash!==hash||xml.model!=='66'||xml.kind!=='INVOICE_DISTRIBUTOR'||!Array.isArray(xml.rows)||xml.rows.length>2000)return null;
  const classes=[...new Set<string>(xml.rows.map((row:any)=>row.classification).filter((code:unknown):code is string=>typeof code==='string'&&/^\d{7}$/.test(code)))].sort();
  return {version:1,documentId:document.id,sourceHash:hash,method:'FISCAL_XML' as const,components:xml.rows.length,classifications:classes.length<=100?classes:[],classificationsComplete:classes.length<=100,financialApproval:false as const};
 }
 return {version:1,documentId:document.id,sourceHash:hash,method:'PRESERVED_OCR' as const,financialApproval:false as const};
}
