import {BadRequestException} from '@nestjs/common';
import {Worker} from 'node:worker_threads';
/** Parse image metadata in a bounded worker; never render or execute uploaded content. */
export async function validateTradingImage(buffer:Buffer,mime:string){
 await new Promise<void>((resolve,reject)=>{let settled=false;const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {PDFDocument}=require(workerData.module);(async()=>{try{const d=await PDFDocument.create();const i=await d[workerData.png?'embedPng':'embedJpg'](workerData.bytes);parentPort.postMessage(i.width>0&&i.height>0&&i.width*i.height<=40000000);}catch{parentPort.postMessage(false);}})();`,{eval:true,workerData:{bytes:Uint8Array.from(buffer),png:mime==='image/png',module:require.resolve('pdf-lib')},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
  const done=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();ok?resolve():reject(new BadRequestException('Imagem inválida ou acima do limite seguro de resolução.'));};const timer=setTimeout(()=>done(false),5000);worker.once('message',v=>done(v===true));worker.once('error',()=>done(false));worker.once('exit',()=>done(false));
 });
}
