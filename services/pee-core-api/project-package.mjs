import {createHash}from'node:crypto';
import {assessProject}from'./evaluation.mjs';
import {renderReport}from'./reports.mjs';
import {ProjectError}from'./project-policy.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
import {createProjectZip}from'./zip.mjs';
import {renderProjectPdf,renderProjectWorkbook}from'./report-documents.mjs';
export {createProjectZip}from'./zip.mjs';
export async function prepareProjectPackage(data,{download,mode='review'}={}){
 if(!['review','presentation'].includes(mode))throw new ProjectError('Escolha pacote de revisão ou de apresentação.');
 const assessment=assessProject(data);if(mode==='presentation'&&assessment.issues.length)throw new ProjectError('Resolva as pendências e conclua as revisões antes de preparar o pacote de apresentação.');
 const project=data.project,documents=data.documents.filter(d=>d.project_id===project.id).sort((a,b)=>a.id.localeCompare(b.id));
 if(documents.reduce((n,d)=>n+d.size,0)>62914560)throw new ProjectError('Os documentos do projeto excedem 60 MB. Organize conjuntos menores conforme o edital.');
 const report=Buffer.from(renderReport(data,'final')),entries=[{name:'Projeto-final-EnergyOS-PEE.html',bytes:report}],files=[];
 const pdf=await renderProjectPdf(data,'final'),workbook=renderProjectWorkbook(data);entries.push({name:'Projeto-final-EnergyOS-PEE.pdf',bytes:pdf},{name:'Memoria-e-checklist-EnergyOS-PEE.xlsx',bytes:workbook});
 for(const [i,d]of documents.entries()){
  const bytes=Buffer.from(await(await download(d.storage_key)).arrayBuffer());if(bytes.length!==d.size||sha(bytes)!==d.sha256)throw new ProjectError('A integridade de um documento não foi confirmada. Atualize o dossiê.',409);
  const name='anexos/'+String(i+1).padStart(3,'0')+'-'+d.name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,160);entries.push({name,bytes});files.push({path:name,document_id:d.id,version:d.version,original_sha256:d.sha256,mime:d.mime,size:d.size,category:d.category,simulation_id:d.simulation_id??null,signature_method:d.signature_method,signature_review:d.signature_review,signed_document_id:d.signed_document_id??null,signature_evidence_id:d.signature_evidence_id??null});
 }
 const manifest={platform:'EnergyOS – PEE',emission_reference:data.emission_reference??null,mode:mode==='presentation'?'Pacote para conferência final antes do protocolo':'Pacote de revisão com pendências',project_id:project.id,project_name:project.name,project_version:project.version,project_updated_at:project.updated_at,workspace:data.workspace,issued_by:data.actor,source_snapshot:data.snapshot_hash,technical_hash:data.fingerprint,rule_id:data.rule?.id??null,rule_version:data.rule?.version??null,engine_version:assessment.qualification.engine_version,qualification:assessment.qualification.level,issues:assessment.issues,approval_probability:null,report:{path:entries[0].name,sha256:sha(report)},exports:entries.map(e=>({path:e.name,sha256:sha(e.bytes),size:e.bytes.length})),files,notice:'O pacote preserva os arquivos originais. Conferir formulários, planilhas, assinaturas e canal oficial do edital. A geração não constitui submissão, protocolo ou aprovação da distribuidora.'};
 entries.push({name:'manifesto-de-integridade.json',bytes:Buffer.from(JSON.stringify(manifest,null,2))},{name:'LEIA-ME.txt',bytes:Buffer.from('ENERGYOS – PEE / EXPERT ENERGY\n\n'+manifest.notice+'\n\nO conjunto inclui PDF de consulta, HTML e planilha XLSX de conferência. Os formulários próprios de cada edital devem ser anexados em sua versão oficial. Nenhuma exportação constitui assinatura digital. Os documentos assinados e as evidências permanecem separados, com seus hashes no manifesto.\n')});
 const bytes=createProjectZip(entries);return{bytes,sha256:sha(bytes),manifest};
}
