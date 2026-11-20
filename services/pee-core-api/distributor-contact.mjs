import {ProjectError,text}from'./project-policy.mjs';
import {recipients}from'./communications-policy.mjs';
const fail=(s,status=422)=>{throw new ProjectError(s,status);};
function link(raw,label){if(!raw)return null;let u;try{u=new URL(raw);}catch{fail(label+' inválida.');}if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port&&u.port!=='443')fail(label+' deve usar HTTPS, sem credenciais ou fragmentos.');return u.href;}
export function evaluationContact(input,{rule,actor,role}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Informe o contato da equipe de avaliação.');
 const channel=input.channel??'email';if(!['email','portal','both'].includes(channel))fail('Escolha o canal previsto no edital.');
 const emailRequired=channel!=='portal',addresses=input.to?recipients({to:input.to,cc:input.cc,bcc:[]}):{to:[],cc:[],bcc:[]};
 if(emailRequired&&!addresses.to.length)fail('Cadastre o e-mail da equipe de avaliação indicado no edital.');if(addresses.to.length>1)fail('Informe um e-mail principal; os demais podem ficar em cópia.');
 if(!addresses.to.length&&(Array.isArray(input.cc)?input.cc.length>0:typeof input.cc==='string'&&input.cc.trim()!==''))fail('Informe um e-mail principal antes de cadastrar cópias.');
 const source_url=link(input.source_url,'Fonte oficial do contato'),portal_url=link(input.portal_url,'URL do portal de submissão'),reviewed=input.reviewed===true;
 const reference=String(input.reference??'').trim().slice(0,1000),team_name=String(input.team_name??'Equipe de avaliação da CPP').trim();
 if(reviewed){if(!['reviewer','manager'].includes(role))fail('A conferência do contato exige revisor técnico ou gestor.',403);if(!source_url||reference.length<5)fail('Registre a fonte oficial e a cláusula, seção ou página do contato.');if(channel!=='email'&&!portal_url)fail('Cadastre o endereço do portal de submissão.');if(!rule?.source_url)fail('Cadastre a fonte oficial do edital antes de conferir o contato.');}
 return {channel,team_name:text(team_name,'nome da equipe de avaliação',200),to:addresses.to[0]??null,cc:addresses.cc,source_url,reference,portal_url,reviewed,reviewed_by:reviewed?actor:null,reviewed_at:reviewed?new Date().toISOString():null};
}
export function preserveEvaluationContact(old,next){
 const contact=old?.evaluation_contact;if(!contact)return null;
 const sourceChanged=['distributor','edition','source_url','document_id','source_hash'].some(k=>(old[k]??null)!==(next[k]??null));
 return sourceChanged?{...contact,reviewed:false,reviewed_by:null,reviewed_at:null}:contact;
}
export function requireEvaluationContact(rule,{mail=false}={}){
 const c=rule?.evaluation_contact;
 if(!c||!c.reviewed||!c.reviewed_by||!c.source_url||!c.reference)fail('Cadastre e confira o canal da equipe de avaliação, por distribuidora e edital, antes de submeter o projeto.');
 if(!rule.reviewed)fail('A versão do edital precisa estar revisada antes da submissão.');
 if(['email','both'].includes(c.channel)&&!c.to)fail('O e-mail principal da banca não foi cadastrado.');
 if(['portal','both'].includes(c.channel)&&!c.portal_url)fail('O portal de submissão não foi cadastrado.');
 if(mail&&c.channel==='portal')fail('O edital cadastrado recebe projetos pelo portal. Use o portal para submeter; o e-mail pode ser usado para acompanhamento.');
 return c;
}
export function validateSubmissionMail(draft,data,assessment){
 if(draft.purpose!=='submission')return;
 const contact=requireEvaluationContact(data.rule,{mail:true});
 if(draft.to?.length!==1||draft.to[0]!==contact.to)fail('O envio final permite somente o e-mail principal da banca cadastrado e conferido para este edital.');
 if(assessment.issues.length)fail('Conclua os requisitos e as revisões do projeto antes de enviar documentação para avaliação.');
 if(!draft.document_ids?.length||!data.documents.some(d=>draft.document_ids.includes(d.id)&&d.project_id===data.project.id&&d.category!=='signature_evidence'))fail('Selecione os documentos do projeto que serão apresentados à banca.');
 for(const id of draft.document_ids){const d=data.documents.find(d=>d.id===id&&d.project_id===data.project.id);if(!d||d.category!=='signature_evidence'&&d.signature_review!=='verified')fail('Os documentos de apresentação precisam ter assinatura e evidências conferidas.');}
 return contact;
}
