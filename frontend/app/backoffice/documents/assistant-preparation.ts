import {apiRequest} from '@/app/lib/api/client';
export type AssistantActivity={id:string;state:'RUNNING'|'READY'|'FAILED';completed:string[];stages:string[];elapsedMs:number;message?:string};
export const activityLabels:Record<string,string>={source:'Origem e leitura OCR',fields:'Conferência dos campos',history:'Comparação com histórico',configuration:'Cadastros e vigências',proposals:'Preenchimentos e lançamentos',ready:'Pronto para validação do operador'};
export async function prepareAssistant<T>(id:string,notify:(job:AssistantActivity)=>void,signal:AbortSignal):Promise<T>{
 const path='/api/v1/documents/'+encodeURIComponent(id)+'/ocr/assistant/prepare';
 let job=await apiRequest<AssistantActivity&{plan?:T}>(path,{method:'POST',signal});
 const started=Date.now();
 while(true){
  if(signal.aborted)throw new Error('Consulta cancelada.');
  notify(job);
  if(job.state==='READY'){if(!job.plan)throw new Error('Proposta indisponível. Atualize o assistente.');return job.plan;}
  if(job.state==='FAILED')throw new Error(job.message||'Conferência não concluída. Atualize o assistente.');
  if(Date.now()-started>150000)throw new Error('A consulta excedeu o prazo. Atualize o assistente; nenhum lançamento foi iniciado.');
  await new Promise<void>((resolve,reject)=>{
   const aborted=()=>{clearTimeout(timer);reject(new Error('Consulta cancelada.'));};
   const timer=setTimeout(()=>{signal.removeEventListener('abort',aborted);resolve();},1500);
   signal.addEventListener('abort',aborted,{once:true});
  });
  job=await apiRequest<AssistantActivity&{plan?:T}>(path+'/'+encodeURIComponent(job.id),{signal});
 }
}
