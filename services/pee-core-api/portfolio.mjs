// Read-only projection: the approved engineering and evaluation engines remain authoritative.
import {assessProject} from './evaluation.mjs';
export function portfolioRow(data){
 const a=assessProject(data),m=a.economy,s=a.qualification.selection;
 const selected=data.simulations.some(x=>x.project_id===data.project.id&&x.selected);
 const finite=x=>Number.isFinite(x)?x:null;
 return {id:data.project.id,name:data.project.name,unit:data.unit?.name??'',distributor:data.project.distributor,
  phase:data.project.phase??'Elaboração',version:data.project.version,
  investment:selected?finite(m?.investment):null,energy_mwh:selected?finite(m?.energy_mwh):null,
  rcb:finite(m?.rcb_total??m?.rcb),score:s.configured?finite(s.estimated_points):null,
  score_reason:s.reason,qualification:a.qualification.level,readiness:a.qualification.readiness_percent,
  blockers:a.issues.length,warning:'Projeções de engenharia; não representam economia verificada ou aprovação.'};
}
export function summarizePortfolio(rows){
 const sum=k=>rows.reduce((n,p)=>n+(p[k]??0),0);
 return {projects:rows.length,investment:sum('investment'),energy_mwh:sum('energy_mwh'),
  score_at_least_70:rows.filter(p=>p.score!==null&&p.score>=70).length,
  pending_score:rows.filter(p=>p.score===null).length,
  pending_economics:rows.filter(p=>p.investment===null||p.energy_mwh===null).length};
}
