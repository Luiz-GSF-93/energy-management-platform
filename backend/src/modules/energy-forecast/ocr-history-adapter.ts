import { assertEvidence, decimal, monthIndex, quantity, type Evidence, type Observation, type Scope } from './consumption-forecast';
export type ApprovedHistory = Scope & { historyId?:string; admissionId?: string; evidenceId: string; reviewedBy: string; reviewedAt: string; history: { sourceDocumentId: string; rows: {month:string;consumptionKwh?:string;peakKwh?:string;offPeakKwh?:string;days:number;page:number;source:string}[] }; documents: {id:string;fileHash:string;version:number}[] };
/** Only server-authorized, reviewed snapshots. Never read unreviewed AI output as measurements. */
export function observationsFromApprovedHistories(scope: Scope, sources: ApprovedHistory[], cutoff: string): Observation[] {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 36) throw Error('APPROVED_HISTORY_REQUIRED');
  const byMonth = new Map<string,Observation>();
  for (const source of sources) {
    if (['organizationId','customerId','unitId'].some(k => source[k as keyof Scope] !== scope[k as keyof Scope])) throw Error('SOURCE_SCOPE_INVALID');
    const matches=source.documents.filter(d=>d.id===source.history.sourceDocumentId);
    if(matches.length!==1||!Array.isArray(source.history.rows)||source.history.rows.length<1||source.history.rows.length>36||(!source.historyId&&source.history.rows.length!==12))throw Error('HISTORY_DOCUMENT_INVALID');
    const doc=matches[0];
    const evidence:Evidence={...scope,id:source.evidenceId,revision:doc.version,hash:doc.fileHash,validatedBy:source.reviewedBy,validatedAt:source.reviewedAt};
    assertEvidence(scope,evidence);
    for(const row of source.history.rows){
      if(!Number.isInteger(row.days)||row.days<1||row.days>62||!row.source?.trim()||!Number.isInteger(row.page)||row.page<1)throw Error('HISTORY_ROW_EVIDENCE_INVALID');
      if(monthIndex(row.month)>monthIndex(cutoff))throw Error('HISTORY_AFTER_CUTOFF');
      const next={month:row.month,consumptionKwh:row.consumptionKwh===undefined?decimal(quantity(row.peakKwh!)+quantity(row.offPeakKwh!)):decimal(quantity(row.consumptionKwh)),billedDays:row.days,evidence};
      const previous=byMonth.get(row.month);
      if(previous&&(previous.consumptionKwh!==next.consumptionKwh||previous.billedDays!==next.billedDays))throw Error('HISTORY_CONFLICT_REVIEW_REQUIRED');
      // Exact overlaps keep one monthly value; every original source remains in the persisted input.
      if(!previous)byMonth.set(row.month,next);
    }
  }
  return [...byMonth.values()].sort((a,b)=>monthIndex(a.month)-monthIndex(b.month));
}
