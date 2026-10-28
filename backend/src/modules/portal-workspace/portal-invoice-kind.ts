import {BadRequestException} from '@nestjs/common';
import {extractPdfText} from '../ocr/eva-pdf-text.extractor';

/** Content only. Filenames and upload labels never prove an invoice type. */
export function portalInvoiceKind(text:string):'DISTRIBUTOR'|'WRONG_DOCUMENT'|'NEEDS_READING'{
 const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 const consumption=/\bKWH\b/.test(t),identity=/INSTALA[ÇC][AÃ]O|INSTALACAO|UNIDADE CONSUMIDORA|CODIGO DO CLIENTE|CONTA CONTRATO/.test(t);
 if(consumption&&identity&&/VENCIMENTO|DATA.*LEITURA|ENERGIA ELETRICA/.test(t))return 'DISTRIBUTOR';
 if(/\bDANFE\b/.test(t)||/\b(?:CONTRATO|MINUTA)\b/.test(t)&&/CLAUSULA|CONTRATANTE|CONTRATADA/.test(t))return 'WRONG_DOCUMENT';
 return 'NEEDS_READING';
}
export const portalInvoiceOnlyMessage='Este envio aceita somente fatura de energia da distribuidora. O arquivo identificado é uma nota fiscal de fornecedor ou outro documento. Selecione a fatura correta; nenhuma leitura paga foi iniciada.';
export async function assertPortalInvoiceUpload(file:{buffer:Buffer},mime:string){
 if(mime!=='application/pdf')return; // Image identity is checked before final linking, after the authorized reading.
 const result=await extractPdfText(file.buffer,20000);
 if(portalInvoiceKind(result.sections.map(s=>s.text).join('\n'))==='WRONG_DOCUMENT')throw new BadRequestException(portalInvoiceOnlyMessage);
}
