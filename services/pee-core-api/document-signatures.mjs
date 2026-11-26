import {ProjectError,number,text}from'./project-policy.mjs';
const fail=(message,status=422)=>{throw new ProjectError(message,status);};
export async function handleDocumentSignatures({req,res,path,c,get,put,jsonBody,send}){
 const link=path.match(/^\/api\/app\/documents\/([a-f0-9-]{36})\/signed-version$/),review=path.match(/^\/api\/app\/documents\/([a-f0-9-]{36})\/signature$/);
 if(req.method!=='POST'||!link&&!review)return false;
 if(link&&!['editor','manager'].includes(c.role)||review&&!['reviewer','manager'].includes(c.role))fail('Seu perfil não permite esta etapa de assinatura.',403);
 const original=await get(c,(link??review)[1],'document'),b=await jsonBody(req);if(original.category==='signature_evidence')fail('Selecione o documento original do projeto.');
 const signed=await get(c,b.signed_document_id??original.signed_document_id,'document'),evidence=await get(c,b.evidence_id??original.signature_evidence_id,'document');
 if(new Set([original.id,signed.id,evidence.id]).size!==3||signed.project_id!==original.project_id||evidence.project_id!==original.project_id||signed.category!=='signature_evidence'||evidence.category!=='signature_evidence'||!['application/pdf','image/png','image/jpeg'].includes(signed.mime))fail('Vincule original, versão assinada e comprovante distintos, todos do mesmo projeto.');
 if(new Set([original.sha256,signed.sha256,evidence.sha256]).size!==3)fail('O original, a versão assinada e o comprovante devem ter conteúdos distintos. Preserve o original do fabricante.');
 if(link){
  if(!['gov','notarized','icp_brasil','provider'].includes(b.channel))fail('Escolha a forma de assinatura.');
  const method=b.channel==='icp_brasil'?'provider':b.channel;
  const value={...original,signed_document_id:signed.id,signed_sha256:signed.sha256,signature_original_sha256:original.sha256,signature_evidence_id:evidence.id,signature_evidence_sha256:evidence.sha256,signature_channel:b.channel,signature_method:method,signature_review:'pending',signer_name:text(b.signer_name,'nome do signatário',200),signature_linked_by:c.subject,signature_linked_at:new Date().toISOString(),signature_validation_result:null,reviewer:null,review_note:null,reviewed_at:null};
  send(res,200,await put(c,'document',original.id,number(b.version,'versão',1),value));return true;
 }
 if(b.confirm!==true||original.signed_document_id!==signed.id||original.signature_evidence_id!==evidence.id||original.signature_original_sha256!==original.sha256||original.signed_sha256!==signed.sha256||original.signature_evidence_sha256!==evidence.sha256)fail('Atualize os vínculos e confira a correspondência entre os arquivos e seus hashes.');
 if(!['approved','rejected','indeterminate','notarized_checked'].includes(b.validation_result)||b.validation_result==='notarized_checked'&&original.signature_method!=='notarized'||b.validation_result==='approved'&&original.signature_method==='notarized')fail('Registre o resultado aplicável à conferência.');
 const verified=['approved','notarized_checked'].includes(b.validation_result),value={...original,signature_review:verified?'verified':'rejected',signature_validation_result:b.validation_result,signature_validation_source:original.signature_method==='notarized'?'Conferência do reconhecimento de firma':'VALIDAR / ITI — relatório conferido pelo responsável',reviewer:c.subject,review_note:text(b.note,'parecer da conferência',2000),reviewed_at:new Date().toISOString()};if(value.review_note.length<20)fail('Detalhe o resultado, os signatários e a referência do relatório.');
 send(res,200,await put(c,'document',original.id,number(b.version,'versão',1),value));return true;
}
