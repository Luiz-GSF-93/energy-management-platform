import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {inflateRawSync} from 'node:zlib';
export const DOCUMENT_BUCKET = 'energy-documents-private';
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export interface DocumentFile { buffer: Buffer; originalname: string; mimetype: string; size: number; }
export function inspectDocument(file?: DocumentFile, evidence=false) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) throw new BadRequestException('Selecione um arquivo');
  const b = file.buffer;
  if (b.length > MAX_DOCUMENT_BYTES) throw new PayloadTooLargeException('O arquivo deve ter no máximo 10 MB');
  let mime: string, extension: string;
  if (b.subarray(0,5).toString('ascii') === '%PDF-' && b.subarray(Math.max(0,b.length-1024)).includes(Buffer.from('%%EOF'))) { mime='application/pdf'; extension='pdf'; }
  else if (b.length >= 33 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.subarray(12,16).toString('ascii') === 'IHDR' && b.subarray(-8,-4).toString('ascii') === 'IEND') { mime='image/png'; extension='png'; }
  else if (b.length >= 4 && b[0]===255 && b[1]===216 && b[2]===255 && b[b.length-2]===255 && b[b.length-1]===217) { mime='image/jpeg'; extension='jpg'; }
  else if(evidence&&/\.csv$/i.test(file.originalname)&&['text/csv','application/vnd.ms-excel','application/octet-stream',''].includes(file.mimetype)){
    try{const text=new TextDecoder('utf-8',{fatal:true}).decode(b);if(!text.trim()||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))throw new Error();}catch{throw new BadRequestException('CSV deve conter texto UTF-8 válido.');}
    mime='text/csv';extension='csv';
  }
  else if(evidence&&/\.xlsx$/i.test(file.originalname)&&['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'].includes(file.mimetype)){
    inspectSpreadsheet(b);mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';extension='xlsx';
  }
  else throw new BadRequestException(evidence?'Formato inválido. Envie PDF, JPEG, PNG, CSV UTF-8 ou Excel XLSX sem macros.':'Formato inválido. Envie PDF, JPEG ou PNG');
  if (!['csv','xlsx'].includes(extension)&&file.mimetype !== mime) throw new BadRequestException('O conteúdo não corresponde ao tipo declarado');
  const name = file.originalname?.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g,'').trim();
  if (!name || name.length > 255) throw new BadRequestException('Nome de arquivo inválido');
  // Signature checks identify the container; they are not antivirus, a full
  // parser, OCR or a guarantee that a PDF has no active content.
  return { mime, extension, name };
}
// Bounded ZIP/container validation. Attachments are never executed or interpreted as financial/OCR inputs.
export function inspectSpreadsheet(b:Buffer){
 try{
  let e=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){e=i;break;}
  if(e<0||b.readUInt16LE(e+4)||b.readUInt16LE(e+6)||e+22+b.readUInt16LE(e+20)!==b.length)throw new Error();
  const count=b.readUInt16LE(e+10),offset=b.readUInt32LE(e+16);if(!count||count>1000||b.readUInt16LE(e+8)!==count||offset+b.readUInt32LE(e+12)!==e)throw new Error();
  let p=offset,total=0;const names=new Set<string>();
  for(let i=0;i<count;i++){
   if(p+46>e||b.readUInt32LE(p)!==0x02014b50)throw new Error();const flags=b.readUInt16LE(p+8),method=b.readUInt16LE(p+10),compressed=b.readUInt32LE(p+20),size=b.readUInt32LE(p+24),n=b.readUInt16LE(p+28),extra=b.readUInt16LE(p+30),comment=b.readUInt16LE(p+32),local=b.readUInt32LE(p+42);const name=b.subarray(p+46,p+46+n).toString('utf8');
   total+=size;if(flags&1||![0,8].includes(method)||total>20*1024*1024||!name||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||/vbaProject|\.bin$|externalLinks\//i.test(name)||names.has(name)||p+46+n+extra+comment>e||local+30>offset||b.readUInt32LE(local)!==0x04034b50)throw new Error();
   const ln=b.readUInt16LE(local+26),le=b.readUInt16LE(local+28),start=local+30+ln+le;if(b.subarray(local+30,local+30+ln).toString('utf8')!==name||start+compressed>offset)throw new Error();
   const bytes=method===8?inflateRawSync(b.subarray(start,start+compressed),{maxOutputLength:Math.max(1,size)}):b.subarray(start,start+compressed);if(bytes.length!==size)throw new Error();names.add(name);p+=46+n+extra+comment;
  }
  if(p!==e||!names.has('[Content_Types].xml')||!names.has('xl/workbook.xml')||![...names].some(n=>/^xl\/worksheets\/sheet[^/]*\.xml$/.test(n)))throw new Error();
 }catch{throw new BadRequestException('Excel inválido ou não permitido. Envie XLSX sem macros, links externos e até 20 MB descompactados.');}
}
