import {EventEmitter} from 'node:events';
import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {signatureDownloadOrigins,signatureDownloadUrl,signaturePublicIPv4,signatureDownloadPdf} from './sales-signature-download';
jest.mock('node:dns/promises',()=>({lookup:jest.fn()}));
jest.mock('node:https',()=>({request:jest.fn()}));
const dns=lookup as jest.Mock,https=request as jest.Mock;
describe('sandbox PDF transport',()=>{
 beforeEach(()=>{jest.clearAllMocks();dns.mockResolvedValue([{address:'8.8.8.8',family:4}]);});
 it.each(['',null,'http://files.example.com','https://*.example.com','https://files.example.com/path','https://user@files.example.com','https://127.0.0.1','https://files.example.com:443','https://files.example.com/','https://files.example.com?x=1'])('denies unapproved origin configuration %s',v=>expect(()=>signatureDownloadOrigins(v)).toThrow());
 it('accepts exact origins only',()=>{const origins=signatureDownloadOrigins('https://files.example.com,https://other.example.com');expect(origins).toHaveLength(2);expect(signatureDownloadUrl('https://files.example.com/a.pdf?signature=temporary',origins).host).toBe('files.example.com');});
 it.each(['https://files.example.com.attacker.test/a','http://files.example.com/a','https://files.example.com/a#x','https://user:password@files.example.com/a','https://127.0.0.1/a','https://files.example.com./a','https://files.example.com/\\internal'])('denies URL %s',v=>expect(()=>signatureDownloadUrl(v,['https://files.example.com'])).toThrow());
 it.each(['0.0.0.0','10.1.2.3','127.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','100.64.0.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:8.8.8.8'])('denies address %s',v=>expect(signaturePublicIPv4(v)).toBe(false));
 it.each(['8.8.8.8','1.1.1.1','52.1.2.3'])('accepts public IPv4 %s',v=>expect(signaturePublicIPv4(v)).toBe(true));
 it('denies mixed public/private DNS without connecting',async()=>{dns.mockResolvedValue([{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]);await expect(signatureDownloadPdf(new URL('https://files.example.com/a'))).rejects.toThrow();expect(https).not.toHaveBeenCalled();});
 it('denies empty DNS',async()=>{dns.mockResolvedValue([]);await expect(signatureDownloadPdf(new URL('https://files.example.com/a'))).rejects.toThrow();expect(https).not.toHaveBeenCalled();});
 it('bounds a DNS lookup that never settles',async()=>{
  const controller=new AbortController();const timeout=jest.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);
  dns.mockImplementation(()=>new Promise(()=>{}));
  try{const pending=signatureDownloadPdf(new URL('https://files.example.com/a'));controller.abort();await expect(pending).rejects.toThrow('Download timeout');expect(https).not.toHaveBeenCalled();}
  finally{timeout.mockRestore();}
 });
 it('bounds a connection that never returns a response',async()=>{
  const controller=new AbortController();const timeout=jest.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);
  https.mockImplementation((_url,options)=>{const req:any=new EventEmitter();req.end=()=>queueMicrotask(()=>controller.abort());options.signal.addEventListener('abort',()=>req.emit('error',Error('aborted')));return req;});
  try{await expect(signatureDownloadPdf(new URL('https://files.example.com/a'))).rejects.toThrow('PDF connection failed');}
  finally{timeout.mockRestore();}
 });
 function response(status:number,headers:any,chunks:Buffer[],complete=true,aborted=false){
  https.mockImplementation((_url,options,callback)=>{
   const req:any=new EventEmitter();req.destroy=jest.fn();req.end=()=>queueMicrotask(()=>{
    const res:any=new EventEmitter();res.statusCode=status;res.headers=headers;res.complete=complete;res.destroy=jest.fn();
    callback(res);if(status!==200)return;
    if(aborted){res.emit('aborted');return;}
    chunks.forEach(x=>res.emit('data',x));res.emit('end');
   });return req;
  });
 }
 it('pins public DNS, uses hostname TLS, no credentials and returns bounded PDF',async()=>{
  response(200,{'content-type':'application/pdf','content-length':'7'},[Buffer.from('%PDF-xx')]);
  expect((await signatureDownloadPdf(new URL('https://files.example.com/a'))).toString()).toBe('%PDF-xx');
  const [url,options]=https.mock.calls[0];expect(url.hostname).toBe('files.example.com');expect(options.agent).toBe(false);expect(options.autoSelectFamily).toBe(false);expect(options.headers.Authorization).toBeUndefined();expect(options.rejectUnauthorized).toBeUndefined();
  const callback=jest.fn();options.lookup('files.example.com',{},callback);expect(callback).toHaveBeenCalledWith(null,'8.8.8.8',4);
 });
 it.each([301,302,307,401,404,500])('never follows redirects or non200 HTTP %s',async s=>{response(s,{},[]);await expect(signatureDownloadPdf(new URL('https://files.example.com/a'))).rejects.toThrow();expect(https).toHaveBeenCalledTimes(1);});
 it.each([{'content-type':'text/html'},{'content-type':'application/pdf','content-encoding':'gzip'},{'content-type':'application/pdf','content-length':'1048577'},{'content-type':'application/pdf','content-length':'invalid'}])('rejects unsafe headers %j',async h=>{response(200,h,[]);await expect(signatureDownloadPdf(new URL('https://files.example.com/a'))).rejects.toThrow();});
 it('rejects oversize body without content length',async()=>{response(200,{'content-type':'application/pdf'},[Buffer.alloc(1048577)]);await expect(signatureDownloadPdf(new URL('https://files.example.com/a'))).rejects.toThrow();});
 it('rejects incomplete stream',async()=>{response(200,{'content-type':'application/pdf'},[Buffer.from('x')],false);await expect(signatureDownloadPdf(new URL('https://files.example.com/a'))).rejects.toThrow();});
 it('rejects length mismatch',async()=>{response(200,{'content-type':'application/pdf','content-length':'9'},[Buffer.from('x')]);await expect(signatureDownloadPdf(new URL('https://files.example.com/a'))).rejects.toThrow();});
 it('rejects aborted transfer',async()=>{response(200,{'content-type':'application/pdf'},[],false,true);await expect(signatureDownloadPdf(new URL('https://files.example.com/a'))).rejects.toThrow();});
 it('propagates DNS failure without exposing original URL',async()=>{dns.mockRejectedValue(Error('DNS failed'));await expect(signatureDownloadPdf(new URL('https://files.example.com/a'))).rejects.toThrow();expect(https).not.toHaveBeenCalled();});
});
