/** Pure scope checks, shared by orchestration and its regression tests. */
export function operationalBindingState(b:any,discovery:any,run:any,unit:any){
 const from=run.month+'-01',end=new Date(Date.UTC(Number(run.month.slice(0,4)),Number(run.month.slice(5)),0)).toISOString().slice(0,10);
 if(b&&b.organization_id===run.organization_id&&b.customer_id===run.customer_id&&b.consumer_unit_id===run.consumer_unit_id&&b.status==='APPROVED'&&/^\d{4}-\d{2}-\d{2}$/.test(b.valid_from??'')&&b.valid_from<=from&&(!b.valid_to||b.valid_to>=end))return{state:'AUTHORIZED',bindingId:b.id,revision:b.revision,scopes:b.service_scope};
 const participant=discovery?.result?.participant;
 const outside=participant?.validFrom&&participant.validFrom>from||participant?.validTo&&participant.validTo<end;
 return{state:outside?'PERIOD_NOT_COVERED':discovery?.state??'REGISTRATION_PENDING',bindingId:null,reason:outside?'O participante cadastral recebido não cobre toda esta competência. Use a fonte documental e confira a representação histórica.':discovery?.reason??'Representação privada não comprovada.',candidate:{customerId:run.customer_id,unitId:unit.id,taxId:discovery?.taxId??null,participant:participant??null,evidence:{discoveryId:discovery?.id??null,hashes:discovery?.result?.hashes??[],transactions:discovery?.result?.transactions??[]},requiresIndependentReview:true},financialDocumentFlowAllowed:true};
}
export function operationalReviewReceipt(row:any,run:any,document:any){
 const u=row?.report?.units?.find((v:any)=>v.id===run.consumer_unit_id);
 return !!row&&row.organization_id===run.organization_id&&row.customer_id===run.customer_id&&row.month===run.month&&row.consumer_unit_id===run.consumer_unit_id&&row.report?.scope?.kind==='UNIT'&&row.report?.unitIds?.length===1&&row.report.unitIds[0]===run.consumer_unit_id&&['READY_FOR_REVIEW','INCOMPLETE','APPROVED'].includes(row.state)&&u?.documentId===document?.id&&u?.sourceHash===document?.fileHash;
}
/** Partial API coverage must stay provisional until the exact cost revision is checked. */
export function applyOperationalCceeReview(report:any,sources:any){
 if(sources.operationalFlow?.enabled!==true||report.scope?.kind!=='UNIT')return;
 for(const unit of report.units??[]){
  const rows=(sources.financial?.tables?.calculation_monthly_costs??[]).filter((r:any)=>r.consumer_unit_id===unit.id&&r.month===report.month).sort((a:any,b:any)=>b.version-a.version),cost=rows[0];
  const autoItems=cost?.costs?.items?.filter((i:any)=>i.category==='CCEE'&&String(i.source??'').includes('Política auditada de alocação automática:'))??[];if(!autoItems.length)continue;
  const staleApi=(unit.sources?.cceeLocal?.candidates??[]).some((candidate:any)=>autoItems.some((item:any)=>item.source.includes(candidate.eventCode)&&item.source.includes(candidate.mapVersion)&&!item.source.includes(candidate.sourceHash)));
  const ack=sources.operationalFlow.costAcks?.find((r:any)=>r.unitId===unit.id)?.ack;
  const current=sources.operationalFlow.costRows?.find((r:any)=>r.unitId===unit.id&&r.id===cost.id);
  if(!staleApi&&ack?.costId===cost.id&&(ack?.revision===cost.revision||/^[a-f0-9]{64}$/.test(ack?.costHash??'')&&ack.costHash===current?.costHash))continue;
  const message='CCEE: confira a cobertura integral dos encargos desta competência; as rubricas importadas não comprovam custos ausentes, ERCAP ou cotas nucleares.';
  if(!unit.missing.includes(message))unit.missing.push(message);
  if(!report.missing.includes(unit.name+': '+message))report.missing.push(unit.name+': '+message);
  if(!report.pendingActions.some((p:any)=>p.unitId===unit.id&&p.code==='CCEE_COVERAGE'))report.pendingActions.push({code:'CCEE_COVERAGE',unitId:unit.id,section:'costs',message});
  if(report.financial.status==='AVAILABLE')report.proposalFinancial={...report.financial,status:'ESTIMATED_REVIEW_REQUIRED',reviewRequired:true};
  report.financial=Object.fromEntries(Object.keys(report.financial).map(k=>[k,k==='status'?'INCOMPLETE':null]));
  report.approvalEligible=false;report.completeness='INCOMPLETE';
 }
}
