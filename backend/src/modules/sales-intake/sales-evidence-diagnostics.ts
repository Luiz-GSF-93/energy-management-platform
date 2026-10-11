export const EVIDENCE_DIAGNOSTIC_CODES=['QUERY_FAILED','CONFIG_INVALID','TIMEOUT','NETWORK_ERROR','HTTP_ERROR','RESPONSE_LIMIT','JSON_INVALID','PAYMENT_SCHEMA_INVALID','REFUNDS_ENVELOPE_INVALID','REFUNDS_NOT_OBJECT','REFUNDS_DATA_MISSING','REFUNDS_DATA_INVALID','REFUNDS_PAGE_OVERSIZED','REFUNDS_HAS_MORE_MISSING','REFUNDS_HAS_MORE_INVALID','REFUNDS_TOTAL_MISSING','REFUNDS_TOTAL_INVALID','REFUNDS_INTERMEDIATE_INCOMPLETE','REFUNDS_FINAL_TOTAL_MISMATCH','REFUND_ROW_INVALID','INVOICES_ENVELOPE_INVALID','INVOICE_ROW_INVALID','BINDING_MISMATCH','DUPLICATE_ITEMS','HISTORY_TRUNCATED','PAGINATION_CHANGED','COLLECTION_DEADLINE','SOURCE_CHANGED'] as const;
export type EvidenceDiagnosticCode=typeof EVIDENCE_DIAGNOSTIC_CODES[number];
export type EvidenceDiagnosticScope='PAYMENT'|'REFUNDS'|'INVOICES'|'RECHECK'|'COLLECTION';
export type EvidenceDiagnostic={scope:EvidenceDiagnosticScope;code:EvidenceDiagnosticCode;httpStatus?:number};
export class EvidenceQueryError extends Error {
 constructor(readonly code:EvidenceDiagnosticCode,readonly httpStatus?:number,readonly scope?:EvidenceDiagnosticScope){super('Consulta não concluída; tentativa preservada.');}
}
export function evidenceDiagnostic(error:unknown,scope:EvidenceDiagnosticScope,fallback:EvidenceDiagnosticCode='QUERY_FAILED'):EvidenceDiagnostic {
 if(!(error instanceof EvidenceQueryError)||!EVIDENCE_DIAGNOSTIC_CODES.includes(error.code))return {scope,code:fallback};
 const safeScope=error.scope&&['PAYMENT','REFUNDS','INVOICES','RECHECK','COLLECTION'].includes(error.scope)?error.scope:scope;
 return {scope:safeScope,code:error.code,...(error.code==='HTTP_ERROR'&&Number.isInteger(error.httpStatus)&&error.httpStatus!>=300&&error.httpStatus!<=599?{httpStatus:error.httpStatus}:{})};
}
export const failedEvidence=(error:unknown)=>({diagnostics:[evidenceDiagnostic(error,'COLLECTION')]});
