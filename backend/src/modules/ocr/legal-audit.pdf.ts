import PDFDocument from 'pdfkit';
export async function legalAuditPdf(job:any,report:any):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margins:{top:112,bottom:48,left:48,right:48},bufferPages:true,info:{Title:'Relatório técnico de conformidade contratual — EVA',Author:'EnergyOS · '+String(report.organizationName??job.organization_id),CreationDate:new Date(job.created_at),ModDate:new Date(job.created_at)}}),chunks:Buffer[]=[];
  doc.on('data',b=>chunks.push(b));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  const heading=(s:string)=>{if(doc.y>710)doc.addPage();doc.moveDown(.6).font('Helvetica-Bold').fontSize(13).fillColor('#12344b').text(s).moveDown(.3);};
  const text=(s:unknown)=>doc.font('Helvetica').fontSize(10).fillColor('#202c38').text(String(s??''),{lineGap:3}).moveDown(.4);
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#12344b').text('Relatório de conformidade');text('Auditoria técnico-jurídica assistida pela EVA');
  text('Situação: pendente de conferência jurídica. Não constitui declaração automática de conformidade integral.');
  text(`Organização contratante: ${report.organizationName??job.organization_id}\nCliente: ${report.customerName??job.customer_id}\nUnidade: ${report.unitName??job.unit_id}\nData-base: ${String(job.as_of).slice(0,10)}\nDocumento original: ${job.document_id}\nAnálise: ${job.id}\nSHA-256 do original: ${job.source_hash}\nVersão da metodologia: ${report.version}`);
  heading('Síntese executiva');
  text(`${report.findings.length} itens destacados para conferência, sendo ${report.findings.filter((f:any)=>f.severity==='ALTA').length} com prioridade de revisão. ${report.coverage.topics.filter((c:any)=>!c.sourceCovered).length} assuntos permanecem sem cobertura normativa específica demonstrada. A prioridade é uma classificação de triagem, não prova de infração, nulidade ou penalidade devida.`);
  text('Este documento apresenta avaliação técnica assistida: evidência contratual, consideração, fundamento disponível e providência recomendada. A validação cabe ao responsável técnico/jurídico autorizado da organização; não é um laudo judicial assinado por perito.');
  heading('Escopo e integridade');text(`Páginas recebidas: ${report.coverage.pages}. Páginas com texto: ${report.coverage.readable}. A revisão considera somente este arquivo e os trechos oficiais identificados abaixo. Assinaturas, poderes e anexos externos precisam de conferência própria.`);
  for(const issue of report.coverage.issues)text(`Página ${issue.page}: ${issue.issue}.`);
  heading('Verificações por assunto');
  for(const c of report.coverage.topics)text(`${c.label}: ${c.sourceCovered?'há trecho oficial selecionado para conferência':'cobertura normativa específica pendente'}. A presença de referência não determina sua aplicação ao caso.`);
  heading('Pontos de atenção no original');
  if(!report.findings.length)text('Não foram localizados marcadores na triagem automática. Isso não comprova ausência de risco; confira a interpretação por página e a integridade do arquivo.');
  for(const f of report.findings){heading(`${report.coverage.topics.find((c:any)=>c.topic===f.topic)?.label??'Ponto de atenção'} — página ${f.page} — ${f.severity==='ALTA'?'prioridade de revisão':'atenção'}`);text('Trecho do documento: '+f.quote);text('Consideração: '+f.consideration);text('Recomendação: '+f.recommendation);text('Referências para conferir: '+(f.sourceIds.join(', ')||'sem norma específica revisada na biblioteca'));}
  heading('Leitura interpretativa por bloco');
  for(const n of report.narratives){heading(`Páginas ${(n.pages??[n.page]).join(', ')} - ${n.chunkId}`);text(n.answer);text(`Fundamentação normativa citada: ${n.normativeSupported?'identificada nos trechos fornecidos; confirmar aplicabilidade':'não demonstrada; leitura descritiva para revisão'}. Evidências: ${(n.citations??[]).join(', ')}.`);}
  heading('Fontes oficiais utilizadas e limites');
  text('A biblioteca distingue lei, norma regulatória, regra/procedimento CCEE, precedentes vinculantes e jurisprudência. Índices de pesquisa e teses isoladas não são tratados como lei. Não foi emitida conclusão automática sobre nulidade, penalidade devida ou êxito de disputa.');
  for(const s of report.sources){heading(s.title);text(`${s.authority} · ${s.kind} · versão ${s.version}\n${s.edition}\nVigência cadastrada: ${s.validFrom} a ${s.validTo??'sem término'}. Conferida em ${s.reviewedOn}.\nFonte: ${s.url}\nHash do trecho: ${s.hash}`);}
  if(report.fileReferences?.length){heading('Arquivos oficiais consultados por página');text('A extração nativa foi consultada como contexto. A preservação do arquivo não certifica vigência, consolidação ou aplicação ao caso; a revisão normativa independente permanece identificada.');for(const f of report.fileReferences){heading(f.title+' · PDF página '+f.page);text(`${f.edition} · ${f.cited?'citado pela EVA':'fornecido à interpretação'}\nFonte: ${f.url}\nArquivo: ${f.documentId} · captura: ${f.capturedAt}\nSHA-256: ${f.fileHash}\nEstado: contexto preservado; revisão normativa pendente.`);}}
  heading('Providências recomendadas');text('Conferir as cláusulas destacadas, documentos referidos e contexto negocial; validar a vigência e aplicabilidade dos fundamentos; registrar a revisão profissional e negociar os pontos relevantes antes da assinatura. O relatório e o original foram agrupados em uma verificação documental. Perguntas posteriores não alteram este exemplar.');
  const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(range.start+i);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;
   doc.save().rect(0,0,doc.page.width,70).fill('#0b243a');
   doc.font('Helvetica-Bold').fontSize(23).fillColor('#ffffff').text('Energy',48,19,{continued:true,lineBreak:false}).fillColor('#00c7d7').text('OS',{lineBreak:false});
   doc.font('Helvetica').fontSize(8).fillColor('#b9dbe7').text('EVA · CONFORMIDADE CONTRATUAL',48,47,{width:240,lineBreak:false});
   doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff').text(String(report.organizationName??job.organization_id),300,23,{width:247,height:28,align:'right',ellipsis:true});doc.restore();
   doc.font('Helvetica').fontSize(8).fillColor('#345062').text('Cliente: '+String(report.customerName??job.customer_id),48,82,{width:248,height:15,ellipsis:true}).text('Unidade: '+String(report.unitName??job.unit_id),306,82,{width:241,height:15,ellipsis:true});
   doc.moveTo(48,101).lineTo(547,101).lineWidth(.5).strokeColor('#c9d8e2').stroke();
   doc.font('Helvetica').fontSize(8).fillColor('#606b75').text(`EnergyOS · EVA · ${job.id} · ${i+1}/${range.count}`,48,doc.page.height-30,{lineBreak:false,width:500});doc.page.margins.bottom=bottom;}doc.end();
 });
}
