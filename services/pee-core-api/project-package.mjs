import {createHash}from'node:crypto';
import {assessProject}from'./evaluation.mjs';
import {renderReport}from'./reports.mjs';
import {ProjectError}from'./project-policy.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=data=>{let n=0xffffffff;for(const byte of data)n=crcTable[(n^byte)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
export function createProjectZip(entries){
 if(entries.length>1000)throw new ProjectError('Divida o conjunto de documentos em pacotes menores.');
 const names=new Set(),parts=[],directory=[];let offset=0;
 for(const entry of entries){
  if(typeof entry.name!=='string'||entry.name.startsWith('/')||entry.name.split('/').some(p=>!p||p==='.'||p==='..')||entry.name.includes('\\')||/[\x00-\x1f]/.test(entry.name)||names.has(entry.name))throw Error('Invalid package entry');
  names.add(entry.name);const name=Buffer.from(entry.name),bytes=Buffer.from(entry.bytes),crc=crc32(bytes),local=Buffer.alloc(30),central=Buffer.alloc(46);
  if(name.length>1000||bytes.length>65000000||offset+bytes.length>70000000)throw new ProjectError('O pacote excede 60 MB. Organize a apresentação em conjuntos menores.');
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  parts.push(local,name,bytes);directory.push(central,name);offset+=local.length+name.length+bytes.length;
 }
 const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...parts,central,end]);
}
export async function prepareProjectPackage(data,{download,mode='review'}={}){
 if(!['review','presentation'].includes(mode))throw new ProjectError('Escolha pacote de revisão ou de apresentação.');
 const assessment=assessProject(data);if(mode==='presentation'&&assessment.issues.length)throw new ProjectError('Resolva as pendências e conclua as revisões antes de preparar o pacote de apresentação.');
 const project=data.project,documents=data.documents.filter(d=>d.project_id===project.id).sort((a,b)=>a.id.localeCompare(b.id));
 if(documents.reduce((n,d)=>n+d.size,0)>62914560)throw new ProjectError('Os documentos do projeto excedem 60 MB. Organize conjuntos menores conforme o edital.');
 const report=Buffer.from(renderReport(data,'final')),entries=[{name:'Projeto-final-EnergyOS-PEE.html',bytes:report}],files=[];
 for(const [i,d]of documents.entries()){
  const bytes=Buffer.from(await(await download(d.storage_key)).arrayBuffer());if(bytes.length!==d.size||sha(bytes)!==d.sha256)throw new ProjectError('A integridade de um documento não foi confirmada. Atualize o dossiê.',409);
  const name='anexos/'+String(i+1).padStart(3,'0')+'-'+d.name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,160);entries.push({name,bytes});files.push({path:name,document_id:d.id,version:d.version,original_sha256:d.sha256,mime:d.mime,size:d.size,category:d.category,simulation_id:d.simulation_id??null,signature_method:d.signature_method,signature_review:d.signature_review,signed_document_id:d.signed_document_id??null,signature_evidence_id:d.signature_evidence_id??null});
 }
 const manifest={platform:'EnergyOS – PEE',mode:mode==='presentation'?'Pacote para conferência final antes do protocolo':'Pacote de revisão com pendências',project_id:project.id,project_name:project.name,project_version:project.version,project_updated_at:project.updated_at,workspace:data.workspace,issued_by:data.actor,source_snapshot:data.snapshot_hash,technical_hash:data.fingerprint,rule_id:data.rule?.id??null,rule_version:data.rule?.version??null,engine_version:assessment.qualification.engine_version,qualification:assessment.qualification.level,issues:assessment.issues,approval_probability:null,report:{path:entries[0].name,sha256:sha(report)},files,notice:'O pacote preserva os arquivos originais. Conferir formulários, planilhas, assinaturas e canal oficial do edital. A geração não constitui submissão, protocolo ou aprovação da distribuidora.'};
 entries.push({name:'manifesto-de-integridade.json',bytes:Buffer.from(JSON.stringify(manifest,null,2))},{name:'LEIA-ME.txt',bytes:Buffer.from('ENERGYOS – PEE / EXPERT ENERGY\n\n'+manifest.notice+'\n\nAbra o projeto final e use a opção de impressão do navegador para obter PDF. Os documentos assinados e as evidências permanecem separados, com seus hashes no manifesto.\n')});
 const bytes=createProjectZip(entries);return{bytes,sha256:sha(bytes),manifest};
}
