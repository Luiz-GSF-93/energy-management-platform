// These are configurable calculation methods, not default ANEEL weights.
// The applicable edital must supply and justify each chosen method.
export const scoringMetrics={rcb_total:'RCB total',rcb_pee:'RCB parcela PEE',energy_mwh:'Economia anual de energia (MWh)',demand_kw:'Redução de demanda na ponta (kW)',equipment_share:'Parcela do investimento em equipamentos',counterpart_share:'Contrapartida relativa ao investimento',training_share:'Parcela de treinamento e divulgação'};
export const scoringMethods={manual:'Nota com parecer e evidência',share:'Participação direta no investimento',relative_high:'Proporção em relação ao maior valor de referência',relative_low:'Proporção inversa em relação à menor referência'};
export function projectMetrics(project,economy){
 const rows=project.resources??[],total=rows.reduce((s,r)=>s+r.total_cents,0),category=r=>String(r.category).trim().toLowerCase(),equipment=rows.filter(r=>['equipamento','equipamentos','equipment'].includes(category(r))).reduce((s,r)=>s+r.total_cents,0),education=rows.filter(r=>['treinamento','capacitação','divulgação','training','marketing'].includes(category(r))).reduce((s,r)=>s+r.total_cents,0),own=rows.reduce((s,r)=>s+r.own_cents+r.other_cents,0);
 return {rcb_total:economy?.rcb_total??economy?.rcb??null,rcb_pee:economy?.rcb_pee??null,energy_mwh:economy?.energy_mwh??null,demand_kw:economy?.demand_kw??null,equipment_share:total>0?equipment/total:null,counterpart_share:total>0?own/total:null,training_share:total>0?education/total:null};
}
export function objectiveScore(criterion,metrics,{call,typology}={}){
 const method=criterion.formula??'manual';if(method==='manual')return null;
 const value=metrics[criterion.metric];if(!Number.isFinite(value)||value<0)return {points:null,state:'pending_input',reason:'Métrica ausente ou orçamento não conciliado.'};
 let ratio;
 if(method==='share'){
  if(!['equipment_share','counterpart_share','training_share'].includes(criterion.metric)||value>1)return {points:null,state:'invalid_method',reason:'Participação direta exige uma proporção válida entre 0 e 1.'};ratio=value;
 }else{
  if(!['relative_high','relative_low'].includes(method)||!Number.isFinite(criterion.reference_value)||criterion.reference_value<=0||!criterion.reference_source||criterion.reference_call!==call||!typology||criterion.reference_typology!==typology)return {points:null,state:'pending_reference',reason:'Falta referência documentada da mesma chamada e tipologia.'};
  if(method==='relative_low'&&value===0)return {points:null,state:'pending_reference',reason:'A referência inversa com denominador zero exige metodologia específica do edital.'};
  ratio=method==='relative_high'?value/criterion.reference_value:criterion.reference_value/value;
 }
 return {points:criterion.weight*Math.min(1,Math.max(0,ratio)),state:method==='share'?'calculated':'calculated_reference_scenario',metric:criterion.metric,value,formula:method,reference:method==='share'?null:criterion.reference_value,reference_source:criterion.reference_source??null,reason:method==='share'?'Calculado a partir dos recursos e parâmetros cadastrados.':'Cenário calculado sobre referência declarada e revisada; não é classificação oficial.'};
}
