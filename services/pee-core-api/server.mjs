// Independent PEE process. Existing EnergyOS entrypoints do not import this file.
import {createDisabledServer} from './disabled-mode.mjs';

if(process.env.PEE_ACCESS_ENABLED==='true'){
  const {startAccessServer}=await import('./access-server.mjs');
  startAccessServer();
}else if(process.env.PEE_CORE_ENABLED==='true'){
  // Authentication, persistence and signature configuration are mandatory there.
  await import('./server-enabled.mjs');
}else{
  const server=createDisabledServer();
  server.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>{
    process.stdout.write('EnergyOS PEE gateway: integration disabled.\n');
  });
}
