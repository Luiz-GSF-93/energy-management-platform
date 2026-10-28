import {portalInvoiceKind,assertPortalInvoiceUpload} from './portal-invoice-kind';
jest.mock('../ocr/eva-pdf-text.extractor',()=>({extractPdfText:jest.fn()}));
import {extractPdfText} from '../ocr/eva-pdf-text.extractor';
describe('Portal distributor invoice content gate',()=>{
 it.each(['DANFE Nota Fiscal Eletrônica MWh Energia','CONTRATO CONTRATANTE CLÁUSULA preço'])('rejects the wrong document, regardless of filename: %s',text=>expect(portalInvoiceKind(text)).toBe('WRONG_DOCUMENT'));
 it('accepts an energy NF3e distributor bill with consumption and installation',()=>expect(portalInvoiceKind('DANFE NF3e Energia Elétrica Instalação 123 Consumo 450 kWh Vencimento 10/04/2026')).toBe('DISTRIBUTOR'));
 it('does not promote an unknown or scanned file to a proven invoice',()=>expect(portalInvoiceKind('TENNIS COUNTRY MARÇO 2026')).toBe('NEEDS_READING'));
 it('rejects a native supplier NF before any intake or quota reservation',async()=>{jest.mocked(extractPdfText).mockResolvedValue({sections:[{text:'DANFE MWh energia'}]} as any);await expect(assertPortalInvoiceUpload({buffer:Buffer.from('pdf')},'application/pdf')).rejects.toThrow('somente fatura');});
 it('defers images to the existing authorized reading and identity check',async()=>{jest.mocked(extractPdfText).mockClear();await assertPortalInvoiceUpload({buffer:Buffer.from('image')},'image/png');expect(extractPdfText).not.toHaveBeenCalled();});
});
