import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
export const DOCUMENT_BUCKET = 'energy-documents-private';
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export interface DocumentFile { buffer: Buffer; originalname: string; mimetype: string; size: number; }
export function inspectDocument(file?: DocumentFile) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) throw new BadRequestException('Selecione um arquivo');
  const b = file.buffer;
  if (b.length > MAX_DOCUMENT_BYTES) throw new PayloadTooLargeException('O arquivo deve ter no máximo 10 MB');
  let mime: string, extension: string;
  if (b.subarray(0,5).toString('ascii') === '%PDF-' && b.subarray(Math.max(0,b.length-1024)).includes(Buffer.from('%%EOF'))) { mime='application/pdf'; extension='pdf'; }
  else if (b.length >= 33 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.subarray(12,16).toString('ascii') === 'IHDR' && b.subarray(-8,-4).toString('ascii') === 'IEND') { mime='image/png'; extension='png'; }
  else if (b.length >= 4 && b[0]===255 && b[1]===216 && b[2]===255 && b[b.length-2]===255 && b[b.length-1]===217) { mime='image/jpeg'; extension='jpg'; }
  else throw new BadRequestException('Formato inválido. Envie PDF, JPEG ou PNG');
  if (file.mimetype !== mime) throw new BadRequestException('O conteúdo não corresponde ao tipo declarado');
  const name = file.originalname?.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g,'').trim();
  if (!name || name.length > 255) throw new BadRequestException('Nome de arquivo inválido');
  // Signature checks identify the container; they are not antivirus, a full
  // parser, OCR or a guarantee that a PDF has no active content.
  return { mime, extension, name };
}
