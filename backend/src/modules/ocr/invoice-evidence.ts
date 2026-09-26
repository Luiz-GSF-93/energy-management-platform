/** Provider evidence is never a validated financial entry. No float arithmetic or tax inference. */
export interface OcrEvidence { content: string; confidence: number | null; pages: number[]; spans: {offset:number;length:number}[]; }
export interface InvoiceEvidence { version: 'azure-invoice-evidence-v1'; fields: Record<string, OcrEvidence | null>; issues: string[]; pageCount: number; }
const invoiceFields = ['CustomerName','CustomerTaxId','CustomerId','ServiceAddress','InvoiceId','InvoiceDate','ServiceStartDate','ServiceEndDate','VendorName','VendorTaxId','InvoiceTotal','TotalTax'] as const;
export function extractInvoiceEvidence(result: Record<string, any>): InvoiceEvidence {
 const issues: string[] = [];
 const documents = Array.isArray(result.documents) ? result.documents : [];
 const pages = Array.isArray(result.pages) ? result.pages : [];
 if (documents.length !== 1) issues.push('INVOICE_COUNT_NOT_ONE');
 const fields = documents.length === 1 ? documents[0]?.fields ?? {} : {};
 const content = typeof result.content === 'string' ? result.content : '';
 const mapped = Object.fromEntries(invoiceFields.map(name => {
  const field = fields[name];
  if (!field || typeof field.content !== 'string' || !field.content.trim()) return [name,null];
  const spans = Array.isArray(field.spans) ? field.spans.filter((s:any) => Number.isInteger(s.offset) && s.offset >= 0 && Number.isInteger(s.length) && s.length > 0 && s.offset + s.length <= content.length).map((s:any) => ({offset:s.offset,length:s.length})) : [];
  const fieldPages:number[] = Array.isArray(field.boundingRegions) ? [...new Set<number>(field.boundingRegions.map((r:any)=>r.pageNumber).filter((p:any)=>Number.isInteger(p) && pages.some((page:any)=>page.pageNumber===p)))] : [];
  const confidence = typeof field.confidence === 'number' && Number.isFinite(field.confidence) && field.confidence >= 0 && field.confidence <= 1 ? field.confidence : null;
  if (!spans.length || !fieldPages.length) issues.push(name + ':MISSING_EVIDENCE');
  return [name,{content:field.content,confidence,pages:fieldPages,spans}];
 }));
 return {version:'azure-invoice-evidence-v1',fields:mapped,issues,pageCount:pages.length};
}
export type OcrDecision = 'REJECT_AUTOMATION' | 'REVIEW_REQUIRED' | 'ELIGIBLE_FOR_IMPORT';
export interface OcrGateInput {
 /** Critical confidence from identity + every proposed field; missing is null, never 100%. */
 confidences: (number|null)[];
 identityMatches: boolean;
 periodMatches: boolean;
 marketMatches: boolean;
 electricalRegistrationMatches: boolean;
 allPagesVerified: boolean;
 duplicate: boolean;
 existingEntry: boolean;
 electricalMappingComplete: boolean;
 reconciliationMatches: boolean;
}
export function assessOcrImport(input: OcrGateInput): {decision:OcrDecision; reasons:string[]} {
 const reasons:string[]=[];
 for (const [key,code] of [
  ['identityMatches','IDENTITY_MISMATCH'],['periodMatches','PERIOD_MISMATCH'],['marketMatches','MARKET_MISMATCH'],
  ['electricalRegistrationMatches','ELECTRICAL_REGISTRATION_MISMATCH'],['allPagesVerified','PAGES_UNVERIFIED'],
  ['electricalMappingComplete','ELECTRICAL_MAPPING_INCOMPLETE'],['reconciliationMatches','TOTALS_NOT_RECONCILED'],
 ] as const) if (input[key] !== true) reasons.push(code);
 if(input.duplicate !== false) reasons.push('DUPLICATE_OR_UNCHECKED');
 if(input.existingEntry !== false) reasons.push('EXISTING_ENTRY_OR_UNCHECKED');
 const valid = input.confidences.filter((c):c is number=>typeof c==='number'&&Number.isFinite(c)&&c>=0&&c<=1);
 if(valid.some(c=>c<0.45)) return {decision:'REJECT_AUTOMATION',reasons:[...reasons,'CONFIDENCE_BELOW_45']};
 if(!valid.length || valid.length!==input.confidences.length) reasons.push('MISSING_CONFIDENCE');
 if(valid.some(c=>c<=0.85)) reasons.push('CONFIDENCE_REQUIRES_REVIEW');
 return {decision:reasons.length?'REVIEW_REQUIRED':'ELIGIBLE_FOR_IMPORT',reasons};
}
