import{parentPort,workerData}from'node:worker_threads';
import{buildDemonstration}from'./demonstration.mjs';
try{
 if(workerData?.operation!=='build')throw Error('Invalid worker operation');
 const result=await buildDemonstration(workerData.data,workerData.assessment,workerData.settings,{onProgress:p=>parentPort.postMessage({type:'progress',progress:p})});
 const bytes=result.bytes.buffer.slice(result.bytes.byteOffset,result.bytes.byteOffset+result.bytes.byteLength);parentPort.postMessage({type:'completed',bytes,manifest:result.manifest},[bytes]);
}catch(error){parentPort.postMessage({type:'failed',message:error?.name==='Error'?'A geração do exemplo não foi concluída. Confira o projeto e tente novamente.':String(error.message).slice(0,500)});}
