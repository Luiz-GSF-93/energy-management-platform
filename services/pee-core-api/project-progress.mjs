// Read-only projection of the approved engine. Requirements and scores live in evaluation.mjs.
const modules={companies:'Empresas & unidades',rules:'Regras & edital',scope:'Escopo por distribuidora',diagnosis:'Diagnóstico',economics:'Simulador RCB',mv:'Auditoria & M&V',reports:'Relatórios & projeto final',documents:'Anexos & assinaturas',workflow:'Fluxo da CPP'};
export function integratedProgress(data,assessment,{now=new Date()}={}){
 const q=assessment.qualification,checks=q.checks,open=checks.filter(c=>c.required&&!['pass','not_applicable'].includes(c.state));
 const rows=Object.entries(modules).map(([id,label])=>{
  const own=checks.filter(c=>c.target===id&&c.required&&c.state!=='not_applicable');
  const counts=Object.fromEntries(['pass','present','missing','inconclusive','fail'].map(s=>[s,own.filter(c=>c.state===s).length]));
  return {id,label,total:own.length,verified:counts.pass,filled:counts.pass+counts.present,pending_review:counts.present,missing:counts.missing+counts.inconclusive,blockers:counts.fail,verified_percent:own.length?Math.round(counts.pass/own.length*100):null,state:counts.fail?'blocked':counts.missing+counts.inconclusive?'incomplete':counts.present?'review':own.length?'checked':'not_assessed',check_ids:own.map(c=>c.id)};
 });
 const selection=q.selection;
 return {project_id:data.project.id,project_version:data.project.version,rule_id:data.rule?.id??null,rule_version:data.rule?.version??null,technical_hash:data.fingerprint??null,snapshot_hash:data.snapshot_hash??null,calculated_at:now.toISOString(),engine_version:q.engine_version,phase:data.project.phase??'Elaboração',level:q.level,readiness_percent:q.readiness_percent,verified_percent:q.verified_percent,modules:rows,
  competition:{configured:selection.configured,estimated_points:selection.estimated_points,minimum_points:selection.minimum_points??selection.known_points,maximum_points:selection.maximum_points,pending_points:selection.pending_points,reason:selection.reason,approval_probability:null},
  submission:{ready_for_review:assessment.issues.length===0,blocking_issues:[...assessment.issues],recorded_decision_document_id:data.project.decision?.document_id??null},
  next_actions:q.action_plan.map(a=>({...a,state:open.find(c=>c.id===a.check_id)?.state??'missing',responsible:a.responsible||data.project.responsibility?.project_owner_user_name||'',responsibility_source:a.responsible?'checklist':data.project.responsibility?.project_owner_user_name?'project_coordination':null})),
  warning:q.warning};
}
