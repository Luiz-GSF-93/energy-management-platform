const fs=require('node:fs'),assert=require('node:assert/strict');
const {legalAuditPdf}=require('../dist/modules/ocr/legal-audit.pdf'),{legalHash,legalFindings,legalCoverage}=require('../dist/modules/ocr/legal-audit.model');
(async()=>{
 const sources=require('../src/modules/ocr/legal-audit.library.json').filter(s=>s.state==='PUBLISHED').map(s=>({...s,version:1,hash:legalHash(s.text),reviewedOn:'2026-11-17'}));
 const pages=[{page:1,text:'Contrato sintético de energia. Cláusula 4: cessão de créditos com notificação ao comprador. Cláusula 5: seguro garantia renovável com custo do comprador. Cláusula 6: multa por rescisão, a definir unilateralmente, e prazo de cura. Cláusula 7: preço IPCA, flexibilidade +40% e -20%, prazo de aviso e anexos integrantes. Documento exclusivamente sintético para teste.',issues:[]}];
 const job={id:'00000000-0000-4000-8000-000000000001',organization_id:'SYNTHETIC_TEST',customer_id:'synthetic-customer',unit_id:'synthetic-unit',document_id:'synthetic-original',as_of:'2026-11-17',source_hash:'a'.repeat(64),created_at:'2026-11-17T12:00:00.000Z'};
 const report={version:'legal-compliance-1.0',organizationName:'Organização contratante sintética',customerName:'Empresa sintética — sem dados de cliente',unitName:'Unidade de homologação',coverage:legalCoverage(pages,sources),findings:legalFindings(pages,sources),narratives:[{chunkId:'contract-block-1',page:1,pages:[1],answer:'O texto exige conferência de objeto da cessão, garantias, prazo de cura e critérios de rescisão. Amostra sintética: não constitui análise de um contrato real.',citations:['contract-block-1','law-codigo-civil-v1'],normativeSupported:true}],sources};
 const first=await legalAuditPdf(job,report),second=await legalAuditPdf(job,report);assert(first.equals(second),'Archive retries must reproduce the exact PDF bytes');assert(first.subarray(0,5).toString()==='%PDF-');assert(first.length<15728640);
 const output=process.env.LEGAL_AUDIT_PDF_OUTPUT||'/tmp/energy-legal-sample.pdf';fs.writeFileSync(output,first);
 console.log('Legal audit PDF passed:',first.length,'bytes; deterministic report saved to',output);
})().catch(e=>{console.error(e);process.exitCode=1});
