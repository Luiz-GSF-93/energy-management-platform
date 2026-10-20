import {PDFDocument,StandardFonts} from 'pdf-lib';
import {invoiceIdentityText,invoiceIdentityPreflight} from './invoice-identity-preflight';
const registration={customerName:'Empresa Exemplo LTDA',taxId:'12.345.678/0001-90',unitNumber:'0012345678',address:'Rua Exemplo 123 Centro',month:'2026-04'};
const text='EMPRESA EXEMPLO LTDA CNPJ 12.345.678/0001-90\nUC: 0012345678\nRUA EXEMPLO 123 CENTRO\nReferência ABR/2026';
describe('Invoice identity before paid extraction',()=>{
 it('matches explicit unit, customer CNPJ, street number and reference',()=>expect(invoiceIdentityText(text,registration).state).toBe('MATCH'));
 it.each([['UC: 0012345678','UC: 0012345679'],['12.345.678/0001-90','22.345.678/0001-90'],['ABR/2026','MAI/2026']])('rejects an explicit mismatched identity %s',(a,b)=>expect(invoiceIdentityText(text.replace(a,b),registration).state).toBe('MISMATCH'));
 it('does not match a street without its number, a barcode UC or missing registration',()=>{
  expect(invoiceIdentityText(text.replace('123 CENTRO','124 CENTRO'),registration).state).toBe('REVIEW');
  expect(invoiceIdentityText(text.replace('UC: ','Código de barras: '),registration).checks.unit).toBe('REVIEW');
  expect(invoiceIdentityText(text,{...registration,taxId:null}).state).toBe('REVIEW');
 });
 it('extracts a digital PDF locally without an OCR or AI provider',async()=>{const p=await PDFDocument.create(),page=p.addPage(),font=await p.embedFont(StandardFonts.Helvetica);page.drawText(text,{x:40,y:700,size:10,font,lineHeight:15});const r=await invoiceIdentityPreflight(Buffer.from(await p.save()),'application/pdf',registration,'a'.repeat(64));expect(r.state).toBe('MATCH');},30000);
 it('does not call image recognition or pretend an image is verified',async()=>expect(await invoiceIdentityPreflight(Buffer.from('image'),'image/png',registration,'a'.repeat(64))).toMatchObject({state:'OCR_REQUIRED',registration,fileHash:'a'.repeat(64)}));
});
