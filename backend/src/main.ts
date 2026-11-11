import {processRole} from './common/workers/process-role';
import {salesCors} from './modules/sales-intake/sales-intake.cors';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  if(processRole()==='EVA_WORKER')throw new Error('Use the private EVA worker entrypoint');
  const app = await NestFactory.create(AppModule, { rawBody: true });
  
  app.setGlobalPrefix('api/v1');
  
  app.enableCors(salesCors);
  
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`✅ Application is running on: http://localhost:${port}`);
}

bootstrap().catch(err => {
  console.error('❌ Error starting application:', err);
  process.exit(1);
});
