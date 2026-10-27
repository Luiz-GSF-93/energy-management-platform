import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {inspectDocument,inspectDocumentUpload,MAX_DOCUMENT_BYTES,DocumentFile} from './document-file';
import {AzureInvoiceConnector} from '../../ocr/azure-invoice.connector';
const footer=Buffer.from('\r\n'+" ".repeat(300)+'<!DOCTYPE html><html><head><title>CPFL Empresas</title></head><body>'+"x".repeat(1200)+'</body></html>');
const file=(buffer:Buffer,mimetype='application/pdf'):DocumentFile=>({buffer,size:buffer.length,originalname:'26_02_tennis.pdf',mimetype});
async function pdf(pages=1){const d=await PDFDocument.create();for(let i=0;i<pages;i++)d.addPage();return Buffer.from(await d.save({useObjectStreams:false,addDefaultPage:false}));}
describe('PDF admission with bounded distributor download footer',()=>{
 it('accepts a real four-page PDF footer without changing a source byte, size or hash',async()=>{
  const f=file(Buffer.concat([await pdf(4),footer])),before=Buffer.from(f.buffer),hash=createHash('sha256').update(before).digest('hex');
  expect(()=>inspectDocument(f)).toThrow('Formato inválido');
  expect(await inspectDocumentUpload(f)).toEqual({mime:'application/pdf',extension:'pdf',name:f.originalname});
  expect(f.buffer.equals(before)).toBe(true);expect(f.size).toBe(before.length);expect(createHash('sha256').update(f.buffer).digest('hex')).toBe(hash);
 });
 it('preserves ordinary PDF and JPEG validation',async()=>{
  const f=file(await pdf());expect(await inspectDocumentUpload(f)).toEqual(inspectDocument(f));
  const jpeg=file(Buffer.from([255,216,255,217]),'image/jpeg');expect((await inspectDocumentUpload(jpeg)).mime).toBe('image/jpeg');
 });
 it('rejects HTML renamed PDF, absent EOF, fake EOF and invalid xref',async()=>{
  const good=await pdf();for(const bytes of [Buffer.concat([Buffer.from('<html>not PDF</html>'),footer]),Buffer.concat([good.subarray(0,good.lastIndexOf(Buffer.from('%%EOF'))),footer]),Buffer.concat([good,Buffer.from('startxref\n0\n%%EOF'),footer]),Buffer.concat([Buffer.from('%PDF-1.4\nxref\ntrailer\n<<>>\nstartxref\n9\n%%EOF'),footer])])await expect(inspectDocumentUpload(file(bytes))).rejects.toBeDefined();
 });
 it('rejects structurally empty PDFs and mismatched MIME',async()=>{
  await expect(inspectDocumentUpload(file(Buffer.concat([await pdf(0),footer])))).rejects.toThrow('PDF ilegível');
  await expect(inspectDocumentUpload(file(Buffer.concat([await pdf(),footer]),'image/png'))).rejects.toBeDefined();
 });
 it('bounds footer search and checks 15 MiB against the entire original upload',async()=>{
  const b=await pdf();await expect(inspectDocumentUpload(file(Buffer.concat([b,Buffer.alloc(64*1024+1,32)])))).rejects.toBeDefined();
  const tooLarge=Buffer.alloc(MAX_DOCUMENT_BYTES+1,32);b.copy(tooLarge);await expect(inspectDocumentUpload(file(tooLarge))).rejects.toThrow('15 MB');
 });
 it('revalidates at OCR submission and submits the original exactly once',async()=>{
  const f=file(Buffer.concat([await pdf(4),footer])),hash=createHash('sha256').update(f.buffer).digest('hex');
  const endpoint='https://synthetic.cognitiveservices.azure.com',operation=endpoint+'/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/synthetic?api-version=2024-11-30';
  const transport=jest.fn(async(..._args:any[])=>new Response(null,{status:202,headers:{'operation-location':operation}}));const c=new AzureInvoiceConnector({enabled:true,endpoint,key:'test-only'},transport as any);
  await expect(c.submit(f,hash)).resolves.toMatchObject({url:operation});expect(transport).toHaveBeenCalledTimes(1);expect(JSON.parse(transport.mock.calls[0][1].body).base64Source).toBe(f.buffer.toString('base64'));
 });
 it('never calls OCR for a corrupt footer PDF',async()=>{
  const f=file(Buffer.concat([Buffer.from('%PDF-1.4\nxref\ntrailer\n<<>>\nstartxref\n9\n%%EOF'),footer]));const transport=jest.fn();const c=new AzureInvoiceConnector({enabled:true,endpoint:'https://synthetic.cognitiveservices.azure.com',key:'test-only'},transport as any);
  await expect(c.submit(f,createHash('sha256').update(f.buffer).digest('hex'))).rejects.toMatchObject({code:'INVALID_DOCUMENT'});expect(transport).not.toHaveBeenCalled();
 });
});
