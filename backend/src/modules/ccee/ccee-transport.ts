import {request} from 'node:https';
import {CceeConfig,CCEE_HOST,soapRequest} from './ccee-config';

// Fixed origin, read-only SOAP actions, no redirects or automatic retries.
export async function cceeRead(config:CceeConfig,kind:'profile'|'pld',page=1,month?:string):Promise<string> {
  const payload=Buffer.from(soapRequest(config,kind,page,month),'utf8');
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(error?:Error,result?:string)=>{if(done)return;done=true;clearTimeout(timer);payload.fill(0);error?reject(error):resolve(result!);};
    const timer=setTimeout(()=>{req.destroy();finish(new Error('CCEE_TIMEOUT'));},25000);
    let req:ReturnType<typeof request>;
    try {
      req=request({hostname:CCEE_HOST,port:443,path:kind==='profile'?'/ws/v2/PerfilParticipanteMercadoBSv2':'/ws/prec/PLDBSv1',method:'POST',agent:false,
        pfx:config.pfx,passphrase:config.passphrase,ca:config.ca,rejectUnauthorized:true,minVersion:'TLSv1.2',maxVersion:'TLSv1.2',
        headers:{'Content-Type':'text/xml; charset=utf-8','SOAPAction':kind==='profile'?'listarPerfilParticipanteMercado':'listarPLD','Content-Length':payload.length,'Connection':'close'}},res=>{
          if(res.statusCode!==200||! /(?:text|application)\/xml/i.test(String(res.headers['content-type']??''))) {res.destroy();finish(new Error('CCEE_PROVIDER_REJECTED'));return;}
          let bytes=0;const chunks:Buffer[]=[];
          res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>2*1024*1024){res.destroy();finish(new Error('CCEE_RESPONSE_LIMIT'));}else chunks.push(chunk);});
          res.on('error',()=>finish(new Error('CCEE_TRANSPORT_ERROR')));
          res.on('aborted',()=>finish(new Error('CCEE_TRANSPORT_ERROR')));
          res.on('end',()=>finish(undefined,Buffer.concat(chunks).toString('utf8')));
        });
      req.on('error',()=>finish(new Error('CCEE_TRANSPORT_ERROR')));
      req.end(payload);
    } catch {finish(new Error('CCEE_TRANSPORT_ERROR'));}
  });
}
