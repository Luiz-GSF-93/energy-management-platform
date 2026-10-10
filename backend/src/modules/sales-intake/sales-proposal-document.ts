import PDFDocument from 'pdfkit';
import {ServiceUnavailableException} from '@nestjs/common';
import {proposalLogo} from './sales-proposal-logo';

export type ProposalDocumentModel={id:string;receipt:string;title:string;notice:string;sections:{title:string;rows:{label:string;value:string}[]}[]};
const missing='Não registrado nesta versão';
const labels:Record<string,string>={trading_hub:'Trading Hub',energy_map:'Mapa energético',document_management:'Documentos',advanced_analytics:'Análises avançadas / OCR + IA',report_generation:'Relatórios',free_market_management:'Gestão do mercado livre',bot_energy_rag:'Bot-Energy + RAG',client_portal:'Portal do cliente',ccee_registrations:'Registros CCEE (avulso)'};
const text=(v:unknown)=>typeof v==='string'&&v.trim()?v.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,4000):missing;
const count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0?String(v):missing;
const money=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0?(Number(v)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):missing;
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v)?v.slice(0,10).split('-').reverse().join('/'):missing;
export function proposalDocumentModel(data:any):ProposalDocumentModel{
 if(!data||data.status!=='APPROVED_INTERNAL'||!data.snapshot||typeof data.snapshot!=='object'||data.snapshot.currency!=='BRL'||typeof data.id!=='string'||typeof data.receipt!=='string')throw new ServiceUnavailableException('Documento interno indisponível.');
 const s=data.snapshot,p=s.policy??{},row=(label:string,value:string)=>({label,value});
 const modules=s.modules&&typeof s.modules==='object'?Object.keys(s.modules).filter(k=>s.modules[k]===true).map(k=>labels[k]??k).join(', '):'';
 return {id:data.id,receipt:data.receipt,title:'Proposta comercial interna',notice:'Documento interno - não constitui contrato nem comprovação de pagamento.',sections:[
 {title:'Referência preservada',rows:[row('Proposta',data.id),row('Protocolo',data.receipt),row('Situação','Aprovada internamente'),row('Plano',text(s.planName)),row('Versões',`Catálogo: ${count(s.planVersion)} / Política: ${count(s.policyVersion)}`),row('Motor',text(s.engineVersion)),row('Criada em',date(data.createdAt)),row('Aprovada em',date(data.approvedAt))]},
 {title:'Composição da oferta',rows:[row('Unidades',count(s.units)),row('Usuários',count(s.users)),row('Documentos (limite total)',s.documentsLimit===null?'Ilimitado':count(s.documentsLimit)),row('Módulos selecionados',modules||missing),...(Array.isArray(s.extras)?s.extras.slice(0,20).map((x:any)=>row(text(x.label),`${money(x.cents)} - ${x.recurrence==='MONTHLY'?'mensal':x.recurrence==='ONCE'?'único':missing}`)):[])]},
 {title:'Valores em reais (BRL)',rows:[row('Periodicidade escolhida',s.cycle==='MONTHLY'?'Mensal':s.cycle==='ANNUAL'?'Anual':missing),row('Base mensal',money(s.monthlyBaseCents)),row('Recorrente mensal',money(s.monthlyRecurringCents)),row('Recorrente anual',money(s.annualRecurringCents)),row('Adicionais únicos',money(s.oneTimeCents)),row('Total inicial da periodicidade',money(s.initialTotalCents))]},
 {title:'Condições e ressalvas',rows:[row('Vigência dos preços',`${date(p.starts)} a ${date(p.ends)}`),row('Impostos e serviços incluídos',text(p.taxTerms)),row('Metodologia preservada',text(s.methodology)),...(s.solarReviewRequired===true?[row('Geração solar','Gestão GD fora do escopo. Atendimento específico sujeito a análise separada antes de oferta externa.')]:[]),row('Limites desta prévia','A vigência dos preços não define validade de oferta ou prazo contratual. Não há envio, assinatura, cobrança ou ativação de licença.')]}]};
}

export async function renderProposalPdf(model:ProposalDocumentModel):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:44,bufferPages:true,info:{Title:'EnergyOS - Proposta interna',Author:'EnergyOS'}}),chunks:Buffer[]=[];
  doc.on('data',(chunk:Buffer)=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  const width=doc.page.width-88;
  const header=()=>{doc.image(Buffer.from(proposalLogo,'base64'),44,25,{width:170});doc.font('Helvetica-Oblique').fontSize(8).fillColor('#496079').text('Powered by Expert Energy',44,70,{width:170,align:'center'});doc.font('Helvetica-Bold').fontSize(17).fillColor('#06264B').text(model.title,44,99);doc.moveTo(44,126).lineTo(doc.page.width-44,126).strokeColor('#00BDA5').lineWidth(2).stroke();doc.y=143;};
  const room=(height:number)=>{if(doc.y+height>doc.page.height-73){doc.addPage();header();}};
  try{
   header();
   for(const section of model.sections){
    room(65);doc.font('Helvetica-Bold').fontSize(12).fillColor('#0868DC').text(section.title,44,doc.y,{width});doc.y+=12;
    for(const row of section.rows){
     doc.font('Helvetica').fontSize(10);const h=Math.max(doc.heightOfString(row.label,{width:160}),doc.heightOfString(row.value,{width:width-182}))+18;
     room(h);doc.font('Helvetica').fontSize(10);const y=doc.y;doc.fillColor('#496079').text(row.label,44,y,{width:160});doc.fillColor('#06264B').text(row.value,226,y,{width:width-182});doc.moveTo(44,y+h-8).lineTo(44+width,y+h-8).strokeColor('#DCE5EC').lineWidth(.5).stroke();doc.y=y+h;
    }
    doc.y+=12;
   }
   const range=doc.bufferedPageRange();for(let i=range.start;i<range.start+range.count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(8).fillColor('#496079').text(model.notice,44,doc.page.height-52,{width,height:12,lineBreak:false});doc.text(`EnergyOS / ${i+1} de ${range.count}`,44,doc.page.height-36,{width,height:12,lineBreak:false,align:'right'});}
   doc.end();
  }catch(error){doc.destroy();reject(error);}
 });
}
