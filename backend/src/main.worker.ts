import {assertEvaWorkerConfiguration} from './common/workers/eva-worker-configuration';
import {NestFactory} from '@nestjs/core';
import {EvaWorkerModule} from './eva-worker.module';
async function bootstrap(){
 process.env.ENERGYOS_PROCESS_ROLE='EVA_WORKER';
 assertEvaWorkerConfiguration(process.env);
 const app=await NestFactory.createApplicationContext(EvaWorkerModule);
 app.enableShutdownHooks();
 console.log('EVA_WORKER_READY');
 // No public HTTP listener in the processing service.
 const keepAlive=setInterval(()=>undefined,60000);
 for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>clearInterval(keepAlive));
}
bootstrap().catch(()=>{console.error('EVA_WORKER_START_FAILED');process.exit(1);});
