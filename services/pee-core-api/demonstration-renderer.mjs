import{Worker}from'node:worker_threads';
import{ProjectError}from'./project-policy.mjs';
// One rendering worker at a time keeps CPU/font layout away from the HTTP/SSO
// event loop and bounds the extra memory used by demonstration generation.
let previous=Promise.resolve(),waiting=0;
export function buildDemonstrationInWorker(data,assessment,settings,{onProgress=()=>{}}={}){
 if(waiting>=2)return Promise.reject(new ProjectError('A geração de exemplos está ocupada. Aguarde antes de repetir.',429));waiting++;
 const run=()=>new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./demonstration-worker.mjs',import.meta.url),{workerData:{operation:'build',data,assessment,settings},resourceLimits:{maxOldGenerationSizeMb:256}});let completed=false;
  const timer=setTimeout(()=>finish(new ProjectError('A geração ultrapassou o tempo disponível. Atualize o projeto antes de repetir.',503)),600000);timer.unref();
  function finish(error,value){if(completed)return;completed=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(value);}
  worker.on('message',message=>{if(message.type==='progress')onProgress(message.progress);else if(message.type==='completed')finish(null,{bytes:Buffer.from(message.bytes),manifest:message.manifest});else if(message.type==='failed')finish(new ProjectError(message.message));});
  worker.on('error',()=>finish(new ProjectError('Não foi possível concluir a geração isolada do exemplo. Tente novamente.',503)));worker.on('exit',code=>{if(!completed)finish(new ProjectError('A geração foi interrompida. Atualize os dados antes de repetir.',503));});
 });
 const result=previous.then(run);previous=result.catch(()=>{});return result.finally(()=>{waiting--;});
}
