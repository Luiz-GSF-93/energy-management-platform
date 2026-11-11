const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eva-bootstrap-'));let child,timer;
 try{
  const guard=path.join(dir,'forbid-listener.cjs');fs.writeFileSync(guard,"require('node:net').Server.prototype.listen=function(){throw Error('EVA_WORKER_HTTP_LISTENER_FORBIDDEN')};");
  child=spawn(process.execPath,['-r',guard,path.resolve(__dirname,'../dist/main.worker.js')],{cwd:dir,env:{PATH:process.env.PATH,NODE_ENV:'test',SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_KEY:'test-only-key',PORT:'3001'},stdio:['ignore','pipe','pipe']});
  let output='',errors='';
  await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(Error('Worker bootstrap timeout')),15000);
   child.stderr.on('data',b=>{errors+=b.toString()});
   child.stdout.on('data',b=>{output+=b.toString();if(output.includes('EVA_WORKER_READY'))resolve();});
   child.once('error',reject);child.once('exit',code=>reject(Error('Worker exited before readiness: '+code+' '+errors.slice(0,500))));
  });
  assert.ok(!output.includes('AuthModule dependencies initialized'),'worker must not load authentication module');
  assert.ok(!errors.includes('EVA_WORKER_HTTP_LISTENER_FORBIDDEN'),'worker must not open any network listener');
  console.log('Private EVA worker boots without JWT_SECRET, without HTTP listener and without API schedules.');
 }finally{
  clearTimeout(timer);if(child){child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null||child.signalCode)return r();const t=setTimeout(()=>{child.kill('SIGKILL');r();},3000);child.once('exit',()=>{clearTimeout(t);r();});});}
  fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
