import PDFDocument from 'pdfkit';
export async function legalAuditPdf(job:any,report:any):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margins:{top:48,bottom:48,left:48,right:48},bufferPages:true,info:{Title:'Relatório de conformidade — EVA',Author:'EnergyOS',CreationDate:new Date(job.created_at),ModDate:new Date(job.created_at)}}),chunks:Buffer[]=[];
  doc.on('data',b=>chunks.push(b));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  const heading=(s:string)=>{if(doc.y>710)doc.addPage();doc.moveDown(.6).font('Helvetica-Bold').fontSize(13).fillColor('#12344b').text(s).moveDown(.3);};
  const text=(s:unknown)=>doc.font('Helvetica').fontSize(10).fillColor('#202c38').text(String(s??''),{lineGap:3}).moveDown(.4);
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#12344b').text('Relatório de conformidade');text('Auditoria técnico-jurídica assistida pela EVA');
  text('Situação: pendente de conferência jurídica. Não constitui declaração automática de conformidade integral.');
  text(`Organização: ${job.organization_id}\nCliente: ${report.customerName??job.customer_id}\nUnidade: ${report.unitName??job.unit_id}\nData-base: ${String(job.as_of).slice(0,10)}\nDocumento original: ${job.document_id}\nAnálise: ${job.id}\nSHA-256 do original: ${job.source_hash}\nVersão da metodologia: ${report.version}`);
  heading('Escopo e integridade');text(`Páginas recebidas: ${report.coverage.pages}. Páginas com texto: ${report.coverage.readable}. A revisão considera somente este arquivo e os trechos oficiais identificados abaixo. Assinaturas, poderes e anexos externos precisam de conferência própria.`);
  for(const issue of report.coverage.issues)text(`Página ${issue.page}: ${issue.issue}.`);
  heading('Verificações por assunto');
  for(const c of report.coverage.topics)text(`${c.label}: ${c.sourceCovered?'há trecho oficial selecionado para conferência':'cobertura normativa específica pendente'}. A presença de referência não determina sua aplicação ao caso.`);
  heading('Pontos de atenção no original');
  if(!report.findings.length)text('Não foram localizados marcadores na triagem automática. Isso não comprova ausência de risco; confira a interpretação por página e a integridade do arquivo.');
  for(const f of report.findings){heading(`${f.topic} — página ${f.page} — ${f.severity==='ALTA'?'prioridade de revisão':'atenção'}`);text('Trecho do documento: '+f.quote);text('Consideração: '+f.consideration);text('Recomendação: '+f.recommendation);text('Referências para conferir: '+(f.sourceIds.join(', ')||'sem norma específica revisada na biblioteca'));}
  heading('Leitura interpretativa por bloco');
  for(const n of report.narratives){heading(`Páginas ${(n.pages??[n.page]).join(', ')} - ${n.chunkId}`);text(n.answer);text(`Fundamentação normativa citada: ${n.normativeSupported?'identificada nos trechos fornecidos; confirmar aplicabilidade':'não demonstrada; leitura descritiva para revisão'}. Evidências: ${(n.citations??[]).join(', ')}.`);}
  heading('Fontes oficiais utilizadas e limites');
  text('A biblioteca distingue lei, norma regulatória, regra/procedimento CCEE, precedentes vinculantes e jurisprudência. Índices de pesquisa e teses isoladas não são tratados como lei. Não foi emitida conclusão automática sobre nulidade, penalidade devida ou êxito de disputa.');
  for(const s of report.sources){heading(s.title);text(`${s.authority} · ${s.kind} · versão ${s.version}\n${s.edition}\nVigência cadastrada: ${s.validFrom} a ${s.validTo??'sem término'}. Conferida em ${s.reviewedOn}.\nFonte: ${s.url}\nHash do trecho: ${s.hash}`);}
  heading('Providências recomendadas');text('Conferir as cláusulas destacadas, documentos referidos e contexto negocial; validar a vigência e aplicabilidade dos fundamentos; registrar a revisão profissional e negociar os pontos relevantes antes da assinatura. O relatório e o original foram agrupados em uma verificação documental. Perguntas posteriores não alteram este exemplar.');
  const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(range.start+i);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.font('Helvetica').fontSize(8).fillColor('#606b75').text(`EnergyOS · EVA · ${job.id} · ${i+1}/${range.count}`,48,doc.page.height-30,{lineBreak:false,width:500});doc.page.margins.bottom=bottom;}doc.end();
 });
}
