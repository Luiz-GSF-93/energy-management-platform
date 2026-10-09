/** Recipient-safe aggregate diagnostics. Never forward premises, source references or coordinates. */
export function climateCycleSummary(assessment:any){
 if(assessment?.version!=='climate-cycle/2.0')return undefined;
 const c=assessment.comparison;
 return {version:assessment.version,applied:assessment.applied===true,reason:assessment.reason,
  sensitivity:assessment.context?.sensitivity,readingAlignment:assessment.context?.readingAlignment,
  ...(c?{climateMaeKwh:c.climateMaeKwh,baselineMaeKwh:c.bestBaselineMaeKwh,baselineMethod:c.baselineMethod,
   improvementPercent:c.improvementPercent,winningOrigins:c.winningOrigins,originCount:c.originCount,
   predictions:c.predictions,byHorizon:c.byHorizon.map((h:any)=>({horizon:h.horizon,climateMaeKwh:h.climateMaeKwh,baselineMaeKwh:h.baselineMaeKwh,predictions:h.predictions}))}:{}),
 };
}
