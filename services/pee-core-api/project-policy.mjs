import {opportunityCalculation,opportunityInputs} from './engineering.mjs';
export class ProjectError extends Error{constructor(message,status=422){super(message);this.status=status;}}
const bad=m=>{throw new ProjectError(m);};
export const text=(v,label,max=300)=>typeof v==='string'&&v.trim()&&v.length<=max?v.trim():bad('Preencha '+label);
export function number(v,label,min=0,max=1e12){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)bad('Valor inválido: '+label);return v;}
export const requiredSections={objective:'Objetivo e fronteira',baseline:'Diagnóstico e linha de base',technical:'Memorial descritivo',resources:'Recursos, quantidades e especificações',budget:'Orçamentos e fontes de financiamento',eligibility:'Enquadramento no edital',mv:'Plano de medição e verificação',schedule:'Cronograma físico-financeiro',disposal:'Descarte e destinação',risks:'Riscos e premissas',engineer:'Responsável técnico e ART',training:'Treinamento, capacitação e divulgação',experience:'Experiência, atestados e certificações da equipe',market_barriers:'Barreiras de mercado e efeito multiplicador'};
export const distributors=['CPFL Energia','Neoenergia','Energisa','Equatorial','Enel','EDP','Cemig','Light','Copel','Celesc'];
export function validateSimulation(x){
 const input=x?.inputs;if(!input||typeof input!=='object'||!opportunityInputs[x.type])bad('Selecione o uso final e as premissas.');
 const expected=opportunityInputs[x.type].map(p=>p[0]);if(Object.keys(input).some(k=>!expected.includes(k)))bad('Premissa fora do uso final selecionado.');
 for(const k of expected){if(typeof input[k]!=='number')bad('Preencha a premissa '+k);}
 const result=opportunityCalculation(x.type,input);
 return {name:text(x.name,'nome'),project_id:text(x.project_id,'projeto',36),type:x.type,boundary:text(x.boundary,'fronteira'),maker:text(x.maker,'fabricante'),model:text(x.model,'modelo'),inputs:input,result,cost:number(x.cost,'investimento',0.01),life:number(x.life,'vida útil',1,60),om:number(x.om??0,'O&M'),selected:x.selected===true};
}
export function aggregate(project,simulations){
 const chosen=simulations.filter(s=>s.selected&&s.project_id===project.id);if(!chosen.length)bad('Selecione ao menos uma medida.');
 if(new Set(chosen.map(s=>s.boundary.trim().toLocaleLowerCase('pt-BR'))).size!==chosen.length)bad('Medidas selecionadas compartilham a mesma fronteira. Revise a sobreposição.');
 const e=project.economics??{},energyCost=number(e.energy_cost,'custo evitado de energia (R$/MWh)'),demandCost=number(e.demand_cost,'custo evitado de demanda (R$/kW.ano)'),rate=number(e.discount_rate,'taxa de desconto (%)',0,100)/100;
 const crf=n=>rate===0?1/n:rate/(1-Math.pow(1+rate,-n));
 const energy=chosen.reduce((s,m)=>s+m.result.energy,0),rawDemand=chosen.reduce((s,m)=>s+m.result.demand,0),demand=chosen.length===1||e.coincidence_confirmed===true?rawDemand:0;
 const shared=number(e.shared_cost??0,'custos compartilhados'),sharedLife=number(e.shared_life??10,'vida útil dos custos compartilhados',1,60),om=chosen.reduce((s,m)=>s+m.om,0);
 const annualCost=chosen.reduce((s,m)=>s+m.cost*crf(m.life),0)+shared*crf(sharedLife)+om;
 const benefit=energy*energyCost+demand*demandCost;if(benefit<=0)bad('Benefício anual não positivo. Confira a metodologia e os custos evitados.');
 const investment=chosen.reduce((s,m)=>s+m.cost,0)+shared;
 return {energy_mwh:energy,demand_kw:demand,investment,om,annual_cost:annualCost,annual_benefit:benefit,rcb:annualCost/benefit,measures:chosen.length,warning:'Estimativa de engenharia. Confirmar custos anualizados, custos evitados, contrapartidas, vida útil e metodologia na planilha oficial do edital.',coincidence_pending:chosen.length>1&&e.coincidence_confirmed!==true};
}
export function projectIssues(project,simulations,documents,rule){
 const issues=[];if(project.demonstration?.example_only===true)issues.push('Projeto demonstrativo: documentos fictícios não habilitam submissão real. Substitua as evidências e conclua a revisão formal em um projeto real.');for(const [key,label]of Object.entries(requiredSections))if(!project.sections?.[key]?.trim())issues.push(label);
 for(const [k,label]of [['company_id','Empresa beneficiária'],['unit_id','Unidade consumidora'],['distributor','Distribuidora'],['call_name','Chamada pública'],['call_url','Fonte oficial do edital']])if(!project[k])issues.push(label);
 const chosen=simulations.filter(s=>s.selected&&s.project_id===project.id);
 if(!chosen.length)issues.push('Seleção de medidas');
 for(const s of chosen){if(!documents.some(d=>d.simulation_id===s.id&&d.category==='manufacturer_manual'))issues.push('Manual do fabricante: '+s.name);}
 const own=documents.filter(d=>d.project_id===project.id);
 for(const category of ['bills','baseline','diagram','art','budgets','mv_plan','consent'])if(!own.some(d=>d.category===category))issues.push('Anexo obrigatório: '+category);
 for(const d of own.filter(d=>d.category!=='signature_evidence'))if(!d.signature_evidence_id||!['gov','notarized','provider'].includes(d.signature_method)||d.signature_review!=='verified')issues.push('Assinatura e evidência pendentes: '+d.name);
 if(!rule?.reviewed||!rule.source_url||!rule.edition||!Array.isArray(rule.requirements)||!rule.requirements.length)issues.push('Revisão das exigências e versão do edital');
 for(const req of rule?.requirements??[])if(!project.requirement_answers?.[req.id]?.answer?.trim()||req.document_required&&!own.some(d=>d.requirement_id===req.id))issues.push('Exigência do edital: '+req.label);
 let economy=null;try{economy=aggregate(project,simulations);}catch(e){issues.push(e.message);}
 if(economy?.coincidence_pending)issues.push('Comprovação de simultaneidade da demanda na ponta');
 // The reviewed qualification evaluates PEE-only limits with reconciled resource funding.
 // Comparing the total here would wrongly reject a valid counterpart-funded proposal.
 if(economy&&rule?.rcb_basis!=='pee'&&typeof rule?.max_rcb==='number'&&economy.rcb>rule.max_rcb)issues.push('RCB acima do limite cadastrado do edital');
 return {issues:[...new Set(issues)],completeness:Math.max(0,100-Math.min(100,issues.length*5)),economy,approval_probability:null};
}
export const phases=['Elaboração','Revisão técnica','Pronto para submissão','Submetido','Em avaliação','Diligência','Aprovado','Cadastro de reserva','Reprovado','Execução','Medição e verificação','Concluído'];
export function validateTransition(project,next,analysis,decision){
 if(!phases.includes(next))bad('Etapa inválida.');
 if(['Pronto para submissão','Submetido'].includes(next)&&analysis.issues.length)bad('Resolva as pendências antes da submissão.');
 if(['Submetido','Aprovado','Cadastro de reserva','Reprovado','Concluído'].includes(next)&&(!decision?.document_id||!decision?.reference||!decision?.date))bad('Anexe a evidência oficial, referência/protocolo e data da decisão.');
 if(next==='Aprovado')number(decision.approved_amount,'valor formalmente aprovado',0.01);
 return {phase:next,previous:project.phase??'Elaboração',decision:decision??null};
}
