// SERPRO documented PDF command, invoked only after an explicit user action.
// Certificate choice and PIN remain in the installed signer. No key/PFX enters this application.
export function signPdfWithInstalledCertificate(base64,{Socket=WebSocket,timeout=240000}={}){
 if(typeof base64!=='string'||base64.length>28000000||!base64.startsWith('JVBERi0'))return Promise.reject(Error('Selecione um PDF de até 20 MB.'));
 return new Promise((resolve,reject)=>{
  const ws=new Socket('wss://127.0.0.1:65156/signer/'),requestId=Date.now();let completed=false;
  const timer=setTimeout(()=>finish(Error('A assinatura não foi concluída. Confira o Assinador SERPRO no seu computador.')),timeout);
  function finish(error,result){if(completed)return;completed=true;clearTimeout(timer);ws.close();error?reject(error):resolve(result);}
  ws.onopen=()=>ws.send(JSON.stringify({command:'sign',type:'pdf',inputData:base64,outputDataType:'base64',requestId}));
  ws.onmessage=event=>{
   if(typeof event.data!=='string'||event.data.length>58000000)return finish(Error('Resposta do assinador excede o limite.'));
   let r;try{r=JSON.parse(event.data);}catch{return finish(Error('Resposta inválida do assinador.'));}
   if(r.requestId!==requestId)return;
   if(r.error||r.actionCanceled)return finish(Error(r.actionCanceled?'Assinatura cancelada por você.':'O assinador não confirmou a assinatura.'));
   if(r.original!==undefined&&r.original!==base64)return finish(Error('O assinador devolveu um original diferente do solicitado.'));
   if(typeof r.signature!=='string'||r.signature.length>28000000||!r.signature.startsWith('JVBERi0')||r.signature===base64)return finish(Error('O assinador não devolveu uma nova versão PDF assinada.'));
   finish(null,r.signature);
  };
  ws.onerror=()=>finish(Error('Não foi possível conectar ao Assinador SERPRO. Abra o aplicativo instalado e confira a configuração oficial de acesso local.'));
  ws.onclose=()=>{if(!completed)finish(Error('A conexão local foi encerrada antes da confirmação.'));};
 });
}
