import {BadRequestException,ServiceUnavailableException} from '@nestjs/common';
import {Worker} from 'node:worker_threads';
import {OriginalFile,ORIGINAL_LIMIT} from './eva-official-document.model';
let parsing=false;
/** Binary admission only; never renders, executes or extracts PDF content. */
export async function validateOriginalPdf(file:OriginalFile){
 if(!file||!Buffer.isBuffer(file.buffer)||file.size!==file.buffer.length||file.size<20||file.size>ORIGINAL_LIMIT||file.mimetype!=='application/pdf'||!/^%PDF-(?:1\.[0-9]|2\.0)/.test(file.buffer.subarray(0,10).toString('ascii'))||!file.buffer.subarray(-2048).includes(Buffer.from('%%EOF'))||typeof file.originalname!=='string'||file.originalname.length>180||!/^[-\p{L}\p{N} _.()]+\.pdf$/iu.test(file.originalname))throw new BadRequestException('Informe um PDF válido de até 25 MiB, com nome seguro.');
 if(parsing)throw new ServiceUnavailableException('Validação de PDF ocupada. Tente novamente após conferir o estado.');parsing=true;
 try{await new Promise<void>((resolve,reject)=>{
  const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {PDFDocument}=require(workerData.module);PDFDocument.load(workerData.bytes,{ignoreEncryption:false,throwOnInvalidObject:true}).then(d=>parentPort.postMessage(!d.isEncrypted&&d.getPageCount()>0&&d.getPageCount()<=1000)).catch(()=>parentPort.postMessage(false));`,{eval:true,workerData:{bytes:Uint8Array.from(file.buffer),module:require.resolve('pdf-lib')},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
  let settled=false;const done=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();ok?resolve():reject(new BadRequestException('PDF ilegível, protegido, vazio ou acima do limite de validação.'))};
  const timer=setTimeout(()=>done(false),5000);worker.once('message',v=>done(v===true));worker.once('error',()=>done(false));worker.once('exit',()=>done(false));
 })}finally{parsing=false}
}
