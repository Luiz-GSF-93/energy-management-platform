import {createHash}from'node:crypto';
import {ProjectError}from'./project-policy.mjs';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export function documentControl(data){
 const snapshot=data.snapshot_hash??createHash('sha256').update(JSON.stringify(canonical({project:data.project,simulations:data.simulations,documents:data.documents,rule:data.rule,company:data.company,unit:data.unit}))).digest('hex');
 return{reference:'PEE-'+(data.emission_reference??data.project.id),template_version:'EE-PEE-REPORT-3.0',version:data.project.version,snapshot_sha256:snapshot,
  emission_reference:data.emission_reference??null,label:'PEE-'+(data.emission_reference??data.project.id)+' · v'+data.project.version+' · modelo 3.0'};
}
export function isProtectedDocument(doc,documents=[]){return doc.category==='signature_evidence'||doc.signature_review==='verified'||documents.some(d=>d.signed_document_id===doc.id||d.signature_evidence_id===doc.id);}
export function requireDocumentExport(doc,documents,role){
 if(!['editor','manager'].includes(role))throw new ProjectError('Seu perfil não permite exportar documentos. Consulte a conferência e os metadados na plataforma.',403);
 if(isProtectedDocument(doc,documents))throw new ProjectError('Arquivo assinado ou validado protegido. O envio deve ocorrer pelo fluxo autorizado à distribuidora.',403);
}
export const economicFormulae=[
 ['Benefício anual','BA = EE × CEE + RDP × CED','EE em MWh/ano; CEE em R$/MWh; RDP em kW coincidentes comprovados; CED em R$/kW.ano. Sem comprovação da coincidência, a demanda não é consolidada.'],
 ['Fator de recuperação de capital','FRC = i × (1+i)^n / ((1+i)^n − 1); para i = 0, FRC = 1/n','i é a taxa anual de desconto em fração; n é a vida útil em anos.'],
 ['Custo anualizado total','CA = Σ(Investimento_j × FRC_j + O&M_j) + custo compartilhado × FRC compartilhado','Custos de cada medida, vidas úteis e manutenção devem ser conciliados com o orçamento e o edital.'],
 ['RCB total','RCB total = CA total / BA','Resultado não apurado quando o benefício anual não é positivo.'],
 ['RCB da parcela PEE','RCB PEE = CA da parcela PEE / BA','Somente após discriminar a parcela PEE e os respectivos custos de operação e manutenção no orçamento.'],
 ['Consolidação das medidas','EE total = Σ EE das medidas selecionadas','Manter fronteiras distintas, sem dupla contagem. BESS considera perdas: deslocamento de carga não é economia líquida automática.']
];
