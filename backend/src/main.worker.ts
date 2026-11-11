import {NestFactory} from '@nestjs/core';
import {AppModule} from './app.module';
async function bootstrap(){
 process.env.ENERGYOS_PROCESS_ROLE='EVA_WORKER';
 const app=await NestFactory.createApplicationContext(AppModule);
 app.enableShutdownHooks();
 // No public HTTP listener in the processing service.
 const keepAlive=setInterval(()=>undefined,60000);
 for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>clearInterval(keepAlive));
}
bootstrap().catch(()=>{console.error('EVA_WORKER_START_FAILED');process.exit(1);});
