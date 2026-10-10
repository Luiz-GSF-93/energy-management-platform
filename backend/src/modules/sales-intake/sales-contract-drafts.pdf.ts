import PDFDocument from 'pdfkit';
import {proposalLogo} from './sales-proposal-logo';
import {ProposalDocumentModel} from './sales-proposal-document';

export async function renderContractDraftPdf(model:ProposalDocumentModel):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:44,bufferPages:true,info:{Title:'EnergyOS - Minuta contratual interna',Author:'EnergyOS'}}),chunks:Buffer[]=[];
  doc.on('data',(chunk:Buffer)=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  const width=doc.page.width-88;
  const header=()=>{doc.image(Buffer.from(proposalLogo,'base64'),44,25,{width:170});doc.font('Helvetica-Oblique').fontSize(8).fillColor('#496079').text('Powered by Expert Energy',44,70,{width:170,align:'center'});doc.font('Helvetica-Bold').fontSize(17).fillColor('#06264B').text(model.title,44,99);doc.moveTo(44,126).lineTo(doc.page.width-44,126).strokeColor('#00BDA5').lineWidth(2).stroke();doc.y=143;};
  const room=(height:number)=>{if(doc.y+height>doc.page.height-73){doc.addPage();header();}};
  try{
   header();
   for(const section of model.sections){
    doc.font('Helvetica').fontSize(10);
    const first=section.rows[0];
    const firstHeight=first?Math.max(doc.heightOfString(first.label,{width:160}),doc.heightOfString(first.value,{width:width-182}))+18:0;
    room(50+firstHeight);doc.font('Helvetica-Bold').fontSize(12).fillColor('#0868DC').text(section.title,44,doc.y,{width});doc.y+=12;
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
