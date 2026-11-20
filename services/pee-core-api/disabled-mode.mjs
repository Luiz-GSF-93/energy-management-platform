import http from 'node:http';

export function createDisabledServer(){
  return http.createServer((req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    const health=req.method==='GET'&&req.url==='/health';
    res.statusCode=health?200:503;
    res.end(JSON.stringify(health
      ?{service:'energyos-pee-core-api',enabled:false,ready:false,status:'disabled'}
      :{error:'PEE_CORE_DISABLED',message:'Integração PEE desligada; nenhuma operação executada.'}));
  });
}
