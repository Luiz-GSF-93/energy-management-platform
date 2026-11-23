// A checklist link names a check, not just a destination page. These descriptors
// are shared by all three checklists and never confer write permissions.
export function checkResolution(id,{project:p,rule,company,unit,simulations=[],documents=[],typologies=[],role='viewer'}={}){
 const rules=(field='source_url')=>({view:'rules',action:'edit-rule',id:rule?.id??'',field});
 const project=(field)=>({view:'reports',action:'edit-project',id:p.id,field});
 const document=(category,{simulation_id,requirement_id,document_id}={})=>{
  const found=documents.filter(d=>d.project_id===p.id&&(!document_id||d.id===document_id)&&(!category||d.category===category)&&(!simulation_id||d.simulation_id===simulation_id)&&(!requirement_id||d.requirement_id===requirement_id)).sort((a,b)=>Number(b.model_document===true)-Number(a.model_document===true))[0];
  return found?{view:'documents',action:role==='reviewer'||role==='manager'?'signature-review':'signature-link',id:found.id,field:role==='reviewer'||role==='manager'?'note':'signed_document_id',document_id:found.id,category,requirement_id,simulation_id}:{view:'documents',action:'new-document',field:'file',category:category??'other',simulation_id,requirement_id};
 };
 if(id?.startsWith('section-'))return project('section_'+id.slice(8));
 if(id?.startsWith('responsibility-'))return project('responsibility_'+id.slice(15));
 if(id?.startsWith('requirement-'))return project('req_'+id.slice(12));
 if(id?.startsWith('signature-'))return document(null,{document_id:id.slice(10)});
 if(id?.startsWith('manual-'))return document('manufacturer_manual',{simulation_id:id.slice(7)});
 if(id?.startsWith('eligible-use-')){const s=simulations.find(s=>s.id===id.slice(13));return rules(s?'use_'+s.type:'source_url');}
 if(id==='identity')return !company||!company.cnpj||unit?.company_id===company.id?{view:'companies',action:company?'edit-company':'new-company',id:company?.id??'',field:'cnpj'}:{view:'companies',action:unit?'edit-unit':'new-unit',id:unit?.id??'',field:unit?'company_id':'uc'};
 if(id==='call')return rules(role==='reviewer'||role==='manager'?'reviewed':'source_url');
 if(id==='deadline')return rules('deadline');
 if(['minimum_annual_mwh','minimum_peak_kw'].includes(id))return rules(id);
 if(id==='typology')return !p.typology?project('typology'):rules('typology_'+typologies.indexOf(p.typology));
 if(['cnpj_status','distributor_clearance','tax_clearance','labor_clearance','fgts'].includes(id))return rule?.qualification?.[id]===true?document(id):rules('qual_'+id);
 if(['consent','bills','baseline','diagram','art','budgets'].includes(id))return document(id);
 if(id==='energy'){const s=simulations.find(s=>s.project_id===p.id&&s.selected)??simulations.find(s=>s.project_id===p.id);return {view:'diagnosis',action:s?'edit-simulation':'new-simulation',id:s?.id??'',field:s?'selected':'type'};}
 if(id==='rcb')return {view:'economics',action:'edit-economics',id:p.id,field:'energy_cost'};
 if(id==='mv')return {view:'mv',action:'edit-mv',field:'baseline'};
 if(['budget','investment'].includes(id))return {view:'reports',action:'edit-resources',field:'name_0'};
 if(id==='schedule')return {view:'workflow',action:'edit-schedule',field:'name_0'};
 if(id==='concession')return {view:'companies',action:unit?'edit-unit':'new-unit',id:unit?.id??'',field:'distributor'};
 return null;
}
export function firstModuleCheck(module,checks=[]){return checks.find(c=>c.target===module&&c.required&&!['pass','not_applicable'].includes(c.state))??checks.find(c=>c.target===module);}
export function focusResolutionField(modal,field){
 const control=modal.querySelector('[name="'+CSS.escape(field??'')+'"]')??modal.querySelector('input:not([type=hidden]),textarea,select');if(!control)return false;
 for(let p=control.parentElement;p&&p!==modal;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
 control.classList.add('resolution-focus');control.setAttribute('aria-description','Campo vinculado ao requisito selecionado no checklist.');control.scrollIntoView({block:'center'});control.focus();return true;
}
